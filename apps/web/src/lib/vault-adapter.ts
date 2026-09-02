import {
	addVaultItem,
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

const readStoredEnvelope = (): EncryptedVaultEnvelope | null => {
	const serialized = localStorage.getItem(VAULT_STORAGE_KEY);
	return serialized ? parseEncryptedVault(serialized) : null;
};

export function hasStoredVault(): boolean {
	return localStorage.getItem(VAULT_STORAGE_KEY) !== null;
}

const storeEnvelope = (envelope: EncryptedVaultEnvelope): void => {
	localStorage.setItem(VAULT_STORAGE_KEY, serializeEncryptedVault(envelope));
};

const makeUnlockedVault = (
	initialSession: VaultSession,
	initialEnvelope: EncryptedVaultEnvelope,
): UnlockedVault => {
	let session = initialSession;
	let envelope = initialEnvelope;
	return {
		document: session.document,
		seal: async (document) => {
			session = { ...session, document };
			envelope = await Effect.runPromise(sealVault(session, envelope));
			storeEnvelope(envelope);
		},
		destroy: () => destroyVaultSession(session),
	};
};

export async function createLocalVault(
	password: string,
): Promise<UnlockedVault> {
	const created = await Effect.runPromise(createVault(password));
	storeEnvelope(created.envelope);
	return makeUnlockedVault(created.session, created.envelope);
}

export async function unlockLocalVault(
	password: string,
): Promise<UnlockedVault> {
	const envelope = readStoredEnvelope();
	if (!envelope) throw new Error("No local vault was found.");
	try {
		const session = await Effect.runPromise(unlockVault(envelope, password));
		return makeUnlockedVault(session, envelope);
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
