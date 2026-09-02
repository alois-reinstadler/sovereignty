# SVRGN

SVRGN is an open-source, self-hostable password manager in active development.
The first milestone is a local encrypted vault shared by a TanStack Start web app
and a Tauri desktop shell.

> **Development preview:** Do not store real credentials yet. The cryptographic
> design and implementation have not received an independent security audit.

## Current milestone

- Create and unlock a local encrypted vault
- Create, edit, search, favourite, and delete login items
- Generate passwords, reveal fields, and copy with best-effort clipboard clearing
- Manual and inactivity-based locking
- TanStack Start web application using Astryx
- Tauri 2 desktop packaging scaffold

Cloud sync, recovery, sharing, browser autofill, imports, and mobile apps are not
part of this milestone. See [ROADMAP.md](./ROADMAP.md).

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
```

## Principles

- UI copy is English; code identifiers are English.
- Vault contents are encrypted on the client and plaintext is never persisted.
- Self-hosting is a product requirement, not an enterprise add-on.
- Crypto formats and network protocols are versioned for migration.
- Web, desktop, and future Expo clients share domain contracts.
- No analytics, remote fonts, or third-party runtime scripts in the vault app.

## License

The project license is not selected yet. Choose one before accepting external
contributions or publishing releases.
