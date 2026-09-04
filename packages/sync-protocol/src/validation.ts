import {
	type DecimalBigInt,
	ENCRYPTED_RECORD_FORMAT_V2,
	ENCRYPTION_ALGORITHM,
	type EncryptedPayloadV2,
	type EncryptedRecordEnvelopeV2,
	MAX_RECORD_CIPHERTEXT_BYTES,
	MAX_WIRE_BIGINT,
	type PasswordKdfParametersV2,
	SYNC_PROTOCOL_VERSION,
	type SyncChange,
	type SyncChangesResponse,
	type SyncMutationRequest,
	VAULT_KEY_FORMAT_V2,
	type VaultKeyEnvelopeV2,
} from "./model";

const UUID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const BASE64_URL = /^[A-Za-z0-9_-]+$/;
const DECIMAL = /^(0|[1-9][0-9]*)$/;
const MAX_WIRE_BIGINT_DIGITS = MAX_WIRE_BIGINT.toString(10).length;
const MAX_IDENTIFIER_BYTES = 128;
const MAX_TIMESTAMP_BYTES = 64;
const MAX_KDF_OPERATIONS_LIMIT = 10;
const MAX_KDF_MEMORY_LIMIT = 512 * 1024 * 1024;
const ARGON2_SALT_BYTES = 16;
const XCHACHA_NONCE_BYTES = 24;
const POLY1305_TAG_BYTES = 16;

export class ProtocolValidationError extends Error {
	readonly name = "ProtocolValidationError";
}

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

const fail = (message: string): never => {
	throw new ProtocolValidationError(message);
};

const assertObject = (
	value: unknown,
	label: string,
): Record<string, unknown> => {
	if (!isRecord(value)) fail(`${label} must be an object`);
	return value as Record<string, unknown>;
};

const utf8Length = (value: string): number =>
	new TextEncoder().encode(value).length;

const isWellFormedUtf16 = (value: string): boolean => {
	for (let index = 0; index < value.length; index += 1) {
		const unit = value.charCodeAt(index);
		if (unit >= 0xd800 && unit <= 0xdbff) {
			const next = value.charCodeAt(index + 1);
			if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
			index += 1;
		} else if (unit >= 0xdc00 && unit <= 0xdfff) {
			return false;
		}
	}
	return true;
};

const assertUuid = (value: unknown, label: string): string => {
	if (typeof value !== "string" || !UUID.test(value)) {
		fail(`${label} must be a canonical lowercase UUID`);
	}
	return value as string;
};

const assertIdentifier = (value: unknown, label: string): string => {
	if (
		typeof value !== "string" ||
		value.length === 0 ||
		!isWellFormedUtf16(value) ||
		utf8Length(value) > MAX_IDENTIFIER_BYTES
	) {
		fail(`${label} must be a non-empty string of at most 128 UTF-8 bytes`);
	}
	return value as string;
};

const assertTimestamp = (value: unknown, label: string): string => {
	if (
		typeof value !== "string" ||
		utf8Length(value) > MAX_TIMESTAMP_BYTES ||
		!Number.isFinite(Date.parse(value)) ||
		new Date(value).toISOString() !== value
	) {
		fail(`${label} must be a canonical ISO 8601 UTC timestamp`);
	}
	return value as string;
};

export const parseDecimalBigInt = (
	value: unknown,
	options: { readonly allowZero?: boolean; readonly label?: string } = {},
): DecimalBigInt => {
	const label = options.label ?? "value";
	if (
		typeof value !== "string" ||
		value.length > MAX_WIRE_BIGINT_DIGITS ||
		!DECIMAL.test(value)
	) {
		fail(`${label} must be a canonical unsigned decimal string`);
	}
	const parsed = BigInt(value as string);
	if ((!options.allowZero && parsed === 0n) || parsed > MAX_WIRE_BIGINT) {
		fail(`${label} is outside the supported bigint range`);
	}
	return value as DecimalBigInt;
};

export const decimalBigInt = (
	value: bigint,
	options: { readonly allowZero?: boolean; readonly label?: string } = {},
): DecimalBigInt => parseDecimalBigInt(value.toString(10), options);

export const decodeBase64Url = (
	value: unknown,
	label: string,
	limits: {
		readonly exact?: number;
		readonly min?: number;
		readonly max?: number;
	},
): Uint8Array => {
	if (typeof value !== "string" || !BASE64_URL.test(value)) {
		fail(`${label} must be unpadded URL-safe base64`);
	}
	const encoded = value as string;
	if (
		limits.max !== undefined &&
		encoded.length > Math.ceil((limits.max * 4) / 3)
	) {
		fail(`${label} exceeds the maximum size`);
	}
	if (
		limits.exact !== undefined &&
		encoded.length !== Math.ceil((limits.exact * 4) / 3)
	) {
		fail(`${label} must decode to exactly ${limits.exact} bytes`);
	}
	const remainder = encoded.length % 4;
	if (remainder === 1) fail(`${label} has an invalid base64 length`);
	const padded =
		encoded.replace(/-/g, "+").replace(/_/g, "/") +
		"=".repeat((4 - remainder) % 4);
	let bytes = new Uint8Array(0);
	try {
		const binary = atob(padded);
		bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
	} catch {
		fail(`${label} is not valid base64`);
	}
	const canonical = btoa(
		Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""),
	)
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/g, "");
	if (canonical !== encoded) fail(`${label} is not canonical base64`);
	if (limits.exact !== undefined && bytes.length !== limits.exact) {
		fail(`${label} must decode to exactly ${limits.exact} bytes`);
	}
	if (limits.min !== undefined && bytes.length < limits.min) {
		fail(`${label} is too short`);
	}
	if (limits.max !== undefined && bytes.length > limits.max) {
		fail(`${label} exceeds the maximum size`);
	}
	return bytes;
};

const assertKdf = (value: unknown): PasswordKdfParametersV2 => {
	const kdf = assertObject(value, "kdf");
	if (
		!hasExactKeys(kdf, ["algorithm", "salt", "operationsLimit", "memoryLimit"])
	) {
		fail("kdf contains missing or unknown fields");
	}
	if (kdf.algorithm !== "argon2id13") fail("Unsupported KDF algorithm");
	decodeBase64Url(kdf.salt, "kdf.salt", { exact: ARGON2_SALT_BYTES });
	if (
		!Number.isSafeInteger(kdf.operationsLimit) ||
		(kdf.operationsLimit as number) < 1 ||
		(kdf.operationsLimit as number) > MAX_KDF_OPERATIONS_LIMIT ||
		!Number.isSafeInteger(kdf.memoryLimit) ||
		(kdf.memoryLimit as number) < 8 * 1024 ||
		(kdf.memoryLimit as number) > MAX_KDF_MEMORY_LIMIT
	) {
		fail("Unsupported KDF parameters");
	}
	return kdf as unknown as PasswordKdfParametersV2;
};

const assertPayload = (value: unknown): EncryptedPayloadV2 => {
	const payload = assertObject(value, "wrappedVaultKey");
	if (!hasExactKeys(payload, ["algorithm", "nonce", "ciphertext"])) {
		fail("wrappedVaultKey contains missing or unknown fields");
	}
	if (payload.algorithm !== ENCRYPTION_ALGORITHM) {
		fail("Unsupported encryption algorithm");
	}
	decodeBase64Url(payload.nonce, "wrappedVaultKey.nonce", {
		exact: XCHACHA_NONCE_BYTES,
	});
	decodeBase64Url(payload.ciphertext, "wrappedVaultKey.ciphertext", {
		exact: 32 + POLY1305_TAG_BYTES,
	});
	return payload as unknown as EncryptedPayloadV2;
};

export const parseVaultKeyEnvelopeV2 = (value: unknown): VaultKeyEnvelopeV2 => {
	const envelope = assertObject(value, "VaultKeyEnvelopeV2");
	if (
		!hasExactKeys(envelope, [
			"format",
			"version",
			"vaultId",
			"keyRevision",
			"kdf",
			"wrappedVaultKey",
			"createdAt",
		])
	) {
		fail("VaultKeyEnvelopeV2 contains missing or unknown fields");
	}
	if (
		envelope.format !== VAULT_KEY_FORMAT_V2 ||
		envelope.version !== SYNC_PROTOCOL_VERSION
	) {
		fail("Unsupported vault-key envelope format");
	}
	assertIdentifier(envelope.vaultId, "vaultId");
	parseDecimalBigInt(envelope.keyRevision, { label: "keyRevision" });
	assertKdf(envelope.kdf);
	assertPayload(envelope.wrappedVaultKey);
	assertTimestamp(envelope.createdAt, "createdAt");
	return envelope as unknown as VaultKeyEnvelopeV2;
};

export const parseEncryptedRecordEnvelopeV2 = (
	value: unknown,
): EncryptedRecordEnvelopeV2 => {
	const envelope = assertObject(value, "EncryptedRecordEnvelopeV2");
	if (
		!hasExactKeys(envelope, [
			"format",
			"version",
			"vaultId",
			"recordId",
			"revision",
			"nonce",
			"ciphertext",
		])
	) {
		fail("EncryptedRecordEnvelopeV2 contains missing or unknown fields");
	}
	if (
		envelope.format !== ENCRYPTED_RECORD_FORMAT_V2 ||
		envelope.version !== SYNC_PROTOCOL_VERSION
	) {
		fail("Unsupported encrypted-record envelope format");
	}
	assertIdentifier(envelope.vaultId, "vaultId");
	assertIdentifier(envelope.recordId, "recordId");
	parseDecimalBigInt(envelope.revision, { label: "revision" });
	decodeBase64Url(envelope.nonce, "nonce", { exact: XCHACHA_NONCE_BYTES });
	decodeBase64Url(envelope.ciphertext, "ciphertext", {
		min: POLY1305_TAG_BYTES,
		max: MAX_RECORD_CIPHERTEXT_BYTES,
	});
	return envelope as unknown as EncryptedRecordEnvelopeV2;
};

export const parseSyncMutationRequest = (
	value: unknown,
): SyncMutationRequest => {
	const mutation = assertObject(value, "SyncMutationRequest");
	if (!hasExactKeys(mutation, ["mutationId", "baseRevision", "record"])) {
		fail("SyncMutationRequest contains missing or unknown fields");
	}
	assertUuid(mutation.mutationId, "mutationId");
	const base = parseDecimalBigInt(mutation.baseRevision, {
		allowZero: true,
		label: "baseRevision",
	});
	const record = parseEncryptedRecordEnvelopeV2(mutation.record);
	if (BigInt(record.revision) !== BigInt(base) + 1n) {
		fail("record.revision must equal baseRevision + 1");
	}
	return mutation as unknown as SyncMutationRequest;
};

export const parseSyncChange = (value: unknown): SyncChange => {
	const change = assertObject(value, "SyncChange");
	if (!hasExactKeys(change, ["cursor", "record"])) {
		fail("SyncChange contains missing or unknown fields");
	}
	parseDecimalBigInt(change.cursor, { allowZero: true, label: "cursor" });
	parseEncryptedRecordEnvelopeV2(change.record);
	return change as unknown as SyncChange;
};

export const parseSyncChangesResponse = (
	value: unknown,
): SyncChangesResponse => {
	const response = assertObject(value, "SyncChangesResponse");
	if (!hasExactKeys(response, ["changes", "nextCursor", "hasMore"])) {
		fail("SyncChangesResponse contains missing or unknown fields");
	}
	if (!Array.isArray(response.changes) || response.changes.length > 1_000) {
		fail("changes must be an array with at most 1000 entries");
	}
	for (const change of response.changes as ReadonlyArray<unknown>) {
		parseSyncChange(change);
	}
	parseDecimalBigInt(response.nextCursor, {
		allowZero: true,
		label: "nextCursor",
	});
	if (typeof response.hasMore !== "boolean") fail("hasMore must be a boolean");
	return response as unknown as SyncChangesResponse;
};
