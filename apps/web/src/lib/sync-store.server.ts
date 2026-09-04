import { createHash } from "node:crypto";

import {
	decimalBigInt,
	decodeBase64Url,
	ENCRYPTED_RECORD_FORMAT_V2,
	type EncryptedRecordEnvelopeV2,
	MAX_WIRE_BIGINT,
	SYNC_PROTOCOL_VERSION,
	type SyncChangesResponse,
	type SyncMutationBatchResponse,
	type SyncMutationRequest,
} from "@svrgn/sync-protocol";
import type { Pool, PoolClient, QueryResultRow } from "pg";

export class SyncRevisionConflictError extends Error {
	readonly name = "SyncRevisionConflictError";

	constructor(
		readonly mutationId: string,
		readonly recordId: string,
		readonly expectedBaseRevision: string,
		readonly currentRevision: string,
	) {
		super("The record changed after the mutation base revision");
	}
}

export class SyncMutationIdReusedError extends Error {
	readonly name = "SyncMutationIdReusedError";

	constructor(readonly mutationId: string) {
		super("The mutation ID was already used for a different request");
	}
}

export class SyncCursorExhaustedError extends Error {
	readonly name = "SyncCursorExhaustedError";
}

export interface SyncStore {
	pullChanges(input: {
		readonly ownerUserId: string;
		readonly vaultId: string;
		readonly afterCursor: string;
		readonly limit: number;
	}): Promise<SyncChangesResponse | null>;
	pushMutations(input: {
		readonly ownerUserId: string;
		readonly vaultId: string;
		readonly mutations: ReadonlyArray<SyncMutationRequest>;
	}): Promise<SyncMutationBatchResponse | null>;
}

interface PullRow extends QueryResultRow {
	vault_cursor: string;
	record_id: string | null;
	revision: string | null;
	cursor: string | null;
	nonce: Uint8Array | null;
	ciphertext: Uint8Array | null;
}

interface LockedVaultRow extends QueryResultRow {
	next_cursor: string;
}

interface MutationRow extends QueryResultRow {
	record_id: string;
	resulting_revision: string;
	resulting_cursor: string;
	request_fingerprint: string | null;
}

interface RecordRevisionRow extends QueryResultRow {
	revision: string;
}

const encodeBase64Url = (value: Uint8Array): string =>
	Buffer.from(value).toString("base64url");

export const fingerprintSyncMutation = (
	mutation: SyncMutationRequest,
): string =>
	createHash("sha256")
		.update(
			JSON.stringify({
				mutationId: mutation.mutationId,
				baseRevision: mutation.baseRevision,
				record: {
					format: mutation.record.format,
					version: mutation.record.version,
					vaultId: mutation.record.vaultId,
					recordId: mutation.record.recordId,
					revision: mutation.record.revision,
					nonce: mutation.record.nonce,
					ciphertext: mutation.record.ciphertext,
				},
			}),
			"utf8",
		)
		.digest("hex");

const toEnvelope = (
	vaultId: string,
	row: PullRow,
): EncryptedRecordEnvelopeV2 => {
	if (
		row.record_id === null ||
		row.revision === null ||
		row.nonce === null ||
		row.ciphertext === null
	) {
		throw new Error("Incomplete sync record returned by PostgreSQL");
	}
	return {
		format: ENCRYPTED_RECORD_FORMAT_V2,
		version: SYNC_PROTOCOL_VERSION,
		vaultId,
		recordId: row.record_id,
		revision: decimalBigInt(BigInt(row.revision)),
		nonce: encodeBase64Url(row.nonce),
		ciphertext: encodeBase64Url(row.ciphertext),
	};
};

const rollbackQuietly = async (client: PoolClient): Promise<void> => {
	await client.query("rollback").catch(() => undefined);
};

export const createPostgresSyncStore = (pool: Pool): SyncStore => ({
	async pullChanges({ ownerUserId, vaultId, afterCursor, limit }) {
		// This is one PostgreSQL statement so the ownership check, cursor snapshot,
		// and page all observe the same READ COMMITTED snapshot.
		const result = await pool.query<PullRow>(
			`
				select
					v."next_cursor"::text as vault_cursor,
					r."record_id",
					r."revision"::text,
					r."cursor"::text,
					r."nonce",
					r."ciphertext"
				from "sync_vault" v
				left join lateral (
					select "record_id", "revision", "cursor", "nonce", "ciphertext"
					from "sync_record"
					where "vault_id" = v."id"
						and "cursor" > $3::bigint
						and "cursor" <= v."next_cursor"
					order by "cursor" asc
					limit $4
				) r on true
				where v."id" = $1 and v."owner_user_id" = $2::uuid
				order by r."cursor" asc nulls last
			`,
			[vaultId, ownerUserId, afterCursor, limit + 1],
		);

		if (result.rows.length === 0) return null;
		const vaultCursor = result.rows[0]?.vault_cursor;
		if (vaultCursor === undefined) {
			throw new Error("Sync vault cursor was not returned by PostgreSQL");
		}
		const recordRows = result.rows.filter(
			(row): row is PullRow & { cursor: string } => row.cursor !== null,
		);
		const hasMore = recordRows.length > limit;
		const pageRows = recordRows.slice(0, limit);
		const lastCursor = pageRows.at(-1)?.cursor;
		const settledCursor =
			BigInt(afterCursor) > BigInt(vaultCursor) ? afterCursor : vaultCursor;
		const nextCursor = hasMore && lastCursor ? lastCursor : settledCursor;

		return {
			changes: pageRows.map((row) => ({
				cursor: decimalBigInt(BigInt(row.cursor), { allowZero: true }),
				record: toEnvelope(vaultId, row),
			})),
			nextCursor: decimalBigInt(BigInt(nextCursor), { allowZero: true }),
			hasMore,
		};
	},

	async pushMutations({ ownerUserId, vaultId, mutations }) {
		const client = await pool.connect();
		try {
			await client.query("begin");
			const vault = await client.query<LockedVaultRow>(
				`
					select "next_cursor"::text
					from "sync_vault"
					where "id" = $1 and "owner_user_id" = $2::uuid
					for update
				`,
				[vaultId, ownerUserId],
			);
			if (vault.rows.length === 0) {
				await rollbackQuietly(client);
				return null;
			}

			let nextCursor = BigInt(vault.rows[0]?.next_cursor ?? "0");
			const results: SyncMutationBatchResponse["results"][number][] = [];

			for (const mutation of mutations) {
				const fingerprint = fingerprintSyncMutation(mutation);
				const replay = await client.query<MutationRow>(
					`
						select "record_id", "resulting_revision"::text,
							"resulting_cursor"::text, "request_fingerprint"
						from "sync_mutation"
						where "vault_id" = $1 and "mutation_id" = $2::uuid
					`,
					[vaultId, mutation.mutationId],
				);
				const replayed = replay.rows[0];
				if (replayed) {
					if (replayed.request_fingerprint !== fingerprint) {
						throw new SyncMutationIdReusedError(mutation.mutationId);
					}
					results.push({
						mutationId: mutation.mutationId,
						recordId: replayed.record_id,
						revision: decimalBigInt(BigInt(replayed.resulting_revision)),
						cursor: decimalBigInt(BigInt(replayed.resulting_cursor)),
						status: "replayed",
					});
					continue;
				}

				const current = await client.query<RecordRevisionRow>(
					`
						select "revision"::text
						from "sync_record"
						where "vault_id" = $1 and "record_id" = $2
					`,
					[vaultId, mutation.record.recordId],
				);
				const currentRevision = current.rows[0]?.revision ?? "0";
				if (BigInt(currentRevision) !== BigInt(mutation.baseRevision)) {
					throw new SyncRevisionConflictError(
						mutation.mutationId,
						mutation.record.recordId,
						mutation.baseRevision,
						currentRevision,
					);
				}
				if (nextCursor >= MAX_WIRE_BIGINT) {
					throw new SyncCursorExhaustedError("The vault cursor is exhausted");
				}
				nextCursor += 1n;

				await client.query(
					`
						insert into "sync_record" (
							"vault_id", "record_id", "revision", "cursor",
							"crypto_version", "nonce", "ciphertext"
						) values ($1, $2, $3::bigint, $4::bigint, 2, $5, $6)
						on conflict ("vault_id", "record_id") do update set
							"revision" = excluded."revision",
							"cursor" = excluded."cursor",
							"crypto_version" = excluded."crypto_version",
							"nonce" = excluded."nonce",
							"ciphertext" = excluded."ciphertext",
							"updated_at" = now()
					`,
					[
						vaultId,
						mutation.record.recordId,
						mutation.record.revision,
						nextCursor.toString(10),
						Buffer.from(
							decodeBase64Url(mutation.record.nonce, "nonce", { exact: 24 }),
						),
						Buffer.from(
							decodeBase64Url(mutation.record.ciphertext, "ciphertext", {
								min: 16,
								max: 256 * 1024,
							}),
						),
					],
				);
				await client.query(
					`
						insert into "sync_mutation" (
							"vault_id", "mutation_id", "record_id",
							"resulting_revision", "resulting_cursor", "request_fingerprint"
						) values ($1, $2::uuid, $3, $4::bigint, $5::bigint, $6)
					`,
					[
						vaultId,
						mutation.mutationId,
						mutation.record.recordId,
						mutation.record.revision,
						nextCursor.toString(10),
						fingerprint,
					],
				);
				results.push({
					mutationId: mutation.mutationId,
					recordId: mutation.record.recordId,
					revision: mutation.record.revision,
					cursor: decimalBigInt(nextCursor),
					status: "applied",
				});
			}

			await client.query(
				`
					update "sync_vault"
					set "next_cursor" = $2::bigint, "updated_at" = now()
					where "id" = $1
				`,
				[vaultId, nextCursor.toString(10)],
			);
			await client.query("commit");
			return {
				results,
				nextCursor: decimalBigInt(nextCursor, { allowZero: true }),
			};
		} catch (error) {
			await rollbackQuietly(client);
			throw error;
		} finally {
			client.release();
		}
	},
});
