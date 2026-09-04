import {
	ENCRYPTED_RECORD_FORMAT_V2,
	parseDecimalBigInt,
	SYNC_PROTOCOL_VERSION,
	type SyncMutationRequest,
	VAULT_KEY_FORMAT_V2,
	type VaultKeyEnvelopeV2,
} from "@svrgn/sync-protocol";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createSyncHttpHandlers } from "./sync-http.server";
import {
	SyncCursorAheadError,
	SyncMutationIdReusedError,
	SyncRevisionConflictError,
	type SyncStore,
	SyncVaultAlreadyExistsError,
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

const keyEnvelope = (): VaultKeyEnvelopeV2 => ({
	format: VAULT_KEY_FORMAT_V2,
	version: SYNC_PROTOCOL_VERSION,
	vaultId: VAULT_ID,
	keyRevision: parseDecimalBigInt("1"),
	kdf: {
		algorithm: "argon2id13",
		salt: base64(16),
		operationsLimit: 2,
		memoryLimit: 65536,
	},
	wrappedVaultKey: {
		algorithm: "xchacha20-poly1305-ietf",
		nonce: base64(24),
		ciphertext: base64(48),
	},
	createdAt: "2026-01-01T00:00:00.000Z",
});

describe("sync HTTP handlers", () => {
	let store: SyncStore;

	beforeEach(() => {
		store = {
			getVault: vi.fn(),
			createVault: vi.fn(),
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

	it("creates and fetches a strictly validated owner-scoped key envelope", async () => {
		const envelope = keyEnvelope();
		vi.mocked(store.createVault).mockResolvedValue({
			keyEnvelope: envelope,
			status: "created",
		});
		vi.mocked(store.getVault).mockResolvedValue(envelope);
		const handlers = createSyncHttpHandlers({
			authenticate: async () => USER_ID,
			store,
		});
		const created = await handlers.createVault(
			new Request("https://vault.test/api/sync/v2/vault", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ keyEnvelope: envelope }),
			}),
		);
		expect(created.status).toBe(201);
		expect(store.createVault).toHaveBeenCalledWith({
			ownerUserId: USER_ID,
			keyEnvelope: envelope,
		});

		const fetched = await handlers.getVault(
			new Request("https://vault.test/api/sync/v2/vault"),
		);
		expect(fetched.status).toBe(200);
		expect(await fetched.json()).toEqual({ keyEnvelope: envelope });
	});

	it("rejects malformed bootstrap bodies before storage", async () => {
		const handlers = createSyncHttpHandlers({
			authenticate: async () => USER_ID,
			store,
		});
		const response = await handlers.createVault(
			new Request("https://vault.test/api/sync/v2/vault", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					keyEnvelope: keyEnvelope(),
					plaintext: "never",
				}),
			}),
		);
		expect(response.status).toBe(400);
		expect(store.createVault).not.toHaveBeenCalled();
	});

	it("uses the same conflict for an account vault mismatch or a vault-id collision", async () => {
		vi.mocked(store.createVault).mockRejectedValue(
			new SyncVaultAlreadyExistsError(),
		);
		const handlers = createSyncHttpHandlers({
			authenticate: async () => USER_ID,
			store,
		});
		const response = await handlers.createVault(
			new Request("https://vault.test/api/sync/v2/vault", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ keyEnvelope: keyEnvelope() }),
			}),
		);
		expect(response.status).toBe(409);
		expect(await response.json()).toMatchObject({
			error: "vault_already_exists",
		});
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

	it("returns an explicit reset signal when a client cursor is ahead", async () => {
		vi.mocked(store.pullChanges).mockRejectedValue(
			new SyncCursorAheadError("7"),
		);
		const handlers = createSyncHttpHandlers({
			authenticate: async () => USER_ID,
			store,
		});
		const response = await handlers.pull(
			new Request(
				`https://vault.test/api/sync/v2/changes?vaultId=${VAULT_ID}&cursor=12`,
			),
		);
		expect(response.status).toBe(409);
		expect(await response.json()).toMatchObject({
			error: "cursor_reset_required",
			currentCursor: "7",
			resetCursor: "0",
		});
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
