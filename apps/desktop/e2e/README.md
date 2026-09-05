# Native desktop verification

The `Desktop development` workflow compiles Linux and macOS development executables with the committed Rust lockfile. `--debug` selects the development profile, `--no-bundle` skips installers, `--no-sign` disables signing, `--ci` disables interactive prompts, and the forwarded `--locked` rejects dependency resolution changes. The workflow does not publish application binaries.

Linux also drives the compiled application with `tauri-driver` 2.0.6 and WebKitWebDriver in a private Xvfb display. Openbox and xdotool exercise a real native focus change. This test never connects to the shared Chrome session. macOS currently receives compilation and Rust tests; this Linux test does not establish macOS UI or Keychain behavior.

After installing the native prerequisites listed in the workflow and building the development executable, run from the repository root:

```sh
cargo install tauri-driver --version 2.0.6 --locked
xvfb-run -a node apps/desktop/e2e/native-vault.mjs
```

`--version` pins the test bridge, `--locked` preserves its dependency resolution, and `-a` allocates a free private display. The test creates temporary XDG storage directories and uses synthetic credentials only. It deletes only those directories and shuts down its own application, driver, and window manager in cleanup.

The test checks native rendering, vault creation, password generation, encrypted login persistence, manual locking, restoration after reload, and locking on native focus loss. It checks that desktop mode does not call unsupported account or sync endpoints. Screenshots, a structural DOM summary, test results, and driver output go to the ignored `artifacts/` directory and are retained in CI for three days. They contain synthetic fixture data, never application binaries.

This is a development regression test, not an independent security audit. Physical macOS/iOS behavior, platform credential protection, backup/restore dialogs, and operating-system force termination need separate verification.
