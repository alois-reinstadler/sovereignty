import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const runId = randomBytes(16).toString("hex");
const project = `svrgn-integration-${runId}`;
const environment = {
	...process.env,
	SVRGN_INTEGRATION_DATABASE: `svrgn_integration_${runId}`,
};
// Explicit file and project names prevent loading production Compose defaults.
const compose = [
	"compose",
	"--env-file",
	"/dev/null",
	"--file",
	resolve(root, "compose.integration.yaml"),
	"--project-name",
	project,
];

let activeChild;
let interrupted = false;
const run = (arguments_) =>
	new Promise((resolveResult, reject) => {
		const child = spawn("docker", arguments_, {
			cwd: root,
			env: environment,
			stdio: "inherit",
		});
		activeChild = child;
		child.once("error", reject);
		child.once("exit", (code) => {
			activeChild = undefined;
			resolveResult(code ?? 1);
		});
	});

const onSignal = () => {
	interrupted = true;
	activeChild?.kill("SIGTERM");
};
process.on("SIGINT", onSignal);
process.on("SIGTERM", onSignal);

let fixtureStarted = false;
try {
	if ((await run(["compose", "version"])) !== 0) {
		throw new Error(
			"Docker Compose is required; integration tests did not run",
		);
	}
	console.log(`Disposable integration project: ${project}`);
	fixtureStarted = true;
	const code = await run([
		...compose,
		"up",
		"--build",
		"--abort-on-container-exit",
		"--exit-code-from",
		"integration",
	]);
	process.exitCode = interrupted ? 130 : code;
} catch (error) {
	console.error(
		error?.code === "ENOENT"
			? "Docker is unavailable; PostgreSQL integration tests did not run."
			: error.message,
	);
	process.exitCode = 1;
} finally {
	process.off("SIGINT", onSignal);
	process.off("SIGTERM", onSignal);
	if (fixtureStarted) {
		try {
			const cleanup = await run([...compose, "down", "--volumes"]);
			if (cleanup !== 0) process.exitCode = 1;
		} catch {
			console.error(`Cleanup failed for disposable project ${project}`);
			process.exitCode = 1;
		}
	}
}
