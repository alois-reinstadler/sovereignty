import {
	ENCRYPTED_RECORD_FORMAT_V2,
	parseDecimalBigInt,
	SYNC_PROTOCOL_VERSION,
	type SyncMutationRequest,
} from "@svrgn/sync-protocol";
import type { Pool, PoolClient, QueryResult } from "pg";
import { describe, expect, it, vi } from "vitest";

import {
	createPostgresSyncStore,
	fingerprintSyncMutation,
	SyncMutationIdReusedError,
	SyncRevisionConflictError,
} from "./sync-store.server";

const VAULT_ID = "vault-one";
const USER_ID = "018f3d3e-8bb7-7cc8-8e02-3e8cad8d5b74";

const mutation = (): SyncMutationRequest => ({
	mutationId: "018f3d3e-8bb7-7cc8-8e02-3e8cad8d5b75",
	baseRevision: parseDecimalBigInt("0", { allowZero: true }),
	record: {
		format: ENCRYPTED_RECORD_FORMAT_V2,
		version: SYNC_PROTOCOL_VERSION,
		vaultId: VAULT_ID,
		recordId: "record-one",
		revision: parseDecimalBigInt("1"),
		nonce: Buffer.alloc(24, 3).toString("base64url"),
		ciphertext: Buffer.alloc(32, 5).toString("base64url"),
	},
});

const result = (rows: Record<string, unknown>[]): QueryResult =>
	({ rows, rowCount: rows.length }) as unknown as QueryResult;

const scriptedClient = (responses: QueryResult[]) => {
	const queries: string[] = [];
	const query = vi.fn(async (text: string) => {
		queries.push(text.replace(/\s+/g, " ").trim());
		const response = responses.shift();
		if (!response) throw new Error(`Unexpected query: ${text}`);
		return response;
	});
	const release = vi.fn();
	return {
		client: { query, release } as unknown as PoolClient,
		queries,
		query,
		release,
	};
};

describe("PostgreSQL sync store", () => {
	it("fingerprints every authenticated encrypted field deterministically", () => {
		const first = mutation();
		const same = mutation();
		const changed = mutation();
		changed.record = {
			...changed.record,
			ciphertext: Buffer.alloc(32, 6).toString("base64url"),
		};
		expect(fingerprintSyncMutation(first)).toBe(fingerprintSyncMutation(same));
		expect(fingerprintSyncMutation(first)).not.toBe(
			fingerprintSyncMutation(changed),
		);
	});

	it("returns a stable page from an ownership-scoped cursor snapshot", async () => {
		const query = vi.fn().mockResolvedValue(
			result([
				{
					vault_cursor: "9",
					record_id: "a",
					revision: "1",
					cursor: "7",
					nonce: Buffer.alloc(24, 1),
					ciphertext: Buffer.alloc(16, 2),
				},
				{
					vault_cursor: "9",
					record_id: "b",
					revision: "2",
					cursor: "8",
					nonce: Buffer.alloc(24, 3),
					ciphertext: Buffer.alloc(16, 4),
				},
			]),
		);
		const pool = { query } as unknown as Pool;
		const store = createPostgresSyncStore(pool);
		const page = await store.pullChanges({
			ownerUserId: USER_ID,
			vaultId: VAULT_ID,
			afterCursor: "3",
			limit: 1,
		});

		expect(page).toMatchObject({ nextCursor: "7", hasMore: true });
		expect(page?.changes).toHaveLength(1);
		expect(page?.changes[0]?.record).toMatchObject({
			vaultId: VAULT_ID,
			recordId: "a",
			revision: "1",
		});
		expect(query.mock.calls[0]?.[1]).toEqual([VAULT_ID, USER_ID, "3", 2]);
		expect(query.mock.calls[0]?.[0]).toContain('v."owner_user_id" = $2::uuid');
	});

	it("returns null for absent and non-owned vaults with the same query result", async () => {
		const pool = {
			query: vi.fn().mockResolvedValue(result([])),
		} as unknown as Pool;
		const store = createPostgresSyncStore(pool);
		expect(
			await store.pullChanges({
				ownerUserId: USER_ID,
				vaultId: VAULT_ID,
				afterCursor: "0",
				limit: 100,
			}),
		).toBeNull();
	});

	it("never moves a client cursor backward when no newer record exists", async () => {
		const query = vi.fn().mockResolvedValue(
			result([
				{
					vault_cursor: "9",
					record_id: null,
					revision: null,
					cursor: null,
					nonce: null,
					ciphertext: null,
				},
			]),
		);
		const store = createPostgresSyncStore({ query } as unknown as Pool);
		const page = await store.pullChanges({
			ownerUserId: USER_ID,
			vaultId: VAULT_ID,
			afterCursor: "12",
			limit: 100,
		});
		expect(page).toEqual({ changes: [], nextCursor: "12", hasMore: false });
	});

	it("serializes and atomically commits an encrypted mutation", async () => {
		const scripted = scriptedClient([
			result([]),
			result([{ next_cursor: "4" }]),
			result([]),
			result([]),
			result([]),
			result([]),
			result([]),
			result([]),
		]);
		const pool = {
			connect: vi.fn().mockResolvedValue(scripted.client),
		} as unknown as Pool;
		const store = createPostgresSyncStore(pool);
		const response = await store.pushMutations({
			ownerUserId: USER_ID,
			vaultId: VAULT_ID,
			mutations: [mutation()],
		});

		expect(response).toMatchObject({
			nextCursor: "5",
			results: [{ cursor: "5", revision: "1", status: "applied" }],
		});
		expect(scripted.queries[0]).toBe("begin");
		expect(scripted.queries[1]).toContain("for update");
		expect(scripted.queries.at(-1)).toBe("commit");
		expect(scripted.queries.some((query) => query.includes("ciphertext"))).toBe(
			true,
		);
		expect(scripted.release).toHaveBeenCalledOnce();
	});

	it("replays the original result for an identical mutation ID", async () => {
		const requestMutation = mutation();
		const scripted = scriptedClient([
			result([]),
			result([{ next_cursor: "5" }]),
			result([
				{
					record_id: requestMutation.record.recordId,
					resulting_revision: "1",
					resulting_cursor: "5",
					request_fingerprint: fingerprintSyncMutation(requestMutation),
				},
			]),
			result([]),
			result([]),
		]);
		const pool = {
			connect: vi.fn().mockResolvedValue(scripted.client),
		} as unknown as Pool;
		const response = await createPostgresSyncStore(pool).pushMutations({
			ownerUserId: USER_ID,
			vaultId: VAULT_ID,
			mutations: [requestMutation],
		});
		expect(response?.results).toEqual([
			{
				mutationId: requestMutation.mutationId,
				recordId: requestMutation.record.recordId,
				revision: "1",
				cursor: "5",
				status: "replayed",
			},
		]);
		expect(
			scripted.queries.some((query) =>
				query.startsWith('insert into "sync_record"'),
			),
		).toBe(false);
	});

	it("rolls back the entire batch on revision conflict", async () => {
		const scripted = scriptedClient([
			result([]),
			result([{ next_cursor: "5" }]),
			result([]),
			result([{ revision: "2" }]),
			result([]),
		]);
		const pool = {
			connect: vi.fn().mockResolvedValue(scripted.client),
		} as unknown as Pool;
		await expect(
			createPostgresSyncStore(pool).pushMutations({
				ownerUserId: USER_ID,
				vaultId: VAULT_ID,
				mutations: [mutation()],
			}),
		).rejects.toBeInstanceOf(SyncRevisionConflictError);
		expect(scripted.queries.at(-1)).toBe("rollback");
		expect(scripted.release).toHaveBeenCalledOnce();
	});

	it("rejects mutation UUID reuse with different ciphertext", async () => {
		const scripted = scriptedClient([
			result([]),
			result([{ next_cursor: "5" }]),
			result([
				{
					record_id: "record-one",
					resulting_revision: "1",
					resulting_cursor: "5",
					request_fingerprint: "0".repeat(64),
				},
			]),
			result([]),
		]);
		const pool = {
			connect: vi.fn().mockResolvedValue(scripted.client),
		} as unknown as Pool;
		await expect(
			createPostgresSyncStore(pool).pushMutations({
				ownerUserId: USER_ID,
				vaultId: VAULT_ID,
				mutations: [mutation()],
			}),
		).rejects.toBeInstanceOf(SyncMutationIdReusedError);
		expect(scripted.queries.at(-1)).toBe("rollback");
	});
});
