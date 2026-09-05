import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
	vi.resetModules();
});

it("can import desktop vault modules at the real bundled scheme without initializing HTTP auth", async () => {
	vi.stubEnv("VITE_SVRGN_CLIENT", "desktop");
	vi.stubGlobal("window", { location: new URL("tauri://localhost/") });
	const fetch = vi.fn();
	vi.stubGlobal("fetch", fetch);
	const { getAuthClient } = await import("./auth-client");
	expect(() => getAuthClient()).toThrow("unavailable in this desktop client");
	expect(fetch).not.toHaveBeenCalled();
});

it("lazily retains the account client for the web target", async () => {
	vi.stubEnv("VITE_SVRGN_CLIENT", "web");
	const { getAuthClient } = await import("./auth-client");
	expect(getAuthClient()).toBe(getAuthClient());
	expect(typeof getAuthClient().useSession).toBe("function");
});
