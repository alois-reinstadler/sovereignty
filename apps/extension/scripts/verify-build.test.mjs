import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { verifyBuild, verifyManifest } from "./verify-build.mjs";

const manifest = JSON.parse(
	await readFile(new URL("../manifest.json", import.meta.url), "utf8"),
);
test("reviewed manifest retains its exact permission boundary", () =>
	verifyManifest(manifest));
for (const change of [
	{ permissions: [...manifest.permissions, "tabs"] },
	{ host_permissions: ["<all_urls>"] },
	{ optional_host_permissions: ["https://*/*"] },
	{
		externally_connectable: { ...manifest.externally_connectable, ids: ["*"] },
	},
	{
		content_security_policy: {
			extension_pages: "script-src 'self' 'unsafe-eval'",
		},
	},
	{ content_scripts: [{ matches: ["<all_urls>"], js: ["content.js"] }] },
	{ web_accessible_resources: [{ resources: ["*"], matches: ["<all_urls>"] }] },
	{
		background: {
			service_worker: "https://remote.invalid/worker.js",
			type: "module",
		},
	},
])
	test(`rejects permission drift: ${Object.keys(change)[0]}`, () =>
		assert.throws(() => verifyManifest({ ...manifest, ...change })));

test("refuses environment files in unpacked output", async () => {
	const directory = await mkdtemp(join(tmpdir(), "svrgn-artifact-"));
	try {
		await writeFile(join(directory, ".env"), "SYNTHETIC_TEST_ONLY=");
		await assert.rejects(verifyBuild(directory));
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
