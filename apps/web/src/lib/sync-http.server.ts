import {
	DEFAULT_SYNC_PAGE_SIZE,
	MAX_SYNC_PAGE_SIZE,
	MAX_SYNC_REQUEST_BYTES,
	ProtocolValidationError,
	parseDecimalBigInt,
	parseSyncChangesResponse,
	parseSyncMutationBatchRequest,
	parseVaultKeyEnvelopeV2,
} from "@svrgn/sync-protocol";

import {
	SyncCursorAheadError,
	SyncCursorExhaustedError,
	SyncMutationIdReusedError,
	SyncRevisionConflictError,
	type SyncStore,
	SyncVaultAlreadyExistsError,
} from "./sync-store.server";

const NO_STORE_HEADERS = { "cache-control": "no-store" } as const;
const JSON_HEADERS = {
	...NO_STORE_HEADERS,
	"content-type": "application/json; charset=utf-8",
} as const;

export interface SyncHttpDependencies {
	readonly authenticate: (headers: Headers) => Promise<string | null>;
	readonly store: SyncStore;
}

class PayloadTooLargeError extends Error {}

const json = (body: unknown, status = 200): Response =>
	new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

const errorResponse = (
	status: number,
	code: string,
	message: string,
	extras: Record<string, unknown> = {},
): Response => json({ error: code, message, ...extras }, status);

const parseVaultId = (url: URL): string => {
	const vaultId = url.searchParams.get("vaultId");
	if (
		vaultId === null ||
		vaultId.length === 0 ||
		new TextEncoder().encode(vaultId).length > 128
	) {
		throw new ProtocolValidationError(
			"vaultId must be a non-empty string of at most 128 UTF-8 bytes",
		);
	}
	return vaultId;
};

const parsePageLimit = (url: URL): number => {
	const value = url.searchParams.get("limit");
	if (value === null) return DEFAULT_SYNC_PAGE_SIZE;
	if (!/^[1-9][0-9]*$/.test(value)) {
		throw new ProtocolValidationError("limit must be a positive integer");
	}
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed) || parsed > MAX_SYNC_PAGE_SIZE) {
		throw new ProtocolValidationError(
			`limit must be at most ${MAX_SYNC_PAGE_SIZE}`,
		);
	}
	return parsed;
};

const readBoundedJson = async (request: Request): Promise<unknown> => {
	if (
		!request.headers
			.get("content-type")
			?.toLowerCase()
			.startsWith("application/json")
	) {
		throw new TypeError("Content-Type must be application/json");
	}
	const contentLength = request.headers.get("content-length");
	if (contentLength !== null) {
		const parsed = Number(contentLength);
		if (!Number.isSafeInteger(parsed) || parsed < 0) {
			throw new TypeError("Content-Length is invalid");
		}
		if (parsed > MAX_SYNC_REQUEST_BYTES) throw new PayloadTooLargeError();
	}
	if (!request.body) throw new TypeError("A JSON request body is required");

	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			total += value.byteLength;
			if (total > MAX_SYNC_REQUEST_BYTES) {
				await reader.cancel();
				throw new PayloadTooLargeError();
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}

	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	return JSON.parse(text) as unknown;
};

const authenticate = async (
	request: Request,
	dependencies: SyncHttpDependencies,
): Promise<string | Response> => {
	const userId = await dependencies.authenticate(request.headers);
	return (
		userId ??
		errorResponse(401, "authentication_required", "Authentication is required")
	);
};

export const createSyncHttpHandlers = (dependencies: SyncHttpDependencies) => ({
	async getVault(request: Request): Promise<Response> {
		try {
			const ownerUserId = await authenticate(request, dependencies);
			if (ownerUserId instanceof Response) return ownerUserId;
			const keyEnvelope = await dependencies.store.getVault({ ownerUserId });
			if (keyEnvelope === null) {
				return errorResponse(404, "vault_not_found", "Vault not found");
			}
			return json({ keyEnvelope: parseVaultKeyEnvelopeV2(keyEnvelope) });
		} catch (error) {
			if (error instanceof ProtocolValidationError) {
				return errorResponse(
					500,
					"invalid_stored_vault",
					"The stored vault is invalid",
				);
			}
			return errorResponse(500, "internal_error", "The sync request failed");
		}
	},

	async createVault(request: Request): Promise<Response> {
		try {
			const ownerUserId = await authenticate(request, dependencies);
			if (ownerUserId instanceof Response) return ownerUserId;
			const body = await readBoundedJson(request);
			if (
				typeof body !== "object" ||
				body === null ||
				Array.isArray(body) ||
				Object.keys(body).length !== 1 ||
				!("keyEnvelope" in body)
			) {
				throw new ProtocolValidationError(
					"The request must contain only keyEnvelope",
				);
			}
			const keyEnvelope = parseVaultKeyEnvelopeV2(body.keyEnvelope);
			const result = await dependencies.store.createVault({
				ownerUserId,
				keyEnvelope,
			});
			return json(result, result.status === "created" ? 201 : 200);
		} catch (error) {
			if (error instanceof PayloadTooLargeError) {
				return errorResponse(
					413,
					"payload_too_large",
					`The request body must not exceed ${MAX_SYNC_REQUEST_BYTES} bytes`,
				);
			}
			if (error instanceof SyncVaultAlreadyExistsError) {
				return errorResponse(409, "vault_already_exists", error.message);
			}
			if (
				error instanceof ProtocolValidationError ||
				error instanceof SyntaxError ||
				error instanceof TypeError
			) {
				return errorResponse(400, "invalid_request", error.message);
			}
			return errorResponse(500, "internal_error", "The sync request failed");
		}
	},

	async pull(request: Request): Promise<Response> {
		try {
			const ownerUserId = await authenticate(request, dependencies);
			if (ownerUserId instanceof Response) return ownerUserId;
			const url = new URL(request.url);
			const vaultId = parseVaultId(url);
			const afterCursor = parseDecimalBigInt(
				url.searchParams.get("cursor") ?? "0",
				{ allowZero: true, label: "cursor" },
			);
			const limit = parsePageLimit(url);
			const result = await dependencies.store.pullChanges({
				ownerUserId,
				vaultId,
				afterCursor,
				limit,
			});
			if (result === null) {
				return errorResponse(404, "vault_not_found", "Vault not found");
			}
			return json(parseSyncChangesResponse(result));
		} catch (error) {
			if (error instanceof SyncCursorAheadError) {
				return errorResponse(409, "cursor_reset_required", error.message, {
					currentCursor: error.currentCursor,
					resetCursor: "0",
				});
			}
			if (error instanceof ProtocolValidationError) {
				return errorResponse(400, "invalid_request", error.message);
			}
			return errorResponse(500, "internal_error", "The sync request failed");
		}
	},

	async push(request: Request): Promise<Response> {
		try {
			const ownerUserId = await authenticate(request, dependencies);
			if (ownerUserId instanceof Response) return ownerUserId;
			const vaultId = parseVaultId(new URL(request.url));
			const batch = parseSyncMutationBatchRequest(
				await readBoundedJson(request),
			);
			for (const mutation of batch.mutations) {
				if (mutation.record.vaultId !== vaultId) {
					throw new ProtocolValidationError(
						"Every record vaultId must match the requested vaultId",
					);
				}
			}
			const result = await dependencies.store.pushMutations({
				ownerUserId,
				vaultId,
				mutations: batch.mutations,
			});
			if (result === null) {
				return errorResponse(404, "vault_not_found", "Vault not found");
			}
			return json(result);
		} catch (error) {
			if (error instanceof PayloadTooLargeError) {
				return errorResponse(
					413,
					"payload_too_large",
					`The request body must not exceed ${MAX_SYNC_REQUEST_BYTES} bytes`,
				);
			}
			if (error instanceof SyncRevisionConflictError) {
				return errorResponse(409, "revision_conflict", error.message, {
					mutationId: error.mutationId,
					recordId: error.recordId,
					expectedBaseRevision: error.expectedBaseRevision,
					currentRevision: error.currentRevision,
				});
			}
			if (error instanceof SyncMutationIdReusedError) {
				return errorResponse(409, "mutation_id_reused", error.message, {
					mutationId: error.mutationId,
				});
			}
			if (error instanceof SyncCursorExhaustedError) {
				return errorResponse(
					507,
					"cursor_exhausted",
					"The vault cannot accept additional mutations",
				);
			}
			if (
				error instanceof ProtocolValidationError ||
				error instanceof SyntaxError ||
				error instanceof TypeError
			) {
				return errorResponse(400, "invalid_request", error.message);
			}
			return errorResponse(500, "internal_error", "The sync request failed");
		}
	},
});
