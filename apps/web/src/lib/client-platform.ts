export type ClientPlatform = "web" | "desktop";
export function clientPlatform(value: unknown): ClientPlatform {
	return value === "desktop" ? "desktop" : "web";
}
/** Build-time choice, never a URL, localStorage, or page-supplied runtime flag. */
export const CLIENT_PLATFORM = clientPlatform(
	import.meta.env.VITE_SVRGN_CLIENT,
);
export const IS_DESKTOP = CLIENT_PLATFORM === "desktop";
export function clientFeatures(platform: ClientPlatform) {
	return {
		accounts: platform === "web",
		sync: platform === "web",
		extension: platform === "web",
		lockOnFocusLoss: platform === "desktop",
	};
}
