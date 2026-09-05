// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONTENT_PORT_NAME } from "./messages";

const handlers = vi.hoisted(() => ({
	discover: vi.fn(() => []),
	fill: vi.fn(() => true),
	clear: vi.fn(),
}));
vi.mock("./forms", () => ({
	FormDiscovery: class {
		discover = handlers.discover;
		fill = handlers.fill;
		clear = handlers.clear;
	},
}));
type Listener = (
	raw: unknown,
	sender: chrome.runtime.MessageSender,
	respond: (value: unknown) => void,
) => void;
const extensionId = "a".repeat(32);
let receive: Listener;
let disconnected: () => void;
let connect: ReturnType<typeof vi.fn>;
let removeListener: ReturnType<typeof vi.fn>;
const id = () => crypto.randomUUID();
const request = () => ({
	type: "discover",
	id: id(),
	origin: location.origin,
	expiresAt: Date.now() + 10_000,
});
beforeEach(async () => {
	vi.resetModules();
	vi.clearAllMocks();
	vi.useFakeTimers();
	vi.stubGlobal("origin", location.origin);
	removeListener = vi.fn();
	connect = vi.fn(() => ({
		disconnect: vi.fn(),
		onDisconnect: {
			addListener: (listener: () => void) => {
				disconnected = listener;
			},
		},
	}));
	vi.stubGlobal("chrome", {
		runtime: {
			id: extensionId,
			connect,
			onMessage: {
				addListener: (listener: Listener) => {
					receive = listener;
				},
				removeListener,
			},
		},
	});
	await import("./content");
});
afterEach(() => {
	(
		globalThis as typeof globalThis & { __svrgnCleanup?: () => void }
	).__svrgnCleanup?.();
	vi.unstubAllGlobals();
	vi.useRealTimers();
});
describe("content boundary", () => {
	it("registers only a port and rejects a top-level opaque effective origin", () => {
		expect(connect).toHaveBeenCalledExactlyOnceWith({
			name: CONTENT_PORT_NAME,
		});
		vi.stubGlobal("origin", "null");
		const response = vi.fn();
		receive(request(), { id: extensionId }, response);
		expect(response).toHaveBeenCalledWith({ ok: false });
		expect(handlers.discover).not.toHaveBeenCalled();
	});
	it("rejects expiry, replay and content-originating requests", () => {
		const message = request();
		const response = vi.fn();
		receive(message, { id: extensionId }, response);
		receive(message, { id: extensionId }, response);
		expect(handlers.discover).toHaveBeenCalledTimes(1);
		receive(
			request(),
			{ id: extensionId, tab: { id: 1 } as chrome.tabs.Tab },
			response,
		);
		receive(
			{ ...request(), expiresAt: Date.now() },
			{ id: extensionId },
			response,
		);
		expect(handlers.discover).toHaveBeenCalledTimes(1);
	});
	it("clears plaintext even if form filling throws", () => {
		handlers.fill.mockImplementationOnce(() => {
			throw new Error("Synthetic form failure");
		});
		const message = {
			...request(),
			type: "fill",
			formId: id(),
			username: "test-user",
			password: "test-only",
		};
		const response = vi.fn();
		receive(message, { id: extensionId }, response);
		expect(response).toHaveBeenCalledWith({ ok: false });
		expect(message).toMatchObject({ username: "", password: "" });
	});
	it("removes its fill listener and DOM references when registration disconnects", () => {
		disconnected();
		expect(removeListener).toHaveBeenCalledWith(receive);
		expect(handlers.clear).toHaveBeenCalled();
	});
});
