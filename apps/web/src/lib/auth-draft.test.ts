import { describe, expect, it } from "vitest";
import { authDraftForContext } from "./auth-draft";

describe("master-password draft revocation", () => {
	it("erases setup and unlock drafts before the next render on desktop lock", () => {
		for (const mode of ["setup", "locked"]) {
			const draft = {
				context: `${mode}:0`,
				password: "synthetic-master-password",
				confirmation: "synthetic-confirmation",
				showPassword: true,
			};
			expect(authDraftForContext(draft, `${mode}:1`)).toEqual({
				context: `${mode}:1`,
				password: "",
				confirmation: "",
				showPassword: false,
			});
		}
	});
	it("clears credentials when an encrypted import changes the auth mode", () => {
		const draft = {
			context: "setup:0",
			password: "synthetic-master-password",
			confirmation: "synthetic-confirmation",
			showPassword: true,
		};
		expect(authDraftForContext(draft, "locked:0").password).toBe("");
	});
	it("preserves current input within the same authorized context", () => {
		const draft = {
			context: "setup:0",
			password: "synthetic",
			confirmation: "synthetic",
			showPassword: false,
		};
		expect(authDraftForContext(draft, draft.context)).toBe(draft);
	});
});
