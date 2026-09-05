// A test-only runtime, never part of dist. All records and capabilities are synthetic.
let state = "disconnected";
let origin = "https://vault.example.test";
Object.assign(globalThis, {
	chrome: {
		runtime: {
			sendMessage: async (message: { type: string; origin?: string }) => {
				if (message.type === "pair") {
					origin = message.origin ?? origin;
					state = "connected";
					return { ok: true };
				}
				if (message.type === "lock") {
					state = "locked";
					return { ok: true };
				}
				if (message.type === "status")
					return {
						ok: true,
						state,
						origin,
						expiresAt: state === "connected" ? Date.now() + 300_000 : null,
					};
				if (message.type === "list")
					return {
						ok: true,
						origin: location.origin,
						items: [
							{
								id: "11111111-1111-4111-8111-111111111111",
								title: "Synthetic test account",
								username: "synthetic@example.test",
							},
						],
						forms: [
							{
								id: "22222222-2222-4222-8222-222222222222",
								label: "Login form 1",
							},
							{
								id: "33333333-3333-4333-8333-333333333333",
								label: "Login form 2",
							},
						],
						token: crypto.randomUUID(),
						expiresAt: Date.now() + 10_000,
					};
				return { ok: true };
			},
		},
	},
});
await import("../src/popup");
export {};
