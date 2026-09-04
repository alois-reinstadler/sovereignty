import {
	addVaultItem,
	type CreatedVault,
	createVault,
	createVaultItem,
	destroyVaultSession,
	type EncryptedVaultEnvelope,
	parseEncryptedVault,
	removeVaultItem,
	sealVault,
	serializeEncryptedVault,
	unlockVault,
	updateVaultItem,
	type VaultSession,
} from "@svrgn/vault-core";
import { Effect } from "effect";

import type { UnlockedVault, VaultDocument, VaultItem } from "./models";

export const VAULT_STORAGE_KEY = "svrgn.vault.envelope.v1";
export const VAULT_BACKUP_EXTENSION = ".svrgn";
export const VAULT_BACKUP_MAX_BYTES = 10 * 1024 * 1024;

export type LocalVaultStorage = Pick<Storage, "getItem" | "setItem">;

export interface EncryptedVaultBackup {
	filename: string;
	serialized: string;
}

export class LocalVaultStorageError extends Error {
	readonly operation: "read" | "write" | "parse";

	constructor(
		operation: "read" | "write" | "parse",
		message: string,
		cause?: unknown,
	) {
		super(message, { cause });
		this.name = "LocalVaultStorageError";
		this.operation = operation;
	}
}

const browserStorage = (): LocalVaultStorage => {
	try {
		return globalThis.localStorage;
	} catch (cause) {
		throw new LocalVaultStorageError(
			"read",
			"Browser storage is unavailable. Allow site storage and try again.",
			cause,
		);
	}
};

const readStoredSerialized = (
	storage: LocalVaultStorage = browserStorage(),
): string | null => {
	let serialized: string | null;
	try {
		serialized = storage.getItem(VAULT_STORAGE_KEY);
	} catch (cause) {
		throw new LocalVaultStorageError(
			"read",
			"Browser storage is unavailable. Allow site storage and try again.",
			cause,
		);
	}

	return serialized;
};

const readStoredEnvelope = (
	storage: LocalVaultStorage = browserStorage(),
): EncryptedVaultEnvelope | null => {
	const serialized = readStoredSerialized(storage);
	if (!serialized) return null;
	try {
		return parseEncryptedVault(serialized);
	} catch (cause) {
		throw new LocalVaultStorageError(
			"parse",
			"The stored vault is damaged or uses an unsupported format. Its encrypted data was not changed.",
			cause,
		);
	}
};

const backupByteLength = (serialized: string): number =>
	new TextEncoder().encode(serialized).byteLength;

export function parseEncryptedVaultBackup(
	serialized: string,
): EncryptedVaultEnvelope {
	if (!serialized.trim()) {
		throw new LocalVaultStorageError("parse", "The selected backup is empty.");
	}
	if (backupByteLength(serialized) > VAULT_BACKUP_MAX_BYTES) {
		throw new LocalVaultStorageError(
			"parse",
			"The selected backup is larger than 10 MB and was not imported.",
		);
	}
	try {
		return parseEncryptedVault(serialized);
	} catch (cause) {
		throw new LocalVaultStorageError(
			"parse",
			"The selected file is not a supported Sovereignty encrypted vault backup.",
			cause,
		);
	}
}

const safeBackupFilename = (envelope: EncryptedVaultEnvelope): string => {
	const vaultId = envelope.id
		.toLocaleLowerCase("en")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 24);
	const timestamp = envelope.updatedAt
		.replace(/\.\d{3}Z$/, "Z")
		.replace(/[^0-9TZ]/g, "-");
	return `svrgn-vault-${vaultId || "local"}-${timestamp}${VAULT_BACKUP_EXTENSION}`;
};

/** Returns the exact persisted encrypted envelope. No vault session is read. */
export function exportLocalVaultBackup(
	storage: LocalVaultStorage = browserStorage(),
): EncryptedVaultBackup {
	const serialized = readStoredSerialized(storage);
	if (!serialized) {
		throw new LocalVaultStorageError(
			"read",
			"No encrypted local vault is available to export.",
		);
	}
	const envelope = parseEncryptedVaultBackup(serialized);
	return { filename: safeBackupFilename(envelope), serialized };
}

export interface ImportLocalVaultBackupOptions {
	overwriteExisting?: boolean;
	storage?: LocalVaultStorage;
}

/** Validates the complete backup before checking overwrite consent or writing. */
export function importLocalVaultBackup(
	serialized: string,
	options: ImportLocalVaultBackupOptions = {},
): EncryptedVaultEnvelope {
	const envelope = parseEncryptedVaultBackup(serialized);
	const storage = options.storage ?? browserStorage();
	const existing = readStoredSerialized(storage);
	if (existing !== null && !options.overwriteExisting) {
		throw new LocalVaultStorageError(
			"write",
			"Import cancelled. The existing encrypted vault was not changed.",
		);
	}
	storeEnvelope(envelope, storage);
	return envelope;
}

export function hasStoredVault(storage?: LocalVaultStorage): boolean {
	return readStoredEnvelope(storage) !== null;
}

const storeEnvelope = (
	envelope: EncryptedVaultEnvelope,
	storage: LocalVaultStorage = browserStorage(),
): void => {
	try {
		storage.setItem(VAULT_STORAGE_KEY, serializeEncryptedVault(envelope));
	} catch (cause) {
		throw new LocalVaultStorageError(
			"write",
			"The encrypted vault could not be saved because browser storage is unavailable or full.",
			cause,
		);
	}
};

interface VaultLifecycle {
	seal: (
		session: VaultSession,
		envelope: EncryptedVaultEnvelope,
	) => Promise<EncryptedVaultEnvelope>;
	store: (envelope: EncryptedVaultEnvelope) => void;
	destroy: (session: VaultSession) => void;
}

const makeDefaultVaultLifecycle = (
	storage?: LocalVaultStorage,
): VaultLifecycle => ({
	seal: (session, envelope) => Effect.runPromise(sealVault(session, envelope)),
	store: (envelope) => storeEnvelope(envelope, storage),
	destroy: destroyVaultSession,
});

export const makeUnlockedVault = (
	initialSession: VaultSession,
	initialEnvelope: EncryptedVaultEnvelope,
	lifecycle: VaultLifecycle = makeDefaultVaultLifecycle(),
): UnlockedVault => {
	let session = initialSession;
	let envelope = initialEnvelope;
	let closing = false;
	let pendingWrite = Promise.resolve();
	let closePromise: Promise<void> | null = null;

	return {
		document: session.document,
		seal: (document) => {
			if (closing) {
				return Promise.reject(new Error("The vault session is closing."));
			}

			const operation = pendingWrite
				.catch(() => undefined)
				.then(async () => {
					const nextSession = { ...session, document };
					const nextEnvelope = await lifecycle.seal(nextSession, envelope);
					lifecycle.store(nextEnvelope);
					session = nextSession;
					envelope = nextEnvelope;
				});
			pendingWrite = operation;
			return operation;
		},
		close: () => {
			if (closePromise) return closePromise;
			closing = true;
			closePromise = pendingWrite
				.catch(() => undefined)
				.then(() => lifecycle.destroy(session));
			return closePromise;
		},
	};
};

export function persistCreatedVault(
	created: CreatedVault,
	storage?: LocalVaultStorage,
): UnlockedVault {
	const lifecycle = makeDefaultVaultLifecycle(storage);
	try {
		lifecycle.store(created.envelope);
	} catch (cause) {
		lifecycle.destroy(created.session);
		throw cause;
	}
	return makeUnlockedVault(created.session, created.envelope, lifecycle);
}

export async function createLocalVault(
	password: string,
): Promise<UnlockedVault> {
	const created = await Effect.runPromise(createVault(password));
	return persistCreatedVault(created);
}

export async function unlockLocalVault(
	password: string,
	storage?: LocalVaultStorage,
): Promise<UnlockedVault> {
	const envelope = readStoredEnvelope(storage);
	if (!envelope) throw new Error("No local vault was found.");
	try {
		const session = await Effect.runPromise(unlockVault(envelope, password));
		return makeUnlockedVault(
			session,
			envelope,
			makeDefaultVaultLifecycle(storage),
		);
	} catch {
		throw new Error("The password is incorrect or the vault is damaged.");
	}
}

export async function saveLocalVault(
	session: UnlockedVault,
	document: VaultDocument,
) {
	await session.seal(document);
}

export const createLogin = (): VaultItem =>
	createVaultItem({ title: "Untitled login" });

export const replaceItem = (
	document: VaultDocument,
	item: VaultItem,
): VaultDocument =>
	document.items.some((candidate) => candidate.id === item.id)
		? updateVaultItem(document, item.id, {
				title: item.title,
				username: item.username,
				password: item.password,
				website: item.website,
				notes: item.notes,
				favorite: item.favorite,
			})
		: addVaultItem(document, item);

export const removeItem = (
	document: VaultDocument,
	id: string,
): VaultDocument => removeVaultItem(document, id);
