import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";

const action = process.argv[2];
if (!new Set(["build", "dev"]).has(action))
	throw new Error("Choose build or dev.");
const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const args = [
	"--filter",
	"@svrgn/web",
	"exec",
	"vite",
	action === "build" ? "build" : "dev",
	...process.argv.slice(3),
];
const child = spawn(command, args, {
	stdio: "inherit",
	env: { ...process.env, VITE_SVRGN_CLIENT: "desktop" },
});
child.on("error", () => {
	process.exitCode = 1;
});
child.on("exit", async (code) => {
	process.exitCode = code ?? 1;
	if (code === 0 && action === "build") {
		try {
			const html = await readFile(
				new URL("../../web/dist/client/index.html", import.meta.url),
				"utf8",
			);
			if (!html.includes("<script") || !html.includes('type="module"'))
				throw new Error("Missing static module entry");
		} catch {
			process.stderr.write(
				"Desktop build did not emit apps/web/dist/client/index.html with a module entry.\n",
			);
			process.exitCode = 1;
		}
	}
});
for (const signal of ["SIGINT", "SIGTERM"])
	process.on(signal, () => child.kill(signal));
