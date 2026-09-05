import { createVault, createVaultItem } from "@svrgn/vault-core";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { VaultDocument } from "./models";
import {
	type SubmissionReviewView,
	SubmittedLoginReviews,
} from "./submitted-login-review";
import {
	persistCreatedVault,
	saveLocalVault,
	unlockLocalVault,
} from "./vault-adapter";

const origin = "https://login.example.test";
const proposal = () => ({
	v: 1,
	type: "proposal",
	id: crypto.randomUUID(),
	origin,
	expiresAt: Date.now() + 30_000,
	username: "submitted-user",
	password: "synthetic-submitted-password",
});
function fixture() {
	let document: VaultDocument = {
		version: 1,
		id: crypto.randomUUID(),
		createdAt: "2026-09-05T00:00:00.000Z",
		updatedAt: "2026-09-05T00:00:00.000Z",
		items: [
			createVaultItem({
				title: "Existing login",
				website: `${origin}/login`,
				username: "old-user",
				password: "old-synthetic-password",
				notes: "Keep notes",
				favorite: true,
			}),
		],
	};
	let live = true;
	let view: SubmissionReviewView | null = null;
	const persist = vi.fn(
		async (update: (doc: VaultDocument) => VaultDocument) => {
			document = update(document);
			return true;
		},
	);
	const review = new SubmittedLoginReviews(
		() => (live ? document.items : null),
		persist,
		(value) => {
			view = value;
		},
	);
	return {
		review,
		persist,
		get document() {
			return document;
		},
		get view() {
			return view;
		},
		replace: (next: VaultDocument) => {
			document = next;
		},
		lock: () => {
			live = false;
		},
		live: () => live,
	};
}
afterEach(() => {
	vi.clearAllTimers();
	vi.useRealTimers();
});
describe("submitted login approval", () => {
	it("does not persist until explicit create and exposes metadata only", async () => {
		const f = fixture();
		const p = proposal();
		expect(f.review.offer(p, f.live)).toBe(true);
		expect(f.persist).not.toHaveBeenCalled();
		expect(JSON.stringify(f.view)).not.toContain(p.password);
		expect(await f.review.approve(p.id, null)).toBe(true);
		expect(f.document.items).toHaveLength(2);
		expect(f.document.items[1]).toMatchObject({
			title: "login.example.test",
			website: origin,
			username: p.username,
			password: p.password,
		});
		expect(await f.review.approve(p.id, null)).toBe(false);
	});
	it("updates only credentials and preserves existing fields", async () => {
		const f = fixture();
		const original = f.document.items[0];
		const p = proposal();
		f.review.offer(p, f.live);
		expect(await f.review.approve(p.id, original.id)).toBe(true);
		expect(f.document.items[0]).toMatchObject({
			...original,
			username: p.username,
			password: p.password,
			updatedAt: expect.any(String),
		});
		expect(f.document.items).toHaveLength(1);
	});
	it.each([
		"cancel",
		"expiry",
		"lock",
		"wrong-id",
	])("never persists %s approval", async (state) => {
		vi.useFakeTimers();
		const f = fixture();
		const p = proposal();
		f.review.offer(p, f.live);
		if (state === "cancel") f.review.cancel();
		if (state === "expiry") vi.setSystemTime(Date.now() + 30000);
		if (state === "lock") f.lock();
		expect(
			await f.review.approve(
				state === "wrong-id" ? crypto.randomUUID() : p.id,
				null,
			),
		).toBe(false);
		expect(f.persist).not.toHaveBeenCalled();
		f.review.cancel();
	});
	it.each([
		"other-origin",
		"replacement",
		"deleted",
	])("refuses %s update", async (state) => {
		const f = fixture();
		const p = proposal();
		const original = f.document.items[0];
		f.review.offer(p, f.live);
		if (state === "other-origin")
			f.replace({
				...f.document,
				items: [{ ...original, website: "https://victim.test" }],
			});
		if (state === "replacement")
			f.replace({
				...f.document,
				items: [{ ...original, password: "changed-with-same-timestamp" }],
			});
		if (state === "deleted") f.replace({ ...f.document, items: [] });
		const before = f.document;
		expect(await f.review.approve(p.id, original.id)).toBe(false);
		expect(f.document).toBe(before);
	});
	it("refuses unrelated target even if its origin matches", async () => {
		const f = fixture();
		const p = proposal();
		f.review.offer(p, f.live);
		expect(await f.review.approve(p.id, crypto.randomUUID())).toBe(false);
	});
	it("replaces previous proposal and clears expired metadata", async () => {
		vi.useFakeTimers();
		const f = fixture();
		const first = proposal();
		f.review.offer(first, f.live);
		const second = proposal();
		f.review.offer(second, f.live);
		expect(await f.review.approve(first.id, null)).toBe(false);
		await vi.advanceTimersByTimeAsync(30000);
		expect(f.view).toBeNull();
		expect(await f.review.approve(second.id, null)).toBe(false);
	});
	it("validates proposal schema before any approval", () => {
		const f = fixture();
		expect(
			f.review.offer({ ...proposal(), password: "x".repeat(4097) }, f.live),
		).toBe(false);
		expect(f.review.offer({ ...proposal(), origin: null }, f.live)).toBe(false);
		expect(f.review.offer({ ...proposal(), extra: true }, f.live)).toBe(false);
		expect(f.persist).not.toHaveBeenCalled();
	});
	it("successful create and update use the encrypted local persist path", async () => {
		let serialized = "";
		const storage = {
			getItem: () => serialized,
			setItem: (_key: string, value: string) => {
				serialized = value;
			},
		};
		const created = await Effect.runPromise(
			createVault("synthetic-master-password-only"),
		);
		const unlocked = persistCreatedVault(created, storage);
		let document = unlocked.document;
		const review = new SubmittedLoginReviews(
			() => document.items,
			async (update) => {
				const next = update(document);
				await saveLocalVault(unlocked, next);
				document = next;
				return true;
			},
			() => {},
		);
		const first = proposal();
		review.offer(first, () => true);
		expect(await review.approve(first.id, null)).toBe(true);
		expect(serialized).not.toContain(first.password);
		expect(serialized).not.toContain(first.username);
		const second = { ...proposal(), password: "synthetic-updated-password" };
		review.offer(second, () => true);
		expect(await review.approve(second.id, document.items[0].id)).toBe(true);
		expect(serialized).not.toContain(second.password);
		await unlocked.close();
		const restored = await unlockLocalVault(
			"synthetic-master-password-only",
			storage,
		);
		expect(restored.document.items[0].password).toBe(second.password);
		await restored.close();
	});
});
