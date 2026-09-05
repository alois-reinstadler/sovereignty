import { Banner, Button, Card, Stack, TextInput } from "@astryxdesign/core";
import type { Passkey } from "@better-auth/passkey";
import { type FormEvent, useCallback, useEffect, useState } from "react";

import { authClient } from "#/lib/auth-client";
import { getPasskeySupport } from "#/lib/passkey-support";

import { Brand } from "./brand";

type AccountMode = "sign-in" | "sign-up";

const accountFailure = (
	status: number | undefined,
	fallback: string,
): string => {
	if (status === 429) return "Too many attempts. Wait a moment and try again.";
	if (status === 401 || status === 403)
		return "The account credentials were not accepted.";
	return fallback;
};

function PasskeyManager() {
	const support = getPasskeySupport();
	const [passkeys, setPasskeys] = useState<Passkey[]>([]);
	const [name, setName] = useState("");
	const [loading, setLoading] = useState<"add" | "list" | string | null>(
		"list",
	);
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);

	const refresh = useCallback(async () => {
		setLoading("list");
		setError(null);
		try {
			const result = await authClient.passkey.listUserPasskeys();
			if (result.error) {
				setError(
					accountFailure(
						result.error.status,
						"Passkeys could not be loaded. Try again.",
					),
				);
				return;
			}
			setPasskeys(result.data ?? []);
		} catch {
			setError("Passkeys could not be loaded. Check the server connection.");
		} finally {
			setLoading(null);
		}
	}, []);

	// The list is account metadata only; no vault key or vault plaintext is used.
	useEffect(() => {
		void refresh();
	}, [refresh]);

	const addPasskey = async () => {
		if (!support.available || loading) return;
		setLoading("add");
		setError(null);
		setNotice(null);
		try {
			const result = await authClient.passkey.addPasskey({
				name: name.trim() || "My passkey",
			});
			if (result.error) {
				setError(
					accountFailure(
						result.error.status,
						"The passkey was not added. The request may have been cancelled.",
					),
				);
				return;
			}
			setName("");
			setNotice("Passkey added to your Sovereignty account.");
			await refresh();
		} catch {
			setError(
				"The passkey was not added. Check browser support and try again.",
			);
		} finally {
			setLoading(null);
		}
	};

	const deletePasskey = async (id: string) => {
		setLoading(id);
		setError(null);
		setNotice(null);
		try {
			const result = await authClient.passkey.deletePasskey({ id });
			if (result.error) {
				setError(
					accountFailure(
						result.error.status,
						"The passkey could not be deleted.",
					),
				);
				return;
			}
			setPasskeys((current) => current.filter((passkey) => passkey.id !== id));
			setNotice("Passkey deleted.");
		} catch {
			setError("The passkey could not be deleted. Try again.");
		} finally {
			setLoading(null);
		}
	};

	return (
		<Stack gap={4}>
			<div className="auth-heading">
				<span className="eyebrow">PASSKEYS</span>
				<h2>Account passkeys</h2>
				<p>
					Passkeys authenticate your sync account. They do not unlock or recover
					your encrypted vault.
				</p>
			</div>

			{support.message ? (
				<Banner
					status="warning"
					title="Passkeys unavailable on this origin"
					description={support.message}
				/>
			) : null}
			{error ? (
				<Banner status="error" title="Passkey error" description={error} />
			) : null}
			{notice ? (
				<Banner status="success" title="Account updated" description={notice} />
			) : null}

			<div className="passkey-add-row">
				<TextInput
					label="Passkey name"
					htmlName="passkey-name"
					value={name}
					onChange={setName}
					placeholder="e.g. MacBook Touch ID"
					width="100%"
				/>
				<Button
					label="Add passkey"
					variant="secondary"
					onClick={() => void addPasskey()}
					isLoading={loading === "add"}
					isDisabled={!support.available || loading !== null}
				/>
			</div>

			<div className="passkey-list" aria-live="polite">
				{loading === "list" ? (
					<p className="account-muted">Loading passkeys…</p>
				) : passkeys.length === 0 ? (
					<p className="account-muted">No passkeys registered yet.</p>
				) : (
					passkeys.map((passkey) => (
						<div className="passkey-row" key={passkey.id}>
							<div>
								<strong>{passkey.name || "Unnamed passkey"}</strong>
								<span>
									Added {new Date(passkey.createdAt).toLocaleDateString("en")}
								</span>
							</div>
							<Button
								label={`Delete ${passkey.name || "passkey"}`}
								variant="destructive"
								size="sm"
								onClick={() => void deletePasskey(passkey.id)}
								isLoading={loading === passkey.id}
								isDisabled={loading !== null}
							/>
						</div>
					))
				)}
			</div>
		</Stack>
	);
}

export function AccountScreen() {
	const session = authClient.useSession();
	const support = getPasskeySupport();
	const [mode, setMode] = useState<AccountMode>("sign-in");
	const [name, setName] = useState("");
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [confirmation, setConfirmation] = useState("");
	const [invitation, setInvitation] = useState("");
	const [working, setWorking] = useState<
		"password" | "passkey" | "sign-out" | null
	>(null);
	const [error, setError] = useState<string | null>(null);

	const submitPassword = async (event: FormEvent) => {
		event.preventDefault();
		if (working) return;
		if (mode === "sign-up" && password !== confirmation) {
			setError("Account passwords do not match.");
			return;
		}
		setWorking("password");
		setError(null);
		try {
			const result =
				mode === "sign-up"
					? await authClient.signUp.email({
							email: email.trim(),
							name: name.trim(),
							password,
							fetchOptions: {
								headers: invitation.trim()
									? { "x-sovereignty-invite": invitation.trim() }
									: {},
							},
						})
					: await authClient.signIn.email({ email: email.trim(), password });
			if (result.error) {
				setError(
					accountFailure(
						result.error.status,
						mode === "sign-up"
							? "The account could not be created. Check the details and try again."
							: "Sign-in failed. Check your email and account password.",
					),
				);
				return;
			}
			setPassword("");
			setConfirmation("");
			await session.refetch();
		} catch {
			setError("The account server could not be reached. Try again later.");
		} finally {
			setInvitation("");
			setWorking(null);
		}
	};

	const signInWithPasskey = async () => {
		if (!support.available || working) return;
		setWorking("passkey");
		setError(null);
		try {
			const result = await authClient.signIn.passkey();
			if (result.error) {
				setError(
					accountFailure(
						result.error.status,
						"Passkey sign-in was not completed.",
					),
				);
				return;
			}
			await session.refetch();
		} catch {
			setError("Passkey sign-in was not completed.");
		} finally {
			setWorking(null);
		}
	};

	const signOut = async () => {
		setWorking("sign-out");
		setError(null);
		try {
			const result = await authClient.signOut();
			if (result.error) {
				setError("The account session could not be ended. Try again.");
				return;
			}
			await session.refetch();
		} catch {
			setError("The account server could not be reached.");
		} finally {
			setWorking(null);
		}
	};

	return (
		<main className="account-shell">
			<section className="account-column">
				<div className="account-topline">
					<Brand />
					<a href="/">Back to vault</a>
				</div>

				<Banner
					status="info"
					title="Account access is separate from vault access"
					description="Your account password or passkey authenticates encrypted sync. Your master password decrypts the vault locally and is never sent to Better Auth."
				/>

				{session.isPending ? (
					<Card className="account-card" padding={6} elevation="high">
						<p className="account-muted">Loading account…</p>
					</Card>
				) : session.data ? (
					<>
						<Card className="account-card" padding={6} elevation="high">
							<div className="account-session-row">
								<div className="auth-heading">
									<span className="eyebrow">SIGNED IN</span>
									<h1>{session.data.user.name}</h1>
									<p>{session.data.user.email}</p>
								</div>
								<Button
									label="Sign out"
									variant="ghost"
									onClick={() => void signOut()}
									isLoading={working === "sign-out"}
								/>
							</div>
							{error ? (
								<Banner
									status="error"
									title="Account error"
									description={error}
								/>
							) : null}
						</Card>
						<Card className="account-card" padding={6} elevation="high">
							<PasskeyManager />
						</Card>
					</>
				) : (
					<Card className="account-card" padding={6} elevation="high">
						<form onSubmit={submitPassword}>
							<Stack gap={4}>
								<div className="auth-heading">
									<span className="eyebrow">SELF-HOSTED ACCOUNT</span>
									<h1>{mode === "sign-up" ? "Create account" : "Sign in"}</h1>
									<p>
										Use an account password here, not your vault master
										password.
									</p>
								</div>
								{error ? (
									<Banner
										status="error"
										title="Account error"
										description={error}
									/>
								) : null}
								{support.message ? (
									<Banner
										status="warning"
										title="Passkeys unavailable on this origin"
										description={support.message}
									/>
								) : null}
								{mode === "sign-up" ? (
									<TextInput
										label="Name"
										{...{ autoComplete: "name" }}
										htmlName="name"
										value={name}
										onChange={setName}
										isRequired
										width="100%"
									/>
								) : null}
								<TextInput
									label="Email"
									type="email"
									{...{ autoComplete: "email" }}
									htmlName="email"
									value={email}
									onChange={setEmail}
									isRequired
									width="100%"
								/>
								<TextInput
									label="Account password"
									type="password"
									{...{
										autoComplete:
											mode === "sign-up" ? "new-password" : "current-password",
									}}
									htmlName="account-password"
									value={password}
									onChange={setPassword}
									isRequired
									width="100%"
									status={
										mode === "sign-up" &&
										password.length > 0 &&
										password.length < 12
											? {
													type: "warning",
													message: "Use at least 12 characters.",
												}
											: undefined
									}
								/>
								{mode === "sign-up" ? (
									<TextInput
										label="Confirm account password"
										type="password"
										{...{ autoComplete: "new-password" }}
										htmlName="account-password-confirmation"
										value={confirmation}
										onChange={setConfirmation}
										isRequired
										width="100%"
									/>
								) : null}
								{mode === "sign-up" ? (
									<TextInput
										label="Invitation code (if required by your operator)"
										type="password"
										{...{ autoComplete: "off", maxLength: 64 }}
										htmlName="invitation-code"
										value={invitation}
										onChange={setInvitation}
										width="100%"
									/>
								) : null}
								<Button
									label={mode === "sign-up" ? "Create account" : "Sign in"}
									variant="primary"
									type="submit"
									isLoading={working === "password"}
									isDisabled={
										working !== null ||
										!email.trim() ||
										password.length < 12 ||
										(mode === "sign-up" &&
											(!name.trim() || password !== confirmation))
									}
									width="100%"
								/>
								<Button
									label="Sign in with a passkey"
									variant="secondary"
									onClick={() => void signInWithPasskey()}
									isLoading={working === "passkey"}
									isDisabled={!support.available || working !== null}
									width="100%"
								/>
								<button
									type="button"
									className="account-mode-toggle"
									onClick={() => {
										setMode((current) =>
											current === "sign-in" ? "sign-up" : "sign-in",
										);
										setError(null);
										setInvitation("");
									}}
								>
									{mode === "sign-in"
										? "Need an account? Create one"
										: "Already have an account? Sign in"}
								</button>
							</Stack>
						</form>
					</Card>
				)}
			</section>
		</main>
	);
}
