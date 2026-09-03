import type {
	VaultDocument as CoreVaultDocument,
	VaultItem as CoreVaultItem,
	EncryptedVaultEnvelope,
} from "@svrgn/vault-core";

export type VaultItem = CoreVaultItem;
export type VaultDocument = CoreVaultDocument;
export type VaultEnvelope = EncryptedVaultEnvelope;

export type UnlockedVault = {
	document: VaultDocument;
	seal: (document: VaultDocument) => Promise<void>;
	close: () => Promise<void>;
};

export type VaultStatus = "loading" | "setup" | "locked" | "unlocked";
