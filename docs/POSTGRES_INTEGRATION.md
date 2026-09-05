# Disposable PostgreSQL integration tests

The ordinary test suite uses scripted PostgreSQL responses. This separate,
explicitly requested path runs the actual migration script and sync store against
PostgreSQL 17. It requires Node.js 24+, pnpm, Docker Engine and Docker Compose v2.
It does not start Sovereignty or expose any host ports.

The repository's CI runs the same fixture in its **PostgreSQL integration** job
on pushes, pull requests and manual workflow runs. This uses the existing GitHub
Actions runner with read-only repository permissions and needs no repository
secrets or separately provisioned database. The fixture installs dependencies
inside its image, starts its isolated PostgreSQL service, and fails the job on
test or cleanup failure. Job timeout is 15 minutes.

From the repository root, run:

```sh
pnpm install --frozen-lockfile
node apps/web/scripts/postgres-integration.mjs
```

`--frozen-lockfile` refuses dependency resolution changes. The runner creates a
random Compose project and database, builds a test image from this checkout, waits
for PostgreSQL readiness, runs the integration suite, and removes only its own
containers, network and anonymous volumes in a `finally` block. A failed test,
missing Docker installation or failed cleanup returns a nonzero exit code.
SIGINT/SIGTERM trigger cleanup; a killed runner or stopped Docker daemon may leave
the printed disposable project behind. To remove that exact project, run:

```sh
docker compose --env-file /dev/null --file compose.integration.yaml --project-name <printed-project> down --volumes
```

`--env-file /dev/null` avoids loading repository environment values; `--file`
selects only the test fixture; `--project-name` selects the printed random project;
`--volumes` removes that disposable project's anonymous volumes. Set
`SVRGN_INTEGRATION_DATABASE` to the printed project's suffix with the prefix
`svrgn_integration_` when using this recovery command, because Compose validates
the file before cleanup. The script currently targets Linux/macOS Docker hosts.

## Isolation and safety

- PostgreSQL data lives in tmpfs. The fixture has no production volume references,
  host mounts, published ports, external networks, or fixed container names.
- The internal Compose network contains only the test runner and database. Trust
  authentication is intentional for this throwaway fixture; it is not a deployment
  example. No real account passwords, vault keys or credentials are used.
- `DATABASE_URL` is never used to select a test database. Only the explicit
  `SVRGN_INTEGRATION_DATABASE_URL` opts in; ordinary `pnpm test` skips database tests
  and still runs the database URL safety test.
- The tests reject nonlocal hosts, non-PostgreSQL schemes, URL query options, and
  databases not named `svrgn_integration_` followed by 32 lowercase hex characters.
  This naming check is a guardrail, not evidence that an arbitrary database is
  disposable. Use the Compose runner to create the database.
- Every test run creates a new random schema. Both migrations and store connections
  use that schema followed by `pg_catalog` in `search_path`, excluding `public`.
  Cleanup only drops the exact schema created by that run. The runner applies real
  checked-in migrations, with their existing checksum and advisory-lock behavior.

## What is checked

1. Migrations initialize an empty schema in a fresh database; all migration names
   and checksums match files, auth/passkey/sync tables exist, and a second execution
   preserves the migration ledger and timestamps.
2. Two real owners cannot pull, mutate, or take over each other's encrypted vault;
   key lookup and identical vault bootstrap remain owner scoped.
3. An identical mutation replays its original result; a reused mutation ID with
   changed ciphertext fails without consuming a cursor.
4. A conflict later in a batch rolls back earlier writes and the mutation ledger.
5. Two independent writer connections are held behind an actual PostgreSQL row
   lock. The test observes both waiting in `pg_stat_activity` before releasing the
   lock. Competing revisions produce exactly one winner and one revision conflict,
   with no extra cursor or mutation entry; simultaneous identical requests produce
   one application and one replay.

The suite exercises the storage and migration boundary. HTTP authentication,
cookie/session behavior and API validation remain covered by their separate tests;
this harness does not claim end-to-end authentication or browser coverage.

## Verification status

Docker is unavailable in the development container where this harness was added.
The guard test, TypeScript checks, ordinary tests and static review can run there;
the real PostgreSQL cases remain explicitly skipped until the command above exits
successfully on a Docker-capable machine. Do not report that skipped suite as a
successful database integration run or evidence of production readiness.
