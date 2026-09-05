import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	desktop: true,
	invoke: vi.fn(),
	validate: vi.fn(),
}));
vi.mock("./client-platform", () => ({
	get IS_DESKTOP() {
		return state.desktop;
	},
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: state.invoke }));
vi.mock("./vault-adapter", () => ({
	parseEncryptedVaultBackup: state.validate,
}));

import { openDesktopBackup, saveDesktopBackup } from "./desktop-backup";

describe("desktop encrypted backup boundary", () => {
	beforeEach(() => {
		state.desktop = true;
		state.invoke.mockReset();
		state.validate.mockReset();
	});
	it("passes only validated ciphertext to save, never a path", async () => {
		state.invoke.mockResolvedValue(true);
		expect(await saveDesktopBackup("synthetic encrypted fixture")).toBe(true);
		expect(state.validate).toHaveBeenCalledWith("synthetic encrypted fixture");
		expect(state.invoke).toHaveBeenCalledWith("desktop_export_backup", {
			serialized: "synthetic encrypted fixture",
		});
		state.validate.mockImplementation(() => {
			throw new Error("invalid");
		});
		await expect(saveDesktopBackup("bad")).rejects.toThrow("invalid");
		expect(state.invoke).toHaveBeenCalledTimes(1);
	});
	it("validates imported ciphertext and rejects malformed native responses", async () => {
		state.invoke.mockResolvedValue("fixture");
		expect(await openDesktopBackup()).toBe("fixture");
		expect(state.invoke).toHaveBeenCalledWith("desktop_import_backup");
		expect(state.validate).toHaveBeenCalledWith("fixture");
		state.invoke.mockResolvedValue({ path: "/unexpected" });
		await expect(openDesktopBackup()).rejects.toThrow("Unexpected");
		await expect(saveDesktopBackup("fixture")).rejects.toThrow("Unexpected");
	});
	it("propagates cancellation without claiming a completed operation", async () => {
		state.invoke.mockResolvedValue(false);
		expect(await saveDesktopBackup("fixture")).toBe(false);
		state.invoke.mockResolvedValue(null);
		expect(await openDesktopBackup()).toBeNull();
	});
	it("never invokes native commands from the web target", async () => {
		state.desktop = false;
		await expect(saveDesktopBackup("fixture")).rejects.toThrow("unavailable");
		await expect(openDesktopBackup()).rejects.toThrow("unavailable");
		expect(state.invoke).not.toHaveBeenCalled();
	});
});
