// Drives the compiled Linux WebKit application, never the shared Chrome session.
// Every credential and storage directory below belongs only to this test.
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

const artifacts = resolve("apps/desktop/e2e/artifacts");
const run = promisify(execFile);
let storage;
let port;
const processes = [];
let driverOutput = "";
function ownedProcess(command, args, options) {
	const child = spawn(command, args, options);
	// Resolve on spawn failure too: never leave a rejected promise unhandled
	// while another startup operation is awaiting readiness.
	const exited = new Promise((done) => {
		child.once("exit", done);
		child.once("error", (error) => {
			driverOutput += `\n${command}: ${error.message}`;
			done();
		});
	});
	processes.push({ child, exited });
	return child;
}
async function stopProcess({ child, exited }) {
	if (child.pid && child.exitCode === null && child.signalCode === null) {
		child.kill("SIGTERM");
		await Promise.race([exited, delay(5_000)]);
		if (child.exitCode === null && child.signalCode === null)
			child.kill("SIGKILL");
	}
	await exited;
}
async function freePort() {
	const server = createServer();
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	const port = server.address().port;
	await new Promise((done) => server.close(done));
	return port;
}
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
	await script(
		"arguments[0].scrollIntoView({block: 'center', behavior: 'instant'})",
		found,
	);
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
async function nativeDialog(title) {
	await until(async () => {
		const { stdout } = await run("xdotool", [
			"getactivewindow",
			"getwindowname",
		]);
		return stdout.includes(title);
	}, `native dialog: ${title}`);
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
	await mkdir(artifacts, { recursive: true });
	storage = await mkdtemp(`${tmpdir()}/sovereignty-native-test-`);
	await mkdir(`${storage}/config`, { recursive: true });
	await mkdir(`${storage}/downloads`, { recursive: true });
	await writeFile(
		`${storage}/config/user-dirs.dirs`,
		`XDG_DOWNLOAD_DIR="${storage}/downloads"\n`,
	);
	port = await freePort();
	let nativePort = await freePort();
	while (nativePort === port) nativePort = await freePort();
	// Only the private display created by xvfb-run.
	ownedProcess("openbox", [], { stdio: "ignore" });
	const driver = ownedProcess(
		"tauri-driver",
		["--port", String(port), "--native-port", String(nativePort)],
		{
			env: {
				...process.env,
				XDG_DATA_HOME: `${storage}/data`,
				XDG_CONFIG_HOME: `${storage}/config`,
				XDG_CACHE_HOME: `${storage}/cache`,
				WEBKIT_DISABLE_DMABUF_RENDERER: "1",
			},
			stdio: ["ignore", "pipe", "pipe"],
		},
	);
	for (const stream of [driver.stdout, driver.stderr])
		stream.on("data", (data) => {
			driverOutput = `${driverOutput}${data}`.slice(-64_000);
		});
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
	assert.equal(
		await script(
			`return [...document.querySelectorAll('button')].some(e => /^(Import|Export) backup$/.test(e.textContent.trim()))`,
		),
		false,
	);
	assert.equal(
		await script(
			"return document.body.textContent.includes('Lock the vault to import or export encrypted backups.')",
		),
		true,
	);
	checks.push(
		"unlocked desktop requires explicit lock before backup dialogs to preserve callbacks",
	);
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
	const invalidNativeExport = await command("POST", "/execute/async", {
		script: `const done = arguments[arguments.length - 1];
		window.__TAURI_INTERNALS__.invoke('desktop_export_backup', {serialized: '{"password":"synthetic only"}'}).then(() => done(false), () => done(true));`,
		args: [],
	});
	assert.equal(invalidNativeExport, true);
	checks.push(
		"actual native command rejects plaintext before opening a dialog",
	);
	await button("Export backup");
	await nativeDialog("Save encrypted Sovereignty backup");
	await run("xdotool", ["key", "--clearmodifiers", "Escape"]);
	await until(
		() =>
			script(
				"return [...document.querySelectorAll('button')].some(e => e.textContent.trim().endsWith('Export backup') && !e.disabled)",
			),
		"cancelled backup releases operation",
	);
	assert.equal(
		await script("return localStorage.getItem('svrgn.vault.envelope.v1')"),
		envelope,
	);
	checks.push("cancelling native export preserves the vault and permits retry");
	await button("Export backup");
	const backupFile = `${storage}/downloads/native-backup.svrgn`;
	await nativeDialog("Save encrypted Sovereignty backup");
	await run("scrot", [`${artifacts}/backup-save-dialog.png`]);
	await run("xdotool", ["key", "--clearmodifiers", "ctrl+a"]);
	await run("xdotool", ["type", "--clearmodifiers", "--", backupFile]);
	await run("xdotool", ["key", "--clearmodifiers", "Return"]);
	await until(
		async () => (await readFile(backupFile, "utf8")) === envelope,
		"native encrypted backup save",
	);
	checks.push("native backup export contains exactly the encrypted envelope");
	await until(
		() =>
			script(
				"return document.body.textContent.includes('Encrypted backup saved.')",
			),
		"saved confirmation",
	);
	await button("Import backup");
	await nativeDialog("Open encrypted Sovereignty backup");
	await run("scrot", [`${artifacts}/backup-open-dialog.png`]);
	await run("xdotool", ["key", "--clearmodifiers", "ctrl+l"]);
	await run("xdotool", ["type", "--clearmodifiers", "--", backupFile]);
	await run("xdotool", ["key", "--clearmodifiers", "Return"]);
	// GTK resolves the location entry before its explicit Open action.
	await delay(500);
	await run("xdotool", ["key", "--clearmodifiers", "alt+o"]);
	await until(
		() => visible('[role="alertdialog"]'),
		"explicit backup overwrite review",
	);
	await button("Replace and lock");
	await until(
		() =>
			script(
				"return !document.querySelector('[role=alertdialog]') && document.body.textContent.includes('Encrypted backup imported.')",
			),
		"native encrypted backup import",
	);
	assert.equal(
		await script("return localStorage.getItem('svrgn.vault.envelope.v1')"),
		envelope,
	);
	checks.push(
		"native OS file dialog restores backup only after explicit overwrite confirmation",
	);
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
	const { stdout: appPid } = await run("xdotool", [
		"getwindowpid",
		windowId.trim(),
	]);
	// Openbox translates Alt+F4 into a graceful WM_DELETE_WINDOW request.
	// xdotool windowclose destroys the X window and bypasses this handshake.
	await run("xdotool", ["windowactivate", "--sync", windowId.trim()]);
	await run("xdotool", ["key", "--clearmodifiers", "alt+F4"]);
	await until(() => {
		try {
			process.kill(Number(appPid.trim()), 0);
			return false;
		} catch (error) {
			if (error.code === "ESRCH") return true;
			throw error;
		}
	}, "native close acknowledgement and application exit");
	checks.push(
		"OS window-close request completes the native lock acknowledgement and exits",
	);
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
	// Cleanup actions are independent: an artifact failure must not strand a
	// process, and one failed process shutdown must not skip another.
	await Promise.allSettled(processes.reverse().map(stopProcess));
	await Promise.allSettled([
		writeFile(`${artifacts}/driver.log`, driverOutput),
		storage ? rm(storage, { recursive: true, force: true }) : Promise.resolve(),
	]);
}
