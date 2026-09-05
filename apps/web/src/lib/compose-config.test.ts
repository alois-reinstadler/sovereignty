import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("self-hosted Compose configuration", () => {
	it("passes optional passkey origin overrides to the app", async () => {
		const compose = await readFile(
			fileURLToPath(new URL("../../../../compose.yaml", import.meta.url)),
			"utf8",
		);

		expect(compose).toContain(`PASSKEY_RP_ID: \${PASSKEY_RP_ID:-}`);
		expect(compose).toContain(`PASSKEY_ORIGINS: \${PASSKEY_ORIGINS:-}`);
	});

	it("defaults deployed signup to closed and passes invitation hashes only to the server", async () => {
		const compose = await readFile(
			fileURLToPath(new URL("../../../../compose.yaml", import.meta.url)),
			"utf8",
		);
		expect(compose).toContain(`SIGNUP_MODE: \${SIGNUP_MODE:-closed}`);
		expect(compose).toContain(`SIGNUP_INVITATIONS: \${SIGNUP_INVITATIONS:-[]}`);
		expect(compose).not.toContain("VITE_SIGNUP_INVITATIONS");
	});
});
