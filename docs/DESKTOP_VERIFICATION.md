# Desktop development verification — 2026-09-05

Verified code commit: `3f5fece`. [Native CI run 33959022464](https://github.com/alois-reinstadler/sovereignty/actions/runs/33959022464)
passes unsigned, unbundled Linux and macOS compilation and Rust navigation/close
authorization tests. No application binaries were published.

The compiled Linux application runs in WebKit at `tauri://localhost`. Its test
creates a vault, generates a password, saves a login, checks that persisted data
excludes fixture plaintext, locks, reloads, unlocks the same saved vault, and
minimizes/restores the native window to prove focus-loss locking. The final
structural UI report contains no script errors and no account/sync requests.
Screenshots and test reports are retained with the CI run for three days.

[Full CI run 33959022456](https://github.com/alois-reinstadler/sovereignty/actions/runs/33959022456)
passes formatting, TypeScript, 387 ordinary automated tests, production web build,
generated routes, existing extension packaging regression checks, dependency audit,
and the separate 16-test real PostgreSQL integration suite. Ordinary tests skip
15 opt-in database cases and the explicit vector-regeneration case; PostgreSQL CI
runs the database cases against disposable real databases.

Shared-Chrome verification also exercised the desktop target's create/save,
generator, favourites, search, lock/reload/unlock and auth-draft revocation flows.
The final 1180×760 layout keeps the lock control visible. Accessibility snapshots,
console and network activity were inspected; all opened pages were closed.

Review fixes include platform-specific bundled navigation, atomic clipboard
registration with session revocation, lazy HTTP auth initialization, and client
mounting after Tauri modifies packaged HTML. Native IPC permits only a pending
close acknowledgement from the local main window. The permission does not expose
files, networking, vault keys, or shell commands.

This is a development milestone, not production readiness. macOS interaction,
native backup dialogs, OS secure unlock/biometrics, native account/sync transport,
physical-device behavior and an independent audit remain separate work. The close
queue is unit-tested; the automated native flow above proves focus-loss behavior,
not OS force-kill durability. The web preview remains available separately and
still requires PostgreSQL for account-session calls in this container.
