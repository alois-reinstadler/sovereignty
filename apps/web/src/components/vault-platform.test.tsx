import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const controls = vi.hoisted(() => ({
	desktop: false,
	useSession: vi.fn(() => ({ data: null })),
}));
vi.mock("#/lib/client-platform", () => ({
	get IS_DESKTOP() {
		return controls.desktop;
	},
}));
vi.mock("#/lib/auth-client", () => ({
	getAuthClient: () => ({ useSession: controls.useSession }),
}));

import { VaultApp } from "./vault-app";

afterEach(() => {
	controls.desktop = false;
	controls.useSession.mockClear();
});
describe("native root session boundary", () => {
	it("never mounts the account session hook for desktop startup", () => {
		controls.desktop = true;
		expect(renderToString(createElement(VaultApp))).toContain(
			"Loading local vault",
		);
		expect(controls.useSession).not.toHaveBeenCalled();
	});
	it("preserves the web account session hook", () => {
		controls.desktop = false;
		renderToString(createElement(VaultApp));
		expect(controls.useSession).toHaveBeenCalledTimes(1);
	});
});
