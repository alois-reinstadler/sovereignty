import type {
	CreatedVault,
	EncryptedVaultEnvelope,
	VaultDocument,
	VaultSession,
} from "@svrgn/vault-core";
import { createVault } from "@svrgn/vault-core";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

import {
	exportLocalVaultBackup,
	hasStoredVault,
	importLocalVaultBackup,
	type LocalVaultStorage,
	LocalVaultStorageError,
	makeUnlockedVault,
	persistCreatedVault,
	saveLocalVault,
	unlockLocalVault,
	VAULT_BACKUP_MAX_BYTES,
	VAULT_STORAGE_KEY,
} from "./vault-adapter";

const timestamp = "2026-09-03T12:00:00.000Z";

const makeDocument = (updatedAt: string): VaultDocument => ({
	version: 1,
	id: "vault-test",
	items: [],
	createdAt: timestamp,
	updatedAt,
});

const makeEnvelope = (updatedAt: string): EncryptedVaultEnvelope => ({
	format: "svrgn-encrypted-vault",
	version: 1,
	id: "vault-test",
	kdf: {
		algorithm: "argon2id13",
		salt: "salt",
		operationsLimit: 1,
		memoryLimit: 1,
	},
	wrappedVaultKey: {
		algorithm: "xchacha20-poly1305-ietf",
		nonce: "nonce",
		ciphertext: "wrapped-key",
	},
	encryptedDocument: {
		algorithm: "xchacha20-poly1305-ietf",
		nonce: "nonce",
		ciphertext: `document-${updatedAt}`,
	},
	createdAt: timestamp,
	updatedAt,
});

const deferred = <A>() => {
	let resolve!: (value: A) => void;
	let reject!: (cause: unknown) => void;
	const promise = new Promise<A>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, reject, resolve };
};

describe("unlocked vault lifecycle", () => {
	it("serializes saves and waits for them before destroying the key", async () => {
		const firstDocument = makeDocument("2026-09-03T12:01:00.000Z");
		const secondDocument = makeDocument("2026-09-03T12:02:00.000Z");
		const initialEnvelope = makeEnvelope(timestamp);
		const firstEnvelope = makeEnvelope(firstDocument.updatedAt);
		const secondEnvelope = makeEnvelope(secondDocument.updatedAt);
		const firstSeal = deferred<EncryptedVaultEnvelope>();
		const secondSeal = deferred<EncryptedVaultEnvelope>();
		const stored: Array<EncryptedVaultEnvelope> = [];
		const destroyed: Array<VaultSession> = [];
		const seal = vi
			.fn()
			.mockImplementationOnce(() => firstSeal.promise)
			.mockImplementationOnce(() => secondSeal.promise);
		const session: VaultSession = {
			vaultKey: new Uint8Array([11, 22, 33]),
			document: makeDocument(timestamp),
		};
		const vault = makeUnlockedVault(session, initialEnvelope, {
			seal,
			store: (envelope) => stored.push(envelope),
			destroy: (current) => {
				destroyed.push(current);
				current.vaultKey.fill(0);
			},
		});

		const firstSave = vault.seal(firstDocument);
		const secondSave = vault.seal(secondDocument);
		await vi.waitFor(() => expect(seal).toHaveBeenCalledTimes(1));

		const close = vault.close();
		await expect(vault.seal(makeDocument(timestamp))).rejects.toThrow(
			"The vault session is closing.",
		);
		expect(destroyed).toHaveLength(0);

		firstSeal.resolve(firstEnvelope);
		await firstSave;
		await vi.waitFor(() => expect(seal).toHaveBeenCalledTimes(2));
		expect(seal.mock.calls[1]?.[1]).toBe(firstEnvelope);
		expect(destroyed).toHaveLength(0);

		secondSeal.resolve(secondEnvelope);
		await Promise.all([secondSave, close]);

		expect(stored).toEqual([firstEnvelope, secondEnvelope]);
		expect(destroyed).toHaveLength(1);
		expect(destroyed[0]?.document).toBe(secondDocument);
		expect(session.vaultKey).toEqual(new Uint8Array([0, 0, 0]));
	});

	it("continues with the last stored envelope after a failed save", async () => {
		const initialEnvelope = makeEnvelope(timestamp);
		const recoveredEnvelope = makeEnvelope("2026-09-03T12:02:00.000Z");
		const failure = new Error("storage unavailable");
		const seal = vi
			.fn()
			.mockRejectedValueOnce(failure)
			.mockResolvedValueOnce(recoveredEnvelope);
		const store = vi.fn();
		const destroy = vi.fn();
		const vault = makeUnlockedVault(
			{
				vaultKey: new Uint8Array([1]),
				document: makeDocument(timestamp),
			},
			initialEnvelope,
			{ seal, store, destroy },
		);

		const failedSave = vault.seal(makeDocument("2026-09-03T12:01:00.000Z"));
		const recoveredSave = vault.seal(makeDocument("2026-09-03T12:02:00.000Z"));

		await expect(failedSave).rejects.toBe(failure);
		await expect(recoveredSave).resolves.toBeUndefined();
		expect(seal.mock.calls[1]?.[1]).toBe(initialEnvelope);
		expect(store).toHaveBeenCalledOnce();

		await expect(vault.close()).resolves.toBeUndefined();
		expect(destroy).toHaveBeenCalledOnce();
	});

	it("does not advance its envelope when persistent storage fails", async () => {
		const initialEnvelope = makeEnvelope(timestamp);
		const unstoredEnvelope = makeEnvelope("2026-09-03T12:01:00.000Z");
		const recoveredEnvelope = makeEnvelope("2026-09-03T12:02:00.000Z");
		const seal = vi
			.fn()
			.mockResolvedValueOnce(unstoredEnvelope)
			.mockResolvedValueOnce(recoveredEnvelope);
		const store = vi
			.fn()
			.mockImplementationOnce(() => {
				throw new Error("quota exceeded");
			})
			.mockImplementationOnce(() => undefined);
		const vault = makeUnlockedVault(
			{
				vaultKey: new Uint8Array([1]),
				document: makeDocument(timestamp),
			},
			initialEnvelope,
			{ seal, store, destroy: vi.fn() },
		);

		await expect(
			vault.seal(makeDocument("2026-09-03T12:01:00.000Z")),
		).rejects.toThrow("quota exceeded");
		await expect(
			vault.seal(makeDocument("2026-09-03T12:02:00.000Z")),
		).resolves.toBeUndefined();

		expect(seal.mock.calls[1]?.[1]).toBe(initialEnvelope);
		expect(store).toHaveBeenCalledTimes(2);
	});

	it("waits for a failed save before closing the last durable session", async () => {
		const initialDocument = makeDocument(timestamp);
		const nextDocument = makeDocument("2026-09-03T12:01:00.000Z");
		const initialSession: VaultSession = {
			vaultKey: new Uint8Array([9, 8, 7]),
			document: initialDocument,
		};
		const sealResult = deferred<EncryptedVaultEnvelope>();
		const destroyed: Array<VaultSession> = [];
		const vault = makeUnlockedVault(initialSession, makeEnvelope(timestamp), {
			seal: () => sealResult.promise,
			store: vi.fn(),
			destroy: (session) => {
				destroyed.push(session);
				session.vaultKey.fill(0);
			},
		});

		const save = vault.seal(nextDocument);
		const close = vault.close();
		expect(destroyed).toHaveLength(0);

		sealResult.reject(new Error("storage unavailable"));
		await expect(save).rejects.toThrow("storage unavailable");
		await expect(close).resolves.toBeUndefined();

		expect(destroyed).toHaveLength(1);
		expect(destroyed[0]?.document).toBe(initialDocument);
		expect(initialSession.vaultKey).toEqual(new Uint8Array([0, 0, 0]));
	});
});

describe("browser vault storage", () => {
	const storage = (
		getItem: LocalVaultStorage["getItem"],
		setItem: LocalVaultStorage["setItem"] = vi.fn(),
	): LocalVaultStorage => ({ getItem, setItem });

	it("reports blocked browser storage as a recoverable read error", () => {
		const blocked = storage(() => {
			throw new DOMException("Access denied", "SecurityError");
		});

		expect(() => hasStoredVault(blocked)).toThrowError(
			expect.objectContaining({
				name: "LocalVaultStorageError",
				operation: "read",
			}),
		);
	});

	it("reports a corrupt envelope without changing it", () => {
		const getItem = vi.fn(() => "{not-json");
		const setItem = vi.fn();

		expect(() => hasStoredVault(storage(getItem, setItem))).toThrowError(
			expect.objectContaining({
				name: "LocalVaultStorageError",
				operation: "parse",
			}),
		);
		expect(setItem).not.toHaveBeenCalled();
		expect(getItem).toHaveBeenCalledOnce();
	});

	it("destroys a newly created session when quota prevents its first save", () => {
		const session: VaultSession = {
			vaultKey: new Uint8Array([3, 2, 1]),
			document: makeDocument(timestamp),
		};
		const created: CreatedVault = {
			session,
			envelope: makeEnvelope(timestamp),
		};
		const quotaLimited = storage(
			vi.fn(() => null),
			vi.fn(() => {
				throw new DOMException("Quota exceeded", "QuotaExceededError");
			}),
		);

		expect(() => persistCreatedVault(created, quotaLimited)).toThrowError(
			LocalVaultStorageError,
		);
		expect(session.vaultKey).toEqual(new Uint8Array([0, 0, 0]));
	});
});

describe("encrypted vault backup", () => {
	const memoryStorage = (initial: string | null = null) => {
		let value = initial;
		const adapter: LocalVaultStorage = {
			getItem: vi.fn((key: string) =>
				key === VAULT_STORAGE_KEY ? value : null,
			),
			setItem: vi.fn((key: string, next: string) => {
				if (key === VAULT_STORAGE_KEY) value = next;
			}),
		};
		return { adapter, read: () => value };
	};

	it("exports ciphertext without vault plaintext and round-trips through unlock", async () => {
		const password = "correct horse battery staple";
		const source = memoryStorage();
		const created = await Effect.runPromise(
			createVault(password, {
				id: "Vault / Unsafe ID",
				now: timestamp,
			}),
		);
		const sourceVault = persistCreatedVault(created, source.adapter);
		const secretDocument: VaultDocument = {
			...sourceVault.document,
			updatedAt: "2026-09-03T12:03:00.000Z",
			items: [
				{
					id: "login-1",
					title: "Plaintext marker title",
					username: "private@example.test",
					password: "never-export-this-secret",
					website: "https://example.test",
					notes: "plaintext marker notes",
					favorite: true,
					createdAt: timestamp,
					updatedAt: "2026-09-03T12:03:00.000Z",
				},
			],
		};
		await saveLocalVault(sourceVault, secretDocument);

		const backup = exportLocalVaultBackup(source.adapter);
		expect(backup.serialized).toBe(source.read());
		expect(backup.filename).toBe(
			"svrgn-vault-vault-unsafe-id-2026-09-03T12-03-00Z.svrgn",
		);
		expect(backup.serialized).toContain('"format":"svrgn-encrypted-vault"');
		for (const plaintext of [
			"Plaintext marker title",
			"private@example.test",
			"never-export-this-secret",
			"plaintext marker notes",
		]) {
			expect(backup.serialized).not.toContain(plaintext);
		}

		const restored = memoryStorage();
		importLocalVaultBackup(backup.serialized, { storage: restored.adapter });
		const unlocked = await unlockLocalVault(password, restored.adapter);
		expect(unlocked.document).toEqual(secretDocument);
		await Promise.all([sourceVault.close(), unlocked.close()]);
	});

	it.each([
		["invalid JSON", "{not-json"],
		[
			"wrong format",
			JSON.stringify({ ...makeEnvelope(timestamp), format: "not-svrgn" }),
		],
		[
			"unsupported version",
			JSON.stringify({ ...makeEnvelope(timestamp), version: 2 }),
		],
	])("rejects %s without changing existing data", (_case, incoming) => {
		const existing = JSON.stringify(makeEnvelope(timestamp));
		const target = memoryStorage(existing);
		expect(() =>
			importLocalVaultBackup(incoming, {
				overwriteExisting: true,
				storage: target.adapter,
			}),
		).toThrow("not a supported Svrgn encrypted vault backup");
		expect(target.read()).toBe(existing);
		expect(target.adapter.setItem).not.toHaveBeenCalled();
	});

	it("rejects an oversized backup without changing existing data", () => {
		const existing = JSON.stringify(makeEnvelope(timestamp));
		const target = memoryStorage(existing);
		expect(() =>
			importLocalVaultBackup("x".repeat(VAULT_BACKUP_MAX_BYTES + 1), {
				overwriteExisting: true,
				storage: target.adapter,
			}),
		).toThrow("larger than 10 MB");
		expect(target.read()).toBe(existing);
		expect(target.adapter.setItem).not.toHaveBeenCalled();
	});

	it("requires explicit overwrite confirmation and preserves data on cancel", () => {
		const existing = JSON.stringify(makeEnvelope(timestamp));
		const incoming = JSON.stringify(makeEnvelope("2026-09-03T12:04:00.000Z"));
		const target = memoryStorage(existing);

		expect(() =>
			importLocalVaultBackup(incoming, { storage: target.adapter }),
		).toThrow("Import cancelled");
		expect(target.read()).toBe(existing);
		expect(target.adapter.setItem).not.toHaveBeenCalled();

		expect(
			importLocalVaultBackup(incoming, {
				overwriteExisting: true,
				storage: target.adapter,
			}),
		).toEqual(makeEnvelope("2026-09-03T12:04:00.000Z"));
		expect(target.read()).toBe(incoming);
	});
});
