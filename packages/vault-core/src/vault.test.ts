import { Effect } from "effect";
import sodium from "libsodium-wrappers-sumo";
import { describe, expect, it } from "vitest";
import {
	addVaultItem,
	createVaultItem,
	generatePassword,
	removeVaultItem,
	searchVaultItems,
	updateVaultItem,
} from "./operations";
import {
	createVault,
	parseEncryptedVault,
	sealVault,
	serializeEncryptedVault,
	unlockVault,
} from "./vault";

const CREATED_AT = "2026-09-02T12:00:00.000Z";
const UPDATED_AT = "2026-09-02T12:05:00.000Z";

const deterministicBytes = () => {
	let call = 0;
	return (length: number): Uint8Array => {
		call += 1;
		return Uint8Array.from(
			{ length },
			(_, index) => (call * 29 + index * 17) & 0xff,
		);
	};
};

const makeVault = async () => {
	await sodium.ready;
	return Effect.runPromise(
		createVault("correct horse battery staple", {
			id: "vault-test",
			now: CREATED_AT,
			randomBytes: deterministicBytes(),
			kdf: {
				operationsLimit: sodium.crypto_pwhash_OPSLIMIT_MIN,
				memoryLimit: sodium.crypto_pwhash_MEMLIMIT_MIN,
			},
		}),
	);
};

describe("encrypted vault", () => {
	it("round-trips a newly created vault", async () => {
		const created = await makeVault();
		const unlocked = await Effect.runPromise(
			unlockVault(created.envelope, "correct horse battery staple"),
		);

		expect(unlocked.document).toEqual(created.session.document);
		expect(unlocked.vaultKey).toEqual(created.session.vaultKey);
		expect(created.envelope).not.toHaveProperty("masterPassword");
		expect(created.envelope.wrappedVaultKey.nonce).not.toBe(
			created.envelope.encryptedDocument.nonce,
		);
		expect(serializeEncryptedVault(created.envelope)).not.toContain(
			"correct horse battery staple",
		);
	});

	it("rejects a wrong password and tampered ciphertext", async () => {
		const created = await makeVault();
		const wrongPasswordError = await Effect.runPromise(
			Effect.flip(unlockVault(created.envelope, "wrong password")),
		);
		expect(wrongPasswordError).toMatchObject({
			_tag: "VaultAuthenticationError",
		});

		const ciphertext = created.envelope.encryptedDocument.ciphertext;
		const replacement = ciphertext.endsWith("A") ? "B" : "A";
		const tampered = {
			...created.envelope,
			encryptedDocument: {
				...created.envelope.encryptedDocument,
				ciphertext: `${ciphertext.slice(0, -1)}${replacement}`,
			},
		};
		const tamperingError = await Effect.runPromise(
			Effect.flip(unlockVault(tampered, "correct horse battery staple")),
		);
		expect(tamperingError).toMatchObject({ _tag: "VaultAuthenticationError" });
	});

	it("reseals changes and survives serialized persistence", async () => {
		const created = await makeVault();
		const item = createVaultItem(
			{ title: "Example", username: "person@example.com", password: "secret" },
			{ id: "item-one", now: CREATED_AT },
		);
		const session = {
			...created.session,
			document: addVaultItem(created.session.document, item, UPDATED_AT),
		};
		const sealed = await Effect.runPromise(
			sealVault(session, created.envelope),
		);
		const persisted = parseEncryptedVault(serializeEncryptedVault(sealed));
		const reopened = await Effect.runPromise(
			unlockVault(persisted, "correct horse battery staple"),
		);

		expect(reopened.document.items).toEqual([item]);
		expect(reopened.document.updatedAt).toBe(UPDATED_AT);
		expect(sealed.encryptedDocument.nonce).not.toBe(
			created.envelope.encryptedDocument.nonce,
		);
	});
});

describe("vault item operations", () => {
	it("creates, updates, searches, and removes without mutating earlier documents", async () => {
		const created = await makeVault();
		const alpha = createVaultItem(
			{
				title: "Alpha Bank",
				username: "alex",
				website: "https://bank.example",
				favorite: true,
			},
			{ id: "alpha", now: CREATED_AT },
		);
		const bravo = createVaultItem(
			{ title: "Bravo", notes: "work account" },
			{ id: "bravo", now: CREATED_AT },
		);
		const first = addVaultItem(created.session.document, bravo, CREATED_AT);
		const second = addVaultItem(first, alpha, CREATED_AT);
		const updated = updateVaultItem(
			second,
			"bravo",
			{ username: "team" },
			UPDATED_AT,
		);

		expect(first.items).toEqual([bravo]);
		expect(searchVaultItems(updated, "BANK").map(({ id }) => id)).toEqual([
			"alpha",
		]);
		expect(searchVaultItems(updated, "account").map(({ id }) => id)).toEqual([
			"bravo",
		]);
		expect(searchVaultItems(updated, "").map(({ id }) => id)).toEqual([
			"alpha",
			"bravo",
		]);
		expect(
			removeVaultItem(updated, "alpha", UPDATED_AT).items.map(({ id }) => id),
		).toEqual(["bravo"]);
		expect(() => removeVaultItem(updated, "missing")).toThrowError(
			expect.objectContaining({ _tag: "VaultItemNotFoundError" }),
		);
	});
});

describe("password generator", () => {
	it("honors length and enabled character-set constraints", () => {
		let counter = 0;
		const password = generatePassword({
			length: 32,
			randomIndex: (upperBound) => counter++ % upperBound,
		});

		expect(password).toHaveLength(32);
		expect(password).toMatch(/[a-z]/);
		expect(password).toMatch(/[A-Z]/);
		expect(password).toMatch(/[0-9]/);
		expect(password).toMatch(/[^a-zA-Z0-9]/);
		expect(
			generatePassword({
				length: 12,
				uppercase: false,
				numbers: false,
				symbols: false,
				randomIndex: () => 0,
			}),
		).toBe("aaaaaaaaaaaa");
	});

	it("rejects unsafe constraints", () => {
		expect(() => generatePassword({ length: 7 })).toThrowError(
			expect.objectContaining({ _tag: "PasswordGenerationError" }),
		);
		expect(() =>
			generatePassword({
				lowercase: false,
				uppercase: false,
				numbers: false,
				symbols: false,
			}),
		).toThrowError(
			expect.objectContaining({ _tag: "PasswordGenerationError" }),
		);
	});
});
