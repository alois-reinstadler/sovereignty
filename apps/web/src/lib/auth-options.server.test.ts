import { Pool } from "pg";
import { describe, expect, it } from "vitest";

import {
	assertPasskeyUserVerified,
	buildAuthOptions,
} from "./auth-options.server";

describe("Better Auth configuration", () => {
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
			expect(options.advanced).not.toHaveProperty("disableCSRFCheck");
			expect(options.advanced).not.toHaveProperty("disableOriginCheck");
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
