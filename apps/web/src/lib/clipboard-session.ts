/** Browser clipboard access remains best-effort and tied to the issuing unlock. */
export async function copyForLiveSession(
	value: string,
	clipboard: Pick<Clipboard, "readText" | "writeText">,
	isLive: () => boolean,
): Promise<"copied" | "revoked" | "blocked"> {
	if (!isLive()) return "revoked";
	try {
		await clipboard.writeText(value);
		if (isLive()) return "copied";
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
