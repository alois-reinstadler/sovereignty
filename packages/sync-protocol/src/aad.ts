import {
	ENCRYPTED_RECORD_FORMAT_V2,
	ENCRYPTION_ALGORITHM,
	type EncryptedRecordEnvelopeV2,
	type PasswordKdfParametersV2,
	SYNC_PROTOCOL_VERSION,
	type VAULT_KEY_FORMAT_V2,
	type VaultKeyEnvelopeV2,
} from "./model";
import { parseDecimalBigInt } from "./validation";

const encoder = new TextEncoder();

const u32be = (value: number): Uint8Array => {
	if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) {
		throw new RangeError("AAD integer does not fit in u32");
	}
	const bytes = new Uint8Array(4);
	new DataView(bytes.buffer).setUint32(0, value, false);
	return bytes;
};

const u64be = (value: string | number): Uint8Array => {
	const decimal = parseDecimalBigInt(String(value), {
		allowZero: true,
		label: "AAD integer",
	});
	const bytes = new Uint8Array(8);
	new DataView(bytes.buffer).setBigUint64(0, BigInt(decimal), false);
	return bytes;
};

const utf8 = (value: string): Uint8Array => {
	const bytes = encoder.encode(value);
	return concat(u32be(bytes.length), bytes);
};

const concat = (...parts: ReadonlyArray<Uint8Array>): Uint8Array => {
	const result = new Uint8Array(
		parts.reduce((size, part) => size + part.length, 0),
	);
	let offset = 0;
	for (const part of parts) {
		result.set(part, offset);
		offset += part.length;
	}
	return result;
};

/**
 * Stable record AAD (all integers big-endian):
 * `lp(format) || u32(version) || lp(vaultId) || lp(recordId) || u64(revision)`.
 * `lp` is a u32 UTF-8 byte length followed by those bytes. No JSON or platform
 * string collation participates, so every implementation can reproduce it.
 */
export const encodeRecordAad = (
	envelope: Pick<
		EncryptedRecordEnvelopeV2,
		"format" | "version" | "vaultId" | "recordId" | "revision"
	>,
): Uint8Array =>
	concat(
		utf8(envelope.format),
		u32be(envelope.version),
		utf8(envelope.vaultId),
		utf8(envelope.recordId),
		u64be(envelope.revision),
	);

export interface VaultKeyAadInput {
	format: typeof VAULT_KEY_FORMAT_V2;
	version: typeof SYNC_PROTOCOL_VERSION;
	vaultId: string;
	keyRevision: string;
	kdf: PasswordKdfParametersV2;
	createdAt: string;
}

/** Stable AAD for the master-password wrapped vault key. */
export const encodeVaultKeyAad = (
	envelope: Pick<
		VaultKeyEnvelopeV2,
		"format" | "version" | "vaultId" | "keyRevision" | "kdf" | "createdAt"
	>,
): Uint8Array =>
	concat(
		utf8(envelope.format),
		u32be(envelope.version),
		utf8(envelope.vaultId),
		u64be(envelope.keyRevision),
		utf8(envelope.kdf.algorithm),
		utf8(envelope.kdf.salt),
		u64be(envelope.kdf.operationsLimit),
		u64be(envelope.kdf.memoryLimit),
		utf8(ENCRYPTION_ALGORITHM),
		utf8(envelope.createdAt),
	);

export const recordAadFor = (
	vaultId: string,
	recordId: string,
	revision: string,
): Uint8Array =>
	encodeRecordAad({
		format: ENCRYPTED_RECORD_FORMAT_V2,
		version: SYNC_PROTOCOL_VERSION,
		vaultId,
		recordId,
		revision: revision as EncryptedRecordEnvelopeV2["revision"],
	});
