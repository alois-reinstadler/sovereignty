-- Detect accidental or malicious reuse of a mutation UUID for a different
-- encrypted request. Existing rows predate the public API and remain nullable;
-- every mutation written by the API includes a SHA-256 fingerprint.

alter table "sync_mutation"
	add column if not exists "request_fingerprint" text;

alter table "sync_mutation"
	drop constraint if exists "sync_mutation_request_fingerprint_check";

alter table "sync_mutation"
	add constraint "sync_mutation_request_fingerprint_check"
	check (
		"request_fingerprint" is null
		or "request_fingerprint" ~ '^[0-9a-f]{64}$'
	);
