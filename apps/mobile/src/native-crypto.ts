import sodium from "react-native-libsodium";
import type { NativeCrypto } from "./crypto";

/** Native installation failure is terminal: never fall back to browser WASM. */
export function nativeCrypto(): NativeCrypto {
	if (
		sodium.crypto_pwhash_ALG_ARGON2ID13 !== 2 ||
		sodium.crypto_aead_xchacha20poly1305_ietf_KEYBYTES !== 32 ||
		typeof sodium.memzero !== "function"
	) {
		throw new Error(
			"The native crypto module is unavailable. Use a native development build.",
		);
	}
	const exact = (bytes: Uint8Array, length: number) => {
		if (!(bytes instanceof Uint8Array) || bytes.length !== length)
			throw new Error("Invalid crypto input length");
	};
	return {
		random: (length) => {
			if (!Number.isSafeInteger(length) || length < 1 || length > 1024)
				throw new Error("Invalid random byte count");
			return sodium.randombytes_buf(length);
		},
		derive: (password, salt, operations, memory) => {
			exact(salt, 16);
			if (
				password.length > 4096 ||
				!Number.isSafeInteger(operations) ||
				operations < 1 ||
				operations > 10 ||
				!Number.isSafeInteger(memory) ||
				memory < 8192 ||
				memory > 512 * 1024 * 1024
			)
				throw new Error("Unsupported password derivation parameters");
			return sodium.crypto_pwhash(32, password, salt, operations, memory, 2);
		},
		encrypt: (message, aad, nonce, key) => {
			exact(nonce, 24);
			exact(key, 32);
			if (message.length > 8 * 1024 * 1024 || aad.length > 16384)
				throw new Error("Crypto payload exceeds limit");
			return sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
				message,
				aad,
				null,
				nonce,
				key,
			);
		},
		decrypt: (ciphertext, aad, nonce, key) => {
			exact(nonce, 24);
			exact(key, 32);
			if (
				ciphertext.length < 16 ||
				ciphertext.length > 8 * 1024 * 1024 + 16 ||
				aad.length > 16384
			)
				throw new Error("Invalid ciphertext size");
			return sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
				null,
				ciphertext,
				aad,
				nonce,
				key,
			);
		},
		zero: sodium.memzero,
		encode: (bytes) =>
			sodium.to_base64(bytes, sodium.base64_variants.URLSAFE_NO_PADDING),
		decode: (value) => {
			if (!/^[A-Za-z0-9_-]*$/.test(value) || value.length > 12 * 1024 * 1024)
				throw new Error("Invalid base64url data");
			const bytes = sodium.from_base64(
				value,
				sodium.base64_variants.URLSAFE_NO_PADDING,
			);
			if (
				sodium.to_base64(bytes, sodium.base64_variants.URLSAFE_NO_PADDING) !==
				value
			)
				throw new Error("Noncanonical base64url data");
			return bytes;
		},
		text: sodium.to_string,
	};
}
