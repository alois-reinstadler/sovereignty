import { execFile } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { promisify } from "node:util";

import { betterAuth } from "better-auth";
import { verifyPassword } from "better-auth/crypto";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { integrationDatabaseUrl } from "../../scripts/integration-database";
import { buildAuthOptions } from "./auth-options.server";
import { parseServerEnvironment } from "./server-env";

const executeFile = promisify(execFile);
const configuredUrl = process.env.SVRGN_INTEGRATION_DATABASE_URL;
const origin = "https://vault.example.test";
const password = "Synthetic-integration-password-only-2026";

// Opt-in only: never read DATABASE_URL or create a pool during ordinary tests.
describe
	.skipIf(!configuredUrl)
	.sequential("real PostgreSQL account integration", () => {
		const schema = `svrgn_auth_it_${randomUUID().replaceAll("-", "")}`;
		let admin: pg.Pool;
		let pool: pg.Pool;
		let schemaCreated = false;
		let migrationUrl: string;

		beforeAll(async () => {
			const url = integrationDatabaseUrl(configuredUrl ?? "");
			admin = new pg.Pool({
				connectionString: url.href,
				max: 2,
				connectionTimeoutMillis: 5_000,
				statement_timeout: 10_000,
			});
			// Only this generated schema is created or removed by this suite.
			await admin.query(`create schema "${schema}"`);
			schemaCreated = true;
			const tables = await admin.query(
				"select tablename from pg_catalog.pg_tables where schemaname = $1",
				[schema],
			);
			expect(tables.rows).toEqual([]);
			// Exclude public so migrations and the auth adapter cannot touch its data.
			url.searchParams.set("options", `-c search_path=${schema},pg_catalog`);
			migrationUrl = url.href;
			await executeFile(process.execPath, ["scripts/migrate.mjs"], {
				env: { ...process.env, DATABASE_URL: migrationUrl },
				timeout: 30_000,
			});
			pool = new pg.Pool({
				connectionString: migrationUrl,
				max: 6,
				application_name: schema,
				connectionTimeoutMillis: 5_000,
				statement_timeout: 10_000,
			});
		}, 40_000);

		afterAll(async () => {
			await pool?.end();
			try {
				if (schemaCreated) await admin.query(`drop schema "${schema}" cascade`);
			} finally {
				await admin?.end();
			}
		});

		beforeEach(async () => {
			// No real network peer exists for handler(Request). Production deliberately
			// shares a per-path fallback bucket in that case. Reset only our schema's
			// rate-limit rows between sequential cases; keep limits enabled within each.
			await pool.query('delete from "rateLimit"');
		});

		const createAuth = (
			mode: "closed" | "open" | "invite-only",
			invitations: {
				email: string;
				tokenHash: string;
				expiresAt: string;
			}[] = [],
		) =>
			betterAuth(
				buildAuthOptions(
					parseServerEnvironment({
						NODE_ENV: "production",
						DATABASE_URL: migrationUrl,
						BETTER_AUTH_SECRET:
							"synthetic-integration-secret-with-at-least-32-characters",
						BETTER_AUTH_URL: origin,
						BETTER_AUTH_TRUSTED_ORIGINS: origin,
						SIGNUP_MODE: mode,
						SIGNUP_INVITATIONS: JSON.stringify(invitations),
					}),
					pool,
				),
			);

		type Auth = ReturnType<typeof createAuth>;
		const emailAddress = () => `${randomUUID()}@example.test`;
		const signup = (
			auth: Auth,
			email: string,
			invitation?: string,
			requestOrigin = origin,
		) =>
			auth.handler(
				new Request(`${origin}/api/auth/sign-up/email`, {
					method: "POST",
					headers: {
						"content-type": "application/json",
						origin: requestOrigin,
						...(invitation ? { "x-sovereignty-invite": invitation } : {}),
					},
					body: JSON.stringify({
						name: "Synthetic integration account",
						email,
						password,
					}),
				}),
			);

		const expectNoIdentity = async (email: string) => {
			const users = await pool.query('select id from "user" where email = $1', [
				email,
			]);
			expect(users.rows).toEqual([]);
			// Foreign keys prevent detached account/session rows; additionally reject
			// the email-based account identifier used by alternate auth providers.
			const accounts = await pool.query(
				'select id from "account" where "accountId" = $1',
				[email],
			);
			expect(accounts.rows).toEqual([]);
		};
		const identityCounts = async () =>
			(
				await pool.query(`select
				(select count(*)::int from "user") as users,
				(select count(*)::int from "account") as accounts,
				(select count(*)::int from "session") as sessions`)
			).rows;

		const cookieHeader = (response: Response) => {
			const cookies = response.headers
				.getSetCookie()
				.map((value) => value.split(";", 1)[0]);
			expect(
				cookies.some((cookie) =>
					cookie?.startsWith("__Secure-better-auth.session_token="),
				),
			).toBe(true);
			return cookies.join("; ");
		};
		const session = (auth: Auth, cookie: string) =>
			auth.handler(
				new Request(`${origin}/api/auth/get-session`, {
					headers: { cookie, origin },
				}),
			);

		it("closed mode rejects signup without persisting a user or account", async () => {
			const email = emailAddress();
			const before = await identityCounts();
			const response = await signup(createAuth("closed"), email);
			expect(response.status).toBe(400);
			await expectNoIdentity(email);
			expect(await identityCounts()).toEqual(before);
		}, 20_000);

		it("open signup stores a hash, authenticates with its cookie, and signout invalidates the session", async () => {
			const auth = createAuth("open");
			const email = emailAddress();
			const response = await signup(auth, email);
			expect(response.status).toBe(200);
			const cookie = cookieHeader(response);
			const created = await response.json();
			expect(created.user.email).toBe(email);
			const rows = await pool.query(
				'select a.password, a."providerId", s.id as "sessionId" from "account" a join "session" s on s."userId" = a."userId" where a."userId" = $1',
				[created.user.id],
			);
			expect(rows.rows).toHaveLength(1);
			expect(rows.rows[0].providerId).toBe("credential");
			expect(rows.rows[0].password).not.toBe(password);
			expect(
				await verifyPassword({ hash: rows.rows[0].password, password }),
			).toBe(true);
			const authenticated = await session(auth, cookie);
			expect(authenticated.status).toBe(200);
			expect(await authenticated.json()).toMatchObject({
				user: { id: created.user.id, email },
			});
			const signedOut = await auth.handler(
				new Request(`${origin}/api/auth/sign-out`, {
					method: "POST",
					headers: { cookie, origin, "content-type": "application/json" },
					body: "{}",
				}),
			);
			expect(signedOut.status).toBe(200);
			expect(await (await session(auth, cookie)).json()).toBeNull();
			const remaining = await pool.query(
				'select id from "session" where "userId" = $1',
				[created.user.id],
			);
			expect(remaining.rows).toEqual([]);
		}, 20_000);

		it.each([
			"missing",
			"wrong",
			"expired",
			"email-mismatch",
		] as const)("invite-only rejects %s proof without creating identity", async (scenario) => {
			const email = emailAddress();
			const before = await identityCounts();
			const token = randomBytes(32).toString("hex");
			const auth = createAuth("invite-only", [
				{
					email: scenario === "email-mismatch" ? emailAddress() : email,
					tokenHash: createHash("sha256").update(token).digest("hex"),
					expiresAt: new Date(
						Date.now() + (scenario === "expired" ? -60_000 : 600_000),
					).toISOString(),
				},
			]);
			const proof =
				scenario === "missing"
					? undefined
					: scenario === "wrong"
						? randomBytes(32).toString("hex")
						: token;
			const response = await signup(auth, email, proof);
			expect(response.status).toBe(403);
			expect(await response.text()).not.toContain(token);
			await expectNoIdentity(email);
			expect(await identityCounts()).toEqual(before);
		}, 20_000);

		it("accepts an email-bound invitation without persisting its proof or hash", async () => {
			const email = emailAddress();
			const token = randomBytes(32).toString("hex");
			const tokenHash = createHash("sha256").update(token).digest("hex");
			const auth = createAuth("invite-only", [
				{
					email,
					tokenHash,
					expiresAt: new Date(Date.now() + 600_000).toISOString(),
				},
			]);
			const response = await signup(auth, email, token);
			expect(response.status).toBe(200);
			const created = await response.json();
			expect(
				await (await session(auth, cookieHeader(response))).json(),
			).toMatchObject({ user: { email } });
			const rows = await pool.query(
				'select row_to_json(u) as "user", row_to_json(a) as account, row_to_json(s) as session from "user" u join "account" a on a."userId" = u.id join "session" s on s."userId" = u.id where u.id = $1',
				[created.user.id],
			);
			expect(rows.rows).toHaveLength(1);
			for (const value of [
				JSON.stringify(rows.rows),
				JSON.stringify(created),
			]) {
				expect(value).not.toContain(token);
				expect(value).not.toContain(tokenHash);
				expect(value).not.toContain(password);
			}
		}, 20_000);

		it("rejects an unexpected Origin without creating identity", async () => {
			const email = emailAddress();
			const before = await identityCounts();
			const response = await signup(
				createAuth("open"),
				email,
				undefined,
				"https://attacker.example.test",
			);
			expect(response.status).toBe(403);
			await expectNoIdentity(email);
			expect(await identityCounts()).toEqual(before);
		}, 20_000);

		it("persists and enforces the five-per-minute signup limit across auth instances", async () => {
			const auth = createAuth("closed");
			// Closed requests still consume the production signup rate-limit bucket.
			// This exercises the database limiter without creating five throwaway users.
			for (let index = 0; index < 5; index += 1) {
				expect((await signup(auth, emailAddress())).status).toBe(400);
			}
			const persisted = await pool.query('select count from "rateLimit"');
			expect(persisted.rows).toEqual([{ count: 5 }]);
			const response = await signup(createAuth("closed"), emailAddress());
			expect(response.status).toBe(429);
			expect(Number(response.headers.get("x-retry-after"))).toBeGreaterThan(0);
			expect((await pool.query('select count from "rateLimit"')).rows).toEqual([
				{ count: 5 },
			]);
		}, 20_000);
	});
