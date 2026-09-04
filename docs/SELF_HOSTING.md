# Self-hosting Sovereignty

This deployment foundation runs the TanStack Start server and PostgreSQL on
infrastructure you control. It exposes account authentication, a database-aware
health check, and authenticated protocol-v2 routes for opaque encrypted records.
Vault creation/key-envelope provisioning and client-side synchronization are
still separate unfinished milestones, so this is not a production password-
manager release.

## Security boundary

Sovereignty uses two independent secrets:

- The **account password** authenticates to Better Auth and crosses the network
  over TLS.
- The **vault master password** derives a local wrapping key. It must never be
  sent to Better Auth, stored in PostgreSQL, or placed in deployment variables.

Resetting an account password cannot recover a forgotten vault master password.
The server stores authentication data and, once sync is enabled, opaque
ciphertext plus record identifiers, revisions, sizes, and access timing. A
server that serves modified web JavaScript can still capture an unlocked vault,
so HTTPS, dependency review, and signed native clients remain part of the threat
model.

## Requirements

- Docker Engine with Docker Compose v2
- A DNS name and HTTPS reverse proxy for non-loopback deployments
- Durable storage and a tested off-host backup destination

Copy `.env.example` to `.env` and fill every blank value. The file is ignored by
Git. `BETTER_AUTH_URL` must be the exact public origin without a trailing slash.
`BETTER_AUTH_TRUSTED_ORIGINS` is a comma-separated allowlist of exact origins;
wildcards and URL paths are rejected at startup.

Passkeys default to the hostname and exact origin in `BETTER_AUTH_URL`. Set
`PASSKEY_RP_ID` only when multiple trusted subdomains should share a relying
party ID, and list their exact origins in `PASSKEY_ORIGINS`. Every passkey
origin must also appear in `BETTER_AUTH_TRUSTED_ORIGINS` and must equal or be a
subdomain of the relying-party ID. WebAuthn works on HTTPS origins and on the
special localhost development origin; a raw HTTP LAN or tailnet IP is not a
secure browser context and cannot use passkeys.

Generate `BETTER_AUTH_SECRET` with at least 32 high-entropy characters. It is a
server session secret, not a user password or vault master password. Set
`DATABASE_URL` to the `postgres` Compose service using the same database, user,
and password configured for that service.

## Start and upgrade

```bash
docker compose up --detach --build
```

`--detach` keeps the containers running after the command exits, and `--build`
rebuilds the application image before starting. Compose waits for PostgreSQL,
runs each checksum-protected SQL migration once, and only then starts the app.

Check readiness with:

```bash
docker compose ps
curl --fail --show-error https://vault.example.test/api/health
```

`--fail` makes HTTP errors return a failing exit code; `--show-error` retains the
diagnostic message. The health response intentionally contains no database or
secret details.

For upgrades, back up first, pull the reviewed source revision, then repeat the
start command. Never edit an applied migration: the migration runner rejects a
checksum mismatch. Add a new numbered migration instead.

## Back up and restore

An example logical backup is:

```bash
docker compose exec --no-TTY postgres pg_dump --format=custom --file=/tmp/svrgn.dump "$POSTGRES_DB"
docker compose cp postgres:/tmp/svrgn.dump ./svrgn.dump
```

`--no-TTY` produces automation-safe output and `--format=custom` creates a
compressed archive suitable for `pg_restore`. Encrypt the resulting file at
rest: authentication records remain sensitive even though vault contents are
client-encrypted.

Test restores against a separate empty deployment, never over the only live
database:

```bash
docker compose cp ./svrgn.dump postgres:/tmp/svrgn.dump
docker compose exec postgres pg_restore --clean --if-exists --no-owner --dbname="$POSTGRES_DB" /tmp/svrgn.dump
```

`--clean --if-exists` replaces objects already present, and `--no-owner` avoids
restoring ownership from another PostgreSQL instance. After restoration, run
the migrations service and verify `/api/health`; once encrypted sync exists,
also unlock and decrypt a restored record from a client.

## Reverse proxy requirements

Terminate TLS at a maintained reverse proxy, forward the original `Host` and a
single-value `X-Forwarded-For` header that the proxy overwrites, and proxy
Web/API traffic to the configured host port. Compose binds that port to host
loopback so clients cannot bypass the proxy and spoof the forwarding header. Do
not expose PostgreSQL. Keep the application and auth API on the same public
origin so session cookies do not require cross-origin relaxation.

No SMTP provider is required in this slice. Email verification and account
password recovery must remain disabled until an operator explicitly configures
a self-hosted or chosen mail service and the product communicates that account
recovery does not decrypt a vault.

## Encrypted sync API

The same-origin API exposes `GET /api/sync/v2/changes` and
`POST /api/sync/v2/mutations`. Both require a Better Auth session cookie and are
documented in [`docs/SYNC_API.md`](./SYNC_API.md). Keep the routes behind HTTPS;
never expose them as a separate cross-origin service with relaxed cookie rules.

The server stores ciphertext, nonces, record and vault identifiers, revisions,
cursors, mutation UUIDs, ciphertext fingerprints, sizes, and timestamps. It
does not receive a vault key, master password, decrypted item, or plaintext
deletion flag. Encrypted tombstones use the same record envelope and must be
retained so offline clients can observe deletion.

## Verification status

Unit tests validate environment, authentication, sync request handling, owner
scoping, paging, conflicts, idempotent retries, and transaction boundaries with
mocked PostgreSQL interfaces. Docker and PostgreSQL are unavailable in the
current development environment, so image construction, schema application,
concurrent transaction testing, and a backup/restore drill remain required
integration checks on a Docker-capable host.
