# Changelog

Consumer-facing detail and migration steps live in `UPGRADING.md`.

## utils-content-crypto 0.3.1 — 2026-11-09

### `planDrain` gains an optional `supersededBefore`
- A drain is refused unless the generation being drained stopped being current
  strictly before the supplied instant. Absent, the planner behaves exactly as
  before, which is why this is a patch and not a minor.
- The clock is the **successor's** `createdAt` — a generation stops being current
  when the next one is minted, and `retiredAt` cannot serve because `planDrain`
  is what sets it. Only `through` is checked; it is the youngest generation in
  the drain, so one comparison covers the set.
- An absent or undated successor, or an unparseable instant, is a
  `VALIDATION_ERROR`. An operation that erases wraps fails closed.
- The window is caller-supplied rather than configured here: an install with no
  backups may drain immediately and correctly, and the package cannot know which
  kind of install it is in.

## utils-content-crypto 0.3.0 — 2026-11-07

### `reads: 'lenient'` is deleted (phase G, part two)
- `ReadStrictness` is now the one-member union `'strict'`, kept as a type for the
  same reason `AadTightness` stays `'tight'`: loosening it must be a visible
  change somebody reviews. Both validators **refuse** `'lenient'` with the reason
  rather than coercing it.
- 48 references, two behavioural branches: one line each in
  `doc-codec.openStringValue` and `blob-codec.openBlobNode`. There is now no path
  through either codec that returns an unsealed value.
- **`openBlobNode` is no longer idempotent** — the one way this is not a pure
  no-op. A second open throws `CONTENT_PLAINTEXT_AT_REGISTERED_PATH`.
- A MINOR, because on the `0.x` line that is the breaking bump. See `UPGRADING.md`.

## utils-content-crypto 0.2.0 — 2026-11-04

### The legacy reader surface is deleted (phase G, part one)
- Gone: `legacy-readers.ts` (305 lines, reaching into 17 of 23 modules),
  `migrateDoc`, `MigratedDoc`, `LegacyScope`, and `legacy` on `KeyScope` /
  `ResolvedScope`. Twelve barrel exports removed; the export-count assertion went
  **136 → 124**, its first ever decrease.
- The precondition was verified rather than assumed: zero `enc:v1:`/`enc:v2:`
  values across the one store that had ever held them, zero legacy object
  envelopes, every consumer resolving `reads=strict` with `legacy=absent` read off
  the built registries, and no repo referencing a legacy export.
- `KEY_OF` fell out — a `WeakMap` whose only reader was `migrateDoc`, so `close()`'s
  promise that nothing holds the key afterwards is now structural.
- **Kept deliberately:** `decodeValue` still recognises the v1/v2 wires, so a stray
  legacy value fails `WRONG_KEY_LAYER` instead of reading as plaintext.
- A MINOR, for the same reason as 0.3.0. See `UPGRADING.md`.

## utils-sms-connector 3.2.0 — 2026-09-23

### Kudosity provider
- Fourth `SMSProvider`, selected with `SMS_PROVIDER=kudosity` and configured by
  `KUDOSITY_API_KEY` and `KUDOSITY_FROM_NUMBER` (optionally `KUDOSITY_BASE_URL`,
  `KUDOSITY_TRACK_LINKS`). No new dependency: it calls Kudosity's v2 (TransmitMessage)
  REST API over `fetch`, the API Kudosity recommends for new builds, not the classic v1.
- A sender is required on every send and must be registered to the account for the
  destination country; `SMSRequest.from` overrides the configured one, and alphanumeric
  ids work. Numbers are sent without a leading `+`, as Kudosity's examples show them.
- `metadata.messageRef` becomes `message_ref`, which Kudosity echoes on every webhook;
  `metadata.trackLinks` overrides the configured link tracking for one send.
  `mediaUrls`, `validityPeriod` and `tags` are ignored — MMS is a separate v2 endpoint.
- `sendBulk` loops. v2 takes one recipient per request; only v1 takes many, and that
  would mean a second credential pair for one method.
- **A send is never retried on a 5xx or a timeout**, for the same reason as Sent: v2
  documents no idempotency key. Only 429 is retried on a send; reads retry on 5xx too.
- A 200 whose message is already `REJECTED`, `FAILED` or `HARD_BOUNCE` is reported as a
  failed send, with the message id kept.
- `SOFT_BOUNCE` and `REJECTED` map to `undelivered`, and `HARD_BOUNCE` to `failed`.
  Status is matched case-insensitively because the API returns it in both cases.
- `cost`/`totalCost` are left undefined: v2 returns a part count, not a price.

## utils-sms-connector 3.1.0 — 2026-09-17

### Sent (sent.dm) provider
- Third `SMSProvider` beside Twilio and MessageBird, selected with `SMS_PROVIDER=sentdm`
  and configured by `SENTDM_API_KEY` (optionally `SENTDM_BASE_URL`, `SENTDM_SANDBOX`).
  No new dependency: it calls the v3 REST API over `fetch`, as the PandaDoc, Ortto and
  ClickUp providers already do. Sent assigns the outbound number, so there is no
  from-number to configure and `SMSRequest.from` is ignored, as are `mediaUrls`,
  `validityPeriod` and `tags`, which v3 has no equivalent for.
- Every send pins `channel: ['sms']`. Sent also carries WhatsApp and RCS; reaching them
  needs an interface wider than `SMSProvider`, so they stay out of this connector.
- `sendBulk` batches. Sent takes up to 1,000 recipients per request, so requests sharing
  a body become one call per 1,000 rather than the sequential loop the other two
  providers run — a 1,000-recipient send is 1 round trip here against 1,000 elsewhere.
  A chunk succeeds or fails as a unit, and ids are matched back by phone number.
- **A send is never retried on a 5xx or a timeout.** v3 has no idempotency key, so
  replaying a `POST /v3/messages` the server had already accepted would send the message
  twice. Only 429 is retried on a send, being a rejection; reads retry on 5xx too.
- Free-form `text` is only accepted by Sent inside an open conversation or within 7 days
  of an approved template send, so a cold send needs a template. `SMSRequest` has no
  field for one — pass `metadata.template = { id, parameters }`, the escape hatch the
  Twilio provider already uses for `metadata.statusCallback`.
- `cost`/`totalCost` are left undefined: v3 returns no price on send.

## backend-core 3.0.2 — 2026-09-05
- `createApp` sets `Cache-Control: no-store` on every response unless a handler set its
  own. Firebase Hosting was caching API responses that carried no cache header.

## backend-core 3.0.1 — 2026-09-05
- `TRUST_PROXY` (or `createApp({ trustProxy })`) sets the proxy hop count; was hard-coded
  to 1, one short behind Firebase Hosting, which defeated the per-IP rate limiter.

## utils 3.0.1 — 2026-09-05
- `utils-cache-connector`, `-firebase-event-bridge`, `-firestore-connector`,
  `-notification-inbox-connector`, `-push-notifications-connector`, `-token-handler`:
  `uuid` pinned exactly to `14.0.1` → `^14.0.1`, so npm stops nesting a second copy.
- Reference app (`functions/`) moved to the modular firebase-admin 14 API; jest transforms
  `jose` and `uuid`; `firebase-functions-test` dropped (unused; blocks admin 14).

## 3.0.0 — 2026-09-05
- **firebase-admin 14** (namespaced API removed) and **firebase-functions 7** are now
  peerDependencies of core and the Firebase-touching utils; consumers supply one copy.
- `createApp({ rateLimit: { databaseId | firestore | store } | false })`;
  `FirestoreRateLimitStore` resolves its database lazily. `RATE_LIMIT_ENABLED=false`
  honoured. Replaces the per-consumer `rate-limit-store.ts` patch.
- All packages 3.0.0; `create-backend` scaffolds `^3.0.0` and `firebase-admin ^14`.
- `UPGRADING.md`: 3.0 section, 1.x → 3.0 playbook, deletedAt backfill, publishing notes.

## 2.0.3 — 2026-07-31
- Platform-wide id prefix registry (`generate-id.ts`).

## 2.0.2 — 2026-07-29
- `BaseEntity.toFirestore` always writes `deletedAt` (null when unset). Records written
  without it were invisible to every `findAll` (`where('deletedAt','==',null)` never
  matches a missing field). Existing records need the backfill described in UPGRADING.md.

## 2.0.1 — 2026-07-02
- Security hardening: `BaseService.check*Access` default to deny; `BaseController`
  routes require `authMiddlewares()`; list endpoints capped at 100.

## 1.3.6 — 2026-05-04
- Last release on the 1.x line.
