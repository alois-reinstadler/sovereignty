import {
	Banner,
	Button,
	Card,
	Icon,
	Stack,
	TextInput,
} from "@astryxdesign/core";
import { type FormEvent, useState } from "react";
import { authDraftForContext } from "#/lib/auth-draft";
import { IS_DESKTOP } from "#/lib/client-platform";
import { BackupControls } from "./backup-controls";
import { Brand } from "./brand";
import { DesktopStatus } from "./desktop-status";

type AuthScreenProps = {
	mode: "setup" | "locked";
	isWorking: boolean;
	error: string | null;
	onCreate: (password: string) => Promise<void>;
	onUnlock: (password: string) => Promise<void>;
	onImported: () => Promise<void> | void;
	onRestore?: (password: string) => Promise<void>;
	backupNotice?: string | null;
	draftVersion?: number;
};

export function AuthScreen({
	mode,
	isWorking,
	error,
	onCreate,
	onUnlock,
	onImported,
	onRestore,
	backupNotice,
	draftVersion = 0,
}: AuthScreenProps) {
	const context = `${mode}:${draftVersion}`;
	const [draft, setDraft] = useState({
		context,
		password: "",
		confirmation: "",
		showPassword: false,
	});
	const current = authDraftForContext(draft, context);
	// Adjust this component's state during render so stale credentials never commit.
	// BackupControls stays mounted: an encrypted file chooser/read can finish safely.
	if (current !== draft) setDraft(current);
	const { password, confirmation, showPassword } = current;
	const setPassword = (value: string) =>
		setDraft({ ...current, password: value });
	const setConfirmation = (value: string) =>
		setDraft({ ...current, confirmation: value });
	const creating = mode === "setup";
	const passwordTooShort =
		creating && password.length > 0 && password.length < 12;
	const mismatch =
		creating && confirmation.length > 0 && password !== confirmation;
	const canSubmit =
		!isWorking &&
		password.length >= (creating ? 12 : 1) &&
		(!creating || password === confirmation);

	const submit = async (event: FormEvent) => {
		event.preventDefault();
		if (!canSubmit) return;
		if (creating) await onCreate(password);
		else await onUnlock(password);
	};

	return (
		<main className="auth-shell">
			<div className="auth-glow" />
			<section className="auth-column">
				<Brand />
				{IS_DESKTOP ? <DesktopStatus /> : null}
				<Card className="auth-card" padding={6} elevation="high">
					<form onSubmit={submit}>
						<input
							type="email"
							name="username"
							autoComplete="username"
							value="local-vault"
							readOnly
							tabIndex={-1}
							aria-hidden="true"
							className="visually-hidden-field"
						/>
						<Stack gap={4}>
							<div className="auth-heading">
								<span className="eyebrow">LOCAL-FIRST SECURITY</span>
								<h1>{creating ? "Create your vault" : "Welcome back"}</h1>
								<p>
									{creating
										? "Choose a strong master password. It encrypts your vault on this device and cannot be recovered yet."
										: "Enter your master password to decrypt your local vault."}
								</p>
							</div>

							{error ? (
								<Banner
									status="error"
									title="Could not open the vault"
									description={error}
								/>
							) : null}

							<div className="password-field-wrap">
								<TextInput
									label="Master password"
									type={showPassword ? "text" : "password"}
									{...{
										autoComplete: creating
											? "new-password"
											: "current-password",
									}}
									htmlName="master-password"
									value={password}
									onChange={setPassword}
									width="100%"
									hasAutoFocus
									isRequired
									status={
										passwordTooShort
											? {
													type: "warning",
													message: "Use at least 12 characters.",
												}
											: undefined
									}
								/>
								<Button
									label={showPassword ? "Hide password" : "Show password"}
									variant="ghost"
									size="sm"
									isIconOnly
									icon={<Icon icon={showPassword ? "eyeSlash" : "info"} />}
									onClick={() =>
										setDraft({ ...current, showPassword: !showPassword })
									}
									className="password-toggle"
								/>
							</div>

							{creating ? (
								<TextInput
									label="Confirm master password"
									type="password"
									{...{ autoComplete: "new-password" }}
									htmlName="master-password-confirmation"
									value={confirmation}
									onChange={setConfirmation}
									onEnter={() => undefined}
									width="100%"
									isRequired
									status={
										mismatch
											? { type: "error", message: "Passwords do not match." }
											: undefined
									}
								/>
							) : null}

							<Button
								label={creating ? "Create encrypted vault" : "Unlock vault"}
								variant="primary"
								size="lg"
								width="100%"
								type="submit"
								isLoading={isWorking}
								isDisabled={!canSubmit}
							/>

							<p className="local-note">
								<Icon icon="info" size="sm" />
								{IS_DESKTOP
									? "Stored as encrypted data in this desktop app. Account sync is unavailable here."
									: "Stored as encrypted data. Account sync stays off until you enable it explicitly."}
							</p>
						</Stack>
					</form>
				</Card>
				{backupNotice ? (
					<Banner
						status="success"
						title="Backup imported"
						description={backupNotice}
					/>
				) : null}
				<BackupControls
					hasExistingVault={mode === "locked"}
					isDisabled={isWorking}
					onImported={onImported}
				/>
				{creating && onRestore ? (
					<Button
						label="Restore encrypted sync vault"
						variant="secondary"
						width="100%"
						onClick={() => void onRestore(password)}
						isLoading={isWorking}
						isDisabled={isWorking || password.length === 0}
					/>
				) : null}
				{!IS_DESKTOP ? (
					<a className="account-link" href="/account">
						Sign in for encrypted sync and passkeys
					</a>
				) : null}
				<p className="preview-label">
					DEVELOPMENT PREVIEW · NOT AUDITED FOR PRODUCTION USE
				</p>
			</section>
		</main>
	);
}
