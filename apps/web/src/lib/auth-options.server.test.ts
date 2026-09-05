import { createHash } from "node:crypto";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";

import {
	assertPasskeyUserVerified,
	buildAuthOptions,
} from "./auth-options.server";
import { parseServerEnvironment } from "./server-env";

describe("Better Auth configuration", () => {
	it.each([
		[
			"unexpected cookieless Origin",
			{ origin: "https://attacker.example.test" },
			403,
		],
		[
			"lookalike Origin",
			{ origin: "https://vault.example.test.attacker.test" },
			403,
		],
		[
			"untrusted subdomain",
			{ origin: "https://child.vault.example.test" },
			403,
		],
		["different scheme", { origin: "http://vault.example.test" }, 403],
		["different port", { origin: "https://vault.example.test:8443" }, 403],
		["null Origin without same-origin metadata", { origin: "null" }, 403],
		[
			"unexpected Referer without Origin",
			{ referer: "https://attacker.example.test/page" },
			403,
		],
		[
			"cross-site browser navigation without Origin",
			{
				"sec-fetch-site": "cross-site",
				"sec-fetch-mode": "navigate",
				"sec-fetch-dest": "document",
			},
			403,
		],
		[
			"unexpected Origin with same-origin metadata",
			{
				origin: "https://attacker.example.test",
				"sec-fetch-site": "same-origin",
				"sec-fetch-mode": "cors",
			},
			403,
		],
		[
			"trusted same-origin browser signup",
			{
				origin: "https://vault.example.test",
				"sec-fetch-site": "same-origin",
				"sec-fetch-mode": "cors",
			},
			200,
		],
		[
			"trusted Referer without Origin",
			{ referer: "https://vault.example.test/account" },
			200,
		],
		["native cookieless request without browser metadata", {}, 200],
	] as const)("enforces production CSRF controls for %s", async (_label, suppliedHeaders, expectedStatus) => {
		const pool = new Pool({ connectionString: "postgresql://unused/unused" });
		try {
			const options = buildAuthOptions(
				parseServerEnvironment({
					NODE_ENV: "production",
					DATABASE_URL: "postgresql://unused/unused",
					BETTER_AUTH_SECRET:
						"synthetic-test-secret-with-at-least-32-characters",
					BETTER_AUTH_URL: "https://vault.example.test",
					BETTER_AUTH_TRUSTED_ORIGINS: "https://vault.example.test",
					SIGNUP_MODE: "open",
				}),
				pool,
			);
			// Preserve production plugins, middleware and database rate limiting.
			const data = {
				user: [],
				session: [],
				account: [],
				verification: [],
				rateLimit: [],
			};
			const auth = betterAuth({
				...options,
				database: memoryAdapter(data),
				logger: { disabled: true },
			});
			const headers = new Headers(suppliedHeaders);
			headers.set("content-type", "application/json");
			const response = await auth.handler(
				new Request("https://vault.example.test/api/auth/sign-up/email", {
					method: "POST",
					headers,
					body: JSON.stringify({
						name: "Synthetic user",
						email: "synthetic@example.test",
						password: "synthetic-password-only-for-tests",
					}),
				}),
			);
			expect(response.status).toBe(expectedStatus);
			if (expectedStatus === 403) {
				expect(data.user).toHaveLength(0);
				expect(data.account).toHaveLength(0);
				expect(data.session).toHaveLength(0);
			}
		} finally {
			await pool.end();
		}
	});
	it.each([
		"closed",
		"invite-only",
	])("enforces %s policy on direct and OAuth user creation", async (SIGNUP_MODE) => {
		const pool = new Pool({ connectionString: "postgresql://unused/unused" });
		try {
			const options = buildAuthOptions(
				parseServerEnvironment({
					NODE_ENV: "test",
					DATABASE_URL: "postgresql://unused/unused",
					BETTER_AUTH_SECRET:
						"synthetic-test-secret-with-at-least-32-characters",
					BETTER_AUTH_URL: "http://localhost:3000",
					BETTER_AUTH_TRUSTED_ORIGINS: "http://localhost:3000",
					SIGNUP_MODE,
				}),
				pool,
			);
			const auth = betterAuth({
				...options,
				database: memoryAdapter({
					user: [],
					session: [],
					account: [],
					verification: [],
				}),
				plugins: [],
				rateLimit: { enabled: false },
			});
			const context = await auth.$context;
			const user = {
				name: "Synthetic user",
				email: "invited@example.test",
				emailVerified: false,
			};
			await expect(
				context.internalAdapter.createUser(user, { method: "email-password" }),
			).rejects.toThrow(
				"Account registration is unavailable or the invitation is invalid.",
			);
			await expect(
				context.internalAdapter.createOAuthUser(user, {
					providerId: "synthetic",
					issuer: "synthetic",
					accountId: "synthetic-account",
				}),
			).rejects.toThrow(
				"Account registration is unavailable or the invitation is invalid.",
			);
			expect(options.emailAndPassword?.disableSignUp).toBe(
				SIGNUP_MODE === "closed",
			);
		} finally {
			await pool.end();
		}
	});
	it("admits invited email signup through the actual handler and rejects missing proof", async () => {
		const pool = new Pool({ connectionString: "postgresql://unused/unused" });
		try {
			const token = "ab".repeat(32);
			const options = buildAuthOptions(
				parseServerEnvironment({
					NODE_ENV: "test",
					DATABASE_URL: "postgresql://unused/unused",
					BETTER_AUTH_SECRET:
						"synthetic-test-secret-with-at-least-32-characters",
					BETTER_AUTH_URL: "http://localhost:3000",
					BETTER_AUTH_TRUSTED_ORIGINS: "http://localhost:3000",
					SIGNUP_MODE: "invite-only",
					SIGNUP_INVITATIONS: JSON.stringify([
						{
							email: "invited@example.test",
							tokenHash: createHash("sha256").update(token).digest("hex"),
							expiresAt: new Date(Date.now() + 60_000).toISOString(),
						},
					]),
				}),
				pool,
			);
			const auth = betterAuth({
				...options,
				database: memoryAdapter({
					user: [],
					session: [],
					account: [],
					verification: [],
				}),
				plugins: [],
				rateLimit: { enabled: false },
				logger: { disabled: true },
			});
			const signup = (proof?: string) =>
				auth.handler(
					new Request("http://localhost:3000/api/auth/sign-up/email", {
						method: "POST",
						headers: {
							"content-type": "application/json",
							origin: "http://localhost:3000",
							...(proof ? { "x-sovereignty-invite": proof } : {}),
						},
						body: JSON.stringify({
							name: "Synthetic invitee",
							email: "invited@example.test",
							password: "synthetic-test-password-only",
						}),
					}),
				);
			expect((await signup()).status).toBe(403);
			const admitted = await signup(token);
			expect(admitted.status).toBe(200);
			const body = await admitted.text();
			expect(body).not.toContain(token);
			expect(body).not.toContain("tokenHash");
			expect((await signup(token)).status).not.toBe(200);
		} finally {
			await pool.end();
		}
	});
	it("keeps origin checks enabled and persists rate limits", async () => {
		const pool = new Pool({ connectionString: "postgresql://unused/unused" });
		try {
			const options = buildAuthOptions(
				{
					betterAuthSecret:
						"a-high-entropy-secret-that-is-longer-than-32-characters",
					betterAuthUrl: "https://vault.example.test",
					databaseUrl: "postgresql://unused/unused",
					nodeEnv: "production",
					signupMode: "closed",
					signupInvitations: [],
					passkeyOrigins: ["https://vault.example.test"],
					passkeyRpId: "example.test",
					trustedOrigins: ["https://vault.example.test"],
				},
				pool,
			);

			expect(options.emailAndPassword).toMatchObject({ enabled: true });
			expect(options.rateLimit).toMatchObject({
				enabled: true,
				storage: "database",
			});
			expect(options.trustedOrigins).toEqual(["https://vault.example.test"]);
			expect(options.advanced).toMatchObject({
				disableCSRFCheck: false,
				disableOriginCheck: false,
			});
			expect(options.plugins?.[0]?.id).toBe("passkey");
			expect(options.plugins?.at(-1)?.id).toBe("tanstack-start-cookies");
		} finally {
			await pool.end();
		}
	});

	it("rejects passkey ceremonies without user verification", () => {
		expect(() => assertPasskeyUserVerified(false)).toThrow(
			"Passkey user verification is required",
		);
		expect(() => assertPasskeyUserVerified(true)).not.toThrow();
	});
});
