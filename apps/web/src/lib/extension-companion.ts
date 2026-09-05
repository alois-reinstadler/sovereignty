import {
	normalizeOrigin,
	PROPOSAL_TTL_MS,
	parseBackgroundMessage,
	parseVaultMessage,
	REQUEST_TTL_MS,
	SESSION_TTL_MS,
	type SubmissionProposal,
} from "@svrgn/extension-protocol";
import type { VaultItem } from "./models";

export interface PairingLink {
	extensionId: string;
	token: string;
}

export function parsePairingLink(hash: string): PairingLink | null {
	const match =
		/^#svrgn-pair=([a-p]{32})\.([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/.exec(
			hash,
		);
	return match ? { extensionId: match[1], token: match[2] } : null;
}

/** Only the browser's direct external runtime port is used, never page events. */
export interface CompanionPort {
	postMessage(message: unknown): void;
	disconnect(): void;
	onMessage: {
		addListener(listener: (message: unknown) => void): void;
		removeListener(listener: (message: unknown) => void): void;
	};
	onDisconnect: {
		addListener(listener: () => void): void;
		removeListener(listener: () => void): void;
	};
}

export interface CompanionRuntime {
	connect(extensionId: string, options: { name: string }): CompanionPort;
	lastError?: { message?: string };
}

export function companionRuntime(): CompanionRuntime | null {
	const host = globalThis as typeof globalThis & {
		chrome?: { runtime?: CompanionRuntime };
	};
	return typeof host.chrome?.runtime?.connect === "function"
		? host.chrome.runtime
		: null;
}

export type CompanionState =
	| "connecting"
	| "connected"
	| "disconnected"
	| "expired"
	| "error";

/**
 * The read callback must check the current lock/inactivity state synchronously.
 * This controller holds no vault document, key, password or credential cache.
 */
export function attachCompanion(
	port: CompanionPort,
	token: string,
	readItems: () => ReadonlyArray<VaultItem> | null,
	onState: (state: CompanionState) => void,
	now: () => number = Date.now,
	proposals?: {
		offer: (proposal: SubmissionProposal, isLive: () => boolean) => void;
		clear: () => void;
	},
) {
	let closed = false;
	let paired = false;
	let expiresAt = 0;
	const seen = new Set<string>();
	const start = now();
	let timer: ReturnType<typeof setTimeout>;
	const stop = (state: CompanionState = "disconnected") => {
		if (closed) return;
		closed = true;
		clearTimeout(timer);
		seen.clear();
		proposals?.clear();
		port.onMessage.removeListener(receive);
		port.onDisconnect.removeListener(disconnected);
		try {
			port.postMessage({ v: 1, type: "locked" });
		} catch {
			/* Already disconnected. */
		}
		try {
			port.disconnect();
		} catch {
			/* Already disconnected. */
		}
		onState(state);
	};
	const disconnected = () => {
		// Reading lastError prevents Chrome's unchecked runtime error diagnostic.
		void companionRuntime()?.lastError;
		stop();
	};
	const send = (message: unknown) => {
		const checked = parseVaultMessage(message);
		if (!checked) {
			stop("error");
			return;
		}
		try {
			port.postMessage(checked);
		} catch {
			stop("error");
		}
	};
	const receive = (raw: unknown) => {
		try {
			if (closed) return;
			const message = parseBackgroundMessage(raw);
			if (!message) {
				stop("error");
				return;
			}
			const time = now();
			if (message.type === "paired") {
				if (
					paired ||
					time - start > REQUEST_TTL_MS ||
					message.expiresAt <= time ||
					message.expiresAt > time + SESSION_TTL_MS
				) {
					stop("error");
					return;
				}
				paired = true;
				expiresAt = message.expiresAt;
				clearTimeout(timer);
				timer = setTimeout(() => stop("expired"), expiresAt - time);
				onState("connected");
				return;
			}
			if (!paired || time >= expiresAt || time < start) {
				stop("expired");
				return;
			}
			if (seen.has(message.id) || seen.size >= 1000) {
				stop("error");
				return;
			}
			seen.add(message.id);
			if (
				message.expiresAt <= time ||
				message.expiresAt >
					time +
						(message.type === "proposal" ? PROPOSAL_TTL_MS : REQUEST_TTL_MS)
			) {
				send({ v: 1, type: "error", id: message.id, code: "expired" });
				return;
			}
			if (
				typeof message.origin !== "string" ||
				!normalizeOrigin(message.origin)
			) {
				stop("error");
				return;
			}
			const items = readItems();
			if (!items) {
				stop();
				return;
			}
			if (message.type === "proposal") {
				try {
					proposals?.offer(
						message,
						() =>
							!closed && paired && now() < expiresAt && readItems() !== null,
					);
				} finally {
					message.username = "";
					message.password = "";
				}
				return;
			}
			const matches = items.filter(
				(item) => normalizeOrigin(item.website) === message.origin,
			);
			if (message.operation === "list") {
				send({
					v: 1,
					type: "result",
					id: message.id,
					items: matches.slice(0, 50).map(({ id, title, username }) => ({
						id,
						title: title.slice(0, 200),
						username: username.slice(0, 1000),
					})),
				});
				return;
			}
			const item = matches.find((candidate) => candidate.id === message.itemId);
			if (!item) {
				send({ v: 1, type: "error", id: message.id, code: "not_found" });
				return;
			}
			// Single synchronous read + send: there is no async gap during which lock
			// can start, and no retained response after the browser serializes it.
			send({
				v: 1,
				type: "credential",
				id: message.id,
				itemId: item.id,
				username: item.username,
				password: item.password,
			});
		} finally {
			if (raw && typeof raw === "object") {
				try {
					if ("username" in raw) raw.username = "";
					if ("password" in raw) raw.password = "";
				} catch {
					/* Discard immutable or hostile malformed input. */
				}
			}
		}
	};
	port.onMessage.addListener(receive);
	port.onDisconnect.addListener(disconnected);
	timer = setTimeout(() => stop("expired"), REQUEST_TTL_MS);
	onState("connecting");
	send({ v: 1, type: "hello", token });
	return stop;
}
