import { IS_DESKTOP } from "./client-platform";
/** Only acknowledgement of a native-requested close; no file/key/network access. */
export async function completeDesktopClose(): Promise<void> {
	if (!IS_DESKTOP)
		throw new Error("Native close is unavailable in the web client.");
	const { invoke } = await import("@tauri-apps/api/core");
	await invoke("desktop_close_ready");
}
