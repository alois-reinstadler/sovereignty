import {
	Capabilities,
	companionOrigin,
	keys,
	type Match,
	normalizeOrigin,
	PAIRING_TTL_MS,
	PORT_NAME,
	PROPOSAL_TTL_MS,
	parseSubmissionProposal,
	parseVaultMessage,
	REQUEST_TTL_MS,
	record,
	SESSION_TTL_MS,
	type VaultMessage,
} from "@svrgn/extension-protocol";
import {
	CONTENT_PORT_NAME,
	clearPlaintext,
	parseCapturedSubmission,
	parseForms,
	parsePopupRequest,
	trustedPopup,
} from "./messages";

type Session = {
	port: chrome.runtime.Port;
	expiresAt: number;
	tabId: number;
	origin: string;
};
type Target = { tabId: number; documentId: string; origin: string };
type ContentRegistration = Target & {
	close: () => void;
};
type FillGrant = Target & {
	expiresAt: number;
	session: Session;
	items: string[];
	forms: string[];
	registration: ContentRegistration;
};
const documents = new Map<string, ContentRegistration>();
const registrations = new Map<
	string,
	{ resolve: () => void; reject: (error: Error) => void }
>();
function bounded<T>(operation: Promise<T>, expiresAt: number): Promise<T> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(
			() => reject(new Error("Content acknowledgement expired.")),
			Math.max(0, expiresAt - Date.now()),
		);
		operation.then(
			(value) => {
				clearTimeout(timer);
				if (Date.now() >= expiresAt)
					reject(new Error("Content acknowledgement expired."));
				else resolve(value);
			},
			(error) => {
				clearTimeout(timer);
				reject(error);
			},
		);
	});
}
function requireDocument(target: Target): ContentRegistration {
	const registration = documents.get(target.documentId);
	if (
		!registration ||
		registration.tabId !== target.tabId ||
		registration.origin !== target.origin
	)
		throw new Error("Document origin was not authenticated by the browser.");
	return registration;
}
async function registeredDocument(target: Target) {
	if (!documents.has(target.documentId)) {
		if (registrations.size >= 16 || registrations.has(target.documentId))
			throw new Error("Too many document registrations.");
		try {
			await bounded(
				new Promise<void>((resolve, reject) => {
					registrations.set(target.documentId, { resolve, reject });
				}),
				Date.now() + REQUEST_TTL_MS,
			);
		} finally {
			registrations.delete(target.documentId);
		}
	}
	return requireDocument(target);
}
let session: Session | null = null;
let state: "disconnected" | "locked" | "connected" = "disconnected";
let pairing: {
	token: string;
	tabId: number;
	origin: string;
	expiresAt: number;
} | null = null;
type ArmedCapture = {
	grant: FillGrant;
	token: string;
	expiresAt: number;
	ready: boolean;
};
type CapturedCandidate = ArmedCapture & { username: string; password: string };
let capture: ArmedCapture | null = null;
let candidate: CapturedCandidate | null = null;
function clearCapture() {
	capture = null;
	if (candidate) clearPlaintext(candidate);
	candidate = null;
}
function pruneCapture() {
	if (
		(capture && capture.expiresAt <= Date.now()) ||
		(candidate && candidate.expiresAt <= Date.now())
	)
		clearCapture();
}
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
	clearCapture();
	const old = session;
	session = null;
	state = "locked";
	pairing = null;
	grants.clear();
	const connectedDocuments = [...documents.values()];
	documents.clear();
	for (const document of connectedDocuments) document.close();
	for (const registration of registrations.values())
		registration.reject(
			new Error("Vault locked during document registration."),
		);
	registrations.clear();
	for (const request of pending.values()) {
		clearTimeout(request.timer);
		request.reject(new Error("Vault locked or disconnected. Pair again."));
	}
	pending.clear();
	old?.port.disconnect();
}
// A content port supplies browser-authenticated effective origin and document ID.
// Only a separately armed one-shot submission may cross this port; never credential requests.
chrome.runtime.onConnect.addListener((port) => {
	const sender = port.sender;
	if (
		port.name !== CONTENT_PORT_NAME ||
		!session ||
		session.expiresAt <= Date.now() ||
		sender?.id !== chrome.runtime.id ||
		sender.frameId !== 0 ||
		!Number.isSafeInteger(sender.tab?.id) ||
		typeof sender.documentId !== "string" ||
		sender.documentId.length < 1 ||
		sender.documentId.length > 128 ||
		typeof sender.origin !== "string" ||
		normalizeOrigin(sender.origin) !== sender.origin ||
		normalizeOrigin(sender.url) !== sender.origin ||
		(sender.documentLifecycle !== undefined &&
			sender.documentLifecycle !== "active") ||
		(documents.size >= 64 && !documents.has(sender.documentId))
	) {
		port.disconnect();
		return;
	}
	const previous = documents.get(sender.documentId);
	let timer: ReturnType<typeof setTimeout>;
	const forget = () => {
		if (
			capture?.grant.registration === registration ||
			candidate?.grant.registration === registration
		)
			clearCapture();
		clearTimeout(timer);
		if (documents.get(registration.documentId) === registration) {
			documents.delete(registration.documentId);
			grants.clear();
		}
	};
	const registration: ContentRegistration = {
		close: () => {
			forget();
			port.disconnect();
		},
		tabId: sender.tab?.id as number,
		documentId: sender.documentId,
		origin: sender.origin,
	};
	documents.set(registration.documentId, registration);
	previous?.close();
	timer = setTimeout(registration.close, SESSION_TTL_MS);
	port.onDisconnect.addListener(forget);
	port.onMessage.addListener((raw: unknown) => {
		try {
			const submitted = parseCapturedSubmission(raw);
			const armed = capture;
			if (
				!submitted ||
				!armed ||
				submitted.token !== armed.token ||
				armed.expiresAt <= Date.now() ||
				armed.grant.registration !== registration ||
				documents.get(registration.documentId) !== registration ||
				session !== armed.grant.session ||
				session.expiresAt <= Date.now()
			)
				return;
			capture = null;
			if (candidate) clearPlaintext(candidate);
			candidate = {
				ready: armed.ready,
				grant: armed.grant,
				token: crypto.randomUUID(),
				expiresAt: Math.min(Date.now() + PROPOSAL_TTL_MS, session.expiresAt),
				username: submitted.username,
				password: submitted.password,
			};
			const captured = candidate;
			setTimeout(
				() => {
					if (candidate === captured) clearCapture();
				},
				Math.max(0, captured.expiresAt - Date.now()),
			);
		} finally {
			clearPlaintext(raw);
		}
	});
	registrations.get(registration.documentId)?.resolve();
});
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
		pruneCapture();
		if (session && session.expiresAt <= Date.now()) lock();
		const settings = await chrome.storage.local.get("origin");
		return {
			ok: true,
			state,
			origin: companionOrigin(settings.origin) ?? "",
			expiresAt: session?.expiresAt ?? null,
			candidate:
				candidate?.token && candidate.ready
					? {
							token: candidate.token,
							origin: candidate.grant.origin,
							username: candidate.username,
							expiresAt: candidate.expiresAt,
						}
					: null,
		};
	}
	if (message.type === "review") {
		pruneCapture();
		const captured = candidate;
		if (!captured || !captured.ready || captured.token !== message.token)
			throw new Error("Submission review expired.");
		captured.token = "";
		try {
			await assertTarget(captured.grant);
			if (
				candidate !== captured ||
				captured.expiresAt <= Date.now() ||
				requireSession() !== captured.grant.session ||
				requireDocument(captured.grant) !== captured.grant.registration
			)
				throw new Error("Submission review revoked.");
			await bounded(
				chrome.tabs.update(captured.grant.session.tabId, { active: true }),
				captured.expiresAt,
			);
			if (
				candidate !== captured ||
				captured.expiresAt <= Date.now() ||
				requireSession() !== captured.grant.session ||
				requireDocument(captured.grant) !== captured.grant.registration
			)
				throw new Error("Submission review revoked.");
			const proposal = parseSubmissionProposal({
				v: 1,
				type: "proposal",
				id: crypto.randomUUID(),
				origin: captured.grant.origin,
				username: captured.username,
				password: captured.password,
				expiresAt: captured.expiresAt,
			});
			if (!proposal) throw new Error("Invalid submission proposal.");
			try {
				captured.grant.session.port.postMessage(proposal);
			} finally {
				clearPlaintext(proposal);
			}
			return { ok: true };
		} finally {
			clearPlaintext(captured);
			if (candidate === captured) candidate = null;
		}
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
		clearCapture();
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
		const registration = await registeredDocument(bound);
		const discovery: unknown = await bounded(
			chrome.tabs.sendMessage(
				target.tabId,
				{
					type: "discover",
					id: crypto.randomUUID(),
					origin: target.origin,
					expiresAt: Date.now() + REQUEST_TTL_MS,
				},
				{ documentId, frameId: 0 },
			),
			Date.now() + REQUEST_TTL_MS,
		);
		if (
			!record(discovery) ||
			!keys(discovery, ["ok", "forms"]) ||
			discovery.ok !== true
		)
			throw new Error("This page does not support safe fill.");
		const forms = parseForms(discovery.forms);
		if (!forms) throw new Error("Invalid form discovery response.");
		if (requireDocument(bound) !== registration)
			throw new Error("Document registration changed.");
		const result = await requestVault("list", target.origin);
		await assertTarget(bound);
		if (requireSession() !== active || result.type !== "result")
			throw new Error("Vault session changed.");
		if (requireDocument(bound) !== registration)
			throw new Error("Document registration changed.");
		const token = grants.issue({
			expiresAt: Date.now() + REQUEST_TTL_MS,
			...bound,
			session: active,
			items: result.items.map((item) => item.id),
			forms: forms.map((form) => form.id),
			registration,
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
		(message.type === "fill" && !grant.items.includes(message.itemId)) ||
		!grant.forms.includes(message.formId)
	)
		throw new Error("Fill approval expired. Refresh matches.");
	await assertTarget(grant);
	if (requireDocument(grant) !== grant.registration)
		throw new Error("Document registration changed.");
	if (message.type === "watch") {
		if (grant.expiresAt <= Date.now() || requireSession() !== grant.session)
			throw new Error("Watch approval expired.");
		clearCapture();
		const armed = {
			ready: false,
			grant,
			token: crypto.randomUUID(),
			expiresAt: Math.min(
				Date.now() + PROPOSAL_TTL_MS,
				grant.session.expiresAt,
			),
		};
		capture = armed;
		setTimeout(
			() => {
				if (capture === armed) capture = null;
			},
			Math.max(0, armed.expiresAt - Date.now()),
		);
		try {
			const result: unknown = await bounded(
				chrome.tabs.sendMessage(
					grant.tabId,
					{
						type: "watch",
						id: crypto.randomUUID(),
						origin: grant.origin,
						expiresAt: armed.expiresAt,
						formId: message.formId,
						token: armed.token,
					},
					{ documentId: grant.documentId, frameId: 0 },
				),
				grant.expiresAt,
			);
			if (
				!record(result) ||
				!keys(result, ["ok"]) ||
				result.ok !== true ||
				session !== grant.session ||
				requireDocument(grant) !== grant.registration
			)
				throw new Error("Could not watch this form.");
			armed.ready = true;
			if (candidate?.grant === grant) candidate.ready = true;
			return { ok: true };
		} catch (error) {
			if (capture === armed) capture = null;
			if (candidate?.grant === grant) {
				clearPlaintext(candidate);
				candidate = null;
			}
			throw error;
		}
	}
	let credential = await requestVault(
		"credential",
		grant.origin,
		message.itemId,
	);
	try {
		await assertTarget(grant);
		if (
			requireSession() !== grant.session ||
			requireDocument(grant) !== grant.registration ||
			grant.expiresAt <= Date.now() ||
			credential.type !== "credential"
		)
			throw new Error("Vault session changed.");
		const acknowledgement = chrome.tabs.sendMessage(
			grant.tabId,
			{
				type: "fill",
				id: crypto.randomUUID(),
				origin: grant.origin,
				expiresAt: grant.expiresAt,
				formId: message.formId,
				username: credential.username,
				password: credential.password,
			},
			{ documentId: grant.documentId, frameId: 0 },
		);
		// Chrome serializes the message when invoked. Drop our plaintext reference
		// before awaiting an acknowledgement from a possibly hostile/hung renderer.
		credential.username = "";
		credential.password = "";
		credential = { v: 1, type: "locked" };
		const result: unknown = await bounded(acknowledgement, grant.expiresAt);
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
	for (const document of documents.values())
		if (document.tabId === tabId) document.close();
	grants.clear();
});
chrome.tabs.onUpdated.addListener((tabId, change) => {
	grants.clear();
	if (change.url)
		for (const document of documents.values())
			if (document.tabId === tabId) document.close();
	if ((session?.tabId === tabId || pairing?.tabId === tabId) && change.url) {
		const origin = normalizeOrigin(change.url);
		if (origin !== (session?.origin ?? pairing?.origin)) lock();
	}
});
void chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
export type { Match };
