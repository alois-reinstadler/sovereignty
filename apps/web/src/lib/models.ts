import type {
	DecimalBigInt,
	EncryptedRecordEnvelopeV2,
} from "@svrgn/sync-protocol";
import type {
	ConvertedVaultV2,
	VaultDocument as CoreVaultDocument,
	VaultItem as CoreVaultItem,
	EncryptedVaultEnvelope,
	VaultRecordPlaintext,
} from "@svrgn/vault-core";

export type VaultItem = CoreVaultItem;
export type VaultDocument = CoreVaultDocument;
export type VaultEnvelope = EncryptedVaultEnvelope;

export type UnlockedVault = {
	document: VaultDocument;
	seal: (document: VaultDocument) => Promise<void>;
	prepareInitialSync: (masterPassword: string) => Promise<ConvertedVaultV2>;
	encryptLoginForSync: (
		item: VaultItem,
		revision: DecimalBigInt,
	) => Promise<EncryptedRecordEnvelopeV2>;
	encryptTombstoneForSync: (
		recordId: string,
		deletedAt: string,
		revision: DecimalBigInt,
	) => Promise<EncryptedRecordEnvelopeV2>;
	decryptSyncRecord: (
		record: EncryptedRecordEnvelopeV2,
	) => Promise<VaultRecordPlaintext>;
	close: () => Promise<void>;
};

export type VaultStatus = "loading" | "setup" | "locked" | "unlocked";
