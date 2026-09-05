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
import {
	type SubmissionPersist,
	type SubmissionReviewView,
	SubmittedLoginReviews,
} from "#/lib/submitted-login-review";

export function ExtensionCompanion({
	readItems,
	persist,
}: {
	readItems: () => ReadonlyArray<VaultItem> | null;
	persist: SubmissionPersist;
}) {
	const [pairing, setPairing] = useState<PairingLink | null>(null);
	const [state, setState] = useState<CompanionState>("disconnected");
	const [dismissed, setDismissed] = useState(false);
	const stop = useRef<(() => void) | null>(null);
	const currentRead = useRef(readItems);
	const currentPersist = useRef(persist);
	currentPersist.current = persist;
	const [review, setReview] = useState<SubmissionReviewView | null>(null);
	const [reviewTarget, setReviewTarget] = useState("");
	const [reviewNotice, setReviewNotice] = useState("");
	const [saving, setSaving] = useState(false);
	const reviews = useRef<SubmittedLoginReviews | null>(null);
	if (!reviews.current)
		reviews.current = new SubmittedLoginReviews(
			() => currentRead.current(),
			(update) => currentPersist.current(update),
			(view) => {
				setReview(view);
				setReviewTarget("");
			},
		);
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
			reviews.current?.cancel();
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
				Date.now,
				{
					offer: (proposal, isLive) => {
						setReviewNotice("");
						reviews.current?.offer(proposal, isLive);
					},
					clear: () => reviews.current?.cancel(),
				},
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
					tab open. You can also explicitly watch a submitted login and review
					it here before creating or updating a vault record. Locking or leaving
					the vault revokes the connection.
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
				{review ? (
					<section aria-label="Review submitted login">
						<h2>Review submitted login</h2>
						<p>
							Confirm that sign-in succeeded before saving. A submission alone
							does not prove success. Nothing is saved automatically.
						</p>
						<p>
							<strong>{review.origin}</strong>
							<br />
							{review.username || "No username"}
						</p>
						<label htmlFor="submission-target">Save action</label>
						<select
							id="submission-target"
							value={reviewTarget}
							onChange={(event) => setReviewTarget(event.target.value)}
						>
							<option value="">Create new login</option>
							{review.matches.map((item) => (
								<option value={item.id} key={item.id}>
									Update {item.title} ({item.username})
								</option>
							))}
						</select>
						<p>
							Approval expires in at most 30 seconds. Updates preserve the
							existing title, website, notes and favorite.
						</p>
						<div className="companion-actions">
							<Button
								label={
									reviewTarget
										? "Confirm and update login"
										: "Confirm and create login"
								}
								isDisabled={saving}
								onClick={() => {
									setSaving(true);
									void reviews.current
										?.approve(review.id, reviewTarget || null)
										.then((saved) =>
											setReviewNotice(
												saved
													? "Submitted login saved to your encrypted vault."
													: "The review expired or the login changed. Capture and review again.",
											),
										)
										.finally(() => setSaving(false));
								}}
							/>
							<Button
								label="Discard submission"
								variant="ghost"
								onClick={() => reviews.current?.cancel()}
							/>
						</div>
					</section>
				) : null}
				<output aria-live="polite">
					{saving ? "Saving approved login…" : reviewNotice}
				</output>
			</Card>
		</section>
	);
}
