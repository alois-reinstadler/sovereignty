import {
	Capabilities,
	companionOrigin,
	keys,
	type Match,
	normalizeOrigin,
	PAIRING_TTL_MS,
	PORT_NAME,
	parseVaultMessage,
	REQUEST_TTL_MS,
	record,
	SESSION_TTL_MS,
	type VaultMessage,
} from "@svrgn/extension-protocol";
import { parseForms, parsePopupRequest, trustedPopup } from "./messages";

type Session = {
	port: chrome.runtime.Port;
	expiresAt: number;
	tabId: number;
	origin: string;
};
type Target = { tabId: number; documentId: string; origin: string };
type FillGrant = Target & {
	expiresAt: number;
	session: Session;
	items: string[];
	forms: string[];
};
let session: Session | null = null;
let state: "disconnected" | "locked" | "connected" = "disconnected";
let pairing: {
	token: string;
	tabId: number;
	origin: string;
	expiresAt: number;
} | null = null;
const grants = new Capabilities<FillGrant>();
const pending = new Map<
	string,
	{
		resolve: (value: VaultMessage) => void;
		reject: (error: Error) => void;
		timer: ReturnType<typeof setTimeout>;
		operation: "list" | "credential";
		itemId?: string;
		expiresAt: number;
	}
>();
function lock() {
	const old = session;
	session = null;
	state = "locked";
	pairing = null;
	grants.clear();
	for (const request of pending.values()) {
		clearTimeout(request.timer);
		request.reject(new Error("Vault locked or disconnected. Pair again."));
	}
	pending.clear();
	old?.port.disconnect();
}
function requireSession(): Session {
	if (!session || session.expiresAt <= Date.now()) {
		lock();
		throw new Error("Vault locked or disconnected. Pair your unlocked vault.");
	}
	return session;
}
function requestVault(
	operation: "list" | "credential",
	origin: string,
	itemId?: string,
): Promise<VaultMessage> {
	const active = requireSession();
	const id = crypto.randomUUID();
	const expiresAt = Date.now() + REQUEST_TTL_MS;
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			pending.delete(id);
			reject(new Error("Vault request expired. Refresh and try again."));
		}, REQUEST_TTL_MS);
		pending.set(id, { resolve, reject, timer, operation, itemId, expiresAt });
		active.port.postMessage({
			v: 1,
			type: "request",
			id,
			operation,
			origin,
			expiresAt: Date.now() + REQUEST_TTL_MS,
			...(itemId ? { itemId } : {}),
		});
	});
}
chrome.runtime.onConnectExternal.addListener((port) => {
	const sender = port.sender;
	const attempt = pairing;
	if (
		port.name !== PORT_NAME ||
		!attempt ||
		attempt.expiresAt <= Date.now() ||
		sender?.id ||
		sender?.frameId !== 0 ||
		sender.tab?.id !== attempt.tabId ||
		sender.origin !== attempt.origin ||
		normalizeOrigin(sender.url) !== attempt.origin
	) {
		port.disconnect();
		return;
	}
	const timer = setTimeout(
		() => port.disconnect(),
		Math.max(1, attempt.expiresAt - Date.now()),
	);
	let authenticated = false;
	port.onMessage.addListener((raw) => {
		const message = parseVaultMessage(raw);
		if (!message) {
			port.disconnect();
			return;
		}
		if (!authenticated) {
			if (
				message.type !== "hello" ||
				message.token !== attempt.token ||
				pairing !== attempt ||
				attempt.expiresAt <= Date.now()
			) {
				port.disconnect();
				return;
			}
			clearTimeout(timer);
			pairing = null;
			authenticated = true;
			session = {
				port,
				expiresAt: Date.now() + SESSION_TTL_MS,
				tabId: attempt.tabId,
				origin: attempt.origin,
			};
			state = "connected";
			port.postMessage({ v: 1, type: "paired", expiresAt: session.expiresAt });
			const active = session;
			setTimeout(() => {
				if (session === active) lock();
			}, SESSION_TTL_MS);
			return;
		}
		if (session?.port !== port || session.expiresAt <= Date.now()) {
			lock();
			return;
		}
		if (message.type === "locked") {
			lock();
			return;
		}
		if (message.type === "hello") {
			lock();
			return;
		}
		const request = pending.get(message.id);
		if (!request) {
			lock();
			return;
		}
		pending.delete(message.id);
		clearTimeout(request.timer);
		if (request.expiresAt <= Date.now()) {
			request.reject(new Error("Expired vault response."));
			lock();
			return;
		}
		if (message.type === "error") {
			request.reject(new Error(`Vault request failed: ${message.code}`));
			if (message.code === "locked") lock();
			return;
		}
		if (
			(request.operation === "list" && message.type !== "result") ||
			(request.operation === "credential" &&
				(message.type !== "credential" || message.itemId !== request.itemId))
		) {
			request.reject(new Error("Invalid vault response."));
			lock();
			return;
		}
		request.resolve(message);
	});
	port.onDisconnect.addListener(() => {
		clearTimeout(timer);
		if (session?.port === port) lock();
	});
});
async function activeTarget(): Promise<{ tabId: number; origin: string }> {
	const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
	const origin = normalizeOrigin(tab?.url);
	if (!tab?.id || !origin)
		throw new Error(
			"Open a regular HTTP or HTTPS login page, then open Sovereignty.",
		);
	return { tabId: tab.id, origin };
}
async function assertTarget(target: Target) {
	const active = await activeTarget();
	if (active.tabId !== target.tabId || active.origin !== target.origin)
		throw new Error("The active page changed. Refresh matches.");
}
async function handle(raw: unknown) {
	const message = parsePopupRequest(raw);
	if (!message) throw new Error("Invalid popup request.");
	if (message.type === "status") {
		if (session && session.expiresAt <= Date.now()) lock();
		const settings = await chrome.storage.local.get("origin");
		return {
			ok: true,
			state,
			origin: companionOrigin(settings.origin) ?? "",
			expiresAt: session?.expiresAt ?? null,
		};
	}
	if (message.type === "lock") {
		lock();
		return { ok: true };
	}
	if (message.type === "pair") {
		const origin = companionOrigin(message.origin);
		if (!origin)
			throw new Error(
				"Use an HTTPS vault origin, or HTTP localhost for development.",
			);
		lock();
		await chrome.storage.local.set({ origin });
		const token = crypto.randomUUID();
		const tab = await chrome.tabs.create({
			url: `${origin}/#svrgn-pair=${chrome.runtime.id}.${token}`,
		});
		if (!tab.id) throw new Error("Could not open vault.");
		pairing = {
			token,
			tabId: tab.id,
			origin,
			expiresAt: Date.now() + PAIRING_TTL_MS,
		};
		const attempt = pairing;
		setTimeout(() => {
			if (pairing === attempt) pairing = null;
		}, PAIRING_TTL_MS);
		return { ok: true };
	}
	if (message.type === "list") {
		const active = requireSession();
		grants.clear();
		const target = await activeTarget();
		const injection = await chrome.scripting.executeScript({
			target: { tabId: target.tabId, frameIds: [0] },
			files: ["content.js"],
		});
		const documentId = injection.find(
			(frame) => frame.frameId === 0,
		)?.documentId;
		if (!documentId)
			throw new Error("The browser could not identify this document.");
		const bound = { ...target, documentId };
		await assertTarget(bound);
		const discovery: unknown = await chrome.tabs.sendMessage(
			target.tabId,
			{
				type: "discover",
				id: crypto.randomUUID(),
				origin: target.origin,
				expiresAt: Date.now() + REQUEST_TTL_MS,
			},
			{ documentId, frameId: 0 },
		);
		if (
			!record(discovery) ||
			!keys(discovery, ["ok", "forms"]) ||
			discovery.ok !== true
		)
			throw new Error("This page does not support safe fill.");
		const forms = parseForms(discovery.forms);
		if (!forms) throw new Error("Invalid form discovery response.");
		const result = await requestVault("list", target.origin);
		await assertTarget(bound);
		if (requireSession() !== active || result.type !== "result")
			throw new Error("Vault session changed.");
		const token = grants.issue({
			expiresAt: Date.now() + REQUEST_TTL_MS,
			...bound,
			session: active,
			items: result.items.map((item) => item.id),
			forms: forms.map((form) => form.id),
		});
		return {
			ok: true,
			origin: target.origin,
			items: result.items,
			forms,
			token,
			expiresAt: Date.now() + REQUEST_TTL_MS,
		};
	}
	const grant = grants.consume(message.token);
	if (
		!grant ||
		grant.session !== requireSession() ||
		!grant.items.includes(message.itemId) ||
		!grant.forms.includes(message.formId)
	)
		throw new Error("Fill approval expired. Refresh matches.");
	await assertTarget(grant);
	let credential = await requestVault(
		"credential",
		grant.origin,
		message.itemId,
	);
	try {
		await assertTarget(grant);
		if (
			requireSession() !== grant.session ||
			grant.expiresAt <= Date.now() ||
			credential.type !== "credential"
		)
			throw new Error("Vault session changed.");
		const result: unknown = await chrome.tabs.sendMessage(
			grant.tabId,
			{
				type: "fill",
				id: crypto.randomUUID(),
				origin: grant.origin,
				expiresAt: Date.now() + REQUEST_TTL_MS,
				formId: message.formId,
				username: credential.username,
				password: credential.password,
			},
			{ documentId: grant.documentId, frameId: 0 },
		);
		if (!record(result) || !keys(result, ["ok"]) || result.ok !== true)
			throw new Error("The form changed or expired. Refresh matches.");
		return { ok: true };
	} finally {
		if (credential.type === "credential") {
			credential.username = "";
			credential.password = "";
		}
		credential = { v: 1, type: "locked" };
	}
}
chrome.runtime.onMessage.addListener((raw, sender, respond) => {
	if (
		!trustedPopup(
			sender,
			chrome.runtime.id,
			chrome.runtime.getURL("popup.html"),
		)
	) {
		respond({ ok: false, error: "Unauthorized sender." });
		return false;
	}
	void handle(raw)
		.then(respond)
		.catch(() =>
			respond({
				ok: false,
				error:
					"Request rejected or expired. Check the page and pair or refresh again.",
			}),
		);
	return true;
});
chrome.tabs.onRemoved.addListener((tabId) => {
	if (session?.tabId === tabId || pairing?.tabId === tabId) lock();
	grants.clear();
});
chrome.tabs.onUpdated.addListener((tabId, change) => {
	grants.clear();
	if ((session?.tabId === tabId || pairing?.tabId === tabId) && change.url) {
		const origin = normalizeOrigin(change.url);
		if (origin !== (session?.origin ?? pairing?.origin)) lock();
	}
});
void chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
export type { Match };
