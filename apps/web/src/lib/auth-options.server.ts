import { passkey } from "@better-auth/passkey";
import type { BetterAuthOptions } from "better-auth";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import type { Pool } from "pg";

import type { ServerEnvironment } from "./server-env";
import { assertSignupAllowed } from "./signup-policy.server";

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
		disableSignUp: environment.signupMode === "closed",
		minPasswordLength: 12,
		maxPasswordLength: 128,
	},
	databaseHooks: {
		user: {
			create: {
				before: async (user, context) => {
					assertSignupAllowed(
						environment,
						user.email,
						(context?.request?.headers ?? context?.headers)?.get(
							"x-sovereignty-invite",
						),
						context?.path,
					);
				},
			},
		},
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
		// Better Auth otherwise defaults origin checks off when its global isTest()
		// detects Vitest, regardless of the parsed server environment. Pin both
		// controls so integration tests exercise the same security as production.
		disableOriginCheck: false,
		disableCSRFCheck: false,
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
