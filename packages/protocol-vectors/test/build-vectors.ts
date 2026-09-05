import {
	encodeRecordAad,
	encodeVaultKeyAad,
	parseDecimalBigInt,
} from "@svrgn/sync-protocol";
import {
	createVault,
	createVaultKeyEnvelopeV2,
	type EncryptedVaultEnvelope,
	encryptLoginRecord,
	encryptTombstoneRecord,
	sealNewVaultSession,
} from "@svrgn/vault-core";
import { Effect } from "effect";
import sodium from "libsodium-wrappers-sumo";

const utf8 = (text: string) => new TextEncoder().encode(text);
const hex = (bytes: Uint8Array) => sodium.to_hex(bytes);
const base64url = (bytes: Uint8Array) =>
	sodium.to_base64(bytes, sodium.base64_variants.URLSAFE_NO_PADDING);
const decode = (value: string) =>
	sodium.from_base64(value, sodium.base64_variants.URLSAFE_NO_PADDING);
// Deliberately non-random material: available only in this test harness.
const bytes = (length: number, seed: number) =>
	Uint8Array.from({ length }, (_, index) => (seed + index * 17) & 255);
const randomSequence = (seed: number) => {
	let call = 0;
	return (length: number) => bytes(length, seed + ++call * 29);
};
const sliced = (value: Uint8Array) => {
	const backing = new Uint8Array(value.length + 11).fill(0xa5);
	backing.set(value, 4);
	return backing.subarray(4, 4 + value.length);
};

export const buildVectors = async () => {
	await sodium.ready;
	const masterPassword = "Synthetic only: café 🔐\u0000master";
	const masterPasswordBytes = utf8(masterPassword);
	const kdf = { operationsLimit: 1, memoryLimit: 8192 };
	const now = "2026-09-05T12:00:00.000Z";
	const vaultId = "018f3d3e-8bb7-7cc8-8e02-3e8cad8d5b74";
	const item = {
		id: "018f3d3e-8bb7-7cc8-8e02-3e8cad8d5b76",
		title: "Synthetic café 🔐",
		username: "synthetic@example.test",
		password: "PUBLIC fixture password: Grüße 日本語\u0000",
		website: "https://example.test:8443/login",
		notes: "Never use these fixed values in a real vault.",
		favorite: true,
		createdAt: now,
		updatedAt: now,
	};
	const derive = (parameters: {
		salt: string;
		operationsLimit: number;
		memoryLimit: number;
	}) =>
		sodium.crypto_pwhash(
			32,
			masterPasswordBytes,
			decode(parameters.salt),
			parameters.operationsLimit,
			parameters.memoryLimit,
			sodium.crypto_pwhash_ALG_ARGON2ID13,
		);
	const created = await Effect.runPromise(
		createVault(masterPassword, {
			id: vaultId,
			now,
			kdf,
			randomBytes: randomSequence(7),
		}),
	);
	const session = {
		vaultKey: created.session.vaultKey,
		document: { ...created.session.document, items: [item] },
	};
	const sealed = await Effect.runPromise(
		sealNewVaultSession(session, masterPassword, {
			kdf,
			randomBytes: randomSequence(23),
		}),
	);
	const v1Aad = (
		envelope: EncryptedVaultEnvelope,
		purpose: "vault-key" | "document",
	) =>
		utf8(
			JSON.stringify({
				context: "svrgn-vault",
				purpose,
				version: envelope.version,
				id: envelope.id,
				createdAt: envelope.createdAt,
				updatedAt: purpose === "document" ? envelope.updatedAt : undefined,
				kdf: purpose === "vault-key" ? envelope.kdf : undefined,
			}),
		);
	const keyEnvelope = await Effect.runPromise(
		createVaultKeyEnvelopeV2(session.vaultKey, masterPassword, vaultId, {
			createdAt: now,
			keyRevision: parseDecimalBigInt("9007199254740993"),
			kdf,
			randomBytes: randomSequence(43),
		}),
	);
	const login = await Effect.runPromise(
		encryptLoginRecord(
			session.vaultKey,
			vaultId,
			item,
			parseDecimalBigInt("9007199254740995"),
			{ randomBytes: randomSequence(59) },
		),
	);
	const tombstone = await Effect.runPromise(
		encryptTombstoneRecord(
			session.vaultKey,
			vaultId,
			item.id,
			now,
			parseDecimalBigInt("9223372036854775807"),
			{ randomBytes: randomSequence(71) },
		),
	);
	const loginPlaintext = { schemaVersion: 1, kind: "login", item };
	const tombstonePlaintext = {
		schemaVersion: 1,
		kind: "tombstone",
		deletedAt: now,
	};
	const aead = [
		{
			id: "binary-aad-unicode",
			plaintext: utf8("Public synthetic café 🔐 日本語\u0000"),
			aad: Uint8Array.of(0, 0x80, 0xff, 0x41, 0, 0xc3, 0x28),
		},
		{
			id: "empty-plaintext-and-aad",
			plaintext: new Uint8Array(),
			aad: new Uint8Array(),
		},
	].map((input, index) => {
		const key = bytes(32, 101 + index);
		const nonce = bytes(24, 113 + index);
		const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
			sliced(input.plaintext),
			sliced(input.aad),
			null,
			sliced(nonce),
			sliced(key),
		);
		return {
			id: input.id,
			keyHex: hex(key),
			nonceHex: hex(nonce),
			plaintextHex: hex(input.plaintext),
			aadHex: hex(input.aad),
			ciphertextHex: hex(ciphertext),
			ciphertextBase64url: base64url(ciphertext),
			slice: { prefixBytes: 4, suffixBytes: 7, sentinelByte: 165 },
		};
	});
	return {
		fixtureVersion: 1,
		warning:
			"PUBLIC SYNTHETIC TEST VECTORS. Never use these passwords, keys, salts or nonces in production.",
		generator: {
			package: "libsodium-wrappers-sumo",
			packageVersion: "0.8.4",
			sodiumVersion: sodium.sodium_version_string(),
			encoding: "lowercase hex and URL-safe base64 without padding",
		},
		argon2id: [kdf, { operationsLimit: 2, memoryLimit: 67108864 }].map(
			(limits, index) => {
				const salt = bytes(16, 131 + index);
				const derivedKey = sodium.crypto_pwhash(
					32,
					sliced(masterPasswordBytes),
					sliced(salt),
					limits.operationsLimit,
					limits.memoryLimit,
					sodium.crypto_pwhash_ALG_ARGON2ID13,
				);
				return {
					id: index === 0 ? "test-minimum-cost" : "interactive-cost",
					algorithm: "argon2id13",
					algorithmId: sodium.crypto_pwhash_ALG_ARGON2ID13,
					passwordUtf8Hex: hex(masterPasswordBytes),
					saltHex: hex(salt),
					saltBase64url: base64url(salt),
					...limits,
					keyBytes: 32,
					derivedKeyHex: hex(derivedKey),
				};
			},
		),
		aead,
		v1: {
			masterPasswordUtf8Hex: hex(masterPasswordBytes),
			vaultKeyHex: hex(session.vaultKey),
			wrappingKeyHex: hex(derive(sealed.envelope.kdf)),
			wrappingAadHex: hex(v1Aad(sealed.envelope, "vault-key")),
			documentAadHex: hex(v1Aad(sealed.envelope, "document")),
			documentUtf8Hex: hex(utf8(JSON.stringify(session.document))),
			document: session.document,
			envelope: sealed.envelope,
		},
		v2Key: {
			masterPasswordUtf8Hex: hex(masterPasswordBytes),
			vaultKeyHex: hex(session.vaultKey),
			wrappingKeyHex: hex(derive(keyEnvelope.kdf)),
			aadHex: hex(encodeVaultKeyAad(keyEnvelope)),
			envelope: keyEnvelope,
		},
		v2Records: [
			{ id: "login", envelope: login, plaintext: loginPlaintext },
			{ id: "tombstone", envelope: tombstone, plaintext: tombstonePlaintext },
		].map(({ id, envelope, plaintext }) => ({
			id,
			vaultKeyHex: hex(session.vaultKey),
			aadHex: hex(encodeRecordAad(envelope)),
			plaintextUtf8Hex: hex(utf8(JSON.stringify(plaintext))),
			plaintext,
			envelope,
		})),
	};
};
