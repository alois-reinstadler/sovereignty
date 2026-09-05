import { Banner, Button, TextInput } from "@astryxdesign/core";
import { useCallback, useEffect, useState } from "react";
import { getAuthClient } from "#/lib/auth-client";
import type { UnlockedVault, VaultDocument } from "#/lib/models";
import {
	enableEncryptedSync,
	inspectSyncConflicts,
	resolveSyncConflict,
	type SyncConflictSummary,
	syncNow,
} from "#/lib/sync-client";
import {
	indexedDbSyncMetadataStore,
	type SyncMetadata,
} from "#/lib/sync-metadata";

interface SyncControlsProps {
	vault: UnlockedVault;
	document: VaultDocument;
	disabled: boolean;
	onDocument: (document: VaultDocument) => void;
	onWorkingChange: (working: boolean) => void;
}

export function SyncControls({
	vault,
	document,
	disabled,
	onDocument,
	onWorkingChange,
}: SyncControlsProps) {
	const session = getAuthClient().useSession();
	const [metadata, setMetadata] = useState<SyncMetadata | null>(null);
	const [password, setPassword] = useState("");
	const [showEnable, setShowEnable] = useState(false);
	const [working, setWorking] = useState<string | null>(null);
	const [conflicts, setConflicts] = useState<
		ReadonlyArray<SyncConflictSummary>
	>([]);
	const [confirmRemote, setConfirmRemote] = useState<string | null>(null);
	const [message, setMessage] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	const refresh = useCallback(async () => {
		const userId = session.data?.user.id;
		if (!userId) {
			setMetadata(null);
			setConflicts([]);
			return;
		}
		try {
			const next = await indexedDbSyncMetadataStore.load(userId);
			setMetadata(next);
			setConflicts(
				next?.conflicts.length
					? await inspectSyncConflicts({
							ownerUserId: userId,
							vault,
							document,
							store: indexedDbSyncMetadataStore,
						})
					: [],
			);
		} catch {
			setError(
				"Sync metadata or an encrypted conflict could not be read on this device.",
			);
		}
	}, [document, session.data?.user.id, vault]);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	if (session.isPending) {
		return <p className="sync-caption">Checking sync account…</p>;
	}
	const authenticated = session.data;
	if (!authenticated) {
		return (
			<div className="sync-controls">
				<strong>Encrypted sync</strong>
				<span className="sync-caption">Sign in before enabling sync.</span>
				<a className="account-link" href="/account">
					Sign in
				</a>
			</div>
		);
	}

	const enable = async () => {
		if (!password || working) return;
		setWorking("enable");
		onWorkingChange(true);
		setError(null);
		setMessage(null);
		try {
			const next = await enableEncryptedSync({
				ownerUserId: authenticated.user.id,
				vault,
				document,
				masterPassword: password,
				store: indexedDbSyncMetadataStore,
			});
			setMetadata(next);
			setShowEnable(false);
			setMessage("Encrypted sync is enabled on this device.");
		} catch (cause) {
			setError(
				cause instanceof Error ? cause.message : "Sync could not be enabled.",
			);
			await refresh();
		} finally {
			setPassword("");
			setWorking(null);
			onWorkingChange(false);
		}
	};

	const synchronize = async () => {
		if (working) return;
		setWorking("sync");
		onWorkingChange(true);
		setError(null);
		setMessage(null);
		try {
			const result = await syncNow({
				ownerUserId: authenticated.user.id,
				vault,
				document,
				store: indexedDbSyncMetadataStore,
			});
			onDocument(result.document);
			await refresh();
			setMessage(
				result.conflicts > 0
					? `${result.conflicts} conflict${result.conflicts === 1 ? "" : "s"} need attention. No local change was discarded.`
					: `Sync complete: ${result.pushed} uploaded, ${result.pulled} downloaded.`,
			);
		} catch (cause) {
			setError(
				cause instanceof Error
					? `${cause.message} Encrypted pending changes remain queued for retry.`
					: "Sync failed. Encrypted pending changes remain queued for retry.",
			);
			await refresh();
		} finally {
			setWorking(null);
			onWorkingChange(false);
		}
	};

	const resolveConflict = async (
		conflict: SyncConflictSummary,
		resolution: "keep-local" | "use-remote",
	) => {
		if (working) return;
		const operation = `${resolution}:${conflict.recordId}:${conflict.remoteRevision}`;
		setWorking(operation);
		onWorkingChange(true);
		setError(null);
		setMessage(null);
		try {
			const result = await resolveSyncConflict({
				ownerUserId: authenticated.user.id,
				vault,
				document,
				recordId: conflict.recordId,
				remoteRevision: conflict.remoteRevision,
				resolution,
				store: indexedDbSyncMetadataStore,
			});
			onDocument(result.document);
			setConfirmRemote(null);
			await refresh();
			setMessage(
				resolution === "keep-local"
					? "The local version is encrypted and queued on top of the remote revision. Select Sync now to upload it."
					: "The remote version replaced the local candidate on this device.",
			);
		} catch (cause) {
			setError(
				cause instanceof Error
					? cause.message
					: "The conflict could not be resolved. No pending change was discarded.",
			);
			await refresh();
		} finally {
			setWorking(null);
			onWorkingChange(false);
		}
	};

	return (
		<div className="sync-controls">
			<div className="sync-heading">
				<strong>Encrypted sync</strong>
				<span className={metadata ? "sync-state enabled" : "sync-state"}>
					{metadata ? "Enabled" : "Off"}
				</span>
			</div>
			<span className="sync-caption">Account: {authenticated.user.email}</span>
			{metadata ? (
				<>
					<Button
						label="Sync now"
						variant="secondary"
						size="sm"
						width="100%"
						onClick={() => void synchronize()}
						isLoading={working === "sync"}
						isDisabled={disabled || working !== null}
					/>
					<span className="sync-caption">
						{metadata.outbox.length} queued · {metadata.conflicts.length}{" "}
						conflicts
					</span>
					{conflicts.length > 0 ? (
						<ul className="sync-conflict-list" aria-label="Sync conflicts">
							{conflicts.map((conflict) => {
								const key = `${conflict.recordId}:${conflict.remoteRevision}`;
								return (
									<li className="sync-conflict" key={key}>
										<strong>Conflict: {conflict.localLabel}</strong>
										<span className="sync-caption">
											This device: {conflict.localLabel}
											<br />
											Other device: {conflict.remoteLabel}
											<br />
											Remote revision {conflict.remoteRevision}
										</span>
										<Button
											label="Keep local (overwrite remote)"
											variant="secondary"
											size="sm"
											width="100%"
											onClick={() =>
												void resolveConflict(conflict, "keep-local")
											}
											isLoading={working === `keep-local:${key}`}
											isDisabled={disabled || working !== null}
										/>
										{confirmRemote === key ? (
											<div className="sync-conflict-confirm">
												<span className="sync-caption">
													This permanently replaces the pending local version.
												</span>
												<div className="sync-actions">
													<Button
														label="Cancel"
														variant="ghost"
														size="sm"
														onClick={() => setConfirmRemote(null)}
													/>
													<Button
														label={
															conflict.remoteKind === "tombstone"
																? "Confirm remote deletion"
																: "Confirm replace local"
														}
														variant="destructive"
														size="sm"
														onClick={() =>
															void resolveConflict(conflict, "use-remote")
														}
														isLoading={working === `use-remote:${key}`}
														isDisabled={disabled || working !== null}
													/>
												</div>
											</div>
										) : (
											<Button
												label={
													conflict.remoteKind === "tombstone"
														? "Use remote deletion…"
														: "Use remote (replace local)…"
												}
												variant="destructive"
												size="sm"
												width="100%"
												onClick={() => setConfirmRemote(key)}
												isDisabled={disabled || working !== null}
											/>
										)}
									</li>
								);
							})}
						</ul>
					) : null}
				</>
			) : showEnable ? (
				<>
					<TextInput
						label="Master password"
						type="password"
						htmlName="sync-master-password"
						value={password}
						onChange={setPassword}
						width="100%"
					/>
					<span className="sync-caption">
						Used once to wrap the vault key locally. It is never sent or saved.
					</span>
					<div className="sync-actions">
						<Button
							label="Cancel"
							variant="ghost"
							size="sm"
							onClick={() => {
								setPassword("");
								setShowEnable(false);
							}}
						/>
						<Button
							label="Enable sync"
							variant="primary"
							size="sm"
							onClick={() => void enable()}
							isLoading={working === "enable"}
							isDisabled={!password || disabled || working !== null}
						/>
					</div>
				</>
			) : (
				<Button
					label="Enable sync"
					variant="secondary"
					size="sm"
					width="100%"
					onClick={() => setShowEnable(true)}
					isDisabled={disabled}
				/>
			)}
			{error ? (
				<Banner status="error" title="Sync error" description={error} />
			) : null}
			{message ? (
				<Banner status="info" title="Sync status" description={message} />
			) : null}
		</div>
	);
}
