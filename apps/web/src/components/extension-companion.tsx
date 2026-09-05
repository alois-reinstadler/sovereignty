import { Button, Card } from "@astryxdesign/core";
import { useEffect, useRef, useState } from "react";
import {
	attachCompanion,
	type CompanionState,
	companionRuntime,
	type PairingLink,
	parsePairingLink,
} from "#/lib/extension-companion";
import type { VaultItem } from "#/lib/models";

export function ExtensionCompanion({
	readItems,
}: {
	readItems: () => ReadonlyArray<VaultItem> | null;
}) {
	const [pairing, setPairing] = useState<PairingLink | null>(null);
	const [state, setState] = useState<CompanionState>("disconnected");
	const [dismissed, setDismissed] = useState(false);
	const stop = useRef<(() => void) | null>(null);
	const currentRead = useRef(readItems);
	currentRead.current = readItems;
	useEffect(() => {
		if (window.top !== window) return;
		const request = parsePairingLink(window.location.hash);
		if (request) {
			setPairing(request);
			// Pairing capability never enters server requests or persisted settings.
			history.replaceState(
				history.state,
				"",
				window.location.pathname + window.location.search,
			);
		}
		return () => {
			stop.current?.();
		};
	}, []);
	if (!pairing || dismissed) return null;
	const connect = () => {
		const runtime = companionRuntime();
		if (!runtime || !currentRead.current()) {
			setState("error");
			return;
		}
		stop.current?.();
		try {
			const port = runtime.connect(pairing.extensionId, {
				name: "svrgn-companion-v1",
			});
			stop.current = attachCompanion(
				port,
				pairing.token,
				() => currentRead.current(),
				setState,
			);
			setPairing({ ...pairing, token: "" });
		} catch {
			setState("error");
		}
	};
	return (
		<section className="companion-overlay" aria-label="Extension pairing">
			<Card padding={5} className="companion-card">
				<span className="eyebrow">SOVEREIGNTY EXTENSION</span>
				<h2>
					{state === "connected"
						? "Extension connected"
						: "Approve this extension"}
				</h2>
				<p>
					Only approve a pairing you started from your installed Sovereignty
					extension. Compare its ID in Chrome’s extension settings.
				</p>
				<code className="companion-id">{pairing.extensionId}</code>
				<p>
					For up to five minutes, the extension can list accounts for the active
					site and fill a selected login after you click Fill. Keep this vault
					tab open. Locking or leaving the vault revokes the connection.
				</p>
				<p className="preview-label">
					DEVELOPMENT PREVIEW · USE SYNTHETIC CREDENTIALS ONLY
				</p>
				<output>
					{state === "connected"
						? "Connected. Return to the login site and open the extension."
						: state === "connecting"
							? "Connecting…"
							: state === "error"
								? "Connection rejected. Start pairing again from the extension."
								: state === "expired"
									? "Connection expired. Pair again from the extension."
									: "Disconnected"}
				</output>
				<div className="companion-actions">
					{pairing.token ? (
						<Button
							label="Approve connection"
							variant="primary"
							onClick={connect}
						/>
					) : null}
					<Button
						label={state === "connected" ? "Disconnect extension" : "Dismiss"}
						variant="ghost"
						onClick={() => {
							stop.current?.();
							setPairing(null);
							setDismissed(true);
						}}
					/>
				</div>
			</Card>
		</section>
	);
}
