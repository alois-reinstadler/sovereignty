import { readFile } from "node:fs/promises";

import {
	encodeRecordAad,
	encodeVaultKeyAad,
	parseEncryptedRecordEnvelopeV2,
	parseVaultKeyEnvelopeV2,
} from "@svrgn/sync-protocol";
import {
	decryptVaultRecord,
	parseEncryptedVault,
	unlockVault,
	unwrapVaultKeyV2,
} from "@svrgn/vault-core";
import { Effect } from "effect";
import sodium from "libsodium-wrappers-sumo";
import { beforeAll, describe, expect, it } from "vitest";

import { protocolVectors as vectors } from "../src/index";
import { buildVectors } from "./build-vectors";

const hex = (value: string) => sodium.from_hex(value);
const b64 = (value: string) =>
	sodium.from_base64(value, sodium.base64_variants.URLSAFE_NO_PADDING);
const text = (value: string) =>
	new TextDecoder("utf-8", { fatal: true }).decode(hex(value));
const slice = (bytes: Uint8Array) => {
	const buffer = new Uint8Array(bytes.length + 11).fill(0xa5);
	buffer.set(bytes, 4);
	return buffer.subarray(4, 4 + bytes.length);
};

beforeAll(async () => {
	await sodium.ready;
});

describe("committed synthetic interoperability vectors", () => {
	it("matches every committed byte against the pinned sodium and real vault-core generator", async () => {
		expect(await buildVectors()).toEqual(vectors);
	});
	it.each(
		vectors.argon2id,
	)("derives the exact $id key from UTF-8 password bytes", (vector) => {
		expect(vector.algorithmId).toBe(sodium.crypto_pwhash_ALG_ARGON2ID13);
		const key = sodium.crypto_pwhash(
			vector.keyBytes,
			slice(hex(vector.passwordUtf8Hex)),
			slice(hex(vector.saltHex)),
			vector.operationsLimit,
			vector.memoryLimit,
			sodium.crypto_pwhash_ALG_ARGON2ID13,
		);
		expect(sodium.to_hex(key)).toBe(vector.derivedKeyHex);
		expect(b64(vector.saltBase64url)).toEqual(hex(vector.saltHex));
	});
	it.each(
		vectors.aead,
	)("matches $id with actual nonzero-offset buffers", (vector) => {
		const message = slice(hex(vector.plaintextHex));
		const aad = slice(hex(vector.aadHex));
		const nonce = slice(hex(vector.nonceHex));
		const key = slice(hex(vector.keyHex));
		for (const input of [message, aad, nonce, key]) {
			expect(input.byteOffset).toBe(vector.slice.prefixBytes);
			expect(input.buffer.byteLength).toBe(
				input.byteLength + vector.slice.prefixBytes + vector.slice.suffixBytes,
			);
		}
		const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
			message,
			aad,
			null,
			nonce,
			key,
		);
		expect(sodium.to_hex(ciphertext)).toBe(vector.ciphertextHex);
		expect(b64(vector.ciphertextBase64url)).toEqual(ciphertext);
		expect(
			sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
				null,
				slice(ciphertext),
				aad,
				nonce,
				key,
			),
		).toEqual(hex(vector.plaintextHex));
	});
	it("unlocks the complete v1 fixture with the current vault implementation", async () => {
		const envelope = parseEncryptedVault(JSON.stringify(vectors.v1.envelope));
		const session = await Effect.runPromise(
			unlockVault(envelope, text(vectors.v1.masterPasswordUtf8Hex)),
		);
		expect(sodium.to_hex(session.vaultKey)).toBe(vectors.v1.vaultKeyHex);
		expect(session.document).toEqual(vectors.v1.document);
		expect(text(vectors.v1.documentUtf8Hex)).toBe(
			JSON.stringify(session.document),
		);
		await expect(
			Effect.runPromise(unlockVault(envelope, "wrong synthetic password")),
		).rejects.toThrow();
	});
	it("unwraps the v2 fixture with the current implementation and exact binary AAD", async () => {
		const envelope = parseVaultKeyEnvelopeV2(vectors.v2Key.envelope);
		expect(sodium.to_hex(encodeVaultKeyAad(envelope))).toBe(
			vectors.v2Key.aadHex,
		);
		expect(envelope.keyRevision).toBe("9007199254740993");
		const key = await Effect.runPromise(
			unwrapVaultKeyV2(envelope, text(vectors.v2Key.masterPasswordUtf8Hex)),
		);
		expect(sodium.to_hex(key)).toBe(vectors.v2Key.vaultKeyHex);
		await expect(
			Effect.runPromise(unwrapVaultKeyV2(envelope, "wrong synthetic password")),
		).rejects.toThrow();
	});
	it.each(
		vectors.v2Records,
	)("decrypts the v2 $id fixture and preserves revisions above 2^53", async (vector) => {
		const envelope = parseEncryptedRecordEnvelopeV2(vector.envelope);
		expect(BigInt(envelope.revision)).toBeGreaterThan(2n ** 53n);
		expect(sodium.to_hex(encodeRecordAad(envelope))).toBe(vector.aadHex);
		expect(
			await Effect.runPromise(
				decryptVaultRecord(hex(vector.vaultKeyHex), envelope),
			),
		).toEqual(vector.plaintext);
		expect(text(vector.plaintextUtf8Hex)).toBe(
			JSON.stringify(vector.plaintext),
		);
		await expect(
			Effect.runPromise(
				decryptVaultRecord(hex(vector.vaultKeyHex), {
					...envelope,
					revision: "1" as typeof envelope.revision,
				}),
			),
		).rejects.toThrow();
	});
	it("exposes only JSON and has no runtime dependencies", async () => {
		const entry = await readFile(
			new URL("../src/index.ts", import.meta.url),
			"utf8",
		);
		expect(entry.match(/^import .*$/gm)).toEqual([
			'import fixtures from "../fixtures/vectors.json" with { type: "json" };',
		]);
		const manifest = JSON.parse(
			await readFile(new URL("../package.json", import.meta.url), "utf8"),
		);
		expect(manifest.dependencies).toBeUndefined();
		expect(manifest.exports["./fixtures.json"]).toBe("./fixtures/vectors.json");
		expect(manifest.scripts.test).toBe("vitest run");
	});
});

// Flatten all envelope payloads into the exact same primitive acceptance cases
// a native runner should apply. A successful round trip alone is insufficient.
const payloads = [
	...vectors.aead,
	{
		id: "v1-wrapped-key",
		keyHex: vectors.v1.wrappingKeyHex,
		nonceBase64url: vectors.v1.envelope.wrappedVaultKey.nonce,
		ciphertextBase64url: vectors.v1.envelope.wrappedVaultKey.ciphertext,
		aadHex: vectors.v1.wrappingAadHex,
		plaintextHex: vectors.v1.vaultKeyHex,
	},
	{
		id: "v1-document",
		keyHex: vectors.v1.vaultKeyHex,
		nonceBase64url: vectors.v1.envelope.encryptedDocument.nonce,
		ciphertextBase64url: vectors.v1.envelope.encryptedDocument.ciphertext,
		aadHex: vectors.v1.documentAadHex,
		plaintextHex: vectors.v1.documentUtf8Hex,
	},
	{
		id: "v2-wrapped-key",
		keyHex: vectors.v2Key.wrappingKeyHex,
		nonceBase64url: vectors.v2Key.envelope.wrappedVaultKey.nonce,
		ciphertextBase64url: vectors.v2Key.envelope.wrappedVaultKey.ciphertext,
		aadHex: vectors.v2Key.aadHex,
		plaintextHex: vectors.v2Key.vaultKeyHex,
	},
	...vectors.v2Records.map((vector) => ({
		id: `v2-${vector.id}`,
		keyHex: vector.vaultKeyHex,
		nonceBase64url: vector.envelope.nonce,
		ciphertextBase64url: vector.envelope.ciphertext,
		aadHex: vector.aadHex,
		plaintextHex: vector.plaintextUtf8Hex,
	})),
];

describe.each(payloads)("AEAD acceptance for $id", (vector) => {
	const nonce = () =>
		"nonceHex" in vector ? hex(vector.nonceHex) : b64(vector.nonceBase64url);
	it("matches committed ciphertext with explicit AAD and decrypts exact plaintext", () => {
		const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
			hex(vector.plaintextHex),
			hex(vector.aadHex),
			null,
			nonce(),
			hex(vector.keyHex),
		);
		expect(ciphertext).toEqual(b64(vector.ciphertextBase64url));
		expect(
			sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
				null,
				ciphertext,
				hex(vector.aadHex),
				nonce(),
				hex(vector.keyHex),
			),
		).toEqual(hex(vector.plaintextHex));
	});
	it("rejects modified ciphertext, tag, AAD, nonce and key", () => {
		const changed = (value: Uint8Array) => {
			const result = value.slice();
			result[0] ^= 1;
			return result;
		};
		const ciphertext = b64(vector.ciphertextBase64url);
		const key = hex(vector.keyHex);
		const aad = hex(vector.aadHex);
		const tag = ciphertext.slice();
		tag[tag.length - 1] ^= 1;
		for (const [candidate, authenticatedData, iv, candidateKey] of [
			[changed(ciphertext), aad, nonce(), key],
			[tag, aad, nonce(), key],
			[ciphertext, aad.length ? changed(aad) : Uint8Array.of(1), nonce(), key],
			[ciphertext, aad, changed(nonce()), key],
			[ciphertext, aad, nonce(), changed(key)],
		])
			expect(() =>
				sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
					null,
					candidate,
					authenticatedData,
					iv,
					candidateKey,
				),
			).toThrow();
	});
	it.each([
		0, 1, 15,
	])("rejects %i-byte ciphertext before returning plaintext", (length) => {
		expect(() =>
			sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
				null,
				new Uint8Array(length),
				hex(vector.aadHex),
				nonce(),
				hex(vector.keyHex),
			),
		).toThrow();
	});
});
