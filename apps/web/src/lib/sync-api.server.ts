import type { Pool } from "pg";

import {
	getAuthenticatedSession,
	UnauthenticatedRequestError,
} from "./auth-session.server";
import { getDatabasePool } from "./database.server";
import { createSyncHttpHandlers } from "./sync-http.server";
import { createPostgresSyncStore } from "./sync-store.server";

let handlers: ReturnType<typeof createSyncHttpHandlers> | undefined;

export const buildSyncApiHandlers = (pool: Pool) =>
	createSyncHttpHandlers({
		authenticate: async (headers) => {
			try {
				const session = await getAuthenticatedSession(headers);
				return session.user.id;
			} catch (error) {
				if (error instanceof UnauthenticatedRequestError) return null;
				throw error;
			}
		},
		store: createPostgresSyncStore(pool),
	});

export const getSyncApiHandlers = () => {
	handlers ??= buildSyncApiHandlers(getDatabasePool());
	return handlers;
};
