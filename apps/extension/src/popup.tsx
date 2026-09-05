import { Button, Card, LayerProvider, Theme } from "@astryxdesign/core";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";
import {
	type Match,
	normalizeOrigin,
	parseVaultMessage,
	record,
	textField,
	uuid,
} from "@svrgn/extension-protocol";
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { generatePassword } from "./generator";
import {
	type CandidateMetadata,
	type FormChoice,
	type PopupRequest,
	parseCandidateMetadata,
	parseForms,
} from "./messages";
import "@astryxdesign/core/reset.css";
import "@astryxdesign/core/astryx.css";
import "@astryxdesign/theme-neutral/theme.css";
import "./popup.css";
async function send(message: PopupRequest): Promise<Record<string, unknown>> {
	const response: unknown = await chrome.runtime.sendMessage(message);
	if (!record(response)) throw new Error("Invalid extension response.");
	if (response.ok !== true)
		throw new Error(
			textField(response.error, 300) ? response.error : "Request failed.",
		);
	return response;
}
function Popup() {
	const originLoaded = useRef(false);
	const [state, setState] = useState("disconnected");
	const [origin, setOrigin] = useState("");
	const [pageOrigin, setPageOrigin] = useState("");
	const [items, setItems] = useState<Match[]>([]);
	const [forms, setForms] = useState<FormChoice[]>([]);
	const [formId, setFormId] = useState("");
	const [token, setToken] = useState("");
	const [expiresAt, setExpiresAt] = useState(0);
	const [error, setError] = useState("");
	const [notice, setNotice] = useState("");
	const [busy, setBusy] = useState(false);
	const [generated, setGenerated] = useState("");
	const [candidate, setCandidate] = useState<CandidateMetadata | null>(null);
	const clearMatches = () => {
		setItems([]);
		setForms([]);
		setToken("");
		setExpiresAt(0);
	};
	useEffect(() => {
		let mounted = true;
		const refresh = () =>
			void send({ type: "status" })
				.then((result) => {
					if (!mounted) return;
					if (
						!["disconnected", "locked", "connected"].includes(
							String(result.state),
						) ||
						!textField(result.origin, 4096)
					)
						throw new Error("Invalid state.");
					setState(String(result.state));
					if (
						result.candidate !== null &&
						result.candidate !== undefined &&
						!parseCandidateMetadata(result.candidate)
					)
						throw new Error("Invalid submission metadata.");
					setCandidate(
						result.state === "connected"
							? parseCandidateMetadata(result.candidate)
							: null,
					);
					if (!originLoaded.current) {
						setOrigin(result.origin);
						originLoaded.current = true;
					}
					if (result.state !== "connected") {
						setItems([]);
						setForms([]);
						setToken("");
					}
				})
				.catch(() => {
					if (mounted) {
						setState("error");
						setCandidate(null);
						setError("Extension unavailable. Reopen the popup.");
					}
				});
		refresh();
		const timer = setInterval(refresh, 1000);
		return () => {
			mounted = false;
			clearInterval(timer);
		};
	}, []);
	useEffect(() => {
		if (!expiresAt) return;
		const timer = setTimeout(
			() => {
				setItems([]);
				setForms([]);
				setToken("");
				setNotice("Matches expired. Refresh to continue.");
			},
			Math.max(0, expiresAt - Date.now()),
		);
		return () => clearTimeout(timer);
	}, [expiresAt]);
	useEffect(() => {
		if (!generated) return;
		const timer = setTimeout(() => setGenerated(""), 30_000);
		return () => clearTimeout(timer);
	}, [generated]);
	async function run(action: () => Promise<void>) {
		setBusy(true);
		setError("");
		setNotice("");
		try {
			await action();
		} catch (cause) {
			clearMatches();
			setError(cause instanceof Error ? cause.message : "Request failed.");
		} finally {
			setBusy(false);
		}
	}
	const list = () =>
		run(async () => {
			clearMatches();
			const result = await send({ type: "list" });
			const parsed = parseVaultMessage({
				v: 1,
				type: "result",
				id: crypto.randomUUID(),
				items: result.items,
			});
			const parsedForms = parseForms(result.forms);
			if (
				!parsed ||
				parsed.type !== "result" ||
				!parsedForms ||
				!uuid(result.token) ||
				typeof result.origin !== "string" ||
				normalizeOrigin(result.origin) !== result.origin ||
				typeof result.expiresAt !== "number" ||
				!Number.isSafeInteger(result.expiresAt) ||
				result.expiresAt > Date.now() + 10_000 ||
				result.expiresAt <= Date.now()
			)
				throw new Error("Invalid matches response.");
			setItems(parsed.items);
			setForms(parsedForms);
			setFormId(parsedForms[0]?.id ?? "");
			setToken(result.token);
			setPageOrigin(result.origin);
			setExpiresAt(result.expiresAt);
		});
	return (
		<main>
			<header>
				<span className="mark" aria-hidden="true">
					S
				</span>
				<div>
					<h1>Sovereignty</h1>
					<p>Your vault. Your control.</p>
				</div>
				<span className="status">{state}</span>
			</header>
			<p className="audit">
				Development preview · Independent audit required. Use test credentials
				only.
			</p>
			<Card padding={4}>
				<label htmlFor="vault-origin">Self-hosted vault origin</label>
				<input
					id="vault-origin"
					type="url"
					value={origin}
					onChange={(event) => setOrigin(event.target.value)}
					disabled={busy}
				/>
				<div className="row">
					<Button
						label="Pair vault"
						isDisabled={busy}
						onClick={() =>
							void run(async () => {
								await send({ type: "pair", origin });
								clearMatches();
								setNotice(
									"Unlock the opened vault and approve pairing. Then return to this login page.",
								);
							})
						}
					>
						Pair vault
					</Button>
					<Button
						label="Disconnect"
						isDisabled={busy || state !== "connected"}
						onClick={() =>
							void run(async () => {
								await send({ type: "lock" });
								setState("locked");
								clearMatches();
							})
						}
					>
						Disconnect
					</Button>
				</div>
			</Card>
			<section aria-labelledby="matches-heading">
				<div className="row">
					<h2 id="matches-heading">This page</h2>
					<Button
						label="Refresh matches"
						isDisabled={busy || state !== "connected"}
						onClick={() => void list()}
					>
						Refresh matches
					</Button>
				</div>
				{pageOrigin && <p className="origin">{pageOrigin}</p>}
				{token && forms.length === 0 && (
					<p>
						No unambiguous, visible login form found. Embedded and hidden forms
						are excluded.
					</p>
				)}
				{token && items.length === 0 && (
					<p>No credentials match this exact origin.</p>
				)}
				{forms.length > 1 && (
					<>
						<label htmlFor="form-choice">Login form</label>
						<select
							id="form-choice"
							value={formId}
							onChange={(event) => setFormId(event.target.value)}
						>
							{forms.map((form) => (
								<option key={form.id} value={form.id}>
									{form.label}
								</option>
							))}
						</select>
					</>
				)}
				<ul>
					{items.map((item) => (
						<li key={item.id}>
							<div>
								<strong>{item.title}</strong>
								<span>{item.username || "No username"}</span>
							</div>
							<Button
								label="Fill"
								isDisabled={busy || !formId || !token}
								onClick={() =>
									void run(async () => {
										await send({
											type: "fill",
											token,
											itemId: item.id,
											formId,
										});
										clearMatches();
										setNotice(
											"Filled the selected form. Review it before submitting.",
										);
									})
								}
							>
								Fill
							</Button>
						</li>
					))}
				</ul>
				{token && formId ? (
					<>
						<p>
							To save an entered login, explicitly watch this form’s next
							submission for 30 seconds. No keystrokes are monitored.
						</p>
						<Button
							label="Watch next submission"
							isDisabled={busy}
							onClick={() =>
								void run(async () => {
									await send({ type: "watch", token, formId });
									clearMatches();
									setNotice(
										"Watching only the selected form for 30 seconds. Submit it, then reopen Sovereignty to review. A page reload discards the capture.",
									);
								})
							}
						/>
					</>
				) : null}
			</section>
			{candidate ? (
				<section aria-label="Review submitted login">
					<h2>Review submitted login</h2>
					<p className="origin">{candidate.origin}</p>
					<p>{candidate.username || "No username"}</p>
					<p>
						Confirm that sign-in succeeded in the vault before saving. The
						extension cannot verify authentication success.
					</p>
					<Button
						label="Review in vault"
						isDisabled={busy}
						onClick={() =>
							void run(async () => {
								await send({ type: "review", token: candidate.token });
								setCandidate(null);
								setNotice(
									"Sent to your vault for explicit review. Nothing is saved automatically.",
								);
							})
						}
					/>
				</section>
			) : null}
			<section aria-labelledby="generator-heading">
				<div className="row">
					<h2 id="generator-heading">Password generator</h2>
					<Button
						label="Generate"
						onClick={() => setGenerated(generatePassword())}
					>
						Generate
					</Button>
				</div>
				{generated && (
					<>
						<label htmlFor="generated">
							24 random characters · clears in 30 seconds
						</label>
						<input
							id="generated"
							readOnly
							value={generated}
							onFocus={(event) => event.target.select()}
						/>
						<button type="button" onClick={() => setGenerated("")}>
							Clear generated password
						</button>
					</>
				)}
			</section>
			{error && (
				<p role="alert" className="error">
					{error}
				</p>
			)}
			<output aria-live="polite">{busy ? "Working…" : notice}</output>
			<footer>
				Only the credential you select is sent to this page. Pairing ends after
				five minutes or when the vault locks.
			</footer>
		</main>
	);
}
const root = document.getElementById("root");
if (root)
	createRoot(root).render(
		<Theme theme={neutralTheme} mode="dark">
			<LayerProvider>
				<Popup />
			</LayerProvider>
		</Theme>,
	);
