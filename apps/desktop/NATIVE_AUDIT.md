# Native dependency audit snapshot

Date: 2026-09-05. Lockfile: `apps/desktop/src-tauri/Cargo.lock` at code commit
`9a948c91c6511662a2b984d61d01af89b32c2cb7`. Tool: `cargo-audit 0.22.2`.

```sh
cargo audit --file apps/desktop/src-tauri/Cargo.lock --deny warnings --json
```

`--file` selects the native lockfile, `--deny warnings` makes informational
advisories fail the check, and `--json` emits machine-readable results.

The actual run exited **1**: **0 vulnerability-category findings, 16 unmaintained
warnings and 1 unsoundness warning**, across 432 lockfile packages. There were no
ignored advisories or target filters. The RustSec database contained 1,239
advisories at commit `5a0ebedfe8bdd2e295b171f4162f8c977bcad9a5`, updated
2026-09-02. These counts are a dated result, not a guarantee about later advisories.

| Package | Version | Advisory | Category |
| --- | --- | --- | --- |
| atk | 0.18.2 | [RUSTSEC-2024-0413](https://rustsec.org/advisories/RUSTSEC-2024-0413.html) | Unmaintained |
| atk-sys | 0.18.2 | [RUSTSEC-2024-0416](https://rustsec.org/advisories/RUSTSEC-2024-0416.html) | Unmaintained |
| gdk | 0.18.2 | [RUSTSEC-2024-0412](https://rustsec.org/advisories/RUSTSEC-2024-0412.html) | Unmaintained |
| gdk-sys | 0.18.2 | [RUSTSEC-2024-0418](https://rustsec.org/advisories/RUSTSEC-2024-0418.html) | Unmaintained |
| gdkwayland-sys | 0.18.2 | [RUSTSEC-2024-0411](https://rustsec.org/advisories/RUSTSEC-2024-0411.html) | Unmaintained |
| gdkx11 | 0.18.2 | [RUSTSEC-2024-0417](https://rustsec.org/advisories/RUSTSEC-2024-0417.html) | Unmaintained |
| gdkx11-sys | 0.18.2 | [RUSTSEC-2024-0414](https://rustsec.org/advisories/RUSTSEC-2024-0414.html) | Unmaintained |
| gtk | 0.18.2 | [RUSTSEC-2024-0415](https://rustsec.org/advisories/RUSTSEC-2024-0415.html) | Unmaintained |
| gtk-sys | 0.18.2 | [RUSTSEC-2024-0420](https://rustsec.org/advisories/RUSTSEC-2024-0420.html) | Unmaintained |
| gtk3-macros | 0.18.2 | [RUSTSEC-2024-0419](https://rustsec.org/advisories/RUSTSEC-2024-0419.html) | Unmaintained |
| proc-macro-error | 1.0.4 | [RUSTSEC-2024-0370](https://rustsec.org/advisories/RUSTSEC-2024-0370.html) | Unmaintained |
| unic-char-property | 0.9.0 | [RUSTSEC-2025-0081](https://rustsec.org/advisories/RUSTSEC-2025-0081.html) | Unmaintained |
| unic-char-range | 0.9.0 | [RUSTSEC-2025-0075](https://rustsec.org/advisories/RUSTSEC-2025-0075.html) | Unmaintained |
| unic-common | 0.9.0 | [RUSTSEC-2025-0080](https://rustsec.org/advisories/RUSTSEC-2025-0080.html) | Unmaintained |
| unic-ucd-ident | 0.9.0 | [RUSTSEC-2025-0100](https://rustsec.org/advisories/RUSTSEC-2025-0100.html) | Unmaintained |
| unic-ucd-version | 0.9.0 | [RUSTSEC-2025-0098](https://rustsec.org/advisories/RUSTSEC-2025-0098.html) | Unmaintained |
| glib | 0.18.5 | [RUSTSEC-2024-0429](https://rustsec.org/advisories/RUSTSEC-2024-0429.html) | Unsound |

The glib advisory concerns `VariantStrIter` and is fixed in glib 0.20 or newer.
Sovereignty does not directly call that iterator; its absence from application
source does not prove transitive native paths are unaffected. GTK3's compatible
dependency graph cannot be upgraded to that series by merely changing the pin.

A compatible maintained upstream stack and independent security review remain
release gates. No advisory was suppressed, no native crate was vendored, and no
incompatible GTK migration was attempted in the backup increment. The successful
Linux WebKit integration flow and unsigned Linux/macOS builds establish tested
development behavior, not production readiness or an advisory-free native stack.
The separately passing pnpm high-severity audit covers JavaScript dependencies.
