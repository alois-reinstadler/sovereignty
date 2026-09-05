import type {
	EncryptedPayload,
	EncryptedVaultEnvelope,
	PasswordKdfParameters,
	VaultDocument,
	VaultSession,
} from "@svrgn/vault-core";
import { type NativeCrypto, utf8 } from "./crypto";

export type {
	EncryptedVaultEnvelope,
	VaultDocument,
	VaultItem,
	VaultSession,
} from "@svrgn/vault-core";
export const MAX_ENVELOPE_BYTES = 12 * 1024 * 1024;
const record = (v: unknown): v is Record<string, unknown> =>
	typeof v === "object" && v !== null && !Array.isArray(v);
const keys = (v: Record<string, unknown>, allowed: readonly string[]) =>
	Object.keys(v).length === allowed.length &&
	Object.keys(v).every((key) => allowed.includes(key));
const payload = (v: unknown) =>
	record(v) &&
	keys(v, ["algorithm", "nonce", "ciphertext"]) &&
	v.algorithm === "xchacha20-poly1305-ietf" &&
	typeof v.nonce === "string" &&
	v.nonce.length === 32 &&
	typeof v.ciphertext === "string" &&
	v.ciphertext.length >= 22 &&
	v.ciphertext.length <= MAX_ENVELOPE_BYTES;
export function parseEnvelope(serialized: string): EncryptedVaultEnvelope {
	if (serialized.length > MAX_ENVELOPE_BYTES)
		throw new Error("Encrypted vault exceeds the mobile limit");
	const v: unknown = JSON.parse(serialized);
	if (
		!record(v) ||
		!keys(v, [
			"format",
			"version",
			"id",
			"kdf",
			"createdAt",
			"updatedAt",
			"wrappedVaultKey",
			"encryptedDocument",
		]) ||
		v.format !== "svrgn-encrypted-vault" ||
		v.version !== 1 ||
		!["id", "createdAt", "updatedAt"].every(
			(k) =>
				typeof v[k] === "string" &&
				(v[k] as string).length > 0 &&
				(v[k] as string).length <= 128,
		) ||
		!record(v.kdf) ||
		!keys(v.kdf, ["algorithm", "salt", "operationsLimit", "memoryLimit"]) ||
		v.kdf.algorithm !== "argon2id13" ||
		typeof v.kdf.salt !== "string" ||
		v.kdf.salt.length !== 22 ||
		!Number.isSafeInteger(v.kdf.operationsLimit) ||
		(v.kdf.operationsLimit as number) < 1 ||
		(v.kdf.operationsLimit as number) > 10 ||
		!Number.isSafeInteger(v.kdf.memoryLimit) ||
		(v.kdf.memoryLimit as number) < 8192 ||
		(v.kdf.memoryLimit as number) > 512 * 1024 * 1024 ||
		!payload(v.wrappedVaultKey) ||
		!payload(v.encryptedDocument)
	)
		throw new Error("Unsupported or invalid encrypted vault");
	return v as unknown as EncryptedVaultEnvelope;
}
export function validateDocument(
	v: unknown,
	envelope: Pick<EncryptedVaultEnvelope, "id" | "createdAt" | "updatedAt">,
): asserts v is VaultDocument {
	if (
		!record(v) ||
		v.version !== 1 ||
		v.id !== envelope.id ||
		v.createdAt !== envelope.createdAt ||
		v.updatedAt !== envelope.updatedAt ||
		!Array.isArray(v.items) ||
		v.items.length > 10000
	)
		throw new Error("Invalid decrypted document");
	const ids = new Set<string>();
	for (const item of v.items) {
		if (
			!record(item) ||
			![
				"id",
				"title",
				"username",
				"password",
				"website",
				"notes",
				"createdAt",
				"updatedAt",
			].every(
				(k) =>
					typeof item[k] === "string" && (item[k] as string).length <= 16384,
			) ||
			typeof item.favorite !== "boolean" ||
			!item.id ||
			ids.has(item.id as string)
		)
			throw new Error("Invalid login record");
		ids.add(item.id as string);
	}
}
export const aad = (
	envelope: EncryptedVaultEnvelope,
	purpose: "document" | "vault-key",
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

export class MobileVault {
	constructor(readonly crypto: NativeCrypto) {}
	id() {
		const bytes = this.crypto.random(16);
		bytes[6] = (bytes[6] & 15) | 64;
		bytes[8] = (bytes[8] & 63) | 128;
		const hex = Array.from(bytes, (byte) =>
			byte.toString(16).padStart(2, "0"),
		).join("");
		this.crypto.zero(bytes);
		return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
	}
	private wrapping(password: string, kdf: PasswordKdfParameters) {
		if (!password || password.length > 1024)
			throw new Error(
				"A master password of at most 1024 characters is required",
			);
		const bytes = utf8(password);
		try {
			return this.crypto.derive(
				bytes,
				this.crypto.decode(kdf.salt),
				kdf.operationsLimit,
				kdf.memoryLimit,
			);
		} finally {
			this.crypto.zero(bytes);
		}
	}
	private encrypt(
		bytes: Uint8Array,
		key: Uint8Array,
		nonce: Uint8Array,
		associated: Uint8Array,
	): EncryptedPayload {
		return {
			algorithm: "xchacha20-poly1305-ietf",
			nonce: this.crypto.encode(nonce),
			ciphertext: this.crypto.encode(
				this.crypto.encrypt(bytes, associated, nonce, key),
			),
		};
	}
	private decrypt(
		payload: EncryptedPayload,
		key: Uint8Array,
		associated: Uint8Array,
	) {
		return this.crypto.decrypt(
			this.crypto.decode(payload.ciphertext),
			associated,
			this.crypto.decode(payload.nonce),
			key,
		);
	}
	create(password: string) {
		const now = new Date().toISOString();
		const session: VaultSession = {
			vaultKey: this.crypto.random(32),
			document: {
				version: 1,
				id: this.id(),
				items: [],
				createdAt: now,
				updatedAt: now,
			},
		};
		try {
			return { session, envelope: this.wrap(session, password) };
		} catch (error) {
			this.destroy(session);
			throw error;
		}
	}
	/** Deterministic randomness/KDF options are used only by the separate native test entry. */
	wrap(
		session: VaultSession,
		password: string,
		options: {
			random?: (n: number) => Uint8Array;
			kdf?: Pick<PasswordKdfParameters, "operationsLimit" | "memoryLimit">;
		} = {},
	): EncryptedVaultEnvelope {
		validateDocument(session.document, session.document);
		const random = options.random ?? this.crypto.random;
		const kdf: PasswordKdfParameters = {
			algorithm: "argon2id13",
			salt: this.crypto.encode(random(16)),
			operationsLimit: options.kdf?.operationsLimit ?? 2,
			memoryLimit: options.kdf?.memoryLimit ?? 67108864,
		};
		const base = {
			format: "svrgn-encrypted-vault",
			version: 1,
			id: session.document.id,
			kdf,
			createdAt: session.document.createdAt,
			updatedAt: session.document.updatedAt,
		} as EncryptedVaultEnvelope;
		const wrappingKey = this.wrapping(password, kdf);
		try {
			const envelope = {
				...base,
				wrappedVaultKey: this.encrypt(
					session.vaultKey,
					wrappingKey,
					random(24),
					aad(base, "vault-key"),
				),
			};
			return this.seal(session, envelope, random(24));
		} finally {
			this.crypto.zero(wrappingKey);
		}
	}
	unlock(envelope: EncryptedVaultEnvelope, password: string): VaultSession {
		parseEnvelope(JSON.stringify(envelope));
		const wrappingKey = this.wrapping(password, envelope.kdf);
		let vaultKey: Uint8Array;
		try {
			vaultKey = this.decrypt(
				envelope.wrappedVaultKey,
				wrappingKey,
				aad(envelope, "vault-key"),
			);
		} finally {
			this.crypto.zero(wrappingKey);
		}
		try {
			if (vaultKey.length !== 32) throw new Error("Invalid vault key length");
			const plaintext = this.decrypt(
				envelope.encryptedDocument,
				vaultKey,
				aad(envelope, "document"),
			);
			try {
				const document: unknown = JSON.parse(this.crypto.text(plaintext));
				validateDocument(document, envelope);
				return { vaultKey, document };
			} finally {
				this.crypto.zero(plaintext);
			}
		} catch (error) {
			this.crypto.zero(vaultKey);
			throw error;
		}
	}
	seal(
		session: VaultSession,
		envelope: EncryptedVaultEnvelope,
		nonce = this.crypto.random(24),
	): EncryptedVaultEnvelope {
		if (session.document.id !== envelope.id)
			throw new Error("Vault identifier mismatch");
		validateDocument(session.document, session.document);
		const next = { ...envelope, updatedAt: session.document.updatedAt };
		const plaintext = utf8(JSON.stringify(session.document));
		try {
			return {
				...next,
				encryptedDocument: this.encrypt(
					plaintext,
					session.vaultKey,
					nonce,
					aad(next, "document"),
				),
			};
		} finally {
			this.crypto.zero(plaintext);
		}
	}
	destroy(session: VaultSession) {
		this.crypto.zero(session.vaultKey);
	}
	generate(length = 24): string {
		if (!Number.isSafeInteger(length) || length < 16 || length > 128)
			throw new Error("Invalid generated password length");
		const alphabet =
			"ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*-_=+?";
		const limit = 256 - (256 % alphabet.length);
		let result = "";
		while (result.length < length) {
			const bytes = this.crypto.random(64);
			try {
				for (const byte of bytes)
					if (byte < limit && result.length < length)
						result += alphabet[byte % alphabet.length];
			} finally {
				this.crypto.zero(bytes);
			}
		}
		return result;
	}
}
