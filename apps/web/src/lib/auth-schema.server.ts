import { betterAuth } from "better-auth";

import { buildAuthOptions } from "./auth-options.server";
import { getDatabasePool } from "./database.server";
import { getServerEnvironment } from "./server-env";

/** Better Auth CLI entry; runtime code uses the lazy instance in auth.server. */
export const auth = betterAuth(
	buildAuthOptions(getServerEnvironment(), getDatabasePool()),
);
