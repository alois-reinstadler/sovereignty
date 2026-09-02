import { Button, Card, Icon, Spinner, TextInput } from "@astryxdesign/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
	UnlockedVault,
	VaultDocument,
	VaultItem,
	VaultStatus,
} from "#/lib/models";
import {
	createLocalVault,
	createLogin,
	hasStoredVault,
	removeItem,
	replaceItem,
	saveLocalVault,
	unlockLocalVault,
} from "#/lib/vault-adapter";

import { AuthScreen } from "./auth-screen";
import { Brand } from "./brand";
import { ItemDetail } from "./item-detail";
import { ItemForm } from "./item-form";

const AUTO_LOCK_OPTIONS = [1, 5, 15, 30] as const;

export function VaultApp() {
	const [status, setStatus] = useState<VaultStatus>("loading");
	const [session, setSession] = useState<UnlockedVault | null>(null);
	const [document, setDocument] = useState<VaultDocument | null>(null);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [filter, setFilter] = useState<"all" | "favourites">("all");
	const [query, setQuery] = useState("");
	const [editing, setEditing] = useState<VaultItem | null>(null);
	const [deleting, setDeleting] = useState<VaultItem | null>(null);
	const [isWorking, setIsWorking] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const [autoLockMinutes, setAutoLockMinutes] = useState(5);
	const [mobileDetail, setMobileDetail] = useState(false);
	const lastActivity = useRef(Date.now());
	const searchInput = useRef<HTMLInputElement>(null);

	useEffect(() => {
		setStatus(hasStoredVault() ? "locked" : "setup");
	}, []);

	useEffect(() => {
		const focusSearch = (event: KeyboardEvent) => {
			if (
				(event.metaKey || event.ctrlKey) &&
				event.key.toLocaleLowerCase("en") === "k"
			) {
				event.preventDefault();
				searchInput.current?.focus();
			}
		};
		window.addEventListener("keydown", focusSearch);
		return () => window.removeEventListener("keydown", focusSearch);
	}, []);

	const lock = useCallback(() => {
		session?.destroy();
		setSession(null);
		setDocument(null);
		setSelectedId(null);
		setEditing(null);
		setStatus("locked");
		setNotice(null);
	}, [session]);

	useEffect(() => {
		if (status !== "unlocked") return;
		const track = () => {
			lastActivity.current = Date.now();
		};
		const events: ReadonlyArray<keyof WindowEventMap> = [
			"pointerdown",
			"keydown",
			"touchstart",
		];
		for (const event of events)
			window.addEventListener(event, track, { passive: true });
		const timer = window.setInterval(() => {
			if (Date.now() - lastActivity.current >= autoLockMinutes * 60_000) lock();
		}, 5_000);
		return () => {
			window.clearInterval(timer);
			for (const event of events) window.removeEventListener(event, track);
		};
	}, [autoLockMinutes, lock, status]);

	const authenticate = async (password: string, create: boolean) => {
		setIsWorking(true);
		setError(null);
		try {
			const unlocked = create
				? await createLocalVault(password)
				: await unlockLocalVault(password);
			setSession(unlocked);
			setDocument(unlocked.document);
			setStatus("unlocked");
			lastActivity.current = Date.now();
		} catch (cause) {
			setError(
				cause instanceof Error
					? cause.message
					: "An unexpected error occurred.",
			);
		} finally {
			setIsWorking(false);
		}
	};

	const persist = async (next: VaultDocument) => {
		if (!session) return;
		setDocument(next);
		try {
			await saveLocalVault(session, next);
		} catch {
			setNotice(
				"Changes are in memory but could not be saved to this browser.",
			);
		}
	};

	const selectedItem =
		document?.items.find((item) => item.id === selectedId) ?? null;
	const visibleItems = useMemo(() => {
		if (!document) return [];
		const normalized = query.trim().toLocaleLowerCase("en");
		return document.items
			.filter((item) => filter === "all" || item.favorite)
			.filter(
				(item) =>
					!normalized ||
					[item.title, item.username, item.website].some((value) =>
						value.toLocaleLowerCase("en").includes(normalized),
					),
			)
			.sort((left, right) => left.title.localeCompare(right.title, "en"));
	}, [document, filter, query]);

	const copy = async (value: string, label: string) => {
		try {
			await navigator.clipboard.writeText(value);
			setNotice(`${label} copied. Clipboard clears in 30 seconds.`);
			window.setTimeout(async () => {
				try {
					const current = await navigator.clipboard.readText();
					if (current === value) await navigator.clipboard.writeText("");
				} catch {
					// Browsers may deny clipboard reads once focus or permission changes.
				}
			}, 30_000);
		} catch {
			setNotice("Clipboard access was blocked by the browser.");
		}
	};

	if (status === "loading") {
		return (
			<main className="loading-screen">
				<Spinner label="Loading local vault" size="lg" />
			</main>
		);
	}

	if (status === "setup" || status === "locked") {
		return (
			<AuthScreen
				mode={status}
				isWorking={isWorking}
				error={error}
				onCreate={(password) => authenticate(password, true)}
				onUnlock={(password) => authenticate(password, false)}
			/>
		);
	}

	if (!document) return null;

	return (
		<main className="vault-shell">
			<aside className="vault-nav">
				<div className="nav-brand-row">
					<Brand />
					<span className="local-pill">LOCAL</span>
				</div>
				<nav aria-label="Vault views">
					<button
						type="button"
						className={filter === "all" ? "nav-item active" : "nav-item"}
						onClick={() => setFilter("all")}
					>
						<span className="nav-icon">▦</span> All items{" "}
						<span>{document.items.length}</span>
					</button>
					<button
						type="button"
						className={filter === "favourites" ? "nav-item active" : "nav-item"}
						onClick={() => setFilter("favourites")}
					>
						<span className="nav-icon">☆</span> Favourites
						<span>{document.items.filter((item) => item.favorite).length}</span>
					</button>
				</nav>
				<div className="nav-spacer" />
				<div className="security-state">
					<span className="status-dot" />
					<div>
						<strong>Vault unlocked</strong>
						<span>Encrypted locally</span>
					</div>
				</div>
				<label className="lock-select">
					<span>Auto-lock</span>
					<select
						id="auto-lock-duration"
						name="auto-lock-duration"
						value={autoLockMinutes}
						onChange={(event) => setAutoLockMinutes(Number(event.target.value))}
					>
						{AUTO_LOCK_OPTIONS.map((minutes) => (
							<option key={minutes} value={minutes}>
								{minutes} min
							</option>
						))}
					</select>
				</label>
				<Button
					label="Lock vault"
					variant="ghost"
					icon={<span>⌁</span>}
					onClick={lock}
					width="100%"
				/>
			</aside>

			<section className={`items-pane ${mobileDetail ? "mobile-hidden" : ""}`}>
				<header className="items-header">
					<div>
						<span className="eyebrow">PERSONAL VAULT</span>
						<h1>{filter === "all" ? "All items" : "Favourites"}</h1>
					</div>
					<Button
						label="New login"
						variant="primary"
						icon={<span aria-hidden="true">＋</span>}
						onClick={() => setEditing(createLogin())}
					/>
				</header>
				<div className="search-wrap">
					<TextInput
						label="Search vault"
						ref={searchInput}
						isLabelHidden
						value={query}
						onChange={setQuery}
						placeholder="Search logins…"
						startIcon={<Icon icon="search" />}
						hasClear
						width="100%"
					/>
					<kbd>⌘ K</kbd>
				</div>
				<div className="item-count">
					{visibleItems.length} {visibleItems.length === 1 ? "ITEM" : "ITEMS"}
				</div>
				<div className="item-list" role="listbox" aria-label="Vault items">
					{visibleItems.length ? (
						visibleItems.map((item) => (
							<button
								type="button"
								role="option"
								aria-selected={selectedId === item.id}
								className={
									selectedId === item.id ? "vault-item selected" : "vault-item"
								}
								key={item.id}
								onClick={() => {
									setSelectedId(item.id);
									setMobileDetail(true);
								}}
							>
								<span className="site-icon">
									{item.title.slice(0, 1).toUpperCase()}
								</span>
								<span className="item-summary">
									<strong>{item.title}</strong>
									<small>{item.username || item.website || "Login"}</small>
								</span>
								{item.favorite ? (
									<span className="favourite-star">★</span>
								) : null}
							</button>
						))
					) : (
						<div className="list-empty">
							<p>
								{query ? "No logins match your search." : "No logins here yet."}
							</p>
							{query ? null : (
								<Button
									label="Create your first login"
									variant="secondary"
									onClick={() => setEditing(createLogin())}
								/>
							)}
						</div>
					)}
				</div>
			</section>

			<section
				className={`detail-pane ${mobileDetail ? "mobile-visible" : ""}`}
			>
				<ItemDetail
					item={selectedItem}
					onBack={() => setMobileDetail(false)}
					onCopy={copy}
					onEdit={setEditing}
					onDelete={setDeleting}
					onFavourite={(item) =>
						persist(
							replaceItem(document, {
								...item,
								favorite: !item.favorite,
								updatedAt: new Date().toISOString(),
							}),
						)
					}
				/>
			</section>

			{editing ? (
				<div className="modal-backdrop" role="presentation">
					<Card
						className="editor-modal"
						padding={6}
						elevation="high"
						role="dialog"
						aria-modal="true"
					>
						<ItemForm
							initial={editing}
							onCancel={() => setEditing(null)}
							onSave={(item) => {
								void persist(replaceItem(document, item));
								setSelectedId(item.id);
								setEditing(null);
							}}
						/>
					</Card>
				</div>
			) : null}

			{deleting ? (
				<div className="modal-backdrop" role="presentation">
					<Card
						className="confirm-modal"
						padding={5}
						elevation="high"
						role="alertdialog"
						aria-modal="true"
					>
						<div className="danger-icon">!</div>
						<h2>Delete “{deleting.title}”?</h2>
						<p>
							This removes the login from this local vault. This action cannot
							be undone.
						</p>
						<div className="form-actions">
							<Button
								label="Cancel"
								variant="ghost"
								onClick={() => setDeleting(null)}
							/>
							<Button
								label="Delete login"
								variant="destructive"
								onClick={() => {
									void persist(removeItem(document, deleting.id));
									setSelectedId(null);
									setDeleting(null);
									setMobileDetail(false);
								}}
							/>
						</div>
					</Card>
				</div>
			) : null}

			{notice ? (
				<output className="notice">
					<span>{notice}</span>
					<Button
						label="Dismiss notification"
						variant="ghost"
						isIconOnly
						icon={<Icon icon="close" />}
						onClick={() => setNotice(null)}
					/>
				</output>
			) : null}

			<div className="mobile-nav">
				<Brand compact />
				<Button
					label="New login"
					variant="primary"
					onClick={() => setEditing(createLogin())}
				/>
				<Button label="Lock vault" variant="ghost" onClick={lock} />
			</div>
		</main>
	);
}
