import { createFileRoute } from "@tanstack/react-router";

import { getDatabasePool } from "#/lib/database.server";

export const Route = createFileRoute("/api/health")({
	server: {
		handlers: {
			GET: async () => {
				try {
					await getDatabasePool().query("select 1");
					return Response.json(
						{ status: "ok" },
						{ headers: { "cache-control": "no-store" } },
					);
				} catch {
					return Response.json(
						{ status: "unavailable" },
						{
							status: 503,
							headers: { "cache-control": "no-store" },
						},
					);
				}
			},
		},
	},
});
