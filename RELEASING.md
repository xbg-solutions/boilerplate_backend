# Releasing

## Before you publish

1. Both source trees changed identically (see CLAUDE.md "Two source trees").
2. `npm run build` at the root — 25/25 packages.
3. `npm test` at the root (packages suites) and `cd functions && npx jest` (~810 tests).
4. Bump versions. Every package that changed gets a new version; anything depending on a
   changed package via `^` does not need one. A change to `firebase-admin`'s major, to
   peer dependencies, or to any default that a consumer must react to is a **major**.
5. **Regenerate the root lockfile in the same commit**: `npm install --package-lock-only`,
   then check `git diff package-lock.json` shows only the version lines you meant. This is
   a workspace, so `package-lock.json` carries a `packages/<name>` entry holding each
   package's version, and bumping `packages/<name>/package.json` alone leaves the lock
   naming a version that exists neither in the package nor on the registry. **Nothing
   fails loudly** — the build, the tests and `npm publish` are all green on a drifted
   lock; `npm ci` and the next person's regeneration pay for it. It has drifted three
   times: `packages/core` at the 3.0.2 publish (repaired in `028c523`),
   `utils-content-crypto` at 0.1.2 and again at 0.1.3. If the regeneration also corrects
   some *other* package, that is pre-existing drift — commit it and say so in the message
   rather than reverting, which would restore a version that exists nowhere.
6. `UPGRADING.md` (root **and** `packages/create-backend/src/project-template/`) gets a
   section a consumer can act on. `CHANGELOG.md` gets the summary — under its version
   heading, not `Unreleased`, by the time you publish.
7. Commit, then tag the commit with what it publishes: `backend-core@X.Y.Z` for core,
   `bpbe-utils@X.Y.Z` for a bulk utils release, and `<package>@X.Y.Z` when one package
   goes out on its own version (`utils-sms-connector@3.1.0` was the first). Tags are
   lightweight here. Push both.

## Publishing (Ben)

```
npm login                      # once; web flow
scripts/publish-all.sh         # no argument
```

The script: checks the registry first and skips anything already there, warms each
pending package's build, then publishes **in dependency order** (`utils-logger` → the
utils core depends on → `backend-core` → `create-backend` → the rest) with
`--auth-type=web`. npm opens the browser for the second factor; the five-minute trust it
grants covers the rest of the run. Everything on the console is captured to
`scripts/publish-logs/publish-<timestamp>.log` via `script(1)`.

Why not `tee`: a pipe on stdout makes npm think it is non-interactive and it then
insists on a typed one-time code (`EOTP`) instead of the browser flow. If a run reports
`EOTP`, check that nothing wrapped the script's output.

Manual equivalent for one package:

```
npm publish -w @xbg.solutions/backend-core --access public --auth-type=web
```

## After you publish

- Confirm the **artefact**, not just the metadata. `npm view …@X.Y.Z version` proves a
  version exists; it does not prove the version contains your change. Every package ships
  `files: ["lib"]` and `lib/` is gitignored, built by `prepublishOnly` — so a stale or
  missing build publishes quietly. Pull the tarball from
  `dist.tarball` and confirm the new module is in it and re-exported from `lib/index.js`.
  (`npm view` is also served from a cache that can lag; `curl` the registry JSON to see
  through it.)
- Roll consumers: in each of accounts, build, morph, fediCRM, sf-mapper —
  `cd functions && npm update @xbg.solutions/backend-core` (or the changed utils),
  `npx tsc --noEmit`, `npx jest`, commit the lockfile, deploy that repo's own
  `functions:<codebase>`, then smoke: an unauthenticated call returns 401 (not 500),
  `ratelimit-remaining` falls across consecutive requests through the public domain,
  and `cache-control: no-store` is present.
- Rollback is a redeploy from the consumer's previous commit. Cloud Run traffic
  rollback to an older revision cannot be relied on (the image may be gone), and a
  failed attempt leaves the service spec pointing at it until
  `gcloud run services update-traffic <svc> --to-latest`.
