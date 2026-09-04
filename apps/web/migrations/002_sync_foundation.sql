-- Opaque sync storage. The server stores authenticated ciphertext and routing
-- metadata only; it has no vault keys and no plaintext deletion flag.

create table if not exists "sync_vault" (
	"id" text primary key check (octet_length("id") between 1 and 128),
	"owner_user_id" uuid not null unique
		references "user" ("id") on delete cascade,
	"protocol_version" integer not null default 2
		check ("protocol_version" = 2),
	"key_revision" bigint not null default 1 check ("key_revision" > 0),
	"key_envelope" jsonb not null
		check (jsonb_typeof("key_envelope") = 'object'),
	"next_cursor" bigint not null default 0 check ("next_cursor" >= 0),
	"created_at" timestamptz not null default now(),
	"updated_at" timestamptz not null default now()
);

create table if not exists "sync_record" (
	"vault_id" text not null references "sync_vault" ("id") on delete cascade,
	"record_id" text not null
		check (octet_length("record_id") between 1 and 128),
	"revision" bigint not null check ("revision" > 0),
	"cursor" bigint not null check ("cursor" > 0),
	"crypto_version" integer not null default 2 check ("crypto_version" = 2),
	"nonce" bytea not null check (octet_length("nonce") = 24),
	"ciphertext" bytea not null
		check (
			octet_length("ciphertext") >= 16
			and octet_length("ciphertext") <= 262144
		),
	"created_at" timestamptz not null default now(),
	"updated_at" timestamptz not null default now(),
	primary key ("vault_id", "record_id"),
	unique ("vault_id", "cursor")
);

create index if not exists "sync_record_changes_idx"
	on "sync_record" ("vault_id", "cursor");

create table if not exists "sync_mutation" (
	"vault_id" text not null references "sync_vault" ("id") on delete cascade,
	"mutation_id" uuid not null,
	"record_id" text not null,
	"resulting_revision" bigint not null check ("resulting_revision" > 0),
	"resulting_cursor" bigint not null check ("resulting_cursor" > 0),
	"created_at" timestamptz not null default now(),
	primary key ("vault_id", "mutation_id"),
	foreign key ("vault_id", "record_id")
		references "sync_record" ("vault_id", "record_id") on delete cascade
);

create index if not exists "sync_mutation_created_at_idx"
	on "sync_mutation" ("vault_id", "created_at");
