import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const hashes = [];
for (let build = 0; build < 2; build++) {
	execFileSync("pnpm", ["package"], { stdio: "inherit" });
	hashes.push(
		createHash("sha256")
			.update(await readFile("sovereignty-chromium.zip"))
			.digest("hex"),
	);
}
assert.equal(
	hashes[0],
	hashes[1],
	"Independent builds produced different extension archives",
);
console.log(`Reproducible extension ZIP: ${hashes[0]}`);
