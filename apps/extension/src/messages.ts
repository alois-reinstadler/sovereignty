import {
	keys,
	normalizeOrigin,
	record,
	textField,
	uuid,
} from "@svrgn/extension-protocol";
export const CONTENT_PORT_NAME = "svrgn-content-registration-v1";
export type PopupRequest =
	| { type: "status" }
	| { type: "lock" }
	| { type: "list" }
	| { type: "watch"; token: string; formId: string }
	| { type: "review"; token: string }
	| { type: "pair"; origin: string }
	| { type: "fill"; token: string; itemId: string; formId: string };
export type ContentRequest =
	| { type: "discover"; id: string; origin: string; expiresAt: number }
	| {
			type: "watch";
			id: string;
			origin: string;
			expiresAt: number;
			formId: string;
			token: string;
	  }
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
export type CandidateMetadata = {
	token: string;
	origin: string;
	username: string;
	expiresAt: number;
};
export function parseCandidateMetadata(
	value: unknown,
): CandidateMetadata | null {
	if (
		!record(value) ||
		!keys(value, ["token", "origin", "username", "expiresAt"]) ||
		!uuid(value.token) ||
		typeof value.origin !== "string" ||
		normalizeOrigin(value.origin) !== value.origin ||
		!textField(value.username, 1000) ||
		typeof value.expiresAt !== "number" ||
		!Number.isSafeInteger(value.expiresAt) ||
		value.expiresAt <= Date.now() ||
		value.expiresAt > Date.now() + 30_000
	)
		return null;
	return value as CandidateMetadata;
}
export type CapturedSubmission = {
	type: "submitted";
	token: string;
	username: string;
	password: string;
};
export function clearPlaintext(value: unknown) {
	if (value && typeof value === "object") {
		try {
			if ("username" in value) value.username = "";
			if ("password" in value) value.password = "";
		} catch {
			/* Serialized messages are mutable; frozen test inputs simply release. */
		}
	}
}
export function parseCapturedSubmission(
	value: unknown,
): CapturedSubmission | null {
	if (
		!record(value) ||
		!keys(value, ["type", "token", "username", "password"]) ||
		value.type !== "submitted" ||
		!uuid(value.token) ||
		!textField(value.username, 1000) ||
		!textField(value.password, 4096) ||
		!value.password.length
	)
		return null;
	return value as CapturedSubmission;
}
export function parsePopupRequest(value: unknown): PopupRequest | null {
	if (!record(value)) return null;
	if (
		value.type === "review" &&
		keys(value, ["type", "token"]) &&
		uuid(value.token)
	)
		return value as PopupRequest;
	if (
		value.type === "watch" &&
		keys(value, ["type", "token", "formId"]) &&
		uuid(value.token) &&
		uuid(value.formId)
	)
		return value as PopupRequest;
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
	if (
		value.type === "watch" &&
		keys(value, [...fields, "formId", "token"]) &&
		uuid(value.formId) &&
		uuid(value.token)
	)
		return value as ContentRequest;
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
