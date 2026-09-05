import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Listener = (...args: unknown[]) => unknown;
const event = () => {
	const listeners: Listener[] = [];
	return {
		addListener: (listener: Listener) => listeners.push(listener),
		emit: (...args: unknown[]) =>
			listeners.forEach((listener) => {
				listener(...args);
			}),
		listeners,
	};
};
const itemId = "00000000-0000-4000-8000-000000000001";
const formId = "00000000-0000-4000-8000-000000000002";
const extId = "a".repeat(32);
const origin = "https://login.example.test";
const vaultOrigin = "https://vault.example.test";
let internal: ReturnType<typeof event>;
let external: ReturnType<typeof event>;
let contentConnections: ReturnType<typeof event>;
let removed: ReturnType<typeof event>;
let updated: ReturnType<typeof event>;
let onMessage: ReturnType<typeof event>;
let disconnect: ReturnType<typeof event>;
let createdUrl = "";
let active = { id: 1, url: origin };
let port: Record<string, unknown>;
let onRequest: (message: Record<string, unknown>) => void;
let sendMessage: ReturnType<typeof vi.fn>;
let settings: Record<string, unknown>;
let contentSenderChanges: Record<string, unknown>;
let contentDisconnect: ReturnType<typeof event>;
let registerContent = true;
const popupSender = {
	id: extId,
	url: `chrome-extension://${extId}/popup.html`,
};
const popup = (message: unknown, sender: unknown = popupSender) =>
	new Promise<Record<string, unknown>>((resolve) =>
		internal.emit(message, sender, resolve),
	);
async function pair(
	senderChange: Record<string, unknown> = {},
	expireBeforeConnect = false,
) {
	await popup({ type: "pair", origin: vaultOrigin });
	if (expireBeforeConnect) vi.setSystemTime(Date.now() + 60001);
	onMessage = event();
	disconnect = event();
	port = {
		name: "svrgn-companion-v1",
		sender: {
			tab: { id: 9 },
			frameId: 0,
			url: vaultOrigin,
			origin: vaultOrigin,
			...senderChange,
		},
		onMessage,
		onDisconnect: disconnect,
		disconnect: vi.fn(() => disconnect.emit()),
		postMessage: vi.fn((message: Record<string, unknown>) => {
			if (message.type === "request") queueMicrotask(() => onRequest(message));
		}),
	};
	external.emit(port);
	const token = createdUrl.split(".").at(-1);
	onMessage.emit({ v: 1, type: "hello", token });
}
beforeEach(async () => {
	vi.useFakeTimers();
	vi.resetModules();
	internal = event();
	external = event();
	contentConnections = event();
	contentSenderChanges = {};
	registerContent = true;
	removed = event();
	updated = event();
	active = { id: 1, url: origin };
	settings = {};
	sendMessage = vi.fn(
		async (_tabId: number, message: Record<string, unknown>) =>
			message.type === "discover"
				? { ok: true, forms: [{ id: formId, label: "Login form 1" }] }
				: { ok: true },
	);
	vi.stubGlobal("chrome", {
		runtime: {
			id: extId,
			getURL: (path: string) => `chrome-extension://${extId}/${path}`,
			onMessage: internal,
			onConnectExternal: external,
			onConnect: contentConnections,
		},
		storage: {
			local: {
				get: vi.fn(async () => settings),
				set: vi.fn(async (value: Record<string, unknown>) => {
					settings = value;
				}),
				setAccessLevel: vi.fn(async () => {}),
			},
		},
		tabs: {
			query: vi.fn(async () => [active]),
			create: vi.fn(async ({ url }: { url: string }) => {
				createdUrl = url;
				return { id: 9 };
			}),
			sendMessage,
			onRemoved: removed,
			onUpdated: updated,
		},
		scripting: {
			executeScript: vi.fn(async () => {
				const localDisconnect = event();
				contentDisconnect = localDisconnect;
				if (registerContent)
					contentConnections.emit({
						name: "svrgn-content-registration-v1",
						sender: {
							id: extId,
							tab: { id: 1 },
							frameId: 0,
							documentId: "document-1",
							origin,
							url: origin,
							documentLifecycle: "active",
							...contentSenderChanges,
						},
						onMessage: event(),
						onDisconnect: localDisconnect,
						disconnect: vi.fn(() => localDisconnect.emit()),
					});
				return [{ frameId: 0, documentId: "document-1" }];
			}),
		},
	});
	onRequest = (message) =>
		onMessage.emit(
			message.operation === "list"
				? {
						v: 1,
						type: "result",
						id: message.id,
						items: [
							{
								id: itemId,
								title: "Synthetic login",
								username: "synthetic-user",
							},
						],
					}
				: {
						v: 1,
						type: "credential",
						id: message.id,
						itemId,
						username: "synthetic-user",
						password: "synthetic-password-only",
					},
		);
	await import("./background");
});
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});
describe("background authorization", () => {
	it("pairs, lists narrow metadata, fills only selected document and consumes approval", async () => {
		await pair();
		expect((await popup({ type: "status" })).state).toBe("connected");
		const list = await popup({ type: "list" });
		expect(list.ok).toBe(true);
		expect(JSON.stringify(list)).not.toContain("password");
		const fill = { type: "fill", token: list.token, itemId, formId };
		expect((await popup(fill)).ok).toBe(true);
		expect(sendMessage).toHaveBeenLastCalledWith(
			1,
			expect.objectContaining({
				type: "fill",
				origin,
				username: "synthetic-user",
			}),
			{ documentId: "document-1", frameId: 0 },
		);
		expect((await popup(fill)).ok).toBe(false);
		expect(settings).toEqual({ origin: vaultOrigin });
	});
	it.each([
		{ frameId: 1 },
		{ origin: "null" },
		{ origin: "https://evil.test" },
		{ url: "https://evil.test" },
		{ tab: { id: 10 } },
		{ id: "other-extension" },
	])("rejects unexpected companion sender %j", async (sender) => {
		await pair(sender);
		expect((await popup({ type: "status" })).state).toBe("locked");
		expect(port.disconnect).toHaveBeenCalled();
	});
	it("rejects content requesting other-origin credentials", async () => {
		await pair();
		expect(
			(await popup({ type: "list" }, { ...popupSender, tab: { id: 1 } })).ok,
		).toBe(false);
		expect(
			(await popup({ type: "list", origin: "https://victim.test" })).ok,
		).toBe(false);
	});
	it("cancels a fill when vault locks during credential response", async () => {
		await pair();
		const list = await popup({ type: "list" });
		onRequest = () => onMessage.emit({ v: 1, type: "locked" });
		expect(
			(await popup({ type: "fill", token: list.token, itemId, formId })).ok,
		).toBe(false);
		expect(sendMessage).toHaveBeenCalledTimes(1);
	});
	it.each([
		"navigation",
		"active-tab",
		"expiry",
		"restart",
	])("rejects %s after listing", async (change) => {
		await pair();
		const list = await popup({ type: "list" });
		if (change === "navigation") active.url = "https://evil.test";
		if (change === "active-tab") active.id = 2;
		if (change === "expiry") vi.setSystemTime(Date.now() + 10001);
		if (change === "restart") {
			vi.resetModules();
			await import("./background");
			internal.listeners.splice(0, 1);
		}
		expect(
			(await popup({ type: "fill", token: list.token, itemId, formId })).ok,
		).toBe(false);
		expect(sendMessage).toHaveBeenCalledTimes(1);
	});
	it("rejects a delayed credential after the original popup grant deadline", async () => {
		await pair();
		const list = await popup({ type: "list" });
		vi.setSystemTime(Date.now() + 9000);
		onRequest = (message) => {
			vi.setSystemTime(Date.now() + 1001);
			onMessage.emit({
				v: 1,
				type: "credential",
				id: message.id,
				itemId,
				username: "test",
				password: "synthetic-password",
			});
		};
		expect(
			(await popup({ type: "fill", token: list.token, itemId, formId })).ok,
		).toBe(false);
		expect(sendMessage).toHaveBeenCalledTimes(1);
	});
	it("rejects delayed response even if timeout callback has not run", async () => {
		await pair();
		onRequest = (message) => {
			vi.setSystemTime(Date.now() + 10001);
			onMessage.emit({ v: 1, type: "result", id: message.id, items: [] });
		};
		expect((await popup({ type: "list" })).ok).toBe(false);
	});
	it("disconnects on replay or malformed companion messages", async () => {
		await pair();
		onMessage.emit({ v: 1, type: "result", id: itemId, items: [] });
		expect((await popup({ type: "status" })).state).toBe("locked");
		await pair();
		onMessage.emit({
			v: 1,
			type: "credential",
			id: itemId,
			itemId,
			username: "test",
			password: "x".repeat(100000),
		});
		expect((await popup({ type: "status" })).state).toBe("locked");
	});
	it("rejects the original pairing token after its deadline", async () => {
		await pair({}, true);
		expect((await popup({ type: "status" })).state).toBe("locked");
		expect(port.disconnect).toHaveBeenCalled();
	});
	it("expires the connected session", async () => {
		await pair();
		vi.setSystemTime(Date.now() + 300001);
		expect((await popup({ type: "list" })).ok).toBe(false);
	});
	it.each([
		{ origin: "null" },
		{ origin: "https://evil.test", url: "https://evil.test" },
		{ frameId: 1 },
		{ tab: { id: 2 } },
		{ documentId: "other-document" },
		{ id: "another-extension" },
		{ documentLifecycle: "cached" },
	])("rejects untrusted content registration %j", async (sender) => {
		await pair();
		contentSenderChanges = sender;
		const result = popup({ type: "list" });
		await vi.advanceTimersByTimeAsync(10_001);
		expect((await result).ok).toBe(false);
		expect(port.postMessage).not.toHaveBeenCalledWith(
			expect.objectContaining({ type: "request" }),
		);
	});
	it("requires browser registration even when a hostile discovery reply claims safe forms", async () => {
		await pair();
		registerContent = false;
		const result = popup({ type: "list" });
		await vi.advanceTimersByTimeAsync(10_001);
		expect((await result).ok).toBe(false);
		expect(sendMessage).not.toHaveBeenCalled();
	});
	it("replaces registration on reinjection and revokes the previous popup grant", async () => {
		await pair();
		const first = await popup({ type: "list" });
		const second = await popup({ type: "list" });
		expect(
			(await popup({ type: "fill", token: first.token, itemId, formId })).ok,
		).toBe(false);
		expect(
			(await popup({ type: "fill", token: second.token, itemId, formId })).ok,
		).toBe(true);
	});
	it.each([
		"disconnect",
		"navigation",
	])("rejects %s before credential dispatch", async (change) => {
		await pair();
		const list = await popup({ type: "list" });
		onRequest = (message) => {
			if (change === "disconnect") contentDisconnect.emit();
			else updated.emit(1, { url: `${origin}/next` });
			onMessage.emit({
				v: 1,
				type: "credential",
				id: message.id,
				itemId,
				username: "synthetic-user",
				password: "synthetic-password-only",
			});
		};
		expect(
			(await popup({ type: "fill", token: list.token, itemId, formId })).ok,
		).toBe(false);
		expect(sendMessage).toHaveBeenCalledTimes(1);
	});
	it("clears plaintext immediately and expires a renderer that never acknowledges fill", async () => {
		await pair();
		const list = await popup({ type: "list" });
		let response: Record<string, unknown> | undefined;
		onRequest = (message) => {
			response = {
				v: 1,
				type: "credential",
				id: message.id,
				itemId,
				username: "synthetic-user",
				password: "synthetic-password-only",
			};
			onMessage.emit(response);
		};
		sendMessage.mockImplementationOnce(() => new Promise(() => {}));
		const fill = popup({ type: "fill", token: list.token, itemId, formId });
		await vi.advanceTimersByTimeAsync(1);
		expect(response).toMatchObject({ username: "", password: "" });
		await popup({ type: "lock" });
		await vi.advanceTimersByTimeAsync(10_001);
		expect((await fill).ok).toBe(false);
		expect(sendMessage).toHaveBeenCalledTimes(2);
	});
});
