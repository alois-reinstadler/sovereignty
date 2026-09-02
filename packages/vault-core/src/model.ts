import { Data } from "effect";

export const VAULT_FORMAT_VERSION = 1 as const;
export const VAULT_FORMAT = "svrgn-encrypted-vault" as const;

export interface VaultItem {
	id: string;
	title: string;
	username: string;
	password: string;
	website: string;
	notes: string;
	favorite: boolean;
	createdAt: string;
	updatedAt: string;
}

export interface VaultDocument {
	version: typeof VAULT_FORMAT_VERSION;
	id: string;
	items: ReadonlyArray<VaultItem>;
	createdAt: string;
	updatedAt: string;
}

export interface PasswordKdfParameters {
	algorithm: "argon2id13";
	salt: string;
	operationsLimit: number;
	memoryLimit: number;
}

export interface EncryptedPayload {
	algorithm: "xchacha20-poly1305-ietf";
	nonce: string;
	ciphertext: string;
}

/**
 * Serialized, storage-safe vault data. Binary fields use URL-safe base64 without
 * padding. A format version is deliberately part of the envelope so migrations
 * can reject unsupported data rather than guessing.
 */
export interface EncryptedVaultEnvelope {
	format: typeof VAULT_FORMAT;
	version: typeof VAULT_FORMAT_VERSION;
	id: string;
	kdf: PasswordKdfParameters;
	wrappedVaultKey: EncryptedPayload;
	encryptedDocument: EncryptedPayload;
	createdAt: string;
	updatedAt: string;
}

/** The only sensitive state kept while a vault is unlocked. */
export interface VaultSession {
	vaultKey: Uint8Array;
	document: VaultDocument;
}

export interface CreatedVault {
	session: VaultSession;
	envelope: EncryptedVaultEnvelope;
}

export class VaultAuthenticationError extends Data.TaggedError(
	"VaultAuthenticationError",
)<{
	readonly message: string;
}> {}

export class VaultCryptoError extends Data.TaggedError("VaultCryptoError")<{
	readonly message: string;
	readonly cause?: unknown;
}> {}

export class VaultFormatError extends Data.TaggedError("VaultFormatError")<{
	readonly message: string;
	readonly cause?: unknown;
}> {}

export class VaultItemNotFoundError extends Data.TaggedError(
	"VaultItemNotFoundError",
)<{
	readonly id: string;
	readonly message: string;
}> {}

export class PasswordGenerationError extends Data.TaggedError(
	"PasswordGenerationError",
)<{
	readonly message: string;
}> {}
