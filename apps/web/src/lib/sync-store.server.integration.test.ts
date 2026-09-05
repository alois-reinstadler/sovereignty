import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { promisify } from "node:util";

import {
	ENCRYPTED_RECORD_FORMAT_V2,
	parseDecimalBigInt,
	SYNC_PROTOCOL_VERSION,
	type SyncMutationRequest,
	VAULT_KEY_FORMAT_V2,
	type VaultKeyEnvelopeV2,
} from "@svrgn/sync-protocol";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { integrationDatabaseUrl } from "../../scripts/integration-database";
import {
	createPostgresSyncStore,
	SyncMutationIdReusedError,
	SyncRevisionConflictError,
	SyncVaultAlreadyExistsError,
} from "./sync-store.server";

const executeFile = promisify(execFile);
const configuredUrl = process.env.SVRGN_INTEGRATION_DATABASE_URL;

describe("integration database safety", () => {
	it("only permits explicitly named disposable databases on local hosts", () => {
		const name = `svrgn_integration_${"a".repeat(32)}`;
		expect(
			integrationDatabaseUrl(`postgresql://postgres/${name}`).pathname,
		).toBe(`/${name}`);
		for (const value of [
			"postgresql://localhost/production",
			`postgresql://database.example/${name}`,
			`postgresql://localhost/${name}?options=-csearch_path%3Dpublic`,
			`postgresql://localhost/${name}#fragment`,
			`https://localhost/${name}`,
			"postgresql://localhost/svrgn_integration_123",
		]) {
			expect(() => integrationDatabaseUrl(value)).toThrow();
		}
	});
});

// Ordinary unit-test runs neither connect nor create/drop anything.
describe.skipIf(!configuredUrl)("real PostgreSQL sync integration", () => {
	const schema = `svrgn_it_${randomUUID().replaceAll("-", "")}`;
	const applicationName = schema;
	let admin: pg.Pool;
	let pool: pg.Pool;
	let schemaCreated = false;
	let migrationUrl: string;

	const migrate = () =>
		executeFile(process.execPath, ["scripts/migrate.mjs"], {
			env: { ...process.env, DATABASE_URL: migrationUrl },
			timeout: 30_000,
		});

	beforeAll(async () => {
		const url = integrationDatabaseUrl(configuredUrl ?? "");
		admin = new pg.Pool({
			connectionString: url.href,
			max: 2,
			connectionTimeoutMillis: 5_000,
			statement_timeout: 10_000,
		});
		// The schema name is generated here, never taken from the URL or caller.
		await admin.query(`create schema "${schema}"`);
		schemaCreated = true;
		const tables = await admin.query(
			"select tablename from pg_catalog.pg_tables where schemaname = $1",
			[schema],
		);
		expect(tables.rows).toEqual([]);
		// Exclude public entirely: unqualified migration SQL cannot touch its tables.
		url.searchParams.set("options", `-c search_path=${schema},pg_catalog`);
		migrationUrl = url.href;
		await migrate();
		pool = new pg.Pool({
			connectionString: migrationUrl,
			max: 8,
			application_name: applicationName,
			connectionTimeoutMillis: 5_000,
			statement_timeout: 10_000,
		});
	}, 40_000);

	afterAll(async () => {
		await pool?.end();
		try {
			if (schemaCreated) await admin.query(`drop schema "${schema}" cascade`);
		} finally {
			await admin?.end();
		}
	});

	const seedVault = async () => {
		const ownerUserId = randomUUID();
		const vaultId = randomUUID();
		await pool.query(
			'insert into "user" (id, name, email) values ($1, $2, $3)',
			[
				ownerUserId,
				"Synthetic integration account",
				`${ownerUserId}@example.test`,
			],
		);
		const keyEnvelope: VaultKeyEnvelopeV2 = {
			format: VAULT_KEY_FORMAT_V2,
			version: SYNC_PROTOCOL_VERSION,
			vaultId,
			keyRevision: parseDecimalBigInt("1"),
			kdf: {
				algorithm: "argon2id13",
				salt: Buffer.alloc(16, 1).toString("base64url"),
				operationsLimit: 2,
				memoryLimit: 65536,
			},
			wrappedVaultKey: {
				algorithm: "xchacha20-poly1305-ietf",
				nonce: Buffer.alloc(24, 2).toString("base64url"),
				ciphertext: Buffer.alloc(48, 3).toString("base64url"),
			},
			createdAt: "2026-01-01T00:00:00.000Z",
		};
		const store = createPostgresSyncStore(pool);
		expect(await store.createVault({ ownerUserId, keyEnvelope })).toEqual({
			status: "created",
			keyEnvelope,
		});
		return { ownerUserId, vaultId, keyEnvelope, store };
	};

	const mutation = (
		vaultId: string,
		recordId: string = randomUUID(),
		baseRevision = 0,
	): SyncMutationRequest => ({
		mutationId: randomUUID(),
		baseRevision: parseDecimalBigInt(String(baseRevision), { allowZero: true }),
		record: {
			format: ENCRYPTED_RECORD_FORMAT_V2,
			version: SYNC_PROTOCOL_VERSION,
			vaultId,
			recordId,
			revision: parseDecimalBigInt(String(baseRevision + 1)),
			nonce: Buffer.alloc(24, 4).toString("base64url"),
			ciphertext: Buffer.alloc(32, 5).toString("base64url"),
		},
	});

	it("applies every checked-in migration to an empty schema and reruns without changes", async () => {
		const files = (await readdir("migrations"))
			.filter((file) => /^\d+_[a-z0-9_]+\.sql$/.test(file))
			.sort();
		const before = await pool.query(
			'select name, checksum, applied_at from "svrgn_migration" order by name',
		);
		expect(before.rows.map((row) => row.name)).toEqual(files);
		for (const row of before.rows) {
			const sql = await readFile(`migrations/${row.name}`, "utf8");
			expect(row.checksum).toBe(createHash("sha256").update(sql).digest("hex"));
		}
		await migrate();
		const after = await pool.query(
			'select name, checksum, applied_at from "svrgn_migration" order by name',
		);
		expect(after.rows).toEqual(before.rows);
		const tables = await pool.query(
			"select tablename from pg_catalog.pg_tables where schemaname = $1",
			[schema],
		);
		expect(tables.rows.map((row) => row.tablename)).toEqual(
			expect.arrayContaining([
				"user",
				"session",
				"account",
				"passkey",
				"sync_vault",
				"sync_record",
				"sync_mutation",
			]),
		);
	}, 40_000);

	it("isolates both owners across bootstrap, key reads, pulls, and pushes", async () => {
		const first = await seedVault();
		const second = await seedVault();
		const request = mutation(first.vaultId);
		await first.store.pushMutations({ ...first, mutations: [request] });
		expect(
			await first.store.getVault({ ownerUserId: second.ownerUserId }),
		).toEqual(second.keyEnvelope);
		expect(
			await first.store.pullChanges({
				ownerUserId: second.ownerUserId,
				vaultId: first.vaultId,
				afterCursor: "0",
				limit: 100,
			}),
		).toBeNull();
		expect(
			await first.store.pushMutations({
				ownerUserId: second.ownerUserId,
				vaultId: first.vaultId,
				mutations: [mutation(first.vaultId)],
			}),
		).toBeNull();
		await expect(
			first.store.createVault({
				ownerUserId: second.ownerUserId,
				keyEnvelope: first.keyEnvelope,
			}),
		).rejects.toBeInstanceOf(SyncVaultAlreadyExistsError);
		expect(await first.store.createVault(first)).toMatchObject({
			status: "existing",
		});
		expect(
			await first.store.pullChanges({ ...first, afterCursor: "0", limit: 100 }),
		).toMatchObject({ nextCursor: "1", changes: [{ record: request.record }] });
	});

	it("replays identical mutations and rejects changed payloads without consuming a cursor", async () => {
		const fixture = await seedVault();
		const request = mutation(fixture.vaultId);
		const first = await fixture.store.pushMutations({
			...fixture,
			mutations: [request],
		});
		const replay = await fixture.store.pushMutations({
			...fixture,
			mutations: [request],
		});
		expect(first?.results[0]?.status).toBe("applied");
		expect(replay).toEqual({
			nextCursor: "1",
			results: [{ ...first?.results[0], status: "replayed" }],
		});
		await expect(
			fixture.store.pushMutations({
				...fixture,
				mutations: [
					{
						...request,
						record: {
							...request.record,
							ciphertext: Buffer.alloc(32, 9).toString("base64url"),
						},
					},
				],
			}),
		).rejects.toBeInstanceOf(SyncMutationIdReusedError);
		expect(
			await fixture.store.pullChanges({
				...fixture,
				afterCursor: "0",
				limit: 100,
			}),
		).toMatchObject({ nextCursor: "1", changes: [{ record: request.record }] });
	});

	it("rolls back earlier writes in a batch when a later revision conflicts", async () => {
		const fixture = await seedVault();
		const existing = mutation(fixture.vaultId);
		await fixture.store.pushMutations({ ...fixture, mutations: [existing] });
		const newRecord = mutation(fixture.vaultId);
		await expect(
			fixture.store.pushMutations({
				...fixture,
				mutations: [
					newRecord,
					mutation(fixture.vaultId, existing.record.recordId),
				],
			}),
		).rejects.toBeInstanceOf(SyncRevisionConflictError);
		const page = await fixture.store.pullChanges({
			...fixture,
			afterCursor: "0",
			limit: 100,
		});
		expect(page?.changes).toHaveLength(1);
		expect(page?.nextCursor).toBe("1");
		// The rolled-back mutation ID can subsequently be applied normally.
		expect(
			await fixture.store.pushMutations({ ...fixture, mutations: [newRecord] }),
		).toMatchObject({ nextCursor: "2", results: [{ status: "applied" }] });
	});

	// Hold a real row lock until BOTH independent connections are waiting for it.
	// Promise.all alone could accidentally exercise sequential writes only.
	const contend = async <T>(
		vaultId: string,
		operations: (() => Promise<T>)[],
	) => {
		const blocker = await pool.connect();
		let pending: Promise<PromiseSettledResult<T>[]> | undefined;
		try {
			await blocker.query("begin");
			await blocker.query(
				'select id from "sync_vault" where id = $1 for update',
				[vaultId],
			);
			pending = Promise.allSettled(operations.map((operation) => operation()));
			const deadline = Date.now() + 5_000;
			while (true) {
				const waiting = await admin.query(
					`select count(*)::int as count from pg_catalog.pg_stat_activity
					 where datname = current_database() and application_name = $1
					 and wait_event_type = 'Lock'`,
					[applicationName],
				);
				if (waiting.rows[0]?.count === operations.length) break;
				if (Date.now() >= deadline) {
					throw new Error(
						"Concurrent writers did not both wait for the row lock",
					);
				}
				await new Promise((resolve) => setTimeout(resolve, 20));
			}
			await blocker.query("commit");
			return await pending;
		} finally {
			await blocker.query("rollback");
			blocker.release();
			await pending;
		}
	};

	it("serializes actual concurrent revision writes with exactly one winner", async () => {
		const fixture = await seedVault();
		const initial = mutation(fixture.vaultId);
		await fixture.store.pushMutations({ ...fixture, mutations: [initial] });
		const requests = [
			mutation(fixture.vaultId, initial.record.recordId, 1),
			mutation(fixture.vaultId, initial.record.recordId, 1),
		];
		const results = await contend(
			fixture.vaultId,
			requests.map(
				(request) => () =>
					fixture.store.pushMutations({ ...fixture, mutations: [request] }),
			),
		);
		expect(
			results.filter((result) => result.status === "fulfilled"),
		).toHaveLength(1);
		const failure = results.find((result) => result.status === "rejected");
		expect(failure?.reason).toBeInstanceOf(SyncRevisionConflictError);
		expect(failure?.reason.currentRevision).toBe("2");
		const page = await fixture.store.pullChanges({
			...fixture,
			afterCursor: "1",
			limit: 100,
		});
		expect(page).toMatchObject({
			nextCursor: "2",
			changes: [{ cursor: "2", record: { revision: "2" } }],
		});
		const mutations = await pool.query(
			'select count(*)::int as count from "sync_mutation" where vault_id = $1',
			[fixture.vaultId],
		);
		expect(mutations.rows[0]?.count).toBe(2);
	}, 20_000);

	it("serializes simultaneous identical mutations into one write and one replay", async () => {
		const fixture = await seedVault();
		const request = mutation(fixture.vaultId);
		const push = () =>
			fixture.store.pushMutations({ ...fixture, mutations: [request] });
		const results = await contend(fixture.vaultId, [push, push]);
		expect(results.every((result) => result.status === "fulfilled")).toBe(true);
		const responses = results.flatMap((result) =>
			result.status === "fulfilled" ? [result.value] : [],
		);
		expect(
			responses.map((response) => response?.results[0]?.status).sort(),
		).toEqual(["applied", "replayed"]);
		expect(responses.map((response) => response?.nextCursor)).toEqual([
			"1",
			"1",
		]);
	}, 20_000);
});
