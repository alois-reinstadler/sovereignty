import { protocolVectors } from "@svrgn/protocol-vectors";
import { describe, expect, it } from "vitest";
import { type NativeCrypto, utf8 } from "./crypto";
import { MobileVault, parseEnvelope, validateDocument } from "./vault";

describe("browser-independent encoding and envelope bounds", () => {
	it.each([
		"",
		"Synthetic café 🔐\0日本語",
		"\ud800",
		"\udfff",
		"a\ud800b",
	])("encodes %j identically to UTF-8", (value) =>
		expect(utf8(value)).toEqual(new TextEncoder().encode(value)));
	it("rejects oversized and malformed encrypted input before KDF", () => {
		expect(() => parseEnvelope("x".repeat(12 * 1024 * 1024 + 1))).toThrow();
		expect(() => parseEnvelope("{}")).toThrow();
	});
});

describe("mobile schema limits", () => {
	it.each([
		0,
		11,
		1.5,
		Number.MAX_SAFE_INTEGER,
	])("rejects unsupported Argon2 operation count %s", (operationsLimit) => {
		const fixture = {
			...protocolVectors.v1.envelope,
			kdf: { ...protocolVectors.v1.envelope.kdf, operationsLimit },
		};
		expect(() => parseEnvelope(JSON.stringify(fixture))).toThrow();
	});
	it.each([
		0,
		8191,
		512 * 1024 * 1024 + 1,
		8192.5,
	])("rejects unsupported Argon2 memory %s", (memoryLimit) => {
		const fixture = {
			...protocolVectors.v1.envelope,
			kdf: { ...protocolVectors.v1.envelope.kdf, memoryLimit },
		};
		expect(() => parseEnvelope(JSON.stringify(fixture))).toThrow();
	});
	it("rejects duplicate IDs and oversized decrypted fields", () => {
		const document = structuredClone(protocolVectors.v1.document);
		expect(() =>
			validateDocument(
				{ ...document, items: [...document.items, ...document.items] },
				document,
			),
		).toThrow();
		expect(() =>
			validateDocument(
				{
					...document,
					items: [{ ...document.items[0], password: "x".repeat(16385) }],
				},
				document,
			),
		).toThrow();
	});
	it("requires exact document identity and timestamps", () => {
		const document = structuredClone(protocolVectors.v1.document);
		for (const key of ["id", "createdAt", "updatedAt"] as const)
			expect(() =>
				validateDocument({ ...document, [key]: "modified" }, document),
			).toThrow();
	});
});

describe("random-byte consumers with an injected fake", () => {
	function provider(random: (n: number) => Uint8Array): NativeCrypto {
		const unavailable = () => {
			throw new Error("No native cryptography in this fake");
		};
		return {
			random,
			zero: (bytes) => {
				bytes.fill(0);
			},
			derive: unavailable,
			encrypt: unavailable,
			decrypt: unavailable,
			encode: unavailable,
			decode: unavailable,
			text: unavailable,
		};
	}
	it("generates canonical UUIDv4 identifiers compatible with sync validation", () => {
		const bytes = new Uint8Array(16).fill(255);
		const vault = new MobileVault(provider(() => bytes));
		expect(vault.id()).toBe("ffffffff-ffff-4fff-bfff-ffffffffffff");
		expect(bytes).toEqual(new Uint8Array(16));
	});
	it("rejects biased upper-range bytes before generating the requested length", () => {
		const invalid = new Uint8Array(64).fill(255);
		const valid = new Uint8Array(64).fill(0);
		let calls = 0;
		const vault = new MobileVault(
			provider(() => (calls++ === 0 ? invalid : valid)),
		);
		expect(vault.generate(24)).toBe("A".repeat(24));
		expect(calls).toBe(2);
		expect(invalid).toEqual(new Uint8Array(64));
		expect(valid).toEqual(new Uint8Array(64));
	});
	it.each([0, 15, 129, 16.5])("rejects invalid generator length %s", (length) =>
		expect(() =>
			new MobileVault(provider((n) => new Uint8Array(n))).generate(length),
		).toThrow());
});
