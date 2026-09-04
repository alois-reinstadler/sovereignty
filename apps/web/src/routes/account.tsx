import { createFileRoute } from "@tanstack/react-router";

import { AccountScreen } from "#/components/account-screen";

export const Route = createFileRoute("/account")({
	component: Account,
	ssr: false,
});

function Account() {
	return <AccountScreen />;
}
