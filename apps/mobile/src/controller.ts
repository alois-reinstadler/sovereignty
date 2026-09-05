import type { EncryptedStore } from "./storage";
import type {
	EncryptedVaultEnvelope,
	MobileVault,
	VaultDocument,
	VaultItem,
	VaultSession,
} from "./vault";

export interface VaultState {
	ready: boolean;
	busy: boolean;
	hasVault: boolean;
	unlocked: boolean;
	items: readonly VaultItem[];
	message: string;
}
export class VaultController {
	private epoch = 0;
	private active = true;
	private envelope: EncryptedVaultEnvelope | null = null;
	private session: VaultSession | null = null;
	private owned = new Set<VaultSession>();
	private pendingDocuments = new Set<{ document: VaultDocument | null }>();
	private listeners = new Set<() => void>();
	private state: VaultState = {
		ready: false,
		busy: false,
		hasVault: false,
		unlocked: false,
		items: [],
		message: "Loading encrypted vault",
	};
	constructor(
		readonly vault: MobileVault,
		private readonly store: EncryptedStore,
	) {}
	getState = () => this.state;
	subscribe = (listener: () => void) => {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	};
	private update(patch: Partial<VaultState>) {
		this.state = { ...this.state, ...patch };
		for (const listener of this.listeners) listener();
	}
	private discard(session: VaultSession) {
		this.vault.destroy(session);
		session.document = { ...session.document, items: [] };
		this.owned.delete(session);
	}
	async initialize() {
		try {
			this.envelope = await this.store.load();
			this.update({
				ready: true,
				hasVault: this.envelope !== null,
				message: this.envelope
					? "Vault locked"
					: "Create a local encrypted vault",
			});
		} catch {
			this.update({
				ready: false,
				message:
					"Encrypted storage could not be read. Existing files were preserved.",
			});
		}
	}
	setActive(active: boolean) {
		this.active = active;
		if (!active) this.lock();
	}
	lock() {
		this.epoch++;
		this.session = null;
		for (const session of this.owned) this.discard(session);
		for (const pending of this.pendingDocuments) pending.document = null;
		this.update({ unlocked: false, items: [], message: "Vault locked" });
	}
	async authenticate(password: string, create: boolean) {
		if (
			!this.active ||
			!this.state.ready ||
			this.state.busy ||
			this.state.unlocked
		)
			return;
		if (create === this.state.hasVault) {
			this.update({
				message: "Existing vault state changed. Reload before continuing.",
			});
			return;
		}
		const epoch = this.epoch;
		this.update({
			busy: true,
			message: create ? "Creating encrypted vault" : "Unlocking vault",
		});
		let session: VaultSession | undefined;
		try {
			// Yield once so the password field can clear before synchronous native KDF.
			await new Promise<void>((resolve) => setTimeout(resolve, 0));
			if (!this.active || epoch !== this.epoch) return;
			if (create) {
				const created = this.vault.create(password);
				password = "";
				session = created.session;
				this.owned.add(session);
				await this.store.write(created.envelope);
				this.envelope = created.envelope;
				this.update({ hasVault: true });
			} else {
				if (!this.envelope) throw new Error("No encrypted vault");
				session = this.vault.unlock(this.envelope, password);
				password = "";
				this.owned.add(session);
			}
			if (!this.active || epoch !== this.epoch) {
				this.discard(session);
				return;
			}
			this.session = session;
			this.update({
				unlocked: true,
				items: session.document.items,
				message: "Unlocked · stored only on this device",
			});
		} catch {
			if (session) this.discard(session);
			if (epoch === this.epoch)
				this.update({
					message:
						"Could not create or unlock the vault. Check the password and encrypted storage.",
				});
		} finally {
			password = "";
			this.update({ busy: false });
		}
	}
	async save(item: VaultItem, isNew: boolean) {
		return this.mutate((items) => {
			const exists = items.some((value) => value.id === item.id);
			if (exists === isNew) throw new Error("Login changed while editing");
			return isNew
				? [...items, item]
				: items.map((value) => (value.id === item.id ? item : value));
		});
	}
	async remove(id: string) {
		return this.mutate((items) => {
			if (!items.some((item) => item.id === id))
				throw new Error("Login no longer exists");
			return items.filter((item) => item.id !== id);
		});
	}
	private async mutate(
		change: (items: readonly VaultItem[]) => readonly VaultItem[],
	) {
		if (!this.active || !this.session || !this.envelope || this.state.busy)
			return false;
		const epoch = this.epoch;
		const session = this.session;
		const pending: { document: VaultDocument | null } = { document: null };
		this.pendingDocuments.add(pending);
		this.update({ busy: true });
		try {
			pending.document = {
				...session.document,
				updatedAt: new Date().toISOString(),
				items: change(session.document.items),
			};
			change = () => [];
			// All cryptography finishes synchronously before the asynchronous filesystem boundary.
			const envelope = this.vault.seal(
				{ vaultKey: session.vaultKey, document: pending.document },
				this.envelope,
			);
			await this.store.write(envelope);
			this.envelope = envelope;
			if (epoch !== this.epoch || !this.active || !pending.document)
				return false;
			session.document = pending.document;
			this.update({
				items: pending.document.items,
				message: "Encrypted changes saved on this device",
			});
			return true;
		} catch {
			if (epoch === this.epoch)
				this.update({
					message:
						"The change was not saved. Existing encrypted snapshots were preserved.",
				});
			return false;
		} finally {
			pending.document = null;
			this.pendingDocuments.delete(pending);
			this.update({ busy: false });
		}
	}
}
