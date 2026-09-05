import { protocolVectors as vectors } from "@svrgn/protocol-vectors";
import sodium from "react-native-libsodium";
import { utf8 } from "./crypto";
import { nativeCrypto } from "./native-crypto";
import { aad, MobileVault, parseEnvelope, validateDocument } from "./vault";

export function runNativeVectors() {
	let checks = 0;
	const failures: string[] = [];
	const check = (name: string, fn: () => void) => {
		checks++;
		try {
			fn();
		} catch {
			failures.push(name.slice(0, 160));
		}
	};
	const equal = (actual: Uint8Array, expected: Uint8Array) => {
		if (
			actual.length !== expected.length ||
			actual.some((v, i) => v !== expected[i])
		)
			throw new Error("Byte mismatch");
	};
	const rejects = (fn: () => unknown) => {
		let rejected = false;
		try {
			fn();
		} catch {
			rejected = true;
		}
		if (!rejected) throw new Error("Expected rejection");
	};
	const hex = (s: string) =>
		Uint8Array.from(s.match(/../g) ?? [], (n) => Number.parseInt(n, 16));
	const sliced = (bytes: Uint8Array) => {
		const storage = new Uint8Array(bytes.length + 11).fill(165);
		storage.set(bytes, 4);
		return storage.subarray(4, 4 + bytes.length);
	};
	const changed = (bytes: Uint8Array) => {
		const copy = bytes.length ? bytes.slice() : new Uint8Array(1);
		copy[0] ^= 1;
		return copy;
	};
	try {
		const crypto = nativeCrypto();
		const vault = new MobileVault(crypto);
		for (const v of vectors.argon2id)
			check(`argon2id:${v.id}`, () => {
				const key = crypto.derive(
					sliced(hex(v.passwordUtf8Hex)),
					sliced(hex(v.saltHex)),
					v.operationsLimit,
					v.memoryLimit,
				);
				try {
					equal(key, hex(v.derivedKeyHex));
				} finally {
					crypto.zero(key);
				}
			});
		check("utf8:NUL-and-Unicode", () =>
			equal(
				utf8(crypto.text(hex(vectors.v1.masterPasswordUtf8Hex))),
				hex(vectors.v1.masterPasswordUtf8Hex),
			),
		);
		const v1 = vectors.v1;
		const v1Envelope = parseEnvelope(JSON.stringify(v1.envelope));
		const v1Document: unknown = v1.document;
		validateDocument(v1Document, v1Envelope);
		const v2 = vectors.v2Key;
		const payloads = [
			...vectors.aead.map((v) => ({
				id: v.id,
				key: hex(v.keyHex),
				nonce: hex(v.nonceHex),
				plaintext: hex(v.plaintextHex),
				aad: hex(v.aadHex),
				ciphertext: hex(v.ciphertextHex),
			})),
			{
				id: "v1-key",
				key: hex(v1.wrappingKeyHex),
				nonce: crypto.decode(v1.envelope.wrappedVaultKey.nonce),
				plaintext: hex(v1.vaultKeyHex),
				aad: hex(v1.wrappingAadHex),
				ciphertext: crypto.decode(v1.envelope.wrappedVaultKey.ciphertext),
			},
			{
				id: "v1-document",
				key: hex(v1.vaultKeyHex),
				nonce: crypto.decode(v1.envelope.encryptedDocument.nonce),
				plaintext: hex(v1.documentUtf8Hex),
				aad: hex(v1.documentAadHex),
				ciphertext: crypto.decode(v1.envelope.encryptedDocument.ciphertext),
			},
			{
				id: "v2-key",
				key: hex(v2.wrappingKeyHex),
				nonce: crypto.decode(v2.envelope.wrappedVaultKey.nonce),
				plaintext: hex(v2.vaultKeyHex),
				aad: hex(v2.aadHex),
				ciphertext: crypto.decode(v2.envelope.wrappedVaultKey.ciphertext),
			},
			...vectors.v2Records.map((v) => ({
				id: v.id,
				key: hex(v.vaultKeyHex),
				nonce: crypto.decode(v.envelope.nonce),
				plaintext: hex(v.plaintextUtf8Hex),
				aad: hex(v.aadHex),
				ciphertext: crypto.decode(v.envelope.ciphertext),
			})),
		];
		for (const v of payloads) {
			check(`${v.id}:encrypt-sliced`, () =>
				equal(
					crypto.encrypt(
						sliced(v.plaintext),
						sliced(v.aad),
						sliced(v.nonce),
						sliced(v.key),
					),
					v.ciphertext,
				),
			);
			check(`${v.id}:decrypt-sliced`, () =>
				equal(
					crypto.decrypt(
						sliced(v.ciphertext),
						sliced(v.aad),
						sliced(v.nonce),
						sliced(v.key),
					),
					v.plaintext,
				),
			);
			for (const field of ["ciphertext", "aad", "nonce", "key"] as const)
				check(`${v.id}:reject-${field}`, () => {
					const bad = { ...v, [field]: changed(v[field]) };
					rejects(() =>
						crypto.decrypt(bad.ciphertext, bad.aad, bad.nonce, bad.key),
					);
				});
			check(`${v.id}:reject-tag`, () => {
				const ciphertext = v.ciphertext.slice();
				ciphertext[ciphertext.length - 1] ^= 1;
				rejects(() => crypto.decrypt(ciphertext, v.aad, v.nonce, v.key));
			});
			for (const length of [0, 1, 15])
				check(`${v.id}:native-short-${length}`, () =>
					rejects(() =>
						sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
							null,
							new Uint8Array(length),
							v.aad,
							v.nonce,
							v.key,
						),
					),
				);
		}
		check("memzero:slice-only", () => {
			const bytes = new Uint8Array(32).fill(165);
			crypto.zero(bytes.subarray(4, 25));
			equal(
				bytes,
				Uint8Array.from({ length: 32 }, (_, i) => (i >= 4 && i < 25 ? 0 : 165)),
			);
			crypto.zero(bytes);
			equal(bytes, new Uint8Array(32));
		});
		check("v1:adapter-unlock", () => {
			const session = vault.unlock(
				v1Envelope,
				crypto.text(hex(v1.masterPasswordUtf8Hex)),
			);
			try {
				equal(session.vaultKey, hex(v1.vaultKeyHex));
				equal(utf8(JSON.stringify(session.document)), hex(v1.documentUtf8Hex));
			} finally {
				vault.destroy(session);
			}
		});
		check("v1:adapter-wrap-and-save-exact", () => {
			const session = { vaultKey: hex(v1.vaultKeyHex), document: v1Document };
			const random = [
				crypto.decode(v1.envelope.kdf.salt),
				crypto.decode(v1.envelope.wrappedVaultKey.nonce),
				crypto.decode(v1.envelope.encryptedDocument.nonce),
			];
			try {
				const envelope = vault.wrap(
					session,
					crypto.text(hex(v1.masterPasswordUtf8Hex)),
					{
						random: (n) => {
							const bytes = random.shift();
							if (!bytes || bytes.length !== n)
								throw new Error("Unexpected randomness");
							return bytes;
						},
						kdf: v1.envelope.kdf,
					},
				);
				equal(
					utf8(JSON.stringify(envelope)),
					utf8(JSON.stringify(v1.envelope)),
				);
				equal(aad(envelope, "vault-key"), hex(v1.wrappingAadHex));
				equal(aad(envelope, "document"), hex(v1.documentAadHex));
			} finally {
				vault.destroy(session);
			}
		});
		check("v1:adapter-wrong-password", () =>
			rejects(() => vault.unlock(v1Envelope, "synthetic incorrect password")),
		);
		check("v1:adapter-create-save-unlock", () => {
			const created = vault.create("synthetic native acceptance password");
			try {
				const reopened = vault.unlock(
					created.envelope,
					"synthetic native acceptance password",
				);
				try {
					equal(reopened.vaultKey, created.session.vaultKey);
				} finally {
					vault.destroy(reopened);
				}
			} finally {
				vault.destroy(created.session);
			}
		});
	} catch {
		failures.push("native-initialization-or-runner");
	}
	return { schemaVersion: 1, passed: failures.length === 0, checks, failures };
}
