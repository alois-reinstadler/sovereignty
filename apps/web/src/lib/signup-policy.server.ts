import { createHash, timingSafeEqual } from "node:crypto";
import { APIError } from "better-auth/api";
import type { ServerEnvironment } from "./server-env";

type SignupPolicy = Pick<ServerEnvironment, "signupMode" | "signupInvitations">;

/** Every Better Auth user creation goes through this guard, including non-email paths. */
export const assertSignupAllowed = (
	policy: SignupPolicy,
	email: string,
	invitation: string | null | undefined,
	path: string | undefined,
	now = Date.now(),
): void => {
	if (policy.signupMode === "open") return;
	const deny = (): never => {
		throw new APIError("FORBIDDEN", {
			message:
				"Account registration is unavailable or the invitation is invalid.",
		});
	};
	if (
		policy.signupMode !== "invite-only" ||
		path !== "/sign-up/email" ||
		typeof invitation !== "string" ||
		!/^[a-f0-9]{64}$/.test(invitation)
	) {
		deny();
		return;
	}
	const digest = createHash("sha256").update(invitation, "utf8").digest();
	const normalizedEmail = email.trim().toLowerCase();
	let allowed = false;
	// Compare all fixed-length hashes so an email lookup does not reveal the allowlist.
	for (const entry of policy.signupInvitations) {
		const matches = timingSafeEqual(
			digest,
			Buffer.from(entry.tokenHash, "hex"),
		);
		allowed =
			(matches && entry.email === normalizedEmail && now < entry.expiresAt) ||
			allowed;
	}
	if (!allowed) deny();
};
