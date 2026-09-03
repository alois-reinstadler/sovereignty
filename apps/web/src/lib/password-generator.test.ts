import { describe, expect, it, vi } from "vitest";

import { generatePassphrase } from "./password-generator";

describe("generatePassphrase", () => {
	it("builds a readable hyphenated passphrase with the requested word count", () => {
		const random = vi
			.spyOn(crypto, "getRandomValues")
			.mockImplementation((array) => {
				const bytes = array as Uint8Array;
				bytes.fill(0);
				return array;
			});

		expect(generatePassphrase(6)).toBe(
			"abandon-abandon-abandon-abandon-abandon-abandon",
		);
		random.mockRestore();
	});

	it("does not accidentally return an empty segment", () => {
		const passphrase = generatePassphrase(7);
		expect(passphrase.split("-")).toHaveLength(7);
		expect(passphrase).not.toMatch(/(^-|-$|--)/);
	});

	it("rejects passphrases with too little entropy", () => {
		expect(() => generatePassphrase(5)).toThrowError(
			"Passphrases must contain between 6 and 10 words",
		);
	});
});
