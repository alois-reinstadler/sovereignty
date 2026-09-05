import { describe, expect, it } from "vitest";
import {
	Capabilities,
	companionOrigin,
	normalizeOrigin,
	originMatches,
	parseBackgroundMessage,
	parseCompanionRequest,
	parseVaultMessage,
	REQUEST_TTL_MS,
	requestIsLive,
} from "./index";

const id = "00000000-0000-4000-8000-000000000001";
describe("origin boundaries", () => {
	it.each([
		"javascript:alert(1)",
		"data:text/html,x",
		"file:///tmp/a",
		"https://user:secret@example.com",
		"https:example.com",
		"https:/example.com",
		"https:///example.com",
		" https://example.com",
		"https://example.com.",
		"https://exam\\ple.com",
		"https://exam\nple.com",
		null,
		{},
		"garbage",
	])("rejects %j", (value) => expect(normalizeOrigin(value)).toBeNull());
	it("normalizes only URL authority semantics", () => {
		expect(normalizeOrigin("https://EXAMPLE.com:443/path?q#f")).toBe(
			"https://example.com",
		);
		expect(normalizeOrigin("http://example.com:80/a")).toBe(
			"http://example.com",
		);
	});
	it.each([
		"https://example.com.evil.test",
		"https://sub.example.com",
		"http://example.com",
		"https://example.com:444",
		"https://exаmple.com",
	])("rejects lookalike %s", (origin) =>
		expect(originMatches("https://example.com", origin)).toBe(false));
	it("allows only secure or explicit loopback companions", () => {
		expect(companionOrigin("http://100.64.0.2:4044")).toBeNull();
		expect(companionOrigin("http://localhost.evil.test")).toBeNull();
		expect(companionOrigin("http://127.0.0.1:4044")).toBe(
			"http://127.0.0.1:4044",
		);
		expect(companionOrigin("https://vault.example.test")).toBe(
			"https://vault.example.test",
		);
	});
});
describe("messages", () => {
	it("validates submitted proposal fields and byte bounds", () => {
		const proposal = {
			v: 1,
			type: "proposal",
			id,
			origin: "https://example.test",
			expiresAt: 10000,
			username: "synthetic",
			password: "synthetic-password",
		};
		expect(parseBackgroundMessage(proposal)).toEqual(proposal);
		for (const change of [
			{ origin: null },
			{ password: "" },
			{ password: "x".repeat(4097) },
			{ extra: true },
			{ id: "bad" },
			{ username: [] },
			{ expiresAt: Infinity },
		])
			expect(parseBackgroundMessage({ ...proposal, ...change })).toBeNull();
	});
	const request = {
		v: 1,
		type: "request",
		id,
		operation: "list",
		origin: "https://example.com",
		expiresAt: 10000,
	};
	it("accepts narrowly shaped requests", () => {
		expect(parseCompanionRequest(request)).toEqual(request);
		expect(
			parseBackgroundMessage({ v: 1, type: "paired", expiresAt: 10000 }),
		).not.toBeNull();
		expect(
			parseCompanionRequest({
				...request,
				operation: "credential",
				itemId: id,
			}),
		).not.toBeNull();
	});
	it.each([
		{ origin: null },
		{ origin: "https://example.com/a" },
		{ id: "bad" },
		{ v: 2 },
		{ extra: true },
		{ expiresAt: Infinity },
		{ operation: "credential" },
	])("rejects malformed request %j", (change) =>
		expect(parseCompanionRequest({ ...request, ...change })).toBeNull());
	it("limits metadata and never accepts password in list", () => {
		const item = { id, title: "Example", username: "test" };
		expect(
			parseVaultMessage({ v: 1, type: "result", id, items: [item] }),
		).not.toBeNull();
		expect(
			parseVaultMessage({
				v: 1,
				type: "result",
				id,
				items: [{ ...item, password: "test" }],
			}),
		).toBeNull();
		expect(
			parseVaultMessage({ v: 1, type: "result", id, items: [item, item] }),
		).toBeNull();
		expect(
			parseVaultMessage({
				v: 1,
				type: "result",
				id,
				items: Array(51).fill(item),
			}),
		).toBeNull();
	});
	it("rejects oversized credential and unexpected error", () => {
		expect(
			parseVaultMessage({ v: 1, type: "error", id, code: ["locked"] }),
		).toBeNull();
		expect(
			parseVaultMessage({
				v: 1,
				type: "credential",
				id,
				itemId: id,
				username: "test",
				password: "x".repeat(4097),
			}),
		).toBeNull();
		expect(
			parseVaultMessage({ v: 1, type: "error", id, code: "anything" }),
		).toBeNull();
		expect(
			parseVaultMessage({
				v: 1,
				type: "hello",
				token: id,
				extra: "x".repeat(100000),
			}),
		).toBeNull();
	});
});
describe("expiration and replay", () => {
	it("limits lifetime including boundary and future abuse", () => {
		expect(requestIsLive({ expiresAt: 100 + REQUEST_TTL_MS }, 100)).toBe(true);
		expect(requestIsLive({ expiresAt: 100 }, 100)).toBe(false);
		expect(requestIsLive({ expiresAt: 101 + REQUEST_TTL_MS }, 100)).toBe(false);
	});
	it("consumes once and expires exactly", () => {
		const caps = new Capabilities<string>();
		const token = caps.issue("value", 100, 0);
		expect(caps.consume(token, 99)).toBe("value");
		expect(caps.consume(token, 99)).toBeNull();
		expect(caps.consume(caps.issue("expired", 100, 0), 100)).toBeNull();
	});
	it("does not survive restart or lock", () => {
		const caps = new Capabilities<string>();
		const token = caps.issue("secret");
		expect(new Capabilities<string>().consume(token)).toBeNull();
		caps.clear();
		expect(caps.consume(token)).toBeNull();
	});
});
