/**
 * `doc-codec.ts` — the registry-driven document layer (§13.1, §8.10).
 *
 * Generalised from collab's deployed `lib/content-walk.ts`, whose three-line split of
 * responsibilities is the design and is kept exactly:
 *
 *     the registry     WHICH fields, and their AAD. Pure.
 *     the doc planner  HOW to visit them in one document's data.
 *     the caller       WHAT to do with each value.
 *
 * collab's planner is bound to its own `ContentCollection` union and to one module-singleton
 * table; this one takes a `FieldRegistry` and a `ResolvedScope` instead. Everything else
 * carried across unchanged, deliberately and with collab's own tests as the floor:
 *
 *   - **`changed` is the number of values the transform actually REPLACED**, compared with
 *     `!==` and summed across paths. A path that changed nothing is never named in `update`,
 *     which is the whole idempotency contract and the reason a migration is re-runnable.
 *   - **Skip is "return what you were given", and it is the only skip mechanism.** There is no
 *     crypto and no ciphertext detection anywhere in the planner. collab's two callers express
 *     idempotency differently — the rotation by generation, the migration by `isEncrypted` —
 *     and both are right, because the decision is the caller's.
 *   - **The update key is the registered path truncated at the first array segment**, so
 *     `proposal.title` writes `proposal.title` and `attachments[].filename` writes the WHOLE
 *     `attachments` array. Firestore cannot address an element by a registered path.
 *   - **The AAD is built per PATH, not per value**, so every element of an array shares one.
 *     That is what lets `arrayUnion` write a single sealed element later, and what makes an
 *     array reorder a no-op rather than a decrypt failure.
 *   - **`next` accumulates across paths.** The read-back is from the accumulated value, never
 *     from the input. Two registered paths under one array segment both write the key
 *     `attachments`, and a planner that ran each path against the original document would drop
 *     the first path's ciphertext with no test failing. `doc-codec.test.ts` has that test.
 *
 * ── WHAT THIS MODULE ENFORCES THAT NOTHING ELSE CAN ─────────────────────────────────────────
 *
 * **"Is this path registered."** `FieldRegistry.aadFor` deliberately does not check: a legacy
 * read at a since-renamed path and a blob reseal both need an AAD for a path the current table
 * may not list, so a guard there would refuse two legitimate operations. The registered set is
 * therefore enforced HERE, where a walk chooses its paths and where a caller names one by hand
 * (`openBlobAt`, `encryptArrayValue`, `resealRequest`). That is the whole of the arrangement,
 * and `registry.ts` says so at `aadFor`.
 *
 * ── WHAT IT IS NOT ──────────────────────────────────────────────────────────────────────────
 *
 * Synchronous, pure, and key-in-hand: every function here takes an already-open `RecordKey`, so
 * no document walk can stall mid-way on a key fetch — the property that removes the
 * half-a-document-at-each-generation hazard. There is no I/O, no clock and no store handle. The
 * façade (`content-crypto.ts`) binds the key and the collection type onto a session; the walk
 * itself is here so that a migration script, which holds a key outside a session, uses the same
 * one.
 */

import {
  applyBlobPatch as applyBlobPatchWithOptions, openBlobNode, sealBlobNode,
} from './blob-codec';
import type {
  BlobPatchOp, BlobResealRequest, BlobSealOptions, BlobSite, EncryptedBlob,
} from './blob-codec';
import { documentByteCost } from './blob-json';
import type { BlobEncodeOptions } from './blob-json';
import { ContentCryptoError, compact } from './errors';
import { decryptField, encryptField, isEncrypted } from './field-codec';
import type { EncryptedField } from './field-codec';
import {
  blobKeyRelation, isPlainObject, formatSubPath, mapPath, mapPathNode, mapUpdateValue,
  matchUpdateKey, nodeAt,
} from './field-path';
import type { PathSegment, SubPathSegment } from './field-path';
import type { ResolvedScope } from './key-scope';
import { derivePathCeilings } from './registry';
import type {
  Ceilings, FieldMode, FieldRegistry, ReadStrictness, RegistryEntry, ResolvedPath,
} from './registry';
import type { RecordKey } from './secret';

// ---------------------------------------------------------------------------
// The planner's contract (§13.1)
// ---------------------------------------------------------------------------

/**
 * Where one planned value sits.
 *
 * The transform is handed the binding it must use and **no way to rebuild it**, which is why
 * `collection` and `docId` are not here: a transform that could re-derive an AAD could disagree
 * with the registry, or seal under a *convenient* one. The rule to apply when somebody asks for
 * one more field is exactly that — anything added to this object is something a transform can
 * then build an AAD out of.
 */
export interface PlannedAt {
  /** The AAD to seal or open under. The registry built it; nothing else may. */
  readonly aad: string;
  /** `'string'` → a leaf string at a registered path. `'blob'` → a whole subtree, sealed as one. */
  readonly mode: FieldMode;
  /**
   * The registered path, `[]` retained, for error messages and per-path ceilings. Display only:
   * it cannot reconstruct the AAD without the registry's `root` override.
   */
  readonly fieldPath: string;
}

/**
 * What to do with one registered value. Return the value you were given to leave it alone;
 * anything else is written.
 *
 * **For a BLOB, "the value you were given" means the SAME REFERENCE.** A structurally equal
 * clone counts as a change and will be written — there is no deep comparison here and there
 * cannot be one, because two seals of identical plaintext differ under their fresh IVs anyway.
 */
export type NodeTransform = (node: unknown, at: PlannedAt) => unknown;

/** collab's two-argument transform, unchanged, for string-only call sites. */
export type ValueTransform = (value: string, aad: string) => string;

/**
 * Lift collab's `(value, aad) => string` into a `NodeTransform`, so its deployed rotate and
 * migration transforms port with no rewrite.
 *
 * A non-string node is returned untouched and never reaches `t`. That cannot arise from a
 * registered *string* path — `mapPath`'s leaf filter already guarantees it — but it can from a
 * blob path, and handing a `Record<string, unknown>` to a function typed `(value: string)`
 * would be the "we passed the whole object" bug arriving one layer above where
 * `encryptField` catches it.
 */
export function asNodeTransform(t: ValueTransform): NodeTransform {
  return (node, at) => (typeof node === 'string' ? t(node, at.aad) : node);
}

/** One document's planned write. `update` is `{}` exactly when `changed` is 0: do not write. */
export interface DocPlan {
  /** Changed values only: a dotted key per nested value, the WHOLE ARRAY for an array path. */
  readonly update: Readonly<Record<string, unknown>>;
  /** Values the transform actually REPLACED. 0 means `update` is `{}` means do not write. */
  readonly changed: number;
  /**
   * Registered values REACHED, replaced or not. A dry run reports `changed: 0` and this is what
   * tells it whether it reached anything — collab's migration script had to wrap the planner in
   * its own counter for exactly this, and every product doing a migration would rebuild that.
   */
  readonly visited: number;
}

/** collab's four-argument signature, exactly. The registry and the scope are bound once. */
export interface DocPlanner<C extends string> {
  (collection: C, docId: string, data: unknown, transform: NodeTransform): DocPlan;
}

/**
 * A Firestore-shaped update, classified and sealed (§8.10).
 *
 * `reseals` is non-empty when a dotted key reached INSIDE a sealed blob. **A reseal is a
 * write**, and it is a read-modify-write: every one must run inside a transaction whose own
 * `tx.get` produced the `current` value handed to `applyBlobPatch`. Two concurrent appends
 * without one each read the same blob and the second overwrites the first — a silently lost
 * record, with no error anywhere.
 *
 * **One request per update KEY, not per field path**, which matters when two keys reach into
 * one blob: the second reseal must see the first's output, so a caller FOLDS the requests
 * through the accumulating value and never maps them independently. `§14.7`'s worked example
 * is written that way and says so; writing the map is the obvious mistake and it loses one of
 * the two updates.
 */
export interface SealedUpdate {
  readonly update: Record<string, unknown>;
  readonly reseals: readonly BlobResealRequest[];
}

/**
 * The document layer with its registry and scope bound, and the key still to come.
 *
 * The key is a per-call argument rather than a constructor argument because one registry and
 * one scope serve every session of a process, while a `RecordKey` belongs to one record and is
 * zeroised when its session closes. `content-crypto.ts` binds the key onto a `RecordSession`;
 * a migration script passes it directly.
 */
export interface DocCodec<C extends string> {
  /** The bound planner. Registry-driven, pure, synchronous, key-free. */
  readonly planDoc: DocPlanner<C>;

  /**
   * Seal every registered path. **A write always encrypts**, including a plaintext that happens
   * to look like a ciphertext. Returns `data` BY REFERENCE when nothing was registered or
   * nothing was present — a document with nothing to encrypt costs nothing.
   */
  encryptDoc<T extends object>(key: RecordKey, collection: C, aadDocId: string, data: T): T;

  /** Open every registered path, per the strictness table (§7.4). */
  decryptDoc<T extends object>(key: RecordKey, collection: C, aadDocId: string, data: T): T;

  /**
   * `decryptDoc` for a batch of rows. `docIdOf` defaults to `.id` and is **required** for any
   * collection whose entry carries a `root` override — a `root` override is exactly the signal
   * that the AAD id is not the row id (collab's `versions`, build's `checkpoints`).
   */
  decryptDocs<T extends { id: string }>(
    key: RecordKey, collection: C, docs: readonly T[], docIdOf?: (doc: T) => string,
  ): T[];

  /** Classify AND seal a Firestore-shaped update (§8.10). */
  planUpdate(
    key: RecordKey, collection: C, aadDocId: string, update: Readonly<Record<string, unknown>>,
  ): SealedUpdate;

  /**
   * The convenience form. Throws `BLOB_PARTIAL_UPDATE` when a key reached inside a blob, naming
   * the whole-blob write path — so a caller who has not thought about it cannot ship a lost
   * update.
   */
  encryptUpdate(
    key: RecordKey, collection: C, aadDocId: string, update: Readonly<Record<string, unknown>>,
  ): Record<string, unknown>;

  /**
   * Seal one element for `arrayUnion` on a registered array path. `fieldPath` is the array's
   * path with or without `[]`; the AAD is always the registered `declinedProposals[]` form.
   */
  encryptArrayValue(
    key: RecordKey, collection: C, aadDocId: string, fieldPath: string, value: string,
  ): EncryptedField;

  /** The symmetric read, for an element pulled out of an array without its document. */
  decryptArrayValue(
    key: RecordKey, collection: C, aadDocId: string, fieldPath: string, value: string,
  ): string;

  /** Open one sealed blob and assert its shape. The payload is free-form by definition. */
  openBlobAt<T>(
    key: RecordKey, collection: C, aadDocId: string, fieldPath: string, value: unknown,
  ): T;

  /**
   * Build a reseal request for a registered blob path by hand — the registry-blessed way to
   * express an `unset` or an `append`, neither of which a Firestore-shaped update key can say.
   * The AAD comes from the registry, which is the only builder there is.
   */
  resealRequest(
    collection: C, aadDocId: string, fieldPath: string, patches: readonly BlobPatchOp[],
  ): BlobResealRequest;

  /**
   * Open, patch and reseal one blob, with THIS path's ceilings, adapters and compression.
   *
   * The free-standing `applyBlobPatch(key, req, current, opts)` takes those options as an
   * argument; this is the same call with the options resolved from the registry and the scope,
   * which is the only reason it lives here rather than in the façade. A caller assembling that
   * bundle for itself is a second place holding a per-path ceiling, and a ceiling held in two
   * places is a ceiling that eventually disagrees with itself.
   *
   * It also checks that `req.fieldPath` really is a registered blob path of `req.collection`,
   * which the free-standing form cannot: it holds no registry.
   */
  applyBlobPatch(key: RecordKey, req: BlobResealRequest, current: unknown): EncryptedBlob;
}

// ---------------------------------------------------------------------------
// The factories
// ---------------------------------------------------------------------------

/**
 * The registry is bound ONCE and the returned function is collab's signature exactly, which is
 * the signature the programme plan quotes as the precedent. A fifth positional argument at
 * every call site is the change the plan's naming section rules out.
 *
 * Generic in `RT` (R9): `ResolvedScope<string>` would accept no product's scope at all, because
 * a fixed-key `Record<RT | 'account', G>` has no string index signature.
 *
 * **The planner itself reads only the registry today, and takes the scope anyway.** That is
 * §13.1's declared signature and it is worth one sentence rather than a silent unused
 * parameter: the codec built alongside it needs the scope for read strictness, adapters,
 * compression and the per-path ceilings, and one factory producing both is what stops a caller
 * pairing a planner with one scope and a codec with another. `createDocPlanner` is the narrow
 * door onto the same object.
 */
export function createDocPlanner<C extends string, RT extends string>(
  registry: FieldRegistry<C>, scope: ResolvedScope<RT>,
): DocPlanner<C> {
  return createDocCodec(registry, scope).planDoc;
}

/**
 * The whole document layer, bound to one registry and one scope.
 *
 * Per-path ceilings are derived ONCE, on first use of a collection, and memoised — `doc-codec`
 * and `blob-codec` read the registry's numbers and never re-derive them, because a ceiling held
 * in two places is a ceiling that eventually disagrees with itself. Since R8 those numbers are
 * per PATH, so `derivePathCeilings` is what is called here and never `deriveCeilings`, which is
 * a collection-wide upper bound and would silently give a small path the ceiling of the large
 * one beside it.
 */
export function createDocCodec<C extends string, RT extends string>(
  registry: FieldRegistry<C>, scope: ResolvedScope<RT>,
): DocCodec<C> {
  const prepared = new Map<string, PreparedCollection>();

  const prepare = (collection: C): PreparedCollection => {
    const found = prepared.get(collection);
    if (found !== undefined) return found;
    const built = prepareCollection(registry, scope, collection);
    prepared.set(collection, built);
    return built;
  };

  const planDoc: DocPlanner<C> = (collection, docId, data, transform) => {
    const walked = walkDoc(prepare(collection), collection, docId, data, transform);
    return Object.freeze({
      update: Object.freeze(walked.update),
      changed: walked.changed,
      visited: walked.visited,
    });
  };

  const codec: DocCodec<C> = {
    planDoc,

    encryptDoc<T extends object>(key: RecordKey, collection: C, aadDocId: string, data: T): T {
      const table = prepare(collection);
      const sealed: SealedContribution[] = [];
      const walked = walkDoc(table, collection, aadDocId, data, (node, at) => {
        const path = table.byFieldPath.get(at.fieldPath) as PreparedPath;
        const site = siteOf(collection, aadDocId, at.fieldPath);
        const out = path.path.mode === 'string'
          ? sealStringValue(key, at.aad, node)
          : sealBlobNode(key, at.aad, node, site, path.seal);
        if (typeof out === 'string' && out !== node) {
          sealed.push({ fieldPath: at.fieldPath, bytes: Buffer.byteLength(out, 'utf8') });
        }
        return out;
      });
      assertDocumentFits(collection, aadDocId, walked.next, sealed, scope.maxDocumentSealedBytes, 'doc');
      return walked.next as T;
    },

    decryptDoc<T extends object>(key: RecordKey, collection: C, aadDocId: string, data: T): T {
      const table = prepare(collection);
      const walked = walkDoc(table, collection, aadDocId, data, (node, at) => {
        const path = table.byFieldPath.get(at.fieldPath) as PreparedPath;
        const site = siteOf(collection, aadDocId, at.fieldPath);
        return path.path.mode === 'string'
          ? openStringValue(key, at.aad, node, table.reads, site)
          : openBlobNode(key, at.aad, node, site, table.reads, path.read);
      });
      return walked.next as T;
    },

    decryptDocs<T extends { id: string }>(
      key: RecordKey, collection: C, docs: readonly T[], docIdOf?: (doc: T) => string,
    ): T[] {
      const table = prepare(collection);
      if (docIdOf === undefined && table.entry.hasRootOverride) {
        throw new ContentCryptoError(
          'VALIDATION_ERROR',
          `decryptDocs needs a docIdOf for collection "${collection}": its registry entry `
          + `carries the root override "${table.entry.root}", which is exactly the signal that a `
          + 'row id is not the AAD id, so defaulting to `.id` would build the wrong AAD for '
          + 'every row and fail every open',
          { collection },
        );
      }
      if (!Array.isArray(docs)) {
        throw new ContentCryptoError(
          'VALIDATION_ERROR', `decryptDocs takes an array of rows, received ${typeName(docs)}`,
          { collection },
        );
      }
      const idOf = docIdOf ?? ((doc: T) => doc.id);
      return docs.map((doc) => codec.decryptDoc(key, collection, idOf(doc), doc));
    },

    planUpdate(
      key: RecordKey, collection: C, aadDocId: string, update: Readonly<Record<string, unknown>>,
    ): SealedUpdate {
      const table = prepare(collection);
      if (!isPlainObject(update)) {
        throw new ContentCryptoError(
          'VALIDATION_ERROR',
          `planUpdate takes a Firestore-shaped update object, received ${typeName(update)}`,
          { collection },
        );
      }
      const out: Record<string, unknown> = {};
      const reseals: BlobResealRequest[] = [];
      const sealed: SealedContribution[] = [];

      for (const updateKey of Object.keys(update)) {
        // THE ACCUMULATOR, one layer up from the planner's. One update key may match several
        // registered paths — `anchor` matches `anchor.quote` and `anchor.prefix` and two more —
        // and each match must apply to the RESULT of the last, never to `update[key]` re-read
        // from the input. collab's live code does this correctly and no isolated test would
        // catch the regression, which is why there is a named one for it here.
        let value = update[updateKey];

        for (const path of table.paths) {
          const aad = path.aad(collection, aadDocId);
          const site = siteOf(collection, aadDocId, path.path.fieldPath);

          if (path.path.mode === 'blob') {
            const relation = blobKeyRelation(updateKey, path.path.segments);
            if (relation === 'unrelated') continue;
            if (relation === 'inside') {
              reseals.push(insideReseal(collection, aadDocId, updateKey, aad, path.path, value));
              value = ABSENT;
              break;
            }
            if (relation === 'exact') {
              value = sealBlobNode(key, aad, value, site, path.seal);
              break;
            }
            // `contains`: the blob sits deeper inside this update value — `a` written whole
            // where `a.b` is the blob. Seal it in place; the rest of the value is the caller's.
            const inner = path.path.segments.slice(updateKey.split('.').length);
            value = mapPathNode(value, inner, (node) => sealBlobNode(key, aad, node, site, path.seal));
            continue;
          }

          const match = matchUpdateKey(updateKey, path.path.segments);
          if (match === null) continue;
          value = mapUpdateValue(value, match, (s) => sealStringValue(key, aad, s) as string);
        }

        if (value === ABSENT) continue;
        out[updateKey] = value;
        collectSealed(updateKey, value, sealed);
      }

      assertDocumentFits(collection, aadDocId, out, sealed, scope.maxDocumentSealedBytes, 'update');
      return { update: out, reseals: Object.freeze(reseals) };
    },

    encryptUpdate(
      key: RecordKey, collection: C, aadDocId: string, update: Readonly<Record<string, unknown>>,
    ): Record<string, unknown> {
      const plan = codec.planUpdate(key, collection, aadDocId, update);
      if (plan.reseals.length > 0) {
        const paths = [...new Set(plan.reseals.map((r) => r.fieldPath))];
        throw new ContentCryptoError(
          'BLOB_PARTIAL_UPDATE',
          `this update reaches inside the sealed blob${paths.length > 1 ? 's' : ''} `
          + `${paths.map(quoted).join(', ')} of ${collection}/${aadDocId}, and a dotted key cannot `
          + 'address a position inside a ciphertext. Write the whole blob at that path, or call '
          + 'planUpdate instead and apply its reseals inside a transaction whose own read '
          + 'produced the current value',
          compact({ collection, docId: aadDocId, fieldPath: paths[0] }),
        );
      }
      return plan.update;
    },

    encryptArrayValue(
      key: RecordKey, collection: C, aadDocId: string, fieldPath: string, value: string,
    ): EncryptedField {
      const path = requireArrayPath(prepare(collection), collection, fieldPath, 'encryptArrayValue');
      return encryptField(key, path.aad(collection, aadDocId), value);
    },

    decryptArrayValue(
      key: RecordKey, collection: C, aadDocId: string, fieldPath: string, value: string,
    ): string {
      const table = prepare(collection);
      const path = requireArrayPath(table, collection, fieldPath, 'decryptArrayValue');
      const opened = openStringValue(
        key, path.aad(collection, aadDocId), value, table.reads,
        siteOf(collection, aadDocId, path.path.fieldPath),
      );
      if (typeof opened !== 'string') {
        throw new ContentCryptoError(
          'VALIDATION_ERROR',
          `decryptArrayValue opens one element of ${collection}/${aadDocId}.`
          + `${path.path.fieldPath}, and this element is a ${typeName(value)}`,
          compact({ collection, docId: aadDocId, fieldPath: path.path.fieldPath }),
        );
      }
      return opened;
    },

    openBlobAt<T>(
      key: RecordKey, collection: C, aadDocId: string, fieldPath: string, value: unknown,
    ): T {
      const table = prepare(collection);
      const path = requireBlobPath(table, collection, fieldPath, 'openBlobAt');
      return openBlobNode(
        key, path.aad(collection, aadDocId), value,
        siteOf(collection, aadDocId, path.path.fieldPath), table.reads, path.read,
      ) as T;
    },

    resealRequest(
      collection: C, aadDocId: string, fieldPath: string, patches: readonly BlobPatchOp[],
    ): BlobResealRequest {
      const path = requireBlobPath(prepare(collection), collection, fieldPath, 'resealRequest');
      return Object.freeze({
        collection,
        docId: aadDocId,
        fieldPath: path.path.fieldPath,
        aad: path.aad(collection, aadDocId),
        patches: Object.freeze([...patches]),
      });
    },

    applyBlobPatch(key: RecordKey, req: BlobResealRequest, current: unknown): EncryptedBlob {
      if (req === null || typeof req !== 'object') {
        throw new ContentCryptoError(
          'VALIDATION_ERROR',
          'applyBlobPatch needs a BlobResealRequest; build one with resealRequest or take one '
          + 'from planUpdate',
        );
      }
      // The request names its own collection and path, and both are checked against the registry
      // here — a request built by hand for a path this collection does not register would
      // otherwise seal a payload under an AAD the read path never asks for.
      const path = requireBlobPath(
        prepare(req.collection as C), req.collection, req.fieldPath, 'applyBlobPatch',
      );
      return applyBlobPatchWithOptions(key, req, current, path.seal);
    },
  };

  return Object.freeze(codec);
}

// ---------------------------------------------------------------------------
// §8.10 — an `inside` update key, as a subPath
// ---------------------------------------------------------------------------

/**
 * Convert a dotted update key that reaches INSIDE a blob path into the subPath of the position
 * it addresses:
 *
 *     'structuredContent.loopbackItems.0.acknowledgedAt'  →  'loopbackItems[0].acknowledgedAt'
 *     'payload.checkins.2.status'                         →  'checkins[2].status'
 *
 * The rule is `matchUpdateKey`'s existing one — **a numeric part stands for one element of an
 * array** — applied to free-form data, and it inherits that rule's one ambiguity: a
 * numeric-looking object key inside a blob cannot be addressed through a Firestore-shaped
 * update key, because `{"0": …}` and `[…]` produce the same dotted key. A product needing one
 * writes the whole blob, or builds the `BlobPatchOp` itself with a backtick-quoted segment
 * (`` `0`.name ``). The ambiguity is Firestore's own — its update keys have exactly the same
 * problem against real arrays — so it is inherited rather than invented.
 *
 * **"Numeric" is the subPath grammar's own index production**, not `/^\d+$/`: `01` and `1e3`
 * stay keys, because neither is a Firestore array index either and an index segment that could
 * not be re-rendered would produce a subPath that will not parse.
 *
 * This lives here rather than in `field-path.ts` for the reason that module's own docblock
 * gives: the grammar is a leaf and cannot reach a resolved scope, and every caller of this
 * function is holding one. It is not on the barrel — `planUpdate` is the door.
 */
export function subPathForInsideKey(key: string, blobSegments: readonly PathSegment[]): string {
  if (blobKeyRelation(key, blobSegments) !== 'inside') {
    throw new ContentCryptoError(
      'VALIDATION_ERROR',
      `the update key "${key}" does not reach inside the blob path `
      + `"${blobSegments.map((s) => s.key).join('.')}", so it has no subPath`,
      { fieldPath: key },
    );
  }
  const parts = key.split('.').slice(blobSegments.length);
  const segments: SubPathSegment[] = parts.map(
    (part) => (SUBPATH_INDEX.test(part) ? { index: Number(part) } : { key: part }),
  );
  return formatSubPath(segments);
}

/** The `index` production of §8.9's grammar, restated as a test on one dotted key part. */
const SUBPATH_INDEX = /^(?:0|[1-9][0-9]{0,6})$/;

// ---------------------------------------------------------------------------
// The walk — collab's `planDoc`, generalised
// ---------------------------------------------------------------------------

/** What one walk produced. `next` is the accumulated document; the public plan drops it. */
interface WalkedDoc {
  readonly next: unknown;
  readonly update: Record<string, unknown>;
  readonly changed: number;
  readonly visited: number;
}

/**
 * Walk every registered path of one document and apply `transform` to each value found.
 *
 * `next` accumulates across paths and the read-back is from it, never from `data` — the one
 * load-bearing behaviour collab's own suite does not exercise, because collab's registry has
 * exactly one array-of-objects path.
 *
 * A string path reaches its values with `mapPath`, whose leaf filter is
 * `typeof value === 'string'` and is **not widened**: `null`, a missing key, a Firestore
 * sentinel and a number are returned as they are and never counted. A blob path reaches its
 * node with `mapPathNode`, the separate walker whose leaf is the node itself. Both make copies
 * only along the touched path and both return the INPUT IDENTITY when nothing under them
 * changed, which is what lets an untouched document come back by reference.
 *
 * `data === undefined` — a deleted row — yields an empty plan. In collab that works by luck of
 * `mapPath`'s type guards; here it is pinned by a test.
 */
function walkDoc<C extends string>(
  table: PreparedCollection, collection: C, docId: string, data: unknown, transform: NodeTransform,
): WalkedDoc {
  const update: Record<string, unknown> = {};
  let changed = 0;
  let visited = 0;
  let next: unknown = data;

  for (const path of table.paths) {
    const at: PlannedAt = Object.freeze({
      aad: path.aad(collection, docId),
      mode: path.path.mode,
      fieldPath: path.path.fieldPath,
    });
    let touched = 0;
    const visit = (node: unknown): unknown => {
      visited += 1;
      const replaced = transform(node, at);
      if (replaced !== node) touched += 1;
      return replaced;
    };

    // The cast is the one place the two walkers' leaf types differ. `mapPath` is declared
    // `(s: string) => string` because that is what its filter guarantees on the way IN; on the
    // way out it only writes whatever it is handed, so a transform returning a non-string at a
    // string path stores that value rather than being coerced. Nothing here inspects it.
    const out = path.path.mode === 'string'
      ? mapPath(next, path.path.segments, (s) => visit(s) as string)
      : mapPathNode(next, path.path.segments, visit);

    if (touched === 0) continue;
    changed += touched;
    next = out;
    update[path.updateKey] = nodeAt(next, path.updateSegments);
  }

  return { next, update, changed, visited };
}

// ---------------------------------------------------------------------------
// The per-collection table, derived once
// ---------------------------------------------------------------------------

/** One registered path with everything the codec needs about it worked out in advance. */
interface PreparedPath {
  readonly path: ResolvedPath;
  /** The registered path truncated at the first array segment — the Firestore update key. */
  readonly updateKey: string;
  /** The segments of that key, for the read-back out of the accumulated document. */
  readonly updateSegments: readonly PathSegment[];
  readonly ceilings: Ceilings;
  /** Options for a seal at this path: the scope's compression and adapters, this path's ceilings. */
  readonly seal: BlobSealOptions;
  /** Options for an open at this path: the adapters, and the inflate bound. */
  readonly read: BlobEncodeOptions;
  /** The AAD for this path in one document. The registry builds it; this only remembers where. */
  aad(collection: string, docId: string): string;
}

interface PreparedCollection {
  readonly entry: RegistryEntry;
  readonly paths: readonly PreparedPath[];
  readonly byFieldPath: ReadonlyMap<string, PreparedPath>;
  readonly reads: ReadStrictness;
}

function prepareCollection<C extends string, RT extends string>(
  registry: FieldRegistry<C>, scope: ResolvedScope<RT>, collection: C,
): PreparedCollection {
  // `entry` throws VALIDATION_ERROR naming every registered collection when this one is not
  // registered. That is the enforcement point for the collection, as this module is for the path.
  const entry = registry.entry(collection);
  const paths = entry.paths.map((path): PreparedPath => {
    const ceilings = derivePathCeilings(entry, path, scope);
    const arrayAt = path.segments.findIndex((seg) => seg.array);
    const updateSegments = arrayAt >= 0 ? path.segments.slice(0, arrayAt + 1) : path.segments;
    return {
      path,
      updateKey: updateSegments.map((seg) => seg.key).join('.'),
      updateSegments,
      ceilings,
      seal: {
        deflateOver: scope.deflateOver,
        adapters: scope.blobAdapters,
        maxSealedBytes: ceilings.maxSealedBytes,
        maxPlaintextBytes: ceilings.maxPlaintextBytes,
      },
      read: {
        adapters: scope.blobAdapters,
        maxPlaintextBytes: ceilings.maxPlaintextBytes,
      },
      aad: (c: string, docId: string) => registry.aadFor(c as C, docId, path.fieldPath),
    };
  });
  return {
    entry,
    paths: Object.freeze(paths),
    byFieldPath: new Map(paths.map((p) => [p.path.fieldPath, p])),
    reads: registry.readsFor(collection, scope.reads),
  };
}

// ---------------------------------------------------------------------------
// The two leaves that hold a key
// ---------------------------------------------------------------------------

/**
 * Seal one value at a registered STRING path. A write always encrypts.
 *
 * A non-string is returned untouched, which cannot arise through `mapPath` and can through
 * `mapUpdateValue` against a hand-built update; either way the walker's own rule holds — a
 * registered string path holding something else is left alone rather than coerced.
 */
function sealStringValue(key: RecordKey, aad: string, node: unknown): unknown {
  return typeof node === 'string' ? encryptField(key, aad, node) : node;
}

/**
 * Open one value at a registered STRING path — §7.4's table, the string rows, in full:
 *
 * | at the path | strict | lenient |
 * |---|---|---|
 * | a well-formed v3 ciphertext | opened; a bad tag is `CONTENT_DECRYPT_FAILED` in BOTH modes | same |
 * | a well-formed v1/v2 ciphertext | `WRONG_KEY_LAYER` — only the migration reads legacy | same |
 * | any other string | **`CONTENT_PLAINTEXT_AT_REGISTERED_PATH`** | untouched |
 * | a non-string | untouched, never counted | same |
 *
 * The shape is `openBlobNode`'s exactly, one layer down, and deliberately so: leniency is a
 * document-layer decision in both cases, `decryptField` never returns its input, and a value
 * that merely STARTS `enc:v3:` is not a ciphertext — a user can type that as a title.
 */
function openStringValue(
  key: RecordKey, aad: string, node: unknown, reads: ReadStrictness, site: BlobSite,
): unknown {
  if (typeof node !== 'string') return node;
  if (isEncrypted(node)) return decryptField(key, aad, node);
  if (reads === 'lenient') return node;
  throw new ContentCryptoError(
    'CONTENT_PLAINTEXT_AT_REGISTERED_PATH',
    `the value at ${site.collection}/${site.docId}.${site.fieldPath} is not sealed: a registered `
    + 'string path under strict reads holds a v3 ciphertext, and this is an ordinary string. '
    + 'Either the migration has not reached this document, or something wrote past the codec.',
    compact({ collection: site.collection, docId: site.docId, fieldPath: site.fieldPath }),
  );
}

// ---------------------------------------------------------------------------
// Updates — the classification half
// ---------------------------------------------------------------------------

/** The marker for an update key that produced a reseal instead of a value. Never written. */
const ABSENT = Symbol('reseal');

/**
 * One `inside` key, as a reseal request — or a refusal, when the value is a sentinel.
 *
 * **A sentinel inside a blob is `BLOB_PARTIAL_UPDATE` and not a patch.** There is no way to
 * increment a counter inside a ciphertext, and this package cannot tell an increment from a
 * delete: it cannot import `FieldValue`, so every store instruction is one unrecognised object.
 * Guessing would be worse than refusing, and the refusal names the one route that does work —
 * an explicit `unset` patch, which `resealRequest` builds with the registry's AAD.
 */
function insideReseal(
  collection: string, docId: string, updateKey: string, aad: string,
  path: ResolvedPath, value: unknown,
): BlobResealRequest {
  if (isSentinel(value)) {
    throw new ContentCryptoError(
      'BLOB_PARTIAL_UPDATE',
      `the update key "${updateKey}" carries a ${typeName(value)} into the sealed blob `
      + `"${path.fieldPath}" of ${collection}/${docId}. A store sentinel is an instruction — a `
      + 'delete, an increment, a server timestamp — and none of them can be applied to a '
      + 'position inside a ciphertext. Write the whole blob, or build an explicit unset patch '
      + 'for that subPath and apply it in a transaction.',
      compact({ collection, docId, fieldPath: path.fieldPath }),
    );
  }
  return Object.freeze({
    collection,
    docId,
    fieldPath: path.fieldPath,
    aad,
    patches: Object.freeze([
      Object.freeze({
        op: 'set' as const,
        subPath: subPathForInsideKey(updateKey, path.segments),
        value,
      }),
    ]),
  });
}

/**
 * A store instruction rather than data: object-shaped, but none of the shapes the blob codec
 * can name. The rule is inverted — the values the codec CAN name are data, everything else
 * object-shaped is assumed to be a sentinel — for the reason `blob-codec.ts` gives at
 * `sealBlobNode`: this package cannot import the class it would otherwise test for.
 */
function isSentinel(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return false;
  if (Array.isArray(value) || isPlainObject(value)) return false;
  if (value instanceof Date || ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return false;
  return true;
}

// ---------------------------------------------------------------------------
// The per-document budget (§8.6 mechanism 3)
// ---------------------------------------------------------------------------

/** One sealed value's contribution to the document, for the breakdown in the refusal. */
interface SealedContribution {
  readonly fieldPath: string;
  readonly bytes: number;
}

/** How many contributors a refusal lists before it says "and N more". */
const MAX_LISTED_CONTRIBUTORS = 8;

/**
 * Which of the two writes is being measured, and how the refusal names it.
 *
 * The pair is spelled `doc` / `update` rather than the obvious nouns because `check-mirror.js`
 * assertion (10) reserves the bare literals `'document'`, `'aggregate'` and `'account'` to the
 * two modules that decide record GRANULARITY — a third module comparing one is a second code
 * path arriving. This has nothing to do with granularity, which is exactly why it must not
 * spell one of those words as a standalone literal: a gate that has to be read for intent is a
 * gate somebody switches off.
 */
type WriteKind = 'doc' | 'update';
const SUBJECT: Readonly<Record<WriteKind, string>> = Object.freeze({
  doc: 'the document',
  update: 'the update',
});

/**
 * The write-time half of §8.6: per document, on the REAL bytes.
 *
 * The construction-time sum (`assertDocumentBudget`, run by `resolveScope`) is necessary and
 * not sufficient — it counts an array path once while the document holds N sealed elements, and
 * it cannot see the unsealed fields at all. This catches what that cannot: a document whose
 * individual blobs are each modest but numerous, and a per-path ceiling raised in one place and
 * not summed.
 *
 * The unsealed half is `documentByteCost`, which is deliberately approximate and deliberately
 * conservative — the job is to fail at ~1 MB with a legible message, not to reimplement
 * somebody else's accounting, and their limit remains the real one.
 *
 * **A write that sealed nothing is not measured.** The package contributed no bytes to it, the
 * budget is deliberately set below the store's own limit, and refusing a document this codec
 * did not touch would make `encryptDoc` narrower than the plain write it replaces.
 *
 * `SAFE_DETAIL_KEYS` is closed, so the breakdown lives in the message and the details carry the
 * two scalars that identify the document and the two numbers.
 */
function assertDocumentFits(
  collection: string, docId: string, written: unknown,
  sealed: readonly SealedContribution[], limitBytes: number, what: WriteKind,
): void {
  if (sealed.length === 0) return;
  let sealedBytes = 0;
  for (const one of sealed) sealedBytes += one.bytes;
  const otherBytes = Math.max(0, documentByteCost(written) - sealedBytes);
  if (sealedBytes + otherBytes <= limitBytes) return;

  const ranked = [...sealed].sort((a, b) => b.bytes - a.bytes);
  const listed = ranked.slice(0, MAX_LISTED_CONTRIBUTORS)
    .map((one) => `${one.fieldPath} ${one.bytes}`)
    .join(', ');
  const rest = ranked.length - Math.min(ranked.length, MAX_LISTED_CONTRIBUTORS);
  const breakdown = ranked.length === 0
    ? ''
    : ` (${listed}${rest > 0 ? `, and ${rest} more` : ''})`;

  const budget = what === 'update'
    // An update is measured against the same budget, and it can only ever be an UNDER-estimate:
    // it does not carry the fields it is not writing. That it can refuse at all is the point.
    ? 'the document budget, which this update is measured against without being able to see the '
      + 'fields it does not write, is'
    : 'the document budget is';
  throw new ContentCryptoError(
    'DOCUMENT_TOO_LARGE',
    `${SUBJECT[what]} ${collection}/${docId} seals to ${sealedBytes} bytes across `
    + `${ranked.length} sealed value${ranked.length === 1 ? '' : 's'}${breakdown} plus `
    + `${otherBytes} bytes of unsealed fields; ${budget} ${limitBytes}.`,
    compact({ collection, docId, sealedBytes, limitBytes }),
  );
}

/** Every sealed string this update writes, so the budget can name its contributors. */
function collectSealed(
  updateKey: string, value: unknown, into: SealedContribution[],
): void {
  if (typeof value === 'string') {
    if (isEncrypted(value)) into.push({ fieldPath: updateKey, bytes: Buffer.byteLength(value, 'utf8') });
    return;
  }
  if (Array.isArray(value)) {
    for (const element of value) collectSealed(updateKey, element, into);
    return;
  }
  if (isPlainObject(value)) {
    for (const key of Object.keys(value)) collectSealed(updateKey, value[key], into);
  }
}

// ---------------------------------------------------------------------------
// "Is this path registered" — the enforcement §5.4 and `aadFor` both defer to here
// ---------------------------------------------------------------------------

/** The registered blob path named by `fieldPath`, or a refusal naming the registered set. */
function requireBlobPath(
  table: PreparedCollection, collection: string, fieldPath: string, caller: string,
): PreparedPath {
  const found = table.byFieldPath.get(fieldPath);
  if (found === undefined || found.path.mode !== 'blob') {
    throw unregistered(table, collection, fieldPath, caller, 'blob');
  }
  return found;
}

/**
 * The registered ARRAY string path named by `fieldPath`, spelled with or without its `[]`.
 *
 * Both spellings are accepted because the call site's natural word is the array's own name
 * (`declinedProposals`) while the registry's word — and the AAD's — keeps the `[]` that makes
 * every element share one binding. Resolving the two here is the whole reason this function
 * exists: a caller that had to spell the registered form would be one typo away from sealing
 * an element under an AAD nothing else builds.
 */
function requireArrayPath(
  table: PreparedCollection, collection: string, fieldPath: string, caller: string,
): PreparedPath {
  const found = table.byFieldPath.get(fieldPath) ?? table.byFieldPath.get(`${fieldPath}[]`);
  if (
    found === undefined
    || found.path.mode !== 'string'
    || !found.path.segments[found.path.segments.length - 1].array
  ) {
    throw unregistered(table, collection, fieldPath, caller, 'array');
  }
  return found;
}

function unregistered(
  table: PreparedCollection, collection: string, fieldPath: string, caller: string,
  wanted: 'blob' | 'array',
): ContentCryptoError {
  const candidates = table.paths
    .filter((p) => (wanted === 'blob'
      ? p.path.mode === 'blob'
      : p.path.mode === 'string' && p.path.segments[p.path.segments.length - 1].array))
    .map((p) => quoted(p.path.fieldPath));
  return new ContentCryptoError(
    'VALIDATION_ERROR',
    `${caller} needs a registered ${wanted === 'blob' ? 'blob path' : 'array string path'} of `
    + `collection "${collection}", and ${quoted(fieldPath)} is not one; the registered `
    + `${wanted === 'blob' ? 'blob paths are' : 'array paths are'} `
    + `${candidates.join(', ') || '(none)'}. The registry does not check this when it builds an `
    + 'AAD — a legacy read at a renamed path and a blob reseal both need one — so it is checked '
    + 'here, where a path is chosen.',
    compact({ collection, fieldPath }),
  );
}

// ---------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------

/** Where a value sits, for error attribution only. It carries no AAD, deliberately (§8.2). */
function siteOf(collection: string, docId: string, fieldPath: string): BlobSite {
  return { collection, docId, fieldPath };
}

const quoted = (value: string): string => `"${value}"`;

/** The constructor name of an arbitrary value, without invoking anything on it. */
function typeName(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value !== 'object') return typeof value;
  const proto: unknown = Object.getPrototypeOf(value as object);
  if (proto === null || proto === undefined) return 'Object';
  const ctor = (proto as { constructor?: { name?: unknown } }).constructor;
  return typeof ctor?.name === 'string' ? ctor.name : 'Object';
}
