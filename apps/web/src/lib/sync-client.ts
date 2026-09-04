import {
	decimalBigInt,
	type EncryptedRecordEnvelopeV2,
	parseDecimalBigInt,
	parseSyncChangesResponse,
	parseSyncMutationRequest,
	parseVaultKeyEnvelopeV2,
	type SyncChangesResponse,
	type SyncMutationRequest,
	type VaultKeyEnvelopeV2,
} from "@svrgn/sync-protocol";
import type { UnlockedVault, VaultDocument, VaultItem } from "./models";
import type {
	PendingSyncMutation,
	SyncMetadata,
	SyncMetadataStore,
} from "./sync-metadata";

export class SyncClientError extends Error {
	constructor(
		message: string,
		readonly code: string,
		readonly status?: number,
		readonly details?: Record<string, unknown>,
	) {
		super(message);
		this.name = "SyncClientError";
	}
}

export interface SyncHttpClient {
	getVault(): Promise<VaultKeyEnvelopeV2 | null>;
	createVault(keyEnvelope: VaultKeyEnvelopeV2): Promise<{
		keyEnvelope: VaultKeyEnvelopeV2;
		status: "created" | "existing";
	}>;
	pull(vaultId: string, cursor: string): Promise<SyncChangesResponse>;
	push(vaultId: string, mutation: SyncMutationRequest): Promise<void>;
}

const readJson = async (response: Response): Promise<unknown> => {
	try {
		return await response.json();
	} catch {
		throw new SyncClientError(
			"The sync server returned an invalid response.",
			"invalid_response",
			response.status,
		);
	}
};

const responseError = async (response: Response): Promise<never> => {
	const body = (await readJson(response)) as {
		error?: unknown;
		message?: unknown;
	};
	throw new SyncClientError(
		typeof body.message === "string"
			? body.message
			: "The sync request failed.",
		typeof body.error === "string" ? body.error : "request_failed",
		response.status,
		typeof body === "object" && body !== null
			? (body as Record<string, unknown>)
			: undefined,
	);
};

export const browserSyncHttpClient: SyncHttpClient = {
	async getVault() {
		const response = await fetch("/api/sync/v2/vault", {
			headers: { accept: "application/json" },
			credentials: "same-origin",
		});
		if (response.status === 404) return null;
		if (!response.ok) return responseError(response);
		const body = (await readJson(response)) as { keyEnvelope?: unknown };
		return parseVaultKeyEnvelopeV2(body.keyEnvelope);
	},
	async createVault(keyEnvelope) {
		const response = await fetch("/api/sync/v2/vault", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				accept: "application/json",
			},
			credentials: "same-origin",
			body: JSON.stringify({ keyEnvelope }),
		});
		if (!response.ok) return responseError(response);
		const body = (await readJson(response)) as {
			keyEnvelope?: unknown;
			status?: unknown;
		};
		if (body.status !== "created" && body.status !== "existing") {
			throw new SyncClientError(
				"The sync server returned an invalid response.",
				"invalid_response",
			);
		}
		return {
			keyEnvelope: parseVaultKeyEnvelopeV2(body.keyEnvelope),
			status: body.status,
		};
	},
	async pull(vaultId, cursor) {
		const query = new URLSearchParams({ vaultId, cursor, limit: "100" });
		const response = await fetch(`/api/sync/v2/changes?${query}`, {
			headers: { accept: "application/json" },
			credentials: "same-origin",
		});
		if (!response.ok) return responseError(response);
		return parseSyncChangesResponse(await readJson(response));
	},
	async push(vaultId, mutation) {
		parseSyncMutationRequest(mutation);
		const query = new URLSearchParams({ vaultId });
		const response = await fetch(`/api/sync/v2/mutations?${query}`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				accept: "application/json",
			},
			credentials: "same-origin",
			body: JSON.stringify({ mutations: [mutation] }),
		});
		if (!response.ok) return responseError(response);
		const body = (await readJson(response)) as {
			results?: unknown;
			nextCursor?: unknown;
		};
		if (!Array.isArray(body.results) || body.results.length !== 1) {
			throw new SyncClientError(
				"The sync server returned an invalid mutation result.",
				"invalid_response",
			);
		}
		const result = body.results[0] as Record<string, unknown>;
		if (
			typeof result !== "object" ||
			result === null ||
			!(["applied", "replayed"] as const).includes(result.status as never) ||
			result.mutationId !== mutation.mutationId ||
			result.recordId !== mutation.record.recordId ||
			result.revision !== mutation.record.revision
		) {
			throw new SyncClientError(
				"The sync server returned a mismatched mutation result.",
				"invalid_response",
			);
		}
		parseDecimalBigInt(result.cursor, { label: "mutation cursor" });
		parseDecimalBigInt(body.nextCursor, {
			allowZero: true,
			label: "next cursor",
		});
	},
};

const emptyMetadata = (vaultId: string): SyncMetadata => ({
	version: 1,
	vaultId,
	cursor: "0",
	records: {},
	outbox: [],
	conflicts: [],
});

const sameKeyEnvelope = (
	left: VaultKeyEnvelopeV2,
	right: VaultKeyEnvelopeV2,
): boolean =>
	left.format === right.format &&
	left.version === right.version &&
	left.vaultId === right.vaultId &&
	left.keyRevision === right.keyRevision &&
	left.createdAt === right.createdAt &&
	left.kdf.algorithm === right.kdf.algorithm &&
	left.kdf.salt === right.kdf.salt &&
	left.kdf.operationsLimit === right.kdf.operationsLimit &&
	left.kdf.memoryLimit === right.kdf.memoryLimit &&
	left.wrappedVaultKey.algorithm === right.wrappedVaultKey.algorithm &&
	left.wrappedVaultKey.nonce === right.wrappedVaultKey.nonce &&
	left.wrappedVaultKey.ciphertext === right.wrappedVaultKey.ciphertext;

const pendingForRecord = (metadata: SyncMetadata, recordId: string): boolean =>
	metadata.outbox.some(({ mutation }) => mutation.record.recordId === recordId);

const localItem = (
	document: VaultDocument,
	recordId: string,
): VaultItem | undefined => document.items.find((item) => item.id === recordId);

const hasLocalChange = (
	document: VaultDocument,
	metadata: SyncMetadata,
	recordId: string,
): boolean => {
	const state = metadata.records[recordId];
	const item = localItem(document, recordId);
	if (!state) return item !== undefined;
	if (state.tombstoned) return item !== undefined;
	return item?.updatedAt !== state.localUpdatedAt;
};

const withItem = (document: VaultDocument, item: VaultItem): VaultDocument => ({
	...document,
	items: [...document.items.filter(({ id }) => id !== item.id), item],
	updatedAt:
		item.updatedAt > document.updatedAt ? item.updatedAt : document.updatedAt,
});

const withoutItem = (
	document: VaultDocument,
	recordId: string,
	deletedAt: string,
): VaultDocument => ({
	...document,
	items: document.items.filter(({ id }) => id !== recordId),
	updatedAt: deletedAt > document.updatedAt ? deletedAt : document.updatedAt,
});

const requireMetadataForDocument = async (
	ownerUserId: string,
	document: VaultDocument,
	store: SyncMetadataStore,
): Promise<SyncMetadata> => {
	const metadata = await store.load(ownerUserId);
	if (!metadata) {
		throw new SyncClientError(
			"Encrypted sync is not enabled on this device.",
			"sync_not_enabled",
		);
	}
	if (metadata.vaultId !== document.id) {
		throw new SyncClientError(
			"The local vault does not match this account's sync vault.",
			"vault_mismatch",
		);
	}
	return metadata;
};

export interface SyncConflictSummary {
	recordId: string;
	remoteRevision: string;
	detectedAt: string;
	remoteKind: "login" | "tombstone";
	remoteLabel: string;
	localLabel: string;
}

const latestConflictPerRecord = (
	conflicts: SyncMetadata["conflicts"],
): ReadonlyArray<SyncMetadata["conflicts"][number]> => {
	const latest = new Map<string, SyncMetadata["conflicts"][number]>();
	for (const conflict of conflicts) {
		const current = latest.get(conflict.record.recordId);
		if (
			!current ||
			BigInt(conflict.record.revision) > BigInt(current.record.revision)
		) {
			latest.set(conflict.record.recordId, conflict);
		}
	}
	return [...latest.values()];
};

export const inspectSyncConflicts = async (input: {
	ownerUserId: string;
	vault: UnlockedVault;
	document: VaultDocument;
	store: SyncMetadataStore;
}): Promise<ReadonlyArray<SyncConflictSummary>> => {
	const metadata = await requireMetadataForDocument(
		input.ownerUserId,
		input.document,
		input.store,
	);
	const summaries: SyncConflictSummary[] = [];
	for (const conflict of latestConflictPerRecord(metadata.conflicts)) {
		if (conflict.record.vaultId !== metadata.vaultId) {
			throw new SyncClientError(
				"Stored conflict metadata belongs to a different vault.",
				"vault_mismatch",
			);
		}
		const plaintext = await input.vault.decryptSyncRecord(conflict.record);
		const local = localItem(input.document, conflict.record.recordId);
		summaries.push({
			recordId: conflict.record.recordId,
			remoteRevision: conflict.record.revision,
			detectedAt: conflict.detectedAt,
			remoteKind: plaintext.kind,
			remoteLabel:
				plaintext.kind === "login"
					? plaintext.item.title || "Untitled login"
					: "Deleted on another device",
			localLabel: local?.title || "Deleted on this device",
		});
	}
	return summaries;
};

export const resolveSyncConflict = async (input: {
	ownerUserId: string;
	vault: UnlockedVault;
	document: VaultDocument;
	recordId: string;
	remoteRevision: string;
	resolution: "keep-local" | "use-remote";
	store: SyncMetadataStore;
}): Promise<{
	document: VaultDocument;
	queued: boolean;
	conflicts: number;
}> => {
	const metadata = await requireMetadataForDocument(
		input.ownerUserId,
		input.document,
		input.store,
	);
	const recordConflicts = metadata.conflicts.filter(
		({ record }) => record.recordId === input.recordId,
	);
	const selected = latestConflictPerRecord(recordConflicts)[0];
	if (!selected) {
		throw new SyncClientError(
			"This sync conflict no longer exists.",
			"conflict_not_found",
		);
	}
	if (selected.record.revision !== input.remoteRevision) {
		throw new SyncClientError(
			"A newer remote revision exists for this conflict. Refresh and resolve the latest version.",
			"stale_conflict",
		);
	}
	if (selected.record.vaultId !== metadata.vaultId) {
		throw new SyncClientError(
			"Stored conflict metadata belongs to a different vault.",
			"vault_mismatch",
		);
	}
	// Authenticate the remote record before trusting its revision or removing
	// any pending local ciphertext.
	const remote = await input.vault.decryptSyncRecord(selected.record);
	const nextMetadata = structuredClone(metadata);
	nextMetadata.conflicts = nextMetadata.conflicts.filter(
		({ record }) => record.recordId !== input.recordId,
	);
	nextMetadata.outbox = nextMetadata.outbox.filter(
		({ mutation }) => mutation.record.recordId !== input.recordId,
	);
	nextMetadata.records[input.recordId] = {
		revision: selected.record.revision,
		localUpdatedAt: remote.kind === "login" ? remote.item.updatedAt : null,
		tombstoned: remote.kind === "tombstone",
	};

	if (input.resolution === "keep-local") {
		const revision = decimalBigInt(BigInt(selected.record.revision) + 1n);
		const local = localItem(input.document, input.recordId);
		const encrypted = local
			? await input.vault.encryptLoginForSync(local, revision)
			: await input.vault.encryptTombstoneForSync(
					input.recordId,
					new Date().toISOString(),
					revision,
				);
		nextMetadata.outbox.push({
			mutation: {
				mutationId: crypto.randomUUID(),
				baseRevision: selected.record.revision,
				record: encrypted,
			},
			localUpdatedAt: local?.updatedAt ?? null,
		});
		await input.store.save(input.ownerUserId, nextMetadata);
		return {
			document: input.document,
			queued: true,
			conflicts: nextMetadata.conflicts.length,
		};
	}

	const nextDocument =
		remote.kind === "login"
			? withItem(input.document, remote.item)
			: withoutItem(input.document, input.recordId, remote.deletedAt);
	await input.vault.seal(nextDocument);
	try {
		await input.store.save(input.ownerUserId, nextMetadata);
	} catch (cause) {
		// Cross-storage transactions do not exist. Roll the local envelope back so
		// a failed IndexedDB commit cannot make the stale outbox authoritative.
		try {
			await input.vault.seal(input.document);
		} catch (rollbackCause) {
			throw new SyncClientError(
				"Conflict metadata could not be saved and the local vault rollback failed.",
				"conflict_rollback_failed",
				undefined,
				{ cause, rollbackCause },
			);
		}
		throw cause;
	}
	return {
		document: nextDocument,
		queued: false,
		conflicts: nextMetadata.conflicts.length,
	};
};

const pullRemote = async (
	vault: UnlockedVault,
	document: VaultDocument,
	metadata: SyncMetadata,
	http: SyncHttpClient,
	store: SyncMetadataStore,
	ownerUserId: string,
): Promise<{
	document: VaultDocument;
	metadata: SyncMetadata;
	applied: number;
}> => {
	let nextDocument = document;
	let applied = 0;
	let hasMore = true;
	while (hasMore) {
		let page: SyncChangesResponse;
		try {
			page = await http.pull(metadata.vaultId, metadata.cursor);
		} catch (error) {
			if (
				error instanceof SyncClientError &&
				error.code === "cursor_reset_required" &&
				error.details?.resetCursor === "0" &&
				metadata.cursor !== "0"
			) {
				metadata.cursor = "0";
				await store.save(ownerUserId, metadata);
				continue;
			}
			throw error;
		}
		for (const change of page.changes) {
			if (change.record.vaultId !== metadata.vaultId) {
				throw new SyncClientError(
					"The sync server returned a record for a different vault.",
					"vault_mismatch",
				);
			}
			const recordId = change.record.recordId;
			const conflicts =
				pendingForRecord(metadata, recordId) ||
				hasLocalChange(nextDocument, metadata, recordId);
			if (conflicts) {
				if (
					!metadata.conflicts.some(
						({ record }) =>
							record.recordId === recordId &&
							record.revision === change.record.revision,
					)
				) {
					metadata.conflicts.push({
						record: change.record,
						detectedAt: new Date().toISOString(),
					});
				}
				continue;
			}
			const plaintext = await vault.decryptSyncRecord(change.record);
			if (plaintext.kind === "login") {
				nextDocument = withItem(nextDocument, plaintext.item);
				metadata.records[recordId] = {
					revision: change.record.revision,
					localUpdatedAt: plaintext.item.updatedAt,
					tombstoned: false,
				};
			} else {
				nextDocument = withoutItem(nextDocument, recordId, plaintext.deletedAt);
				metadata.records[recordId] = {
					revision: change.record.revision,
					localUpdatedAt: null,
					tombstoned: true,
				};
			}
			applied += 1;
		}
		metadata.cursor = page.nextCursor;
		hasMore = page.hasMore;
		await store.save(ownerUserId, metadata);
	}
	if (nextDocument !== document) await vault.seal(nextDocument);
	return { document: nextDocument, metadata, applied };
};

const enqueueLocalChanges = async (
	vault: UnlockedVault,
	document: VaultDocument,
	metadata: SyncMetadata,
): Promise<void> => {
	const queued = new Set(
		metadata.outbox.map(({ mutation }) => mutation.record.recordId),
	);
	for (const item of document.items) {
		if (queued.has(item.id)) continue;
		const state = metadata.records[item.id];
		if (state && !state.tombstoned && state.localUpdatedAt === item.updatedAt)
			continue;
		const base = BigInt(state?.revision ?? "0");
		const record = await vault.encryptLoginForSync(
			item,
			decimalBigInt(base + 1n),
		);
		metadata.outbox.push({
			mutation: {
				mutationId: crypto.randomUUID(),
				baseRevision: decimalBigInt(base, { allowZero: true }),
				record,
			},
			localUpdatedAt: item.updatedAt,
		});
	}
	for (const [recordId, state] of Object.entries(metadata.records)) {
		if (
			state.tombstoned ||
			queued.has(recordId) ||
			localItem(document, recordId)
		)
			continue;
		const base = BigInt(state.revision);
		const deletedAt = document.updatedAt;
		const record = await vault.encryptTombstoneForSync(
			recordId,
			deletedAt,
			decimalBigInt(base + 1n),
		);
		metadata.outbox.push({
			mutation: {
				mutationId: crypto.randomUUID(),
				baseRevision: decimalBigInt(base),
				record,
			},
			localUpdatedAt: null,
		});
	}
};

const drainOutbox = async (
	metadata: SyncMetadata,
	http: SyncHttpClient,
	store: SyncMetadataStore,
	ownerUserId: string,
): Promise<number> => {
	let pushed = 0;
	while (metadata.outbox.length > 0) {
		const pending = metadata.outbox[0] as PendingSyncMutation;
		await http.push(metadata.vaultId, pending.mutation);
		metadata.records[pending.mutation.record.recordId] = {
			revision: pending.mutation.record.revision,
			localUpdatedAt: pending.localUpdatedAt,
			tombstoned: pending.localUpdatedAt === null,
		};
		metadata.outbox.shift();
		pushed += 1;
		await store.save(ownerUserId, metadata);
	}
	return pushed;
};

export const enableEncryptedSync = async (input: {
	ownerUserId: string;
	vault: UnlockedVault;
	document: VaultDocument;
	masterPassword: string;
	store: SyncMetadataStore;
	http?: SyncHttpClient;
}): Promise<SyncMetadata> => {
	const http = input.http ?? browserSyncHttpClient;
	const existingMetadata = await input.store.load(input.ownerUserId);
	if (existingMetadata) return existingMetadata;
	const remote = await http.getVault();
	if (remote) {
		throw new SyncClientError(
			"This account already has an encrypted vault. Restore it in a browser without a local vault.",
			"remote_vault_exists",
			409,
		);
	}
	const converted = await input.vault.prepareInitialSync(input.masterPassword);
	const created = await http.createVault(converted.keyEnvelope);
	if (!sameKeyEnvelope(created.keyEnvelope, converted.keyEnvelope)) {
		throw new SyncClientError(
			"The sync server returned a different vault key envelope.",
			"vault_mismatch",
		);
	}
	const metadata = emptyMetadata(created.keyEnvelope.vaultId);
	for (const record of converted.records) {
		const item = input.document.items.find(({ id }) => id === record.recordId);
		metadata.outbox.push({
			mutation: {
				mutationId: crypto.randomUUID(),
				baseRevision: decimalBigInt(0n, { allowZero: true }),
				record,
			},
			localUpdatedAt: item?.updatedAt ?? null,
		});
	}
	await input.store.save(input.ownerUserId, metadata);
	await drainOutbox(metadata, http, input.store, input.ownerUserId);
	return metadata;
};

export const syncNow = async (input: {
	ownerUserId: string;
	vault: UnlockedVault;
	document: VaultDocument;
	store: SyncMetadataStore;
	http?: SyncHttpClient;
}): Promise<{
	document: VaultDocument;
	pulled: number;
	pushed: number;
	conflicts: number;
}> => {
	const http = input.http ?? browserSyncHttpClient;
	const metadata = await input.store.load(input.ownerUserId);
	if (!metadata)
		throw new SyncClientError(
			"Encrypted sync is not enabled on this device.",
			"sync_not_enabled",
		);
	if (metadata.vaultId !== input.document.id) {
		throw new SyncClientError(
			"The local vault does not match this account's sync vault.",
			"vault_mismatch",
		);
	}
	if (metadata.conflicts.length > 0) {
		return {
			document: input.document,
			pulled: 0,
			pushed: 0,
			conflicts: metadata.conflicts.length,
		};
	}
	let replayed = 0;
	if (metadata.outbox.length > 0) {
		try {
			replayed = await drainOutbox(
				metadata,
				http,
				input.store,
				input.ownerUserId,
			);
		} catch (error) {
			if (
				!(error instanceof SyncClientError) ||
				error.code !== "revision_conflict"
			) {
				throw error;
			}
			const conflicted = await pullRemote(
				input.vault,
				input.document,
				metadata,
				http,
				input.store,
				input.ownerUserId,
			);
			return {
				document: conflicted.document,
				pulled: conflicted.applied,
				pushed: 0,
				conflicts: metadata.conflicts.length,
			};
		}
	}
	const firstPull = await pullRemote(
		input.vault,
		input.document,
		metadata,
		http,
		input.store,
		input.ownerUserId,
	);
	if (metadata.conflicts.length > 0) {
		return {
			document: firstPull.document,
			pulled: firstPull.applied,
			pushed: 0,
			conflicts: metadata.conflicts.length,
		};
	}
	await enqueueLocalChanges(input.vault, firstPull.document, metadata);
	await input.store.save(input.ownerUserId, metadata);
	const pushed =
		replayed +
		(await drainOutbox(metadata, http, input.store, input.ownerUserId));
	const secondPull = await pullRemote(
		input.vault,
		firstPull.document,
		metadata,
		http,
		input.store,
		input.ownerUserId,
	);
	return {
		document: secondPull.document,
		pulled: firstPull.applied + secondPull.applied,
		pushed,
		conflicts: metadata.conflicts.length,
	};
};

export const fetchRemoteVaultForRestore = async (
	http: SyncHttpClient = browserSyncHttpClient,
): Promise<{
	keyEnvelope: VaultKeyEnvelopeV2;
	records: EncryptedRecordEnvelopeV2[];
	cursor: string;
}> => {
	const keyEnvelope = await http.getVault();
	if (!keyEnvelope)
		throw new SyncClientError(
			"No encrypted sync vault exists for this account.",
			"vault_not_found",
			404,
		);
	const records: EncryptedRecordEnvelopeV2[] = [];
	let cursor = "0";
	let hasMore = true;
	while (hasMore) {
		const page = await http.pull(keyEnvelope.vaultId, cursor);
		records.push(...page.changes.map(({ record }) => record));
		cursor = page.nextCursor;
		hasMore = page.hasMore;
	}
	return { keyEnvelope, records, cursor };
};

export const metadataForRestoredVault = (
	records: ReadonlyArray<EncryptedRecordEnvelopeV2>,
	cursor: string,
	document: VaultDocument,
): SyncMetadata => ({
	...emptyMetadata(document.id),
	cursor,
	records: Object.fromEntries(
		records.map((record) => {
			const item = document.items.find(({ id }) => id === record.recordId);
			return [
				record.recordId,
				{
					revision: record.revision,
					localUpdatedAt: item?.updatedAt ?? null,
					tombstoned: item === undefined,
				},
			];
		}),
	),
});
