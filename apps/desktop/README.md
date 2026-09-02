# SVRGN Desktop

This package wraps the shared `@svrgn/web` TanStack Start SPA in a Tauri 2
desktop window. It does not load remote application content and grants the
webview no native capabilities yet.

## Prerequisites

- Node.js and pnpm 11.24.0
- Rust stable with Cargo
- The platform dependencies from the
  [Tauri prerequisites guide](https://v2.tauri.app/start/prerequisites/)

Install JavaScript dependencies once from the repository root:

```bash
pnpm install
```

## Development

From the repository root, run:

```bash
pnpm --filter @svrgn/desktop dev
```

Tauri starts the shared web app on `127.0.0.1:1420` and opens it in the native
window. The loopback-only binding keeps the development server off the LAN.

## Production build

From the repository root, run:

```bash
pnpm --filter @svrgn/desktop build
```

The build command first builds `@svrgn/web`, then bundles its static
`apps/web/dist/client` output. The web build must emit `index.html` at that
location (its TanStack Start SPA shell output is configured accordingly).

To inspect the installed Tauri, Rust, and platform dependency versions, run:

```bash
pnpm --filter @svrgn/desktop run info
```

No filesystem, shell, dialog, opener, network-native, or other Tauri plugin is
enabled. Future native features should add a narrowly scoped permission to the
`main` capability instead of enabling a broad default capability.
