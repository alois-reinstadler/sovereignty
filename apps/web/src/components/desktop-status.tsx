import { Card } from "@astryxdesign/core";
import { Brand } from "./brand";
export function DesktopStatus({
	accountPage = false,
}: {
	accountPage?: boolean;
}) {
	const content = (
		<>
			<h2>Desktop local vault</h2>
			<p>
				Your encrypted vault stays in this app’s local webview storage. Use
				encrypted backups to move it between devices.
			</p>
			<p>
				Accounts, passkeys and encrypted sync are unavailable in this desktop
				development client. Use your self-hosted web client for those features.
			</p>
			<p>
				Unlock requires your master password. OS secure unlock is not
				configured. Independent security audit required; use synthetic
				credentials only.
			</p>
		</>
	);
	return accountPage ? (
		<main className="auth-shell">
			<section className="auth-column">
				<Brand />
				<Card padding={6}>
					{content}
					<a href="/">Return to local vault</a>
				</Card>
			</section>
		</main>
	) : (
		<section aria-label="Desktop local vault" className="desktop-local-status">
			<h2>Desktop local vault</h2>
			<p>Account sync is unavailable. Use encrypted backups.</p>
			<p>
				Master-password unlock. Development preview; independent audit required.
			</p>
		</section>
	);
}
