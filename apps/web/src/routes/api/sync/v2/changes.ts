import { createFileRoute } from "@tanstack/react-router";

import { getSyncApiHandlers } from "#/lib/sync-api.server";

export const Route = createFileRoute("/api/sync/v2/changes")({
	server: {
		handlers: {
			GET: ({ request }) => getSyncApiHandlers().pull(request),
		},
	},
});
