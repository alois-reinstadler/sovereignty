import {
	keys,
	normalizeOrigin,
	record,
	textField,
	uuid,
} from "@svrgn/extension-protocol";
export type PopupRequest =
	| { type: "status" }
	| { type: "lock" }
	| { type: "list" }
	| { type: "pair"; origin: string }
	| { type: "fill"; token: string; itemId: string; formId: string };
export type ContentRequest =
	| { type: "discover"; id: string; origin: string; expiresAt: number }
	| {
			type: "fill";
			id: string;
			origin: string;
			expiresAt: number;
			formId: string;
			username: string;
			password: string;
	  };
export type FormChoice = { id: string; label: string };
export function parsePopupRequest(value: unknown): PopupRequest | null {
	if (!record(value)) return null;
	if (
		typeof value.type === "string" &&
		["status", "lock", "list"].includes(value.type) &&
		keys(value, ["type"])
	)
		return value as PopupRequest;
	if (
		value.type === "pair" &&
		keys(value, ["type", "origin"]) &&
		textField(value.origin, 4096)
	)
		return value as PopupRequest;
	if (
		value.type === "fill" &&
		keys(value, ["type", "token", "itemId", "formId"]) &&
		uuid(value.token) &&
		uuid(value.itemId) &&
		uuid(value.formId)
	)
		return value as PopupRequest;
	return null;
}
export function parseContentRequest(value: unknown): ContentRequest | null {
	if (
		!record(value) ||
		!uuid(value.id) ||
		typeof value.origin !== "string" ||
		normalizeOrigin(value.origin) !== value.origin ||
		typeof value.expiresAt !== "number" ||
		!Number.isSafeInteger(value.expiresAt)
	)
		return null;
	const fields = ["type", "id", "origin", "expiresAt"];
	if (value.type === "discover" && keys(value, fields))
		return value as ContentRequest;
	if (
		value.type === "fill" &&
		keys(value, [...fields, "formId", "username", "password"]) &&
		uuid(value.formId) &&
		textField(value.username, 1000) &&
		textField(value.password, 4096)
	)
		return value as ContentRequest;
	return null;
}
export function parseForms(value: unknown): FormChoice[] | null {
	if (
		!Array.isArray(value) ||
		value.length > 20 ||
		!value.every(
			(item) =>
				record(item) &&
				keys(item, ["id", "label"]) &&
				uuid(item.id) &&
				textField(item.label, 100),
		)
	)
		return null;
	return value as FormChoice[];
}
export function trustedPopup(
	sender: chrome.runtime.MessageSender,
	extensionId: string,
	popupUrl: string,
): boolean {
	return sender.id === extensionId && sender.url === popupUrl && !sender.tab;
}
