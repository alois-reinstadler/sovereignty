import {
	normalizeOrigin,
	PROPOSAL_TTL_MS,
	requestIsLive,
} from "@svrgn/extension-protocol";
import { FormDiscovery } from "./forms";
import {
	CONTENT_PORT_NAME,
	clearPlaintext,
	parseContentRequest,
} from "./messages";

// Reinjection replaces the old listener and its DOM handles instead of multiplying it.
type Context = typeof globalThis & { __svrgnCleanup?: () => void };
const context = globalThis as Context;
context.__svrgnCleanup?.();
const discovery = new FormDiscovery();
const seen = new Set<string>();
const listener = (
	raw: unknown,
	sender: chrome.runtime.MessageSender,
	respond: (value: unknown) => void,
) => {
	let message = parseContentRequest(raw);
	if (
		sender.id !== chrome.runtime.id ||
		sender.tab ||
		!message ||
		window.top !== window ||
		globalThis.origin !== message.origin ||
		!(message.type === "watch"
			? message.expiresAt > Date.now() &&
				message.expiresAt <= Date.now() + PROPOSAL_TTL_MS
			: requestIsLive(message)) ||
		message.origin !== normalizeOrigin(location.href) ||
		seen.has(message.id)
	) {
		clearPlaintext(raw);
		respond({ ok: false });
		return;
	}
	seen.add(message.id);
	if (seen.size > 100) {
		clearPlaintext(raw);
		discovery.clear();
		respond({ ok: false });
		return;
	}
	if (message.type === "discover") {
		respond({ ok: true, forms: discovery.discover(document, message.origin) });
		setTimeout(() => discovery.clearDiscovery(), 10_000);
		return;
	}
	if (message.type === "watch") {
		const token = message.token;
		const origin = message.origin;
		const ok = discovery.watch(
			message.formId,
			origin,
			message.expiresAt,
			(credentials) => {
				try {
					port.postMessage({
						type: "submitted",
						token,
						username: credentials.username,
						password: credentials.password,
					});
				} catch {
					/* Disconnected captures are discarded. */
				}
			},
			() =>
				window.top === window &&
				globalThis.origin === origin &&
				normalizeOrigin(location.href) === origin,
		);
		respond({ ok });
		return;
	}
	let ok = false;
	try {
		ok = discovery.fill(
			message.formId,
			message.origin,
			message.username,
			message.password,
		);
	} catch {
		ok = false;
	} finally {
		message.username = "";
		message.password = "";
		message = null;
	}
	respond({ ok });
};
chrome.runtime.onMessage.addListener(listener);
const port = chrome.runtime.connect({ name: CONTENT_PORT_NAME });
context.__svrgnCleanup = () => {
	chrome.runtime.onMessage.removeListener(listener);
	discovery.clear();
	seen.clear();
	port.disconnect();
};
port.onDisconnect.addListener(() => {
	void chrome.runtime.lastError;
	chrome.runtime.onMessage.removeListener(listener);
	discovery.clear();
	seen.clear();
});
