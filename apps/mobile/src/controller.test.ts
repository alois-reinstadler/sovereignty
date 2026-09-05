import { protocolVectors } from "@svrgn/protocol-vectors";
import { describe, expect, it, vi } from "vitest";
import { VaultController } from "./controller";
import type { EncryptedStore } from "./storage";
import { MobileVault, parseEnvelope, type VaultSession } from "./vault";

// Explicit fake: these tests verify ownership/lifecycle, never native cryptography.
class FakeVault extends MobileVault {
	sessions: VaultSession[] = [];
	constructor() {
		const unavailable = () => {
			throw new Error("Fake provider does not implement cryptography");
		};
		super({
			zero: (bytes) => {
				bytes.fill(0);
			},
			random: unavailable,
			derive: unavailable,
			encrypt: unavailable,
			decrypt: unavailable,
			encode: unavailable,
			decode: unavailable,
			text: unavailable,
		});
	}
	override create() {
		const envelope = parseEnvelope(JSON.stringify(protocolVectors.v1.envelope));
		const session: VaultSession = {
			vaultKey: new Uint8Array(32).fill(99),
			document: { ...protocolVectors.v1.document, version: 1, items: [] },
		};
		this.sessions.push(session);
		return { session, envelope };
	}
	override unlock() {
		return this.create().session;
	}
	override seal() {
		return parseEnvelope(JSON.stringify(protocolVectors.v1.envelope));
	}
}
const deferred = () => {
	let resolve: () => void = () => {};
	let reject: () => void = () => {};
	const promise = new Promise<void>((yes, no) => {
		resolve = yes;
		reject = () => no(new Error("Synthetic I/O failure"));
	});
	return { promise, resolve, reject };
};
function setup(existing = false) {
	const vault = new FakeVault();
	const gate = deferred();
	const envelope = parseEnvelope(JSON.stringify(protocolVectors.v1.envelope));
	const store: EncryptedStore = {
		load: vi.fn(async () => (existing ? envelope : null)),
		write: vi.fn(() => gate.promise),
	};
	return { vault, gate, store, controller: new VaultController(vault, store) };
}
const item = { ...protocolVectors.v1.document.items[0] };
describe("mobile plaintext ownership", () => {
	it("revokes a pending native deletion callback across lock and re-unlock", async () => {
		const { controller, gate, store } = setup(true);
		gate.resolve();
		await controller.initialize();
		await controller.authenticate("synthetic", false);
		await controller.save(item, true);
		const remove = controller.prepareRemoval(item.id);
		controller.lock();
		await controller.authenticate("synthetic", false);
		await controller.save(item, true);
		vi.mocked(store.write).mockClear();
		expect(await remove()).toBe(false);
		expect(controller.getState().items).toHaveLength(1);
		expect(store.write).not.toHaveBeenCalled();
	});
	it("allows a current deletion but rejects one after another state change", async () => {
		const { controller, gate } = setup(true);
		gate.resolve();
		await controller.initialize();
		await controller.authenticate("synthetic", false);
		await controller.save(item, true);
		const stale = controller.prepareRemoval(item.id);
		await controller.save({ ...item, title: "Updated synthetic login" }, false);
		expect(await stale()).toBe(false);
		expect(await controller.prepareRemoval(item.id)()).toBe(true);
		expect(controller.getState().items).toEqual([]);
	});
	it("revokes a created session while encrypted publication is pending and refuses late unlock", async () => {
		const { controller, vault, gate } = setup();
		await controller.initialize();
		const creating = controller.authenticate("synthetic test password", true);
		await vi.waitFor(() => expect(vault.sessions).toHaveLength(1));
		controller.setActive(false);
		expect(vault.sessions[0].vaultKey).toEqual(new Uint8Array(32));
		expect(controller.getState().items).toEqual([]);
		gate.resolve();
		await creating;
		expect(controller.getState()).toMatchObject({
			unlocked: false,
			hasVault: true,
			busy: false,
		});
	});
	it("cancels unlock before the native KDF when backgrounded during scheduling", async () => {
		const { controller, vault } = setup(true);
		await controller.initialize();
		const unlocking = controller.authenticate("synthetic test password", false);
		controller.lock();
		await unlocking;
		expect(vault.sessions).toHaveLength(0);
		expect(controller.getState().unlocked).toBe(false);
	});
	it("clears a live session and pending draft during save, without restoring it after I/O", async () => {
		const { controller, vault, gate } = setup(true);
		await controller.initialize();
		await controller.authenticate("synthetic", false);
		const saving = controller.save(item, true);
		controller.lock();
		expect(vault.sessions[0].vaultKey).toEqual(new Uint8Array(32));
		expect(vault.sessions[0].document.items).toEqual([]);
		gate.resolve();
		expect(await saving).toBe(false);
		expect(controller.getState()).toMatchObject({
			unlocked: false,
			items: [],
			busy: false,
		});
	});
	it("prevents concurrent changes and preserves visible data on failed persistence", async () => {
		const { controller, gate, store } = setup(true);
		await controller.initialize();
		await controller.authenticate("synthetic", false);
		const saving = controller.save(item, true);
		expect(await controller.save({ ...item, id: "another" }, true)).toBe(false);
		gate.reject();
		expect(await saving).toBe(false);
		expect(store.write).toHaveBeenCalledTimes(1);
		expect(controller.getState().items).toEqual([]);
	});
	it("adds, updates and removes only after encrypted persistence succeeds", async () => {
		const { controller, gate } = setup(true);
		gate.resolve();
		await controller.initialize();
		await controller.authenticate("synthetic", false);
		expect(await controller.save(item, true)).toBe(true);
		expect(
			await controller.save(
				{ ...item, title: "Changed synthetic title" },
				false,
			),
		).toBe(true);
		expect(controller.getState().items[0].title).toBe(
			"Changed synthetic title",
		);
		expect(await controller.save(item, true)).toBe(false);
		expect(await controller.remove(item.id)).toBe(true);
		expect(controller.getState().items).toEqual([]);
	});
	it("never replaces an existing vault using the create path", async () => {
		const { controller, vault, store } = setup(true);
		await controller.initialize();
		await controller.authenticate("synthetic", true);
		expect(vault.sessions).toHaveLength(0);
		expect(store.write).not.toHaveBeenCalled();
	});
	it("keeps unreadable storage closed and disables creation", async () => {
		const vault = new FakeVault();
		const store: EncryptedStore = {
			load: async () => {
				throw new Error("Unreadable");
			},
			write: vi.fn(),
		};
		const controller = new VaultController(vault, store);
		await controller.initialize();
		await controller.authenticate("synthetic", true);
		expect(controller.getState().ready).toBe(false);
		expect(store.write).not.toHaveBeenCalled();
	});
	it("does not authenticate while inactive", async () => {
		const { controller, vault } = setup(true);
		await controller.initialize();
		controller.setActive(false);
		await controller.authenticate("synthetic", false);
		expect(vault.sessions).toHaveLength(0);
	});
});
