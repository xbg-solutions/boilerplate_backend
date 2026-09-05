# Releasing

## Before you publish

1. Both source trees changed identically (see CLAUDE.md "Two source trees").
2. `npm run build` at the root — 25/25 packages.
3. `npm test` at the root (packages suites) and `cd functions && npx jest` (~810 tests).
4. Bump versions. Every package that changed gets a new version; anything depending on a
   changed package via `^` does not need one. A change to `firebase-admin`'s major, to
   peer dependencies, or to any default that a consumer must react to is a **major**.
5. `UPGRADING.md` (root **and** `packages/create-backend/src/project-template/`) gets a
   section a consumer can act on. `CHANGELOG.md` gets the summary.
6. Commit, then tag the commit with what it publishes: `backend-core@X.Y.Z` for core,
   `bpbe-utils@X.Y.Z` for a utils-only release. Push both.

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

- Confirm: `npm view @xbg.solutions/backend-core@X.Y.Z version` for each package.
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
