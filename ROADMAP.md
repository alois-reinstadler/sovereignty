# Roadmap

The phases are ordered around complete user journeys rather than isolated
feature lists. Each phase must retain backwards-compatible, versioned encrypted
data or include a tested migration.

Current development priority: desktop/macOS hardening and Expo/iOS. Disposable
PostgreSQL integration and the first native desktop vault flow pass CI.
Browser-extension development is paused at the user's request and
will resume later; its unfinished browser checks do not block the native-client
work. Sharing and organizations follow these client milestones.

Phases 0 and 1 are implemented as a development preview. Production readiness
still depends on the security and operational work in Phase 6.

## Phase 0 — Local vault milestone (implemented)

Deliver the core loop in web and desktop: create, unlock, browse, search, add,
edit, generate, copy, delete, lock, reload, and unlock again. Persist only a
versioned encrypted envelope. Establish automated crypto and domain tests.

This phase is a development preview and is not suitable for real secrets.

## Phase 1 — Self-hosted encrypted sync (development preview)

Add a deployable server and PostgreSQL configuration. The server authenticates
accounts and devices, stores opaque encrypted records, enforces revisions, and
supports incremental sync and conflict handling without receiving vault keys.
Include Docker Compose, health checks, migrations, backups, restore testing,
rate limiting, and an operator guide. The application paths are implemented;
live Docker/PostgreSQL isolation, idempotency, concurrent conflicts and signup
policies now pass disposable CI tests. Production deployment and disaster-recovery
drills remain release readiness work.

## Phase 2 — Browser extension and migration

The Chromium companion development slice implements explicit vault pairing,
exact-origin metadata matching, user-initiated filling into selected top-level
forms, a popup password generator, and reproducible ZIP packaging. Its pairing
session and plaintext are memory-only; restarting the worker or locking the vault
revokes authorization. See [the extension boundary](./docs/EXTENSION.md).
Explicit create/update review is implemented for opted-in submissions that keep
their document alive. Navigation discards capture, and the user must confirm
sign-in success before saving. Navigating-form capture, wider field support and
a Firefox transport remain follow-up work. Installed-browser integration and
independent auditing remain release gates.

Build WebExtension clients for Chromium and Firefox with safe URL matching,
autofill, save/update prompts, password generation, and communication with the
vault. Expand the implemented Chrome CSV importer to other password managers
and browsers while retaining duplicate review and encrypted backup workflows.

## Phase 3 — Desktop convenience

The local desktop vault now compiles on Linux/macOS and passes the Linux WebKit
create/save/lock/restore and native focus-loss flow. It uses the existing encrypted
formats and explicitly disables unavailable account/sync transport. Locked-screen
native encrypted backup dialogs and graceful OS close now pass Linux integration
tests. macOS interaction, native dependency advisory remediation and device-local
secure unlock remain release gates. See
[desktop verification](./docs/DESKTOP_VERIFICATION.md).

Add OS keychain-backed device unlock, biometrics where supported, global quick
access, tray/menu-bar behavior, auto-type where safe, signed packages, and a
reviewable update process. Keep the bundled UI local and the native permission
surface minimal.

## Phase 4 — Sharing and organizations

Introduce multiple vaults, member public keys, cryptographic invitations,
revocation, groups, roles, item history, and auditable administrative actions.
Server policy must complement—not replace—cryptographic access control.

## Phase 5 — Expo iOS client

The Expo workspace implements a local encrypted vault, login CRUD, search,
favourites, native password generation and manual/background locking. Its native
libsodium adapter passes 78 byte-exact interoperability checks in an iOS simulator,
including the existing v1/v2 encrypted formats, plus a real native filesystem
round-trip. The normal app also passes XCTest creation, exact text entry,
generated-password persistence, wrong-password rejection, background locking,
editing and deletion. It shares types and deterministic
fixtures without importing browser crypto into Hermes. See
[the mobile boundary](./docs/MOBILE_BOUNDARY.md) and
[native verification](./docs/IOS_TESTING.md).

Add encrypted backup transfer, native account/sync transport,
Keychain/Secure Enclave integration, biometric device unlock, offline sync, and
an iOS credential-provider extension. Native cryptography must remain compatible
with the versioned vault format. Physical-device secure-screen/biometric tests,
Android validation, signing and store publication are separate gates.

## Phase 6 — Security and release readiness

Complete the public threat model and recovery design, commission independent
cryptographic and application audits, add reproducible cross-client test
vectors, harden dependency and release provenance, run restore/disaster drills,
and publish a responsible disclosure process. Only audited releases may remove
the development-preview warning.
