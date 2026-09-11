/**
 * `@xbg.solutions/utils-content-crypto` — content encryption, record keys and key custody.
 *
 * ONE model. Content is sealed under a RECORD key; the record key exists at rest only as
 * wraps under account DEKs; the set of wraps IS the access list. Account granularity is that
 * model with the dial turned down (`key-scope.ts`), never a second code path.
 *
 * This package knows nothing about Firestore, Cloud Storage or KMS, and must not learn.
 * Storage is behind a port; write targets and preconditions are opaque; timestamps cross as
 * ISO strings. It declares zero dependencies and zero peerDependencies, and imports nothing
 * but four `node:` builtins and its own files.
 *
 * Custody is deliberate and custodial: Accounts returns the PLAINTEXT DEK over TLS, the
 * product holds it in memory only, and it never reaches a log, an error or an event payload.
 * There is no client-held key material, ever. `PII_ENCRYPTION_KEY` (utils-hashing) is a
 * separate system answering a different question and this package must never reference it.
 *
 * A product supplies three things and nothing else: a `ContentKeyScope`, a registry from
 * `defineRegistry`, and its own traversal. See UPGRADING.md.
 *
 * ── WHAT IS HERE, AND WHAT IS NOT ────────────────────────────────────────────────────────
 *
 * All twenty-three modules of §3 now exist. This barrel is the surface of TWENTY-TWO of
 * them: errors, secret, aad, field-path, registry, key-scope, cipher (internal — never
 * re-exported here), field-codec, blob-json, blob-codec, record-key, wrap-patch,
 * object-envelope, custodian (types only), custodian-cache, key-store, key-lifecycle,
 * doc-codec, content-crypto, walk and legacy-readers.
 *
 * `testing.ts` is the twenty-third and has no section here, deliberately: it is a SEPARATE
 * entrypoint (`./testing`), never part of this surface — `expectNoKeyMaterial`,
 * `registerKeyMaterialFixture`, `memoryContentKeyStore`, `fixedDekSource`, `checkTraversal` and
 * `checkWrapCommit` all ship from there so that a test helper cannot arrive in a production
 * bundle by accident, and it throws on import inside a deployed function because the mirror
 * has no `exports` map to close the subpath for it. Assertion (7) keeps `checkTraversal` off
 * this list, and `checkWrapCommit` is off it for the same reason: both are conformance suites
 * a product runs against ITS OWN code, in its own repo.
 *
 * Never `export *`. A star export is how an internal reaches the surface without anybody
 * deciding that it should — and the things this package keeps internal (the AES call site in
 * `cipher.ts`, the accessor that turns a key handle back into bytes, the bytes-to-key
 * constructors, `documentByteCost`, `decodeBlobBody`) are internal for reasons the type
 * system cannot restate. `index.test.ts` asserts this surface as an EQUALITY, not a subset.
 */

// ── Errors ──────────────────────────────────────────────────────────────────────────────────
export {
  ContentCryptoError, isContentCryptoError, isKeyUnavailable, isUnreadable,
  KEY_UNAVAILABLE_CODES, UNREADABLE_CODES, HTTP_STATUS_FOR_CODE,
  assertNoSecrets, assertNoKeyMaterial, compact, SAFE_DETAIL_KEYS,
} from './errors';
export type { ContentCryptoCode, ErrorDetail, ErrorDetails } from './errors';

// ── Key handles — opaque and branded. Nothing public returns key bytes. ─────────────────────
export { isSecret, isDestroyed, KEY_BYTES, MAX_SEALS_PER_KEY } from './secret';
export type { Secret, AccountDek, RecordKey } from './secret';

// ── ContentKeyScope — the third thing a product supplies ───────────────────────────────────────────
export {
  resolveScope, resolveGraceMs, assertScopePath,
  documentRecordRef, aggregateRecordRef, accountRecordRef, recordRefKey,
  ACCOUNT_RECORD_TYPE, DEFAULT_GRACE_MS, DEFAULT_MAX_DOCUMENT_SEALED_BYTES,
  MIN_DERIVED_SEALED_BYTES,
} from './key-scope';
export type {
  ContentKeyScope, ResolvedScope, RecordGranularity, AadTightness, ReadStrictness, LegacyScope,
} from './key-scope';

// ── Registry — the second thing a product supplies (shape only; contents stay per product) ──
export { defineRegistry, EMPTY_REGISTRY, RESERVED_ROOTS } from './registry';
export type {
  FieldRegistry, RegistryEntry, RegistrySpec, ResolvedPath, FieldMode, PathSpec, PathDeclaration,
} from './registry';

// ── Field-path grammar and walker (plan §7 names these as Phase A contents) ─────────────────
export {
  parseFieldPath, formatFieldPath, isPlainObject, mapPath, mapPathNode, nodeAt,
  matchUpdateKey, mapUpdateValue, blobKeyRelation, parseSubPath, formatSubPath,
} from './field-path';
export type { PathSegment, UpdateKeyMatch, BlobKeyRelation, SubPathSegment } from './field-path';

// ── AAD. THREE forms are fixed by the plan and carry no domain prefix. The object form is ───
// ── this package's own and keeps one, because an object body has no payload-kind byte. ──────
export {
  aadForContent, aadForRecordKeyWrap, aadForDek, aadForObject, assertAad, AAD_OBJECT_DOMAIN,
} from './aad';

// ── Field codec (v3). Writes v3 only; reading the older wires lives in legacy-readers.ts. ───
// IV_BYTES and TAG_BYTES are declared in cipher.ts — they are AES-GCM parameters (R6/R9) — and
// re-exported by field-codec.ts, which is where §4 publishes them and where the wire is owned.
export {
  ENC_PREFIX_V3, WRAP_PREFIX, IV_BYTES, TAG_BYTES, PAYLOAD_KIND,
  decodeValue, isEncrypted, versionOf, isSealedBlobCandidate, encryptField, decryptField,
} from './field-codec';
export type { DecodedValue, PayloadKind, EncryptedField } from './field-codec';

// ── Blob serialisation (pure; no crypto) ────────────────────────────────────────────────────
export {
  BLOB_SERIALISER_VERSION, DEFAULT_MAX_SEALED_BYTES, DEFAULT_MAX_DEPTH,
  encodeBlob, decodeBlob, blobRoundTrips, maxPlaintextFor, BUILTIN_TAGS, firestoreTimestampAdapter,
} from './blob-json';
export type { BlobValue, BlobAdapter, BlobEncodeOptions } from './blob-json';

// ── Blob codec (the main new mechanism). Not a second encryption model: the same enc:v3: wire, ─
// ── the same record key, the same tight AAD — only the plaintext bytes differ. `sealBlobNode` ──
// ── and `openBlobNode` (placement) stay internal: a consumer reaching one would be deciding ────
// ── placement for itself, which is what the registry exists to stop.
export { encryptBlob, decryptBlob, applyBlobPatch } from './blob-codec';
export type {
  EncryptedBlob, BlobPatchOp, BlobResealRequest, BlobSealOptions, BlobSite,
} from './blob-codec';

// ── Record keys — the wraps ARE the access list. `wrapHolders` is the same set, queryable. ──
// The KEY PRIMITIVES ARE NOT HERE (R10). `mintRecordKey`, `wrapRecordKey` and `unwrapRecordKey`
// are internal, because `mintRecordKey` + `planWraps` + `openRecord` seals content under a record
// key whose wrap was never written — with NOTHING FALSE SAID and the `WrapCommitter` never
// invoked. Being the one unsafe path that requires no lie of the caller, it is the likeliest to be
// taken by accident, and that makes it an export-surface problem rather than a trust ceiling.
// `createRecord` is the door: it mints, commits and READS THE WRAP BACK before anything can seal.
// **Do not re-export these on the reasoning that a consumer might want the primitives.** A
// speculative export is exactly what was removed; if something genuinely needs one, REPORT IT so
// it becomes a decision rather than a correction.
export {
  KEY_WRAPS_FIELD, WRAP_HOLDERS_FIELD,
  rewrapRecordKey, holdersOf, hasWrap, wrapCount, isLastWrap, isUnreachable,
  parseKeyWraps, assertKeyWraps,
} from './record-key';
export type { RecordRef, WrapEntry, KeyWraps } from './record-key';

// ── The ONE reconcile. grant / revoke / transfer / rotate / erase are one call. ─────────────
// The free, KEY-TAKING `planWraps` is off this surface (R10) — it is half of the path above.
// `session.planWraps` is the same capability on the façade, where the key is the session's and the
// caller holds none, so the vector goes and the capability stays. `materialiseWrapPatch` is off it
// too (R13), and for a different reason: exporting it did not prevent the raw-sentinel mistake.
// The person who writes `{ op: 'delete' }` raw is exactly the person who did not know a
// materialiser existed, so the export served whoever already knew to look for it and did nothing
// for the case that justified it — four of the five worked examples wrote `patch.update` raw with
// it on the barrel. The single-record apply now has a first-class route instead, `applyWrapPatch`
// in ./walk, which translates internally through the sink's own `deleteField`.
export { conflictPolicyFor } from './wrap-patch';
export type {
  WrapPatch, WrapPatchValue, WrapDiff, WrapAudit, DesiredWraps, GrantScope, CutOff, ConflictPolicy,
} from './wrap-patch';

// ── Object envelope (x-xbg-*). Buffered is the default; streaming is an explicit opt-in. ────
// The object AAD is the one form the programme plan does not fix (§18 Q-O) and the one that
// still carries a domain prefix, because an object body has no payload-kind byte.
export {
  OBJECT_META, OBJECT_ENC_VERSION, isEncryptedObject, readObjectEnvelope,
  objectEnvelopeMetadata, mergeObjectMetadata, sealObject, openObject,
  createObjectEncryptStream, createObjectDecryptStream,
} from './object-envelope';
export type { ObjectRef, ObjectMetadata, ObjectEnvelope, UnverifiedStreamAck } from './object-envelope';

// ── Custodian — the READ path. There is no implementation in this package (decision 1). ─────
export type {
  DekSource, CachedDekSource, DekHandle, CacheStats,
  ContentKeyStatus, GenerationStatus, RotationProgress, OpenRotation, ContentKeyState, RevokedCause,
} from './custodian';

// ── The caching source. The TTL IS the revocation window, and the grace window lives here ──
// ── and nowhere else. `cachingDekSource` is the only producer of a `CachedDekSource`, which ─
// ── is what makes caching mandatory rather than advisory. ───────────────────────────────────
export {
  cachingDekSource, quiesceMsFor,
  DEFAULT_DEK_TTL_MS, DEFAULT_POINTER_TTL_MS, DEFAULT_QUIESCE_MS, GRACE_INELIGIBLE_CODES,
} from './custodian-cache';
export type { CacheOptions, GraceInfo, GraceReason } from './custodian-cache';

// ── The ContentKeyStore PORT. Row-shaped, never path-shaped: the consumer implements it, and ───────
// ── Accounts' and collab's very different storage are the SAME port. `GenerationRow` says ───
// ── `hasWrap` and never `wrappedDek`, which is the checkable form of "no local custodian". ──
export { isRefusal, refusal, assertContentKeyPatch, KEY_PATCH_DELETE, KEY_PATCH_SERVER_TIME } from './key-store';
export type {
  ContentKeyStore, ContentKeyRow, GenerationRow, ContentKeyPatch, ContentKeyPatchValue, GenerationPatch, Refusal, ContentKeyAudit,
} from './key-store';

// ── Lifecycle RULES as planners over that port. Pure: no I/O, no store handle, no clock ─────
// ── beyond an injected `now`. The local implementation is throwaway; these rules are what ───
// ── Accounts needs again in Phase B, so the rules ship and the implementation does not. ─────
export {
  planMint, planRevoke, planRestore, planDestroy, planRegenerate,
  planBeginRotation, planRecordProgress, planFailRotation, planFinishRotation, planDrain,
  deriveStatus, toContentKeyStatus, toGenerationStatus, MAX_ROTATION_ERROR_CHARS,
} from './key-lifecycle';

// ── Documents — registry-driven, synchronous, pure ──────────────────────────────────────────
// The planner is collab's deployed four-argument signature, generalised over a registry. Its
// factory is the door: `createDocCodec` — the rest of the document layer, which holds a key —
// stays INTERNAL, because a consumer reaching it would be binding a registry and a scope for
// itself, and `createContentCrypto` is the one thing that may. `subPathForInsideKey` stays
// internal for the same reason: `planUpdate` is how an update reaches a blob.
export { createDocPlanner, asNodeTransform } from './doc-codec';
export type {
  DocPlan, DocPlanner, PlannedAt, NodeTransform, ValueTransform, SealedUpdate,
} from './doc-codec';

// ── The façade — what five products call. It holds the only RecordKey there is. ─────────────
// `createRecord` MAKES THE WRAP DURABLE ITSELF, through the required `WrapCommitter` port, and only
// then hands back a session that can seal (R10a). The ordering is not a type and never was one: a
// typestate enforces call order, and the invariant is durability — a wrap unflushed in a batch
// satisfies any type and destroys the content anyway. The port also READS THE WRAPS BACK, and a
// create is refused unless the store holds every one of them (R11): that closes the durability lie
// and not the create-only one, which is `checkWrapCommit`'s, in the product's own CI (R12). `withNewRecord` is the create-side twin of
// `withRecord`, closing on the throw path. `RecordSession` has no `key` member and no
// `decryptDocSafe` — safety belongs at the key boundary, not the value boundary.
export { createContentCrypto } from './content-crypto';
export type {
  ContentCrypto, ContentCryptoOptions, OpenAs, RecordInput,
  RecordSession, CreatedRecord, MigratedDoc,
  WrapCommitter, WrapCommitRequest, WrapReceipt,
} from './content-crypto';

// ── Traversal, batched writes, and the ONE job — through TWO doors ──────────────────────────
// `assertHead` is DECLARED in key-scope.ts — granularity is compared in one file — and PUBLISHED
// here, because a head is walk.ts's noun. `checkTraversal` is deliberately absent: it is a
// conformance suite a product runs in its own repo's tests, so it ships from `./testing`, beside
// `expectNoKeyMaterial`, and assertion (7) keeps it off this surface.
// `applyWrapPatch` (R13) is `runWrapJob` over a traversal of ONE record — the single-record grant,
// un-share, transfer and erase, which is what most §14 examples actually do and what previously
// had no door at all. It is the same code and not a second implementation, which is what leaves
// `materialiseWrapPatch` with exactly one call site in the package and none outside it.
export { applyWrapPatch, assertHead, createBatchWriter, runWrapJob, WALK_PAGE_SIZE } from './walk';
// `Precondition` and `PreconditionToken` are types, so neither touches the 135-value equality.
// They are on the surface because `WrapApplyArgs.precondition` is REQUIRED since R18
// (precondition) — a token, or the word `'unconditional'` — and a product writing a typed wrapper
// around `applyWrapPatch` should be able to spell what it is passing through.
export type {
  RecordHead, WalkedDoc, ForEachRecord, ForEachContentDoc, ForEachContentObject,
  WriteRow, WriteSink, BatchWriter, BatchWriterOptions, WrapJobArgs, WrapJobResult, WrapApplyArgs,
  Precondition, PreconditionToken,
} from './walk';

// ── Legacy readers — DELETE THIS SECTION AND ./legacy-readers.ts AT PHASE G. ────────────────
// The two older wires exist only until collab's Phase-C walk converts 182 + 60 values. No
// writer for either ships from any entrypoint, and a test asserts that by importing this
// barrel.
export {
  ENC_PREFIX_V1, ENC_PREFIX_V2, LEGACY_GENERATION, isLegacyValue, legacyVersionOf,
  legacyGenerationOf, decryptLegacyField, legacyGenerationsIn,
  legacyObjectAad, readLegacyObjectEnvelope, openLegacyObject, assertGeneration,
} from './legacy-readers';
export type { LegacyObjectEnvelope } from './legacy-readers';
