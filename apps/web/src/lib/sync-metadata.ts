import {
	parseDecimalBigInt,
	parseEncryptedRecordEnvelopeV2,
	parseSyncMutationRequest,
	type SyncMutationRequest,
} from "@svrgn/sync-protocol";

export interface SyncedRecordState {
	revision: string;
	localUpdatedAt: string | null;
	tombstoned: boolean;
}

export interface PendingSyncMutation {
	mutation: SyncMutationRequest;
	localUpdatedAt: string | null;
}

export interface SyncConflict {
	record: SyncMutationRequest["record"];
	detectedAt: string;
}

export interface SyncMetadata {
	version: 1;
	vaultId: string;
	cursor: string;
	records: Record<string, SyncedRecordState>;
	outbox: PendingSyncMutation[];
	conflicts: SyncConflict[];
}

export interface SyncMetadataStore {
	load(ownerUserId: string): Promise<SyncMetadata | null>;
	save(ownerUserId: string, metadata: SyncMetadata): Promise<void>;
	remove(ownerUserId: string): Promise<void>;
}

export const parseSyncMetadata = (value: unknown): SyncMetadata => {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error("Stored sync metadata is invalid.");
	}
	const candidate = value as Partial<SyncMetadata>;
	if (
		candidate.version !== 1 ||
		typeof candidate.vaultId !== "string" ||
		candidate.vaultId.length === 0 ||
		typeof candidate.cursor !== "string" ||
		typeof candidate.records !== "object" ||
		candidate.records === null ||
		Array.isArray(candidate.records) ||
		!Array.isArray(candidate.outbox) ||
		!Array.isArray(candidate.conflicts)
	) {
		throw new Error("Stored sync metadata is invalid.");
	}
	parseDecimalBigInt(candidate.cursor, { allowZero: true, label: "cursor" });
	for (const [recordId, state] of Object.entries(candidate.records)) {
		if (
			!recordId ||
			typeof state !== "object" ||
			state === null ||
			typeof state.revision !== "string" ||
			(state.localUpdatedAt !== null &&
				typeof state.localUpdatedAt !== "string") ||
			typeof state.tombstoned !== "boolean"
		) {
			throw new Error("Stored sync record metadata is invalid.");
		}
		parseDecimalBigInt(state.revision, { label: "record revision" });
	}
	for (const pending of candidate.outbox) {
		if (
			typeof pending !== "object" ||
			pending === null ||
			(pending.localUpdatedAt !== null &&
				typeof pending.localUpdatedAt !== "string")
		) {
			throw new Error("Stored sync outbox is invalid.");
		}
		parseSyncMutationRequest(pending.mutation);
	}
	for (const conflict of candidate.conflicts) {
		if (
			typeof conflict !== "object" ||
			conflict === null ||
			typeof conflict.detectedAt !== "string"
		) {
			throw new Error("Stored sync conflict is invalid.");
		}
		parseEncryptedRecordEnvelopeV2(conflict.record);
	}
	return candidate as SyncMetadata;
};

const DATABASE_NAME = "sovereignty-sync";
const STORE_NAME = "account-state";

const openDatabase = (): Promise<IDBDatabase> =>
	new Promise((resolve, reject) => {
		if (!("indexedDB" in globalThis)) {
			reject(new Error("IndexedDB is unavailable."));
			return;
		}
		const request = indexedDB.open(DATABASE_NAME, 1);
		request.onupgradeneeded = () => {
			if (!request.result.objectStoreNames.contains(STORE_NAME)) {
				request.result.createObjectStore(STORE_NAME);
			}
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () =>
			reject(request.error ?? new Error("IndexedDB failed."));
	});

const transaction = <T>(
	mode: IDBTransactionMode,
	operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> =>
	openDatabase().then(
		(db) =>
			new Promise<T>((resolve, reject) => {
				const tx = db.transaction(STORE_NAME, mode);
				const request = operation(tx.objectStore(STORE_NAME));
				let result: T;
				request.onsuccess = () => {
					result = request.result;
				};
				request.onerror = () =>
					reject(request.error ?? new Error("IndexedDB failed."));
				tx.oncomplete = () => {
					db.close();
					resolve(result);
				};
				tx.onerror = () => {
					db.close();
					reject(tx.error ?? new Error("IndexedDB transaction failed."));
				};
			}),
	);

export const indexedDbSyncMetadataStore: SyncMetadataStore = {
	async load(ownerUserId) {
		const value = await transaction<unknown>("readonly", (store) =>
			store.get(ownerUserId),
		);
		return value === undefined ? null : parseSyncMetadata(value);
	},
	async save(ownerUserId, metadata) {
		parseSyncMetadata(metadata);
		await transaction("readwrite", (store) => store.put(metadata, ownerUserId));
	},
	async remove(ownerUserId) {
		await transaction("readwrite", (store) => store.delete(ownerUserId));
	},
};
