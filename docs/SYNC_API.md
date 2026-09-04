# Encrypted sync API v2

This API moves opaque protocol-v2 record envelopes between authenticated
Sovereignty clients. It never accepts plaintext vault fields or a vault key.
An encrypted tombstone is an ordinary record envelope whose meaning only a
client with the vault key can read.

This slice assumes that an owned `sync_vault` and its validated key envelope
already exist. A public vault bootstrap/key-envelope API is intentionally not
part of these record routes.

## Common behavior

- Both routes require a valid same-origin Better Auth session.
- `vaultId` is a required query parameter and every pushed envelope must carry
  the same vault ID.
- An absent vault and a vault owned by another account both return the same
  `404 vault_not_found` response.
- JSON responses use `Cache-Control: no-store`.
- Revisions and cursors are canonical decimal strings, never JSON numbers.
- Record ciphertext is URL-safe, unpadded base64 and is limited to 256 KiB.
- A request can contain at most 100 mutations and at most 4 MiB of JSON.

## Pull current encrypted records

```http
GET /api/sync/v2/changes?vaultId=VAULT_ID&cursor=0&limit=100
```

`cursor` defaults to `0`; `limit` defaults to `100` and cannot exceed `1000`.
The response is a cursor-ordered page:

```json
{
  "changes": [
    {
      "cursor": "12",
      "record": {
        "format": "svrgn-vault-record",
        "version": 2,
        "vaultId": "VAULT_ID",
        "recordId": "RECORD_ID",
        "revision": "3",
        "nonce": "URL_SAFE_BASE64",
        "ciphertext": "URL_SAFE_BASE64"
      }
    }
  ],
  "nextCursor": "12",
  "hasMore": false
}
```

The table is a compacted current-state feed: if one record changes repeatedly
before a client pulls, only its newest encrypted envelope is required. Clients
must continue with `nextCursor` until `hasMore` is false. The returned cursor
never moves backward, even if a caller supplies a cursor ahead of the server.

## Push encrypted mutations

```http
POST /api/sync/v2/mutations?vaultId=VAULT_ID
Content-Type: application/json
```

```json
{
  "mutations": [
    {
      "mutationId": "018f3d3e-8bb7-7cc8-8e02-3e8cad8d5b75",
      "baseRevision": "2",
      "record": {
        "format": "svrgn-vault-record",
        "version": 2,
        "vaultId": "VAULT_ID",
        "recordId": "RECORD_ID",
        "revision": "3",
        "nonce": "URL_SAFE_BASE64",
        "ciphertext": "URL_SAFE_BASE64"
      }
    }
  ]
}
```

`record.revision` must equal `baseRevision + 1`. The complete batch is applied
atomically in its given order. Successful results have status `applied`.
Retrying byte-for-byte equivalent validated content with the same mutation UUID
returns the original revision and cursor with status `replayed` and does not
write another record version.

If any base revision is stale, the whole batch rolls back and returns `409`:

```json
{
  "error": "revision_conflict",
  "message": "The record changed after the mutation base revision",
  "mutationId": "MUTATION_UUID",
  "recordId": "RECORD_ID",
  "expectedBaseRevision": "2",
  "currentRevision": "3"
}
```

The client should pull changes, decrypt and resolve the conflict locally, then
submit a new mutation UUID and revision. Reusing a mutation UUID with different
validated content returns `409 mutation_id_reused`. The server never chooses a
plaintext winner.
