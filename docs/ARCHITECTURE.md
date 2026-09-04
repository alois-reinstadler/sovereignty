# Architecture

## Repository boundaries

```text
apps/web          TanStack Start application and future same-origin API
apps/desktop      Tauri 2 shell bundling the local web SPA
packages/vault-core  Framework-independent models, crypto, and use cases
packages/sync-protocol  Versioned ciphertext wire models and strict validation
```

Additional sync, protocol, platform, and shared-UI packages will be extracted
when their second consumer arrives. Until then, boundaries are kept explicit
without creating placeholder abstractions.

## Local milestone trust boundary

The master password is passed to the crypto layer only while creating or
unlocking a vault. Argon2id derives a wrapping key, which unwraps a random vault
key. The vault key encrypts the document with XChaCha20-Poly1305. Independent
nonces and contextual associated data are used for key wrapping and document
encryption.

Only a versioned encrypted envelope is persisted. The unlocked document and
vault key exist in process memory until the user locks the vault or the
inactivity timer expires.

The local milestone uses one encrypted document. Sync protocol v2 stores each
item or tombstone as an independently authenticated opaque record with an
explicit revision. The server owns only per-vault ordering cursors. It validates
the envelope and routing metadata but cannot distinguish a live item from an
encrypted tombstone or inspect any user field.

Mutation batches are serialized by locking their owned vault row and commit in
one PostgreSQL transaction. A stale base revision rejects the entire batch with
an explicit conflict. Mutation UUIDs and encrypted-request fingerprints make
retries idempotent while detecting reuse of a UUID for different ciphertext.

## Platform delivery

The web app uses TanStack Start SPA mode for the authenticated vault interface.
The Tauri application bundles that static output locally. It must never load a
remotely hosted application into a privileged webview. Native capabilities are
deny-by-default and added only for a concrete user-facing feature.

## Effect usage

Effect represents asynchronous cryptographic operations, typed failures, and
future storage/sync service dependencies. Ephemeral visual state remains normal
React state. This keeps failure and resource behavior explicit without making
the component tree dependent on Effect internals.
