# Native mobile boundary and remaining platform work

Sovereignty mobile is an unaudited, local development client. Native simulator
tests are a compatibility gate, not an independent security audit. Account sync,
device-assisted unlock and system AutoFill are not implemented in this slice.

The 2026-09-05 pnpm audit passes the high-severity threshold but reports one
moderate advisory, [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq),
in the `uuid` dependency of Expo's Xcode project tooling. The advisory concerns
buffer bounds in UUID v3/v5/v6. Mobile vault identifiers use native random bytes
through the application's UUID v4 implementation. The tooling dependency remains
unresolved; no cross-major override or advisory suppression was applied.

## Current trust boundary

The React Native/Hermes process owns the unlocked document and key. Native JSI
libsodium performs Argon2id and XChaCha20-Poly1305 using the existing v1 envelope
and exact associated-data bytes. Only ciphertext envelopes reach the filesystem.
The adapter rejects unsupported parameters, oversized inputs and noncanonical
base64url. Its patched native module validates short ciphertexts before allocation
and wipes owned byte buffers and temporary native secrets. Immutable JS strings,
engine copies and a compromised process remain outside that wiping guarantee.

Each save publishes a new encrypted snapshot; existing files are preserved.
An unpublished file is not a committed revision. A corrupt latest snapshot or
external writer causes failure rather than silent rollback or overwrite. Snapshot
retention is currently bounded by a 2,000-entry journal guard, with no automatic
pruning or rollback UI. Deleted logins remain in earlier encrypted snapshots.
There is no promise of filesystem durability after power loss without native
fsync and device testing.

The controller revokes sessions and pending plaintext references on manual lock
and AppState inactive/background events. Async completion cannot unlock a newer
session. Native Argon2id is synchronous: a blocked JS thread can delay processing
an OS lifecycle event. A native privacy cover installed before system snapshots,
secure screen handling and physical-device background races remain required
before confidential use. The app has no credential request deep links, remote
scripts, telemetry or automatic filling.

## Keychain and Secure Enclave design gate

Keep master-password unlock as the default and recovery path. A future optional
device unlock must be enrolled only after successful master-password unlock,
scope its wrapping material to this app and vault identifier, and authenticate
every use. Do not persist the master password or copy the unwrapped vault key
into ordinary preferences or files. A device wrapper is separate from the
portable password-wrapped envelope, so loss of a device does not change the
encrypted format.

For iOS, evaluate a non-synchronizing Keychain item with
`kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly` and an explicit access-control
policy, including biometric-enrollment invalidation where appropriate. Test
cancellation, missing passcode, enrollment changes, device restore, app reinstall,
and lock during authentication. Physical-device tests are mandatory; the
simulator cannot establish the hardware guarantee. See Apple's
[Keychain accessibility](https://developer.apple.com/documentation/security/ksecattraccessiblewhenpasscodesetthisdeviceonly)
and [current biometric set policy](https://developer.apple.com/documentation/security/secaccesscontrolcreateflags/biometrycurrentset).

Secure Enclave keys are hardware-managed asymmetric keys. The existing symmetric
libsodium vault key cannot simply be relocated into that API unchanged. Any
device wrapping design needs a separately reviewed construction and native
implementation. See Apple's
[Secure Enclave key protection](https://developer.apple.com/documentation/security/protecting-keys-with-the-secure-enclave).

## iOS credential-provider gate

System AutoFill requires a separate native credential-provider extension built
around `ASCredentialProviderViewController`, with the AutoFill entitlement on
the extension and containing app. It is a distinct process with its own lock,
authentication, cancellation and resource limits. Sharing an encrypted envelope
through a narrowly scoped app group must not create a shared plaintext store.
Only an explicitly selected credential may be returned for the OS-provided
service identity; page-supplied identifiers must not become authority. Metadata
published to the system credential identity store needs an explicit privacy
decision. See Apple's
[credential-provider controller](https://developer.apple.com/documentation/authenticationservices/ascredentialproviderviewcontroller).

Apple account enrollment, provisioned entitlements, signing, distribution and
store publication require the owner's separate approval. No enrollment or
publication is part of the current simulator workflow. Android compilation and
runtime validation are also outstanding; an Expo workspace alone does not prove
Android support.
