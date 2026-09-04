import { describe, expect, it } from "vitest";

import { SECURITY_HEADERS, withSecurityHeaders } from "./server";

describe("application security headers", () => {
	it("protects HTML and API responses without replacing their headers", async () => {
		const secured = withSecurityHeaders(
			new Response("ok", {
				status: 201,
				headers: { "cache-control": "no-store" },
			}),
		);

		expect(secured.status).toBe(201);
		expect(await secured.text()).toBe("ok");
		expect(secured.headers.get("cache-control")).toBe("no-store");
		expect(secured.headers.get("x-content-type-options")).toBe("nosniff");
		expect(secured.headers.get("x-frame-options")).toBe("DENY");
		expect(secured.headers.get("content-security-policy")).toContain(
			"frame-ancestors 'none'",
		);
		expect(secured.headers.get("content-security-policy")).toContain(
			"'wasm-unsafe-eval'",
		);
	});

	it("defines every required browser policy", () => {
		expect(SECURITY_HEADERS).toHaveProperty("content-security-policy");
		expect(SECURITY_HEADERS).toHaveProperty("permissions-policy");
		expect(SECURITY_HEADERS).toHaveProperty("referrer-policy", "no-referrer");
		expect(SECURITY_HEADERS).toHaveProperty("strict-transport-security");
	});
});
