import { describe, expect, it, vi } from "vitest";
import { copyForLiveSession } from "./clipboard-session";

describe("clipboard session races", () => {
	it("does not start copying after revocation", async () => {
		const clipboard = { writeText: vi.fn(), readText: vi.fn() };
		expect(await copyForLiveSession("synthetic", clipboard, () => false)).toBe(
			"revoked",
		);
		expect(clipboard.writeText).not.toHaveBeenCalled();
	});
	it("clears the issued value when lock arrives during a write", async () => {
		let live = true;
		let value = "";
		const clipboard = {
			writeText: vi.fn(async (text: string) => {
				value = text;
				live = false;
			}),
			readText: vi.fn(async () => value),
		};
		expect(await copyForLiveSession("synthetic", clipboard, () => live)).toBe(
			"revoked",
		);
		expect(value).toBe("");
	});
	it("preserves clipboard changes made by another app", async () => {
		let live = true;
		const clipboard = {
			writeText: vi.fn(async () => {
				live = false;
			}),
			readText: vi.fn(async () => "another-app-value"),
		};
		expect(await copyForLiveSession("synthetic", clipboard, () => live)).toBe(
			"revoked",
		);
		expect(clipboard.writeText).toHaveBeenCalledTimes(1);
	});
	it("reports blocked clipboard access and successful current-session copying", async () => {
		const clipboard = {
			writeText: vi.fn(async () => {}),
			readText: vi.fn(async () => ""),
		};
		expect(await copyForLiveSession("synthetic", clipboard, () => true)).toBe(
			"copied",
		);
		clipboard.writeText.mockRejectedValue(
			new Error("Synthetic permission rejection"),
		);
		expect(await copyForLiveSession("synthetic", clipboard, () => true)).toBe(
			"blocked",
		);
	});
});
