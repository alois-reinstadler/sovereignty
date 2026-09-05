export type AuthDraft = {
	context: string;
	password: string;
	confirmation: string;
	showPassword: boolean;
};
export function authDraftForContext(
	draft: AuthDraft,
	context: string,
): AuthDraft {
	return draft.context === context
		? draft
		: { context, password: "", confirmation: "", showPassword: false };
}
