# Sovereignty Desktop

The Tauri 2 desktop development client bundles the shared TanStack Start/Astryx
vault UI in an explicit local mode. It creates and unlocks the same encrypted
vault format, supports login CRUD, search, favorites, generation and clipboard
handling, and imports/exports encrypted `.svrgn` backups. Existing `@svrgn/*`
identifiers, storage keys, encrypted formats and protocol versions are unchanged.

This client is unaudited. Use invented credentials only. Successful compilation
does not establish production readiness or replace independent security review.

## Prerequisites and commands

Use Node.js 24+, pnpm 11.24.0, Rust stable and the platform packages listed in
the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/). Install with
`pnpm install --frozen-lockfile`; the flag rejects dependency drift.

From the repository root:

```sh
pnpm --filter @svrgn/desktop dev
pnpm --filter @svrgn/desktop build:web
pnpm --filter @svrgn/desktop tauri build --debug --no-bundle --no-sign
pnpm --filter @svrgn/desktop info
```

`--filter` selects the desktop workspace. `dev` starts Vite on the explicitly
configured loopback address `127.0.0.1:1420` and opens Tauri. `build:web` builds the
desktop target without Rust and verifies that `apps/web/dist/client/index.html`
has a module entry. The native command builds an unsigned development executable:
`--debug` selects the debug profile, `--no-bundle` omits installers, and `--no-sign`
disables signing. `info` reports tools; its exit code does not prove prerequisites
exist. Do not sign, notarize or publish without explicit approval.

`scripts/web.mjs` sets `VITE_SVRGN_CLIENT=desktop` for native build and dev. Tauri
bundles only static `apps/web/dist/client` files, never the SSR server. Ordinary
web build/dev retains the full web client. Both targets currently use the same
output directory; run `build:web` last when inspecting native assets.

For browser verification in the container, use the managed preview workflow:

```sh
dev-preview start sovereignty-desktop-main -- pnpm --filter @svrgn/desktop dev:web --host '{host}' --port '{port}' --strictPort
```

The manager substitutes its allocated host and port; `--strictPort` refuses
collisions. Open its reported localhost URL in shared Chrome and provide its
tailnet URL to users. Keep the main web preview running. This checks the desktop
web target, not native webview or OS behavior.

## Explicit local boundary

Desktop startup never mounts the account-session hook. Account, passkey, sync,
account restoration and extension companion components are unavailable, with an
English explanation on the local-vault screen and direct `/account` route. The
desktop app does not call nonexistent `/api/auth` or `/api/sync` endpoints. A future
reviewed self-hosted server transport is required; adding a CSP origin alone is
insufficient.

The vault persists encrypted in native webview local storage. No master password,
vault key, plaintext record or device-unlock material is saved through native
APIs. Development and bundled origins have separate browser storage; use an
encrypted backup to move a test vault between them. OS secure unlock is not
configured. Do not claim Keychain or hardware protection for this storage.

Website values remain copyable text. Native navigation permits only bundled
`tauri://localhost` or `http://tauri.localhost` authorities and the exact loopback
development origin in Tauri dev builds. New windows are denied. Remote documents,
external links, lookalikes, embedded credentials, arbitrary ports, `file:` and
`data:` navigation are refused. There is no opener/shell fallback or remote webview.

## Locking and native privileges

Window focus loss, hidden visibility, native focus loss, manual lock, inactivity
and native close revoke unlocked UI access. Rust dispatches only a fixed
`svrgn:desktop-lock` custom event with `native-blur` or `native-close`; no user text
is evaluated. Tests can listen to that event before a real OS action to prove that
the native notification reached JavaScript.

Locks invalidate in-progress key derivation and clear master-password,
confirmation and reveal drafts even while locked or creating a vault. The
credential form resets without unmounting the encrypted backup picker on an
already locked screen. Import while locked to keep file selection and overwrite
confirmation stable. Import from an unlocked screen may be interrupted by the
mandatory focus-loss lock; reopen Import backup from the locked screen if needed.

A lock during encryption immediately hides secret UI and denies new reads,
copies or saves. Key closure queues behind the started write. A clipboard write
finishing after revocation creates no retained entry; clearing the issued value is
attempted without overwriting another application's contents. Clipboard erasure
is browser/OS best-effort; JavaScript cannot guarantee memory zeroization.

The native close button and application Quit are intercepted. The only native
command, `desktop_close_ready`, acknowledges a pending close after vault locking.
The `allow-complete-close` capability is restricted to local `main`; an explicit
app command manifest enables permission enforcement. Rust rejects unsolicited,
wrong-window and duplicate acknowledgements. No broad core defaults, filesystem,
shell, dialog, opener, network, secure-storage or key commands are enabled. CSP
keeps scripts local and includes only `wasm-unsafe-eval` for existing libsodium
WebAssembly, not JavaScript `unsafe-eval`; IPC retains narrow transport origins.

Failed save/closure/acknowledgement leaves the window open. There is no timeout
that forcibly destroys an in-flight write. Retry after checking storage and the
last durable backup. OS force-kill, power loss or a crashed webview cannot be made
transactional by this handshake. If the frontend cannot acknowledge, the window
stays open instead of claiming its save completed safely.

## Verification and next milestones

Shared-client tests cover desktop/web session isolation, events and cleanup,
queued closure, late unlock refusal, auth draft revocation and clipboard races.
Existing crypto adapter tests cover write ordering and closing after successful
and failed saves. Rust tests cover exact navigation and single-use close approval.

This container lacks Rust/native WebKit prerequisites. The implementation agent
verified JavaScript tests, typing, formatting and desktop static assets locally.
Unsigned Linux/macOS builds and real Linux WebKit checks run separately in CI;
consult their results for the exact tested commit. Do not infer native runtime
verification from `info` or a Chrome preview. macOS needs runtime review in addition
to compilation.

Desktop/macOS now precedes Expo/iOS. Next: verify native boundaries, implement
explicit device-local unlock without weakening the master-password boundary, then
create an Expo workspace sharing schemas and deterministic protocol vectors.
Keychain/Secure Enclave and credential-provider work need platform-specific code.
Extension integration is paused and does not gate this desktop slice. No signing,
notarization, Apple enrollment or store publication is included.
