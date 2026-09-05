# Sovereignty mobile development client

This is an unaudited native development client. Use synthetic credentials only.
Native simulator acceptance is a required gate; a JavaScript export or Node test
does not prove native cryptographic compatibility. The first foundation commit
contains the native adapter and acceptance entry; persistent login management is
being completed in the following client increment.

Requires Node 24+, pnpm 11.24.0 and a native Expo development build. Expo Go does
not contain this patched JSI module. Expo 57.0.20 bundles React Native 0.86.3,
React 19.2.3, expo-file-system ~57.0.6 and TypeScript ~6.0.3. React DOM is pinned
locally only to satisfy Expo's optional peer resolution; it is not rendered on iOS.
Run `pnpm install --frozen-lockfile` from the repository root, then from this folder
run `pnpm exec expo install --check`, `pnpm typecheck`, `pnpm test` and `pnpm build`.
The build command exports the production iOS JavaScript bundle, not a signed app.

For local macOS development use `pnpm exec expo prebuild --platform ios` followed
by `pnpm exec expo run:ios`; `--platform ios` generates only the iOS project.
SDK 57 requires a current Xcode 26 toolchain and iOS 16.4+. Generated native
directories are ignored. No EAS account, store publication or signing is included.
The application name/scheme is Sovereignty; the development bundle identifier is
`app.svrgn.mobile`.

## Native acceptance entry

The normal `main` is `index.ts`. CI explicitly bundles `index.native-test.ts`
through `ENTRY_FILE` in a Release simulator build with `CODE_SIGNING_ALLOWED=NO`.
It runs the actual patched JSI primitives against the public fixtures in
`@svrgn/protocol-vectors`, then writes `Documents/native-test-result.json` in its
own app sandbox: `{schemaVersion:1,passed:boolean,checks:number,failures:string[]}`.
Failures contain bounded check names only. CI must require `passed: true`, an
empty failures array and the expected check count. This entry is never imported
by the regular app and has no runtime URL, message or network trigger.

Coverage includes Argon2id UTF-8/NUL byte passwords at minimum and interactive
costs; binary and empty AAD; sliced inputs; exact v1 document/key and v2 key/login/
tombstone encryption/decryption; authentication-tag, AAD, key and nonce tampering;
native rejection of 0/1/15-byte ciphertexts; caller-owned subarray zeroization;
and normal adapter v1 creation, unlock, rewrap and save. Current ordinary tests
exercise pure encoding and validation only, not native crypto.

## Native patch provenance and scope

`react-native-libsodium@1.7.0` is MIT, copyright Nikolaus Graf. The published
package includes libsodium under its ISC license. Both licenses remain in the
dependency; see upstream [source](https://github.com/serenity-kit/react-native-libsodium)
and [libsodium](https://github.com/jedisct1/libsodium). pnpm pins the registry
tarball integrity and the local patch hash in the lockfile.

The published `libsodium/build.tgz` SHA-256 is
`3fbed06822bee4939f5091cc4d4706ac890039116e288cd15f913c63f9b577b3`.
Its iOS simulator `libsodium.a` SHA-256 is
`a7e8af90a9d712ce8a2474f310e21682b690cb57c7ef74ce4b02dbfeeca62aa8`.
The vendored headers report **1.0.21**; upstream build.sh references
`libsodium-1.0.21-stable.tar.gz` and minisign verification. We have inspected these
artifacts, not independently rebuilt or audited the vendored binaries. Browser
fixtures were generated with libsodium 1.0.22; exact simulator vectors are the
cross-version compatibility gate.

The pnpm patch changes only native TypeScript/C++ boundaries: Uint8Array AAD is
passed byte-for-byte, including subarrays; ciphertext length is checked before
subtracting the tag size; memzero wipes the original ArrayBuffer slice rather
than a copy; RAII wipes temporary native derived keys and decrypted plaintext on
both return and failure. No algorithm, KDF cost, AAD or wire format changes.
The narrow adapter never falls back to browser/WASM crypto. Its synchronous JSI
Argon2 call can block the JS thread; React scheduling does not make that native
operation asynchronous.

## Boundaries

The master password is required for unlock. No vault keys, plaintext records or
master passwords belong in SecureStore, AsyncStorage or filesystem state. OS
secure storage and biometric unlock are deliberately absent. JS strings and
engine/native copies cannot be guaranteed to be erased; Uint8Array wiping is
best effort, not a secure-memory guarantee. Screen capture/app-switcher behavior
needs native verification on real devices before confidential use.

Native UI uses React Native primitives and Sovereignty's neutral Astryx palette.
Astryx's React DOM components do not render in React Native; no native component
parity is claimed. Authentication, sync transport, passkeys, Keychain unlock,
iOS AutoFill credential-provider entitlement/extension, Android validation and
store publication remain separate milestones. Self-hosted server compatibility
does not imply a native account or sync client exists yet.
