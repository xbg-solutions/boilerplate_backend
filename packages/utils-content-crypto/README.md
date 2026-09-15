# `@xbg.solutions/utils-content-crypto`

Phase A of the platform's content-encryption programme: the shared crypto every product does
its own encryption with, over a data key fetched from Accounts. The plan is
`accounts.xbg.solutions/__docs__/01-content-key-custody.md`.

All twenty-three modules exist and the barrel is **135 values**, asserted as an equality
rather than a subset by `src/__tests__/index.test.ts`. The gates went in first, before the
code they constrain (build order, step 1), and they are still what holds the shape: the
barrel equality, the generated mirror, and `scripts/check-mirror.js`.

Each product supplies three things and nothing else: its **field registry**, its
**traversal**, and a **`KeyScope`** config. Neither the registry nor the traversal is ever
generalised into this package.

**Names, because an early draft of the plan used one for two things.** `KeyCustodian` is
**Accounts' service**, built in Phase B and living in that repo. This package's read-side
port is **`DekSource`**, and **`CachedDekSource`** is the branded decorator
`cachingDekSource` returns — the only thing `createContentCrypto` accepts, because the TTL
*is* the revocation window. Nothing here calls the port a custodian: the façade option and
the property on `ContentCrypto` are both **`dekSource`**, which is what the type already
said and what the field now says too.

## Three ways this package differs from the house shape, and why

The manifest is JSON and cannot hold a comment, so the reasons live here.

- **`"version": "0.1.x"`, not `3.x`.** Every other package sits on the 3.x line and moved
  onto it together, so a major here is a line-wide event: 25 packages republished, five
  consumer repos upgraded in step. Publishing a package with zero consumers and no
  production data on that line means its first real-data correction becomes a 4.0.0 dragging
  twenty-four unrelated packages along — or, much worse, does not, and ships as a minor
  because the alternative was too expensive. Under caret semantics `^0.1.0` resolves
  `>=0.1.0 <0.2.0`, so **a minor bump is breaking**, which is the honest contract for a wire
  format that freezes on first write. It joins the 3.x line at the first line-wide publish
  after collab's Phase C is live on real data, and not before.

  **0.1.1** adds `dekHandleFromBase64` and nothing else. It is the door key material comes in
  through, and it went in because there was no door: a product's `DekSource` has to return a
  `DekHandle`, and no export on the barrel produced the `AccountDek` inside one. Found in
  collab's Phase C against the published 0.1.0, which is exactly the correction the 0.x line
  exists to absorb — under caret semantics a patch is the additive bump and a minor is the
  breaking one.

  **0.1.2** fixes a silent-plaintext bug, and it is the one this package exists to not have.
  Every plainness test asked `constructor === Object`, which is false for three unrelated
  things: a plain object from **another realm** (`structuredClone` under Jest, a `vm`
  context — its `Object` is a different function), a **null-prototype** object, and a **class
  instance**. The first two are documents. `walkDoc` skipped all three, so `encryptDoc`
  returned the document UNCHANGED and reported success, and the caller stored the plaintext
  it was holding — in STRICT mode, with no error. Reported by a consumer who found it through
  a test double and guarded on their own side; the guard belongs here.

  The fix is not "widen the test", because the three cases are not one case. The first two are
  now walked. The third is now **refused** with a `VALIDATION_ERROR` naming the class, because
  a Firestore `FieldValue` is a class instance and walking one would mangle a sentinel — which
  is what the original strictness was protecting, and it still is. Silence was never the third
  option. Leniency does not forgive it either: `reads: 'lenient'` forgives plaintext at a
  registered path, not a document that cannot be walked.

  The same realm-sensitive test sat at a blob root and inside a blob (`blob-codec.ts`,
  `blob-json.ts`). Those failed LOUDLY — `BLOB_ENCODE_FAILED`, never stored plaintext — so that
  half was a wrong refusal rather than a leak, and both now ask the PROTOTYPE whose constructor
  is named `Object` instead of testing identity against this realm's. A class instance inside a
  blob is still refused and still named.

  A patch, not a minor: no wire format moved, nothing already sealed reads differently, and
  every call that worked still works. What changed is that two calls which silently did
  nothing now do their job, and one which silently did nothing now throws.

- **An `exports` map — the first in this repo.** The reason is the `./testing` subpath, not
  opacity: it keeps the in-memory `KeyStore` out of the barrel's type surface. The plan is
  right that a subpath export is not a security boundary, so `testing.ts`'s real boundary is
  a **runtime throw** inside a deployed function, which works identically in both trees. All
  five consumers compile at `moduleResolution: node16`, under which an `exports` map is
  authoritative and TypeScript will not fall back to `types` — so every condition carries
  `types` first. `"./package.json"` is exported because npm and some bundlers read it
  through the specifier and a closed map breaks them.

- **`"dependencies": {}` and `"peerDependencies": {}`, declared explicitly.** Empty rather
  than absent, because `scripts/check-mirror.js` assertion (5) reads them and because the
  emptiness is a property of the design: the package knows nothing about Firestore, Cloud
  Storage or KMS and must not learn. The only non-relative imports permitted anywhere in the
  tree are `node:crypto`, `node:zlib`, `node:util` and `node:stream`. If you find you need a
  dependency, that is a conversation, not an edit.

`tsconfig.json` also diverges — `node16`/`node16` and two extra strictness flags — and that
one is a JSONC file, so the reasons are in the file itself.

## The mirror is generated

`functions/src/utilities/content-crypto/` is a **byte-identical generated copy** of `src/`,
for this package and no other in the repo.

```
npm run mirror:check   # rides in on `npm test`, and runs in CI
npm run mirror:sync    # the repair. Hooked to nothing, on purpose
```

Editing the mirror by hand is a CI failure, and `mirror:sync` deletes such an edit rather
than merging it. The package tree is the source; the mirror is an artefact that happens to
be committed, because the functions tree has no build step that could generate it.
