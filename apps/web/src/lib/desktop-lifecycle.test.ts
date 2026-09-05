import { describe, expect, it, vi } from "vitest";
import {
	attachDesktopLifecycle,
	DESKTOP_LOCK_EVENT,
	VaultLockQueue,
} from "./desktop-lifecycle";

function deferred<T>() {
	let resolve: (value: T) => void = () => {};
	let reject: (error: Error) => void = () => {};
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}
function fixture(enabled = true) {
	const window = new EventTarget() as Window;
	const document = Object.assign(new EventTarget(), {
		visibilityState: "visible",
	}) as unknown as Document;
	const lock = vi.fn(async () => true);
	const completeClose = vi.fn(async () => {});
	const onError = vi.fn();
	const stop = attachDesktopLifecycle({
		enabled,
		window,
		document,
		lock,
		completeClose,
		onError,
	});
	return { window, document, lock, completeClose, onError, stop };
}
describe("desktop lifecycle", () => {
	it("does not install native behavior in the web client", () => {
		const f = fixture(false);
		f.window.dispatchEvent(new Event("blur"));
		f.window.dispatchEvent(
			new CustomEvent(DESKTOP_LOCK_EVENT, { detail: "native-close" }),
		);
		expect(f.lock).not.toHaveBeenCalled();
		f.stop();
	});
	it("locks on blur, hidden, and fixed native focus notification", async () => {
		const f = fixture();
		f.window.dispatchEvent(new Event("blur"));
		Object.defineProperty(f.document, "visibilityState", {
			value: "hidden",
			configurable: true,
		});
		f.document.dispatchEvent(new Event("visibilitychange"));
		f.window.dispatchEvent(
			new CustomEvent(DESKTOP_LOCK_EVENT, { detail: "native-blur" }),
		);
		expect(f.lock.mock.calls).toEqual([["blur"], ["hidden"], ["native-blur"]]);
		expect(f.completeClose).not.toHaveBeenCalled();
		f.stop();
	});
	it("ignores visible transitions and malformed native reasons", () => {
		const f = fixture();
		f.document.dispatchEvent(new Event("visibilitychange"));
		for (const detail of ["unlock", {}, null, 1, ["native-close"]])
			f.window.dispatchEvent(new CustomEvent(DESKTOP_LOCK_EVENT, { detail }));
		expect(f.lock).not.toHaveBeenCalled();
		f.stop();
	});
	it("acknowledges native close only after a successful queued lock", async () => {
		const f = fixture();
		const closing = deferred<boolean>();
		f.lock.mockReturnValue(closing.promise);
		f.window.dispatchEvent(
			new CustomEvent(DESKTOP_LOCK_EVENT, { detail: "native-close" }),
		);
		expect(f.completeClose).not.toHaveBeenCalled();
		closing.resolve(true);
		await closing.promise;
		await Promise.resolve();
		expect(f.completeClose).toHaveBeenCalledTimes(1);
		f.stop();
	});
	it.each([
		"false",
		"rejected",
	])("keeps the native window open when lock returns %s", async (failure) => {
		const f = fixture();
		if (failure === "false") f.lock.mockResolvedValue(false);
		else f.lock.mockRejectedValue(new Error("Synthetic closure failure"));
		f.window.dispatchEvent(
			new CustomEvent(DESKTOP_LOCK_EVENT, { detail: "native-close" }),
		);
		await Promise.resolve();
		await Promise.resolve();
		expect(f.completeClose).not.toHaveBeenCalled();
		expect(f.onError).toHaveBeenCalled();
		f.stop();
	});
	it("does not duplicate close acknowledgement and removes listeners", async () => {
		const f = fixture();
		f.window.dispatchEvent(
			new CustomEvent(DESKTOP_LOCK_EVENT, { detail: "native-close" }),
		);
		f.window.dispatchEvent(
			new CustomEvent(DESKTOP_LOCK_EVENT, { detail: "native-close" }),
		);
		await Promise.resolve();
		await Promise.resolve();
		expect(f.completeClose).toHaveBeenCalledTimes(1);
		f.stop();
		f.window.dispatchEvent(new Event("blur"));
		expect(f.lock).toHaveBeenCalledTimes(2);
	});
	it("does not acknowledge an abandoned component", async () => {
		const f = fixture();
		const closing = deferred<boolean>();
		f.lock.mockReturnValue(closing.promise);
		f.window.dispatchEvent(
			new CustomEvent(DESKTOP_LOCK_EVENT, { detail: "native-close" }),
		);
		f.stop();
		closing.resolve(true);
		await closing.promise;
		expect(f.completeClose).not.toHaveBeenCalled();
	});
});
describe("vault lock queue", () => {
	it("revokes reads synchronously while a save finishes and coalesces closure", async () => {
		const queue = new VaultLockQueue();
		const save = deferred<void>();
		let canRead = true;
		const close = vi.fn(async () => {
			await save.promise;
			return true;
		});
		const revoke = () => {
			canRead = false;
		};
		const ticket = queue.ticket();
		const first = queue.request(revoke, close);
		const second = queue.request(revoke, close);
		expect(canRead).toBe(false);
		expect(queue.current(ticket)).toBe(false);
		expect(first).toBe(second);
		expect(close).toHaveBeenCalledTimes(1);
		save.resolve();
		expect(await first).toBe(true);
		await Promise.resolve();
		expect(queue.current(ticket)).toBe(false);
		expect(queue.current(queue.ticket())).toBe(true);
	});
	it("invalidates an unlock that was still deriving its key", async () => {
		const queue = new VaultLockQueue();
		const before = queue.ticket();
		await queue.request(
			() => {},
			async () => true,
		);
		expect(queue.current(before)).toBe(false);
	});
	it("surfaces failed closure without silently granting a new close", async () => {
		const queue = new VaultLockQueue();
		expect(
			await queue.request(
				() => {},
				async () => {
					throw new Error("Synthetic disk failure");
				},
			),
		).toBe(false);
		expect(
			await queue.request(
				() => {},
				async () => true,
			),
		).toBe(true);
	});
});
