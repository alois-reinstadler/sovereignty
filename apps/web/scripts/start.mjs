import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { serve } from "srvx";
import { staticMiddleware } from "srvx/static";

import { getServerEnvironment } from "../src/lib/server-env.ts";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const webDirectory = resolve(scriptDirectory, "..");

const parsePort = (value) => {
	const port = Number(value ?? "3000");
	if (!Number.isInteger(port) || port < 1 || port > 65_535) {
		throw new Error("PORT must be an integer between 1 and 65535");
	}
	return port;
};

// Validate all deployment configuration before opening a listening socket.
getServerEnvironment();

const hostname = process.env.HOST?.trim() || "127.0.0.1";
const port = parsePort(process.env.PORT);
const { default: serverEntry } = await import(
	resolve(webDirectory, "dist/server/server.js")
);
if (typeof serverEntry?.fetch !== "function") {
	throw new Error("The TanStack Start build did not export a fetch handler");
}

const server = serve({
	fetch: serverEntry.fetch,
	gracefulShutdown: true,
	hostname,
	middleware: [
		staticMiddleware({ dir: resolve(webDirectory, "dist/client") }),
	],
	port,
});

await server.ready();
console.log(`SVRGN listening on http://${hostname}:${port}`);
