# Roadmap

The phases are ordered around complete user journeys rather than isolated
feature lists. Each phase must retain backwards-compatible, versioned encrypted
data or include a tested migration.

## Phase 0 — Local vault milestone

Deliver the core loop in web and desktop: create, unlock, browse, search, add,
edit, generate, copy, delete, lock, reload, and unlock again. Persist only a
versioned encrypted envelope. Establish automated crypto and domain tests.

This phase is a development preview and is not suitable for real secrets.

## Phase 1 — Self-hosted encrypted sync

Add a deployable server and PostgreSQL configuration. The server authenticates
accounts and devices, stores opaque encrypted records, enforces revisions, and
supports incremental sync and conflict handling without receiving vault keys.
Include Docker Compose, health checks, migrations, backups, restore testing,
rate limiting, and an operator guide.

## Phase 2 — Browser extension and migration

Build WebExtension clients for Chromium and Firefox with safe URL matching,
autofill, save/update prompts, password generation, and communication with the
vault. Add imports for common password managers and browsers, duplicate review,
and an encrypted export/recovery workflow.

## Phase 3 — Desktop convenience

Add OS keychain-backed device unlock, biometrics where supported, global quick
access, tray/menu-bar behavior, auto-type where safe, signed packages, and a
reviewable update process. Keep the bundled UI local and the native permission
surface minimal.

## Phase 4 — Sharing and organizations

Introduce multiple vaults, member public keys, cryptographic invitations,
revocation, groups, roles, item history, and auditable administrative actions.
Server policy must complement—not replace—cryptographic access control.

## Phase 5 — Expo iOS client

Reuse schemas, domain behavior, and protocol test vectors in an Expo app. Add
Keychain/Secure Enclave integration, biometric device unlock, offline sync, and
an iOS credential-provider extension. Native cryptography must remain compatible
with the versioned vault format.

## Phase 6 — Security and release readiness

Complete the public threat model and recovery design, commission independent
cryptographic and application audits, add reproducible cross-client test
vectors, harden dependency and release provenance, run restore/disaster drills,
and publish a responsible disclosure process. Only audited releases may remove
the development-preview warning.
