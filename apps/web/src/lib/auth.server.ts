import { betterAuth } from "better-auth";

import { buildAuthOptions } from "./auth-options.server";
import { getDatabasePool } from "./database.server";
import { getServerEnvironment } from "./server-env";

let authInstance: ReturnType<typeof betterAuth> | undefined;

export const getAuth = (): ReturnType<typeof betterAuth> => {
	authInstance ??= betterAuth(
		buildAuthOptions(getServerEnvironment(), getDatabasePool()),
	);
	return authInstance;
};
