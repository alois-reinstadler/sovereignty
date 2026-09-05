import { passkeyClient } from "@better-auth/passkey/client";
import { createAuthClient } from "better-auth/react";
import { IS_DESKTOP } from "./client-platform";

/** Account authentication is separate from local vault-key derivation. */
const createClient = () => createAuthClient({ plugins: [passkeyClient()] });
let client: ReturnType<typeof createClient> | undefined;

/** Native bundled origins must never initialize the HTTP account client. */
export function getAuthClient() {
	if (IS_DESKTOP)
		throw new Error(
			"Account authentication is unavailable in this desktop client.",
		);
	client ??= createClient();
	return client;
}
