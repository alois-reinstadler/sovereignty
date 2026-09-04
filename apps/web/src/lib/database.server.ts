import { Pool } from "pg";

import { getServerEnvironment } from "./server-env";

let pool: Pool | undefined;

export const getDatabasePool = (): Pool => {
	pool ??= new Pool({
		connectionString: getServerEnvironment().databaseUrl,
		max: 10,
		idleTimeoutMillis: 30_000,
		connectionTimeoutMillis: 5_000,
	});
	return pool;
};
