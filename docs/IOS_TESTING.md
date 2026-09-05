# Native iOS development verification

The iOS development workflow builds a local simulator application on the existing
GitHub macOS runner. It uses Xcode and CocoaPods directly, with Node 24 and pinned
pnpm dependencies. It does not enroll an Apple account, use EAS, sign a device
binary, publish an application artifact, or submit to a store.

Expo prebuild generates the iOS project with `--platform ios`; `--no-install`
keeps dependency installation explicit. CocoaPods then resolves the native
dependencies. The first successful native run supplies a lockfile for subsequent
dependency pinning; until that lockfile is committed, native resolution is not
fully reproducible.

The workflow builds the separate `index.native-test.ts` entry with the Release
configuration and simulator SDK. `ENTRY_FILE` selects only that test entry;
`CODE_SIGNING_ALLOWED=NO` and `CODE_SIGNING_REQUIRED=NO` disable signing. Normal
application startup uses the package's ordinary entry. The test entry is not a
remote endpoint or a deep link into a real vault.

`scripts/native/ios-test.mjs` creates its own simulator, installs the synthetic
test build, and reads a bounded result from that app's Documents directory. It
requires native byte-for-byte cryptographic checks to succeed, takes a screenshot,
and shuts down/deletes only its own simulator. A Node test or Expo web export does
not satisfy this native gate. Simulator success also does not establish physical
device biometric, Keychain, Secure Enclave, or credential-provider behavior.

The following stage rebuilds the normal `index.ts` application and a separate
XCTest UI target. The Ruby generator uses CocoaPods' Xcodeproj library and changes
only the disposable generated project. XCTest enters synthetic passwords through
native controls, creates a vault, generates and saves a login, verifies persistence
after termination, and backgrounds the editor through the operating system.
The harness then checks the app's journal contains encrypted v1 envelopes without
the synthetic plaintext markers. Accessibility trees and screenshots accompany
the XCTest result bundle. This stage uses another newly created simulator and
removes only that simulator afterward.

CI retains test reports, screenshots, build logs and the CocoaPods lockfile for
three days. Application binaries are excluded. Fixture passwords and keys are
public synthetic values; they must never be used for a real vault. Native test
results do not replace an independent security audit.
