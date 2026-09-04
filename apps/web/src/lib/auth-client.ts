import { createAuthClient } from "better-auth/react";

/** Account authentication is separate from local vault-key derivation. */
export const authClient = createAuthClient();
