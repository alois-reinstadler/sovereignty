# Security Policy

## Development status

SVRGN is currently a development preview. Do not use it to store real passwords,
recovery codes, private keys, or other sensitive information. The project has
not received an independent security audit and does not yet provide recovery,
backups, signed releases, or a stable encrypted-data compatibility guarantee.

## Reporting a vulnerability

Until a private disclosure channel is published, do not include exploit details
or real secrets in a public issue. Open a minimal issue asking the maintainers to
provide a private contact method.

## Security invariants

- Plaintext vault fields must never be written to persistent storage or logs.
- Authentication and vault decryption remain separate concerns.
- Encrypted formats include an explicit version and authenticated context.
- Wrong passwords and corrupted key-wrap data receive the same external error.
- Runtime assets are bundled locally; no third-party scripts or fonts execute in
  the vault application.
- Tauri capabilities remain least-privilege and do not permit remote content.
- Cryptographic changes require test vectors, migration coverage, and review.

Browser JavaScript cannot guarantee memory zeroization. A script executing in an
unlocked page can access decrypted data, so CSP, dependency integrity, and the
self-hosted web delivery path remain part of the threat model even with end-to-
end encryption.
