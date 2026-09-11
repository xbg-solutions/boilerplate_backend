/**
 * The barrel, asserted as an EQUALITY rather than as a subset.
 *
 * This is the one structural check that has to be a test rather than a line in
 * `scripts/check-mirror.js`, because it must run inside BOTH trees: the package and its
 * generated mirror compile under different compilers, and the export surface is the thing
 * that must be identical in each. It reaches nothing outside the mirrored root — one
 * relative import and no manifest read — so it mirrors byte-for-byte.
 *
 * An equality, not a subset, because a subset assertion cannot see the two failures that
 * matter: a name that was exported and should not have been, and a name silently dropped.
 * The count is written down so that changing it is a decision somebody makes, not something
 * that happens.
 *
 * TYPES ARE NOT HERE, AND CANNOT BE. `Object.keys` sees runtime values only; a type export
 * erases. The types §4 declares are checked by `tsc`, which the package build runs at a
 * strictness superset of the functions tree — a type exported from a module that does not
 * declare it is a compile error in both trees, which is the failure this list could not see
 * anyway. So this is the VALUE surface, and it is exhaustive over values.
 *
 * TWENTY-TWO OF TWENTY-THREE MODULES EXIST, and `testing.ts` — the twenty-third — is a
 * SEPARATE entrypoint that this list must never contain. So from here the equality is over a
 * complete production surface: a name arriving on it now is a name somebody decided to add.
 * `assertHead` appears at last, published from `./walk` as §4 says, having been implemented in
 * `key-scope.ts` since step 5 because granularity is compared in exactly one file.
 */

import * as barrel from '../index';

/**
 * Every VALUE the production barrel exports. Sorted, and asserted exhaustively.
 *
 * Grouped by owning module in the same order as `index.ts`, so a reviewer can check a
 * section against §4 without re-sorting the whole list in their head. The sort happens in
 * the assertion, not here.
 */
const EXPECTED_EXPORTS: readonly string[] = [
  // errors.ts (11) — two checks with two threat models (`assertNoSecrets` over a details bag,
  // `assertNoKeyMaterial` over any tree) and `compact`, which is what makes omitting an
  // undefined the easy path rather than the careful one.
  'ContentCryptoError', 'isContentCryptoError', 'isKeyUnavailable', 'isUnreadable',
  'KEY_UNAVAILABLE_CODES', 'UNREADABLE_CODES', 'HTTP_STATUS_FOR_CODE',
  'assertNoSecrets', 'assertNoKeyMaterial', 'compact', 'SAFE_DETAIL_KEYS',

  // secret.ts (4) — the accessor that returns bytes is NOT among them, by design
  'isSecret', 'isDestroyed', 'KEY_BYTES', 'MAX_SEALS_PER_KEY',

  // key-scope.ts (11) — MIN_DERIVED_SEALED_BYTES is declared in registry.ts and re-exported
  'resolveScope', 'resolveGraceMs', 'assertScopePath',
  'documentRecordRef', 'aggregateRecordRef', 'accountRecordRef', 'recordRefKey',
  'ACCOUNT_RECORD_TYPE', 'DEFAULT_GRACE_MS', 'DEFAULT_MAX_DOCUMENT_SEALED_BYTES',
  'MIN_DERIVED_SEALED_BYTES',

  // registry.ts (3)
  'defineRegistry', 'EMPTY_REGISTRY', 'RESERVED_ROOTS',

  // field-path.ts (11)
  'parseFieldPath', 'formatFieldPath', 'isPlainObject', 'mapPath', 'mapPathNode', 'nodeAt',
  'matchUpdateKey', 'mapUpdateValue', 'blobKeyRelation', 'parseSubPath', 'formatSubPath',

  // aad.ts (6)
  'aadForContent', 'aadForRecordKeyWrap', 'aadForDek', 'aadForObject', 'assertAad',
  'AAD_OBJECT_DOMAIN',

  // field-codec.ts (11)
  'ENC_PREFIX_V3', 'WRAP_PREFIX', 'IV_BYTES', 'TAG_BYTES', 'PAYLOAD_KIND',
  'decodeValue', 'isEncrypted', 'versionOf', 'isSealedBlobCandidate', 'encryptField',
  'decryptField',

  // blob-json.ts (9) — documentByteCost and decodeBlobBody stay internal
  'BLOB_SERIALISER_VERSION', 'DEFAULT_MAX_SEALED_BYTES', 'DEFAULT_MAX_DEPTH',
  'encodeBlob', 'decodeBlob', 'blobRoundTrips', 'maxPlaintextFor', 'BUILTIN_TAGS',
  'firestoreTimestampAdapter',

  // blob-codec.ts (3) — the placement leaves `sealBlobNode` / `openBlobNode` and the kind-byte
  // check `payloadKindsAgree` stay INTERNAL: a consumer reaching one would be deciding
  // placement for itself, which is what the registry exists to stop.
  'encryptBlob', 'decryptBlob', 'applyBlobPatch',

  // record-key.ts (10) — thirteen until R10. `mintRecordKey`, `wrapRecordKey` and
  // `unwrapRecordKey` are INTERNAL: mint + planWraps + openRecord seals content under a key whose
  // wrap was never written, with nothing false said and the committer never invoked, which makes
  // it an export-surface problem rather than a trust ceiling. `rewrapRecordKey` stays — it takes
  // and returns wraps, mints nothing, and hands out no key.
  'KEY_WRAPS_FIELD', 'WRAP_HOLDERS_FIELD',
  'rewrapRecordKey', 'holdersOf', 'hasWrap', 'wrapCount', 'isLastWrap',
  'isUnreachable', 'parseKeyWraps', 'assertKeyWraps',

  // wrap-patch.ts (1) — one conflict rule, and nothing else. The free, KEY-TAKING `planWraps` came
  // off with the primitives above (R10); `session.planWraps` is the same capability with the key
  // held by the session. `materialiseWrapPatch` came off at R13: keeping it did not prevent the
  // raw-sentinel mistake, because the caller who writes `{ op: 'delete' }` raw is the caller who
  // never knew a materialiser existed. The route it was excusing now exists — `applyWrapPatch`,
  // below — and translates internally through the sink's own `deleteField`.
  'conflictPolicyFor',

  // object-envelope.ts (10) — the four x-xbg-* headers, the buffered pair, the streaming pair,
  // and the two metadata helpers. No keygen header and no rotation routine: under record keys
  // rotating an object is a metadata patch on the owning record and touches no object bytes.
  'OBJECT_META', 'OBJECT_ENC_VERSION', 'isEncryptedObject', 'readObjectEnvelope',
  'objectEnvelopeMetadata', 'mergeObjectMetadata', 'sealObject', 'openObject',
  'createObjectEncryptStream', 'createObjectDecryptStream',

  // custodian.ts (0) — types only. The values §4 puts in this section belong to
  // custodian-cache.ts, below.

  // custodian-cache.ts (6) — `cachingDekSource` is the ONLY producer of a `CachedDekSource`,
  // which is what makes the cache mandatory: the TTL is the revocation window and the grace
  // window, and a façade handed a bare `DekSource` would silently opt out of both. The
  // classifier that turns an upstream failure into a `GraceReason` is deliberately NOT here —
  // an exported classifier is an invitation to log what it returns next to the error it came
  // from, which puts an upstream string back beside our label.
  'cachingDekSource', 'quiesceMsFor',
  'DEFAULT_DEK_TTL_MS', 'DEFAULT_POINTER_TTL_MS', 'DEFAULT_QUIESCE_MS',
  'GRACE_INELIGIBLE_CODES',

  // key-store.ts (5) — the PORT: types, two sentinels, the refusal pair and the patch
  // assertion. There is no store here and there is no `memoryContentKeyStore` on this list, which is
  // the other half of "the package never sees wrapped key material".
  'isRefusal', 'refusal', 'assertContentKeyPatch', 'KEY_PATCH_DELETE', 'KEY_PATCH_SERVER_TIME',

  // key-lifecycle.ts (14) — the ten planners, the three status derivations and the cap on the
  // one string a product hands this module (§11.6.1, the third leak path). Every planner
  // returns `ContentKeyPatch | Refusal`; there is no `XPlan` and no verb per transition.
  'planMint', 'planRevoke', 'planRestore', 'planDestroy', 'planRegenerate',
  'planBeginRotation', 'planRecordProgress', 'planFailRotation', 'planFinishRotation',
  'planDrain',
  'deriveStatus', 'toContentKeyStatus', 'toGenerationStatus', 'MAX_ROTATION_ERROR_CHARS',

  // doc-codec.ts (2) — the planner's factory and the lift for collab's two-argument transform.
  // `createDocCodec` and `subPathForInsideKey` are NOT here: the first binds a registry and a
  // scope, which is `createContentCrypto`'s job and nobody else's, and the second is how
  // `planUpdate` turns an update key into a position inside a payload — reaching it directly
  // would be a caller deciding placement for itself.
  'createDocPlanner', 'asNodeTransform',

  // content-crypto.ts (1) — one factory, and STILL one after R10a. `createRecord` now makes the
  // wrap durable itself, through the `WrapCommitter` its options require, before any object
  // capable of sealing exists; `createRecords` and `withNewRecord` are methods on the façade the
  // factory returns, not module exports, which is why the whole change costs this list nothing.
  // The three new names — `WrapCommitter`, `WrapCommitRequest`, `WrapReceipt` — are TYPES, and
  // types erase: `tsc` is what checks those, in both trees.
  'createContentCrypto',

  // walk.ts (5) — `assertHead` is declared in key-scope.ts and published from here, which is why
  // it appears on this list only now. `checkTraversal` is NOT here and must not be: it is the
  // conformance suite a product runs in its own repo's tests, so it ships from `./testing`, and
  // check-mirror assertion (7) names it among the things the production barrel may not carry.
  // `applyWrapPatch` is R13's half of the swap above: the single-record grant, un-share, transfer
  // and erase, run as `runWrapJob` over a traversal of one record rather than as a second
  // implementation — which is what leaves the materialiser exactly one call site to guard.
  'applyWrapPatch', 'assertHead', 'createBatchWriter', 'runWrapJob', 'WALK_PAGE_SIZE',

  // legacy-readers.ts (12) — deleted whole at Phase G
  'ENC_PREFIX_V1', 'ENC_PREFIX_V2', 'LEGACY_GENERATION', 'isLegacyValue', 'legacyVersionOf',
  'legacyGenerationOf', 'decryptLegacyField', 'legacyGenerationsIn',
  'legacyObjectAad', 'readLegacyObjectEnvelope', 'openLegacyObject', 'assertGeneration',
];

describe('the public barrel', () => {
  it('exports exactly the declared names, and nothing else', () => {
    const actual = Object.keys(barrel)
      .filter((name) => name !== '__esModule')
      .sort();

    expect(actual).toEqual([...EXPECTED_EXPORTS].sort());
  });

  it('names each export once — a duplicate would make the equality above pass by accident', () => {
    expect(new Set(EXPECTED_EXPORTS).size).toBe(EXPECTED_EXPORTS.length);
  });

  it('carries 135 values, which is the number a reviewer signs off', () => {
    // Written down so that growing the surface is a decision, not a diff nobody read.
    //
    // R10a added a port, two payload types, `createRecords` and `withNewRecord`, and removed
    // `PendingRecordSession` — and this number did not move, because every one of those is either
    // a type or a member of the façade. That is worth noticing rather than glossing: a change that
    // grows the API without growing the SURFACE is a change nobody has to un-learn later.
    //
    // R10 then took FOUR OFF — `mintRecordKey`, `wrapRecordKey`, `unwrapRecordKey` and the free
    // `planWraps` — which is the only direction this number has ever moved that costs nothing:
    // no consumer exists yet, adding an export back is trivial and reversible, and removing one
    // after 0.1.0 publishes is a breaking change. R11 added `readWraps` to the port and moved it
    // off `WrapCommitHarness`; both are types, so neither touches this list.
    //
    // R13 is a SWAP and not a growth: `materialiseWrapPatch` off, `applyWrapPatch` on, 135 either
    // way. Worth stating, because "the number did not move" is the thing a reviewer would
    // otherwise read as "nothing happened to the surface" — the surface is the same size and a
    // different shape, which is exactly what replacing an export with the route it was excusing
    // looks like.
    //
    // R17 (rename) renamed a FIELD — `ContentCryptoOptions.custodian` and `ContentCrypto.custodian`
    // to `dekSource` — and R18 (precondition) added `Precondition` and `PreconditionToken`, which
    // are TYPES. Neither can move this number, for the reason stated at the top of this file: a
    // type export erases and `Object.keys` never sees it. Recorded so that "135 again" is read as
    // a check that held rather than as a pass in which nothing was looked at.
    expect(EXPECTED_EXPORTS.length).toBe(135);
  });

  it('exports no value the package keeps internal', () => {
    // Named individually rather than pattern-matched: these are the three the design
    // depends on staying unreachable — the accessor that turns a key handle back into
    // bytes, the AES call site's raw opener, and the in-memory test store, which lives
    // behind the ./testing subpath so it cannot arrive in a production bundle by accident.
    for (const name of ['secretBytes', 'openBuffer', 'memoryContentKeyStore']) {
      expect(Object.keys(barrel)).not.toContain(name);
    }
  });

  it('exports no loose record-key primitive, and no free key-taking planWraps (R10)', () => {
    // The A2 path — `mintRecordKey` + `planWraps` + `openRecord` — seals content under a key whose
    // wrap was never written, with NOTHING FALSE SAID and the committer never invoked. Read-back
    // (R11) cannot see it, because the port is never called; it is closed by not handing out the
    // parts. Named individually rather than pattern-matched, because `rewrapRecordKey`,
    // `parseKeyWraps` and `session.planWraps` are all legitimate and a regex would take them too.
    for (const name of ['mintRecordKey', 'wrapRecordKey', 'unwrapRecordKey', 'planWraps']) {
      expect(Object.keys(barrel)).not.toContain(name);
    }
  });

  it('exports no materialiser, and does export the route that replaced it (R13)', () => {
    // `materialiseWrapPatch` was kept for one release's worth of reasoning: a consumer outside
    // `runWrapJob` needed it to translate the `{ op: 'delete' }` sentinel. That reasoning did not
    // survive contact with the worked examples — four of five wrote `patch.update` raw WITH the
    // export available, because the caller who writes it raw is the caller who never knew a
    // materialiser existed. So the export goes and the missing route arrives: a single-record
    // apply now has a door, and it translates through the sink's own `deleteField`.
    expect(Object.keys(barrel)).not.toContain('materialiseWrapPatch');
    expect(Object.keys(barrel)).toContain('applyWrapPatch');
    expect(typeof (barrel as Record<string, unknown>).applyWrapPatch).toBe('function');
  });

  it('exports no bytes-to-key constructor', () => {
    // Key material enters the package through the custodian and nowhere else. `secret.ts`
    // needs a way to build a handle for the custodian and for the mint; that way is
    // module-private and this is the assertion that keeps it so.
    for (const name of Object.keys(barrel)) {
      expect(name).not.toMatch(/[Ff]romBytes|[Bb]ytesTo/);
    }
  });

  it('exports no writer for a superseded wire format', () => {
    // The legacy section reads. Nothing in this package writes an old wire, from any
    // entrypoint — and this test proves it by importing the entrypoint itself.
    for (const name of Object.keys(barrel)) {
      expect(name).not.toMatch(/^(encrypt|seal).*(V1|V2)$/);
      expect(name).not.toMatch(/^(encryptLegacy|sealLegacy)/);
    }
  });

  it('exports no typestate leftovers from the ordering guard R10a replaced', () => {
    // `PendingRecordSession` was a TYPE and never appeared on this list, so its removal is a `tsc`
    // fact rather than a runtime one. What this clause is really guarding is the shape somebody
    // might reach for while re-deriving the problem: a free function that "commits the wrap", or a
    // helper somebody has to remember to call. The durability invariant costs no export, and a
    // name arriving here to carry it would mean it had stopped being structural.
    for (const name of ['wrapCommitted', 'commitWrap', 'commitWraps', 'persistWrap',
      'createPendingRecord', 'assertWrapCommitted', 'checkWrapCommit']) {
      expect(Object.keys(barrel)).not.toContain(name);
    }
  });

  it('exports no wrap verb per transition, and no `move`', () => {
    // §9.3: grant, revoke, transfer, rotate and erase are ONE call over a desired set.
    // A second verb is how the five transitions become five code paths again.
    //
    // Named individually and NOT pattern-matched on `plan*`: `key-lifecycle.ts` legitimately
    // exports `planRevoke` and four siblings, which are planners over the KEY lifecycle —
    // a different port, a different noun. A `/^plan/` regex here would fail the moment step
    // 12 lands and would have been "fixed" by deleting this test.
    for (const name of ['grantWrap', 'revokeWrap', 'transferWrap', 'rotateWrap', 'eraseWrap',
      'moveWrap', 'move', 'planGrantWrap', 'planRevokeWrap', 'planTransferWrap',
      'planMoveWrap', 'WrapVerb', 'CONFLICT_POLICY']) {
      expect(Object.keys(barrel)).not.toContain(name);
    }
  });
});
