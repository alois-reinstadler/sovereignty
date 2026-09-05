# Sovereignty

Sovereignty is an open-source, self-hostable password manager in active development.
The TanStack Start web app provides a local encrypted vault and optional
authenticated, end-to-end encrypted synchronization. Native development clients
use Tauri for desktop and Expo/React Native for iOS. Browser-extension work is
paused while these native clients are developed.

> **Development preview:** Do not store real credentials yet. The cryptographic
> design and implementation have not received an independent security audit.

## Current milestone

- Create and unlock a local encrypted vault
- Create, edit, search, favourite, and delete login items
- Generate passwords, reveal fields, and copy with best-effort clipboard clearing
- Manual and inactivity-based locking
- Import Chrome password CSV files locally, with duplicate review
- Export and restore encrypted Sovereignty backups
- Create accounts with Better Auth and manage passkeys
- Explicitly enable encrypted synchronization per device
- Queue encrypted offline changes, restore another device, and resolve conflicts
- Self-host the application and PostgreSQL with Docker Compose
- TanStack Start web application using Astryx
- Chromium Manifest V3 companion with explicit pairing and origin-bound filling
- Extension password generator, form selection, and reproducible ZIP packaging
- Explicit submitted-login create/update review for forms that keep their document open
- Tauri 2 local desktop vault with native focus-loss locking and a narrow close handshake
- Expo/iOS local vault with encrypted journal storage, login editing, search,
  favourites, native password generation and manual/background locking

The extension is an unaudited development slice; see its permissions, installation,
fixtures, and remaining boundaries in [docs/EXTENSION.md](./docs/EXTENSION.md).
Native account sync, device-assisted unlock, iOS system AutoFill, recovery,
sharing and audited production releases remain later work. See [ROADMAP.md](./ROADMAP.md).
The deployment boundary and operator instructions are in
[docs/SELF_HOSTING.md](./docs/SELF_HOSTING.md).

## Development

Requirements: Node.js 24+ and pnpm 11. Desktop development additionally needs
the Rust toolchain and Tauri's platform prerequisites.

```bash
pnpm install
pnpm dev
```

The web development server starts on the port printed in the terminal.

Run the complete verification suite with:

```bash
pnpm check
pnpm typecheck
pnpm test
pnpm build
pnpm build:extension
pnpm --filter @svrgn/extension verify:package
pnpm routes:check
pnpm audit:high
```

Build the native desktop package separately with `pnpm build:desktop` after
installing Rust and the platform dependencies listed in
[`apps/desktop/README.md`](./apps/desktop/README.md).

The mobile workspace requires a native development build; Expo Go does not
include the patched cryptographic module. `pnpm --filter @svrgn/mobile build`
exports its normal iOS JavaScript bundle. Actual simulator compilation and UI
verification use Xcode on macOS; see [mobile development](./apps/mobile/README.md),
[native verification](./docs/IOS_TESTING.md), and
[the mobile boundary](./docs/MOBILE_BOUNDARY.md).

`--filter` selects the named workspace; `verify:package` rebuilds twice and
compares ZIP hashes. Run `pnpm test:postgres` separately on a Docker-enabled host
for the isolated real-database suite. Ordinary tests report its skipped cases
explicitly; see [docs/POSTGRES_INTEGRATION.md](./docs/POSTGRES_INTEGRATION.md).

## Principles

- UI copy is English; code identifiers are English.
- Vault contents are encrypted on the client and plaintext is never persisted.
- Self-hosting is a product requirement, not an enterprise add-on.
- Crypto formats and network protocols are versioned for migration.
- Web, desktop, and Expo clients preserve domain contracts and encrypted formats.
- No analytics, remote fonts, or third-party runtime scripts in the vault app.

## License

Sovereignty is licensed under the GNU Affero General Public License v3.0. See
[LICENSE](./LICENSE).
