import { StartClient } from "@tanstack/react-start/client";
import { StrictMode, startTransition } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { IS_DESKTOP } from "./lib/client-platform";

startTransition(() => {
	const app = (
		<StrictMode>
			<StartClient />
		</StrictMode>
	);
	if (IS_DESKTOP) {
		// Tauri injects its IPC/CSP bootstrap into the packaged HTML. Mount the
		// local client instead of hydrating that modified static document.
		createRoot(document).render(app);
	} else {
		hydrateRoot(document, app);
	}
});
