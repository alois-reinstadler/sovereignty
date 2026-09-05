import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { assertSignupAllowed } from "./signup-policy.server";

const token = "ab".repeat(32);
const invitation = {
	email: "invited@example.test",
	tokenHash: createHash("sha256").update(token).digest("hex"),
	expiresAt: 2_000,
};
const policy = {
	signupMode: "invite-only" as const,
	signupInvitations: [invitation],
};

describe("signup policy", () => {
	it("allows only the matching email and proof before expiry", () => {
		expect(() =>
			assertSignupAllowed(
				policy,
				" Invited@Example.test ",
				token,
				"/sign-up/email",
				1_999,
			),
		).not.toThrow();
	});
	it.each([
		["missing proof", invitation.email, undefined, "/sign-up/email", 1_000],
		["wrong proof", invitation.email, "cd".repeat(32), "/sign-up/email", 1_000],
		[
			"oversized proof",
			invitation.email,
			"ab".repeat(33),
			"/sign-up/email",
			1_000,
		],
		["wrong email", "other@example.test", token, "/sign-up/email", 1_000],
		[
			"email subdomain",
			"invited@sub.example.test",
			token,
			"/sign-up/email",
			1_000,
		],
		["expiry boundary", invitation.email, token, "/sign-up/email", 2_000],
		["expired", invitation.email, token, "/sign-up/email", 2_001],
		[
			"alternate endpoint",
			invitation.email,
			token,
			"/callback/provider",
			1_000,
		],
		["no endpoint context", invitation.email, token, undefined, 1_000],
	] as const)("rejects %s without disclosing invitations", (_label, email, proof, path, now) => {
		expect(() => assertSignupAllowed(policy, email, proof, path, now)).toThrow(
			"Account registration is unavailable or the invitation is invalid.",
		);
	});
	it("closed denies all paths even with a valid proof; open admits them", () => {
		expect(() =>
			assertSignupAllowed(
				{ ...policy, signupMode: "closed" },
				invitation.email,
				token,
				"/sign-up/email",
				1_000,
			),
		).toThrow();
		expect(() =>
			assertSignupAllowed(
				{ ...policy, signupMode: "open" },
				invitation.email,
				undefined,
				undefined,
				1_000,
			),
		).not.toThrow();
	});
});
