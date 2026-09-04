import { describe, expect, it } from "vitest";

import { evaluatePasskeySupport } from "./passkey-support";

describe("passkey browser support", () => {
	it("allows WebAuthn in a secure capable context", () => {
		expect(
			evaluatePasskeySupport({
				hasPublicKeyCredential: true,
				isSecureContext: true,
			}),
		).toEqual({ available: true, message: null });
	});

	it("explains why raw HTTP origins cannot use passkeys", () => {
		const result = evaluatePasskeySupport({
			hasPublicKeyCredential: true,
			isSecureContext: false,
		});

		expect(result.available).toBe(false);
		expect(result.message).toContain("raw HTTP");
	});

	it("reports browsers without WebAuthn", () => {
		const result = evaluatePasskeySupport({
			hasPublicKeyCredential: false,
			isSecureContext: true,
		});

		expect(result.available).toBe(false);
		expect(result.message).toContain("does not support passkeys");
	});
});
