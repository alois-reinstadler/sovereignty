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
import { BackupControls } from "./backup-controls";
import { Brand } from "./brand";
import { ItemDetail } from "./item-detail";
import { ItemForm } from "./item-form";

const AUTO_LOCK_OPTIONS = [1, 5, 15, 30] as const;

type DocumentUpdate = (current: VaultDocument) => VaultDocument;

interface ClipboardEntry {
	value: string;
	timer: number;
}

export function VaultApp() {
	const [status, setStatus] = useState<VaultStatus>("loading");
	const [bootstrapError, setBootstrapError] = useState<string | null>(null);
	const [document, setDocument] = useState<VaultDocument | null>(null);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [filter, setFilter] = useState<"all" | "favourites">("all");
	const [query, setQuery] = useState("");
	const [editing, setEditing] = useState<VaultItem | null>(null);
	const [deleting, setDeleting] = useState<VaultItem | null>(null);
	const [isWorking, setIsWorking] = useState(false);
	const [isLocking, setIsLocking] = useState(false);
	const [isPersisting, setIsPersisting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const [backupNotice, setBackupNotice] = useState<string | null>(null);
	const [autoLockMinutes, setAutoLockMinutes] = useState(5);
	const [mobileDetail, setMobileDetail] = useState(false);
	const lastActivity = useRef(Date.now());
	const searchInput = useRef<HTMLInputElement>(null);
	const sessionRef = useRef<UnlockedVault | null>(null);
	const documentRef = useRef<VaultDocument | null>(null);
	const lockingRef = useRef(false);
	const persistingRef = useRef(false);
	const clipboardEntryRef = useRef<ClipboardEntry | null>(null);

	const bootstrap = useCallback(() => {
		setBootstrapError(null);
		setStatus("loading");
		try {
			setStatus(hasStoredVault() ? "locked" : "setup");
		} catch (cause) {
			setBootstrapError(
				cause instanceof Error
					? cause.message
					: "The local vault could not be read from this browser.",
			);
		}
	}, []);

	useEffect(() => {
		bootstrap();
	}, [bootstrap]);

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

	const clearClipboardEntry = useCallback(async (entry: ClipboardEntry) => {
		window.clearTimeout(entry.timer);
		try {
			const current = await navigator.clipboard.readText();
			if (clipboardEntryRef.current === entry && current === entry.value) {
				await navigator.clipboard.writeText("");
			}
		} catch {
			// Clipboard reads and writes are best-effort in browser security models.
		} finally {
			if (clipboardEntryRef.current === entry) clipboardEntryRef.current = null;
		}
	}, []);

	const lock = useCallback(async () => {
		if (lockingRef.current) return;
		if (persistingRef.current) {
			setNotice(
				"Wait for the current save to finish before locking the vault.",
			);
			return;
		}
		lockingRef.current = true;
		setIsLocking(true);
		const unlocked = sessionRef.current;
		const clipboardEntry = clipboardEntryRef.current;
		try {
			await Promise.allSettled([
				unlocked?.close() ?? Promise.resolve(),
				clipboardEntry
					? clearClipboardEntry(clipboardEntry)
					: Promise.resolve(),
			]);
		} finally {
			sessionRef.current = null;
			documentRef.current = null;
			setDocument(null);
			setSelectedId(null);
			setEditing(null);
			setDeleting(null);
			setStatus("locked");
			setNotice(null);
			setIsLocking(false);
			lockingRef.current = false;
		}
	}, [clearClipboardEntry]);

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
			if (Date.now() - lastActivity.current >= autoLockMinutes * 60_000) {
				void lock();
			}
		}, 5_000);
		const checkInactivity = () => {
			if (Date.now() - lastActivity.current >= autoLockMinutes * 60_000) {
				void lock();
			}
		};
		const lockOnPageHide = () => {
			void lock();
		};
		globalThis.document.addEventListener("visibilitychange", checkInactivity);
		window.addEventListener("focus", checkInactivity);
		window.addEventListener("pagehide", lockOnPageHide);
		return () => {
			window.clearInterval(timer);
			for (const event of events) window.removeEventListener(event, track);
			globalThis.document.removeEventListener(
				"visibilitychange",
				checkInactivity,
			);
			window.removeEventListener("focus", checkInactivity);
			window.removeEventListener("pagehide", lockOnPageHide);
		};
	}, [autoLockMinutes, lock, status]);

	const authenticate = async (password: string, create: boolean) => {
		setIsWorking(true);
		setError(null);
		setBackupNotice(null);
		try {
			const unlocked = create
				? await createLocalVault(password)
				: await unlockLocalVault(password);
			sessionRef.current = unlocked;
			documentRef.current = unlocked.document;
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

	const finishBackupImport = async () => {
		const unlocked = sessionRef.current;
		if (unlocked) await unlocked.close();
		sessionRef.current = null;
		documentRef.current = null;
		setDocument(null);
		setSelectedId(null);
		setEditing(null);
		setDeleting(null);
		setStatus("locked");
		setBackupNotice(
			"The imported vault is encrypted and locked. Enter its master password to continue.",
		);
	};

	const persist = async (update: DocumentUpdate): Promise<boolean> => {
		const unlocked = sessionRef.current;
		const current = documentRef.current;
		if (!unlocked || !current || lockingRef.current) return false;
		if (persistingRef.current) {
			setNotice(
				"Wait for the current save to finish before making another change.",
			);
			return false;
		}

		let next: VaultDocument;
		try {
			next = update(current);
		} catch {
			setNotice("The requested vault change could not be applied.");
			return false;
		}

		persistingRef.current = true;
		setIsPersisting(true);
		try {
			await saveLocalVault(unlocked, next);
			documentRef.current = next;
			setDocument(next);
			return true;
		} catch {
			setNotice(
				"The change could not be saved and was not applied. Check browser storage and try again.",
			);
			return false;
		} finally {
			persistingRef.current = false;
			setIsPersisting(false);
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
		if (lockingRef.current) return;
		try {
			await navigator.clipboard.writeText(value);
			const previous = clipboardEntryRef.current;
			if (previous) window.clearTimeout(previous.timer);
			const entry: ClipboardEntry = { value, timer: 0 };
			entry.timer = window.setTimeout(() => {
				void clearClipboardEntry(entry);
			}, 30_000);
			clipboardEntryRef.current = entry;
			setNotice(
				`${label} copied. Clipboard clearing will be attempted in 30 seconds.`,
			);
		} catch {
			setNotice("Clipboard access was blocked by the browser.");
		}
	};

	if (bootstrapError) {
		return (
			<main className="auth-shell">
				<section className="auth-column">
					<Brand />
					<Card className="auth-card" padding={6} elevation="high">
						<div className="auth-heading" role="alert">
							<span className="eyebrow">LOCAL STORAGE ERROR</span>
							<h1>Your vault could not be opened</h1>
							<p>{bootstrapError}</p>
							<p>
								Svrgn did not modify the stored data. Restore browser storage
								access, then retry.
							</p>
						</div>
						<Button
							label="Retry reading vault"
							variant="primary"
							width="100%"
							onClick={bootstrap}
						/>
					</Card>
				</section>
			</main>
		);
	}

	if (status === "loading") {
		return (
			<main className="loading-screen">
				<Spinner label="Loading local vault" size="lg" />
			</main>
		);
	}

	if (isLocking) {
		return (
			<main className="loading-screen">
				<Spinner label="Locking vault" size="lg" />
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
				onImported={finishBackupImport}
				backupNotice={backupNotice}
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
				<BackupControls
					hasExistingVault
					isDisabled={isLocking || isPersisting}
					onImported={finishBackupImport}
				/>
				<Button
					label="Lock vault"
					variant="ghost"
					icon={<span>⌁</span>}
					onClick={() => void lock()}
					isDisabled={isLocking || isPersisting}
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
						onClick={() => {
							if (!lockingRef.current) setEditing(createLogin());
						}}
						isDisabled={isLocking || isPersisting}
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
									onClick={() => {
										if (!lockingRef.current) setEditing(createLogin());
									}}
									isDisabled={isLocking || isPersisting}
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
					isDisabled={isLocking || isPersisting}
					onBack={() => setMobileDetail(false)}
					onCopy={copy}
					onEdit={(item) => {
						if (!lockingRef.current) setEditing(item);
					}}
					onDelete={(item) => {
						if (!lockingRef.current) setDeleting(item);
					}}
					onFavourite={async (item) => {
						await persist((current) => {
							const latest = current.items.find(({ id }) => id === item.id);
							if (!latest) return current;
							return replaceItem(current, {
								...latest,
								favorite: !latest.favorite,
							});
						});
					}}
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
							onSave={async (item) => {
								const applied = await persist((current) =>
									replaceItem(current, item),
								);
								if (applied) {
									setSelectedId(item.id);
									setEditing(null);
								}
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
								onClick={async () => {
									const applied = await persist((current) =>
										removeItem(current, deleting.id),
									);
									if (applied) {
										setSelectedId(null);
										setDeleting(null);
										setMobileDetail(false);
									}
								}}
								isDisabled={isLocking || isPersisting}
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
					onClick={() => {
						if (!lockingRef.current) setEditing(createLogin());
					}}
					isDisabled={isLocking || isPersisting}
				/>
				<Button
					label="Lock vault"
					variant="ghost"
					onClick={() => void lock()}
					isDisabled={isLocking || isPersisting}
				/>
			</div>
		</main>
	);
}
