// Runs only an unsigned test build in a newly created disposable simulator.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

const execute = promisify(execFile);
const artifacts = resolve("artifacts/ios");
const bundleId = "app.svrgn.mobile";
const app = process.env.SVRGN_IOS_APP_PATH;
assert.ok(
	app?.endsWith("/Sovereignty.app"),
	"An explicit simulator test application is required",
);
assert.equal(
	process.platform,
	"darwin",
	"Native iOS verification requires macOS/Xcode",
);
await mkdir(artifacts, { recursive: true });
const xcrun = async (...args) =>
	(
		await execute("xcrun", ["simctl", ...args], {
			timeout: 180_000,
			maxBuffer: 8 * 1024 * 1024,
		})
	).stdout.trim();
let device;
try {
	const { runtimes } = JSON.parse(await xcrun("list", "runtimes", "--json"));
	const runtime = runtimes
		.filter(
			(value) =>
				value.isAvailable &&
				value.identifier.startsWith(
					"com.apple.CoreSimulator.SimRuntime.iOS-",
				) &&
				Number.parseInt(value.version, 10) >= 26,
		)
		.sort((a, b) =>
			b.version.localeCompare(a.version, "en", { numeric: true }),
		)[0];
	assert.ok(runtime, "An available iOS 26+ simulator runtime is required");
	device = await xcrun(
		"create",
		`Sovereignty synthetic test ${process.env.GITHUB_RUN_ID ?? Date.now()}`,
		"com.apple.CoreSimulator.SimDeviceType.iPhone-17",
		runtime.identifier,
	);
	assert.match(device, /^[0-9A-F-]{36}$/i);
	await xcrun("boot", device);
	await xcrun("bootstatus", device, "-b");
	await xcrun("install", device, resolve(app));
	await xcrun("launch", device, bundleId);
	const container = await xcrun("get_app_container", device, bundleId, "data");
	const report = `${container}/Documents/native-test-result.json`;
	const deadline = Date.now() + 120_000;
	let result;
	while (Date.now() < deadline) {
		try {
			const info = await stat(report);
			assert.ok(info.size <= 16_384, "Native result exceeds its bound");
			result = JSON.parse(await readFile(report, "utf8"));
			break;
		} catch (error) {
			if (error.code !== "ENOENT" && !(error instanceof SyntaxError))
				throw error;
		}
		await delay(500);
	}
	assert.ok(
		result,
		"Native test entry did not write a result within two minutes",
	);
	await writeFile(
		`${artifacts}/result.json`,
		JSON.stringify({ runtime: runtime.version, ...result }, null, 2),
	);
	await xcrun("io", device, "screenshot", `${artifacts}/native-test.png`);
	assert.equal(result.schemaVersion, 1);
	assert.equal(
		result.passed,
		true,
		"Native interoperability tests failed; inspect result.json",
	);
	assert.equal(
		result.checks,
		78,
		"Native test entry must execute the full acceptance suite",
	);
	assert.deepEqual(result.failures, []);
	console.log(
		`Native iOS ${runtime.version}: ${result.checks} interoperability checks passed.`,
	);
} catch (error) {
	if (device) {
		await xcrun("io", device, "screenshot", `${artifacts}/failure.png`).catch(
			() => {},
		);
		const logs = await xcrun(
			"spawn",
			device,
			"log",
			"show",
			"--last",
			"3m",
			"--style",
			"compact",
			"--predicate",
			'process == "Sovereignty"',
		).catch(() => "Simulator logs unavailable");
		await writeFile(`${artifacts}/simulator.log`, logs).catch(() => {});
	}
	throw error;
} finally {
	// Only the identifier returned by this run's create call; never delete or
	// shut down any pre-existing device or user application.
	if (device) {
		await xcrun("shutdown", device).catch(() => {});
		await xcrun("delete", device).catch(() => {});
	}
}
