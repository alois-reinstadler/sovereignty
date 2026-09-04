import { passkey } from "@better-auth/passkey";
import type { BetterAuthOptions } from "better-auth";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import type { Pool } from "pg";

import type { ServerEnvironment } from "./server-env";

export const assertPasskeyUserVerified = (userVerified: boolean): void => {
	if (!userVerified) {
		throw new Error("Passkey user verification is required");
	}
};

/**
 * Better Auth owns account authentication only. The account password handled
 * here is distinct from the vault master password, which never leaves a client.
 */
export const buildAuthOptions = (
	environment: ServerEnvironment,
	database: Pool,
): BetterAuthOptions => ({
	appName: "Sovereignty",
	baseURL: environment.betterAuthUrl,
	secret: environment.betterAuthSecret,
	database,
	trustedOrigins: [...environment.trustedOrigins],
	emailAndPassword: {
		enabled: true,
		minPasswordLength: 12,
		maxPasswordLength: 128,
	},
	rateLimit: {
		enabled: true,
		storage: "database",
		modelName: "rateLimit",
		window: 60,
		max: 100,
		customRules: {
			"/sign-in/email": { window: 60, max: 10 },
			"/sign-up/email": { window: 60, max: 5 },
		},
	},
	advanced: {
		useSecureCookies: environment.nodeEnv === "production",
		database: {
			generateId: "uuid",
		},
	},
	// Required last so TanStack Start can apply response cookies correctly.
	plugins: [
		passkey({
			rpID: environment.passkeyRpId,
			rpName: "Sovereignty",
			origin: [...environment.passkeyOrigins],
			authenticatorSelection: { userVerification: "required" },
			registration: {
				afterVerification: ({ verification }) =>
					assertPasskeyUserVerified(
						verification.registrationInfo?.userVerified === true,
					),
			},
			authentication: {
				afterVerification: ({ verification }) =>
					assertPasskeyUserVerified(
						verification.authenticationInfo.userVerified,
					),
			},
		}),
		tanstackStartCookies(),
	],
});
