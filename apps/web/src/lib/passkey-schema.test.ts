import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("passkey database migration", () => {
	it("contains every Better Auth passkey field and cascades account deletion", async () => {
		const migration = await readFile(
			fileURLToPath(
			new URL("../../migrations/004_passkeys.sql", import.meta.url),
			),
			"utf8",
		);

		for (const field of [
			"name",
			"publicKey",
			"userId",
			"credentialID",
			"counter",
			"deviceType",
			"backedUp",
			"transports",
			"createdAt",
			"aaguid",
		]) {
			expect(migration).toContain(`"${field}"`);
		}
		expect(migration).toContain('references "user" ("id") on delete cascade');
		expect(migration).not.toContain("master_password");
		expect(migration).not.toContain("vault_key");
	});
});
