-- Better Auth passkey plugin schema. Credential public keys and identifiers are
-- account authentication data; they never contain a vault key or vault data.

create table if not exists "passkey" (
	"id" uuid primary key default pg_catalog.gen_random_uuid(),
	"name" text,
	"publicKey" text not null,
	"userId" uuid not null references "user" ("id") on delete cascade,
	"credentialID" text not null,
	"counter" integer not null,
	"deviceType" text not null,
	"backedUp" boolean not null,
	"transports" text,
	"createdAt" timestamptz not null default now(),
	"aaguid" text
);

create index if not exists "passkey_userId_idx" on "passkey" ("userId");
create index if not exists "passkey_credentialID_idx"
	on "passkey" ("credentialID");
