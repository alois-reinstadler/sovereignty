# Sovereignty interoperability vectors

**All passwords, keys, salts, nonces and plaintext in this package are public,
synthetic test values. Never reuse them in a real vault.** The low-cost KDF case
exists to test interoperability quickly; it is not a recommended security policy.

This package exports committed JSON only, with no runtime dependencies. Import
`protocolVectors` from `@svrgn/protocol-vectors`, or load
`@svrgn/protocol-vectors/fixtures.json` directly. The TypeScript export is deeply
readonly at compile time. It does not load libsodium, Effect, DOM APIs or a native
module. Crypto implementations belong to the test harness's devDependencies.

The fixture includes explicit lowercase hex bytes and URL-safe base64 without
padding. Argon2id memory limits are **bytes**, output keys are 32 bytes, salts are
16 bytes, XChaCha nonces are 24 bytes, and combined ciphertext includes a 16-byte
Poly1305 tag. Password hex is the authoritative UTF-8 input, including embedded
NUL and Unicode; do not normalize, trim or reinterpret it. `argon2id13` is explicit,
not an algorithm-default alias. The second KDF case uses two operations and 64 MiB.

The complete v1 fixture includes a populated document and both exact JSON-derived
AAD byte sequences. The v2 key/login/tombstone fixtures retain stable formats and
binary length-prefixed AAD from `@svrgn/sync-protocol`. Revisions are decimal
**strings**, including values above JavaScript's safe-integer range and the maximum
PostgreSQL bigint. Never parse them as a JavaScript number.

## Verification and regeneration

Run `pnpm --filter @svrgn/protocol-vectors test`; `--filter` selects this workspace.
Normal tests compare fixed outputs against pinned libsodium-wrappers-sumo 0.8.4,
the actual vault-core implementation and the existing AAD encoder. They never
write fixtures. Tests also verify tag/AAD/key/nonce tampering and ciphertext shorter
than the tag. Exact outputs are necessary: encrypt/decrypt round trips alone can
hide two identically incompatible implementations.

Only an intentional format/vector review should run
`pnpm --filter @svrgn/protocol-vectors generate`; `--filter` selects this workspace.
This script explicitly sets `SVRGN_UPDATE_PROTOCOL_VECTORS=1` and runs only the
generator test. The generator uses fixed test byte sequences, IDs and timestamps.
Review every resulting fixture diff before committing. Regeneration does not
authorize a format change or make old ciphertext expendable.

## Required iOS/Hermes acceptance

No native compatibility is claimed by this package. A native runner must import
only the JSON and perform all of these checks in an actual development build:

1. Recompute both Argon2id outputs from the stored UTF-8 bytes and exact parameters.
2. Recompute and decrypt every AEAD payload: raw cases, v1 wrapped key/document,
   and v2 wrapped key/login/tombstone. Compare bytes, not merely parsed JSON.
3. Pass every byte input as a nonzero-offset `Uint8Array` view. Raw fixtures specify
   four prefix bytes, seven suffix bytes and `0xa5` sentinels; exclude those bytes
   from the operation. Include empty views and the binary AAD containing NUL,
   `0x80`, `0xff` and invalid UTF-8. AAD is bytes, never a decoded or base64 string.
4. Change one bit independently in ciphertext, tag, AAD, key and nonce. Require a
   recoverable authentication error with no plaintext output. Reject 0-, 1- and
   15-byte ciphertext without native crashes or unsigned allocation underflow.
5. Reproduce v1/v2 AAD and preserve decimal revisions above `2^53`; unlock the
   fixtures using the master password and verify parsed plaintext/schema identity.
6. Verify explicit lock, buffer clearing, application backgrounding and native
   allocation failures separately. Vectors cannot establish secret erasure or
   lifecycle safety. Fail safely if Argon2's memory allocation fails; never lower
   existing envelope parameters to make a device unlock it.

The unmodified react-native-libsodium 1.7.0 native wrapper and C++ bridge accept
string-only AAD despite wider TypeScript declarations. They need a reviewed byte
AAD patch before v2 compatibility testing. Expo Go or browser test success does
not exercise that patch; simulator execution must use the compiled native module.
The test recipe is in `test/build-vectors.ts`; it is never a production random
source and must not be bundled into the mobile app.
