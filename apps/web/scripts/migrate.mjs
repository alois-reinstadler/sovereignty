import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Client } = pg;
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required for migrations");

const migrationDirectory = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"../migrations",
);
const files = (await readdir(migrationDirectory))
	.filter((file) => /^\d+_[a-z0-9_]+\.sql$/.test(file))
	.sort();
if (files.length === 0) throw new Error("No SQL migrations were found");

const client = new Client({ connectionString: databaseUrl });
await client.connect();

try {
	await client.query("select pg_advisory_lock(hashtext($1))", [
		"svrgn-schema-migrations",
	]);
	await client.query(`
		create table if not exists "svrgn_migration" (
			"name" text primary key,
			"checksum" text not null,
			"applied_at" timestamptz not null default now()
		)
	`);

	for (const name of files) {
		const sql = await readFile(resolve(migrationDirectory, name), "utf8");
		const checksum = createHash("sha256").update(sql).digest("hex");
		const existing = await client.query(
			'select "checksum" from "svrgn_migration" where "name" = $1',
			[name],
		);
		if (existing.rowCount === 1) {
			if (existing.rows[0]?.checksum !== checksum) {
				throw new Error(`Applied migration ${name} has changed`);
			}
			continue;
		}

		await client.query("begin");
		try {
			await client.query(sql);
			await client.query(
				'insert into "svrgn_migration" ("name", "checksum") values ($1, $2)',
				[name, checksum],
			);
			await client.query("commit");
			console.log(`Applied migration ${name}`);
		} catch (error) {
			await client.query("rollback");
			throw error;
		}
	}
} finally {
	await client
		.query("select pg_advisory_unlock(hashtext($1))", [
			"svrgn-schema-migrations",
		])
		.catch(() => undefined);
	await client.end();
}
