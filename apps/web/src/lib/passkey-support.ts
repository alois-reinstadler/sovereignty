export interface PasskeyBrowserCapabilities {
	readonly hasPublicKeyCredential: boolean;
	readonly isSecureContext: boolean;
}

export type PasskeySupport =
	| { readonly available: true; readonly message: null }
	| { readonly available: false; readonly message: string };

export const evaluatePasskeySupport = ({
	hasPublicKeyCredential,
	isSecureContext,
}: PasskeyBrowserCapabilities): PasskeySupport => {
	if (!isSecureContext) {
		return {
			available: false,
			message:
				"Passkeys require HTTPS, except on localhost. A raw HTTP network or tailnet address cannot use WebAuthn.",
		};
	}
	if (!hasPublicKeyCredential) {
		return {
			available: false,
			message: "This browser or embedded webview does not support passkeys.",
		};
	}
	return { available: true, message: null };
};

export const getPasskeySupport = (): PasskeySupport =>
	evaluatePasskeySupport({
		hasPublicKeyCredential: "PublicKeyCredential" in globalThis,
		isSecureContext: globalThis.isSecureContext,
	});
