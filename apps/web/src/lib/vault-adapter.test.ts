import type {
	EncryptedVaultEnvelope,
	VaultDocument,
	VaultSession,
} from "@svrgn/vault-core";
import { describe, expect, it, vi } from "vitest";

import { makeUnlockedVault } from "./vault-adapter";

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
});
