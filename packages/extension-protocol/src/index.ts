export const SESSION_TTL_MS = 5 * 60_000;
export const REQUEST_TTL_MS = 10_000;
export const PAIRING_TTL_MS = 60_000;
export const PORT_NAME = "svrgn-companion-v1";
export const MAX_MESSAGE_BYTES = 80_000;
export type Match = { id: string; title: string; username: string };
export type CompanionRequest =
	| {
			v: 1;
			type: "request";
			id: string;
			operation: "list";
			origin: string;
			expiresAt: number;
	  }
	| {
			v: 1;
			type: "request";
			id: string;
			operation: "credential";
			origin: string;
			expiresAt: number;
			itemId: string;
	  };
export type BackgroundMessage =
	| CompanionRequest
	| { v: 1; type: "paired"; expiresAt: number };
export type VaultMessage =
	| { v: 1; type: "hello"; token: string }
	| { v: 1; type: "locked" }
	| { v: 1; type: "result"; id: string; items: Match[] }
	| {
			v: 1;
			type: "credential";
			id: string;
			itemId: string;
			username: string;
			password: string;
	  }
	| {
			v: 1;
			type: "error";
			id: string;
			code: "locked" | "expired" | "not_found" | "invalid";
	  };
export function uuid(value: unknown): value is string {
	return (
		typeof value === "string" &&
		/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
			value,
		)
	);
}
export function record(value: unknown): value is Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	try {
		return (
			new TextEncoder().encode(JSON.stringify(value)).byteLength <=
			MAX_MESSAGE_BYTES
		);
	} catch {
		return false;
	}
}
export function keys(value: Record<string, unknown>, names: string[]) {
	return (
		Object.keys(value).length === names.length &&
		names.every((n) => Object.hasOwn(value, n))
	);
}
export function textField(value: unknown, max: number): value is string {
	return typeof value === "string" && value.length <= max;
}
export function normalizeOrigin(value: unknown): string | null {
	if (
		typeof value !== "string" ||
		!/^https?:\/\/[^/]/i.test(value) ||
		value.length > 4096 ||
		value.trim() !== value ||
		Array.from(value).some(
			(character) =>
				character.charCodeAt(0) <= 32 ||
				character.charCodeAt(0) === 127 ||
				character === "\\",
		)
	)
		return null;
	try {
		const url = new URL(value);
		if (
			!/^https?:$/.test(url.protocol) ||
			url.username ||
			url.password ||
			!url.hostname ||
			url.hostname.endsWith(".")
		)
			return null;
		return url.origin;
	} catch {
		return null;
	}
}
export function companionOrigin(value: unknown): string | null {
	const origin = normalizeOrigin(value);
	if (!origin) return null;
	const url = new URL(origin);
	return url.protocol === "https:" ||
		["localhost", "127.0.0.1"].includes(url.hostname)
		? origin
		: null;
}
export function originMatches(website: unknown, origin: unknown): boolean {
	const a = normalizeOrigin(website);
	return a !== null && a === normalizeOrigin(origin);
}
const timestamp = (value: unknown): value is number =>
	typeof value === "number" && Number.isSafeInteger(value) && value > 0;
export function requestIsLive(
	request: { expiresAt: number },
	now = Date.now(),
): boolean {
	return request.expiresAt > now && request.expiresAt <= now + REQUEST_TTL_MS;
}
export function parseCompanionRequest(value: unknown): CompanionRequest | null {
	if (
		!record(value) ||
		value.v !== 1 ||
		value.type !== "request" ||
		!uuid(value.id) ||
		!timestamp(value.expiresAt) ||
		typeof value.origin !== "string" ||
		normalizeOrigin(value.origin) !== value.origin
	)
		return null;
	const fields = ["v", "type", "id", "operation", "origin", "expiresAt"];
	if (value.operation === "list" && keys(value, fields))
		return value as CompanionRequest;
	if (
		value.operation === "credential" &&
		keys(value, [...fields, "itemId"]) &&
		uuid(value.itemId)
	)
		return value as CompanionRequest;
	return null;
}
export function parseBackgroundMessage(
	value: unknown,
): BackgroundMessage | null {
	const request = parseCompanionRequest(value);
	if (request) return request;
	if (
		record(value) &&
		keys(value, ["v", "type", "expiresAt"]) &&
		value.v === 1 &&
		value.type === "paired" &&
		timestamp(value.expiresAt)
	)
		return value as BackgroundMessage;
	return null;
}
export function parseVaultMessage(value: unknown): VaultMessage | null {
	if (!record(value) || value.v !== 1) return null;
	if (value.type === "locked" && keys(value, ["v", "type"]))
		return value as VaultMessage;
	if (
		value.type === "hello" &&
		keys(value, ["v", "type", "token"]) &&
		uuid(value.token)
	)
		return value as VaultMessage;
	if (!uuid(value.id)) return null;
	if (
		value.type === "error" &&
		keys(value, ["v", "type", "id", "code"]) &&
		typeof value.code === "string" &&
		["locked", "expired", "not_found", "invalid"].includes(value.code)
	)
		return value as VaultMessage;
	if (
		value.type === "credential" &&
		keys(value, ["v", "type", "id", "itemId", "username", "password"]) &&
		uuid(value.itemId) &&
		textField(value.username, 1000) &&
		textField(value.password, 4096)
	)
		return value as VaultMessage;
	if (
		value.type === "result" &&
		keys(value, ["v", "type", "id", "items"]) &&
		Array.isArray(value.items) &&
		value.items.length <= 50 &&
		value.items.every(
			(item) =>
				record(item) &&
				keys(item, ["id", "title", "username"]) &&
				uuid(item.id) &&
				textField(item.title, 200) &&
				textField(item.username, 1000),
		) &&
		new Set(value.items.map((item) => item.id)).size === value.items.length
	)
		return value as VaultMessage;
	return null;
}
/** Memory-only single-use capabilities; restart drops all authorization. */
export class Capabilities<T> {
	private entries = new Map<string, { value: T; expiresAt: number }>();
	issue(value: T, ttl = REQUEST_TTL_MS, now = Date.now()): string {
		this.prune(now);
		const id = crypto.randomUUID();
		this.entries.set(id, { value, expiresAt: now + ttl });
		return id;
	}
	consume(id: string, now = Date.now()): T | null {
		const entry = this.entries.get(id);
		this.entries.delete(id);
		return entry && entry.expiresAt > now ? entry.value : null;
	}
	clear() {
		this.entries.clear();
	}
	private prune(now: number) {
		for (const [id, entry] of this.entries)
			if (entry.expiresAt <= now) this.entries.delete(id);
	}
}
