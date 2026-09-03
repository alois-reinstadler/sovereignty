import {
	decimalBigInt,
	ENCRYPTED_RECORD_FORMAT_V2,
	type EncryptedRecordEnvelopeV2,
	parseDecimalBigInt,
	SYNC_PROTOCOL_VERSION,
} from "@svrgn/sync-protocol";
import { Effect } from "effect";
import sodium from "libsodium-wrappers-sumo";
import { describe, expect, it } from "vitest";
import type { VaultItem, VaultSession } from "./model";
import {
	convertVaultV1ToV2,
	createVaultKeyEnvelopeV2,
	decryptVaultRecord,
	encryptLoginRecord,
	encryptTombstoneRecord,
	unwrapVaultKeyV2,
} from "./record-crypto";

const VAULT_ID = "018f3d3e-8bb7-7cc8-8e02-3e8cad8d5b74";
const OTHER_VAULT_ID = "018f3d3e-8bb7-7cc8-8e02-3e8cad8d5b75";
const ITEM_ID = "018f3d3e-8bb7-7cc8-8e02-3e8cad8d5b76";
const OTHER_ITEM_ID = "018f3d3e-8bb7-7cc8-8e02-3e8cad8d5b77";
const CREATED_AT = "2026-09-03T12:00:00.000Z";
const UPDATED_AT = "2026-09-03T12:05:00.000Z";

const item: VaultItem = {
	id: ITEM_ID,
	title: "Example",
	username: "person@example.com",
	password: "correct horse battery staple",
	website: "https://example.com",
	notes: "personal",
	favorite: true,
	createdAt: CREATED_AT,
	updatedAt: UPDATED_AT,
};

const fixedBytes =
	(seed: number) =>
	(length: number): Uint8Array =>
		Uint8Array.from({ length }, (_, index) => (seed + index * 17) & 0xff);

const sequentialBytes = () => {
	let call = 0;
	return (length: number): Uint8Array => {
		call += 1;
		return fixedBytes(call * 29)(length);
	};
};

const key = (): Uint8Array => fixedBytes(11)(32);

describe("independent encrypted records", () => {
	it("round-trips logins with a fresh nonce for each encryption", async () => {
		const vaultKey = key();
		const first = await Effect.runPromise(
			encryptLoginRecord(vaultKey, VAULT_ID, item, decimalBigInt(1n)),
		);
		const second = await Effect.runPromise(
			encryptLoginRecord(vaultKey, VAULT_ID, item, decimalBigInt(1n)),
		);

		expect(first.nonce).not.toBe(second.nonce);
		expect(first.ciphertext).not.toContain(item.password);
		expect(
			await Effect.runPromise(decryptVaultRecord(vaultKey, first)),
		).toEqual({
			schemaVersion: 1,
			kind: "login",
			item,
		});
	});

	it("round-trips tombstones without retaining deleted item data", async () => {
		const vaultKey = key();
		const envelope = await Effect.runPromise(
			encryptTombstoneRecord(
				vaultKey,
				VAULT_ID,
				ITEM_ID,
				UPDATED_AT,
				decimalBigInt(2n),
			),
		);
		expect(
			await Effect.runPromise(decryptVaultRecord(vaultKey, envelope)),
		).toEqual({
			schemaVersion: 1,
			kind: "tombstone",
			deletedAt: UPDATED_AT,
		});
	});

	it("fails authentication when any AAD-bound field or ciphertext is changed", async () => {
		const vaultKey = key();
		const envelope = await Effect.runPromise(
			encryptLoginRecord(vaultKey, VAULT_ID, item, decimalBigInt(1n), {
				randomBytes: fixedBytes(71),
			}),
		);
		const ciphertextReplacement = envelope.ciphertext.startsWith("A")
			? "B"
			: "A";
		const tampered: ReadonlyArray<EncryptedRecordEnvelopeV2> = [
			{ ...envelope, vaultId: OTHER_VAULT_ID },
			{ ...envelope, recordId: OTHER_ITEM_ID },
			{ ...envelope, revision: parseDecimalBigInt("2") },
			{
				...envelope,
				ciphertext: `${ciphertextReplacement}${envelope.ciphertext.slice(1)}`,
			},
		];

		for (const changed of tampered) {
			const error = await Effect.runPromise(
				Effect.flip(decryptVaultRecord(vaultKey, changed)),
			);
			expect(error).toMatchObject({ _tag: "VaultAuthenticationError" });
		}
		for (const changed of [
			{ ...envelope, format: "wrong" },
			{ ...envelope, version: 3 },
		]) {
			const error = await Effect.runPromise(
				Effect.flip(
					decryptVaultRecord(
						vaultKey,
						changed as unknown as EncryptedRecordEnvelopeV2,
					),
				),
			);
			expect(error).toMatchObject({ _tag: "VaultFormatError" });
		}
	});

	it("rejects records larger than 256 KiB before encryption", async () => {
		const oversized = { ...item, notes: "x".repeat(256 * 1024) };
		const error = await Effect.runPromise(
			Effect.flip(
				encryptLoginRecord(key(), VAULT_ID, oversized, decimalBigInt(1n)),
			),
		);
		expect(error).toMatchObject({ _tag: "VaultFormatError" });
	});
});

describe("v2 vault-key envelope and v1 conversion", () => {
	it("wraps the same vault key with fresh v2 KDF material", async () => {
		await sodium.ready;
		const vaultKey = key();
		const options = {
			createdAt: CREATED_AT,
			kdf: {
				operationsLimit: sodium.crypto_pwhash_OPSLIMIT_MIN,
				memoryLimit: sodium.crypto_pwhash_MEMLIMIT_MIN,
			},
		};
		const first = await Effect.runPromise(
			createVaultKeyEnvelopeV2(vaultKey, "master password", VAULT_ID, options),
		);
		const second = await Effect.runPromise(
			createVaultKeyEnvelopeV2(vaultKey, "master password", VAULT_ID, options),
		);

		expect(first.kdf.salt).not.toBe(second.kdf.salt);
		expect(first.wrappedVaultKey.nonce).not.toBe(second.wrappedVaultKey.nonce);
		expect(
			await Effect.runPromise(unwrapVaultKeyV2(first, "master password")),
		).toEqual(vaultKey);
	});

	it("converts v1 logins without changing identity or mutating the session", async () => {
		await sodium.ready;
		const session: VaultSession = {
			vaultKey: key(),
			document: {
				version: 1,
				id: VAULT_ID,
				items: [item],
				createdAt: CREATED_AT,
				updatedAt: UPDATED_AT,
			},
		};
		const before = JSON.stringify(session.document);
		const converted = await Effect.runPromise(
			convertVaultV1ToV2(session, "master password", {
				randomBytes: sequentialBytes(),
				kdf: {
					operationsLimit: sodium.crypto_pwhash_OPSLIMIT_MIN,
					memoryLimit: sodium.crypto_pwhash_MEMLIMIT_MIN,
				},
			}),
		);

		expect(converted.session).toBe(session);
		expect(converted.keyEnvelope).toMatchObject({
			vaultId: VAULT_ID,
			keyRevision: "1",
		});
		expect(converted.records).toHaveLength(1);
		expect(converted.records[0]).toMatchObject({
			format: ENCRYPTED_RECORD_FORMAT_V2,
			version: SYNC_PROTOCOL_VERSION,
			vaultId: VAULT_ID,
			recordId: ITEM_ID,
			revision: "1",
		});
		expect(
			await Effect.runPromise(
				decryptVaultRecord(
					session.vaultKey,
					converted.records[0] as EncryptedRecordEnvelopeV2,
				),
			),
		).toEqual({ schemaVersion: 1, kind: "login", item });
		expect(
			await Effect.runPromise(
				unwrapVaultKeyV2(converted.keyEnvelope, "master password"),
			),
		).toEqual(session.vaultKey);
		expect(JSON.stringify(session.document)).toBe(before);
	});
});
