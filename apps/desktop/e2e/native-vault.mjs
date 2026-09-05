// Drives the compiled Linux WebKit application, never the shared Chrome session.
// Every credential and storage directory below belongs only to this test.
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";

const artifacts = resolve("apps/desktop/e2e/artifacts");
await mkdir(artifacts, { recursive: true });
const storage = await mkdtemp(`${tmpdir()}/sovereignty-native-test-`);
const run = promisify(execFile);
// A private Xvfb display and window manager let the test exercise native focus
// events without interacting with any user's desktop or browser.
const manager = spawn("openbox", [], { stdio: "ignore" });
const managerExit = once(manager, "exit");
async function freePort() {
	const server = createServer();
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	const port = server.address().port;
	await new Promise((done) => server.close(done));
	return port;
}
const port = await freePort();
let nativePort = await freePort();
while (nativePort === port) nativePort = await freePort();
const driver = spawn(
	"tauri-driver",
	["--port", String(port), "--native-port", String(nativePort)],
	{
		env: {
			...process.env,
			XDG_DATA_HOME: `${storage}/data`,
			XDG_CONFIG_HOME: `${storage}/config`,
			XDG_CACHE_HOME: `${storage}/cache`,
			// Xvfb has no hardware GPU. Keep this test-runner setting out of the app.
			WEBKIT_DISABLE_DMABUF_RENDERER: "1",
		},
		stdio: ["ignore", "pipe", "pipe"],
	},
);
let driverOutput = "";
for (const stream of [driver.stdout, driver.stderr]) {
	stream.on("data", (data) => {
		driverOutput = `${driverOutput}${data}`.slice(-64_000);
	});
}
const driverExit = once(driver, "exit");
let session;
const checks = [];
async function request(method, path, body) {
	const response = await fetch(`http://127.0.0.1:${port}${path}`, {
		method,
		headers: { "Content-Type": "application/json" },
		body: body === undefined ? undefined : JSON.stringify(body),
		signal: AbortSignal.timeout(path === "/session" ? 60_000 : 30_000),
	}).catch((cause) => {
		throw new Error(`WebDriver ${method} ${path} failed`, { cause });
	});
	const result = await response.json();
	if (!response.ok || result.value?.error)
		throw new Error(JSON.stringify(result));
	return result.value;
}
const command = (method, path, body) =>
	request(method, `/session/${session}${path}`, body);
const script = (code, ...args) =>
	command("POST", "/execute/sync", { script: code, args });
async function until(action, description, timeout = 30_000) {
	const deadline = Date.now() + timeout;
	let lastError;
	do {
		try {
			if (await action()) return;
		} catch (error) {
			lastError = error;
		}
		await delay(150);
	} while (Date.now() < deadline);
	throw new Error(`Timed out: ${description}`, { cause: lastError });
}
async function element(selector) {
	const found = await command("POST", "/element", {
		using: "css selector",
		value: selector,
	});
	return found["element-6066-11e4-a52e-4f735466cecf"];
}
async function fill(selector, text) {
	const id = await element(selector);
	await command("POST", `/element/${id}/clear`, {});
	await command("POST", `/element/${id}/value`, { text });
}
async function button(label) {
	const found = await script(
		`return [...document.querySelectorAll('button')].find(e =>
    e.getBoundingClientRect().height > 0 && !e.disabled &&
    (e.getAttribute('aria-label') === arguments[0] || e.textContent.trim().endsWith(arguments[0])))`,
		label,
	);
	assert.ok(found, `Visible enabled button: ${label}`);
	const id = found["element-6066-11e4-a52e-4f735466cecf"];
	await command("POST", `/element/${id}/click`, {});
}
const visible = (selector) =>
	script(
		"const e = document.querySelector(arguments[0]); return !!e && e.getBoundingClientRect().height > 0",
		selector,
	);
async function screenshot(name) {
	const encoded = await command("GET", "/screenshot");
	await writeFile(`${artifacts}/${name}.png`, Buffer.from(encoded, "base64"));
}
async function diagnostics() {
	return script(`return {
    url: location.href,
    title: document.title,
		text: document.body.textContent.slice(0, 12_000),
    headings: [...document.querySelectorAll('h1,h2')].map(e => e.textContent),
    buttons: [...document.querySelectorAll('button')].map(e => ({ name: e.getAttribute('aria-label') || e.textContent, disabled: e.disabled })),
    errors: window.__nativeTestErrors || [],
    requests: performance.getEntriesByType('resource').map(e => e.name)
  }`);
}

try {
	await until(() => request("GET", "/status"), "driver startup", 15_000);
	const created = await request("POST", "/session", {
		capabilities: {
			alwaysMatch: {
				"tauri:options": {
					application: resolve(
						"apps/desktop/src-tauri/target/debug/svrgn-desktop",
					),
				},
			},
		},
	});
	session = created.sessionId;
	assert.ok(session, "WebDriver created a native application session");
	await script(`window.__nativeTestErrors = [];
    addEventListener('error', e => window.__nativeTestErrors.push(String(e.message)));
    addEventListener('unhandledrejection', e => window.__nativeTestErrors.push(String(e.reason)));`);
	await until(
		() => visible('input[name="master-password-confirmation"]'),
		"vault setup",
	);
	checks.push("compiled desktop setup rendered");
	await screenshot("setup");
	const master = "Synthetic-native-master-2026!";
	const password = "Synthetic-login-only-2026!";
	const title = "Native fixture login";
	await fill('input[name="master-password"]', master);
	await fill('input[name="master-password-confirmation"]', master);
	await button("Create encrypted vault");
	await until(
		() => visible(".vault-shell"),
		"native encrypted vault creation",
		60_000,
	);
	checks.push("created vault using native WebKit cryptography");
	await button("New login");
	await until(() => visible(".item-form"), "login editor");
	await fill('input[placeholder="e.g. GitHub"]', title);
	await fill(
		'input[placeholder="name@example.com"]',
		"synthetic@example.invalid",
	);
	await fill(
		'input[placeholder="https://example.com"]',
		"https://example.invalid",
	);
	await button("Generate");
	assert.ok(
		await script(
			"return document.querySelector('.item-form input[type=password]').value.length >= 12",
		),
	);
	checks.push("password generator produced a value");
	await fill('.item-form input[type="password"]', password);
	await button("Save login");
	await until(
		() =>
			script(
				"return !document.querySelector('.item-form') && document.querySelector('[role=option]')?.textContent.includes(arguments[0])",
				title,
			),
		"login encrypted and saved",
	);
	const envelope = await script(
		"return localStorage.getItem('svrgn.vault.envelope.v1')",
	);
	assert.ok(envelope, "encrypted envelope persisted");
	for (const plaintext of [
		master,
		password,
		title,
		"synthetic@example.invalid",
	]) {
		assert.ok(
			!envelope.includes(plaintext),
			"storage excludes fixture plaintext",
		);
	}
	checks.push("saved login and checked persisted envelope excludes plaintext");
	await screenshot("vault");
	await button("Lock vault");
	await until(() => visible('input[name="master-password"]'), "manual lock");
	assert.equal(
		await script(
			"return document.body.textContent.includes(arguments[0])",
			title,
		),
		false,
	);
	checks.push("locking removed credential UI");
	const beforeReload = await diagnostics();
	assert.deepEqual(beforeReload.errors, []);
	assert.deepEqual(
		beforeReload.requests.filter((url) => /\/api\/(auth|sync)(\/|$)/.test(url)),
		[],
	);
	await command("POST", "/refresh", {});
	await until(
		() => visible('input[name="master-password"]'),
		"persisted vault after reload",
	);
	assert.equal(
		await visible('input[name="master-password-confirmation"]'),
		false,
	);
	await fill('input[name="master-password"]', master);
	await button("Unlock vault");
	await until(
		() =>
			script(
				"return document.querySelector('[role=option]')?.textContent.includes(arguments[0])",
				title,
			),
		"saved login restored",
		60_000,
	);
	checks.push("reload starts locked and master password restores saved login");
	await script(`window.__nativeBlurObserved = false;
    addEventListener('svrgn:desktop-lock', e => {
      if (e.detail === 'native-blur') window.__nativeBlurObserved = true;
    });`);
	const { stdout: windowId } = await run("xdotool", ["getactivewindow"]);
	await run("xdotool", ["windowminimize", windowId.trim()]);
	await until(
		() => script("return window.__nativeBlurObserved === true"),
		"native blur event",
	);
	await run("xdotool", ["windowmap", windowId.trim()]);
	await run("xdotool", ["windowactivate", "--sync", windowId.trim()]);
	await until(
		() => visible('input[name="master-password"]'),
		"native focus loss locks vault",
	);
	assert.equal(
		await script(
			"return document.body.textContent.includes(arguments[0])",
			title,
		),
		false,
	);
	checks.push("actual native window focus loss locks and removes plaintext UI");
	const details = await diagnostics();
	assert.deepEqual(details.errors, []);
	assert.deepEqual(
		details.requests.filter((url) => /\/api\/(auth|sync)(\/|$)/.test(url)),
		[],
	);
	checks.push("desktop made no unsupported account or sync requests");
	await writeFile(
		`${artifacts}/result.json`,
		JSON.stringify({ checks, details }, null, 2),
	);
	console.log(JSON.stringify({ checks }, null, 2));
} catch (error) {
	// Only the private display created by xvfb-run; never the shared desktop.
	await run("scrot", [`${artifacts}/native-failure.png`]).catch(() => {});
	if (session) {
		await button("Show Error").catch(() => {});
		await screenshot("failure").catch(() => {});
		await writeFile(
			`${artifacts}/failure.json`,
			JSON.stringify(await diagnostics().catch(() => ({})), null, 2),
		);
	}
	throw error;
} finally {
	if (session) await command("DELETE", "").catch(() => {});
	driver.kill("SIGTERM");
	await Promise.race([driverExit, delay(5_000)]);
	if (driver.exitCode === null && driver.signalCode === null) {
		driver.kill("SIGKILL");
		await driverExit;
	}
	await writeFile(`${artifacts}/driver.log`, driverOutput);
	manager.kill("SIGTERM");
	await Promise.race([managerExit, delay(5_000)]);
	if (manager.exitCode === null && manager.signalCode === null) {
		manager.kill("SIGKILL");
		await managerExit;
	}
	await rm(storage, { recursive: true, force: true });
}
