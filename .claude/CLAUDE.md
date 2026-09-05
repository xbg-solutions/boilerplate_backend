# CLAUDE.md — boilerplate_backend (bpbe)

The published `@xbg.solutions/backend-core` + `@xbg.solutions/utils-*` packages that every
xbg backend is built on. Read this before touching anything; then `UPGRADING.md` for the
consumer-facing history and `RELEASING.md` before publishing.

## State (2026-09-05)

| Line | On npm | Notes |
|---|---|---|
| `backend-core` | **3.0.2** | `createApp({ rateLimit, trustProxy })`, `no-store` by default |
| `utils-*` (24) | 3.0.0 / **3.0.1** | six with a uuid dep are 3.0.1 (caret range); the rest 3.0.0 |
| 2.x | 2.0.3 | dead line — nothing further will be published |
| 1.x | 1.3.6 | dead line |

Every consumer is on 3.0.2: **accounts, build, morph, fediCRM, sf-mapper**. `input` and the
marketing site use no bpbe packages. Git tags mark what each publish contained
(`backend-core@3.0.2`, `bpbe-utils@3.0.1`, …); create one on every publish.

## Two source trees — change both

`packages/*/src` is what gets published. `functions/src` is the reference app that
`create-backend` scaffolds from, and it keeps its **own copy** of most of the same code
(`functions/src/utilities/*` mirrors `packages/utils-*/src`, `functions/src/app.ts`
mirrors `packages/core/src/app.ts`, differing only in import paths). They drift
silently. Apply any change to both, and confirm with a diff modulo import paths.
The ~800-test jest suite runs against the **functions** tree; the root `npm test`
runs the `packages/*/src/__tests__` suites.

## Peer dependencies (since 3.0)

`firebase-admin` (^14.2) and `firebase-functions` (^7.0) are **peerDependencies**, not
bundled. Before 3.0 npm nested a second `firebase-admin` under each package whenever the
consumer's range did not overlap, giving two app registries and two `Timestamp` classes in
production. Keep them as peers; keep them as devDependencies for the workspace build.
Do not add a dependency on `firebase-admin` to any package.

## Things the runtime must be told

- **Named databases.** The Firestore-backed rate limiter and anything else that calls
  `getFirestore()` bare targets `(default)`. No xbg project has one. `createApp({ rateLimit:
  { databaseId } })` is the switch; a consumer that forgets it 500s on every request
  before authentication.
- **Proxy hops.** `TRUST_PROXY` (default 1). Behind Firebase Hosting it must be **2** or
  `req.ip` is the varying edge address and the per-IP limiter never trips.
- **Caching.** Firebase Hosting gives a rewritten response with no `Cache-Control` a
  default of `max-age=600` and serves it from its CDN; Hosting's `headers` config does
  not reach rewrites. `createApp` therefore sets `no-store` on every response unless a
  handler set its own. Do not remove that middleware.

## Security defaults (since 2.0)

`BaseService.check*Access` default to deny; every `BaseController` route is guarded and
returns 401 "Authentication is required but not configured" unless the subclass supplies
`authMiddlewares()`; list endpoints are capped at 100. The guard runs **inside** the
controller's router, so a project that mounts its own auth ahead of the router still has
to return a guard (one that confirms `req.user` is present is the accepted pattern —
see UPGRADING.md "Lessons"). Do not weaken these defaults in the template.

## ESM-only dependencies

`firebase-admin` 14 pulls `jose` 6 and the utils pull `uuid` 14; both are ESM-only.
`functions/jest.config.js` transforms them (`transformIgnorePatterns` anchored so nested
copies count). A CommonJS consumer that imports `uuid` itself needs its own `uuid ^11`.

## Publishing

Only Ben can publish (npm 2FA). `scripts/publish-all.sh` publishes in dependency order,
skips what is on the registry, logs to `scripts/publish-logs/`, and runs `npm publish`
with `--auth-type=web` under `script(1)` so npm keeps a TTY for the browser second
factor — a pipe on stdout makes npm demand a typed code instead. Details in `RELEASING.md`.

## Language & spelling

Displayed language is English; user-facing copy uses **Australian/British spelling**
(`colour`, `organisation`, `centre`, `optimise`, `behaviour`, `licence`, `catalogue`,
`customise`, `authorise`, `analyse`). **US English is accepted in the codebase** —
identifiers, CSS properties/values, library APIs, and config keys stay US-spelled
(`color`, `center`, `initialize`, `background-color`, `text-center`, `Authorization`);
do NOT "correct" those. Rule of thumb: if a human reads it as words → AU/British; if a
machine parses it as a symbol → leave it US.

## Git

This is its own independent git repository. Run git operations (branch, commit, push)
from **inside this repo**. The parent `xbg/` folder is a coordination workspace, not a
repo — never commit from there. The checkout is shared with other sessions: stage by
explicit path, never `git add -A`, and treat untracked files you did not create as
someone else's work in progress.

## Storage-layer ownership

This is a **boilerplate/template** (`.firebaserc` default is the placeholder
`your-project-id`) — it owns no live database and deploys to no shared project as-is.
Changes here propagate to every service scaffolded from it, so treat storage-layer
patterns with extra care:

- Do NOT wire this template to a real shared Firebase project, and never run
  `firebase deploy` against `xbgsolutions` (or any live project) from here.
- Keep the multi-database connector pattern intact (services select their owned
  database via `firestoreName`/`*_DATABASE_ID`); a scaffolded service owns only its
  own database(s), never a shared one it merely reads.
