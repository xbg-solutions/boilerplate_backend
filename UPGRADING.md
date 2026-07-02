# Upgrading

Notes and playbooks for upgrading this backend — read this **before** bumping
major dependency versions or the `@xbg.solutions/*` boilerplate packages. It
exists so the person (or agent) doing the upgrade can mitigate breaks
proactively instead of discovering them at deploy time.

---

## ⚠️ Breaking behavior changes in the security-hardening release

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
3. `cd functions && npx jest` — the full suite (currently ~797 tests) is the
   real regression gate. The `packages/*` workspaces have `__tests__` folders
   but **no `test` script**, so they do not run in CI.
4. `npm run build` at the repo root tsc-compiles every distributable package.
5. Review `firestore.rules` and `firestore.indexes.json` if the release notes
   mention query or schema changes.

> **Reminder:** this repo keeps two parallel copies of most source —
> `packages/*/src` (the published packages) and `functions/src` (the reference
> app's local copies, which do **not** import the packages). Apply any manual
> change to **both** trees or they silently drift.

---

## Deferred: `firebase-admin` 13.x → 14.x (clears 11 moderate audit advisories)

**Status:** intentionally deferred. As of this writing `npm audit` reports 11
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
