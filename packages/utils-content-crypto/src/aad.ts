/**
 * `aad.ts` — additional authenticated data.
 *
 * **This is the only file in the platform that builds an AAD.** Nothing else in the package —
 * and nothing in any consuming product — may build one by interpolation. `registry.aadFor` is
 * the one other declared builder of a content AAD and it delegates here.
 *
 * Three of the four forms are **fixed by the plan** (`01-content-key-custody.md` §5a, §6) and
 * are not this package's to prefix, decorate, reorder or invent:
 *
 * | Layer | Binds | Form |
 * |---|---|---|
 * | account DEK wrap (under KMS, in Accounts) | the DEK to its account, product and generation | `content-key/{productId}/{accountId}/{generation}` |
 * | record-key wrap (under the account DEK) | the record key to the thing it protects, and to whose DEK wrapped it | `record-key/{productId}/{accountId}/{generation}/{scopePath}` |
 * | content (under the record key) | a value to its field and its row | `{root}/{docId}.{fieldPath}` |
 *
 * In the record-key form `accountId` is the account whose DEK does the **wrapping** — for a
 * shared record, the *recipient* and not the owner, so a record owned by A and shared to B has
 * two wraps under two different AADs — and `scopePath` is the **full document path of the wrap
 * holder**, never a bare id and never a child of it. At aggregate granularity the wrap lives on
 * the aggregate root and nowhere else.
 *
 * The AAD is **never stored**. It is derived at read time from where the value was found, which
 * is exactly what makes it a binding rather than a label.
 *
 * ## What carries injectivity, now that the domain prefixes are gone
 *
 * Not a prefix. The validation list below is what guarantees that distinct tuples produce
 * distinct strings — a `docId` containing `.` would let `a/b.c.d` mean two different rows, and a
 * `root` containing `/` or `.` would break the split in the other direction. AAD confusion is
 * only ever exploitable **within one key**, and these forms sit at three different key layers;
 * within the one layer where several ciphertext kinds share a key — the record key — the
 * authenticated payload-kind byte (§7.2) is the unforgeable discriminator and registry
 * disjointness means a field AAD and a blob AAD are never equal in the first place.
 *
 * ## The dividend
 *
 * `aadForContent` is **byte-identical to collab's deployed v1/v2 content AAD**. The v1→v3
 * migration therefore changes the key layer and not the AAD string, and a mis-migrated value
 * fails its tag rather than decrypting as the wrong field. `legacyFieldAad` has nothing to
 * compute and does not exist.
 *
 * Imports: none. This module is a leaf over `errors.ts` alone — no `node:` builtin, no state, no
 * clock, no randomness. Every function here is pure.
 */

import { ContentCryptoError } from './errors';

/**
 * The one domain prefix that survives, and the one AAD form the plan does **not** fix.
 *
 * See §18 Q-O: this is **this specification's choice, not the plan's**, and it wants a fourth
 * row in `01-content-key-custody.md` §5a for the same reason the other three got one. It keeps a
 * prefix because §10.4 deliberately gives an object body no payload-kind byte — buffering the
 * first plaintext byte would defeat the decrypt stream — so the unforgeable-discriminator
 * defence does not reach objects, and an unprefixed object AAD could in principle equal a
 * content AAD under one record key.
 *
 * Like the other three, it freezes on first write.
 */
export const AAD_OBJECT_DOMAIN = 'obj' as const;

/** Fixed by plan §6. Not exported: nothing outside this file builds a DEK-wrap AAD. */
const DEK_WRAP_DOMAIN = 'content-key';

/** Fixed by plan §5a. Not exported, for the same reason. */
const RECORD_KEY_WRAP_DOMAIN = 'record-key';

/**
 * Structurally identical to `ObjectRef` (§10, declared in `object-envelope.ts`) and assignable
 * from it in both directions.
 *
 * **Why it is restated here rather than imported.** `object-envelope.ts` imports `aadForObject`
 * from this file, and lands at build-order step 13 where this module lands at step 3; an import
 * — even a type-only one that erases — would point upward through the layering and would leave
 * step 3 unable to compile. TypeScript is structural, so a caller holding a real `ObjectRef`
 * passes it here with no cast and no friction. If the layering is ever inverted, this alias
 * becomes `import type { ObjectRef } from './object-envelope'` and nothing else changes.
 *
 * Not re-exported from `index.ts`: the barrel publishes `ObjectRef` from `object-envelope.ts`,
 * which stays the one public name for this shape.
 */
export type ObjectRefLike = {
  readonly bucket: string;
  readonly path: string;
};

/** The detail keys this module uses. Every one is a member of `SAFE_DETAIL_KEYS` (§11.6). */
type AadDetailKey =
  | 'collection'
  | 'docId'
  | 'fieldPath'
  | 'productId'
  | 'accountId'
  | 'generation'
  | 'scopePath'
  | 'path';

type AadDetails = Readonly<Partial<Record<AadDetailKey, string | number>>>;

function invalid(message: string, details?: AadDetails): never {
  throw new ContentCryptoError('VALIDATION_ERROR', message, details);
}

/** For a message about a value whose type is wrong. Never prints the value itself. */
function typeName(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  return `a ${typeof value}`;
}

/**
 * `root` — the AAD root: the registry collection key, or its `root` override where the AAD id is
 * not the row id (collab's `versions` under `artefacts`, build's `checkpoints` under `phases`).
 *
 * No `/`, because root `a/b` + docId `c` would be the same string as root `a` + docId `b/c`.
 * No `.`, because root `a.b` breaks the first-dot split that recovers the docId — a real hole in
 * the v1 spec, which forbade only `/`. `defineRegistry` refuses both at construction time as
 * well (validations 5 and 7); this is the same rule at the point of use, because `aadForContent`
 * is reachable without a registry.
 */
function assertRoot(root: unknown): asserts root is string {
  if (typeof root !== 'string') {
    invalid(`AAD root must be a string, received ${typeName(root)}`);
  }
  if (root.length === 0) {
    invalid('AAD root must not be empty');
  }
  if (root.includes('/')) {
    invalid(
      `AAD root must not contain '/': root '${root}' would be indistinguishable from a shorter ` +
        'root with the remainder at the head of the docId',
      { collection: root },
    );
  }
  if (root.includes('.')) {
    invalid(
      `AAD root must not contain '.': root '${root}' breaks the first-dot split that separates ` +
        'the docId from the fieldPath',
      { collection: root },
    );
  }
}

/**
 * `docId` — no `.`, or `a/b.c.d` parses both as (root `a`, docId `b`, field `c.d`) and as
 * (root `a`, docId `b.c`, field `d`): two rows, one string.
 *
 * It **may** contain `/`, and must: collab's `versions` live at
 * `artefacts/{artefactId}/versions/{versionId}` and produce `artefacts/t1/versions/v3.content`.
 */
function assertDocId(docId: unknown): asserts docId is string {
  if (typeof docId !== 'string') {
    invalid(`AAD docId must be a string, received ${typeName(docId)}`);
  }
  if (docId.length === 0) {
    invalid('AAD docId must not be empty');
  }
  if (docId.includes('.')) {
    invalid(
      `AAD docId must not contain '.': docId '${docId}' would make the content AAD parse two ` +
        'ways, so two different rows could produce one string',
      { docId },
    );
  }
}

/**
 * `fieldPath` — non-empty. A blob path may never be empty either, so there is deliberately no
 * dotless whole-record content AAD form.
 */
function assertFieldPath(fieldPath: unknown): asserts fieldPath is string {
  if (typeof fieldPath !== 'string') {
    invalid(`AAD fieldPath must be a string, received ${typeName(fieldPath)}`);
  }
  if (fieldPath.length === 0) {
    invalid('AAD fieldPath must not be empty: there is no whole-record content AAD form');
  }
}

/**
 * `productId` and `accountId` — non-empty and no `/`. These are the fixed-arity components of
 * the two wrap forms; a `/` in either would let the reassembly of `scopePath` from the fifth
 * component onward pick up a component that was never part of the path.
 *
 * `productId` is per install, never per customer.
 */
function assertWrapComponent(
  value: unknown,
  key: 'productId' | 'accountId',
): asserts value is string {
  if (typeof value !== 'string') {
    invalid(`AAD ${key} must be a string, received ${typeName(value)}`);
  }
  if (value.length === 0) {
    invalid(`AAD ${key} must not be empty`);
  }
  if (value.includes('/')) {
    invalid(
      `AAD ${key} must not contain '/': '${value}' would shift every component after it and ` +
        'the wrap form would no longer parse to one tuple',
      key === 'productId' ? { productId: value } : { accountId: value },
    );
  }
}

/**
 * `generation` — a positive, safe integer. It matches the `gen` stored on the wrap, and a reader
 * trusts that label to choose which DEK to fetch, so binding it means a relabelled wrap fails
 * authentically rather than by luck.
 *
 * Rejecting `0`, negatives and non-integers is what keeps one generation to one string: `1.0`,
 * `01` and `1e0` all render as `1`, and a value beyond `Number.MAX_SAFE_INTEGER` renders in
 * exponential notation.
 */
function assertGeneration(generation: unknown): asserts generation is number {
  if (typeof generation !== 'number') {
    invalid(`AAD generation must be a number, received ${typeName(generation)}`);
  }
  if (!Number.isSafeInteger(generation) || generation <= 0) {
    invalid(
      `AAD generation must be a positive safe integer, received ${String(generation)}`,
      Number.isFinite(generation) ? { generation } : undefined,
    );
  }
}

/**
 * `scopePath` — non-empty. The **full document path of the record key's holder**: a wrap moved to
 * another record of the same account would otherwise unwrap perfectly well, and ids are not
 * reliably unique (sf-mapper's own resolver does a collection-group lookup with `limit(5)` and
 * then filters by account, which is what a possibly-colliding id looks like).
 *
 * Its shape — no leading or trailing `/`, no empty segment, an even segment count — is asserted
 * by `assertScopePath` in `key-scope.ts`, which is where a path is constructed and where the
 * rule belongs. This module asserts only what its own form needs, so the two do not drift into
 * two half-copies of one grammar.
 */
function assertScopePathComponent(scopePath: unknown): asserts scopePath is string {
  if (typeof scopePath !== 'string') {
    invalid(`AAD scopePath must be a string, received ${typeName(scopePath)}`);
  }
  if (scopePath.length === 0) {
    invalid('AAD scopePath must not be empty: a wrap AAD binds the full path of its holder');
  }
}

/**
 * `{root}/{docId}.{fieldPath}` — plan §5a, FIXED, and identical to collab's live v1/v2 form.
 *
 * Serves fields **and** blobs: they are the same string for the same path, and the registry
 * guarantees a path is registered one way or the other and never both. `aadForBlob` is not an
 * alias of this; it does not exist.
 *
 * @example
 * aadForContent('messages', 'abc', 'anchor.quote')            // messages/abc.anchor.quote
 * aadForContent('topics', 't1', 'declinedProposals[]')        // topics/t1.declinedProposals[]
 * aadForContent('artefacts', 't1/versions/v3', 'content')     // artefacts/t1/versions/v3.content
 * aadForContent('deliverables', 'd_12', 'structuredContent')  // deliverables/d_12.structuredContent
 */
export function aadForContent(root: string, docId: string, fieldPath: string): string {
  assertRoot(root);
  assertDocId(docId);
  assertFieldPath(fieldPath);
  return `${root}/${docId}.${fieldPath}`;
}

/**
 * `record-key/{productId}/{accountId}/{generation}/{scopePath}` — plan §5a, FIXED.
 *
 * `accountId` is the account whose DEK does the **wrapping**: for a shared record, the
 * RECIPIENT. `scopePath` is the full document path of the record key's holder. **Never stored.**
 *
 * The form binds four things where v1's `aadForWrap` bound five, because `recordType` and
 * `recordId` collapse into the path — which subsumes both and is unique where a bare id is not.
 * Strictly stronger, and shorter.
 *
 * @example
 * aadForRecordKeyWrap('collab', 'atIqNkIXK380Mm4n', 2, 'projects/plTfBLFHrIdQSNEH')
 * // record-key/collab/atIqNkIXK380Mm4n/2/projects/plTfBLFHrIdQSNEH
 */
export function aadForRecordKeyWrap(
  productId: string,
  accountId: string,
  generation: number,
  scopePath: string,
): string {
  assertWrapComponent(productId, 'productId');
  assertWrapComponent(accountId, 'accountId');
  assertGeneration(generation);
  assertScopePathComponent(scopePath);
  return `${RECORD_KEY_WRAP_DOMAIN}/${productId}/${accountId}/${generation}/${scopePath}`;
}

/**
 * `content-key/{productId}/{accountId}/{generation}` — plan §6, FIXED.
 *
 * **The OUTER AAD only**: the wrap of the account DEK under the KMS KEK, which Accounts performs
 * and this package never does. It is declared here because there is one file that builds an AAD
 * and this is that file — and because Accounts' Phase-B custody service reuses these builders
 * rather than reinventing the string.
 */
export function aadForDek(productId: string, accountId: string, generation: number): string {
  assertWrapComponent(productId, 'productId');
  assertWrapComponent(accountId, 'accountId');
  assertGeneration(generation);
  return `${DEK_WRAP_DOMAIN}/${productId}/${accountId}/${generation}`;
}

/**
 * `obj/{bucket}/{objectPath}` — **NOT fixed by the plan; this package's choice.** See §18 Q-O,
 * and `AAD_OBJECT_DOMAIN` above: the object body is the one payload with no authenticated
 * payload-kind byte, so the prefix is doing real work here that it does nowhere else.
 *
 * The bucket is bound because Cloud Storage is one bucket per product (settled 2026-08-17): a
 * body cannot then be moved between a product's bucket and another's even if both were somehow
 * under one key, and a misconfigured `--cors-file` or `storage` block is the documented way
 * products reach each other's buckets by accident.
 *
 * @example
 * aadForObject({ bucket: 'acme-morph', path: 'objects/ab/cd/ef.bin' })
 * // obj/acme-morph/objects/ab/cd/ef.bin
 */
export function aadForObject(ref: ObjectRefLike): string {
  if (typeof ref !== 'object' || ref === null) {
    invalid(`AAD object ref must be an object, received ${typeName(ref)}`);
  }
  const { bucket, path } = ref;
  if (typeof bucket !== 'string') {
    invalid(`AAD object bucket must be a string, received ${typeName(bucket)}`);
  }
  if (bucket.length === 0) {
    invalid('AAD object bucket must not be empty');
  }
  if (bucket.includes('/')) {
    invalid(
      `AAD object bucket must not contain '/': bucket '${bucket}' would be indistinguishable ` +
        'from a shorter bucket with the remainder at the head of the object path',
      { path: bucket },
    );
  }
  if (typeof path !== 'string') {
    invalid(`AAD object path must be a string, received ${typeName(path)}`);
  }
  if (path.length === 0) {
    invalid('AAD object path must not be empty');
  }
  return `${AAD_OBJECT_DOMAIN}/${bucket}/${path}`;
}

/**
 * The one thing every seal and open asserts about the string it was handed: that it is a
 * non-empty string.
 *
 * It is deliberately not a grammar check. An AAD arrives at `cipher.ts` already built by one of
 * the four functions above, and re-parsing it there would be a second, weaker statement of the
 * same rule in the place least able to enforce it. What this catches is the failure mode that
 * actually occurs — an `undefined` reaching the cipher from an optional field, which AES-GCM
 * would otherwise accept as "no AAD at all" and seal a value bound to nothing.
 */
export function assertAad(aad: unknown): asserts aad is string {
  if (typeof aad !== 'string') {
    invalid(`AAD must be a string, received ${typeName(aad)}`);
  }
  if (aad.length === 0) {
    invalid('AAD must not be empty: a value sealed under an empty AAD is bound to nothing');
  }
}
