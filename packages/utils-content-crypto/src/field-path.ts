/**
 * The field-path grammar and its walker — collab's `lib/content-fields.ts` path layer,
 * generalised into the package, plus the four additions the blob codec needs.
 *
 * Two grammars live here and they are deliberately different, because they address
 * different things:
 *
 * **The registered field path** (`a.b[].c`) addresses a shape the registry knows. Its
 * segments are keys, `[]` means *every element of this array*, and the whole path is a
 * label as much as an address: the AAD is built from the path exactly as registered, `[]`
 * retained and no index, which is what lets every element of an array share one AAD and so
 * what lets `arrayUnion` write a single sealed element.
 *
 *     body                    a top-level string
 *     anchor.quote            a string inside a nested object
 *     declinedProposals[]     every string element of an array
 *     attachments[].filename  a string inside every element of an array of objects
 *
 * **The blob subPath** (§8.9) addresses a position inside decoded, free-form data, where
 * two things hold that do not hold of a field path: a key may contain a dot, and an array
 * is addressed by a specific index rather than by "every element". A different grammar, and
 * its own parser. Backtick is its quote character, and that is not arbitrary — the registry
 * forbids a backtick in any registered path segment (§5.4 validation 9) precisely so this
 * grammar has an escape character it can never collide with.
 *
 * Everything in this module is pure, synchronous and total-or-loud. There is no crypto
 * here, no key material, and no I/O; the only thing it can throw is `BLOB_SUBPATH_INVALID`
 * against a malformed subPath. It is a leaf: `errors.ts` is the one package module it
 * imports.
 */

import { ContentCryptoError } from './errors';

// ───────────────────────────── the registered field path ─────────────────────────────

/** One parsed segment of a registered path. */
export interface PathSegment {
  readonly key: string;
  /** True for `key[]`: descend into every element. */
  readonly array: boolean;
}

/** `attachments[].filename` → `[{key:'attachments',array:true},{key:'filename',array:false}]`. */
export function parseFieldPath(fieldPath: string): PathSegment[] {
  return fieldPath.split('.').map((seg) => {
    const array = seg.endsWith('[]');
    return { key: array ? seg.slice(0, -2) : seg, array };
  });
}

/** Render segments back to the registered form, from `from` (inclusive) onward. */
export function formatFieldPath(segments: readonly PathSegment[], from = 0): string {
  return segments
    .slice(from)
    .map((s) => (s.array ? `${s.key}[]` : s.key))
    .join('.');
}

/**
 * `constructor === Object`, STRICT — and that strictness is the whole point. A Firestore
 * `FieldValue` sentinel, a `Timestamp`, a `GeoPoint`, a `Date`, a class instance and a
 * null-prototype object are all *not* plain objects here, so a walk steps over them and
 * returns them by reference rather than reaching inside and rebuilding them as bare data.
 * Widening this predicate is how a sentinel silently becomes `{}` on its way to a write.
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value) && (value as object).constructor === Object;
}

/**
 * Apply `fn` to every **string** found at `segments` under `value`, returning a new value
 * with copies made only along the touched path. Anything that is not a plain object /
 * array / string where one is expected is returned as it is (nulls, sentinels such as
 * `FieldValue`, wrong types, missing keys).
 *
 * The `typeof value === 'string'` leaf filter is NOT widened, ever. Structural sharing, the
 * `next === inner` short-circuit and sentinels surviving a walk all ride on it; the blob
 * codec gets `mapPathNode` — a separate function with its own tests — instead.
 *
 * ONE DELIBERATE DIFFERENCE FROM COLLAB'S DEPLOYED WALKER, and the only one: collab writes
 * the array arm as `inner.map(...)`, and `Array.prototype.map` **always** allocates, so a
 * path with a `[]` segment rebuilt the array and its parent even when the transform
 * changed nothing. §13.1 states the contract as "returns the *input identity* when nothing
 * under it changed", and §8.8 promises a document "comes back **by reference**" — neither
 * is true through an array segment unless the arm keeps the input array when every element
 * came back identical. So it does. Structurally the output is unchanged either way, which
 * is why collab's suite never saw it.
 */
export function mapPath(value: unknown, segments: readonly PathSegment[], fn: (s: string) => string): unknown {
  if (segments.length === 0) return typeof value === 'string' ? fn(value) : value;
  const [head, ...rest] = segments;
  if (!isPlainObject(value) || !(head.key in value)) return value;
  const inner = value[head.key];
  let next: unknown;
  if (head.array) {
    next = Array.isArray(inner) ? mapElements(inner, (el) => mapPath(el, rest, fn)) : inner;
  } else {
    next = mapPath(inner, rest, fn);
  }
  if (next === inner) return value;
  return { ...value, [head.key]: next };
}

/** Map an array's elements, returning the INPUT array when every element came back identical. */
function mapElements(input: readonly unknown[], fn: (el: unknown) => unknown): readonly unknown[] {
  let changed = false;
  const out = input.map((el) => {
    const next = fn(el);
    if (next !== el) changed = true;
    return next;
  });
  return changed ? out : input;
}

/**
 * `mapPath`'s walk with the **node** as the leaf: `fn` receives whatever sits at the path —
 * an object, an array, `null`, a sentinel — and whatever it returns is written there. The
 * blob codec's leaf, and the only difference from `mapPath`.
 *
 * The reach is identical, which matters: a **missing** key is still never visited (there is
 * nothing at the path to seal, and inventing one would write a blob nobody asked for), the
 * copy is still made only along the touched path, and returning the node you were given
 * still yields the input by reference. Deciding what to do with `null`, `undefined`, a
 * sentinel or a bare scalar at a blob path is the caller's (§8.8), not the walker's.
 */
export function mapPathNode(value: unknown, segments: readonly PathSegment[], fn: (node: unknown) => unknown): unknown {
  if (segments.length === 0) return fn(value);
  const [head, ...rest] = segments;
  if (!isPlainObject(value) || !(head.key in value)) return value;
  const inner = value[head.key];
  let next: unknown;
  if (head.array) {
    next = Array.isArray(inner) ? mapElements(inner, (el) => mapPathNode(el, rest, fn)) : inner;
  } else {
    next = mapPathNode(inner, rest, fn);
  }
  if (next === inner) return value;
  return { ...value, [head.key]: next };
}

/**
 * Read the node at a parsed path without mapping it — collab's `getAt`, generalised.
 * Total: anything absent, or reached through a non-object, is `undefined`.
 *
 * **Array flags are read as keys, not as wildcards.** `nodeAt` is not a wildcard reader and
 * never returns a list of leaves; a trailing `array: true` segment yields **the array
 * itself**, which is exactly `planDoc`'s read-back (an array path is written whole from its
 * array segment, so the value it writes is that array) and exactly what `openBlobAt` needs
 * (a blob path may never carry `[]` at all, §5.4).
 */
export function nodeAt(value: unknown, segments: readonly PathSegment[]): unknown {
  let cur: unknown = value;
  for (const seg of segments) {
    if (!cur || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[seg.key];
  }
  return cur;
}

// ───────────────────────────── Firestore update keys ─────────────────────────────

/** How a Firestore update key sits on a registered path (see `matchUpdateKey`). */
export interface UpdateKeyMatch {
  /** The registered path this key matched, whole — the caller's label for the AAD. */
  readonly segments: readonly PathSegment[];
  /** The remainder addressed inside the update value. */
  readonly rest: readonly PathSegment[];
  /**
   * True when the update value **is the array itself** and `rest` applies to each element.
   *
   * This field is not in §5.5's declaration and is kept deliberately: without it `rest` is
   * ambiguous, because `attachments` and `attachments.0` both match
   * `attachments[].filename` with `rest: [filename]` and only one of the two hands
   * `mapUpdateValue` an array. It is additive — a consumer written against
   * `{ segments, rest }` compiles unchanged — and it is what collab's deployed walker
   * carries. See the module note in `field-path.test.ts`.
   */
  readonly elements: boolean;
}

/**
 * Match a dotted Firestore update key against a registered path. Returns how to walk the
 * update value, or `null` when the key is not on this path. A numeric key segment stands
 * for one element of an array segment (`attachments.0.filename` matches
 * `attachments[].filename`).
 *
 *     key 'anchor.quote'      path anchor.quote          → { rest: [],         elements: false }  value is the string
 *     key 'anchor'            path anchor.quote          → { rest: [quote],    elements: false }  value is the object
 *     key 'declinedProposals' path declinedProposals[]   → { rest: [],         elements: true }   value is the array
 *     key 'attachments.0'     path attachments[].filename → { rest: [filename], elements: false }
 */
export function matchUpdateKey(key: string, segments: readonly PathSegment[]): UpdateKeyMatch | null {
  const keyParts = key.split('.');
  let i = 0; // registered segment index
  let j = 0; // key part index
  while (j < keyParts.length) {
    if (i >= segments.length) return null; // the key is deeper than the registered path
    const seg = segments[i];
    if (keyParts[j] !== seg.key) return null;
    j += 1;
    i += 1;
    if (seg.array) {
      if (j < keyParts.length && /^\d+$/.test(keyParts[j])) {
        j += 1; // one element addressed by index: the walk continues inside it
        continue;
      }
      if (j < keyParts.length) return null; // a non-numeric part under an array segment is not on the path
      return { segments, rest: segments.slice(i), elements: true };
    }
  }
  return { segments, rest: segments.slice(i), elements: false };
}

/** Apply `fn` to the strings at `match` inside one Firestore update value. */
export function mapUpdateValue(value: unknown, match: UpdateKeyMatch, fn: (s: string) => string): unknown {
  if (match.elements) {
    return Array.isArray(value) ? value.map((el) => mapPath(el, match.rest, fn)) : value;
  }
  return mapPath(value, match.rest, fn);
}

// ───────────────────────────── update keys against a blob ─────────────────────────────

/** How a Firestore update key sits relative to a registered blob path (§8.10). */
export type BlobKeyRelation = 'unrelated' | 'exact' | 'inside' | 'contains';

/**
 * Where a dotted update key sits relative to a registered blob path. Compared segment by
 * segment, never as a string prefix, so `pay` is `unrelated` to `payload`.
 *
 * | relation | blob path `payload` | what `planUpdate` does |
 * |---|---|---|
 * | `unrelated` | `status` | pass through untouched |
 * | `exact` | `payload` | seal the new value whole |
 * | `contains` | (blob path `a.b`, key `a`) | seal the blob **within** the update value, in place |
 * | `inside` | `payload.checkins` | emit a `BlobResealRequest` — read, modify, write |
 *
 * A blob path may never carry a `[]` segment (§5.4 validation), so array flags cannot
 * arise here and are read as ordinary keys if a caller manufactures one.
 *
 * **The inherited ambiguity, documented here rather than papered over:** a numeric-looking
 * object key inside a blob cannot be addressed through a Firestore-shaped update key —
 * `{"0": …}` and `[…]` produce the same dotted key. A product needing one writes the whole
 * blob, or builds the `BlobPatchOp` itself with a backtick-quoted key: `` `0`.name ``. The
 * ambiguity is Firestore's own, so it is inherited rather than invented.
 */
export function blobKeyRelation(key: string, blobSegments: readonly PathSegment[]): BlobKeyRelation {
  const keyParts = key.split('.');
  const shared = Math.min(keyParts.length, blobSegments.length);
  for (let i = 0; i < shared; i += 1) {
    if (keyParts[i] !== blobSegments[i].key) return 'unrelated';
  }
  if (keyParts.length === blobSegments.length) return 'exact';
  return keyParts.length > blobSegments.length ? 'inside' : 'contains';
}

// ───────────────────────────── the blob subPath grammar ─────────────────────────────

/**
 * One parsed segment of a blob subPath: a key, or an array index. Free-form data has no
 * registry to consult, so an index addresses one element and never "every element".
 */
export type SubPathSegment = { readonly key: string } | { readonly index: number };

/**
 * The grammar (§8.9, as corrected):
 *
 *     subPath   := head tail*                        ;  MUST be non-empty
 *     head      := segment | index
 *     tail      := '.' segment | index
 *     segment   := bare | quoted
 *     bare      := [^ . [ ] ` ]+                     ;  one or more chars, none of . [ ] `
 *     quoted    := '`' ( [^`] | '``' )* '`'          ;  '``' is one literal backtick
 *     index     := '[' ( '0' | [1-9][0-9]{0,6} ) ']' ;  0 … 9 999 999, no sign, no leading zero
 */
const MAX_SUBPATH_INDEX = 9_999_999;
const BARE_SEGMENT = /^[^.[\]`]+$/;
const INDEX_DIGITS = /^(?:0|[1-9][0-9]{0,6})$/;

function invalidSubPath(subPath: string, why: string): ContentCryptoError {
  return new ContentCryptoError('BLOB_SUBPATH_INVALID', `The blob subPath "${subPath}" is not valid: ${why}.`, {
    subPath,
  });
}

/**
 * Parse a blob subPath. Throws `BLOB_SUBPATH_INVALID` — the subPath is the only thing that
 * reaches the error, and it is a safe detail key.
 *
 *     loopbackItems         → [{key:'loopbackItems'}]
 *     checkins[3].status    → [{key:'checkins'},{index:3},{key:'status'}]
 *     `a.b`.c               → [{key:'a.b'},{key:'c'}]
 *     [0].name              → [{index:0},{key:'name'}]   a blob root may be an array
 *
 * Depth is **not** capped here: `maxDepth` is the scope's, and the scope is not in this
 * leaf's reach. `applyBlobPatch` measures the resulting document against it (§8.9).
 */
export function parseSubPath(subPath: string): readonly SubPathSegment[] {
  if (typeof subPath !== 'string' || subPath.length === 0) {
    throw invalidSubPath(String(subPath ?? ''), 'it is empty, and replacing the whole payload is `encryptBlob`, not a patch');
  }
  const out: SubPathSegment[] = [];
  let i = 0;
  let first = true;
  while (i < subPath.length) {
    const ch = subPath[i];
    if (ch === '[') {
      i = readIndex(subPath, i, out);
    } else if (first) {
      i = readSegment(subPath, i, out);
    } else if (ch === '.') {
      if (i + 1 >= subPath.length) throw invalidSubPath(subPath, 'it ends with a "."');
      i = readSegment(subPath, i + 1, out);
    } else {
      throw invalidSubPath(subPath, `an unexpected "${ch}" at position ${i}`);
    }
    first = false;
  }
  return out;
}

/** Read one `[n]` starting at `i` (which is the `[`); pushes the segment, returns the next index. */
function readIndex(subPath: string, i: number, out: SubPathSegment[]): number {
  const close = subPath.indexOf(']', i + 1);
  if (close < 0) throw invalidSubPath(subPath, `an unclosed "[" at position ${i}`);
  const digits = subPath.slice(i + 1, close);
  if (!INDEX_DIGITS.test(digits)) {
    throw invalidSubPath(
      subPath,
      `"[${digits}]" at position ${i} is not an index — 0 to ${MAX_SUBPATH_INDEX}, no sign and no leading zero`,
    );
  }
  out.push({ index: Number(digits) });
  return close + 1;
}

/** Read one bare or backtick-quoted segment starting at `i`; pushes it, returns the next index. */
function readSegment(subPath: string, i: number, out: SubPathSegment[]): number {
  if (subPath[i] === '`') {
    let key = '';
    let j = i + 1;
    for (;;) {
      if (j >= subPath.length) throw invalidSubPath(subPath, `an unterminated quoted segment at position ${i}`);
      if (subPath[j] === '`') {
        if (subPath[j + 1] === '`') {
          key += '`';
          j += 2;
          continue;
        }
        out.push({ key });
        return j + 1;
      }
      key += subPath[j];
      j += 1;
    }
  }
  let j = i;
  while (j < subPath.length && !'.[]`'.includes(subPath[j])) j += 1;
  if (j === i) throw invalidSubPath(subPath, `an empty segment at position ${i}`);
  out.push({ key: subPath.slice(i, j) });
  return j;
}

/**
 * Render segments back to a subPath, quoting any key the bare production cannot carry.
 * `parseSubPath(formatSubPath(segments))` is the identity on segments; the other direction
 * is not, and is not meant to be — `` `a` `` formats as `a`, which is the same address.
 *
 * Loud rather than lossy: an index that is not an integer in range, or a non-string key,
 * throws `BLOB_SUBPATH_INVALID` rather than emitting a subPath that will not parse.
 */
export function formatSubPath(segments: readonly SubPathSegment[]): string {
  if (segments.length === 0) {
    throw invalidSubPath('', 'a subPath must have at least one segment');
  }
  let out = '';
  segments.forEach((seg, at) => {
    if ('index' in seg) {
      const n = seg.index;
      if (!Number.isInteger(n) || n < 0 || n > MAX_SUBPATH_INDEX) {
        throw invalidSubPath(out, `segment ${at} is not an index in 0…${MAX_SUBPATH_INDEX}`);
      }
      out += `[${n}]`;
      return;
    }
    if (typeof seg.key !== 'string') throw invalidSubPath(out, `segment ${at} has no string key`);
    const rendered = BARE_SEGMENT.test(seg.key) ? seg.key : `\`${seg.key.replace(/`/g, '``')}\``;
    out += at === 0 ? rendered : `.${rendered}`;
  });
  return out;
}
