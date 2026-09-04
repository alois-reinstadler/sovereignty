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
});
