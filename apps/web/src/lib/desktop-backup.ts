import { IS_DESKTOP } from "./client-platform";
import { parseEncryptedVaultBackup } from "./vault-adapter";

export async function saveDesktopBackup(serialized: string): Promise<boolean> {
	if (!IS_DESKTOP)
		throw new Error("Native backup is unavailable in the web client.");
	parseEncryptedVaultBackup(serialized);
	const { invoke, isTauri } = await import("@tauri-apps/api/core");
	if (!isTauri())
		throw new Error("Native backups require the desktop application.");
	const result: unknown = await invoke("desktop_export_backup", { serialized });
	if (typeof result !== "boolean")
		throw new Error("Unexpected native backup result.");
	return result;
}

export async function openDesktopBackup(): Promise<string | null> {
	if (!IS_DESKTOP)
		throw new Error("Native backup is unavailable in the web client.");
	const { invoke, isTauri } = await import("@tauri-apps/api/core");
	if (!isTauri())
		throw new Error("Native backups require the desktop application.");
	const result: unknown = await invoke("desktop_import_backup");
	if (result === null) return null;
	if (typeof result !== "string")
		throw new Error("Unexpected native backup result.");
	parseEncryptedVaultBackup(result);
	return result;
}
