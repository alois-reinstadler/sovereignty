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

		expect(generatePassphrase(4)).toBe("amber-amber-amber-amber");
		random.mockRestore();
	});

	it("does not accidentally return an empty segment", () => {
		const passphrase = generatePassphrase(7);
		expect(passphrase.split("-")).toHaveLength(7);
		expect(passphrase).not.toMatch(/(^-|-$|--)/);
	});
});
