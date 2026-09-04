# Upgrading

Notes for upgrading this project — read this **before** bumping major
dependency versions or your `@xbg.solutions/*` boilerplate packages, so you can
mitigate breaks proactively instead of discovering them at deploy time.

---

## 3.0 — firebase-admin 14, peer dependencies, named-database rate limiting

Published 2026-09. Three consumer-facing changes; every one of them is
visible at `npm install` or `tsc`, none at runtime only.

### 1. `firebase-admin` and `firebase-functions` are now **peerDependencies**

`backend-core` and the utils that touch Firebase (`utils-cache-connector`,
`utils-firebase-event-bridge`, `utils-firestore-connector`, `utils-logger`,
`utils-notification-inbox-connector`, `utils-push-notifications-connector`,
`utils-token-handler`) no longer bundle their own copy. **Your `functions/`
must list them**:

```json
"firebase-admin": "^14.2.0",
"firebase-functions": "^7.0.0"
```

Why: on 1.x/2.x, npm installed a second `firebase-admin` *inside* each
boilerplate package whenever the project's own range did not overlap. That
gave two module instances, two app registries and two `Timestamp` classes
(`instanceof` fails across them). It happened silently in production. After
the bump, `find functions/node_modules/@xbg.solutions -maxdepth 3 -name
firebase-admin` must return nothing.

### 2. `firebase-admin` 14 — the namespaced API is gone

The packages are built against 14 and import only the modular entry points,
and the peer range requires 14. Your own code must migrate too: see the
v13 → v14 mapping below (unchanged from the previously deferred section).
Sweep with:

```
grep -rn "admin\.\(auth\|firestore\|storage\|messaging\|app\|apps\|credential\|initializeApp\)" functions/src
```

`firebase-functions` ≥ 6 already exports the v2 API at `firebase-functions/v2`;
if you still import v1 from the package root, move to `/v1` or `/v2`
explicitly.

### 3. Rate limiting on a named Firestore database

`createApp()` mounts a global limiter backed by `FirestoreRateLimitStore`. On
2.x that store always used the `(default)` database; projects with only named
databases got gRPC `NOT_FOUND` on every request — as a **500, before
authentication**, because the limiter sits ahead of the router. Every
consumer carried a local `rate-limit-store.ts` patch. Delete it and pass the
database instead:

```ts
createApp({
  controllers,
  rateLimit: { databaseId: 'accounts' },   // or { firestore }, or { store }, or false
});
```

Resolution is lazy (first request), so `createApp()` may still run before
`initializeApp()`. `RATE_LIMIT_ENABLED=false` is now honoured; `development`
never mounts one.

### 1.x → 3.0 in one move

Nothing in 2.x is worth stopping at; go straight to 3.0:

1. `functions/package.json`: every `@xbg.solutions/*` → `^3.0.0`;
   `firebase-admin` → `^14.2.0`; `firebase-functions` → `^7.0.0`. `npm install`.
2. `npx tsc --noEmit` and fix what it flags — almost all of it is the
   namespaced sweep above.
3. `createApp({ rateLimit: { databaseId } })`.
4. **deletedAt backfill.** 1.x and 2.0.1 wrote records through `BaseEntity`
   without a `deletedAt` field, and `findAll` filters `where('deletedAt','==',
   null)`, which never matches a *missing* field — so those records were
   invisible to every list query. 2.0.2 fixed the write; existing documents
   need a one-off stamp. Template: fediCRM's
   `functions/src/scripts/backfill-deleted-at.js`. It touches only documents
   with **no** `deletedAt` field, so it can never resurrect a soft-deleted
   record, and old code reads the result correctly — it never needs reverting.
   Dry-run first.
5. `npx jest`, deploy, then smoke: an unauthenticated call must return **401,
   not 500** (500 means the rate-limit store is still on `(default)`); a burst
   must return 429.

### The 2.0 secure-by-default changes, revisited

If every `BaseService` in your project already overrides the three
`check*Access` methods and your routes do not go through a generated
`BaseController`, the three breaks below do not reach you. Read the section
anyway — a *new* model generated after the bump gets the defaults.

---

## ⚠️ Breaking behavior changes in the security-hardening release (2.0)

Two secure-by-default changes affect projects when they bump
`@xbg.solutions/backend-core`. Both fail **closed** (block rather than expose),
so the symptom is "my endpoint now returns 401/403". Re-grant access explicitly:

1. **Base access checks default to DENY.** `checkReadAccess`/`checkUpdateAccess`/
   `checkDeleteAccess` return `false` by default. Declare `accessRules` in the
   model (regenerate) or override these methods to grant access.
2. **Generated controllers require authentication by default.** Every route
   returns 401 until you override `authMiddlewares()` (e.g.
   `[requiredAuth(tokenHandler)]`); use `publicRoutes()` to make a route public.
3. **List endpoints are page-size capped** (default 50, max 100). Override
   `maxPageSize()` on a controller to raise the ceiling.

## General flow when bumping `@xbg.solutions/*` packages

Your backend code lives in `functions/` and consumes the boilerplate as
published npm packages. To pull in boilerplate updates:

1. `cd functions && npm update` (or bump specific `@xbg.solutions/*` versions),
   or run `npx @xbg.solutions/create-backend sync` from the project root.
2. `cd functions && npx tsc --noEmit` — fix any type errors first.
3. `cd functions && npx jest` — run your test suite.
4. Review `firestore.rules` / `firestore.indexes.json` if the release notes
   mention query or schema changes.
5. Deploy to a **staging** Firebase project before production.

Check each package's release notes / CHANGELOG for breaking changes before a
major-version bump.

---

## Reference: `firebase-admin` 13.x → 14.x

Required by 3.0 (see above). Kept here for the mapping. Historically, if `npm audit` reported moderate advisories under `firebase-admin`'s dependency
chain (`@google-cloud/firestore`, `@google-cloud/storage`, `google-gax`,
`teeny-request`, `retry-request`, `gaxios`, `uuid`), the only fix is
`firebase-admin@14.x` — a **major** upgrade. These advisories are moderate and
transitive (not in your request path), so upgrade deliberately on a branch with
a full test run rather than under time pressure.

### What breaks in v14

- **Node 18/20 dropped; requires Node 22+** — no impact, this project targets Node 22.
- **Legacy namespaced API removed** — the main work. Any `import * as admin from
  'firebase-admin'; admin.auth()` / `admin.firestore.Timestamp` style calls must
  move to modular imports (mapping below).
- **Removed deprecated Instance ID API and legacy FCM message types**
  (`MessagingPayload`, `NotificationMessagePayload`, `DataMessagePayload`,
  `MessagingOptions`).
- **`@google-cloud/firestore` v7 and `@google-cloud/storage` v7** sub-upgrades
  (breaking) and revamped SDK error handling (`error.code` shapes may change).

### Migration mapping (v13 → v14)

| v13 namespaced | v14 modular |
| --- | --- |
| `admin.initializeApp()` | `import { initializeApp } from 'firebase-admin/app'` |
| `admin.app()` / `admin.apps` | `import { getApp, getApps } from 'firebase-admin/app'` |
| `admin.credential.cert(...)` | `import { cert } from 'firebase-admin/app'` |
| `admin.auth()` | `import { getAuth } from 'firebase-admin/auth'` |
| `admin.firestore()` | `import { getFirestore } from 'firebase-admin/firestore'` |
| `admin.firestore.Timestamp` / `.FieldValue` | `import { Timestamp, FieldValue } from 'firebase-admin/firestore'` |
| `admin.messaging()` | `import { getMessaging } from 'firebase-admin/messaging'` |
| `admin.storage()` | `import { getStorage } from 'firebase-admin/storage'` |

### Steps

1. `git checkout -b chore/firebase-admin-14`
2. `cd functions && npm install firebase-admin@^14`
3. `npx tsc --noEmit` — the compiler flags every removed namespaced call; migrate
   each using the mapping above.
4. `npx jest` — watch auth (token verification) and any Firestore
   `Timestamp`/`FieldValue` usage.
5. `npm audit` — confirm the advisories are cleared.
6. Deploy to staging and smoke-test auth, a Firestore read/write, and any
   messaging/storage paths before production.
