import { passkeyClient } from "@better-auth/passkey/client";
import { createAuthClient } from "better-auth/react";

/** Account authentication is separate from local vault-key derivation. */
export const authClient = createAuthClient({ plugins: [passkeyClient()] });
