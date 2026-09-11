/**
 * `key-scope.ts` — the granularity dial, the record refs, and where `scopePath` comes from.
 *
 * **One encryption model.** Content is sealed under a record key; the record key exists at rest
 * only as wraps under account DEKs; the set of wraps IS the access list. Account granularity is
 * that model with the dial turned down — never a second code path — and this file is the one
 * place in the package where a granularity is decided. `check-mirror.js` assertion (10) scans
 * every other production module for the literals `'document'`, `'aggregate'` and `'account'` and
 * fails on the first one it finds, so the claim is enforced rather than asserted.
 *
 * The degenerate case works **without a product declaring a fake record type**: `resolveScope`
 * injects `ACCOUNT_RECORD_TYPE` into `records`, so ONE scope carries both granularities and the
 * equivalence suite needs one `ContentCrypto` instance rather than two. Forcing every product to
 * declare `{ account: 'account' }` to reach the degenerate case is what made the degenerate case
 * look like a second model, and it is why v1 could not write that test at all.
 *
 * ## Where a wrap lives — the rule these types enforce
 *
 * | granularity | wrap written on | `scopePath` |
 * |---|---|---|
 * | `document` | that document | that document's path |
 * | `aggregate` | **the aggregate root, once** | the aggregate root's path |
 * | `account` | the product's own account key row | that row's path |
 *
 * At aggregate granularity a project's five hundred documents share one record key and the wrap
 * is written **once, on the project**. **Anything that walks children to find a wrap has the
 * design wrong**, and there is nowhere in these types to put a second one: `WalkedDoc` has no
 * wrap field, and `assertHead` fails a `scopePath` below the aggregate root.
 *
 * ## `scopePath` comes off the ref, and off nothing else
 *
 * `RecordRef.path` is a **full document path**, supplied by the product at construction. The
 * package cannot derive one: sf-mapper's scans live at
 * `accounts/{accountId}/sfmapper/{orgId}/scans/{scanId}` and the `orgId` is nowhere in the
 * package's world. A `pathOf(id)` resolver on the scope was rejected — total for collab and
 * build, partial for sf-mapper and Morph — because an optional convenience half the products
 * cannot use, sitting beside the mandatory explicit form, is how two ways to build a ref and
 * eventually two disagreeing paths get into a codebase.
 *
 * A record whose document path changes invalidates every wrap on it, because the path is bound
 * into the wrap AAD. That is a property of the design, not a bug, and it is written down beside
 * `RecordRef.path` because it is the one thing a product can do that quietly loses access.
 *
 * ## Three names this module does not declare, and one it re-exports
 *
 * `RecordRef` is declared in `record-key.ts` (§9.1) and `ReadStrictness` and
 * `MIN_DERIVED_SEALED_BYTES` in `registry.ts` (§5.4), each beside the mechanism it belongs to.
 * §5.3 and the barrel both name this file as their home, so the two type names are imported and
 * the constant is re-exported from here — one declaration, one public path, nothing to keep in
 * step. The ceiling derivation itself is `registry.ts`'s, and `ceilingsFor` below is the public
 * way to ask for the collection-wide bound: a ceiling decided in two places is a ceiling that
 * eventually disagrees with itself. Note which of the two derivations it asks —
 * `deriveCeilings`, the collection-wide MAXIMUM. Per-path enforcement is `derivePathCeilings`,
 * and since R8 those are different numbers whenever a collection's paths declare differently.
 *
 * Imports: `errors.ts`, `blob-json.ts` (the sealed-ceiling default), `registry.ts` (the table and
 * its arithmetic) and `record-key.ts` (the ref shape, type-only, and it imports nothing from
 * here). No `node:` builtin — but `process.env` in `resolveGraceMs`, which is the only
 * environment variable this package's production code reads and is pinned there by assertion
 * (12).
 */

import { DEFAULT_MAX_SEALED_BYTES, type BlobAdapter } from './blob-json';
import { ContentCryptoError } from './errors';
import type { RecordRef } from './record-key';
import { assertDocumentBudget, deriveCeilings } from './registry';
import type { Ceilings, FieldRegistry, ReadStrictness } from './registry';

/**
 * Re-exported for the barrel, which §5.3 gives this file. Declared in `registry.ts` because it is
 * a property of the derivation, and the derivation needs the registry's path counts.
 */
export { MIN_DERIVED_SEALED_BYTES } from './registry';
/** Re-exported for the same reason: §5.4's table needs it one build step before this file. */
export type { ReadStrictness } from './registry';

// ---------------------------------------------------------------------------
// The dial
// ---------------------------------------------------------------------------

/** The three positions of the one dial. Nothing downstream branches on which was used. */
export type RecordGranularity = 'document' | 'aggregate' | 'account';

/** Settled 2026-09-10. A one-member union, so loosening it is a visible change and not a flag. */
export type AadTightness = 'tight';

/**
 * The reserved record type for account granularity.
 *
 * A product **never** declares it in `records`; `resolveScope` injects it. That injection is the
 * whole of the "one model" claim in code: one scope carries the account-granular record type and
 * the product's own types together, so the degenerate case is reachable without a declaration
 * and cannot drift into a second configuration.
 */
export const ACCOUNT_RECORD_TYPE = 'account' as const;

/**
 * The shape `assertHead` needs from a `RecordHead` (§13.3, declared in `walk.ts`).
 *
 * Restated structurally for the same reason `aad.ts` restates `ObjectRef`: `walk.ts` lands at
 * build-order step 14 and imports from here, so an import in the other direction would point
 * upward through the layering. TypeScript is structural, so a real `RecordHead` — which carries
 * `keyWraps`, `ref`, `precondition` and `cursor` besides these two — passes with no cast.
 *
 * Not on the barrel: `RecordHead` from `walk.ts` stays the one public name for a head.
 */
export interface RecordHeadLike {
  readonly record: RecordRef;
  readonly ownerAccountId: string;
}

// ---------------------------------------------------------------------------
// What a product writes
// ---------------------------------------------------------------------------

export interface LegacyScope {
  /** `['v1','v2']` for collab, absent for every other product. */
  readonly readFieldVersions?: readonly ('v1' | 'v2')[];
  /** `'x-collab-'` — read only, and only until Phase G. */
  readonly objectMetaPrefix?: string;
  /** collab's frozen pre-custody DEK wrap AAD, e.g. `(a) => `accountKeys/${a}``. */
  readonly dekWrapAad?: (accountId: string) => string;
  // v1's `aad?: 'bare'` is DELETED. The plan's content AAD *is* the bare form, so there is no
  // legacy content AAD to switch to. Only the OBJECT AAD changes across the v1→v3 hop.
}

/**
 * One of the **three** things a product supplies — with its registry and its traversal, and
 * nothing else.
 */
export interface ContentKeyScope<RT extends string = string> {
  /** Per install, never per customer. The only product string in any AAD. */
  readonly productId: string;
  /**
   * Record-key granularity, PER RECORD TYPE. A map rather than a scalar because the settled
   * table gives Morph two granularities in two rows. `'account'` is implicit as a record TYPE and
   * must NOT appear here — `resolveScope` injects it and refuses a declaration of it.
   */
  readonly records: Readonly<Record<RT, RecordGranularity>>;
  /**
   * The full document path of the row that holds the wrap at ACCOUNT granularity. Required only
   * if the product ever calls `crypto.accountRecord()`. It must be a row the PRODUCT owns:
   * `accounts/{accountId}/contentKeys/{productId}` is Accounts' and this package may never write
   * there. collab's answer is `accountSettings/{accountId}`; each product's freezes on first
   * write. See §18 Q-A.
   */
  readonly accountRecordPath?: (accountId: string) => string;
  /** Default and only legal value `'tight'`. */
  readonly aad?: AadTightness;
  /** DEFAULT `'strict'`. */
  readonly reads?: ReadStrictness;
  /** Per-VALUE ceiling, measured on the emitted `enc:v3:` STRING. Default 900 000. */
  readonly maxSealedBytes?: number;
  /**
   * Per-DOCUMENT ceiling: the sum of every sealed value plus a measure of the untouched fields.
   * Default 1 000 000, leaving ~48 kB under the store's 1 MiB document limit for `keyWraps`,
   * `wrapHolders`, the document name and per-field overhead. Three 899 kB blobs pass every
   * per-field check and produce a document that cannot be written.
   */
  readonly maxDocumentSealedBytes?: number;
  /** Deflate blob plaintext over this many bytes. DEFAULT 0 = OFF (§8.7). */
  readonly deflateOver?: number;
  readonly blobAdapters?: readonly BlobAdapter[];
  /** Absent for every product but collab; absent means no legacy path is reachable at all. */
  readonly legacy?: LegacyScope;
}

// ---------------------------------------------------------------------------
// What the package holds
// ---------------------------------------------------------------------------

export interface ResolvedScope<RT extends string> {
  readonly productId: string;
  /** The product's declared types PLUS the injected `ACCOUNT_RECORD_TYPE`. */
  readonly records: Readonly<Record<RT | typeof ACCOUNT_RECORD_TYPE, RecordGranularity>>;
  readonly aad: AadTightness;
  readonly reads: ReadStrictness;
  readonly maxSealedBytes: number;
  readonly maxDocumentSealedBytes: number;
  readonly deflateOver: number;
  readonly blobAdapters: readonly BlobAdapter[];
  readonly legacy:
    | (Required<Omit<LegacyScope, 'dekWrapAad'>> & { dekWrapAad: ((a: string) => string) | null })
    | null;

  granularityOf(type: RT | typeof ACCOUNT_RECORD_TYPE): RecordGranularity;

  /**
   * The ONE record assertion. Throws VALIDATION_ERROR on: an undeclared record type; a malformed
   * `scopePath`; a `scopePath` that does not end with `/{record.id}`; granularity `'account'`
   * where `record.id !== ownerAccountId`.
   *
   * v1's `assertDocumentScope` is DELETED: the document case is a CONSTRUCTION-time rule
   * (validation 2), which is strictly stronger than a per-write check.
   */
  assertRecord(record: RecordRef, ownerAccountId?: string): void;

  /**
   * Is this record the degenerate case? The ONE predicate that compares a granularity outside
   * this file's own machinery, and the reason `content-crypto.ts` can say "at account
   * granularity `ownerAccountId` is `record.id`" without naming a granularity literal.
   */
  isAccountGranular(record: RecordRef): boolean;

  /**
   * The account-granular record ref, built from `accountRecordPath`. Throws VALIDATION_ERROR
   * naming the config key when the scope did not configure one.
   */
  accountRecord(accountId: string): RecordRef;

  /**
   * The collection-wide UPPER BOUND: the largest sealed and the largest plaintext ceiling any
   * single value in `collection` may have. Delegates to `registry.ts`'s `deriveCeilings`.
   *
   * **NOT a per-path ceiling, and NOT the number to enforce against.** Since R8 a collection's
   * paths need not share a ceiling — Morph's `results` is one 700 kB blob beside two 100 kB ones
   * — so this bound is the widest of them, and the two maxima need not even come from the same
   * path. Checking a value against it would let `citations` carry 700 kB because
   * `structuredOutput` may. Enforcement is `derivePathCeilings(entry, path, budget)`, which is
   * what `doc-codec` calls, per path, and what every write-time refusal is measured against.
   *
   * What it is good for is the summary answer — "how big can anything in this collection get" —
   * which is exact for a collection whose paths are uniform, i.e. every §14 registry but Morph's
   * `results`.
   */
  ceilingsFor(collection: string): {
    readonly maxSealedBytes: number;
    readonly maxPlaintextBytes: number;
  };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** 15 minutes, settled 2026-09-10. The grace window; `custodian-cache.ts` is its only reader. */
export const DEFAULT_GRACE_MS = 900_000;

/** Leaves ~48 kB under the store's 1 MiB document limit for wraps, holders and overhead. */
export const DEFAULT_MAX_DOCUMENT_SEALED_BYTES = 1_000_000;

/** `CONTENT_KEY_GRACE_MS`. Named once, so the scan in assertion (12) has one thing to find. */
const GRACE_ENV_VAR = 'CONTENT_KEY_GRACE_MS';

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** The detail keys this module uses. Every one is a member of `SAFE_DETAIL_KEYS` (§11.6). */
type ScopeDetailKey =
  | 'scopePath'
  | 'collection'
  | 'accountId'
  | 'productId'
  | 'recordType'
  | 'recordId';

type ScopeDetails = Readonly<Partial<Record<ScopeDetailKey, string | number>>>;

function invalid(message: string, details?: ScopeDetails): never {
  throw new ContentCryptoError('VALIDATION_ERROR', message, details);
}

/** Never prints the value itself — a scope is configuration, but a ref may carry a product id. */
function typeName(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  return `a ${typeof value}`;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function has(object: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function assertPositiveInteger(value: unknown, key: string): asserts value is number {
  if (typeof value !== 'number') {
    invalid(`ContentKeyScope.${key} must be a number, received ${typeName(value)}`);
  }
  if (!Number.isSafeInteger(value) || value <= 0) {
    invalid(`ContentKeyScope.${key} must be a positive safe integer, received ${String(value)}`);
  }
}

// ---------------------------------------------------------------------------
// scopePath
// ---------------------------------------------------------------------------

/**
 * The `scopePath` grammar, asserted where a path is constructed.
 *
 * Non-empty; no leading or trailing `/`; no empty segment; and an **EVEN segment count**, because
 * a document path alternates collection/document and a *collection* path handed in by mistake is
 * the most likely wrong value. `projects` is a collection, `projects/p_1` is a document, and a
 * wrap bound to the former would be bound to every project the account owns.
 *
 * This is the whole grammar, in one place. `aad.ts` asserts only non-emptiness for its own form
 * and says so, so the two never become two half-copies of one rule.
 */
export function assertScopePath(path: unknown): asserts path is string {
  if (typeof path !== 'string') {
    invalid(`scopePath must be a string, received ${typeName(path)}`);
  }
  if (path.length === 0) {
    invalid('scopePath must not be empty: a wrap AAD binds the full path of its holder');
  }
  if (path.startsWith('/') || path.endsWith('/')) {
    invalid(
      `scopePath "${path}" must not start or end with '/': a leading or trailing separator makes ` +
        'an empty segment, and two spellings of one path are two AADs for one wrap',
      { scopePath: path },
    );
  }
  const segments = path.split('/');
  if (segments.some((segment) => segment.length === 0)) {
    invalid(`scopePath "${path}" must not contain an empty segment`, { scopePath: path });
  }
  if (segments.length % 2 !== 0) {
    invalid(
      `scopePath "${path}" has ${segments.length} segments, which is odd: a document path ` +
        'alternates collection/document, so an odd count is a COLLECTION path. A wrap bound to a ' +
        'collection is a wrap bound to every document in it',
      { scopePath: path },
    );
  }
}

// ---------------------------------------------------------------------------
// The three ref constructors — the dial, spelled three ways
// ---------------------------------------------------------------------------

function assertRefComponent(value: unknown, key: 'type' | 'id', where: string): asserts value is string {
  if (typeof value !== 'string') {
    invalid(`${where}: ${key} must be a string, received ${typeName(value)}`);
  }
  if (value.length === 0) {
    invalid(`${where}: ${key} must not be empty`);
  }
}

/**
 * Per-document granularity. `collection` IS the registry collection key — enforced at
 * `resolveScope` validation 2, and generic so a typo is also caught at the call site.
 *
 * The path is checked for **shape** here and for **agreement with the id** by `assertRecord`,
 * which is the one record assertion. That split is deliberate: the §16.7 table constructs
 * mismatched refs on purpose and asserts that `assertHead` is what refuses them.
 */
export function documentRecordRef<C extends string>(collection: C, docId: string, path: string): RecordRef {
  assertRefComponent(collection, 'type', 'documentRecordRef');
  assertRefComponent(docId, 'id', 'documentRecordRef');
  assertScopePath(path);
  return Object.freeze({ type: collection, id: docId, path });
}

/**
 * Per-aggregate. `path` is the AGGREGATE ROOT's path — the project, the scan, the engagement,
 * the source — and **NOT any child's**. `assertRecord` checks it ends with `/{aggregateId}`,
 * which is the same statement as "and nothing below it".
 */
export function aggregateRecordRef(type: string, aggregateId: string, path: string): RecordRef {
  assertRefComponent(type, 'type', 'aggregateRecordRef');
  assertRefComponent(aggregateId, 'id', 'aggregateRecordRef');
  assertScopePath(path);
  return Object.freeze({ type, id: aggregateId, path });
}

/**
 * Per-account, the degenerate case. `path` is the product's own account key row. Prefer
 * `crypto.accountRecord(accountId)`, which fills `path` from `scope.accountRecordPath` and
 * checks it against the one record assertion at the point where the config key can be named.
 */
export function accountRecordRef(accountId: string, path: string): RecordRef {
  assertRefComponent(accountId, 'id', 'accountRecordRef');
  assertScopePath(path);
  return Object.freeze({ type: ACCOUNT_RECORD_TYPE, id: accountId, path });
}

/**
 * The Map key used by `openRecords` and by nothing else. It is `ref.path`, **NOT**
 * `${type}/${id}`: ids are not reliably unique across aggregates, and a Map keyed on a colliding
 * id is sf-mapper's `limit(5)` ambiguity reappearing inside the package.
 */
export function recordRefKey(ref: RecordRef): string {
  return ref.path;
}

// ---------------------------------------------------------------------------
// resolveScope
// ---------------------------------------------------------------------------

/**
 * The registry each resolved scope was built against.
 *
 * A `WeakMap` rather than a field, because `ResolvedScope` is a published interface and the
 * registry is not part of it: the scope needs it for exactly one walk-time check (`assertHead`'s
 * "at document granularity the record type IS the registry collection") and exposing it would
 * invite a second reader.
 */
const REGISTRY_OF = new WeakMap<object, FieldRegistry<string>>();

function assertRegistryLike(registry: unknown): asserts registry is FieldRegistry<string> {
  if (typeof registry !== 'object' || registry === null) {
    invalid(`resolveScope needs a registry, received ${typeName(registry)}`);
  }
  const candidate = registry as Partial<FieldRegistry<string>>;
  if (!Array.isArray(candidate.collections)) {
    invalid('resolveScope: registry.collections must be an array — pass a defineRegistry() result');
  }
  if (typeof candidate.has !== 'function' || typeof candidate.entry !== 'function') {
    invalid('resolveScope: registry must provide has() and entry() — pass a defineRegistry() result');
  }
}

/** Validation 1. Matches `aad.ts`'s wrap-component rule, because it feeds exactly that. */
function resolveProductId(productId: unknown): string {
  if (typeof productId !== 'string') {
    invalid(`ContentKeyScope.productId must be a string, received ${typeName(productId)}`);
  }
  if (productId.length === 0) {
    invalid('ContentKeyScope.productId must not be empty');
  }
  if (productId.includes('/')) {
    invalid(
      `ContentKeyScope.productId must not contain '/': '${productId}' would shift every component after ` +
        'it and neither wrap AAD would parse to one tuple',
      { productId },
    );
  }
  return productId;
}

const GRANULARITIES: readonly RecordGranularity[] = ['document', 'aggregate', 'account'];

/** Validations 2 and 3, plus the injection that is the whole of the "one model" claim. */
function resolveRecords(
  records: unknown,
  registry: FieldRegistry<string>,
): Record<string, RecordGranularity> {
  if (!isPlainRecord(records)) {
    invalid(`ContentKeyScope.records must be a plain object, received ${typeName(records)}`);
  }
  const resolved: Record<string, RecordGranularity> = Object.create(null) as Record<
    string,
    RecordGranularity
  >;
  for (const type of Object.keys(records)) {
    if (type.length === 0) {
      invalid('ContentKeyScope.records has an empty record type');
    }
    // Validation 3 — declaring the reserved type is the fake-record-type mistake arriving as an
    // error. It is injected below, which is what lets a product reach account granularity
    // without a declaration at all.
    if (type === ACCOUNT_RECORD_TYPE) {
      invalid(
        `ContentKeyScope.records must not declare "${ACCOUNT_RECORD_TYPE}": it is the reserved record ` +
          'type for account granularity and resolveScope injects it. Declaring it is the fake ' +
          'record type the one-model design exists to remove — call crypto.accountRecord(id)',
        { recordType: type },
      );
    }
    const granularity = records[type];
    if (typeof granularity !== 'string' || !GRANULARITIES.includes(granularity as RecordGranularity)) {
      invalid(
        `ContentKeyScope.records["${type}"] must be one of ${GRANULARITIES.join(', ')}, received ` +
          `${typeName(granularity)}`,
        { recordType: type },
      );
    }
    // Validation 2 — at document granularity `documentRecordRef(collection, …)` produces
    // `type === collection`, so a scope declaring a record type the registry does not know would
    // throw on every write. This check is the fix for v1's broken Morph example; correcting the
    // example is not.
    if (granularity === 'document' && !registry.has(type)) {
      invalid(
        `ContentKeyScope.records declares "${type}" as document-granular, but "${type}" is not a ` +
          `registry collection (the registry has: ${registry.collections.join(', ') || 'none'}). ` +
          'At document granularity the record type IS the registry collection key',
        { recordType: type },
      );
    }
    resolved[type] = granularity as RecordGranularity;
  }
  // The injection. One scope, both granularities, no declaration.
  resolved[ACCOUNT_RECORD_TYPE] = 'account';
  return resolved;
}

function resolveLegacy(legacy: unknown): ResolvedScope<string>['legacy'] {
  if (legacy === undefined) return null;
  if (!isPlainRecord(legacy)) {
    invalid(`ContentKeyScope.legacy must be a plain object when present, received ${typeName(legacy)}`);
  }
  const versionsRaw = legacy.readFieldVersions;
  let versions: readonly ('v1' | 'v2')[] = [];
  if (versionsRaw !== undefined) {
    if (!Array.isArray(versionsRaw)) {
      invalid(
        `ContentKeyScope.legacy.readFieldVersions must be an array, received ${typeName(versionsRaw)}`,
      );
    }
    const seen = new Set<string>();
    for (const v of versionsRaw) {
      if (v !== 'v1' && v !== 'v2') {
        invalid(`ContentKeyScope.legacy.readFieldVersions may only contain 'v1' and 'v2', found ${String(v)}`);
      }
      if (seen.has(v)) {
        invalid(`ContentKeyScope.legacy.readFieldVersions lists '${v}' twice`);
      }
      seen.add(v);
    }
    versions = Object.freeze([...(versionsRaw as readonly ('v1' | 'v2')[])]);
  }

  const prefixRaw = legacy.objectMetaPrefix;
  if (prefixRaw !== undefined) {
    if (typeof prefixRaw !== 'string') {
      invalid(`ContentKeyScope.legacy.objectMetaPrefix must be a string, received ${typeName(prefixRaw)}`);
    }
    if (prefixRaw.length === 0) {
      invalid(
        "ContentKeyScope.legacy.objectMetaPrefix must not be empty: omit the key instead. An empty " +
          'prefix matches every metadata key, so a legacy reader would claim every object it saw',
      );
    }
  }

  const dekWrapAad = legacy.dekWrapAad;
  if (dekWrapAad !== undefined && typeof dekWrapAad !== 'function') {
    invalid(`ContentKeyScope.legacy.dekWrapAad must be a function, received ${typeName(dekWrapAad)}`);
  }

  return Object.freeze({
    readFieldVersions: versions,
    // The EMPTY STRING means "no legacy object envelope is reachable", and a reader must test for
    // it rather than calling `startsWith('')`, which is true of everything. It is the resolved
    // form of an omitted key, and the omitted key is refused above so the two cannot be confused.
    objectMetaPrefix: prefixRaw === undefined ? '' : prefixRaw,
    dekWrapAad: (dekWrapAad as ((a: string) => string) | undefined) ?? null,
  });
}

function resolveBlobAdapters(adapters: unknown): readonly BlobAdapter[] {
  if (adapters === undefined) return Object.freeze([]);
  if (!Array.isArray(adapters)) {
    invalid(`ContentKeyScope.blobAdapters must be an array, received ${typeName(adapters)}`);
  }
  const tags = new Set<string>();
  for (const adapter of adapters as readonly unknown[]) {
    if (typeof adapter !== 'object' || adapter === null) {
      invalid(`ContentKeyScope.blobAdapters contains ${typeName(adapter)}, which is not an adapter`);
    }
    const candidate = adapter as Partial<BlobAdapter>;
    if (typeof candidate.t !== 'string' || candidate.t.length === 0 || candidate.t.length > 32) {
      invalid('ContentKeyScope.blobAdapters: every adapter needs a tag `t` of 1–32 characters');
    }
    if (candidate.t.includes('$')) {
      invalid(
        `ContentKeyScope.blobAdapters: adapter tag "${candidate.t}" contains '$', which is reserved for ` +
          'the serialiser\'s own tags',
      );
    }
    if (
      typeof candidate.match !== 'function' ||
      typeof candidate.encode !== 'function' ||
      typeof candidate.decode !== 'function'
    ) {
      invalid(
        `ContentKeyScope.blobAdapters: adapter "${candidate.t}" must provide match(), encode() and decode()`,
      );
    }
    // "Unique across a scope's adapters" is a scope-level rule, and the scope is the only place
    // the whole adapter set exists. Two adapters at one tag decode as whichever came first.
    if (tags.has(candidate.t)) {
      invalid(`ContentKeyScope.blobAdapters declares the tag "${candidate.t}" twice`);
    }
    tags.add(candidate.t);
  }
  return Object.freeze([...(adapters as readonly BlobAdapter[])]);
}

/**
 * Validation 5 and the derivation it validates, both delegated to `registry.ts`.
 *
 * `assertDocumentBudget` is validation 5 in full — the pair check, the declared-ceiling sum, and
 * the `MIN_DERIVED_SEALED_BYTES` floor — and `deriveCeilings` is the arithmetic it validates, so
 * the number a collection is checked against is by construction the number it then gets. Both
 * live beside the path counts they read; this function is the memo table over them, computed once
 * at construction so `ceilingsFor` is a lookup and no consumer can re-derive a ceiling of its own.
 *
 * **A collection that declares nothing can never fail the sum.** The derivation makes it fit by
 * construction, which is the point: the common case constructs, and the only way to over-commit a
 * document is to say so explicitly.
 */
function ceilingTable(
  registry: FieldRegistry<string>,
  budget: { readonly maxSealedBytes: number; readonly maxDocumentSealedBytes: number },
): ReadonlyMap<string, Ceilings> {
  assertDocumentBudget(registry, budget);
  const map = new Map<string, Ceilings>();
  for (const collection of registry.collections) {
    map.set(collection, deriveCeilings(registry.entry(collection), budget));
  }
  return map;
}

/**
 * Resolve a product's scope, with the registry it will be used against.
 *
 * `resolveScope` takes the registry because two of its validations are cross-table: **every
 * record type declared `'document'` must be a registry collection key** (validation 2), and the
 * per-collection ceilings are derived from the document budget (validation 5). The façade passes
 * both; a product never calls this directly.
 *
 * Everything it throws is a `VALIDATION_ERROR` naming the offender, and everything it throws is
 * thrown at construction — in the product's own unit tests, at deploy time, before any data
 * exists — which is strictly stronger than the same check on the write path.
 */
export function resolveScope<RT extends string>(
  scope: ContentKeyScope<RT>,
  registry: FieldRegistry<string>,
): ResolvedScope<RT> {
  if (!isPlainRecord(scope)) {
    invalid(`resolveScope needs a ContentKeyScope object, received ${typeName(scope)}`);
  }
  assertRegistryLike(registry);

  const productId = resolveProductId(scope.productId);
  const records = resolveRecords(scope.records, registry);

  if (scope.aad !== undefined && scope.aad !== 'tight') {
    invalid(
      `ContentKeyScope.aad must be 'tight', received ${String(scope.aad)}. It is a one-member union so ` +
        'that loosening the binding is a visible change and never a configuration accident',
    );
  }
  if (scope.reads !== undefined && scope.reads !== 'strict' && scope.reads !== 'lenient') {
    invalid(`ContentKeyScope.reads must be 'strict' or 'lenient', received ${String(scope.reads)}`);
  }
  if (scope.accountRecordPath !== undefined && typeof scope.accountRecordPath !== 'function') {
    invalid(
      `ContentKeyScope.accountRecordPath must be a function, received ${typeName(scope.accountRecordPath)}`,
    );
  }

  const maxSealedBytes = scope.maxSealedBytes ?? DEFAULT_MAX_SEALED_BYTES;
  assertPositiveInteger(maxSealedBytes, 'maxSealedBytes');
  const maxDocumentSealedBytes = scope.maxDocumentSealedBytes ?? DEFAULT_MAX_DOCUMENT_SEALED_BYTES;
  assertPositiveInteger(maxDocumentSealedBytes, 'maxDocumentSealedBytes');
  // `maxSealedBytes <= maxDocumentSealedBytes` is the first half of validation 5 and is asserted
  // by `assertDocumentBudget`, inside `ceilingTable` below. Repeating it here would be a second
  // message for one rule, and the second message is the one that goes stale.

  const deflateOver = scope.deflateOver ?? 0;
  if (typeof deflateOver !== 'number' || !Number.isSafeInteger(deflateOver) || deflateOver < 0) {
    invalid(
      `ContentKeyScope.deflateOver must be a non-negative safe integer (0 means off), received ` +
        `${String(scope.deflateOver)}`,
    );
  }

  const blobAdapters = resolveBlobAdapters(scope.blobAdapters);
  const legacy = resolveLegacy(scope.legacy);
  const ceilings = ceilingTable(registry, { maxSealedBytes, maxDocumentSealedBytes });
  const accountRecordPath = scope.accountRecordPath;

  const granularityOf = (type: string): RecordGranularity => {
    if (typeof type !== 'string' || !has(records, type)) {
      invalid(
        `record type "${String(type)}" is not declared in ContentKeyScope.records (declared: ` +
          `${Object.keys(records).join(', ')})`,
        typeof type === 'string' ? { recordType: type } : undefined,
      );
    }
    return records[type];
  };

  const assertRecord = (record: RecordRef, ownerAccountId?: string): void => {
    if (typeof record !== 'object' || record === null) {
      invalid(`a RecordRef is required, received ${typeName(record)}`);
    }
    assertRefComponent(record.type, 'type', 'RecordRef');
    assertRefComponent(record.id, 'id', 'RecordRef');
    const granularity = granularityOf(record.type);
    assertScopePath(record.path);

    if (!record.path.endsWith(`/${record.id}`)) {
      // Two different mistakes wear the same shape, and the messages are worth separating: a
      // path BELOW the holder is the walked-children bug, and it is the one the design forbids.
      // Not at account granularity, where a row nested under the account is a plausible thing to
      // have configured and the useful thing to say is which rule it broke (§18 Q-A).
      if (granularity !== 'account' && record.path.includes(`/${record.id}/`)) {
        invalid(
          `record ${record.type}/${record.id}: scopePath "${record.path}" is BELOW the wrap ` +
            'holder. The wrap lives on the holder and nowhere else — at aggregate granularity ' +
            'that is the aggregate root, once — so a path that walks into a child is the ' +
            'walked-children bug arriving as a refusal',
          { recordType: record.type, recordId: record.id, scopePath: record.path },
        );
      }
      invalid(
        `record ${record.type}/${record.id}: scopePath "${record.path}" does not end with ` +
          `"/${record.id}". The path IS the record key's holder, so a path naming a different ` +
          'row would bind every wrap on this record to that row instead',
        { recordType: record.type, recordId: record.id, scopePath: record.path },
      );
    }

    if (granularity === 'account' && ownerAccountId !== undefined && record.id !== ownerAccountId) {
      invalid(
        `record ${record.type}/${record.id} is account-granular, so its id must be the owning ` +
          `account "${ownerAccountId}". An account-granular record whose id is not its owner is ` +
          "one account's key row holding another account's wrap",
        { recordType: record.type, recordId: record.id, accountId: ownerAccountId },
      );
    }
  };

  const resolved: ResolvedScope<RT> = {
    productId,
    records: Object.freeze({ ...records }) as Readonly<
      Record<RT | typeof ACCOUNT_RECORD_TYPE, RecordGranularity>
    >,
    aad: 'tight',
    reads: scope.reads ?? 'strict',
    maxSealedBytes,
    maxDocumentSealedBytes,
    deflateOver,
    blobAdapters,
    legacy,

    granularityOf: (type) => granularityOf(type),

    assertRecord,

    // Total, and deliberately so: it answers a question about a record, and an undeclared record
    // type is not "not account-granular", it is a mistake `assertRecord` refuses two lines later
    // on the same path. A predicate that throws is a predicate call sites wrap in try/catch.
    isAccountGranular: (record) =>
      typeof record === 'object' &&
      record !== null &&
      typeof record.type === 'string' &&
      has(records, record.type) &&
      records[record.type] === 'account',

    accountRecord: (accountId) => {
      if (accountRecordPath === undefined) {
        invalid(
          'this scope has no ContentKeyScope.accountRecordPath, so it cannot build an account-granular ' +
            'record. Supply `accountRecordPath: (accountId) => "<your row>/" + accountId` — it ' +
            'must be a row the PRODUCT owns, never Accounts\' own key row',
        );
      }
      if (typeof accountId !== 'string' || accountId.length === 0) {
        invalid(`accountRecord needs a non-empty accountId, received ${typeName(accountId)}`);
      }
      const path: unknown = accountRecordPath(accountId);
      if (typeof path !== 'string') {
        invalid(
          `ContentKeyScope.accountRecordPath returned ${typeName(path)} for account "${accountId}"; it ` +
            'must return the full document path of the row that holds the wrap',
          { accountId },
        );
      }
      const ref = accountRecordRef(accountId, path);
      // The ONE record assertion, applied where the config key can still be named. It costs
      // nothing and it is the difference between a bad `accountRecordPath` failing here and
      // failing at the first wrap write.
      assertRecord(ref, accountId);
      return ref;
    },

    ceilingsFor: (collection) => {
      const found = ceilings.get(collection);
      if (found === undefined) {
        invalid(
          `"${String(collection)}" is not a registry collection, so it has no ceilings ` +
            `(the registry has: ${registry.collections.join(', ') || 'none'})`,
          typeof collection === 'string' ? { collection } : undefined,
        );
      }
      return found;
    },
  };

  REGISTRY_OF.set(resolved, registry);
  return Object.freeze(resolved);
}

// ---------------------------------------------------------------------------
// assertHead
// ---------------------------------------------------------------------------

/**
 * Fail the head that has the wrap in the wrong place.
 *
 * Every head a product's `forEachRecord` yields passes through here before anything is planned
 * against it, and what it rejects is the mistake that has no error at the point of damage:
 *
 * - `document` — `record.path` ends with `/{record.id}`, and `record.type` IS the registry
 *   collection;
 * - `aggregate` — `record.path` ends with `/{record.id}` and has **no further segments below
 *   it**. A path below the aggregate root is the walked-children bug, and this is where it
 *   becomes a test failure rather than a second wrap;
 * - `account` — `record.id === ownerAccountId`. `accountSettingsDoc` generalises to a head, not
 *   to a document: the account row is visited once per account, by the same traversal, with the
 *   dial turned down.
 *
 * Depth is fine; depth **below the root** is not. sf-mapper's real path is six segments deep and
 * correct.
 *
 * **Declared here rather than in `walk.ts`**, which is where the barrel publishes it from and
 * which re-exports it (`export { assertHead } from './key-scope';`): granularity is decided in
 * one file, `walk.ts` lands nine build steps later, and `RecordHead` reaches this signature
 * structurally through `RecordHeadLike`.
 */
export function assertHead<RT extends string>(scope: ResolvedScope<RT>, head: RecordHeadLike): void {
  if (typeof head !== 'object' || head === null) {
    invalid(`assertHead needs a RecordHead, received ${typeName(head)}`);
  }
  if (typeof head.ownerAccountId !== 'string' || head.ownerAccountId.length === 0) {
    invalid(
      `head for record "${String((head.record as RecordRef | undefined)?.path)}" has no ` +
        'ownerAccountId. A head carries its owner because the account case is checked against it',
    );
  }

  scope.assertRecord(head.record, head.ownerAccountId);

  // The one thing `assertRecord` does not say, restated at the point the §16.7 table names it.
  // `resolveScope` validation 2 already guarantees this for every DECLARED document-granular
  // type; this catches a head whose `type` is a record type the registry lost since.
  const registry = REGISTRY_OF.get(scope);
  if (
    registry !== undefined &&
    scope.granularityOf(head.record.type as RT) === 'document' &&
    !registry.has(head.record.type)
  ) {
    invalid(
      `head for record ${head.record.type}/${head.record.id}: at document granularity the record ` +
        `type IS the registry collection, and "${head.record.type}" is not one of them ` +
        `(${registry.collections.join(', ') || 'none'})`,
      { recordType: head.record.type, recordId: head.record.id },
    );
  }
}

// ---------------------------------------------------------------------------
// The grace window
// ---------------------------------------------------------------------------

/**
 * `CONTENT_KEY_GRACE_MS`, or 15 minutes.
 *
 * The only environment variable this package's production code reads, and what it reads is a
 * duration — `check-mirror.js` assertion (12) pins that, along with the two `testing.ts` reads
 * and the one seed list. Configuration this package acquires is configuration five products then
 * have to set, so the bar for a second variable is a decision and not a convenience.
 *
 * A malformed value **throws** rather than falling back: a grace window is how long a revoked
 * key keeps serving, and silently reverting a typo to the default is exactly the class of
 * mistake nobody discovers until they are reading an incident timeline. `0` is legal and means
 * grace is off.
 */
export function resolveGraceMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env[GRACE_ENV_VAR];
  if (raw === undefined || raw.trim().length === 0) return DEFAULT_GRACE_MS;
  const parsed = Number(raw.trim());
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    invalid(
      `${GRACE_ENV_VAR} must be a non-negative whole number of milliseconds (0 turns grace off), ` +
        `received "${raw}"`,
    );
  }
  return parsed;
}
