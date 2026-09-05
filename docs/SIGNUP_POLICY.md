# Operator-controlled signup

Sovereignty remains unaudited. Account authentication is separate from the vault
master password; never send a vault master password to the account server.

`SIGNUP_MODE` accepts `closed`, `invite-only`, or `open`. Production defaults to
`closed`; development and tests default to `open`. An invalid value prevents server
startup. Existing accounts can still sign in in every mode. Environment changes
require restarting the server. Set the mode explicitly in deployment configuration.

Closed mode disables Better Auth's email signup endpoint and rejects user creation
in its database hook. The hook also protects alternate Better Auth creation paths,
including future plugins and requests with no endpoint context. Direct operator
SQL access is outside this application policy boundary.

Invite-only mode allows only email signup with an unexpired, email-bound invitation
proof. It rejects other creation endpoints until they receive a reviewed invitation
integration. It does not use a public email allowlist or a shared signup password.
Open mode explicitly permits account creation subject to existing validation and
rate limiting; it does not verify ownership of an email address.

## Issuing an invitation

Create a fresh 32-byte random token per email using Node's `randomBytes(32)` and
encode it as 64 lowercase hexadecimal characters. Compute SHA-256 over the UTF-8
text of that hexadecimal token, **not** the raw random bytes. Store only its
lowercase hexadecimal hash in the server environment. Deliver the token to the
intended person over an independently authenticated channel. Do not put invitation
tokens in URLs, shell history, logs, tickets, or committed files.

`SIGNUP_INVITATIONS` is a JSON array with this shape (placeholders are not valid
configuration):

```json
[
  {
    "email": "invitee@example.test",
    "tokenHash": "<64 lowercase hexadecimal characters>",
    "expiresAt": "2026-09-06T00:00:00.000Z"
  }
]
```

Email matching trims whitespace and lowercases the whole address, matching Better
Auth's normalization; aliases and subdomains remain different addresses. Entries
must have unique emails and unique hashes, with at most 1,000 entries and a 256,000
character configuration limit. Timestamps must use the exact UTC ISO form above.
Missing/empty invitations admit nobody in invite-only mode. Keep validity short
(for example 24 hours) and remove entries promptly after account creation.

On the Create account screen, the invitee enters the token in the optional masked
invitation field. It is sent in `X-Sovereignty-Invite` on the same signup request
and cleared from component state after the request completes. API clients send
the same header to `POST /api/auth/sign-up/email`; never send the hash as the proof.
No invitation is added to a user record or client storage. Configure proxies and
observability tools to redact this header and avoid recording signup request data.

## Limits and first run

The invitation proves possession of the delivered bearer secret, **not** mailbox
ownership. Email verification infrastructure is not implemented. A stolen token
lets an attacker claim that one invited email before the intended person does.
Use HTTPS outside localhost and authenticate the recipient when delivering it.

This deliberately small policy has no invitation database or transactional token
consumption. Better Auth's unique user email prevents creating two current accounts
for the same email, but an invitation remains reusable until expiry/removal if that
account is deleted or changes its email. Remove the configured invitation before
such operations. Do not claim single-use or revocation without a server restart.

For a first production account, configure invite-only mode and one short-lived
invitation, register the account, remove the invitation, and return to closed mode.
Restart after each configuration change. Do not temporarily expose open signup just
to bootstrap one account. A local encrypted vault can still be used without an
account or PostgreSQL.

Tests cover policy parsing, expiry, email/proof binding, uniform denials, endpoint
restrictions, and Better Auth's actual user-creation hook. The
[PostgreSQL integration suite](./POSTGRES_INTEGRATION.md) also verifies account
creation/denial, hashed passwords, secure session cookies, signout, sign-in while
signup is closed, origin rejection and database-backed throttling in CI.
