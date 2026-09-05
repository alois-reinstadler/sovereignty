/** Reject production-looking URLs before opening any database connection. */
export const integrationDatabaseUrl = (value: string): URL => {
	const url = new URL(value);
	if (
		!(["postgres:", "postgresql:"] as string[]).includes(url.protocol) ||
		!/^\/svrgn_integration_[a-f0-9]{32}$/.test(url.pathname) ||
		url.search !== "" ||
		url.hash !== "" ||
		!["postgres", "localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
	) {
		throw new Error(
			"Integration tests require a local disposable svrgn_integration_<32 hex> database URL without query options",
		);
	}
	return url;
};
