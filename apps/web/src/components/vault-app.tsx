import { Button, Card, Icon, Spinner, TextInput } from "@astryxdesign/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getAuthClient } from "#/lib/auth-client";
import { applyChromeCsvImport } from "#/lib/chrome-csv-import";
import { IS_DESKTOP } from "#/lib/client-platform";
import { copyForLiveSession } from "#/lib/clipboard-session";
import {
	attachDesktopLifecycle,
	VaultLockQueue,
} from "#/lib/desktop-lifecycle";
import { completeDesktopClose } from "#/lib/desktop-native";
import type {
	UnlockedVault,
	VaultDocument,
	VaultItem,
	VaultStatus,
} from "#/lib/models";
import {
	fetchRemoteVaultForRestore,
	metadataForRestoredVault,
} from "#/lib/sync-client";
import { indexedDbSyncMetadataStore } from "#/lib/sync-metadata";
import {
	createLocalVault,
	createLogin,
	hasStoredVault,
	removeItem,
	replaceItem,
	restoreLocalVaultFromSync,
	saveLocalVault,
	unlockLocalVault,
} from "#/lib/vault-adapter";

import { AuthScreen } from "./auth-screen";
import { BackupControls } from "./backup-controls";
import { Brand } from "./brand";
import { ChromeCsvImport } from "./chrome-csv-import";
import { DesktopStatus } from "./desktop-status";
import { ExtensionCompanion } from "./extension-companion";
import { ItemDetail } from "./item-detail";
import { ItemForm } from "./item-form";
import { SyncControls } from "./sync-controls";

const AUTO_LOCK_OPTIONS = [1, 5, 15, 30] as const;

type DocumentUpdate = (current: VaultDocument) => VaultDocument;

interface ClipboardEntry {
	value: string;
	timer: number;
}

export function VaultApp() {
	return IS_DESKTOP ? <VaultView accountUserId={null} /> : <WebVaultApp />;
}
function WebVaultApp() {
	const accountSession = getAuthClient().useSession();
	return <VaultView accountUserId={accountSession.data?.user.id ?? null} />;
}
function VaultView({ accountUserId }: { accountUserId: string | null }) {
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
	const [isSyncing, setIsSyncing] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const [backupNotice, setBackupNotice] = useState<string | null>(null);
	const [autoLockMinutes, setAutoLockMinutes] = useState(5);
	const [mobileDetail, setMobileDetail] = useState(false);
	const [authDraftVersion, setAuthDraftVersion] = useState(0);
	const lastActivity = useRef(Date.now());
	const searchInput = useRef<HTMLInputElement>(null);
	const sessionRef = useRef<UnlockedVault | null>(null);
	const documentRef = useRef<VaultDocument | null>(null);
	const lockingRef = useRef(false);
	const persistingRef = useRef(false);
	const syncingRef = useRef(false);
	const clipboardEntryRef = useRef<ClipboardEntry | null>(null);
	const lockQueue = useRef(new VaultLockQueue());
	const pendingSave = useRef<Promise<void> | null>(null);
	const pendingAuthentication = useRef<Promise<UnlockedVault> | null>(null);

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

	const lock = useCallback(async (): Promise<boolean> => {
		if (!IS_DESKTOP && (persistingRef.current || syncingRef.current)) {
			setNotice(
				"Wait for the current save to finish before locking the vault.",
			);
			return false;
		}
		return lockQueue.current.request(
			() => {
				setAuthDraftVersion((version) => version + 1);
				lockingRef.current = true;
				if (sessionRef.current || pendingAuthentication.current)
					setIsLocking(true);
			},
			async () => {
				const unlocked = sessionRef.current;
				const authentication = pendingAuthentication.current;
				const save = pendingSave.current;
				const clipboardEntry = clipboardEntryRef.current;
				let success = true;
				try {
					const results = await Promise.allSettled([
						unlocked?.close() ?? Promise.resolve(),
						save ?? Promise.resolve(),
						authentication?.then(
							(value) => value.close(),
							() => {},
						) ?? Promise.resolve(),
						clipboardEntry
							? clearClipboardEntry(clipboardEntry)
							: Promise.resolve(),
					]);
					success = results.every((result) => result.status === "fulfilled");
				} finally {
					sessionRef.current = null;
					documentRef.current = null;
					setDocument(null);
					setSelectedId(null);
					setEditing(null);
					setDeleting(null);
					try {
						setStatus(hasStoredVault() ? "locked" : "setup");
					} catch {
						setStatus("locked");
					}
					setNotice(null);
					setIsLocking(false);
					lockingRef.current = false;
				}
				if (!success)
					setError(
						"The vault was locked, but a pending save failed. The desktop window remains open; check storage and your last encrypted backup.",
					);
				return success;
			},
		);
	}, [clearClipboardEntry]);
	useEffect(
		() =>
			attachDesktopLifecycle({
				enabled: IS_DESKTOP,
				window,
				document: globalThis.document,
				lock: () => lock(),
				completeClose: completeDesktopClose,
				onError: () =>
					setError(
						"The desktop close could not complete safely. The window remains open; retry after checking storage.",
					),
			}),
		[lock],
	);

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
		if (lockingRef.current || pendingAuthentication.current) return;
		const ticket = lockQueue.current.ticket();
		setIsWorking(true);
		setError(null);
		setBackupNotice(null);
		try {
			const operation = create
				? createLocalVault(password)
				: unlockLocalVault(password);
			pendingAuthentication.current = operation;
			const unlocked = await operation;
			if (!lockQueue.current.current(ticket) || lockingRef.current) {
				await unlocked.close();
				return;
			}
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
			pendingAuthentication.current = null;
			setIsWorking(false);
		}
	};

	const restoreFromSync = async (password: string) => {
		const userId = IS_DESKTOP ? null : accountUserId;
		if (!userId) {
			setError("Sign in to your Sovereignty account before restoring sync.");
			return;
		}
		setIsWorking(true);
		setError(null);
		let restored: UnlockedVault | null = null;
		try {
			const remote = await fetchRemoteVaultForRestore();
			restored = await restoreLocalVaultFromSync(
				remote.keyEnvelope,
				remote.records,
				password,
			);
			const metadata = metadataForRestoredVault(
				remote.records,
				remote.cursor,
				restored.document,
			);
			await indexedDbSyncMetadataStore.save(userId, metadata);
			sessionRef.current = restored;
			documentRef.current = restored.document;
			setDocument(restored.document);
			setStatus("unlocked");
			setNotice("The encrypted vault was restored from your account.");
			lastActivity.current = Date.now();
			restored = null;
		} catch (cause) {
			await restored?.close();
			setError(
				cause instanceof Error
					? cause.message
					: "The synced vault could not be restored.",
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
		if (syncingRef.current) {
			setNotice("Wait for sync to finish before changing the vault.");
			return false;
		}
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
			const operation = saveLocalVault(unlocked, next);
			pendingSave.current = operation;
			await operation;
			if (lockingRef.current) return true;
			documentRef.current = next;
			setDocument(next);
			return true;
		} catch {
			setNotice(
				"The change could not be saved and was not applied. Check browser storage and try again.",
			);
			return false;
		} finally {
			pendingSave.current = null;
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
		const ticket = lockQueue.current.ticket();
		const issuingSession = sessionRef.current;
		const isLive = () =>
			!lockingRef.current &&
			Boolean(issuingSession) &&
			sessionRef.current === issuingSession &&
			lockQueue.current.current(ticket);
		try {
			const result = await copyForLiveSession(
				value,
				navigator.clipboard,
				isLive,
				() => {
					const previous = clipboardEntryRef.current;
					if (previous) window.clearTimeout(previous.timer);
					const entry: ClipboardEntry = { value, timer: 0 };
					entry.timer = window.setTimeout(() => {
						void clearClipboardEntry(entry);
					}, 30_000);
					clipboardEntryRef.current = entry;
				},
			);
			if (result === "revoked") return;
			if (result === "blocked") throw new Error("Clipboard unavailable.");
			if (!isLive()) return;
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
								Sovereignty did not modify the stored data. Restore browser
								storage access, then retry.
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
				draftVersion={authDraftVersion}
				mode={status}
				isWorking={isWorking}
				error={error}
				onCreate={(password) => authenticate(password, true)}
				onUnlock={(password) => authenticate(password, false)}
				onImported={finishBackupImport}
				onRestore={
					status === "setup" && accountUserId && !IS_DESKTOP
						? restoreFromSync
						: undefined
				}
				backupNotice={backupNotice}
			/>
		);
	}

	if (!document) return null;

	return (
		<main className="vault-shell">
			{!IS_DESKTOP ? (
				<ExtensionCompanion
					persist={persist}
					readItems={() => {
						if (
							lockingRef.current ||
							!sessionRef.current ||
							Date.now() - lastActivity.current >= autoLockMinutes * 60_000
						)
							return null;
						return documentRef.current?.items ?? null;
					}}
				/>
			) : null}
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
					isDisabled={isLocking || isPersisting || isSyncing}
					onImported={finishBackupImport}
				/>
				<ChromeCsvImport
					existingItems={document.items}
					isDisabled={isLocking || isPersisting || isSyncing}
					onImport={(preview, strategy) =>
						persist((current) =>
							applyChromeCsvImport(current, preview, strategy),
						)
					}
				/>
				{IS_DESKTOP ? (
					<DesktopStatus />
				) : (
					<SyncControls
						vault={sessionRef.current as UnlockedVault}
						document={document}
						disabled={isLocking || isPersisting || isSyncing}
						onWorkingChange={(working) => {
							syncingRef.current = working;
							setIsSyncing(working);
						}}
						onDocument={(next) => {
							documentRef.current = next;
							setDocument(next);
						}}
					/>
				)}
				{!IS_DESKTOP ? (
					<a className="account-link nav-account-link" href="/account">
						Account &amp; passkeys
					</a>
				) : null}
				<Button
					label="Lock vault"
					variant="ghost"
					icon={<span>⌁</span>}
					onClick={() => void lock()}
					isDisabled={isLocking || (!IS_DESKTOP && (isPersisting || isSyncing))}
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
						isDisabled={isLocking || isPersisting || isSyncing}
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
									isDisabled={isLocking || isPersisting || isSyncing}
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
					isDisabled={isLocking || isPersisting || isSyncing}
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
								isDisabled={isLocking || isPersisting || isSyncing}
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
					isDisabled={isLocking || isPersisting || isSyncing}
				/>
				<Button
					label="Lock vault"
					variant="ghost"
					onClick={() => void lock()}
					isDisabled={isLocking || isPersisting || isSyncing}
				/>
			</div>
		</main>
	);
}
