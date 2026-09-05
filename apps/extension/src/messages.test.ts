import { describe, expect, it } from "vitest";
import { generatePassword } from "./generator";
import {
	parseContentRequest,
	parseForms,
	parsePopupRequest,
	trustedPopup,
} from "./messages";

const id = "00000000-0000-4000-8000-000000000001";
describe("internal boundaries", () => {
	it("rejects page-provided origin in popup list", () => {
		expect(parsePopupRequest({ type: ["status"] })).toBeNull();
		expect(
			parsePopupRequest({ type: "list", origin: "https://victim.test" }),
		).toBeNull();
		expect(
			parsePopupRequest({ type: "fill", token: id, itemId: id, formId: id }),
		).not.toBeNull();
		expect(
			parsePopupRequest({
				type: "fill",
				token: id,
				itemId: id,
				formId: "#password",
			}),
		).toBeNull();
	});
	it("accepts only dedicated popup sender without tab", () => {
		const sender = {
			id: "extension",
			url: "chrome-extension://extension/popup.html",
		};
		expect(trustedPopup(sender, "extension", sender.url)).toBe(true);
		expect(
			trustedPopup(
				{ ...sender, tab: { id: 1 } as chrome.tabs.Tab },
				"extension",
				sender.url,
			),
		).toBe(false);
		expect(
			trustedPopup(
				{ ...sender, url: "https://vault.test" },
				"extension",
				sender.url,
			),
		).toBe(false);
		expect(
			trustedPopup({ ...sender, id: "other" }, "extension", sender.url),
		).toBe(false);
	});
	it("validates every content field", () => {
		const request = {
			type: "fill",
			id,
			origin: "https://example.com",
			expiresAt: 1000,
			formId: id,
			username: "test",
			password: "synthetic-password",
		};
		expect(parseContentRequest(request)).not.toBeNull();
		expect(parseContentRequest({ ...request, origin: null })).toBeNull();
		expect(
			parseContentRequest({ ...request, selector: "#password" }),
		).toBeNull();
		expect(
			parseContentRequest({ ...request, password: "x".repeat(4097) }),
		).toBeNull();
		expect(
			parseForms([{ id, label: "Login form 1", password: "bad" }]),
		).toBeNull();
	});
	it("generates bounded cryptographic passwords", () => {
		expect(generatePassword()).toMatch(/^[A-Za-z0-9_-]{24}$/);
		expect(generatePassword()).not.toBe(generatePassword());
		expect(() => generatePassword(15)).toThrow();
		expect(() => generatePassword(65)).toThrow();
		expect(() => generatePassword(20.5)).toThrow();
	});
});
