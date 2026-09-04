# Upgrading

Notes and playbooks for upgrading this backend — read this **before** bumping
major dependency versions or the `@xbg.solutions/*` boilerplate packages. It
exists so the person (or agent) doing the upgrade can mitigate breaks
proactively instead of discovering them at deploy time.

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

### 1.x → 3.0 in one move (accounts, build, morph)

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

The three breaks below were checked against every 1.x consumer on
2026-09-05 and hit **nothing live**: each `BaseService` subclass already
overrode all three `check*Access` methods, the generated `BaseController`s
were either wrapped by a project controller that only overrides
`createContext` or never mounted, and the page cap only applies to
`BaseController` list routes. Read the section anyway — a *new* model
generated after the bump gets the defaults.

---

## ⚠️ Breaking behavior changes in the security-hardening release (2.0)

Two secure-by-default changes will affect existing downstream projects the
moment they bump `@xbg.solutions/backend-core`. Both fail **closed** (they block
rather than expose), so the symptom is "my endpoint now returns 401/403", not a
data leak. Re-grant access explicitly:

1. **Base access checks now default to DENY.** `BaseService.checkReadAccess`,
   `checkUpdateAccess`, and `checkDeleteAccess` return `false` by default (were
   `true`). Any service that never declared access rules will now return 403 on
   single-record get/update/delete. **Fix:** declare `accessRules` in the model
   (regenerate) or override these methods to grant access. Also: when a model
   declares an `accessRules` block, operations it does *not* list now deny by
   default too (were allow).

2. **Generated controllers now require authentication by default.** Every route
   on a `BaseController` subclass (and generated subcollection controllers)
   returns 401 until you wire an auth guard. **Fix:** override `authMiddlewares()`
   to return your guard (e.g. `[requiredAuth(tokenHandler)]`), and use
   `publicRoutes()` to opt specific routes out.

3. **List endpoints are now page-size capped** (default 50, max 100). Requests
   asking for more are clamped. Override `maxPageSize()` on a controller to raise
   the ceiling for a specific resource.

## General flow when bumping `@xbg.solutions/*` packages

1. Bump in `functions/package.json`, run `npm install` in `functions/`.
2. `cd functions && npx tsc --noEmit` — fix any type errors first.
3. `cd functions && npx jest` — the full suite (~800 tests) is the real
   regression gate. `npm test` at the root runs the `packages/*` suites that
   exist (discovered by `jest.config.js`).
4. `npm run build` at the repo root tsc-compiles every distributable package.
5. Review `firestore.rules` and `firestore.indexes.json` if the release notes
   mention query or schema changes.

> **Reminder:** this repo keeps two parallel copies of most source —
> `packages/*/src` (the published packages) and `functions/src` (the reference
> app's local copies, which do **not** import the packages). Apply any manual
> change to **both** trees or they silently drift.

---

## Done in 3.0: `firebase-admin` 13.x → 14.x (cleared 11 moderate audit advisories)

**Status:** done for `packages/*` in 3.0.0 (branch `chore/admin14-migration-and-tooling`). The reference app under `functions/` still imports the namespaced API against admin 13; it compiles because 13 supports both, and it is the next thing to sweep. The notes below are kept because they are the migration mapping consumers need. When first written `npm audit` reports 11
**moderate** advisories, all inside Google's own dependency chain beneath
`firebase-admin` (`@google-cloud/firestore`, `@google-cloud/storage`,
`google-gax`, `teeny-request`, `retry-request`, `gaxios`, `uuid`). The only fix
`npm` offers is `firebase-admin@14.x`, a **major** upgrade. The advisories are
moderate and transitive (not in the request path), so we chose not to force a
major bump inside a security pass. Do it on its own branch with a full test run.

### What breaks in v14 (and how it affects us)

| v14 breaking change | Impact here | Action |
| --- | --- | --- |
| Dropped Node 18/20; requires Node 22+ | **None** — we already target Node 22 (`engines.node: "22"`, `runtime: nodejs22`) | none |
| **Legacy namespaced API removed** (`admin.auth()`, `admin.firestore.Timestamp`, etc.) | **Large** — ~119 call sites across both trees | migrate to modular imports (below) |
| Removed deprecated Instance ID API | none observed | verify with grep |
| Removed legacy FCM types (`MessagingPayload`, `NotificationMessagePayload`, `DataMessagePayload`, `MessagingOptions`) | check push-notifications connector | migrate to current `Message`/`MulticastMessage` types |
| `@google-cloud/firestore` → v7 (breaking) | possible `Timestamp`/query behavior changes | run the Firestore-touching tests |
| `@google-cloud/storage` → v7 (breaking) | only if Storage is used | test storage paths |
| Revamped SDK-wide error handling | error `code`/shape may differ | re-check any `error.code` branching |

### Step-by-step

1. Branch: `git checkout -b chore/firebase-admin-14`.
2. `cd functions && npm install firebase-admin@^14`.
3. `npx tsc --noEmit` — the compiler will flag every removed namespaced call.
   Migrate each to its modular entry point:

   | v13 namespaced | v14 modular |
   | --- | --- |
   | `import * as admin from 'firebase-admin'; admin.initializeApp()` | `import { initializeApp } from 'firebase-admin/app'` |
   | `admin.app()` / `admin.apps` | `import { getApp, getApps } from 'firebase-admin/app'` |
   | `admin.credential.cert(...)` | `import { cert } from 'firebase-admin/app'` |
   | `admin.auth()` | `import { getAuth } from 'firebase-admin/auth'; getAuth()` |
   | `admin.firestore()` | `import { getFirestore } from 'firebase-admin/firestore'` |
   | `admin.firestore.Timestamp` / `.FieldValue` | `import { Timestamp, FieldValue } from 'firebase-admin/firestore'` |
   | `admin.messaging()` | `import { getMessaging } from 'firebase-admin/messaging'` |
   | `admin.storage()` | `import { getStorage } from 'firebase-admin/storage'` |

   `DecodedIdToken` and other types also come from `firebase-admin/auth` in the
   modular API.
4. Apply the same migration in the mirrored `packages/*/src` files (grep both
   trees: `grep -rn "admin\.\(auth\|firestore\|messaging\|storage\|app\|credential\)" functions/src packages`).
5. `npx jest` (full suite) — pay attention to token-handler and any
   Firestore `Timestamp`/`FieldValue` usage.
6. `npm run build` at the root to confirm all packages still compile.
7. `npm audit` — confirm the 11 moderate advisories are gone.
8. Deploy to a **staging** project first; smoke-test auth (token verify),
   a Firestore read/write, and any messaging/storage paths before production.

### Related major bumps (only via `npm audit fix --force`, avoid unless needed)
- `uuid@14` and `firebase-functions-test@0.3.3` are also flagged as major. Bump
  them deliberately alongside the above, not blindly — `--force` can downgrade
  `firebase-functions-test` unexpectedly.
