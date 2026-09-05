// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FormDiscovery } from "./forms";

const origin = "http://localhost:3000";
const html =
	'<form action="http://localhost:3000/login"><input name="email" type="email"><input type="password"><button>Sign in</button></form>';
beforeEach(() => {
	document.body.innerHTML = html;
	vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue([
		{ width: 100, height: 20 },
	] as unknown as DOMRectList);
	vi.spyOn(globalThis, "getComputedStyle").mockImplementation(
		(element) =>
			({
				visibility: "visible",
				display: "block",
				opacity: (element as HTMLElement).style.opacity || "1",
			}) as CSSStyleDeclaration,
	);
});
afterEach(() => vi.restoreAllMocks());
describe("form safety", () => {
	it("fills one chosen form without submitting and consumes handle", () => {
		const discovery = new FormDiscovery();
		const [form] = discovery.discover(document, origin);
		const submit = vi.fn();
		document.forms[0].addEventListener("submit", submit);
		expect(
			discovery.fill(form.id, origin, "test-user", "synthetic-password"),
		).toBe(true);
		expect(
			document.querySelector<HTMLInputElement>("input[type=password]")?.value,
		).toBe("synthetic-password");
		expect(submit).not.toHaveBeenCalled();
		expect(discovery.fill(form.id, origin, "test", "test")).toBe(false);
	});
	it.each([
		"hidden",
		"disabled",
		"readonly",
		"inert",
	])("excludes %s fields", (attribute) => {
		document.querySelector("input")?.setAttribute(attribute, "");
		expect(new FormDiscovery().discover(document, origin)).toEqual([]);
	});
	it("excludes transparent fields and disabled fieldsets", () => {
		const input = document.querySelector("input");
		if (input) input.style.opacity = "0";
		expect(new FormDiscovery().discover(document, origin)).toEqual([]);
		document.body.innerHTML =
			'<form action="http://localhost:3000"><fieldset disabled><input name="user"><input type="password"></fieldset></form>';
		expect(new FormDiscovery().discover(document, origin)).toEqual([]);
	});
	it("never mixes forms or chooses among ambiguous fields", () => {
		document.body.innerHTML =
			'<form action="http://localhost:3000"><input name="user"></form><form action="http://localhost:3000"><input type="password"></form>';
		expect(new FormDiscovery().discover(document, origin)).toEqual([]);
		document.body.innerHTML = html.replace(
			"<button>",
			'<input name="username"><button>',
		);
		expect(new FormDiscovery().discover(document, origin)).toEqual([]);
	});
	it("offers independent form handles", () => {
		document.body.innerHTML = html + html;
		const discovery = new FormDiscovery();
		const forms = discovery.discover(document, origin);
		expect(forms).toHaveLength(2);
		expect(
			discovery.fill(forms[1].id, origin, "test", "synthetic-password"),
		).toBe(true);
		expect(document.forms[0].querySelector("input")?.value).toBe("");
		expect(document.forms[1].querySelector("input")?.value).toBe("test");
	});
	it.each([
		"replace",
		"remove",
		"readonly",
		"action",
		"origin",
		"expire",
	])("rejects %s after discovery", (change) => {
		const discovery = new FormDiscovery();
		const [form] = discovery.discover(document, origin);
		if (change === "replace") document.body.innerHTML = html;
		if (change === "remove") document.querySelector("input")?.remove();
		if (change === "readonly")
			document.querySelector("input")?.setAttribute("readonly", "");
		if (change === "action") document.forms[0].action = "https://evil.test";
		if (change === "expire")
			vi.spyOn(Date, "now").mockReturnValue(Date.now() + 10001);
		expect(
			discovery.fill(
				form.id,
				change === "origin" ? "https://evil.test" : origin,
				"test",
				"synthetic-password",
			),
		).toBe(false);
	});
	it("rejects cross-origin actions and ignores iframe documents", () => {
		document.forms[0].action = "https://evil.test";
		document.body.insertAdjacentHTML(
			"beforeend",
			'<iframe srcdoc="<form><input name=user><input type=password></form>"></iframe><iframe sandbox srcdoc="<form><input name=user><input type=password></form>"></iframe>',
		);
		expect(new FormDiscovery().discover(document, origin)).toEqual([]);
	});
});
