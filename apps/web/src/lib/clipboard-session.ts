/** Browser clipboard access remains best-effort and tied to the issuing unlock. */
export async function copyForLiveSession(
	value: string,
	clipboard: Pick<Clipboard, "readText" | "writeText">,
	isLive: () => boolean,
	register: () => void = () => {},
): Promise<"copied" | "revoked" | "blocked"> {
	if (!isLive()) return "revoked";
	try {
		await clipboard.writeText(value);
		if (isLive()) {
			// Register in the same microtask as the live check, so a lock queued
			// before our caller resumes can find and revoke the clipboard entry.
			register();
			return "copied";
		}
		try {
			if ((await clipboard.readText()) === value) await clipboard.writeText("");
		} catch {
			/* OS/browser may deny clearing; never retain a new clipboard entry. */
		}
		return "revoked";
	} catch {
		return "blocked";
	}
}
