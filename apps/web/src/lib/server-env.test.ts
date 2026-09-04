import { describe, expect, it } from "vitest";

import { parseServerEnvironment, ServerEnvironmentError } from "./server-env";

const validEnvironment = {
	NODE_ENV: "production",
	DATABASE_URL: "postgresql://svrgn:secret@database:5432/svrgn",
	BETTER_AUTH_SECRET: "a-high-entropy-secret-that-is-longer-than-32-characters",
	BETTER_AUTH_URL: "https://vault.example.test",
	BETTER_AUTH_TRUSTED_ORIGINS:
		"https://vault.example.test,https://desktop.example.test",
};

describe("server environment", () => {
	it("parses exact trusted origins", () => {
		expect(parseServerEnvironment(validEnvironment)).toEqual({
			betterAuthSecret: validEnvironment.BETTER_AUTH_SECRET,
			betterAuthUrl: "https://vault.example.test",
			databaseUrl: validEnvironment.DATABASE_URL,
			nodeEnv: "production",
			passkeyOrigins: ["https://vault.example.test"],
			passkeyRpId: "vault.example.test",
			trustedOrigins: [
				"https://vault.example.test",
				"https://desktop.example.test",
			],
		});
	});

	it("accepts an explicit parent relying-party ID for trusted subdomains", () => {
		expect(
			parseServerEnvironment({
				...validEnvironment,
				PASSKEY_RP_ID: "example.test",
				PASSKEY_ORIGINS:
					"https://vault.example.test,https://desktop.example.test",
			}),
		).toMatchObject({
			passkeyOrigins: [
				"https://vault.example.test",
				"https://desktop.example.test",
			],
			passkeyRpId: "example.test",
		});
	});

	it.each([
		["a missing secret", { ...validEnvironment, BETTER_AUTH_SECRET: "" }],
		[
			"a short secret",
			{ ...validEnvironment, BETTER_AUTH_SECRET: "not-long-enough" },
		],
		[
			"a path in the public URL",
			{
				...validEnvironment,
				BETTER_AUTH_URL: "https://vault.example.test/auth",
			},
		],
		[
			"a wildcard origin",
			{
				...validEnvironment,
				BETTER_AUTH_TRUSTED_ORIGINS:
					"https://vault.example.test,https://*.example.test",
			},
		],
		[
			"an untrusted public URL",
			{
				...validEnvironment,
				BETTER_AUTH_TRUSTED_ORIGINS: "https://other.example.test",
			},
		],
		[
			"a passkey origin outside the trusted origins",
			{
				...validEnvironment,
				PASSKEY_ORIGINS: "https://untrusted.example.test",
			},
		],
		[
			"a passkey origin outside the relying-party ID",
			{
				...validEnvironment,
				PASSKEY_RP_ID: "other.example.test",
			},
		],
		[
			"a relying-party ID with a port",
			{
				...validEnvironment,
				PASSKEY_RP_ID: "vault.example.test:443",
			},
		],
		[
			"plaintext production transport",
			{
				...validEnvironment,
				BETTER_AUTH_URL: "http://vault.example.test",
				BETTER_AUTH_TRUSTED_ORIGINS: "http://vault.example.test",
			},
		],
	])("rejects %s", (_label, environment) => {
		expect(() => parseServerEnvironment(environment)).toThrow(
			ServerEnvironmentError,
		);
	});

	it("allows HTTP loopback origins for local containers", () => {
		expect(
			parseServerEnvironment({
				...validEnvironment,
				BETTER_AUTH_URL: "http://localhost:3000",
				BETTER_AUTH_TRUSTED_ORIGINS: "http://localhost:3000",
			}),
		).toMatchObject({ betterAuthUrl: "http://localhost:3000" });
	});

	it("treats blank optional passkey overrides as defaults", () => {
		expect(
			parseServerEnvironment({
				...validEnvironment,
				NODE_ENV: "development",
				BETTER_AUTH_URL: "http://localhost:3000",
				BETTER_AUTH_TRUSTED_ORIGINS: "http://localhost:3000",
				PASSKEY_RP_ID: " ",
				PASSKEY_ORIGINS: " ",
			}),
		).toMatchObject({
			passkeyOrigins: ["http://localhost:3000"],
			passkeyRpId: "localhost",
		});
	});
});
