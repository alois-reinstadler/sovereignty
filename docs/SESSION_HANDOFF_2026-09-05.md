# Development handoff — 2026-09-05

Sovereignty remains an unaudited development preview. Use synthetic credentials.
This session pulled public `main` with `--ff-only` from `3f44764`, preserved
encrypted formats and internal identifiers, and added these milestones:

| Commit | Result |
| --- | --- |
| `5d04193` | Strict companion protocol, exact origin normalization and expiring capabilities |
| `d9e57e4` | Explicit unlocked-web-vault pairing and lock propagation |
| `1f293cb` | Chromium MV3 worker, popup, content script and explicit selected-form filling |
| `74db899` | Monorepo builds, browser fixtures and deterministic ZIP packaging |
| `0458661` | Isolated Docker/PostgreSQL integration harness |
| `70067ca` | Closed, invite-only and open signup policies with expiring email-bound invites |
| `dbc48ea` | Compose signup configuration and operator documentation |
| `6adf8ca` | Browser-authenticated document origins and bounded fill acknowledgements |
| `99c3b21` | Fixture checks and reviewed boundary documentation |
| `a50493e` | Artifact permission checks and two-build ZIP reproducibility gate |
| `29c2e61` | Explicit submission watch, separate vault approval and encrypted create/update |

The extension also includes a cryptographic popup password generator, multiple
account/form choices, keyboard-operable controls and a Firefox portability
assessment. Save/update supports opted-in submissions that retain the original
document. Navigation discards capture; submission does not prove login success.

## Verification

- 305 automated tests passed; six real-PostgreSQL cases skipped explicitly.
- Formatting, TypeScript, complete tests, web production build, generated routes,
  extension build and high-severity dependency audit passed. Audit reported no
  known vulnerabilities. Existing large-bundle build warnings remain.
- Two independent extension builds produced the same ZIP SHA-256:
  `84928fc071209bc0e334d47f8d9e9f7861270548ee90862a2172e25fadbcc052`.
  Output: `apps/extension/dist` and `apps/extension/sovereignty-chromium.zip`.
- Reviewed source changes and a separate agent's security review found and fixed
  document-origin, plaintext-lifetime and capture-acknowledgement issues. Review
  authority stays unavailable before a valid acknowledgement; failure discards
  the associated candidate. This was development review, not an independent audit.
- New commits were checked for common secret patterns; only the unpopulated
  `.env.example` is tracked. A pattern scan cannot establish absence of secrets.

## Browser evidence and limits

Used the shared Chrome through the approved browser tools, isolated synthetic
vaults and test credentials. Inspected accessibility snapshots, screenshots,
console and network activity and closed every opened page.

The actual DOM discovery/fill module found two distinct eligible login forms,
filled only the chosen form and rejected stale handles, replaced DOM and readonly
fields. Embedded, ambiguous and cross-origin-action forms were excluded. The
submission module captured only the opted-in form once; unrelated submissions,
replay and replaced forms produced no additional capture or network traffic.

The actual popup ran against a visibly labelled synthetic runtime fixture.
Pairing states, editable origin, keyboard form selection, explicit fill,
generator expiry and watch → candidate → review were exercised. The actual web
companion ran with a synthetic external port: explicit create/update persisted
an encrypted envelope, reload restored the updated login, discard/expiry made
no storage change, and locking removed review and disconnected the port. Pending
passwords were absent from review markup and plaintext absent from local storage.
These fixtures do not establish installed-extension transport correctness.

Unpacked extension loading was blocked because the approved browser upload tool
rejected the root and worktree `dist` directories as outside its configured
workspace roots. No extension was installed. The real `activeTab`, external-port
handshake, service-worker lifecycle and end-to-end browser integration still need
an installed-Chromium run. Fix the browser tool's workspace configuration or load
the unpacked directory manually using [the extension guide](./EXTENSION.md).

The managed preview remains `sovereignty-main` at
<http://100.64.0.2:4044/>; browser tools use <http://127.0.0.1:4044/>.
It was restarted after protocol exports changed to clear stale Vite modules.
The final fixture views had no console errors. The web account-session request
still returns HTTP 500 because PostgreSQL is unavailable. Passkey ceremonies
remain unsupported on the raw HTTP tailnet IP.

## Next work, ordered

1. Run installed-Chromium pairing/fill/capture adversarial integration and fix
   findings before expanding transport authority. Obtain independent review before
   storing real credentials. Navigating-form capture needs a reviewed document
   handoff; Firefox needs a separate manifest/transport and native browser tests.
2. Run `pnpm test:postgres` on a Docker-enabled host. The current container has no
   Docker, so empty-database migrations, owner isolation, idempotency and real
   concurrent revisions have runnable tests but no live database verification.
   Follow [the integration guide](./POSTGRES_INTEGRATION.md). Test real signup
   modes and passkey ceremonies there; configure HTTPS for non-localhost use.
3. Continue the Tauri/macOS client once browser boundaries are verified. `tauri info`
   reports missing Rust, Cargo, WebKitGTK and librsvg here. Native builds, secure
   device unlock storage and a separate authenticated extension host are not
   implemented or verified. See [desktop limitations](../apps/desktop/README.md).
4. Add Expo/iOS only after those boundaries are stable. Share schemas and fixed
   protocol vectors; implement and test native cryptography and Keychain separately.
   Secure Enclave and credential-provider entitlements need device/platform work.

No production infrastructure, extension store, app store, signing service or
external service was configured or published. Production deployment, store
publication, purchases, signing/account enrollment and any new external service
still require approval. Routine repository commits and public-main pushes were
authorized for this session.
