import { createFileRoute } from "@tanstack/react-router";

import { VaultApp } from "#/components/vault-app";

export const Route = createFileRoute("/")({ component: Home, ssr: false });

function Home() {
	return <VaultApp />;
}
