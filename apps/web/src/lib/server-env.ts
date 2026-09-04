export interface ServerEnvironment {
	readonly betterAuthSecret: string;
	readonly betterAuthUrl: string;
	readonly databaseUrl: string;
	readonly nodeEnv: "development" | "production" | "test";
	readonly passkeyOrigins: ReadonlyArray<string>;
	readonly passkeyRpId: string;
	readonly trustedOrigins: ReadonlyArray<string>;
}

export class ServerEnvironmentError extends Error {
	readonly name = "ServerEnvironmentError";
}

type EnvironmentSource = Readonly<Record<string, string | undefined>>;

const required = (source: EnvironmentSource, name: string): string => {
	const value = source[name]?.trim();
	if (!value) throw new ServerEnvironmentError(`${name} is required`);
	return value;
};

const exactOrigin = (value: string, name: string): string => {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new ServerEnvironmentError(`${name} must be an absolute URL origin`);
	}
	if (
		(url.protocol !== "http:" && url.protocol !== "https:") ||
		url.username ||
		url.password ||
		url.hostname.includes("*") ||
		url.pathname !== "/" ||
		url.search ||
		url.hash ||
		url.origin !== value
	) {
		throw new ServerEnvironmentError(
			`${name} must be an exact HTTP(S) origin without a path or trailing slash`,
		);
	}
	return url.origin;
};

const rpId = (value: string, name: string): string => {
	const normalized = value.trim().toLocaleLowerCase("en");
	if (
		!normalized ||
		normalized.includes(":") ||
		normalized.includes("/") ||
		normalized.startsWith(".") ||
		normalized.endsWith(".")
	) {
		throw new ServerEnvironmentError(
			`${name} must be a hostname without a port`,
		);
	}
	return normalized;
};

const hostnameMatchesRpId = (
	hostname: string,
	relyingPartyId: string,
): boolean =>
	hostname === relyingPartyId || hostname.endsWith(`.${relyingPartyId}`);

export const parseServerEnvironment = (
	source: EnvironmentSource,
): ServerEnvironment => {
	const nodeEnv = source.NODE_ENV ?? "development";
	if (
		!(["development", "production", "test"] as const).includes(nodeEnv as never)
	) {
		throw new ServerEnvironmentError(
			"NODE_ENV must be development, production, or test",
		);
	}

	const databaseUrl = required(source, "DATABASE_URL");
	let databaseProtocol: string;
	try {
		databaseProtocol = new URL(databaseUrl).protocol;
	} catch {
		throw new ServerEnvironmentError("DATABASE_URL must be a valid URL");
	}
	if (databaseProtocol !== "postgres:" && databaseProtocol !== "postgresql:") {
		throw new ServerEnvironmentError("DATABASE_URL must use PostgreSQL");
	}

	const betterAuthSecret = required(source, "BETTER_AUTH_SECRET");
	if (betterAuthSecret.length < 32) {
		throw new ServerEnvironmentError(
			"BETTER_AUTH_SECRET must contain at least 32 characters",
		);
	}

	const betterAuthUrl = exactOrigin(
		required(source, "BETTER_AUTH_URL"),
		"BETTER_AUTH_URL",
	);
	const trustedOrigins = required(source, "BETTER_AUTH_TRUSTED_ORIGINS")
		.split(",")
		.map((origin, index) =>
			exactOrigin(origin.trim(), `BETTER_AUTH_TRUSTED_ORIGINS[${index}]`),
		);
	if (!trustedOrigins.includes(betterAuthUrl)) {
		throw new ServerEnvironmentError(
			"BETTER_AUTH_TRUSTED_ORIGINS must include BETTER_AUTH_URL",
		);
	}

	const passkeyRpId = rpId(
		source.PASSKEY_RP_ID?.trim() || new URL(betterAuthUrl).hostname,
		"PASSKEY_RP_ID",
	);
	const passkeyOrigins = (source.PASSKEY_ORIGINS?.trim() || betterAuthUrl)
		.split(",")
		.map((origin, index) =>
			exactOrigin(origin.trim(), `PASSKEY_ORIGINS[${index}]`),
		);
	for (const origin of passkeyOrigins) {
		if (!trustedOrigins.includes(origin)) {
			throw new ServerEnvironmentError(
				"PASSKEY_ORIGINS must be included in BETTER_AUTH_TRUSTED_ORIGINS",
			);
		}
		if (!hostnameMatchesRpId(new URL(origin).hostname, passkeyRpId)) {
			throw new ServerEnvironmentError(
				"Every PASSKEY_ORIGINS hostname must equal or be a subdomain of PASSKEY_RP_ID",
			);
		}
	}

	if (nodeEnv === "production") {
		for (const origin of trustedOrigins) {
			const url = new URL(origin);
			const loopback =
				url.hostname === "localhost" || url.hostname === "127.0.0.1";
			if (url.protocol !== "https:" && !loopback) {
				throw new ServerEnvironmentError(
					"Production origins must use HTTPS unless they are loopback origins",
				);
			}
		}
	}

	return {
		betterAuthSecret,
		betterAuthUrl,
		databaseUrl,
		nodeEnv: nodeEnv as ServerEnvironment["nodeEnv"],
		passkeyOrigins,
		passkeyRpId,
		trustedOrigins,
	};
};

let cachedEnvironment: ServerEnvironment | undefined;

export const getServerEnvironment = (): ServerEnvironment => {
	cachedEnvironment ??= parseServerEnvironment(process.env);
	return cachedEnvironment;
};
