import { Effect } from "effect";
import sodium from "libsodium-wrappers-sumo";
import {
	type CreatedVault,
	type EncryptedPayload,
	type EncryptedVaultEnvelope,
	type PasswordKdfParameters,
	VAULT_FORMAT,
	VAULT_FORMAT_VERSION,
	VaultAuthenticationError,
	VaultCryptoError,
	type VaultDocument,
	VaultFormatError,
	type VaultSession,
} from "./model";
import { createId } from "./operations";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const ENCRYPTION_ALGORITHM = "xchacha20-poly1305-ietf" as const;
const MAX_KDF_OPERATIONS_LIMIT = 10;
const MAX_KDF_MEMORY_LIMIT = 512 * 1024 * 1024;

export interface VaultCreationOptions {
	now?: string;
	id?: string;
	/** Intended for deterministic tests; production callers should not supply it. */
	randomBytes?: (length: number) => Uint8Array;
	kdf?: Partial<Pick<PasswordKdfParameters, "memoryLimit" | "operationsLimit">>;
}

type VaultError = VaultCryptoError | VaultFormatError;

const encode = (bytes: Uint8Array): string =>
	sodium.to_base64(bytes, sodium.base64_variants.URLSAFE_NO_PADDING);

const decode = (value: string): Uint8Array =>
	sodium.from_base64(value, sodium.base64_variants.URLSAFE_NO_PADDING);

const payloadAad = (
	envelope: Pick<
		EncryptedVaultEnvelope,
		"createdAt" | "id" | "kdf" | "updatedAt" | "version"
	>,
	purpose: "document" | "vault-key",
): Uint8Array =>
	encoder.encode(
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

const encrypt = (
	plaintext: Uint8Array,
	key: Uint8Array,
	nonce: Uint8Array,
	aad: Uint8Array,
): EncryptedPayload => ({
	algorithm: ENCRYPTION_ALGORITHM,
	nonce: encode(nonce),
	ciphertext: encode(
		sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
			plaintext,
			aad,
			null,
			nonce,
			key,
		),
	),
});

const decrypt = (
	payload: EncryptedPayload,
	key: Uint8Array,
	aad: Uint8Array,
): Uint8Array => {
	if (payload.algorithm !== ENCRYPTION_ALGORITHM) {
		throw new VaultFormatError({ message: "Unsupported encryption algorithm" });
	}
	return sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
		null,
		decode(payload.ciphertext),
		aad,
		decode(payload.nonce),
		key,
	);
};

const deriveWrappingKey = (
	password: string,
	kdf: PasswordKdfParameters,
): Uint8Array => {
	if (
		kdf.algorithm !== "argon2id13" ||
		!Number.isSafeInteger(kdf.operationsLimit) ||
		kdf.operationsLimit < sodium.crypto_pwhash_OPSLIMIT_MIN ||
		kdf.operationsLimit > MAX_KDF_OPERATIONS_LIMIT ||
		!Number.isSafeInteger(kdf.memoryLimit) ||
		kdf.memoryLimit < sodium.crypto_pwhash_MEMLIMIT_MIN ||
		kdf.memoryLimit > MAX_KDF_MEMORY_LIMIT
	) {
		throw new VaultFormatError({
			message: "Unsupported password derivation parameters",
		});
	}
	const salt = decode(kdf.salt);
	if (salt.length !== sodium.crypto_pwhash_SALTBYTES) {
		throw new VaultFormatError({ message: "Invalid password derivation salt" });
	}
	return sodium.crypto_pwhash(
		sodium.crypto_aead_xchacha20poly1305_ietf_KEYBYTES,
		password,
		salt,
		kdf.operationsLimit,
		kdf.memoryLimit,
		sodium.crypto_pwhash_ALG_ARGON2ID13,
	);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null;

const assertDocument = (
	value: unknown,
	envelope: EncryptedVaultEnvelope,
): VaultDocument => {
	if (
		!isRecord(value) ||
		value.version !== VAULT_FORMAT_VERSION ||
		value.id !== envelope.id ||
		!Array.isArray(value.items) ||
		typeof value.createdAt !== "string" ||
		typeof value.updatedAt !== "string" ||
		value.createdAt !== envelope.createdAt ||
		value.updatedAt !== envelope.updatedAt
	) {
		throw new VaultFormatError({
			message: "The decrypted vault document is invalid",
		});
	}
	for (const item of value.items) {
		if (
			!isRecord(item) ||
			![
				"id",
				"title",
				"username",
				"password",
				"website",
				"notes",
				"createdAt",
				"updatedAt",
			].every((field) => typeof item[field] === "string") ||
			typeof item.favorite !== "boolean"
		) {
			throw new VaultFormatError({
				message: "The decrypted vault contains an invalid item",
			});
		}
	}
	return value as unknown as VaultDocument;
};

const ensureEnvelope = (envelope: EncryptedVaultEnvelope): void => {
	if (
		!isRecord(envelope) ||
		envelope.format !== VAULT_FORMAT ||
		envelope.version !== VAULT_FORMAT_VERSION ||
		typeof envelope.id !== "string" ||
		!envelope.id ||
		typeof envelope.createdAt !== "string" ||
		!envelope.createdAt ||
		typeof envelope.updatedAt !== "string" ||
		!envelope.updatedAt ||
		!isRecord(envelope.kdf) ||
		envelope.kdf.algorithm !== "argon2id13" ||
		typeof envelope.kdf.salt !== "string" ||
		!Number.isSafeInteger(envelope.kdf.operationsLimit) ||
		!Number.isSafeInteger(envelope.kdf.memoryLimit) ||
		!isEncryptedPayload(envelope.wrappedVaultKey) ||
		!isEncryptedPayload(envelope.encryptedDocument)
	) {
		throw new VaultFormatError({
			message: "Unsupported or invalid vault envelope",
		});
	}
};

function isEncryptedPayload(value: unknown): value is EncryptedPayload {
	return (
		isRecord(value) &&
		value.algorithm === ENCRYPTION_ALGORITHM &&
		typeof value.nonce === "string" &&
		value.nonce.length > 0 &&
		typeof value.ciphertext === "string" &&
		value.ciphertext.length > 0
	);
}

const cryptoEffect = <A>(
	operation: () => Promise<A>,
): Effect.Effect<A, VaultError> =>
	Effect.tryPromise({
		try: operation,
		catch: (cause) =>
			cause instanceof VaultFormatError
				? cause
				: new VaultCryptoError({ message: "Vault cryptography failed", cause }),
	});

export const createVault = (
	masterPassword: string,
	options: VaultCreationOptions = {},
): Effect.Effect<CreatedVault, VaultError> =>
	cryptoEffect(async () => {
		await sodium.ready;
		if (!masterPassword)
			throw new VaultFormatError({ message: "A master password is required" });

		const takeRandom = options.randomBytes ?? sodium.randombytes_buf;
		const timestamp = options.now ?? new Date().toISOString();
		const id = options.id ?? createId();
		const kdf: PasswordKdfParameters = {
			algorithm: "argon2id13",
			salt: encode(takeRandom(sodium.crypto_pwhash_SALTBYTES)),
			operationsLimit:
				options.kdf?.operationsLimit ??
				sodium.crypto_pwhash_OPSLIMIT_INTERACTIVE,
			memoryLimit:
				options.kdf?.memoryLimit ?? sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE,
		};
		const document: VaultDocument = {
			version: VAULT_FORMAT_VERSION,
			id,
			items: [],
			createdAt: timestamp,
			updatedAt: timestamp,
		};
		const envelopeBase = {
			format: VAULT_FORMAT,
			version: VAULT_FORMAT_VERSION,
			id,
			kdf,
			createdAt: timestamp,
			updatedAt: timestamp,
		};
		const wrappingKey = deriveWrappingKey(masterPassword, kdf);
		const vaultKey = takeRandom(
			sodium.crypto_aead_xchacha20poly1305_ietf_KEYBYTES,
		);
		try {
			const envelope: EncryptedVaultEnvelope = {
				...envelopeBase,
				wrappedVaultKey: encrypt(
					vaultKey,
					wrappingKey,
					takeRandom(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES),
					payloadAad(envelopeBase, "vault-key"),
				),
				encryptedDocument: encrypt(
					encoder.encode(JSON.stringify(document)),
					vaultKey,
					takeRandom(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES),
					payloadAad(envelopeBase, "document"),
				),
			};
			return { session: { vaultKey, document }, envelope };
		} finally {
			sodium.memzero(wrappingKey);
		}
	});

export const unlockVault = (
	envelope: EncryptedVaultEnvelope,
	masterPassword: string,
): Effect.Effect<VaultSession, VaultAuthenticationError | VaultError> =>
	Effect.tryPromise({
		try: async () => {
			await sodium.ready;
			ensureEnvelope(envelope);
			const wrappingKey = deriveWrappingKey(masterPassword, envelope.kdf);
			let vaultKey: Uint8Array;
			try {
				vaultKey = decrypt(
					envelope.wrappedVaultKey,
					wrappingKey,
					payloadAad(envelope, "vault-key"),
				);
			} catch {
				throw new VaultAuthenticationError({
					message: "The master password is incorrect or the vault was modified",
				});
			} finally {
				sodium.memzero(wrappingKey);
			}
			try {
				const plaintext = decrypt(
					envelope.encryptedDocument,
					vaultKey,
					payloadAad(envelope, "document"),
				);
				try {
					const document = assertDocument(
						JSON.parse(decoder.decode(plaintext)),
						envelope,
					);
					return { vaultKey, document };
				} finally {
					sodium.memzero(plaintext);
				}
			} catch (cause) {
				sodium.memzero(vaultKey);
				if (cause instanceof VaultFormatError) throw cause;
				throw new VaultAuthenticationError({
					message: "The encrypted vault was modified",
				});
			}
		},
		catch: (cause) => {
			if (
				cause instanceof VaultAuthenticationError ||
				cause instanceof VaultFormatError
			)
				return cause;
			return new VaultCryptoError({
				message: "Vault cryptography failed",
				cause,
			});
		},
	});

export const sealVault = (
	session: VaultSession,
	envelope: EncryptedVaultEnvelope,
): Effect.Effect<EncryptedVaultEnvelope, VaultError> =>
	cryptoEffect(async () => {
		await sodium.ready;
		ensureEnvelope(envelope);
		if (session.document.id !== envelope.id) {
			throw new VaultFormatError({
				message: "The vault session does not match the envelope",
			});
		}
		const updatedAt = session.document.updatedAt;
		const nextEnvelope = { ...envelope, updatedAt };
		return {
			...nextEnvelope,
			encryptedDocument: encrypt(
				encoder.encode(JSON.stringify(session.document)),
				session.vaultKey,
				sodium.randombytes_buf(
					sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES,
				),
				payloadAad(nextEnvelope, "document"),
			),
		};
	});

export const destroyVaultSession = (session: VaultSession): void => {
	sodium.memzero(session.vaultKey);
};

export const serializeEncryptedVault = (
	envelope: EncryptedVaultEnvelope,
): string => JSON.stringify(envelope);

export const parseEncryptedVault = (
	serialized: string,
): EncryptedVaultEnvelope => {
	try {
		const value: unknown = JSON.parse(serialized);
		if (!isRecord(value)) throw new Error("Envelope is not an object");
		const envelope = value as unknown as EncryptedVaultEnvelope;
		ensureEnvelope(envelope);
		return envelope;
	} catch (cause) {
		if (cause instanceof VaultFormatError) throw cause;
		throw new VaultFormatError({
			message: "Could not parse the encrypted vault",
			cause,
		});
	}
};
