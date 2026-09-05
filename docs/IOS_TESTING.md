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

Both native gates passed on iOS 26.5 at commit `37e5bb3`:
[run 33983047110](https://github.com/alois-reinstadler/sovereignty/actions/runs/33983047110).
The acceptance entry reported 79 checks with no failures: 78 cryptographic
compatibility checks and a real native filesystem create/update/restore round-trip.
It refuses to run storage fixtures in a nonempty vault sandbox and reports
bounded diagnostics only from synthetic data.

The normal application XCTest passed creation, exact burst text entry, password
reveal/hide and generated replacement, login persistence after termination,
wrong-password rejection with input clearing, unlock, OS background locking,
editing, cancelled deletion, confirmed deletion and restoration of the empty
vault. The separate filesystem inspection required at least four encrypted
snapshots without fixture plaintext; application logs contained no JavaScript
exceptions. Screenshots and accessibility attachments were reviewed.

[Full CI run 33983047150](https://github.com/alois-reinstadler/sovereignty/actions/runs/33983047150)
also passed formatting, TypeScript, 437 ordinary tests, the production web build,
generated routes, normal iOS bundle export, existing extension packaging checks,
the high-severity pnpm audit and 16 separate real PostgreSQL integration checks.
The audit still reports the moderate tooling advisory documented in
[the mobile boundary](./MOBILE_BOUNDARY.md). This establishes a native development
milestone, not physical-device security or production readiness.
