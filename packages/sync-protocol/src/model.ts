export const VAULT_KEY_FORMAT_V2 = "svrgn-vault-key" as const;
export const ENCRYPTED_RECORD_FORMAT_V2 = "svrgn-vault-record" as const;
export const SYNC_PROTOCOL_VERSION = 2 as const;
export const ENCRYPTION_ALGORITHM = "xchacha20-poly1305-ietf" as const;

/** PostgreSQL bigint is the storage boundary selected for revisions/cursors. */
export const MAX_WIRE_BIGINT = 9_223_372_036_854_775_807n;
export const MAX_RECORD_CIPHERTEXT_BYTES = 256 * 1024;

/** Canonical, unsigned base-10 integer. It never crosses JSON as a JS number. */
export type DecimalBigInt = string & { readonly DecimalBigInt: unique symbol };

export interface PasswordKdfParametersV2 {
	algorithm: "argon2id13";
	salt: string;
	operationsLimit: number;
	memoryLimit: number;
}

export interface EncryptedPayloadV2 {
	algorithm: typeof ENCRYPTION_ALGORITHM;
	nonce: string;
	ciphertext: string;
}

export interface VaultKeyEnvelopeV2 {
	format: typeof VAULT_KEY_FORMAT_V2;
	version: typeof SYNC_PROTOCOL_VERSION;
	vaultId: string;
	keyRevision: DecimalBigInt;
	kdf: PasswordKdfParametersV2;
	wrappedVaultKey: EncryptedPayloadV2;
	createdAt: string;
}

export interface EncryptedRecordEnvelopeV2 {
	format: typeof ENCRYPTED_RECORD_FORMAT_V2;
	version: typeof SYNC_PROTOCOL_VERSION;
	vaultId: string;
	recordId: string;
	revision: DecimalBigInt;
	nonce: string;
	ciphertext: string;
}

export interface SyncMutationRequest {
	mutationId: string;
	baseRevision: DecimalBigInt;
	record: EncryptedRecordEnvelopeV2;
}

export interface SyncChange {
	cursor: DecimalBigInt;
	record: EncryptedRecordEnvelopeV2;
}

export interface SyncChangesResponse {
	changes: ReadonlyArray<SyncChange>;
	nextCursor: DecimalBigInt;
	hasMore: boolean;
}
