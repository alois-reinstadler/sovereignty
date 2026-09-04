import {
	type DecimalBigInt,
	decimalBigInt,
	decodeBase64Url,
	ENCRYPTED_RECORD_FORMAT_V2,
	ENCRYPTION_ALGORITHM,
	type EncryptedRecordEnvelopeV2,
	encodeRecordAad,
	encodeVaultKeyAad,
	MAX_RECORD_CIPHERTEXT_BYTES,
	type PasswordKdfParametersV2,
	ProtocolValidationError,
	parseEncryptedRecordEnvelopeV2,
	parseVaultKeyEnvelopeV2,
	SYNC_PROTOCOL_VERSION,
	VAULT_KEY_FORMAT_V2,
	type VaultKeyEnvelopeV2,
} from "@svrgn/sync-protocol";
import { Effect } from "effect";
import sodium from "libsodium-wrappers-sumo";
import {
	type LoginRecordPlaintext,
	type TombstoneRecordPlaintext,
	VaultAuthenticationError,
	VaultCryptoError,
	VaultFormatError,
	type VaultItem,
	type VaultRecordPlaintext,
	type VaultSession,
} from "./model";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const MAX_KDF_OPERATIONS_LIMIT = 10;
const MAX_KDF_MEMORY_LIMIT = 512 * 1024 * 1024;

type RecordCryptoError = VaultCryptoError | VaultFormatError;

export interface RecordEncryptionOptions {
	/** Deterministic sources are only for tests. Production must use sodium randomness. */
	randomBytes?: (length: number) => Uint8Array;
}

export interface VaultKeyEnvelopeCreationOptions
	extends RecordEncryptionOptions {
	createdAt?: string;
	keyRevision?: DecimalBigInt;
	kdf?: Partial<
		Pick<PasswordKdfParametersV2, "memoryLimit" | "operationsLimit">
	>;
}

export interface V1ToV2ConversionOptions
	extends VaultKeyEnvelopeCreationOptions {
	recordRevision?: DecimalBigInt;
}

export interface ConvertedVaultV2 {
	/** The original unlocked v1 session; its vault key is reused, not rotated. */
	session: VaultSession;
	keyEnvelope: VaultKeyEnvelopeV2;
	records: ReadonlyArray<EncryptedRecordEnvelopeV2>;
}

const encode = (bytes: Uint8Array): string =>
	sodium.to_base64(bytes, sodium.base64_variants.URLSAFE_NO_PADDING);

const ensureKey = (vaultKey: Uint8Array): void => {
	if (
		!(vaultKey instanceof Uint8Array) ||
		vaultKey.length !== sodium.crypto_aead_xchacha20poly1305_ietf_KEYBYTES
	) {
		throw new VaultFormatError({ message: "The vault key must be 32 bytes" });
	}
};

const deriveWrappingKey = (
	masterPassword: string,
	kdf: PasswordKdfParametersV2,
): Uint8Array => {
	if (!masterPassword) {
		throw new VaultFormatError({ message: "A master password is required" });
	}
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
	const salt = decodeBase64Url(kdf.salt, "kdf.salt", {
		exact: sodium.crypto_pwhash_SALTBYTES,
	});
	return sodium.crypto_pwhash(
		sodium.crypto_aead_xchacha20poly1305_ietf_KEYBYTES,
		masterPassword,
		salt,
		kdf.operationsLimit,
		kdf.memoryLimit,
		sodium.crypto_pwhash_ALG_ARGON2ID13,
	);
};

const cryptoEffect = <A>(
	operation: () => Promise<A>,
): Effect.Effect<A, RecordCryptoError> =>
	Effect.tryPromise({
		try: operation,
		catch: (cause) => {
			if (cause instanceof VaultFormatError) return cause;
			if (cause instanceof ProtocolValidationError) {
				return new VaultFormatError({
					message: "The v2 envelope is invalid",
					cause,
				});
			}
			return new VaultCryptoError({
				message: "Record cryptography failed",
				cause,
			});
		},
	});

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const hasExactKeys = (
	value: Record<string, unknown>,
	keys: ReadonlyArray<string>,
): boolean => {
	const actual = Object.keys(value).sort();
	const expected = [...keys].sort();
	return (
		actual.length === expected.length &&
		actual.every((key, index) => key === expected[index])
	);
};

const isValidTimestamp = (value: unknown): value is string =>
	typeof value === "string" &&
	value.length <= 64 &&
	Number.isFinite(Date.parse(value)) &&
	new Date(value).toISOString() === value;

const assertVaultItem = (value: unknown, recordId: string): VaultItem => {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, [
			"id",
			"title",
			"username",
			"password",
			"website",
			"notes",
			"favorite",
			"createdAt",
			"updatedAt",
		]) ||
		value.id !== recordId ||
		![
			"id",
			"title",
			"username",
			"password",
			"website",
			"notes",
			"createdAt",
			"updatedAt",
		].every((field) => typeof value[field] === "string") ||
		typeof value.favorite !== "boolean" ||
		!isValidTimestamp(value.createdAt) ||
		!isValidTimestamp(value.updatedAt)
	) {
		throw new VaultFormatError({
			message: "The decrypted login record is invalid",
		});
	}
	return {
		id: value.id as string,
		title: value.title as string,
		username: value.username as string,
		password: value.password as string,
		website: value.website as string,
		notes: value.notes as string,
		favorite: value.favorite as boolean,
		createdAt: value.createdAt as string,
		updatedAt: value.updatedAt as string,
	};
};

const assertPlaintext = (
	value: unknown,
	recordId: string,
): VaultRecordPlaintext => {
	if (!isRecord(value) || value.schemaVersion !== 1) {
		throw new VaultFormatError({
			message: "The decrypted record schema is invalid",
		});
	}
	if (
		value.kind === "login" &&
		hasExactKeys(value, ["schemaVersion", "kind", "item"])
	) {
		return {
			schemaVersion: 1,
			kind: "login",
			item: assertVaultItem(value.item, recordId),
		};
	}
	if (
		value.kind === "tombstone" &&
		hasExactKeys(value, ["schemaVersion", "kind", "deletedAt"]) &&
		isValidTimestamp(value.deletedAt)
	) {
		return { schemaVersion: 1, kind: "tombstone", deletedAt: value.deletedAt };
	}
	throw new VaultFormatError({
		message: "The decrypted record kind is invalid",
	});
};

export const encryptVaultRecord = (
	vaultKey: Uint8Array,
	vaultId: string,
	recordId: string,
	revision: DecimalBigInt,
	plaintext: VaultRecordPlaintext,
	options: RecordEncryptionOptions = {},
): Effect.Effect<EncryptedRecordEnvelopeV2, RecordCryptoError> =>
	cryptoEffect(async () => {
		await sodium.ready;
		ensureKey(vaultKey);
		const validatedPlaintext = assertPlaintext(plaintext, recordId);
		const envelopeBase = {
			format: ENCRYPTED_RECORD_FORMAT_V2,
			version: SYNC_PROTOCOL_VERSION,
			vaultId,
			recordId,
			revision,
		};
		const encoded = encoder.encode(JSON.stringify(validatedPlaintext));
		try {
			if (
				encoded.length + sodium.crypto_aead_xchacha20poly1305_ietf_ABYTES >
				MAX_RECORD_CIPHERTEXT_BYTES
			) {
				throw new VaultFormatError({
					message: "The encrypted record exceeds 256 KiB",
				});
			}
			const takeRandom = options.randomBytes ?? sodium.randombytes_buf;
			const nonce = takeRandom(
				sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES,
			);
			if (
				nonce.length !== sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES
			) {
				throw new VaultFormatError({
					message: "The random source returned an invalid nonce",
				});
			}
			const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
				encoded,
				encodeRecordAad(envelopeBase),
				null,
				nonce,
				vaultKey,
			);
			return parseEncryptedRecordEnvelopeV2({
				...envelopeBase,
				nonce: encode(nonce),
				ciphertext: encode(ciphertext),
			});
		} finally {
			sodium.memzero(encoded);
		}
	});

export const encryptLoginRecord = (
	vaultKey: Uint8Array,
	vaultId: string,
	item: VaultItem,
	revision: DecimalBigInt,
	options?: RecordEncryptionOptions,
): Effect.Effect<EncryptedRecordEnvelopeV2, RecordCryptoError> =>
	encryptVaultRecord(
		vaultKey,
		vaultId,
		item.id,
		revision,
		{ schemaVersion: 1, kind: "login", item } satisfies LoginRecordPlaintext,
		options,
	);

export const encryptTombstoneRecord = (
	vaultKey: Uint8Array,
	vaultId: string,
	recordId: string,
	deletedAt: string,
	revision: DecimalBigInt,
	options?: RecordEncryptionOptions,
): Effect.Effect<EncryptedRecordEnvelopeV2, RecordCryptoError> =>
	encryptVaultRecord(
		vaultKey,
		vaultId,
		recordId,
		revision,
		{
			schemaVersion: 1,
			kind: "tombstone",
			deletedAt,
		} satisfies TombstoneRecordPlaintext,
		options,
	);

export const decryptVaultRecord = (
	vaultKey: Uint8Array,
	envelope: EncryptedRecordEnvelopeV2,
): Effect.Effect<
	VaultRecordPlaintext,
	VaultAuthenticationError | RecordCryptoError
> =>
	Effect.tryPromise({
		try: async () => {
			await sodium.ready;
			ensureKey(vaultKey);
			let validated: EncryptedRecordEnvelopeV2;
			try {
				validated = parseEncryptedRecordEnvelopeV2(envelope);
			} catch (cause) {
				throw new VaultFormatError({
					message: "The encrypted record envelope is invalid",
					cause,
				});
			}
			let plaintext: Uint8Array;
			try {
				plaintext = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
					null,
					decodeBase64Url(validated.ciphertext, "ciphertext", {
						min: sodium.crypto_aead_xchacha20poly1305_ietf_ABYTES,
						max: MAX_RECORD_CIPHERTEXT_BYTES,
					}),
					encodeRecordAad(validated),
					decodeBase64Url(validated.nonce, "nonce", {
						exact: sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES,
					}),
					vaultKey,
				);
			} catch (cause) {
				if (cause instanceof VaultFormatError) throw cause;
				throw new VaultAuthenticationError({
					message: "The record could not be authenticated",
				});
			}
			try {
				try {
					return assertPlaintext(
						JSON.parse(decoder.decode(plaintext)),
						validated.recordId,
					);
				} catch (cause) {
					if (cause instanceof VaultFormatError) throw cause;
					throw new VaultFormatError({
						message: "The decrypted record payload is invalid",
						cause,
					});
				}
			} finally {
				sodium.memzero(plaintext);
			}
		},
		catch: (cause) => {
			if (
				cause instanceof VaultAuthenticationError ||
				cause instanceof VaultFormatError
			) {
				return cause;
			}
			return new VaultCryptoError({
				message: "Record cryptography failed",
				cause,
			});
		},
	});

export const createVaultKeyEnvelopeV2 = (
	vaultKey: Uint8Array,
	masterPassword: string,
	vaultId: string,
	options: VaultKeyEnvelopeCreationOptions = {},
): Effect.Effect<VaultKeyEnvelopeV2, RecordCryptoError> =>
	cryptoEffect(async () => {
		await sodium.ready;
		ensureKey(vaultKey);
		const takeRandom = options.randomBytes ?? sodium.randombytes_buf;
		const kdf: PasswordKdfParametersV2 = {
			algorithm: "argon2id13",
			salt: encode(takeRandom(sodium.crypto_pwhash_SALTBYTES)),
			operationsLimit:
				options.kdf?.operationsLimit ??
				sodium.crypto_pwhash_OPSLIMIT_INTERACTIVE,
			memoryLimit:
				options.kdf?.memoryLimit ?? sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE,
		};
		const envelopeBase = {
			format: VAULT_KEY_FORMAT_V2,
			version: SYNC_PROTOCOL_VERSION,
			vaultId,
			keyRevision: options.keyRevision ?? decimalBigInt(1n),
			kdf,
			createdAt: options.createdAt ?? new Date().toISOString(),
		};
		const wrappingKey = deriveWrappingKey(masterPassword, kdf);
		try {
			const nonce = takeRandom(
				sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES,
			);
			if (
				nonce.length !== sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES
			) {
				throw new VaultFormatError({
					message: "The random source returned an invalid nonce",
				});
			}
			return parseVaultKeyEnvelopeV2({
				...envelopeBase,
				wrappedVaultKey: {
					algorithm: ENCRYPTION_ALGORITHM,
					nonce: encode(nonce),
					ciphertext: encode(
						sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
							vaultKey,
							encodeVaultKeyAad(envelopeBase),
							null,
							nonce,
							wrappingKey,
						),
					),
				},
			});
		} finally {
			sodium.memzero(wrappingKey);
		}
	});

export const unwrapVaultKeyV2 = (
	envelope: VaultKeyEnvelopeV2,
	masterPassword: string,
): Effect.Effect<Uint8Array, VaultAuthenticationError | RecordCryptoError> =>
	Effect.tryPromise({
		try: async () => {
			await sodium.ready;
			let validated: VaultKeyEnvelopeV2;
			try {
				validated = parseVaultKeyEnvelopeV2(envelope);
			} catch (cause) {
				throw new VaultFormatError({
					message: "The vault-key envelope is invalid",
					cause,
				});
			}
			const wrappingKey = deriveWrappingKey(masterPassword, validated.kdf);
			try {
				return sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
					null,
					decodeBase64Url(
						validated.wrappedVaultKey.ciphertext,
						"wrappedVaultKey.ciphertext",
						{
							exact:
								sodium.crypto_aead_xchacha20poly1305_ietf_KEYBYTES +
								sodium.crypto_aead_xchacha20poly1305_ietf_ABYTES,
						},
					),
					encodeVaultKeyAad(validated),
					decodeBase64Url(
						validated.wrappedVaultKey.nonce,
						"wrappedVaultKey.nonce",
						{
							exact: sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES,
						},
					),
					wrappingKey,
				);
			} catch {
				throw new VaultAuthenticationError({
					message:
						"The master password is incorrect or the vault key was modified",
				});
			} finally {
				sodium.memzero(wrappingKey);
			}
		},
		catch: (cause) => {
			if (
				cause instanceof VaultAuthenticationError ||
				cause instanceof VaultFormatError
			) {
				return cause;
			}
			return new VaultCryptoError({
				message: "Vault-key cryptography failed",
				cause,
			});
		},
	});

export const convertVaultV1ToV2 = (
	session: VaultSession,
	masterPassword: string,
	options: V1ToV2ConversionOptions = {},
): Effect.Effect<ConvertedVaultV2, RecordCryptoError> =>
	Effect.gen(function* () {
		const itemIds = new Set<string>();
		for (const item of session.document.items) {
			if (itemIds.has(item.id)) {
				return yield* Effect.fail(
					new VaultFormatError({
						message: "The v1 vault contains duplicate item identifiers",
					}),
				);
			}
			itemIds.add(item.id);
		}
		const keyEnvelope = yield* createVaultKeyEnvelopeV2(
			session.vaultKey,
			masterPassword,
			session.document.id,
			{
				...options,
				createdAt: options.createdAt ?? session.document.createdAt,
			},
		);
		const revision = options.recordRevision ?? decimalBigInt(1n);
		const records: Array<EncryptedRecordEnvelopeV2> = [];
		for (const item of session.document.items) {
			records.push(
				yield* encryptLoginRecord(
					session.vaultKey,
					session.document.id,
					item,
					revision,
					options,
				),
			);
		}
		return { session, keyEnvelope, records };
	});
