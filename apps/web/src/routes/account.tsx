import { createFileRoute } from "@tanstack/react-router";

import { AccountScreen } from "#/components/account-screen";
import { DesktopStatus } from "#/components/desktop-status";
import { IS_DESKTOP } from "#/lib/client-platform";

export const Route = createFileRoute("/account")({
	component: Account,
	ssr: false,
});

function Account() {
	return IS_DESKTOP ? <DesktopStatus accountPage /> : <AccountScreen />;
}
