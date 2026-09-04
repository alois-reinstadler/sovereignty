import {
	createStartHandler,
	defaultStreamHandler,
} from "@tanstack/react-start/server";

const startHandler = createStartHandler(defaultStreamHandler);

export const SECURITY_HEADERS = {
	"content-security-policy": [
		"default-src 'self'",
		"base-uri 'none'",
		"connect-src 'self' ws: wss:",
		"font-src 'self' data:",
		"form-action 'self'",
		"frame-ancestors 'none'",
		"frame-src 'none'",
		"img-src 'self' data: blob:",
		"media-src 'none'",
		"object-src 'none'",
		"script-src 'self' 'unsafe-inline'",
		"style-src 'self' 'unsafe-inline'",
		"worker-src 'self' blob:",
	].join("; "),
	"permissions-policy":
		"camera=(), geolocation=(), microphone=(), payment=(), publickey-credentials-get=(self)",
	"referrer-policy": "no-referrer",
	"strict-transport-security": "max-age=31536000",
	"x-content-type-options": "nosniff",
	"x-frame-options": "DENY",
} as const;

export const withSecurityHeaders = (response: Response): Response => {
	const headers = new Headers(response.headers);
	for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
		headers.set(name, value);
	}
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
};

export default {
	fetch: async (request: Request) =>
		withSecurityHeaders(await startHandler(request)),
};
