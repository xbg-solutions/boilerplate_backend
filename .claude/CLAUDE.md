# CLAUDE.md — boilerplate_backend (bpbe)

The published `@xbg.solutions/backend-core` + `@xbg.solutions/utils-*` packages that every
xbg backend is built on. Read this before touching anything; then `UPGRADING.md` for the
consumer-facing history and `RELEASING.md` before publishing.

## Content encryption — the shared package lands here

**Phase A is BUILT, and the whole programme is COMPLETE (2026-11-07).**
`@xbg.solutions/utils-content-crypto` landed 2026-09-12 at `0.1.0` and is now at
**`0.3.0`** — **22 modules**, zero dependencies, mirrored into
`functions/src/utilities/content-crypto/` behind `scripts/check-mirror.js`.
Its exported names are a public contract across **seven consumer repos** —
Accounts, collab, Morph, sf-mapper, build, fedi-CRM and input — so a rename
costs a coordinated upgrade across all of them. The plan is
`accounts.xbg.solutions/__docs__/01-content-key-custody.md`.

**Phase G (2026-11-04 / 2026-11-07) deleted public surface, twice, on purpose.**
Both were MINOR bumps, because under caret semantics on the 0.x line a minor is
the breaking bump:

- **`0.2.0`** removed the legacy reader surface — `legacy-readers.ts` (305 lines
  reaching into 17 of 23 modules), `migrateDoc`, `MigratedDoc` and
  `LegacyScope`. Twelve barrel exports came off; the export-count assertion went
  **136 → 124**, its first ever decrease.
- **`0.3.0`** removed the **`lenient` read mode**. `ReadStrictness` is now a
  one-member union — kept as a type for the same reason `AadTightness` stays at
  `'tight'`: loosening it must be a visible change somebody reviews. Both
  validators REFUSE `'lenient'` with the reason rather than coercing it.

Three things to carry forward from that:

- **There is no `reads` setting but `'strict'`.** Do not reintroduce one to make
  a test or a migration pass. The point of phase G is that "the store is fully
  encrypted" is now a property of the code, not a configuration every consumer
  happens to have set — there is no path through `doc-codec` or `blob-codec`
  that returns an unsealed value.
- **`decodeValue` still RECOGNISES the v1/v2 wires, deliberately.** Recognition
  is the parser, not the reader: a stray legacy value must fail as
  `WRONG_KEY_LAYER` rather than read as an ordinary string at a registered path.
  Removing recognition would also flip `isEncrypted()` for it, which is subtler
  than deleting a function.
- **`openBlobNode` is no longer idempotent**, and that is the one way `0.3.0` is
  not a pure no-op. Leniency made it idempotent BY CONSTRUCTION — an
  already-opened payload is a plain object the plaintext row returned untouched.
  Under strict reads a second open THROWS, which is correct: a caller opening the
  same value twice has lost track of whether it holds plaintext. The test asserts
  the throw.

**`tsc` does not delete output for a removed source file**, so publishing a
deletion from a dirty `lib/` ships the very module the release removes. A stale
`lib/legacy-readers.js` nearly did. `scripts/publish-all.sh` now cleans before
building — see `RELEASING.md`.

It ships **one** encryption model, not two. What goes in:

- the field codec (`enc:v3:`) and strict decode. (It also carried legacy readers
  until collab's migration retired them; they were deleted at `0.2.0`, and the
  only thing left of them is wire RECOGNITION in `decodeValue`.)
- **the blob codec** — free-form `Record<string, any>` payloads are the majority
  shape everywhere except collab, so this is the main new mechanism, not an
  add-on
- the record-key layer: mint, wrap, unwrap, rewrap, and the `keyWraps` shape.
  **All three AAD forms are fixed in the plan (§5a, §3, §6) and must not be
  invented here** — an AAD freezes the moment the first wrap is written, and
  changing it afterwards is a re-key walk. The record-key wrap binds
  `record-key/{productId}/{accountId}/{generation}/{scopePath}`, where
  `scopePath` is the key holder's full document path, not a bare id.
- the object envelope (`x-xbg-*`), the field-path grammar and walker
- the `KeyCustodian` **interface**, the DEK cache and the grace window
- the key-lifecycle **rules as pure planners over a `KeyStore` port**
  (`planRevoke`, `planDestroy`, `planRegenerate`, …), with an in-memory store
  for tests
- **one** wrap operation, not a verb per transition: `planWraps(current,
  desired)`. Grant, un-share, transfer, rotate and erase are all "here is the
  wrap set I want" — and a transfer expressed as one patch is atomic, where
  grant-then-remove has a window in which both accounts hold wraps

**The wrap is written before any byte is encrypted under its record key** —
invariant, every path that mints a key, and for a walk that means once before the
walk starts. An orphan wrap is a bug we can find; content whose wrap was never
written is data we have destroyed. Failures land on the recoverable side.

**Blob ceilings are advisory per path; the 1 MiB document budget is enforced at
write time** on actual serialised bytes including base64 inflation. Do not sum
per-path ceilings at construction — that rejects the common multi-blob case on a
hypothetical.

**Planners return a shared `Patch` type, never an `XPlan`.** `planMove` →
`MovePlan` stutters and multiplies the surface; the return value should say what
it is, not what produced it.

**The package knows nothing about Firestore or KMS, and must not learn.** KEK
operations and any storage shim belong to whoever owns the storage — Accounts
owns the KEK path, and collab's own local custodian was deleted when phase C
finished on 2026-09-14. A Firestore shim appearing here
is the tell that the package has reached somewhere it should not.

The distinction that settles it: the local *lifecycle implementation* is
throwaway and collab already has it; the lifecycle *rules* are needed again by
Accounts, so those are shared and the implementation is not. `planDoc` in
collab's `content-walk.ts` is the same pattern one level down — a pure planner
returning an update the caller executes.

What stays per product and must **not** be generalised: the field registry and
the traversal. Each consumer supplies those plus a `KeyScope` config
(record-key granularity and AAD tightness).

## State (2026-09-23)

| Line | On npm | Notes |
|---|---|---|
| `backend-core` | **3.0.2** | `createApp({ rateLimit, trustProxy })`, `no-store` by default |
| `create-backend` | 3.0.0 | |
| `utils-*` (23 on the 3.x line) | 3.0.0 / 3.0.1 / **3.2.0** | six with a uuid dep are 3.0.1 (caret range); `utils-sms-connector` is **3.2.0** (Sent at 3.1.0, 2026-09-17; Kudosity at 3.2.0, 2026-09-23); the rest 3.0.0 |
| `utils-content-crypto` | **0.1.4** | its own 0.1.x line, not 3.x. 0.1.4 (2026-09-23) exempts a `RecordRef` from the key-material guard |
| 2.x | 2.0.3 | dead line — nothing further will be published |
| 1.x | 1.3.6 | dead line |

**This table is a snapshot and goes stale silently; the registry is the truth.** To
re-derive it, compare each `packages/*/package.json` version against that package's
`dist-tags.latest` — a local version ahead of npm is unpublished work, and one behind is
a lockfile or a tree that has drifted.

Every consumer is on 3.0.2: **accounts, build, morph, fediCRM, sf-mapper**. `input` and the
marketing site use no bpbe packages. Git tags mark what each publish contained —
`backend-core@3.0.2` for core, `bpbe-utils@3.0.1` for a bulk utils release, and
`utils-sms-connector@3.2.0` when a single package goes out on its own version. Create one
on every publish.

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
