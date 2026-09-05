import { normalizeOrigin, REQUEST_TTL_MS } from "@svrgn/extension-protocol";

type Candidate = {
	form: HTMLFormElement;
	username: HTMLInputElement;
	password: HTMLInputElement;
	expiresAt: number;
	origin: string;
};
export function writable(input: HTMLInputElement): boolean {
	if (
		!input.isConnected ||
		input.disabled ||
		input.readOnly ||
		input.type === "hidden" ||
		input.closest("[hidden],[inert],fieldset:disabled")
	)
		return false;
	if (
		!Array.from(input.getClientRects()).some(
			(rect) => rect.width > 1 && rect.height > 1,
		)
	)
		return false;
	if (
		typeof input.checkVisibility === "function" &&
		!input.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
	)
		return false;
	for (let node: HTMLElement | null = input; node; node = node.parentElement) {
		const style = getComputedStyle(node);
		if (
			style.visibility !== "visible" ||
			style.display === "none" ||
			Number(style.opacity) === 0
		)
			return false;
	}
	return true;
}
function valid(candidate: Candidate, origin: string): boolean {
	const { form, username, password } = candidate;
	return (
		candidate.origin === origin &&
		candidate.expiresAt > Date.now() &&
		form.isConnected &&
		username.form === form &&
		password.form === form &&
		writable(username) &&
		writable(password) &&
		password.type === "password" &&
		["text", "email", "tel"].includes(username.type) &&
		normalizeOrigin(form.action) === origin
	);
}
/** Handles hold DOM identities, never page-selected selectors. Top document only. */
export class FormDiscovery {
	private candidates = new Map<string, Candidate>();
	clear() {
		this.candidates.clear();
	}
	discover(document: Document, origin: string) {
		this.clear();
		const choices: { id: string; label: string }[] = [];
		for (const [index, form] of Array.from(document.forms).entries()) {
			if (choices.length >= 20 || normalizeOrigin(form.action) !== origin)
				continue;
			const inputs = Array.from(form.elements).filter(
				(element): element is HTMLInputElement =>
					element instanceof HTMLInputElement && writable(element),
			);
			const passwords = inputs.filter((input) => input.type === "password");
			const usernames = inputs.filter(
				(input) =>
					["text", "email", "tel"].includes(input.type) &&
					(/username|email/i.test(input.autocomplete) ||
						/user|email|login/i.test(`${input.name} ${input.id}`) ||
						input.type === "email"),
			);
			if (passwords.length !== 1 || usernames.length !== 1) continue;
			const id = crypto.randomUUID();
			this.candidates.set(id, {
				form,
				username: usernames[0],
				password: passwords[0],
				expiresAt: Date.now() + REQUEST_TTL_MS,
				origin,
			});
			choices.push({ id, label: `Login form ${index + 1}` });
		}
		return choices;
	}
	fill(
		id: string,
		origin: string,
		username: string,
		password: string,
	): boolean {
		const candidate = this.candidates.get(id);
		this.clear();
		if (!candidate || !valid(candidate, origin)) return false;
		const setter = Object.getOwnPropertyDescriptor(
			HTMLInputElement.prototype,
			"value",
		)?.set;
		if (!setter) return false;
		// Set both values before dispatch: event handlers cannot swap the second target.
		setter.call(candidate.username, username);
		setter.call(candidate.password, password);
		for (const input of [candidate.username, candidate.password]) {
			input.dispatchEvent(new Event("input", { bubbles: true }));
			input.dispatchEvent(new Event("change", { bubbles: true }));
		}
		return true;
	}
}
