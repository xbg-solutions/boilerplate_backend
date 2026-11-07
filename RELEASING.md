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

The script: checks the registry first and skips anything already there, **cleans and then
rebuilds** each pending package, then publishes **in dependency order** (`utils-logger` →
the utils core depends on → `backend-core` → `create-backend` → the rest) with
`--auth-type=web`. npm opens the browser for the second factor; the five-minute trust it
grants covers the rest of the run. Everything on the console is captured to
`scripts/publish-logs/publish-<timestamp>.log` via `script(1)`.

**The clean is not tidiness, and it was added after a near miss.** `tsc` does not remove
output for a source file that no longer exists, so a release whose whole content is a
DELETION will happily ship the module it deletes: `utils-content-crypto@0.2.0` removes
`legacy-readers.ts`, and a stale `lib/legacy-readers.js` sat in the build directory ready
to be published with it. `files: ["lib"]` plus a gitignored `lib/` means nothing in git
status would have shown it. Any release that removes a source file needs a clean build,
which is now unconditional.

Why not `tee`: a pipe on stdout makes npm think it is non-interactive and it then
insists on a typed one-time code (`EOTP`) instead of the browser flow. If a run reports
`EOTP`, check that nothing wrapped the script's output.

**Read the error code before reaching for the token.** On 2026-11-07 a publish failed
`E404 Not Found - GET https://registry.npmjs.org/-/v1/done?authId=…`. That is the
**web-auth completion poll**, not the package: the browser approval was never completed,
while `npm whoami` answered correctly the whole time. The script's hint used to read
"E401/E404 = not logged in", which sent two people to check credentials that were fine.
It now distinguishes the three cases, and so should you:

| code | what it actually means |
|---|---|
| `EOTP` | second factor not completed in time — just re-run |
| `E404` on `/-/v1/done?authId=` | the **browser** approval was not completed. You are logged in |
| `E401` / `E404` on the **package** | genuinely not logged in — `npm login` |

**`--otp` and `--auth-type=web` are mutually exclusive**, which is why passing a TOTP code
to the script switches it to `--auth-type=legacy`. npm silently IGNORES a code supplied
alongside the web flow, so the documented TOTP escape hatch never worked until that was
fixed. If the browser is unavailable, `scripts/publish-all.sh 123456`.

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
- Roll consumers: in each of accounts, build, morph, fediCRM, sf-mapper, **collab and
  input** (seven, not five — collab and input both consume `utils-content-crypto`) —
  `cd functions && npm update @xbg.solutions/backend-core` (or the changed utils),
  `npx tsc --noEmit`, `npx jest`, commit the lockfile, deploy that repo's own
  `functions:<codebase>`, then smoke: an unauthenticated call returns 401 (not 500),
  `ratelimit-remaining` falls across consecutive requests through the public domain,
  and `cache-control: no-store` is present.
- Rollback is a redeploy from the consumer's previous commit. Cloud Run traffic
  rollback to an older revision cannot be relied on (the image may be gone), and a
  failed attempt leaves the service spec pointing at it until
  `gcloud run services update-traffic <svc> --to-latest`.
