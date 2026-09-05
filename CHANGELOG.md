# Changelog

Consumer-facing detail and migration steps live in `UPGRADING.md`.

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
