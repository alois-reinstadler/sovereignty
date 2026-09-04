-- Better Auth 1.7.2 core schema for PostgreSQL. Identifiers intentionally
-- preserve Better Auth's configured model and field names.

create table if not exists "user" (
	"id" uuid primary key default pg_catalog.gen_random_uuid(),
	"name" text not null,
	"email" text not null unique,
	"emailVerified" boolean not null default false,
	"image" text,
	"createdAt" timestamptz not null default now(),
	"updatedAt" timestamptz not null default now()
);

create table if not exists "session" (
	"id" uuid primary key default pg_catalog.gen_random_uuid(),
	"expiresAt" timestamptz not null,
	"token" text not null unique,
	"createdAt" timestamptz not null default now(),
	"updatedAt" timestamptz not null default now(),
	"ipAddress" text,
	"userAgent" text,
	"userId" uuid not null references "user" ("id") on delete cascade
);

create index if not exists "session_userId_idx" on "session" ("userId");

create table if not exists "account" (
	"id" uuid primary key default pg_catalog.gen_random_uuid(),
	"issuer" text not null,
	"accountId" text not null,
	"providerId" text not null,
	"userId" uuid not null references "user" ("id") on delete cascade,
	"accessToken" text,
	"refreshToken" text,
	"idToken" text,
	"accessTokenExpiresAt" timestamptz,
	"refreshTokenExpiresAt" timestamptz,
	"scope" text,
	"password" text,
	"createdAt" timestamptz not null default now(),
	"updatedAt" timestamptz not null default now(),
	constraint "account_issuer_accountId_uidx" unique ("issuer", "accountId")
);

create index if not exists "account_userId_idx" on "account" ("userId");

create table if not exists "verification" (
	"id" uuid primary key default pg_catalog.gen_random_uuid(),
	"identifier" text not null,
	"value" text not null,
	"expiresAt" timestamptz not null,
	"createdAt" timestamptz not null default now(),
	"updatedAt" timestamptz not null default now()
);

create index if not exists "verification_identifier_idx"
	on "verification" ("identifier");

create table if not exists "rateLimit" (
	"id" uuid primary key default pg_catalog.gen_random_uuid(),
	"key" text not null unique,
	"count" integer not null,
	"lastRequest" bigint not null
);
