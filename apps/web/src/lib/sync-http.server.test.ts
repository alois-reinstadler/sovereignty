import {
	ENCRYPTED_RECORD_FORMAT_V2,
	parseDecimalBigInt,
	SYNC_PROTOCOL_VERSION,
	type SyncMutationRequest,
} from "@svrgn/sync-protocol";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createSyncHttpHandlers } from "./sync-http.server";
import {
	SyncMutationIdReusedError,
	SyncRevisionConflictError,
	type SyncStore,
} from "./sync-store.server";

const VAULT_ID = "vault-one";
const USER_ID = "018f3d3e-8bb7-7cc8-8e02-3e8cad8d5b74";

const base64 = (length: number, byte = 7): string =>
	Buffer.alloc(length, byte).toString("base64url");

const mutation = (): SyncMutationRequest => ({
	mutationId: "018f3d3e-8bb7-7cc8-8e02-3e8cad8d5b75",
	baseRevision: parseDecimalBigInt("0", { allowZero: true }),
	record: {
		format: ENCRYPTED_RECORD_FORMAT_V2,
		version: SYNC_PROTOCOL_VERSION,
		vaultId: VAULT_ID,
		recordId: "record-one",
		revision: parseDecimalBigInt("1"),
		nonce: base64(24),
		ciphertext: base64(32),
	},
});

describe("sync HTTP handlers", () => {
	let store: SyncStore;

	beforeEach(() => {
		store = {
			pullChanges: vi.fn(),
			pushMutations: vi.fn(),
		};
	});

	it("rejects unauthenticated requests before touching storage", async () => {
		const handlers = createSyncHttpHandlers({
			authenticate: async () => null,
			store,
		});
		const response = await handlers.pull(
			new Request(`https://vault.test/api/sync/v2/changes?vaultId=${VAULT_ID}`),
		);

		expect(response.status).toBe(401);
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(store.pullChanges).not.toHaveBeenCalled();
	});

	it("pulls a validated page scoped to the authenticated owner", async () => {
		vi.mocked(store.pullChanges).mockResolvedValue({
			changes: [],
			nextCursor: parseDecimalBigInt("7", { allowZero: true }),
			hasMore: false,
		});
		const handlers = createSyncHttpHandlers({
			authenticate: async () => USER_ID,
			store,
		});
		const response = await handlers.pull(
			new Request(
				`https://vault.test/api/sync/v2/changes?vaultId=${VAULT_ID}&cursor=5&limit=25`,
			),
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			changes: [],
			nextCursor: "7",
			hasMore: false,
		});
		expect(store.pullChanges).toHaveBeenCalledWith({
			ownerUserId: USER_ID,
			vaultId: VAULT_ID,
			afterCursor: "5",
			limit: 25,
		});
	});

	it.each([
		"cursor=-1",
		"cursor=01",
		"limit=0",
		"limit=1001",
	])("rejects invalid paging input: %s", async (query) => {
		const handlers = createSyncHttpHandlers({
			authenticate: async () => USER_ID,
			store,
		});
		const response = await handlers.pull(
			new Request(
				`https://vault.test/api/sync/v2/changes?vaultId=${VAULT_ID}&${query}`,
			),
		);
		expect(response.status).toBe(400);
		expect(store.pullChanges).not.toHaveBeenCalled();
	});

	it("does not reveal whether a vault belongs to another account", async () => {
		vi.mocked(store.pullChanges).mockResolvedValue(null);
		const handlers = createSyncHttpHandlers({
			authenticate: async () => USER_ID,
			store,
		});
		const response = await handlers.pull(
			new Request(`https://vault.test/api/sync/v2/changes?vaultId=${VAULT_ID}`),
		);
		expect(response.status).toBe(404);
		expect(await response.json()).toMatchObject({ error: "vault_not_found" });
	});

	it("accepts an encrypted mutation batch without inspecting plaintext", async () => {
		const requestMutation = mutation();
		vi.mocked(store.pushMutations).mockResolvedValue({
			results: [
				{
					mutationId: requestMutation.mutationId,
					recordId: requestMutation.record.recordId,
					revision: requestMutation.record.revision,
					cursor: parseDecimalBigInt("1"),
					status: "applied",
				},
			],
			nextCursor: parseDecimalBigInt("1"),
		});
		const handlers = createSyncHttpHandlers({
			authenticate: async () => USER_ID,
			store,
		});
		const response = await handlers.push(
			new Request(
				`https://vault.test/api/sync/v2/mutations?vaultId=${VAULT_ID}`,
				{
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ mutations: [requestMutation] }),
				},
			),
		);

		expect(response.status).toBe(200);
		expect(store.pushMutations).toHaveBeenCalledWith({
			ownerUserId: USER_ID,
			vaultId: VAULT_ID,
			mutations: [requestMutation],
		});
	});

	it("rejects cross-vault records and oversized bodies before storage", async () => {
		const handlers = createSyncHttpHandlers({
			authenticate: async () => USER_ID,
			store,
		});
		const crossVault = mutation();
		crossVault.record = { ...crossVault.record, vaultId: "different-vault" };
		const mismatch = await handlers.push(
			new Request(
				`https://vault.test/api/sync/v2/mutations?vaultId=${VAULT_ID}`,
				{
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ mutations: [crossVault] }),
				},
			),
		);
		expect(mismatch.status).toBe(400);

		const oversized = await handlers.push(
			new Request(
				`https://vault.test/api/sync/v2/mutations?vaultId=${VAULT_ID}`,
				{
					method: "POST",
					headers: {
						"content-type": "application/json",
						"content-length": String(4 * 1024 * 1024 + 1),
					},
					body: "{}",
				},
			),
		);
		expect(oversized.status).toBe(413);
		expect(store.pushMutations).not.toHaveBeenCalled();
	});

	it("treats malformed JSON as a client error without leaking internals", async () => {
		const handlers = createSyncHttpHandlers({
			authenticate: async () => USER_ID,
			store,
		});
		const response = await handlers.push(
			new Request(
				`https://vault.test/api/sync/v2/mutations?vaultId=${VAULT_ID}`,
				{
					method: "POST",
					headers: { "content-type": "application/json" },
					body: "{",
				},
			),
		);
		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({ error: "invalid_request" });
		expect(store.pushMutations).not.toHaveBeenCalled();
	});

	it("returns stable, actionable conflict responses", async () => {
		const requestMutation = mutation();
		vi.mocked(store.pushMutations).mockRejectedValue(
			new SyncRevisionConflictError(
				requestMutation.mutationId,
				requestMutation.record.recordId,
				"0",
				"2",
			),
		);
		const handlers = createSyncHttpHandlers({
			authenticate: async () => USER_ID,
			store,
		});
		const makeRequest = () =>
			new Request(
				`https://vault.test/api/sync/v2/mutations?vaultId=${VAULT_ID}`,
				{
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ mutations: [requestMutation] }),
				},
			);
		const conflict = await handlers.push(makeRequest());
		expect(conflict.status).toBe(409);
		expect(await conflict.json()).toMatchObject({
			error: "revision_conflict",
			expectedBaseRevision: "0",
			currentRevision: "2",
		});

		vi.mocked(store.pushMutations).mockRejectedValue(
			new SyncMutationIdReusedError(requestMutation.mutationId),
		);
		const reused = await handlers.push(makeRequest());
		expect(reused.status).toBe(409);
		expect(await reused.json()).toMatchObject({ error: "mutation_id_reused" });
	});
});
