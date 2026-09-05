# Desktop development verification — 2026-09-05

Verified code commit: `f8293e3`. [Native CI run 33983223487](https://github.com/alois-reinstadler/sovereignty/actions/runs/33983223487)
passes unsigned, unbundled Linux and macOS compilation and Rust navigation/close
authorization tests. No application binaries were published.

The compiled Linux application runs in WebKit at `tauri://localhost`. Its test
creates a vault, generates a password, saves a login, checks that persisted data
excludes fixture plaintext, locks, reloads, unlocks the same saved vault, and
minimizes/restores the native window to prove focus-loss locking. The final
structural UI report contains no script errors and no account/sync requests.
The 18-check flow also rejects plaintext through real native IPC, cancels and
retries the OS save dialog, compares exported bytes with the encrypted envelope,
imports through the OS file dialog with explicit replacement confirmation, and
closes through the window manager to verify the lock acknowledgement and process
exit. Backups require an explicit lock before opening a native dialog so focus
loss cannot unmount an import callback. Screenshots and test reports are retained
with the CI run for three days.

The clipboard checks click the real username/password Copy controls and inspect
the private X11 clipboard independently. Lock clears Sovereignty's copied value
and preserves a value subsequently replaced by another process. This does not
establish macOS clipboard behavior; permission failures can still prevent
best-effort clearing on other operating systems.

[Full CI run 33960851627](https://github.com/alois-reinstadler/sovereignty/actions/runs/33960851627)
passes formatting, TypeScript, 394 ordinary automated tests, production web build,
generated routes, existing extension packaging regression checks, dependency audit,
and the separate 16-test real PostgreSQL integration suite. Ordinary tests skip
15 opt-in database cases and the explicit vector-regeneration case; PostgreSQL CI
runs the database cases against disposable real databases.

Shared-Chrome verification also exercised the desktop target's create/save,
generator, favourites, search, lock/reload/unlock and auth-draft revocation flows.
The final 1180×760 layout keeps the lock control visible. Accessibility snapshots,
console and network activity were inspected; all opened pages were closed.
The backup follow-up also verifies that unlocked desktop views explain the lock
requirement and that a browser preview reports the missing native bridge clearly.

Review fixes include platform-specific bundled navigation, atomic clipboard
registration with session revocation, lazy HTTP auth initialization, and client
mounting after Tauri modifies packaged HTML. Native IPC permits a pending close
acknowledgement and two bounded encrypted-backup commands from the local main
window. Paths originate in OS dialogs, exports never overwrite existing files,
and imports validate a bounded regular file. No general filesystem, networking,
vault-key or shell-command permission is exposed.

This is a development milestone, not production readiness. macOS interaction,
OS secure unlock/biometrics, native account/sync transport,
physical-device behavior and an independent audit remain separate work. The close
queue is unit-tested and graceful OS close is exercised; neither establishes
force-kill durability. The [native RustSec audit](../apps/desktop/NATIVE_AUDIT.md)
has 16 unmaintained warnings and one glib unsoundness warning, so its strict
warning-free gate does not pass. The web preview remains available separately and
still requires PostgreSQL for account-session calls in this container.
