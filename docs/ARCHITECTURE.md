# Architecture

## Repository boundaries

```text
apps/web          TanStack Start application and future same-origin API
apps/desktop      Tauri 2 shell bundling the local web SPA
packages/vault-core  Framework-independent models, crypto, and use cases
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

The local milestone uses one encrypted document. Encrypted record-level storage
with explicit item revisions is planned alongside sync so updates and conflicts
do not require replacing the complete vault payload.

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
