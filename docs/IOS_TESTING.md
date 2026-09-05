# Native iOS development verification

The iOS development workflow builds a local simulator application on the existing
GitHub macOS runner. It uses Xcode and CocoaPods directly, with Node 24 and pinned
pnpm dependencies. It does not enroll an Apple account, use EAS, sign a device
binary, publish an application artifact, or submit to a store.

Expo prebuild generates the iOS project with `--platform ios`; `--no-install`
keeps dependency installation explicit. CI copies the committed
`apps/mobile/native/Podfile.lock` into the generated project and runs CocoaPods
with `--deployment`, which refuses dependency changes. That lockfile came from
the first successful simulator run. Native updates require reviewing both pnpm
and CocoaPods resolution and rerunning the native gates.

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
the XCTest result bundle. Update and confirmed/cancelled deletion are exercised
as well, with at least four encrypted journal snapshots required. This stage uses another newly created simulator and
removes only that simulator afterward.

The UI harness types full strings and verifies each field before submitting.
A bulk XCTest typing burst on a loaded simulator reordered a title character
when the app echoed every keystroke through a controlled React Native input.
The regression gate requires exact text; pacing was only a diagnostic step.
Dictation and predictive-keyboard reliability on physical devices remain native
input acceptance work.

CI retains test reports, screenshots, build logs and the CocoaPods lockfile for
three days. Application binaries are excluded. Fixture passwords and keys are
public synthetic values; they must never be used for a real vault. Native test
results do not replace an independent security audit.

The initial crypto gate passed on iOS 26.5 at commit `81f9bd4`:
[run 33960127794](https://github.com/alois-reinstadler/sovereignty/actions/runs/33960127794).
It reported 78 checks with no failures. This result verifies the native adapter;
the normal application UI gate is tracked separately in the following increment.
The current acceptance entry adds a native filesystem create/update/restore
round-trip, for 79 required checks. It refuses to run storage fixtures in a
nonempty vault sandbox and reports bounded diagnostics only from synthetic data.
