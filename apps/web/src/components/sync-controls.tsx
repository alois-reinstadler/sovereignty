import { Banner, Button, TextInput } from "@astryxdesign/core";
import { useCallback, useEffect, useState } from "react";
import { authClient } from "#/lib/auth-client";
import type { UnlockedVault, VaultDocument } from "#/lib/models";
import { enableEncryptedSync, syncNow } from "#/lib/sync-client";
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
	const session = authClient.useSession();
	const [metadata, setMetadata] = useState<SyncMetadata | null>(null);
	const [password, setPassword] = useState("");
	const [showEnable, setShowEnable] = useState(false);
	const [working, setWorking] = useState<"enable" | "sync" | null>(null);
	const [message, setMessage] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	const refresh = useCallback(async () => {
		const userId = session.data?.user.id;
		if (!userId) {
			setMetadata(null);
			return;
		}
		try {
			setMetadata(await indexedDbSyncMetadataStore.load(userId));
		} catch {
			setError("Sync metadata could not be read from this browser.");
		}
	}, [session.data?.user.id]);

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
