import { normalizeOrigin, requestIsLive } from "@svrgn/extension-protocol";
import { FormDiscovery } from "./forms";
import { parseContentRequest } from "./messages";

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
		!requestIsLive(message) ||
		message.origin !== normalizeOrigin(location.href) ||
		seen.has(message.id)
	) {
		respond({ ok: false });
		return;
	}
	seen.add(message.id);
	if (seen.size > 100) {
		discovery.clear();
		respond({ ok: false });
		return;
	}
	if (message.type === "discover") {
		respond({ ok: true, forms: discovery.discover(document, message.origin) });
		setTimeout(() => discovery.clear(), 10_000);
		return;
	}
	const ok = discovery.fill(
		message.formId,
		message.origin,
		message.username,
		message.password,
	);
	message.username = "";
	message.password = "";
	message = null;
	respond({ ok });
};
chrome.runtime.onMessage.addListener(listener);
context.__svrgnCleanup = () => {
	chrome.runtime.onMessage.removeListener(listener);
	discovery.clear();
	seen.clear();
};
