export const DESKTOP_LOCK_EVENT = "svrgn:desktop-lock";
export type DesktopLockReason =
	| "blur"
	| "hidden"
	| "native-blur"
	| "native-close";
/** Coalesce overlapping locks and invalidate any authentication begun earlier. */
export class VaultLockQueue {
	private epoch = 0;
	private pending: Promise<boolean> | null = null;
	ticket() {
		return this.epoch;
	}
	current(ticket: number) {
		return ticket === this.epoch && this.pending === null;
	}
	request(revoke: () => void, close: () => Promise<boolean>): Promise<boolean> {
		this.epoch += 1;
		revoke();
		if (this.pending) return this.pending;
		const operation = close().catch(() => false);
		this.pending = operation;
		void operation.then(() => {
			if (this.pending === operation) this.pending = null;
		});
		return operation;
	}
}
export function attachDesktopLifecycle(options: {
	enabled: boolean;
	window: Window;
	document: Document;
	lock: (reason: DesktopLockReason) => Promise<boolean>;
	completeClose: () => Promise<void>;
	onError: () => void;
}): () => void {
	if (!options.enabled) return () => {};
	let disposed = false;
	let completingClose = false;
	const request = (reason: DesktopLockReason) => {
		void options
			.lock(reason)
			.then(async (locked) => {
				if (disposed) return;
				if (!locked) {
					options.onError();
					return;
				}
				if (reason === "native-close" && !completingClose) {
					completingClose = true;
					try {
						await options.completeClose();
					} catch {
						completingClose = false;
						options.onError();
					}
				}
			})
			.catch(() => {
				if (!disposed) options.onError();
			});
	};
	const blur = () => request("blur");
	const visibility = () => {
		if (options.document.visibilityState === "hidden") request("hidden");
	};
	const native = (event: Event) => {
		const reason = (event as CustomEvent<unknown>).detail;
		if (reason === "native-blur" || reason === "native-close") request(reason);
	};
	options.window.addEventListener("blur", blur);
	options.document.addEventListener("visibilitychange", visibility);
	options.window.addEventListener(DESKTOP_LOCK_EVENT, native);
	return () => {
		disposed = true;
		options.window.removeEventListener("blur", blur);
		options.document.removeEventListener("visibilitychange", visibility);
		options.window.removeEventListener(DESKTOP_LOCK_EVENT, native);
	};
}
