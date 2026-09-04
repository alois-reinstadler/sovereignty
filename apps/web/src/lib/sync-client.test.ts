import {
	ENCRYPTED_RECORD_FORMAT_V2,
	type EncryptedRecordEnvelopeV2,
	parseDecimalBigInt,
	SYNC_PROTOCOL_VERSION,
	type SyncMutationRequest,
	VAULT_KEY_FORMAT_V2,
	type VaultKeyEnvelopeV2,
} from "@svrgn/sync-protocol";
import { describe, expect, it, vi } from "vitest";
import type { UnlockedVault, VaultDocument, VaultItem } from "./models";
import {
	enableEncryptedSync,
	inspectSyncConflicts,
	resolveSyncConflict,
	SyncClientError,
	type SyncHttpClient,
	syncNow,
} from "./sync-client";
import type { SyncMetadata, SyncMetadataStore } from "./sync-metadata";

const USER_ID = "018f3d3e-8bb7-7cc8-8e02-3e8cad8d5b74";
const VAULT_ID = "vault-one";
const encoded = (length: number, byte = 7) =>
	Buffer.alloc(length, byte).toString("base64url");

const item = (updatedAt = "2026-01-02T00:00:00.000Z"): VaultItem => ({
	id: "record-one",
	title: "Example",
	username: "person@example.test",
	password: "secret",
	website: "https://example.test",
	notes: "",
	favorite: false,
	createdAt: "2026-01-01T00:00:00.000Z",
	updatedAt,
});

const document = (items: VaultItem[] = [item()]): VaultDocument => ({
	version: 1,
	id: VAULT_ID,
	items,
	createdAt: "2026-01-01T00:00:00.000Z",
	updatedAt: "2026-01-02T00:00:00.000Z",
});

const record = (revision = "1", byte = 4): EncryptedRecordEnvelopeV2 => ({
	format: ENCRYPTED_RECORD_FORMAT_V2,
	version: SYNC_PROTOCOL_VERSION,
	vaultId: VAULT_ID,
	recordId: "record-one",
	revision: parseDecimalBigInt(revision),
	nonce: encoded(24, byte),
	ciphertext: encoded(32, byte),
});

const keyEnvelope = (): VaultKeyEnvelopeV2 => ({
	format: VAULT_KEY_FORMAT_V2,
	version: SYNC_PROTOCOL_VERSION,
	vaultId: VAULT_ID,
	keyRevision: parseDecimalBigInt("1"),
	kdf: {
		algorithm: "argon2id13",
		salt: encoded(16),
		operationsLimit: 2,
		memoryLimit: 65536,
	},
	wrappedVaultKey: {
		algorithm: "xchacha20-poly1305-ietf",
		nonce: encoded(24),
		ciphertext: encoded(48),
	},
	createdAt: "2026-01-01T00:00:00.000Z",
});

const memoryStore = (initial: SyncMetadata | null = null) => {
	let state = initial;
	const store: SyncMetadataStore = {
		load: vi.fn(async () => state),
		save: vi.fn(async (_owner, metadata) => {
			state = structuredClone(metadata);
		}),
		remove: vi.fn(async () => {
			state = null;
		}),
	};
	return { store, current: () => state };
};

const fakeVault = (initial = document()): UnlockedVault => ({
	document: initial,
	seal: vi.fn(async () => undefined),
	close: vi.fn(async () => undefined),
	prepareInitialSync: vi.fn(async () => ({
		session: { vaultKey: new Uint8Array(32), document: initial },
		keyEnvelope: keyEnvelope(),
		records: initial.items.map(() => record()),
	})),
	encryptLoginForSync: vi.fn(async (_item, revision) => record(revision)),
	encryptTombstoneForSync: vi.fn(async (_id, _deletedAt, revision) =>
		record(revision),
	),
	decryptSyncRecord: vi.fn(async () => ({
		schemaVersion: 1 as const,
		kind: "login" as const,
		item: item("2026-01-03T00:00:00.000Z"),
	})),
});

const httpClient = (): SyncHttpClient => ({
	getVault: vi.fn(async () => null),
	createVault: vi.fn(async (envelope) => ({
		keyEnvelope: envelope,
		status: "created" as const,
	})),
	pull: vi.fn(async (_vaultId, cursor) => ({
		changes: [],
		nextCursor: cursor as never,
		hasMore: false,
	})),
	push: vi.fn(async () => undefined),
});

describe("encrypted sync client", () => {
	it("persists ciphertext before upload and retries the identical mutation", async () => {
		const memory = memoryStore();
		const vault = fakeVault();
		const http = httpClient();
		vi.mocked(http.push).mockRejectedValueOnce(new Error("offline"));

		await expect(
			enableEncryptedSync({
				ownerUserId: USER_ID,
				vault,
				document: document(),
				masterPassword: "correct horse battery staple",
				store: memory.store,
				http,
			}),
		).rejects.toThrow("offline");
		const queued = structuredClone(
			memory.current()?.outbox[0]?.mutation,
		) as SyncMutationRequest;
		expect(queued.record.ciphertext).toBe(record().ciphertext);
		expect(JSON.stringify(memory.current())).not.toContain(
			"correct horse battery staple",
		);

		await syncNow({
			ownerUserId: USER_ID,
			vault,
			document: document(),
			store: memory.store,
			http,
		});
		expect(http.push).toHaveBeenLastCalledWith(VAULT_ID, queued);
		expect(memory.current()?.outbox).toHaveLength(0);
	});

	it("applies a remote login only when no local change is pending", async () => {
		const metadata: SyncMetadata = {
			version: 1,
			vaultId: VAULT_ID,
			cursor: "1",
			records: {
				"record-one": {
					revision: "1",
					localUpdatedAt: item().updatedAt,
					tombstoned: false,
				},
			},
			outbox: [],
			conflicts: [],
		};
		const memory = memoryStore(metadata);
		const vault = fakeVault();
		const http = httpClient();
		vi.mocked(http.pull)
			.mockResolvedValueOnce({
				changes: [{ cursor: parseDecimalBigInt("2"), record: record("2", 8) }],
				nextCursor: parseDecimalBigInt("2"),
				hasMore: false,
			})
			.mockResolvedValueOnce({
				changes: [],
				nextCursor: parseDecimalBigInt("2"),
				hasMore: false,
			});
		const result = await syncNow({
			ownerUserId: USER_ID,
			vault,
			document: document(),
			store: memory.store,
			http,
		});
		expect(result.document.items[0]?.updatedAt).toBe(
			"2026-01-03T00:00:00.000Z",
		);
		expect(vault.seal).toHaveBeenCalled();
		expect(result.conflicts).toBe(0);
	});

	it("preserves the local outbox and encrypted remote record on conflict", async () => {
		const pendingRecord = record("2", 5);
		const pending: SyncMutationRequest = {
			mutationId: "018f3d3e-8bb7-7cc8-8e02-3e8cad8d5b75",
			baseRevision: parseDecimalBigInt("1"),
			record: pendingRecord,
		};
		const metadata: SyncMetadata = {
			version: 1,
			vaultId: VAULT_ID,
			cursor: "1",
			records: {
				"record-one": {
					revision: "1",
					localUpdatedAt: item().updatedAt,
					tombstoned: false,
				},
			},
			outbox: [
				{ mutation: pending, localUpdatedAt: "2026-01-04T00:00:00.000Z" },
			],
			conflicts: [],
		};
		const memory = memoryStore(metadata);
		const http = httpClient();
		vi.mocked(http.push).mockRejectedValue(
			new SyncClientError("stale", "revision_conflict", 409),
		);
		vi.mocked(http.pull).mockResolvedValue({
			changes: [{ cursor: parseDecimalBigInt("2"), record: record("2", 9) }],
			nextCursor: parseDecimalBigInt("2"),
			hasMore: false,
		});
		const result = await syncNow({
			ownerUserId: USER_ID,
			vault: fakeVault(),
			document: document(),
			store: memory.store,
			http,
		});
		expect(result.conflicts).toBe(1);
		expect(memory.current()?.outbox[0]?.mutation).toEqual(pending);
		expect(memory.current()?.conflicts[0]?.record.ciphertext).toBe(
			record("2", 9).ciphertext,
		);
		expect(http.push).toHaveBeenCalledOnce();
	});

	it("rewinds an invalid ahead cursor to zero before pulling", async () => {
		const memory = memoryStore({
			version: 1,
			vaultId: VAULT_ID,
			cursor: "12",
			records: {},
			outbox: [],
			conflicts: [],
		});
		const http = httpClient();
		const cursors: string[] = [];
		vi.mocked(http.pull).mockImplementation(async (_vaultId, cursor) => {
			cursors.push(cursor);
			if (cursor === "12") {
				throw new SyncClientError("reset", "cursor_reset_required", 409, {
					resetCursor: "0",
				});
			}
			return {
				changes: [],
				nextCursor: parseDecimalBigInt("5", { allowZero: true }),
				hasMore: false,
			};
		});
		await syncNow({
			ownerUserId: USER_ID,
			vault: fakeVault(document([])),
			document: document([]),
			store: memory.store,
			http,
		});
		expect(cursors).toEqual(["12", "0", "5"]);
		expect(memory.current()?.cursor).toBe("5");
	});

	it("inspects a conflict in memory and queues local ciphertext on the remote revision", async () => {
		const local = { ...item("2026-01-04T00:00:00.000Z"), title: "Local login" };
		const remote = {
			...item("2026-01-03T00:00:00.000Z"),
			title: "Remote login",
			password: "remote-secret",
		};
		const pending: SyncMutationRequest = {
			mutationId: "018f3d3e-8bb7-7cc8-8e02-3e8cad8d5b75",
			baseRevision: parseDecimalBigInt("1"),
			record: record("2", 5),
		};
		const memory = memoryStore({
			version: 1,
			vaultId: VAULT_ID,
			cursor: "2",
			records: {
				"record-one": {
					revision: "1",
					localUpdatedAt: item().updatedAt,
					tombstoned: false,
				},
			},
			outbox: [{ mutation: pending, localUpdatedAt: local.updatedAt }],
			conflicts: [
				{ record: record("2", 9), detectedAt: "2026-01-05T00:00:00.000Z" },
			],
		});
		const vault = fakeVault(document([local]));
		vi.mocked(vault.decryptSyncRecord).mockResolvedValue({
			schemaVersion: 1,
			kind: "login",
			item: remote,
		});
		const summaries = await inspectSyncConflicts({
			ownerUserId: USER_ID,
			vault,
			document: document([local]),
			store: memory.store,
		});
		expect(summaries).toEqual([
			expect.objectContaining({
				localLabel: "Local login",
				remoteLabel: "Remote login",
				remoteRevision: "2",
			}),
		]);

		const result = await resolveSyncConflict({
			ownerUserId: USER_ID,
			vault,
			document: document([local]),
			recordId: "record-one",
			remoteRevision: "2",
			resolution: "keep-local",
			store: memory.store,
		});
		expect(result.document.items).toEqual([local]);
		expect(result.queued).toBe(true);
		expect(vault.seal).not.toHaveBeenCalled();
		expect(memory.current()?.conflicts).toHaveLength(0);
		expect(memory.current()?.outbox).toHaveLength(1);
		expect(memory.current()?.outbox[0]?.mutation).toMatchObject({
			baseRevision: "2",
			record: { revision: "3", recordId: "record-one" },
		});
		expect(JSON.stringify(memory.current())).not.toContain("remote-secret");
	});

	it("uses the authenticated remote login and removes pending local ciphertext", async () => {
		const local = { ...item("2026-01-04T00:00:00.000Z"), title: "Local login" };
		const remote = {
			...item("2026-01-05T00:00:00.000Z"),
			title: "Remote login",
		};
		const pending: SyncMutationRequest = {
			mutationId: "018f3d3e-8bb7-7cc8-8e02-3e8cad8d5b75",
			baseRevision: parseDecimalBigInt("1"),
			record: record("2", 5),
		};
		const memory = memoryStore({
			version: 1,
			vaultId: VAULT_ID,
			cursor: "2",
			records: {},
			outbox: [{ mutation: pending, localUpdatedAt: local.updatedAt }],
			conflicts: [
				{ record: record("2", 9), detectedAt: "2026-01-05T00:00:00.000Z" },
			],
		});
		const vault = fakeVault(document([local]));
		vi.mocked(vault.decryptSyncRecord).mockResolvedValue({
			schemaVersion: 1,
			kind: "login",
			item: remote,
		});
		const result = await resolveSyncConflict({
			ownerUserId: USER_ID,
			vault,
			document: document([local]),
			recordId: "record-one",
			remoteRevision: "2",
			resolution: "use-remote",
			store: memory.store,
		});
		expect(result.document.items).toEqual([remote]);
		expect(result.queued).toBe(false);
		expect(vault.seal).toHaveBeenCalledWith(result.document);
		expect(memory.current()?.outbox).toHaveLength(0);
		expect(memory.current()?.conflicts).toHaveLength(0);
		expect(memory.current()?.records["record-one"]).toEqual({
			revision: "2",
			localUpdatedAt: remote.updatedAt,
			tombstoned: false,
		});
	});

	it("accepts an authenticated remote tombstone only after sealing the deletion", async () => {
		const local = { ...item(), title: "Delete me" };
		const memory = memoryStore({
			version: 1,
			vaultId: VAULT_ID,
			cursor: "2",
			records: {},
			outbox: [],
			conflicts: [
				{ record: record("2", 10), detectedAt: "2026-01-05T00:00:00.000Z" },
			],
		});
		const vault = fakeVault(document([local]));
		vi.mocked(vault.decryptSyncRecord).mockResolvedValue({
			schemaVersion: 1,
			kind: "tombstone",
			deletedAt: "2026-01-06T00:00:00.000Z",
		});
		const summary = await inspectSyncConflicts({
			ownerUserId: USER_ID,
			vault,
			document: document([local]),
			store: memory.store,
		});
		expect(summary[0]).toMatchObject({
			localLabel: "Delete me",
			remoteKind: "tombstone",
			remoteLabel: "Deleted on another device",
		});
		const result = await resolveSyncConflict({
			ownerUserId: USER_ID,
			vault,
			document: document([local]),
			recordId: "record-one",
			remoteRevision: "2",
			resolution: "use-remote",
			store: memory.store,
		});
		expect(result.document.items).toEqual([]);
		expect(result.document.updatedAt).toBe("2026-01-06T00:00:00.000Z");
		expect(memory.current()?.records["record-one"]?.tombstoned).toBe(true);
		expect(vi.mocked(vault.seal).mock.invocationCallOrder[0]).toBeLessThan(
			vi.mocked(memory.store.save).mock.invocationCallOrder[0] ?? 0,
		);
	});

	it("shows only the highest remote revision and rejects stale resolution", async () => {
		const local = { ...item(), title: "Local login" };
		const memory = memoryStore({
			version: 1,
			vaultId: VAULT_ID,
			cursor: "10",
			records: {
				"record-one": {
					revision: "8",
					localUpdatedAt: local.updatedAt,
					tombstoned: false,
				},
			},
			outbox: [],
			conflicts: [
				{ record: record("10", 12), detectedAt: "2026-01-06T00:00:00.000Z" },
				{ record: record("9", 11), detectedAt: "2026-01-05T00:00:00.000Z" },
			],
		});
		const vault = fakeVault(document([local]));
		vi.mocked(vault.decryptSyncRecord).mockImplementation(async (envelope) => ({
			schemaVersion: 1,
			kind: "login",
			item: {
				...item("2026-01-06T00:00:00.000Z"),
				title: `Remote revision ${envelope.revision}`,
			},
		}));
		const summaries = await inspectSyncConflicts({
			ownerUserId: USER_ID,
			vault,
			document: document([local]),
			store: memory.store,
		});
		expect(summaries).toHaveLength(1);
		expect(summaries[0]).toMatchObject({
			remoteRevision: "10",
			remoteLabel: "Remote revision 10",
		});

		await expect(
			resolveSyncConflict({
				ownerUserId: USER_ID,
				vault,
				document: document([local]),
				recordId: "record-one",
				remoteRevision: "9",
				resolution: "keep-local",
				store: memory.store,
			}),
		).rejects.toMatchObject({ code: "stale_conflict" });
		expect(memory.current()?.conflicts).toHaveLength(2);

		await resolveSyncConflict({
			ownerUserId: USER_ID,
			vault,
			document: document([local]),
			recordId: "record-one",
			remoteRevision: "10",
			resolution: "keep-local",
			store: memory.store,
		});
		expect(memory.current()?.conflicts).toHaveLength(0);
		expect(memory.current()?.outbox[0]?.mutation).toMatchObject({
			baseRevision: "10",
			record: { revision: "11" },
		});
	});

	it("rolls the local vault back when remote resolution metadata cannot commit", async () => {
		const localDocument = document([
			{ ...item(), title: "Preserved local login" },
		]);
		const initial: SyncMetadata = {
			version: 1,
			vaultId: VAULT_ID,
			cursor: "2",
			records: {},
			outbox: [],
			conflicts: [
				{ record: record("2", 11), detectedAt: "2026-01-05T00:00:00.000Z" },
			],
		};
		const store: SyncMetadataStore = {
			load: vi.fn(async () => initial),
			save: vi.fn(async () => {
				throw new Error("IndexedDB commit failed");
			}),
			remove: vi.fn(async () => undefined),
		};
		const vault = fakeVault(localDocument);
		vi.mocked(vault.decryptSyncRecord).mockResolvedValue({
			schemaVersion: 1,
			kind: "login",
			item: { ...item("2026-01-06T00:00:00.000Z"), title: "Remote login" },
		});
		await expect(
			resolveSyncConflict({
				ownerUserId: USER_ID,
				vault,
				document: localDocument,
				recordId: "record-one",
				remoteRevision: "2",
				resolution: "use-remote",
				store,
			}),
		).rejects.toThrow("IndexedDB commit failed");
		expect(vault.seal).toHaveBeenCalledTimes(2);
		expect(vault.seal).toHaveBeenLastCalledWith(localDocument);
		expect(initial.conflicts).toHaveLength(1);
	});
});
