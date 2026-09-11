/**
 * registry.ts — `defineRegistry`, the SECOND of the three things a product supplies.
 *
 * A registry is a table: which collections hold protected content, which paths inside a
 * document are protected, and whether each path holds a sealed **string** or a sealed
 * **blob**. The package ships the shape and the validations; the contents stay per product
 * and are never generalised (§2.6). Nothing here knows what a database is.
 *
 * This is collab's deployed module singleton (`lib/content-fields.ts`) inverted into a
 * factory, which buys two things a singleton cannot:
 *
 *   1. **The literal-union collection type survives the call.** `defineRegistry({ topics: … })`
 *      returns a `FieldRegistry<'topics'>`, so a mistyped collection is a compile error at the
 *      call site rather than a throw in production — and `EMPTY_REGISTRY` resolves `C` to
 *      `never`, which is how sf-mapper's "objects only" adoption is enforced by the type
 *      parameter rather than by discipline (R10).
 *   2. **The table is validated once, at construction.** Nine rules, every one of them a
 *      failure that would otherwise arrive as a tag mismatch or an unwritable document,
 *      months later, in a product's live data.
 *
 * ── ONE DELIBERATE RENAME FROM collab ─────────────────────────────────────────────────────
 *
 * collab's registry entry key is **`fields:`** (`content-fields.ts:28,33-52` — `projects:
 * { fields: ['name', …] }`). This package's key is **`strings:`**, and that is a deliberate
 * change, not a transcription slip (reconciliation ledger R24).
 *
 * The reason is that collab is the only field-level consumer and every other product is
 * blob-first: an entry now registers two kinds of path, `strings` and `blobs`, and a key
 * named `fields` sitting next to `blobs` would read as "the fields, and also the blobs",
 * when a blob path is just as much a field of the document. `strings` names what is
 * actually there — a path whose value is sealed as a UTF-8 string — and pairs with `blobs`
 * without either one claiming to be the general case. collab's Phase-C rewrite of its table
 * (§14.4) renames the key; the paths themselves are unchanged, and so are the AAD strings
 * they produce (§6.4), which is the property that matters.
 *
 * ── THE CEILINGS ARE DERIVED ELSEWHERE, AND DECLARED PER PATH ─────────────────────────────
 *
 * `ResolvedPath` carries **no effective** size ceiling, and that is the corrections addendum's
 * finding 4. A per-path ceiling of 900 000 bytes that defaulted per path, and was then summed
 * per document against a 1 000 000 byte budget, made any collection with two or more
 * registered paths unconstructible — four of the five worked registries in §14, collab's
 * included. An undeclared path's ceiling now derives from the scope's document budget and the
 * collection's registered-path count, so the common case constructs and the document budget
 * holds **by construction**:
 *
 *     effective ceiling for path P of collection C, which has N registered paths:
 *       P's own declaration                                  when the path declared one
 *       C's collection-wide declaration                      when the collection declared one
 *       min(scope.maxSealedBytes, floor(scope.maxDocumentSealedBytes / N))    otherwise
 *
 * N counts every registered path, string and blob alike: a registered string occupies the
 * same document as the blobs beside it, and a rule that counted only blobs would leave
 * collab's nine-string `messages` summing to 8.1 MB with nothing to say about it.
 *
 * **A declaration belongs to a PATH, not to a collection** (owner ruling R8). A collection's
 * paths are rarely the same size, and the shape that matters immediately is Morph's `results`:
 * one large blob (`structuredOutput`) beside two small ones (`citations`, `viewerPayload`).
 * With the number on the entry, that shape was inexpressible — declare nothing and all three
 * take a third of the document; declare 700 000 and the entry commits three times that and is
 * refused at construction. So `strings` and `blobs` accept a `PathSpec` in place of a bare
 * string, and the collection-wide `maxSealedBytes` survives only as the SHORTHAND that
 * declares the same number for every path that declares none — one declaration written once,
 * which is what collab's nine same-shaped strings want.
 *
 * The static sum is therefore taken over PATHS, adding what each one actually asked for, and
 * that makes it stronger rather than weaker: a collection can now over-commit only by naming
 * the bytes it over-commits by.
 *
 * The registry publishes what the product **declared** (`declaredMaxSealedBytes`,
 * `declaredMaxPlaintextBytes` on each `ResolvedPath`, and the collection-wide shorthand on the
 * `RegistryEntry`; `null` where nothing was declared) and the arithmetic lives in
 * `derivePathCeilings` / `deriveCeilings` / `assertDocumentBudget` below, beside N — the only
 * number the derivation needs that the scope does not have. `ResolvedScope.ceilingsFor` (§5.3,
 * key-scope.ts) is the one public way to ask for a ceiling and MUST delegate here;
 * `resolveScope`'s validation 5 is `assertDocumentBudget` and nothing else. Two places holding
 * this arithmetic is two places to disagree, which is the defect being fixed.
 *
 * ── WHY `ReadStrictness` IS DECLARED HERE ─────────────────────────────────────────────────
 *
 * §5.3 gives its home as `key-scope.ts`, and the barrel exports it from there. It is
 * declared here instead because `RegistrySpec.reads`, `RegistryEntry.reads` and `readsFor`
 * all need it, and `key-scope.ts` imports `FieldRegistry` from this module — so declaring it
 * there would point this module's imports up at a module that lands two build-order steps
 * later. `key-scope.ts` re-exports it (`export type { ReadStrictness } from './registry'`),
 * which keeps ONE declaration and leaves the barrel's line unchanged.
 *
 * Pure, synchronous, no key material, no clock, no I/O. It imports `errors.ts` (to refuse),
 * `field-path.ts` (the grammar), `aad.ts` (the one content-AAD builder) and `blob-json.ts`
 * (`DEFAULT_MAX_DEPTH` and `maxPlaintextFor`, both of which are that module's by right).
 */

import { ContentCryptoError } from './errors';
import { aadForContent } from './aad';
import { formatFieldPath, parseFieldPath, type PathSegment } from './field-path';
import { DEFAULT_MAX_DEPTH, maxPlaintextFor } from './blob-json';

// ───────────────────────────────────── the types ─────────────────────────────────────

/** How a registered path's value is sealed. A path is one or the other, never both. */
export type FieldMode = 'string' | 'blob';

/**
 * Read strictness for a registered path (§7.4). `strict` is the default and the destination;
 * `lenient` is collab's Phase-C exit ramp and nothing else's.
 *
 * Declared here rather than in `key-scope.ts` — see the module docblock. `key-scope.ts`
 * re-exports it, so §5.3 and the barrel are unaffected.
 */
export type ReadStrictness = 'strict' | 'lenient';

/**
 * One registered path with its own sealed-size declaration — the long form of a bare string,
 * and the reason a collection's paths need not all be the same size (owner ruling R8).
 *
 * Write it only for the paths that need a number of their own; a bare string is the intended
 * default and takes the derived share of the document budget. Morph's `results` is the shape
 * this exists for:
 *
 * @example
 * results: {
 *   blobs: [
 *     { path: 'structuredOutput', maxSealedBytes: 700_000 },
 *     { path: 'citations',        maxSealedBytes: 100_000 },
 *     { path: 'viewerPayload',    maxSealedBytes: 100_000 },
 *   ],
 * }
 */
export interface PathSpec {
  /** The registered path, in the same grammar a bare string uses. */
  readonly path: string;
  /**
   * This path's own sealed ceiling, measured on the emitted `enc:v3:` string. It wins over the
   * collection-wide shorthand and over the derived share.
   */
  readonly maxSealedBytes?: number;
  /** This path's own plaintext ceiling. Defaults to `maxPlaintextFor(the effective sealed one)`. */
  readonly maxPlaintextBytes?: number;
}

/** A registered path: the bare string, or the long form that carries its own ceilings. */
export type PathDeclaration = string | PathSpec;

/**
 * What a product writes.
 *
 * @example
 * defineRegistry({
 *   materials: { strings: ['content'], blobs: ['proposal'] },
 *   versions:  { strings: ['content', 'summary', 'label'], root: 'artefacts' },
 *   results:   { blobs: [{ path: 'structuredOutput', maxSealedBytes: 700_000 }, 'citations'] },
 * });
 */
export interface RegistrySpec {
  /**
   * Registered string paths, collab's grammar: `a.b`, `a[].b`, `a.b[]`. The key is
   * `strings`, not collab's `fields` — see the module docblock for why the rename is
   * deliberate. An entry may be a bare path or a `PathSpec` carrying that path's own ceilings.
   */
  readonly strings?: readonly PathDeclaration[];
  /**
   * Registered blob paths. NO `[]` segment is permitted in a blob path (§8.8). As with
   * `strings`, an entry may be a bare path or a `PathSpec`.
   */
  readonly blobs?: readonly PathDeclaration[];
  /**
   * AAD root override, for when the AAD id is not the row id — collab's `versions` under
   * `artefacts`, build's `checkpoints` under `phases`. Its presence is also what makes
   * `decryptDocs`' `docIdOf` mandatory for that collection (§5.7).
   */
  readonly root?: string;
  /** Per-collection read strictness override. Resolution: entry ?? scope ?? 'strict' (§7.4). */
  readonly reads?: ReadStrictness;
  /**
   * The SHORTHAND: one sealed ceiling declared once for every path in this collection that
   * does not declare its own. It is the same declaration a `PathSpec` makes, written once
   * because the paths are the same shape — collab's nine `messages` strings, not Morph's one
   * large blob beside two small ones, which needs `PathSpec` (R8).
   *
   * Omit it — the derived share of the document budget is the intended default and is the only
   * setting that cannot over-commit a document.
   */
  readonly maxSealedBytes?: number;
  /**
   * The plaintext half of the same shorthand. Omit it: each path defaults to
   * `maxPlaintextFor(its effective sealed ceiling)`.
   */
  readonly maxPlaintextBytes?: number;
}

/**
 * One registered path, parsed.
 *
 * It carries what the product **declared** and never an EFFECTIVE ceiling: the effective
 * number depends on the scope's document budget, which `defineRegistry` does not have. Ask
 * `derivePathCeilings` (or `ResolvedScope.ceilingsFor(collection)`, which delegates here).
 * See the module docblock, and finding 4 of the corrections addendum.
 */
export interface ResolvedPath {
  /** As registered, with any `[]` retained — this exact string is what the AAD binds. */
  readonly fieldPath: string;
  readonly mode: FieldMode;
  readonly segments: readonly PathSegment[];
  /**
   * As declared on this path's own `PathSpec`, or `null`. Never the collection-wide shorthand
   * and never a default: the shorthand is on the entry and the default needs the scope, and
   * folding either one in here would lose the distinction the sum has to report.
   */
  readonly declaredMaxSealedBytes: number | null;
  readonly declaredMaxPlaintextBytes: number | null;
}

/** One collection's resolved table. */
export interface RegistryEntry {
  /** `spec.root ?? the collection key`. The first component of every content AAD here. */
  readonly root: string;
  /** Every registered path: the strings in declared order, then the blobs in declared order. */
  readonly paths: readonly ResolvedPath[];
  /** The entry's own override, or `null`. `readsFor` is what resolves it against the scope. */
  readonly reads: ReadStrictness | null;
  /** True when `spec.root` was given, which is what makes `docIdOf` mandatory (§5.7). */
  readonly hasRootOverride: boolean;
  /**
   * The collection-wide SHORTHAND as declared by the product, or `null`. It applies to every
   * path of this entry that declared nothing of its own, and it is never a default — the
   * default needs the scope.
   */
  readonly declaredMaxSealedBytes: number | null;
  readonly declaredMaxPlaintextBytes: number | null;
}

/** The validated table. Frozen, and the only thing a consumer holds. */
export interface FieldRegistry<C extends string> {
  readonly collections: readonly C[];
  has(value: unknown): value is C;
  entry(collection: C): RegistryEntry;
  pathsFor(collection: C): readonly ResolvedPath[];
  /** The ONLY builder of a content AAD outside `aad.ts`, and it delegates to it. */
  aadFor(collection: C, aadDocId: string, fieldPath: string): string;
  /** `entry.reads ?? scopeDefault`. Takes both, which is why it is a method and not a field. */
  readsFor(collection: C, scopeDefault: ReadStrictness): ReadStrictness;
}

/** The effective ceilings for one collection, both measured in bytes. */
export interface Ceilings {
  /** Measured on the emitted `enc:v3:` string, per value. */
  readonly maxSealedBytes: number;
  /** Measured on the JSON body of a blob, or the UTF-8 plaintext of a string. */
  readonly maxPlaintextBytes: number;
}

/** The two scope numbers the derivation needs. A subset of `ResolvedScope`, deliberately. */
export interface DocumentBudget {
  readonly maxSealedBytes: number;
  readonly maxDocumentSealedBytes: number;
}

// ───────────────────────────────── reserved roots ─────────────────────────────────

/**
 * The private source of truth. `RESERVED_ROOTS` below is a separate `Set` built from it, so
 * that a caller who reaches through the `ReadonlySet` type and deletes a member cannot
 * weaken the validation — a `Set`'s contents survive `Object.freeze`, so the only honest
 * defence is not to validate against the exported object.
 */
const RESERVED_ROOT_NAMES = Object.freeze(['record-key', 'content-key', 'obj'] as const);
const RESERVED_ROOT_SET: ReadonlySet<string> = new Set<string>(RESERVED_ROOT_NAMES);

/**
 * Roots a product may not use, because each is the first component of an AAD form built by
 * another layer (§6.3). The hazard is narrow and already closed twice, and this closes the
 * one genuinely cross-layer case: collab's legacy v1/v2 content sits under the ACCOUNT DEK
 * with the bare AAD `{root}/{docId}.{field}`, and record-key wraps sit under the account DEK
 * too. A collision needs a collection or `root` literally named `record-key` — which does
 * not arise today, and is not a property the code enforces until this list does.
 */
export const RESERVED_ROOTS: ReadonlySet<string> = new Set<string>(RESERVED_ROOT_NAMES);

/**
 * Below this, a derived ceiling is not a budget, it is a bug report. A collection with more
 * than 244 registered paths trips it against the default 1 000 000-byte document budget, and
 * the refusal names the collection rather than shipping a three-byte limit nobody would
 * understand.
 *
 * Declared here because it is a property of the derivation, which is here. `key-scope.ts`
 * re-exports it for the barrel (§C1 of the corrections addendum lists it under `key-scope`).
 */
export const MIN_DERIVED_SEALED_BYTES = 4_096;

// ───────────────────────────────── refusal helpers ─────────────────────────────────

type Details = ConstructorParameters<typeof ContentCryptoError>[2];

function invalid(message: string, details?: Details): never {
  throw new ContentCryptoError('VALIDATION_ERROR', message, details);
}

/** Names a wrong type without ever printing the value. */
function typeName(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  return `a ${typeof value}`;
}

/** A path is short and is the product's own literal, so quoting it in a message is safe. */
function q(value: string): string {
  return `"${value}"`;
}

// ───────────────────────────── collection-key validation ─────────────────────────────

/**
 * Validations 5, 7 and 8, applied to a collection key AND to a `root` override.
 *
 * Both are checked even when a `root` is present and the key never reaches an AAD: the key
 * is what a caller passes to every session method and what every refusal names, and a rule
 * that applied to one of the two would be a rule a reader has to look up.
 *
 * - no `/` (validation 5) — root `a/b` + docId `c` is the same string as root `a` + docId `b/c`
 * - no `.` (validation 7) — root `a.b` breaks the first-dot split that recovers the docId.
 *   v1 forbade only `/`; this was a real hole
 * - not in `RESERVED_ROOTS` (validation 8)
 */
function assertCollectionName(value: unknown, what: 'collection key' | 'root', collection: string): asserts value is string {
  if (typeof value !== 'string') {
    invalid(`registry ${what} must be a string, received ${typeName(value)}`, { collection });
  }
  if (value.length === 0) {
    invalid(`registry ${what} must not be empty`, { collection });
  }
  if (value.includes('/')) {
    invalid(
      `registry ${what} ${q(value)} must not contain '/': it would be indistinguishable from a ` +
        'shorter root with the remainder at the head of the docId, so two rows could produce one AAD',
      { collection },
    );
  }
  if (value.includes('.')) {
    invalid(
      `registry ${what} ${q(value)} must not contain '.': it breaks the first-dot split that ` +
        'separates the docId from the fieldPath in a content AAD',
      { collection },
    );
  }
  if (RESERVED_ROOT_SET.has(value)) {
    invalid(
      `registry ${what} ${q(value)} is reserved: ${RESERVED_ROOT_NAMES.join(', ')} are the first ` +
        'components of AAD forms built by other layers, and a collection named after one could ' +
        'collide with a wrap or an object AAD under the same key',
      { collection },
    );
  }
}

// ───────────────────────────────── path validation ─────────────────────────────────

/**
 * Validation 9: a registered path segment key is a plain identifier — non-empty, no `.`, no
 * `/`, no backtick.
 *
 * `.` is the path separator, so `update()` splitting a dotted string path could not address a
 * key containing one. `/` would let a segment forge the shape of a document path. The
 * backtick ban is what gives the blob `subPath` grammar (§8.9) an escape character it can
 * never collide with — that grammar quotes a key in backticks precisely because a registered
 * path can never contain one.
 *
 * `[` and `]` are refused too, and that is this module's own addition rather than the list in
 * §5.4: they are the array marker's own characters, so `a[0]` and `a[]b` must not parse as
 * ordinary keys. Without it `parseFieldPath('a[]b')` yields the key `a[]b`, which round-trips
 * but addresses nothing.
 *
 * collab's registry satisfies all of this by accident; the package rejects it at
 * `defineRegistry` time.
 */
const FORBIDDEN_IN_SEGMENT = ['.', '/', '`', '[', ']'] as const;

/**
 * Validation 3 (the path parses under the grammar), 2 (no `[]` in a blob path), 9 (segment
 * keys), 6 (depth) and 4 (this path's own declared ceilings), in the order a reader would
 * apply them — the ceilings last, so that a bad number is reported against a path that has
 * already been shown to be a path.
 *
 * `declaration` is a bare path string or a `PathSpec`. Anything else falls through to the
 * "not a string" refusal below, which is where an array, a number and a `null` all belong.
 */
function resolveOnePath(collection: string, mode: FieldMode, declaration: unknown): ResolvedPath {
  const spec: PathSpec | undefined =
    typeof declaration === 'object' && declaration !== null && !Array.isArray(declaration)
      ? (declaration as PathSpec)
      : undefined;
  const raw: unknown = spec === undefined ? declaration : spec.path;

  if (typeof raw !== 'string') {
    invalid(
      `registry collection ${q(collection)} registers a ${mode} path that is not a string ` +
        `(received ${typeName(raw)}); every registered path is a dotted string, or a PathSpec ` +
        'whose `path` is one',
      { collection },
    );
  }
  if (raw.length === 0) {
    invalid(`registry collection ${q(collection)} registers an empty path`, { collection });
  }

  const segments = parseFieldPath(raw);

  for (const segment of segments) {
    if (segment.key.length === 0) {
      invalid(
        `registry path ${q(raw)} in collection ${q(collection)} has an empty segment; a path is ` +
          "dot-separated and every segment names a key, so '', 'a.', '.a' and 'a..b' are all malformed",
        { collection, fieldPath: raw },
      );
    }
    for (const bad of FORBIDDEN_IN_SEGMENT) {
      if (segment.key.includes(bad)) {
        invalid(
          `registry path ${q(raw)} in collection ${q(collection)} has a segment containing ` +
            `'${bad}'; a segment key is a plain identifier — no '.', no '/', no backtick, and ` +
            "no brackets outside the trailing '[]' array marker",
          { collection, fieldPath: raw },
        );
      }
    }
  }

  // Validation 3, the closing half: what came out must render back to what went in. A path
  // the grammar cannot round-trip is a path whose AAD would not match the one the walk builds.
  if (formatFieldPath(segments) !== raw) {
    invalid(
      `registry path ${q(raw)} in collection ${q(collection)} does not parse under the field-path ` +
        `grammar; it renders back as ${q(formatFieldPath(segments))}`,
      { collection, fieldPath: raw },
    );
  }

  // Validation 2. A blob is sealed whole, so its update key is always the full dotted path and
  // never an array truncation; `[]` would ask the codec to seal each element separately, which
  // is what the string mode is for (§8.8).
  if (mode === 'blob') {
    for (const segment of segments) {
      if (segment.array) {
        invalid(
          `registry blob path ${q(raw)} in collection ${q(collection)} contains a '[]' segment; a ` +
            'blob is sealed as one subtree, so its path is always the full dotted path. Register ' +
            'it as a string path, or seal the containing object as the blob',
          { collection, fieldPath: raw },
        );
      }
    }
  }

  // Validation 6. The same cap the blob payload uses, because a registered path and a subPath
  // inside a blob are two halves of one descent and a reader should not have to hold two numbers.
  if (segments.length > DEFAULT_MAX_DEPTH) {
    invalid(
      `registry path ${q(raw)} in collection ${q(collection)} is ${segments.length} segments deep; ` +
        `the limit is ${DEFAULT_MAX_DEPTH}`,
      { collection, fieldPath: raw, depth: segments.length },
    );
  }

  return Object.freeze({
    fieldPath: raw,
    mode,
    segments: Object.freeze(segments.map((s) => Object.freeze({ key: s.key, array: s.array }))),
    declaredMaxSealedBytes: assertDeclaredCeiling(spec?.maxSealedBytes, 'maxSealedBytes', collection, raw),
    declaredMaxPlaintextBytes: assertDeclaredCeiling(spec?.maxPlaintextBytes, 'maxPlaintextBytes', collection, raw),
  });
}

/**
 * Validation 1: within a collection, registered paths are pairwise disjoint — no path is a
 * prefix of another, and no path is registered twice, in either mode.
 *
 * Comparison is over the SEGMENT KEYS, never the raw strings. Three consequences worth
 * stating, because each is a case a string comparison gets wrong:
 *
 *   - `attachments` and `attachments[].filename` overlap and are refused. A string `startsWith`
 *     would agree here by luck.
 *   - `attach` and `attachments` do NOT overlap and are legal. A string `startsWith` refuses
 *     them, which would be a refusal on data nobody has a problem with.
 *   - `a` and `a[]` have the same key sequence, address the same node, and are refused, even
 *     though the raw strings differ.
 */
function assertDisjoint(collection: string, accepted: readonly ResolvedPath[], next: ResolvedPath): void {
  const nextKeys = next.segments.map((s) => s.key);

  for (const prior of accepted) {
    const priorKeys = prior.segments.map((s) => s.key);
    const shared = Math.min(priorKeys.length, nextKeys.length);
    let common = true;
    for (let i = 0; i < shared; i++) {
      if (priorKeys[i] !== nextKeys[i]) { common = false; break; }
    }
    if (!common) continue;

    if (priorKeys.length === nextKeys.length) {
      if (prior.fieldPath === next.fieldPath) {
        invalid(
          `registry collection ${q(collection)} registers ${q(next.fieldPath)} twice ` +
            `(as a ${prior.mode} path and as a ${next.mode} path)`,
          { collection, fieldPath: next.fieldPath },
        );
      }
      invalid(
        `registry collection ${q(collection)} registers ${q(prior.fieldPath)} and ` +
          `${q(next.fieldPath)}, which differ only in their '[]' markers and address the same node`,
        { collection, fieldPath: next.fieldPath },
      );
    }

    const [outer, inner] = priorKeys.length < nextKeys.length ? [prior, next] : [next, prior];
    invalid(
      `registry collection ${q(collection)} registers ${q(inner.fieldPath)} inside ` +
        `${q(outer.fieldPath)}; a registered path may not nest inside another, because the outer ` +
        'value is sealed and the inner one would then be addressing ciphertext',
      { collection, fieldPath: inner.fieldPath },
    );
  }
}

/**
 * Validation 4: a declared ceiling is a positive safe integer, or it is absent.
 *
 * One helper for both places a ceiling can be declared — the collection-wide shorthand and a
 * path's own `PathSpec` — because they are one rule, and `fieldPath` is what says which of the
 * two the offending number was written on.
 */
function assertDeclaredCeiling(
  value: unknown,
  key: 'maxSealedBytes' | 'maxPlaintextBytes',
  collection: string,
  fieldPath?: string,
): number | null {
  if (value === undefined) return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    const where = fieldPath === undefined ? '' : ` on path ${q(fieldPath)}`;
    invalid(
      `registry collection ${q(collection)} declares ${key} ${String(value)}${where}; it must be a ` +
        'positive safe integer, or be omitted so the path takes its derived share of the ' +
        'document budget',
      fieldPath === undefined ? { collection } : { collection, fieldPath },
    );
  }
  return value;
}

function assertReads(value: unknown, collection: string): ReadStrictness | null {
  if (value === undefined) return null;
  if (value !== 'strict' && value !== 'lenient') {
    invalid(
      `registry collection ${q(collection)} declares reads ${String(value)}; the only values are ` +
        'strict and lenient',
      { collection },
    );
  }
  return value;
}

function assertPathList(value: unknown, mode: FieldMode, collection: string): readonly unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    invalid(
      `registry collection ${q(collection)} declares its ${mode} paths as ${typeName(value)}; it ` +
        'must be an array, each entry a dotted string or a PathSpec carrying that path and its ' +
        'own ceilings',
      { collection },
    );
  }
  return value;
}

// ───────────────────────────────────── the factory ─────────────────────────────────────

function requireEntry(entries: ReadonlyMap<string, RegistryEntry>, collection: unknown): RegistryEntry {
  if (typeof collection === 'string') {
    const found = entries.get(collection);
    if (found !== undefined) return found;
  }
  invalid(
    `no content is registered for collection ${q(String(collection))}; the registered collections ` +
      `are ${[...entries.keys()].map(q).join(', ') || '(none)'}`,
    typeof collection === 'string' ? { collection } : undefined,
  );
}

/**
 * Build and validate a registry.
 *
 * The nine construction-time validations of §5.4, every one throwing `VALIDATION_ERROR` and
 * naming the offender:
 *
 *   1. within a collection, paths are pairwise disjoint — no prefix, no duplicate, either mode
 *   2. a blob path contains no `[]` segment
 *   3. every path parses under the field-path grammar
 *   4. `maxSealedBytes` / `maxPlaintextBytes`, where present, are positive integers — on a
 *      path's own `PathSpec` and on the collection-wide shorthand alike
 *   5. a collection key or `root` contains no `/`
 *   6. path depth is within `DEFAULT_MAX_DEPTH`
 *   7. a collection key or `root` contains no `.`
 *   8. a collection key or `root` is not in `RESERVED_ROOTS`
 *   9. every registered path segment key is a plain identifier
 *
 * The tenth rule — that a collection's ceilings SUM, over its paths, to no more than the
 * document budget — is checked at `resolveScope`, because it needs the scope's budget. It is
 * `assertDocumentBudget` below.
 *
 * A collection may legally register **no** paths. That is not a mistake: `resolveScope`'s
 * validation 2 requires every record type declared at document granularity to be a key of the
 * registry, and a document-granular record whose content is all in objects has a wrap and no
 * registered field.
 */
export function defineRegistry<S extends Readonly<Record<string, RegistrySpec>>>(
  spec: S,
): FieldRegistry<Extract<keyof S, string>> {
  type C = Extract<keyof S, string>;

  if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) {
    invalid(`a registry spec must be an object keyed by collection, received ${typeName(spec)}`);
  }

  const entries = new Map<string, RegistryEntry>();
  const collections: string[] = [];

  for (const collection of Object.keys(spec)) {
    const raw: RegistrySpec = (spec as Readonly<Record<string, RegistrySpec>>)[collection];
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      invalid(
        `registry collection ${q(collection)} must map to an object, received ${typeName(raw)}`,
        { collection },
      );
    }

    assertCollectionName(collection, 'collection key', collection);
    const hasRootOverride = raw.root !== undefined;
    if (hasRootOverride) assertCollectionName(raw.root, 'root', collection);

    const reads = assertReads(raw.reads, collection);
    const declaredMaxSealedBytes = assertDeclaredCeiling(raw.maxSealedBytes, 'maxSealedBytes', collection);
    const declaredMaxPlaintextBytes = assertDeclaredCeiling(raw.maxPlaintextBytes, 'maxPlaintextBytes', collection);

    // Strings first, then blobs, each in declared order. Fixed rather than incidental: the
    // document planner walks `paths` and its `visited` counter is asserted in §16.8, so the
    // order is part of what a consumer's test pins down.
    const paths: ResolvedPath[] = [];
    const add = (mode: FieldMode, list: readonly unknown[]): void => {
      for (const candidate of list) {
        const resolved = resolveOnePath(collection, mode, candidate);
        assertDisjoint(collection, paths, resolved);
        paths.push(resolved);
      }
    };
    add('string', assertPathList(raw.strings, 'string', collection));
    add('blob', assertPathList(raw.blobs, 'blob', collection));

    entries.set(collection, Object.freeze({
      root: hasRootOverride ? (raw.root as string) : collection,
      paths: Object.freeze(paths),
      reads,
      hasRootOverride,
      declaredMaxSealedBytes,
      declaredMaxPlaintextBytes,
    }));
    collections.push(collection);
  }

  const registry: FieldRegistry<C> = {
    collections: Object.freeze(collections) as readonly C[],

    /** True only for a registered key. `Map`, not an object, so `__proto__` is not a collection. */
    has(value: unknown): value is C {
      return typeof value === 'string' && entries.has(value);
    },

    entry(collection: C): RegistryEntry {
      return requireEntry(entries, collection);
    },

    pathsFor(collection: C): readonly ResolvedPath[] {
      return requireEntry(entries, collection).paths;
    },

    /**
     * `{root}/{aadDocId}.{fieldPath}` — resolved through the entry's root and then built by
     * `aad.ts`, which owns every AAD form and every component rule. This function's whole job
     * is the root lookup; it deliberately does not re-validate the components.
     *
     * It does not check that `fieldPath` is registered, and that is not an oversight: the
     * migration reads a legacy value at a path the registry may have since renamed, and a
     * blob reseal builds the AAD for the blob path itself. The registered set is enforced
     * where the walk chooses paths, which is `doc-codec.ts`.
     */
    aadFor(collection: C, aadDocId: string, fieldPath: string): string {
      return aadForContent(requireEntry(entries, collection).root, aadDocId, fieldPath);
    },

    /**
     * `entry.reads ?? scopeDefault ?? 'strict'` (§7.4). The third fallback exists for a
     * plain-JavaScript caller who omits the argument the type requires: strict is the
     * default everywhere, and defaulting to leniency on a missing argument would be a silent
     * plaintext-substitution path opened by a typo.
     */
    readsFor(collection: C, scopeDefault: ReadStrictness): ReadStrictness {
      return requireEntry(entries, collection).reads ?? scopeDefault ?? 'strict';
    },
  };

  return Object.freeze(registry);
}

/**
 * `C` resolves to `never`, which makes every document method on a session UNCALLABLE. That is
 * how sf-mapper's "objects only" adoption is enforced by the type parameter rather than by
 * discipline (R10): there is no collection to pass, so `encryptDoc` cannot be written at all.
 */
export const EMPTY_REGISTRY: FieldRegistry<never> = defineRegistry({});

// ───────────────────────────── the ceilings, derived once ─────────────────────────────

/**
 * The share of the document budget an UNDECLARED path of this collection takes:
 *
 *     min(budget.maxSealedBytes, floor(budget.maxDocumentSealedBytes / N))
 *
 * N counts every registered path, string and blob alike, so N undeclared paths sum to no more
 * than the budget by construction (R7 — this mechanism is the one that makes the common case
 * construct, and it survives the move of the declaration onto the path).
 *
 * A collection with no registered paths takes the whole budget as its share: there is no
 * document to over-commit, and dividing by zero would hand back `Infinity`.
 */
function derivedShare(entry: RegistryEntry, budget: DocumentBudget): number {
  const n = entry.paths.length;
  const share = n > 0 ? Math.floor(budget.maxDocumentSealedBytes / n) : budget.maxDocumentSealedBytes;
  return Math.min(budget.maxSealedBytes, share);
}

/**
 * The effective ceilings for ONE registered path — the number every write is measured against.
 *
 * Precedence, and the whole of it: **the path's own declaration, then the collection-wide
 * shorthand, then the derived share** (R8). The plaintext half follows the sealed one it ends
 * up with, unless it too was declared, so raising a path's sealed ceiling raises its plaintext
 * ceiling automatically (§8.4).
 *
 * The single-path, undeclared case is unchanged from a plain default — `min(900 000, 1 000 000)`
 * is 900 000 — so `maxPlaintextFor(900_000) === 674_960` stays the pinned number and
 * `DEFAULT_MAX_SEALED_BYTES` keeps its meaning as the scope's per-value cap.
 *
 * `path` must be one of `entry.paths`; the entry supplies the shorthand and N, and nothing
 * looks the path up, because every caller is already walking the entry's own table.
 */
export function derivePathCeilings(entry: RegistryEntry, path: ResolvedPath, budget: DocumentBudget): Ceilings {
  const maxSealedBytes =
    path.declaredMaxSealedBytes ?? entry.declaredMaxSealedBytes ?? derivedShare(entry, budget);
  const maxPlaintextBytes =
    path.declaredMaxPlaintextBytes ?? entry.declaredMaxPlaintextBytes ?? maxPlaintextFor(maxSealedBytes);
  return Object.freeze({ maxSealedBytes, maxPlaintextBytes });
}

/**
 * The collection-wide UPPER BOUND: the widest sealed ceiling and the widest plaintext ceiling
 * any single value in this collection may have.
 *
 * Since R8 a collection's paths need not share a ceiling, so this is a bound and not a path's
 * number: the two maxima need not even come from the same path. **Enforcement uses
 * `derivePathCeilings`** — a check against this bound would let a small path carry a value
 * sized for the large one beside it. Its use is the summary answer, which is what
 * `ResolvedScope.ceilingsFor(collection)` (§5.3) still asks for and what a collection with
 * uniform paths — every §14 registry but Morph's `results` — makes exact.
 *
 * A collection with no registered paths keeps the shorthand-or-share answer: no path exists to
 * take a maximum over.
 *
 * `doc-codec` and `blob-codec` read these and never re-derive them: the number is decided
 * once, because a ceiling held in two places is a ceiling that eventually disagrees with itself.
 */
export function deriveCeilings(entry: RegistryEntry, budget: DocumentBudget): Ceilings {
  if (entry.paths.length === 0) {
    const maxSealedBytes = entry.declaredMaxSealedBytes ?? derivedShare(entry, budget);
    return Object.freeze({
      maxSealedBytes,
      maxPlaintextBytes: entry.declaredMaxPlaintextBytes ?? maxPlaintextFor(maxSealedBytes),
    });
  }

  let maxSealedBytes = 0;
  let maxPlaintextBytes = 0;
  for (const path of entry.paths) {
    const ceilings = derivePathCeilings(entry, path, budget);
    if (ceilings.maxSealedBytes > maxSealedBytes) maxSealedBytes = ceilings.maxSealedBytes;
    if (ceilings.maxPlaintextBytes > maxPlaintextBytes) maxPlaintextBytes = ceilings.maxPlaintextBytes;
  }
  return Object.freeze({ maxSealedBytes, maxPlaintextBytes });
}

/**
 * `resolveScope`'s validation 5, in full, and the one static enforcement of the per-document
 * budget (§8.6 mechanism 1):
 *
 *   - `maxSealedBytes <= maxDocumentSealedBytes`; and
 *   - for every collection C with N registered paths, where any path takes the derived share,
 *     that share must be at least `MIN_DERIVED_SEALED_BYTES`; and
 *   - **the sum over C's PATHS of each path's effective ceiling** — what it declared, or what
 *     the collection-wide shorthand declared for it, or its derived share —
 *     `<= maxDocumentSealedBytes`.
 *
 * Summing over paths rather than multiplying one collection-wide number by N is owner ruling
 * R8, and it makes this check STRONGER: it adds what the product actually asked for, path by
 * path, so Morph's one large blob beside two small ones is expressible and is summed exactly.
 *
 * **A collection that declares nothing can never fail the sum.** The derivation makes it fit
 * by construction, which is the point: the common case constructs, and the only way to
 * over-commit a document is to say so explicitly — and then the refusal says by how many bytes.
 * That is the fix finding 4 was pointing at; the symptom was Morph's three-blob example failing
 * at construction, and the default is what changed.
 *
 * The floor is checked before the sum. A collection fragmented past the point where a derived
 * share is a budget at all is a structural problem, and reporting the sum first would send the
 * reader off to tune a number that cannot help.
 *
 * This is static and therefore the strongest of the three checks, but it is not the only one:
 * it counts a `foo[]` array path once while the document holds N sealed elements, and it
 * cannot see the unsealed fields at all. The per-value check during the walk (§8.5) and the
 * per-document check on real bytes at write time (§8.6 mechanism 3) both remain necessary.
 */
export function assertDocumentBudget(registry: FieldRegistry<string>, budget: DocumentBudget): void {
  if (budget.maxSealedBytes > budget.maxDocumentSealedBytes) {
    invalid(
      `ContentKeyScope.maxSealedBytes (${budget.maxSealedBytes}) exceeds ` +
        `ContentKeyScope.maxDocumentSealedBytes (${budget.maxDocumentSealedBytes}); one value can never ` +
        'be allowed to be larger than the whole document that holds it',
      { limitBytes: budget.maxDocumentSealedBytes, sealedBytes: budget.maxSealedBytes },
    );
  }

  for (const collection of registry.collections) {
    const entry = registry.entry(collection);
    const n = entry.paths.length;
    if (n === 0) continue;

    const share = derivedShare(entry, budget);

    // The declared and the derived counted apart, because the refusal has to say which of the
    // two the bytes came from: one is a number somebody wrote and can lower, the other is a
    // consequence of how many paths the collection registers.
    let sum = 0;
    let declaredCount = 0;
    let declaredSum = 0;
    let derivedCount = 0;
    let largestDeclared = 0;
    let largestDeclaredPath = '';

    for (const path of entry.paths) {
      const declared = path.declaredMaxSealedBytes ?? entry.declaredMaxSealedBytes;
      if (declared === null) {
        derivedCount += 1;
        sum += share;
        continue;
      }
      declaredCount += 1;
      declaredSum += declared;
      sum += declared;
      if (declared > largestDeclared) {
        largestDeclared = declared;
        largestDeclaredPath = path.fieldPath;
      }
    }

    if (derivedCount > 0 && share < MIN_DERIVED_SEALED_BYTES) {
      invalid(
        `registry collection ${q(collection)} registers ${n} paths, which leaves each one ` +
          `${share} sealed bytes of the ${budget.maxDocumentSealedBytes}-byte document budget — ` +
          `below the ${MIN_DERIVED_SEALED_BYTES}-byte floor. Split the collection, or raise ` +
          'ContentKeyScope.maxDocumentSealedBytes deliberately, in the repo that owns the data.',
        { collection, sealedBytes: share, limitBytes: budget.maxDocumentSealedBytes },
      );
    }

    if (sum > budget.maxDocumentSealedBytes) {
      const excess = sum - budget.maxDocumentSealedBytes;
      const declaredClause =
        declaredCount === 0
          ? 'none of them declared'
          : `${declaredCount} declared, summing to ${declaredSum}, the largest being ` +
            `${largestDeclared} on ${q(largestDeclaredPath)}`;
      const derivedClause =
        derivedCount === 0
          ? `none taking the derived share, which here would be ${share} each`
          : `${derivedCount} taking the derived share of ${share} each`;
      invalid(
        `registry collection ${q(collection)} commits ${sum} sealed bytes across ${n} registered ` +
          `paths — ${declaredClause}; ${derivedClause} — which exceeds ` +
          `ContentKeyScope.maxDocumentSealedBytes (${budget.maxDocumentSealedBytes}) by ${excess}. ` +
          'Lower the declared ceilings by that much in total, drop a declaration so the path ' +
          'takes the derived share, or raise the document budget deliberately, in the repo that ' +
          'owns the data.',
        // `collection`, `sealedBytes`, `limitBytes` and no more: this detail shape is pinned by
        // `key-scope.test.ts`, and the path carrying the largest declaration is in the message,
        // where the person reading a boot-time refusal will see it.
        { collection, sealedBytes: sum, limitBytes: budget.maxDocumentSealedBytes },
      );
    }
  }
}
