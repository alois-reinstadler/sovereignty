import { afterEach, describe, expect, it, vi } from "vitest";
import {
	attachCompanion,
	type CompanionPort,
	parsePairingLink,
} from "./extension-companion";
import type { VaultItem } from "./models";

const item: VaultItem = {
	id: "11111111-1111-4111-8111-111111111111",
	title: "Synthetic login",
	username: "synthetic@example.test",
	password: "synthetic-fixture-only",
	website: "https://example.test/login",
	notes: "must not leave vault",
	favorite: false,
	createdAt: "",
	updatedAt: "",
};
const token = "22222222-2222-4222-8222-222222222222";
const id = "33333333-3333-4333-8333-333333333333";

function fixture(proposals?: Parameters<typeof attachCompanion>[5]) {
	vi.useFakeTimers();
	vi.setSystemTime(1_000_000);
	const messages = new Set<(message: unknown) => void>();
	const disconnects = new Set<() => void>();
	const port: CompanionPort = {
		postMessage: vi.fn(),
		disconnect: vi.fn(),
		onMessage: {
			addListener: (fn) => {
				messages.add(fn);
			},
			removeListener: (fn) => {
				messages.delete(fn);
			},
		},
		onDisconnect: {
			addListener: (fn) => {
				disconnects.add(fn);
			},
			removeListener: (fn) => {
				disconnects.delete(fn);
			},
		},
	};
	const read = vi.fn<() => ReadonlyArray<VaultItem> | null>(() => [item]);
	const state = vi.fn();
	const stop = attachCompanion(port, token, read, state, Date.now, proposals);
	const receive = (message: unknown) => {
		for (const fn of messages) fn(message);
	};
	const pair = () =>
		receive({ v: 1, type: "paired", expiresAt: Date.now() + 300_000 });
	const request = (extra: Record<string, unknown> = {}) =>
		receive({
			v: 1,
			type: "request",
			id,
			operation: "list",
			origin: "https://example.test",
			expiresAt: Date.now() + 10_000,
			...extra,
		});
	return { port, read, state, stop, receive, pair, request, disconnects };
}
afterEach(() => {
	vi.clearAllTimers();
	vi.useRealTimers();
});
describe("companion submission proposals", () => {
	const proposal = () => ({
		v: 1,
		type: "proposal",
		id,
		origin: "https://example.test",
		expiresAt: Date.now() + 30000,
		username: "submitted-user",
		password: "synthetic-submitted-password",
	});
	it("accepts one bounded proposal with live-session guard and clears transport plaintext", () => {
		let guard: () => boolean = () => false;
		const copies: unknown[] = [];
		const clear = vi.fn();
		const f = fixture({
			offer: (value, isLive) => {
				copies.push({ ...value });
				guard = isLive;
			},
			clear,
		});
		f.pair();
		const message = proposal();
		f.receive(message);
		expect(copies).toEqual([
			expect.objectContaining({ password: "synthetic-submitted-password" }),
		]);
		expect(message.password).toBe("");
		expect(guard()).toBe(true);
		f.stop();
		expect(guard()).toBe(false);
		expect(clear).toHaveBeenCalled();
	});
	it.each([
		"replay",
		"expired",
		"oversized",
		"locked",
		"unpaired",
	])("rejects %s proposal without retaining password", (change) => {
		const offer = vi.fn();
		const clear = vi.fn();
		const f = fixture({ offer, clear });
		if (change !== "unpaired") f.pair();
		const message = proposal();
		if (change === "replay") {
			f.receive({ ...message });
			offer.mockClear();
		}
		if (change === "expired") message.expiresAt = Date.now();
		if (change === "oversized") message.password = "x".repeat(4097);
		if (change === "locked") f.read.mockReturnValue(null);
		f.receive(message);
		expect(offer).not.toHaveBeenCalled();
		expect(message.password).toBe("");
	});
});

describe("companion approval links", () => {
	it("accepts only a Chromium ID and random UUID capability", () => {
		expect(parsePairingLink(`#svrgn-pair=${"a".repeat(32)}.${token}`)).toEqual({
			extensionId: "a".repeat(32),
			token,
		});
		for (const hash of [
			"",
			`#svrgn-pair=${"z".repeat(32)}.${token}`,
			`#svrgn-pair=${"a".repeat(32)}.guess`,
			`#svrgn-pair=${"a".repeat(32)}.${token}&extra=1`,
		])
			expect(parsePairingLink(hash)).toBeNull();
	});
});

describe("unlocked vault companion", () => {
	it("does not serve requests before an acknowledged pairing", () => {
		const f = fixture();
		f.request();
		expect(f.read).not.toHaveBeenCalled();
		expect(f.port.disconnect).toHaveBeenCalled();
	});
	it("returns only exact-origin metadata, without secrets, notes or other records", () => {
		const f = fixture();
		f.read.mockReturnValue([
			item,
			{ ...item, id: token, website: "https://sub.example.test" },
		]);
		f.pair();
		f.request();
		expect(f.port.postMessage).toHaveBeenLastCalledWith({
			v: 1,
			type: "result",
			id,
			items: [{ id: item.id, title: item.title, username: item.username }],
		});
	});
	it.each([
		"https://example.test.attacker.test",
		"https://sub.example.test",
		"http://example.test",
		"https://example.test:8443",
	])("does not broaden matches for %s", (origin) => {
		const f = fixture();
		f.pair();
		f.request({ origin });
		expect(f.port.postMessage).toHaveBeenLastCalledWith({
			v: 1,
			type: "result",
			id,
			items: [],
		});
	});
	it("rechecks origin when returning one selected credential", () => {
		const f = fixture();
		f.pair();
		f.request({
			operation: "credential",
			itemId: item.id,
			origin: "https://attacker.test",
		});
		expect(f.port.postMessage).toHaveBeenLastCalledWith({
			v: 1,
			type: "error",
			id,
			code: "not_found",
		});
	});
	it("returns exactly one matching credential and no full item", () => {
		const f = fixture();
		f.pair();
		f.request({ operation: "credential", itemId: item.id });
		expect(f.port.postMessage).toHaveBeenLastCalledWith({
			v: 1,
			type: "credential",
			id,
			itemId: item.id,
			username: item.username,
			password: item.password,
		});
	});
	it("revokes replayed IDs even if the requested operation changes", () => {
		const f = fixture();
		f.pair();
		f.request();
		f.request({ operation: "credential", itemId: item.id });
		expect(f.port.disconnect).toHaveBeenCalled();
		expect(f.read).toHaveBeenCalledTimes(1);
	});
	it("rejects expired and implausibly future requests before reading secrets", () => {
		const f = fixture();
		f.pair();
		f.request({ expiresAt: Date.now() });
		expect(f.read).not.toHaveBeenCalled();
		expect(f.port.postMessage).toHaveBeenLastCalledWith({
			v: 1,
			type: "error",
			id,
			code: "expired",
		});
		f.request({ id: token, expiresAt: Date.now() + 10_001 });
		expect(f.read).not.toHaveBeenCalled();
	});
	it("consults live lock state on every operation", () => {
		const f = fixture();
		f.pair();
		f.request();
		f.read.mockReturnValue(null);
		f.request({ id: token, operation: "credential", itemId: item.id });
		expect(f.port.postMessage).toHaveBeenLastCalledWith({
			v: 1,
			type: "locked",
		});
		expect(f.port.disconnect).toHaveBeenCalled();
	});
	it("expires without waiting for another request and removes listeners", () => {
		const f = fixture();
		f.pair();
		vi.advanceTimersByTime(300_000);
		f.request();
		expect(f.state).toHaveBeenLastCalledWith("expired");
		expect(f.read).not.toHaveBeenCalled();
	});
	it("fails closed on disconnect and stops sending after explicit revocation", () => {
		const f = fixture();
		f.pair();
		f.stop();
		f.request();
		expect(f.read).not.toHaveBeenCalled();
		expect(f.port.disconnect).toHaveBeenCalledTimes(1);
		f.stop();
		expect(f.port.disconnect).toHaveBeenCalledTimes(1);
	});
	it.each([
		{ v: 2, type: "paired" },
		{ v: 1, type: "paired", expiresAt: 99e15 },
		{
			v: 1,
			type: "request",
			id,
			operation: "credential",
			origin: "data:text/html,x",
			itemId: item.id,
			expiresAt: 1_000_001,
		},
		{ data: "x".repeat(100_000) },
	])("disconnects on malformed or oversized messages", (raw) => {
		const f = fixture();
		f.receive(raw);
		expect(f.port.disconnect).toHaveBeenCalled();
		expect(f.read).not.toHaveBeenCalled();
	});
});
