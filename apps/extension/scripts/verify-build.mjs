import assert from "node:assert/strict";
import { lstat, readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

/** A deliberate permission expansion must update this review gate and its tests. */
export function verifyManifest(manifest) {
	assert.equal(manifest.manifest_version, 3);
	assert.equal(manifest.name, "Sovereignty");
	assert.deepEqual([...manifest.permissions].sort(), [
		"activeTab",
		"scripting",
		"storage",
	]);
	assert.deepEqual(manifest.background, {
		service_worker: "background.js",
		type: "module",
	});
	assert.equal(manifest.action.default_popup, "popup.html");
	assert.deepEqual(manifest.externally_connectable, {
		matches: ["https://*/*", "http://localhost/*", "http://127.0.0.1/*"],
	});
	assert.equal(
		manifest.content_security_policy.extension_pages,
		"script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
	);
	for (const key of [
		"host_permissions",
		"optional_host_permissions",
		"optional_permissions",
		"content_scripts",
		"web_accessible_resources",
		"sandbox",
		"update_url",
		"devtools_page",
		"options_page",
		"options_ui",
	]) {
		assert.equal(
			Object.hasOwn(manifest, key),
			false,
			`Unexpected manifest entry: ${key}`,
		);
	}
}

export async function verifyBuild(directory) {
	const root = resolve(directory);
	const files = [];
	async function walk(relative = "") {
		for (const entry of await readdir(resolve(root, relative))) {
			const path = relative ? `${relative}/${entry}` : entry;
			const info = await lstat(resolve(root, path));
			assert.equal(
				info.isSymbolicLink(),
				false,
				`Symlink in artifact: ${path}`,
			);
			if (info.isDirectory()) {
				assert.equal(path, "assets");
				await walk(path);
			} else {
				assert.ok(
					info.isFile() && info.size <= 5_000_000,
					`Invalid artifact file: ${path}`,
				);
				assert.match(
					path,
					/^(?:manifest\.json|popup\.html|background\.js|content\.js|assets\/[A-Za-z0-9_-]+\.(?:js|css))$/,
				);
				files.push(path);
			}
		}
	}
	await walk();
	assert.ok(files.length <= 30, "Unexpected artifact size");
	for (const required of [
		"manifest.json",
		"popup.html",
		"background.js",
		"content.js",
	])
		assert.ok(files.includes(required), `Missing ${required}`);
	verifyManifest(
		JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8")),
	);
	const html = await readFile(resolve(root, "popup.html"), "utf8");
	assert.ok(
		!/<(?:iframe|base)\b/i.test(html),
		"Unexpected document capability",
	);
	const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
	assert.ok(scripts.length > 0, "Popup must have a bundled script");
	for (const [, attributes, body] of scripts) {
		const src = /\bsrc=["']([^"']+)["']/i.exec(attributes)?.[1];
		assert.ok(src && !body.trim(), "Inline or missing popup script");
		const file = src.replace(/^(?:\.\/|\/)/, "");
		assert.ok(
			files.includes(file) && file.startsWith("assets/"),
			"Nonlocal popup script",
		);
	}
	return files.sort();
}
