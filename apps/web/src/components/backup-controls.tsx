import { Banner, Button, Card } from "@astryxdesign/core";
import { useRef, useState } from "react";
import { IS_DESKTOP } from "#/lib/client-platform";
import { openDesktopBackup, saveDesktopBackup } from "#/lib/desktop-backup";

import {
	exportLocalVaultBackup,
	importLocalVaultBackup,
	parseEncryptedVaultBackup,
	VAULT_BACKUP_MAX_BYTES,
} from "#/lib/vault-adapter";

type BackupControlsProps = {
	hasExistingVault: boolean;
	isDisabled?: boolean;
	requiresLock?: boolean;
	onImported: () => Promise<void> | void;
};

export function BackupControls({
	hasExistingVault,
	isDisabled = false,
	requiresLock = false,
	onImported,
}: BackupControlsProps) {
	const inputRef = useRef<HTMLInputElement>(null);
	const [pendingImport, setPendingImport] = useState<string | null>(null);
	const [isWorking, setIsWorking] = useState(false);
	const [message, setMessage] = useState<{
		type: "error" | "success";
		text: string;
	} | null>(null);
	if (requiresLock)
		return (
			<p className="backup-lock-notice">
				Lock the vault to import or export encrypted backups.
			</p>
		);

	const finishImport = async (
		serialized: string,
		overwriteExisting: boolean,
	) => {
		setIsWorking(true);
		setMessage(null);
		try {
			importLocalVaultBackup(serialized, { overwriteExisting });
			setPendingImport(null);
			setMessage({
				type: "success",
				text: "Encrypted backup imported. Unlock it with its master password.",
			});
			await onImported();
		} catch (cause) {
			setMessage({
				type: "error",
				text:
					cause instanceof Error
						? cause.message
						: "The encrypted backup could not be imported.",
			});
		} finally {
			setIsWorking(false);
		}
	};

	const selectBackup = async (file: File | undefined) => {
		if (!file) return;
		setMessage(null);
		if (file.size > VAULT_BACKUP_MAX_BYTES) {
			setMessage({
				type: "error",
				text: "The selected backup is larger than 10 MB and was not imported.",
			});
			return;
		}
		setIsWorking(true);
		try {
			const serialized = await file.text();
			parseEncryptedVaultBackup(serialized);
			if (hasExistingVault) setPendingImport(serialized);
			else await finishImport(serialized, false);
		} catch (cause) {
			setMessage({
				type: "error",
				text:
					cause instanceof Error
						? cause.message
						: "The selected backup could not be read.",
			});
		} finally {
			setIsWorking(false);
			if (inputRef.current) inputRef.current.value = "";
		}
	};

	const selectNativeBackup = async () => {
		setMessage(null);
		setIsWorking(true);
		try {
			const serialized = await openDesktopBackup();
			if (serialized === null) return;
			if (hasExistingVault) setPendingImport(serialized);
			else await finishImport(serialized, false);
		} catch (cause) {
			setMessage({
				type: "error",
				text:
					cause instanceof Error
						? cause.message
						: "The selected encrypted backup could not be read.",
			});
		} finally {
			setIsWorking(false);
		}
	};

	const downloadBackup = async () => {
		setMessage(null);
		setIsWorking(true);
		let objectUrl: string | null = null;
		try {
			const backup = exportLocalVaultBackup();
			if (IS_DESKTOP) {
				if (await saveDesktopBackup(backup.serialized))
					setMessage({ type: "success", text: "Encrypted backup saved." });
				return;
			}
			const blob = new Blob([backup.serialized], {
				type: "application/json;charset=utf-8",
			});
			objectUrl = URL.createObjectURL(blob);
			const anchor = document.createElement("a");
			anchor.href = objectUrl;
			anchor.download = backup.filename;
			anchor.hidden = true;
			document.body.append(anchor);
			anchor.click();
			anchor.remove();
			setMessage({
				type: "success",
				text: "Encrypted backup download started.",
			});
		} catch (cause) {
			setMessage({
				type: "error",
				text:
					cause instanceof Error
						? cause.message
						: "The encrypted backup could not be downloaded.",
			});
		} finally {
			if (objectUrl) URL.revokeObjectURL(objectUrl);
			setIsWorking(false);
		}
	};

	return (
		<div className="backup-controls">
			<div className="backup-actions">
				{hasExistingVault ? (
					<Button
						label="Export backup"
						variant="secondary"
						size="sm"
						onClick={downloadBackup}
						isDisabled={isDisabled || isWorking}
					/>
				) : null}
				<Button
					label="Import backup"
					variant="ghost"
					size="sm"
					onClick={() =>
						IS_DESKTOP ? void selectNativeBackup() : inputRef.current?.click()
					}
					isDisabled={isDisabled || isWorking}
				/>
			</div>
			<input
				ref={inputRef}
				id="encrypted-vault-backup"
				name="encrypted-vault-backup"
				type="file"
				accept=".svrgn,application/json"
				className="visually-hidden-field"
				aria-label="Choose encrypted Sovereignty backup"
				onChange={(event) => void selectBackup(event.target.files?.[0])}
			/>
			{message ? (
				<Banner
					status={message.type}
					title={message.type === "error" ? "Backup failed" : "Backup ready"}
					description={message.text}
				/>
			) : null}

			{pendingImport ? (
				<div className="modal-backdrop" role="presentation">
					<Card
						className="confirm-modal"
						padding={5}
						elevation="high"
						role="alertdialog"
						aria-modal="true"
						aria-labelledby="replace-vault-title"
					>
						<div className="danger-icon">!</div>
						<h2 id="replace-vault-title">Replace this local vault?</h2>
						<p>
							The imported encrypted vault will replace the current encrypted
							vault on this device. Export the current vault first if you need
							it.
						</p>
						<div className="form-actions">
							<Button
								label="Cancel"
								variant="ghost"
								onClick={() => setPendingImport(null)}
								isDisabled={isWorking}
							/>
							<Button
								label="Replace and lock"
								variant="destructive"
								onClick={() => void finishImport(pendingImport, true)}
								isLoading={isWorking}
							/>
						</div>
					</Card>
				</div>
			) : null}
		</div>
	);
}
