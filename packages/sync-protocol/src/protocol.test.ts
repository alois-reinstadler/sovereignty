import { describe, expect, it } from "vitest";
import {
	decimalBigInt,
	ENCRYPTED_RECORD_FORMAT_V2,
	type EncryptedRecordEnvelopeV2,
	encodeRecordAad,
	encodeVaultKeyAad,
	MAX_RECORD_CIPHERTEXT_BYTES,
	MAX_WIRE_BIGINT,
	ProtocolValidationError,
	parseDecimalBigInt,
	parseEncryptedRecordEnvelopeV2,
	parseSyncChangesResponse,
	parseSyncMutationRequest,
	parseVaultKeyEnvelopeV2,
	SYNC_PROTOCOL_VERSION,
} from "./index";

const VAULT_ID = "018f3d3e-8bb7-7cc8-8e02-3e8cad8d5b74";
const MUTATION_ID = "018f3d3e-8bb7-7cc8-8e02-3e8cad8d5b75";

const base64 = (length: number): string => {
	const bytes = new Uint8Array(length).fill(7);
	let binary = "";
	for (let offset = 0; offset < bytes.length; offset += 0x8000) {
		binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
	}
	return btoa(binary)
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/g, "");
};

const record = (revision = "1"): EncryptedRecordEnvelopeV2 => ({
	format: ENCRYPTED_RECORD_FORMAT_V2,
	version: SYNC_PROTOCOL_VERSION,
	vaultId: VAULT_ID,
	recordId: "legacy-item-id",
	revision: parseDecimalBigInt(revision),
	nonce: base64(24),
	ciphertext: base64(16),
});

describe("decimal bigint wire values", () => {
	it("accepts canonical values through the signed int8 upper bound", () => {
		expect(parseDecimalBigInt("1")).toBe("1");
		expect(parseDecimalBigInt(MAX_WIRE_BIGINT.toString())).toBe(
			"9223372036854775807",
		);
		expect(parseDecimalBigInt("0", { allowZero: true })).toBe("0");
		expect(decimalBigInt(42n)).toBe("42");
	});

	it.each([
		"",
		"00",
		"01",
		"-1",
		"+1",
		"1.0",
		" 1",
		"9223372036854775808",
		"9".repeat(100_000),
	])("rejects non-canonical or out-of-range value %j", (value) => {
		expect(() => parseDecimalBigInt(value)).toThrow(ProtocolValidationError);
	});
});

describe("record AAD", () => {
	it("has a fixed cross-platform UTF-8 and big-endian vector", () => {
		const bytes = encodeRecordAad({
			format: ENCRYPTED_RECORD_FORMAT_V2,
			version: SYNC_PROTOCOL_VERSION,
			vaultId: VAULT_ID,
			recordId: "record-π",
			revision: parseDecimalBigInt("42"),
		});

		expect(
			Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(""),
		).toBe(
			"00000012737672676e2d7661756c742d7265636f7264000000020000002430313866336433652d386262372d376363382d386530322d336538636164386435623734000000097265636f72642dcf80000000000000002a",
		);
	});

	it("rejects ill-formed UTF-16 instead of allowing AAD collisions", () => {
		expect(() =>
			encodeRecordAad({
				format: ENCRYPTED_RECORD_FORMAT_V2,
				version: SYNC_PROTOCOL_VERSION,
				vaultId: "vault-\ud800",
				recordId: "record",
				revision: parseDecimalBigInt("1"),
			}),
		).toThrow(/well-formed UTF-16/);
	});

	it("has a fixed cross-platform vault-key vector", () => {
		const bytes = encodeVaultKeyAad({
			format: "svrgn-vault-key",
			version: SYNC_PROTOCOL_VERSION,
			vaultId: VAULT_ID,
			keyRevision: parseDecimalBigInt("3"),
			kdf: {
				algorithm: "argon2id13",
				salt: "AAECAwQFBgcICQoLDA0ODw",
				operationsLimit: 2,
				memoryLimit: 67_108_864,
			},
			createdAt: "2026-09-03T12:00:00.000Z",
		});

		expect(
			Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(""),
		).toBe(
			"0000000f737672676e2d7661756c742d6b6579000000020000002430313866336433652d386262372d376363382d386530322d33653863616438643562373400000000000000030000000a6172676f6e32696431330000001641414543417751464267634943516f4c4441304f447700000000000000020000000004000000000000177863686163686132302d706f6c79313330352d6965746600000018323032362d30392d30335431323a30303a30302e3030305a",
		);
	});
});

describe("sync protocol validation", () => {
	it("validates a mutation and paged changes without coercion", () => {
		const mutation = {
			mutationId: MUTATION_ID,
			baseRevision: "0",
			record: record(),
		};
		expect(parseSyncMutationRequest(mutation)).toBe(mutation);

		const response = {
			changes: [{ cursor: "7", record: record() }],
			nextCursor: "7",
			hasMore: false,
		};
		expect(parseSyncChangesResponse(response)).toBe(response);
	});

	it("rejects revision jumps, unknown fields, and malformed binary fields", () => {
		expect(() =>
			parseSyncMutationRequest({
				mutationId: MUTATION_ID,
				baseRevision: "2",
				record: record("4"),
			}),
		).toThrow(/baseRevision \+ 1/);
		expect(() =>
			parseEncryptedRecordEnvelopeV2({ ...record(), serverCanReadThis: true }),
		).toThrow(/unknown fields/);
		expect(() =>
			parseEncryptedRecordEnvelopeV2({ ...record(), nonce: base64(23) }),
		).toThrow(/exactly 24 bytes/);
		expect(() =>
			parseEncryptedRecordEnvelopeV2({ ...record(), ciphertext: "standard+/" }),
		).toThrow(/URL-safe base64/);
	});

	it("rejects ciphertext beyond the 256 KiB transport boundary", () => {
		expect(() =>
			parseEncryptedRecordEnvelopeV2({
				...record(),
				ciphertext: base64(MAX_RECORD_CIPHERTEXT_BYTES + 1),
			}),
		).toThrow(/maximum size/);
	});

	it("rejects ill-formed identifiers and non-canonical timestamps", () => {
		expect(() =>
			parseEncryptedRecordEnvelopeV2({
				...record(),
				recordId: "record-\ud800",
			}),
		).toThrow(/128 UTF-8 bytes/);
		expect(() =>
			parseVaultKeyEnvelopeV2({
				format: "svrgn-vault-key",
				version: SYNC_PROTOCOL_VERSION,
				vaultId: VAULT_ID,
				keyRevision: "1",
				kdf: {
					algorithm: "argon2id13",
					salt: base64(16),
					operationsLimit: 2,
					memoryLimit: 67_108_864,
				},
				wrappedVaultKey: {
					algorithm: "xchacha20-poly1305-ietf",
					nonce: base64(24),
					ciphertext: base64(48),
				},
				createdAt: "2026-09-03T14:00:00+02:00",
			}),
		).toThrow(/canonical ISO 8601/);
	});
});
