# Upgrading

Notes for upgrading this project — read this **before** bumping major
dependency versions or your `@xbg.solutions/*` boilerplate packages, so you can
mitigate breaks proactively instead of discovering them at deploy time.

---

## ⚠️ Breaking behavior changes in the security-hardening release

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

## Deferred: `firebase-admin` 13.x → 14.x (clears the moderate audit advisories)

If `npm audit` reports moderate advisories under `firebase-admin`'s dependency
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
