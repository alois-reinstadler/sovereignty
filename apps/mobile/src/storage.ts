import {
	type EncryptedVaultEnvelope,
	MAX_ENVELOPE_BYTES,
	parseEnvelope,
} from "./vault";

export interface EncryptedStore {
	load(): Promise<EncryptedVaultEnvelope | null>;
	write(envelope: EncryptedVaultEnvelope): Promise<void>;
}
export interface EncryptedFiles {
	list(): string[];
	size(name: string): number;
	read(name: string): Promise<string>;
	create(name: string, ciphertext: string): void;
	publish(temporary: string, destination: string): Promise<void>;
}

/** Single writer; unique final names avoid replacing an existing file during rename. */
export class JournalStore implements EncryptedStore {
	private sequence = 0;
	private publishedSequence = 0;
	private vaultId: string | null = null;
	private initialized = false;
	private queue: Promise<void> = Promise.resolve();
	constructor(private readonly files: EncryptedFiles) {}
	private entries(writing = false) {
		const entries = this.files.list();
		if (writing && entries.length >= 2000)
			throw new Error(
				"Local vault journal limit reached; preserve and archive encrypted snapshots before continuing",
			);
		return entries.filter((name) => /^vault-\d{12}\.svrgn$/.test(name)).sort();
	}
	async load() {
		await this.queue;
		const entries = this.entries();
		const name = entries.at(-1);
		this.sequence = name ? Number(name.slice(6, 18)) : 0;
		this.publishedSequence = this.sequence;
		// Never silently fall back to an older snapshot after corruption.
		let envelope: EncryptedVaultEnvelope | null = null;
		if (name) {
			if (this.files.size(name) > MAX_ENVELOPE_BYTES)
				throw new Error("Encrypted file exceeds the mobile limit");
			envelope = parseEnvelope(await this.files.read(name));
		}
		this.initialized = true;
		this.vaultId = envelope?.id ?? null;
		return envelope;
	}
	write(envelope: EncryptedVaultEnvelope) {
		const serialized = JSON.stringify(envelope);
		const vaultId = parseEnvelope(serialized).id;
		const task = this.queue.then(async () => {
			if (!this.initialized)
				throw new Error("Read existing vault state before writing");
			const latest = this.entries(true).at(-1);
			if ((latest ? Number(latest.slice(6, 18)) : 0) !== this.publishedSequence)
				throw new Error(
					"Encrypted storage changed externally; reload before writing",
				);
			if (this.vaultId !== null && vaultId !== this.vaultId)
				throw new Error("Cannot replace an existing vault identifier");
			if (this.sequence >= 999999999999)
				throw new Error("Local journal sequence exhausted");
			const sequence = ++this.sequence;
			const name = `vault-${String(sequence).padStart(12, "0")}.svrgn`;
			const temporary = `${name}.pending`;
			this.files.create(temporary, serialized);
			await this.files.publish(temporary, name);
			this.publishedSequence = sequence;
			this.vaultId = vaultId;
		});
		this.queue = task.catch(() => {});
		return task;
	}
}
