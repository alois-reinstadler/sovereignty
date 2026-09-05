import { describe, expect, it } from "vitest";
import { clientFeatures, clientPlatform } from "./client-platform";

describe("explicit client build target", () => {
	it("defaults unspecified or unexpected values to web", () => {
		for (const value of [undefined, "web", null, "DESKTOP", {}, "?desktop"])
			expect(clientPlatform(value)).toBe("web");
		expect(clientPlatform("desktop")).toBe("desktop");
	});
	it("keeps server and companion features unavailable only for desktop", () => {
		expect(clientFeatures("desktop")).toEqual({
			accounts: false,
			sync: false,
			extension: false,
			lockOnFocusLoss: true,
		});
		expect(clientFeatures("web")).toEqual({
			accounts: true,
			sync: true,
			extension: true,
			lockOnFocusLoss: false,
		});
	});
});
