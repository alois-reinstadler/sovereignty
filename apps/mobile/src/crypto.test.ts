import { describe, expect, it } from "vitest";
import { utf8 } from "./crypto";
import { parseEnvelope } from "./vault";

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
