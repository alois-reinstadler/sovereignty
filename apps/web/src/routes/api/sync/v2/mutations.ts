import { createFileRoute } from "@tanstack/react-router";

import { getSyncApiHandlers } from "#/lib/sync-api.server";

export const Route = createFileRoute("/api/sync/v2/mutations")({
	server: {
		handlers: {
			POST: ({ request }) => getSyncApiHandlers().push(request),
		},
	},
});
