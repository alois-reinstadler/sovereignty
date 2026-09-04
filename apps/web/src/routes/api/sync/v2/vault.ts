import { createFileRoute } from "@tanstack/react-router";

import { getSyncApiHandlers } from "#/lib/sync-api.server";

export const Route = createFileRoute("/api/sync/v2/vault")({
	server: {
		handlers: {
			GET: ({ request }) => getSyncApiHandlers().getVault(request),
			POST: ({ request }) => getSyncApiHandlers().createVault(request),
		},
	},
});
