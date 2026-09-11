/**
 * `blob-json.ts` — the typed-JSON serialiser under the blob codec (§8.3).
 *
 * Pure, synchronous, and it imports no crypto at all. That is not an accident of layering:
 * it is what makes this the one module in the package that can be tested exhaustively with
 * no keys, which is why the build order puts it before anything that seals bytes.
 *
 * ONE JOB. Everything except collab holds free-form `Record<string, any>`. A path registry
 * cannot enumerate a free-form map, so the walker cannot address it; the blob codec seals
 * the whole subtree instead, and this module is the reversible tagging that lets a subtree
 * become bytes and come back as itself.
 *
 * TOTAL OR LOUD. Every value either round-trips exactly or is refused with the path named.
 * There is no third behaviour, and in particular there is no coercion: a value the codec
 * cannot represent is a `BLOB_ENCODE_FAILED`, never a lossy approximation written once and
 * read for years. The Firestore `Timestamp` case is the worked example — silently coercing
 * one to a `Date` loses the `nanoseconds` field, the loss is invisible at both write time
 * and read time, and it surfaces months later as a `TypeError: value.toDate is not a
 * function` far from anything that could explain it. So `Timestamp`, `GeoPoint`,
 * `DocumentReference` and the field sentinels are all refused, and the message says which
 * adapter to register.
 *
 * WHY OUR OWN WALK RATHER THAN A `JSON.stringify` REPLACER. Two independent reasons. A
 * replacer cannot express a preserved `undefined` — it drops object keys and turns array
 * elements into `null`, which silently changes an array's length. And a replacer cannot
 * abort mid-walk on a byte budget: it runs to completion and hands back a finished string,
 * so a 60 MB payload is an out-of-memory kill rather than a `BLOB_TOO_LARGE`. The encoder
 * here emits directly to chunks with a running byte total and aborts at the first chunk
 * that crosses the ceiling. `JSON.stringify` is still used per scalar leaf, for correct
 * string escaping, which is the one piece of this that must not be hand-rolled.
 *
 * THE KIND BYTE IS INSIDE THE BUFFER (R14). `encodeBlob` returns the COMPLETE plaintext —
 * `[0x02|0x03][utf-8 JSON]` — rather than the body with the discriminator beside it. That
 * is what makes the object spill path work: an oversized blob sealed as an object body
 * carries its own kind byte, where the object envelope cannot carry one. It costs nothing;
 * the field path splits it back out with `subarray(1)`, which is a view and not a copy.
 *
 * THE PACKAGE KNOWS NOTHING ABOUT FIRESTORE. The only Firestore-shaped thing named here is
 * `firestoreTimestampAdapter`, whose `Timestamp` class is passed IN by the consumer. There
 * is no import of `firebase-admin` and there never will be.
 */

import { deflateRawSync, inflateRawSync } from 'node:zlib';

import { ContentCryptoError } from './errors';

// ---------------------------------------------------------------------------
// The declared surface (§8.2)
// ---------------------------------------------------------------------------

/**
 * The value domain the serialiser is TOTAL over. Adapters extend it at runtime, which a
 * static type cannot express, so the entry points take `unknown` and this union is the
 * documentation — and the type a product may use to constrain its own payload type at
 * compile time.
 */
export type BlobValue =
  | null | undefined | boolean | number | bigint | string | Date | Uint8Array
  | readonly BlobValue[]
  | { readonly [key: string]: BlobValue };

/**
 * The INNER serialiser version, carried as `{"v":1,…}` inside the plaintext. It exists so a
 * serialiser change is a reader branch rather than a coordinated `enc:v4` that would drag
 * every field ciphertext along with it. It is not the wire version and not the envelope
 * version.
 */
export const BLOB_SERIALISER_VERSION = 1;

/** The default per-value SEALED ceiling, measured on the emitted `enc:v3:` string. */
export const DEFAULT_MAX_SEALED_BYTES = 900_000;

/** The default nesting cap, applied on the way down and named in the refusal. */
export const DEFAULT_MAX_DEPTH = 64;

/** Every tag the encoding reserves. A single-key object whose key is one of these IS that
 *  tagged value; anything else with a leading `$` is an escaped consumer key. */
export const BUILTIN_TAGS = ['$n', '$u', '$i', '$d', '$b', '$x'] as const;

export interface BlobEncodeOptions {
  /** Deflate the JSON when it exceeds this many bytes. DEFAULT 0 = OFF (§8.7).
   *
   *  A product that sets this above zero is asserting that **no payload it seals mixes
   *  attacker-influenced text with anything secret.** Ciphertext length is visible to
   *  exactly the adversary this programme exists to defeat — someone reading the database,
   *  an export, a PITR snapshot or last night's backup — and compression makes that length
   *  a function of plaintext redundancy across the values sharing one blob. That is the
   *  shape of the CRIME/BREACH family, and mixed-provenance payloads are the normal case
   *  here rather than the exotic one. */
  readonly deflateOver?: number;
  /** DEFAULT 64. */
  readonly maxDepth?: number;
  /** The PLAINTEXT ceiling, checked DURING the walk (§8.5). Defaults to
   *  `maxPlaintextFor(DEFAULT_MAX_SEALED_BYTES)`. It bounds the JSON body — the bytes that
   *  become the GCM ciphertext minus the kind byte — which is exactly what
   *  `maxPlaintextFor` converts a sealed ceiling into. */
  readonly maxPlaintextBytes?: number;
  /** The product's adapters, from `ResolvedScope.blobAdapters`. Order is declaration order
   *  and first match wins; they run AFTER the builtins, so no adapter can shadow a `Date`,
   *  a byte array, an array or a plain map. Added because the serialiser and the
   *  free-standing `applyBlobPatch` both need the scope's adapters and neither holds a
   *  `ResolvedScope` (R13). */
  readonly adapters?: readonly BlobAdapter[];
}

export interface BlobAdapter {
  /** The tag, stable for ever, 1–32 chars, no `$`. Unique across a scope's adapters. */
  readonly t: string;
  match(value: unknown): boolean;
  /** Must return something the serialiser can itself encode. Re-walked, with a guard: an
   *  adapter whose output it would match again is BLOB_ENCODE_FAILED, naming the tag. */
  encode(value: unknown): unknown;
  decode(payload: unknown): unknown;
}

// ---------------------------------------------------------------------------
// Module-private constants
// ---------------------------------------------------------------------------

/**
 * `PAYLOAD_KIND.blobJson` and `PAYLOAD_KIND.blobDeflate`, restated as literals.
 *
 * The constants themselves live beside the wire prefixes in `field-codec.ts`, which this
 * module deliberately does not import: `blob-json.ts` is a leaf that reaches nothing but
 * `errors.ts`, and it lands three build steps before the field codec exists. Two bytes
 * repeated in one place is the cheaper of the two prices, and `blob-codec.ts` — which holds
 * both — is where the equality is asserted.
 */
const KIND_BLOB_JSON = 0x02;
const KIND_BLOB_DEFLATE = 0x03;

/**
 * The inflate output bound. NOT a content ceiling: `maxPlaintextBytes` is the ceiling, and
 * it is applied on the way IN, where the product's own configuration is in scope. This is
 * the attribution guard for the read path, which has no configuration to consult — a sealed
 * blob is authenticated, so reaching it at all needs our own key, but the bound is one
 * option on a call we are making anyway and the cost of not having it is an OOM with no
 * error attributable to the document that caused it. Set well above any plausible payload
 * so that it can never become a new refusal on old data.
 */
const MAX_INFLATE_OUTPUT_BYTES = 64 * 1024 * 1024;

/**
 * The re-walk's own depth guard. `JSON.parse` has already succeeded by the time this runs,
 * so this is not a validation of the payload — it is what stops a pathological plaintext
 * turning into an unattributable `RangeError` from our own recursion. Deliberately far
 * above `DEFAULT_MAX_DEPTH`: a reader must never refuse data a writer was allowed to write.
 */
const MAX_DECODE_DEPTH = 4_096;

/** 1–32 characters, none of them `$` — the escape character the encoding reserves. */
const ADAPTER_TAG = /^[^$]{1,32}$/;

/** Canonical base64, and nothing else. `Buffer.from` is lenient; the wire must not be. */
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

/** `toISOString()`, including the six-digit extended year at the ends of the Date range. */
const ISO_INSTANT = /^[+-]?\d{4,6}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** A decimal integer, with an optional sign and no separators — `BigInt`'s own grammar. */
const DECIMAL_INTEGER = /^-?(?:0|[1-9][0-9]*)$/;

const EMPTY_ADAPTERS: readonly BlobAdapter[] = [];

const TAG_SET: ReadonlySet<string> = new Set<string>(BUILTIN_TAGS);

// ---------------------------------------------------------------------------
// Paths, for the messages. The subPath grammar of §8.9, so a path in an error is a
// path the caller can hand straight back as a `BlobPatchOp.subPath`.
// ---------------------------------------------------------------------------

const NEEDS_QUOTING = /[.[\]`]/;

const ROOT_PATH = '';

/** What a root-level failure is called in a message. `''` is a true path and a useless word. */
const ROOT_LABEL = '<root>';

const shownPath = (path: string): string => (path === ROOT_PATH ? ROOT_LABEL : path);

function childKeyPath(path: string, key: string): string {
  const segment = key === '' || NEEDS_QUOTING.test(key) ? `\`${key.replace(/`/g, '``')}\`` : key;
  return path === ROOT_PATH ? segment : `${path}.${segment}`;
}

const childIndexPath = (path: string, index: number): string => `${path}[${index}]`;

// ---------------------------------------------------------------------------
// Ceilings
// ---------------------------------------------------------------------------

/**
 * The plaintext ceiling implied by a sealed ceiling (§8.5).
 *
 * From §7.3's arithmetic, `sealed = 49 + 4·ceil((1 + bodyBytes)/3)`, so
 * `maxPlaintextFor(limit) = max(0, 3·floor((limit − 49)/4) − 1)`. The `1 +` is the kind
 * byte, which is inside the ciphertext and therefore inside the arithmetic; what comes back
 * is the budget for the JSON body alone.
 *
 * `maxPlaintextFor(900_000) === 674_960`, which is the pinned number.
 */
export function maxPlaintextFor(maxSealedBytes: number): number {
  if (!Number.isFinite(maxSealedBytes)) return 0;
  return Math.max(0, 3 * Math.floor((maxSealedBytes - 49) / 4) - 1);
}

// ---------------------------------------------------------------------------
// Encode
// ---------------------------------------------------------------------------

interface EncodeState {
  readonly chunks: string[];
  bytes: number;
  readonly limit: number;
  readonly maxDepth: number;
  readonly adapters: readonly BlobAdapter[];
  readonly ancestors: WeakSet<object>;
}

/**
 * THE RETURN TYPE, pinned (R14): the complete blob PLAINTEXT — `[kind byte][utf-8 JSON]`,
 * or `[0x03][deflateRaw(utf-8 JSON)]` when compression fired. Byte 0 is
 * `PAYLOAD_KIND.blobJson` or `PAYLOAD_KIND.blobDeflate`.
 *
 * Returning the kind byte INSIDE the buffer rather than beside it is what fixes the spill
 * path: `sealObject(key, ref, scopePath, encodeBlob(value))` carries the discriminator into
 * the object body, where the envelope cannot carry one (§10.4). It costs nothing:
 * `encryptBlob` splits it back out with `subarray(1)`, which is a view, not a copy.
 *
 * Throws `BLOB_TOO_LARGE` from inside the walk, at the first chunk that crosses
 * `maxPlaintextBytes`, and `BLOB_ENCODE_FAILED` naming the path for anything the encoding
 * has no representation for.
 */
export function encodeBlob(value: unknown, opts?: BlobEncodeOptions): Buffer {
  const maxDepth = wholeNumber(opts?.maxDepth, DEFAULT_MAX_DEPTH, 'maxDepth', 1);
  const limit = wholeNumber(
    opts?.maxPlaintextBytes, maxPlaintextFor(DEFAULT_MAX_SEALED_BYTES), 'maxPlaintextBytes', 0,
  );
  const deflateOver = wholeNumber(opts?.deflateOver, 0, 'deflateOver', 0);
  const adapters = resolveAdapters(opts?.adapters);

  const state: EncodeState = {
    chunks: [], bytes: 0, limit, maxDepth, adapters, ancestors: new WeakSet<object>(),
  };

  emit(state, `{"v":${BLOB_SERIALISER_VERSION},"d":`, ROOT_PATH);
  encodeNode(value, ROOT_PATH, 0, state);
  emit(state, '}', ROOT_PATH);

  const json = Buffer.from(state.chunks.join(''), 'utf8');

  let kind = KIND_BLOB_JSON;
  let body = json;
  if (deflateOver > 0 && json.length > deflateOver) {
    const deflated = deflateRawSync(json);
    // If deflate did not shrink the payload it is discarded and the blob is written as
    // 0x02. A reader must not have to open a compressor to learn it saved nothing.
    if (deflated.length < json.length) {
      kind = KIND_BLOB_DEFLATE;
      body = deflated;
    }
  }

  const plaintext = Buffer.alloc(1 + body.length);
  plaintext[0] = kind;
  body.copy(plaintext, 1);
  return plaintext;
}

/**
 * Append one chunk and re-check the budget. The check is HERE, on every chunk, rather than
 * on the finished string: that is the whole of §8.5's first defence, and moving it after
 * the walk turns a 400 into an out-of-memory kill.
 */
function emit(state: EncodeState, chunk: string, path: string): void {
  state.chunks.push(chunk);
  state.bytes += Buffer.byteLength(chunk, 'utf8');
  if (state.bytes > state.limit) {
    throw new ContentCryptoError(
      'BLOB_TOO_LARGE',
      `blob exceeds its plaintext budget at "${shownPath(path)}": ${state.bytes} bytes so far, `
      + `the limit is ${state.limit}.`,
      { path: shownPath(path), plaintextBytes: state.bytes, limitBytes: state.limit },
    );
  }
}

function encodeNode(value: unknown, path: string, depth: number, state: EncodeState): void {
  if (depth > state.maxDepth) {
    throw new ContentCryptoError(
      'BLOB_ENCODE_FAILED',
      `blob value at "${shownPath(path)}" is nested ${depth} deep; the limit is `
      + `${state.maxDepth}.`,
      { path: shownPath(path), depth },
    );
  }

  if (value === undefined) {
    // Preserved in BOTH positions — as an own property and as an array element. A codec
    // that conflates absent with present-and-undefined silently changes an array's length.
    emit(state, '{"$u":0}', path);
    return;
  }
  if (value === null) {
    emit(state, 'null', path);
    return;
  }

  switch (typeof value) {
    case 'boolean':
      emit(state, value ? 'true' : 'false', path);
      return;
    case 'string':
      // `JSON.stringify` escapes lone surrogates since ES2019, so the emitted JSON is
      // always well-formed UTF-8 and the byte count is exact.
      emit(state, JSON.stringify(value), path);
      return;
    case 'number':
      emit(state, encodeNumber(value), path);
      return;
    case 'bigint':
      emit(state, `{"$i":${JSON.stringify(value.toString())}}`, path);
      return;
    case 'object':
      encodeObjectLike(value as object, path, depth, state);
      return;
    default:
      // 'function', 'symbol', and anything a future runtime adds.
      throw refuse(path, constructorNameOf(value));
  }
}

function encodeNumber(value: number): string {
  // An integer beyond 2^53 passed as a `number` stays a `number` and round-trips exactly as
  // the double it already was. Its intent was lost before the serialiser saw it, and the
  // codec is not the place to guess it back — a product needing exact large integers uses
  // `bigint`, which is tagged.
  if (Number.isFinite(value)) {
    return Object.is(value, -0) ? '{"$n":"-0"}' : JSON.stringify(value);
  }
  if (Number.isNaN(value)) return '{"$n":"NaN"}';
  return value > 0 ? '{"$n":"Infinity"}' : '{"$n":"-Infinity"}';
}

function encodeObjectLike(value: object, path: string, depth: number, state: EncodeState): void {
  // Builtins first, in this order, so that no adapter can shadow one of them.
  if (isDate(value)) {
    const time = value.getTime();
    if (Number.isNaN(time)) throw refuse(path, 'Date', 'it holds no time');
    emit(state, `{"$d":${JSON.stringify(value.toISOString())}}`, path);
    return;
  }

  if (isBytes(value)) {
    // `Buffer.from(view.buffer, …)` rather than `Buffer.from(view)`: a subarray is a view
    // over a larger ArrayBuffer, and copying the whole buffer would silently widen it.
    const bytes = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
    emit(state, `{"$b":${JSON.stringify(bytes.toString('base64'))}}`, path);
    return;
  }

  if (Array.isArray(value)) {
    enter(value, path, state);
    emit(state, '[', path);
    for (let i = 0; i < value.length; i += 1) {
      if (i > 0) emit(state, ',', path);
      // A hole reads as `undefined` and is written as one. Dense on the way out, always.
      encodeNode(value[i], childIndexPath(path, i), depth + 1, state);
    }
    emit(state, ']', path);
    state.ancestors.delete(value);
    return;
  }

  if (isBlobPlainObject(value)) {
    enter(value, path, state);
    emit(state, '{', path);
    const keys = Object.keys(value);
    for (let i = 0; i < keys.length; i += 1) {
      const key = keys[i];
      const child = childKeyPath(path, key);
      // Escape: every object key beginning with `$` gains one `$`. That reserves no
      // namespace from the consumer, which matters because `$`-prefixed keys are ordinary
      // in MongoDB-shaped and JSON-Schema-shaped data.
      const wireKey = key.charCodeAt(0) === 0x24 ? `$${key}` : key;
      emit(state, `${i > 0 ? ',' : ''}${JSON.stringify(wireKey)}:`, child);
      encodeNode((value as Record<string, unknown>)[key], child, depth + 1, state);
    }
    emit(state, '}', path);
    state.ancestors.delete(value);
    return;
  }

  // Adapters run last of the things that can succeed: after every builtin form, and before
  // the refusal. An adapter exists to give a CLASS INSTANCE an encoding; one that could
  // shadow an array or a free-form map would make the serialiser non-total over the very
  // shape it exists to carry.
  for (const adapter of state.adapters) {
    if (!adapter.match(value)) continue;
    const payload = adapter.encode(value);
    if (adapter.match(payload)) {
      throw new ContentCryptoError(
        'BLOB_ENCODE_FAILED',
        `blob adapter "${adapter.t}" at "${shownPath(path)}" encodes to a value it matches `
        + 'again, which would not terminate.',
        { path: shownPath(path), constructorName: constructorNameOf(value) },
      );
    }
    enter(value, path, state);
    emit(state, `{"$x":{"t":${JSON.stringify(adapter.t)},"v":`, path);
    encodeNode(payload, path, depth + 1, state);
    emit(state, '}}', path);
    state.ancestors.delete(value);
    return;
  }

  throw refuse(path, constructorNameOf(value));
}

/** Cycle detection over ANCESTORS, not over everything seen: a repeated reference that is
 *  not an ancestor is a legitimate DAG and encodes twice. */
function enter(value: object, path: string, state: EncodeState): void {
  if (state.ancestors.has(value)) {
    throw new ContentCryptoError(
      'BLOB_ENCODE_FAILED',
      `blob value at "${shownPath(path)}" is a circular reference.`,
      { path: shownPath(path), constructorName: constructorNameOf(value) },
    );
  }
  state.ancestors.add(value);
}

/**
 * The refusal. It carries `{ path, constructorName }` and NEVER the value — an error
 * message is a log line, and a log line holding client content is the leak this programme
 * exists to prevent.
 *
 * The `Timestamp` arm is the one tailored message, because it is the one refusal a reader
 * is most likely to meet and the fix is one line at their call site. The same refusal
 * covers `GeoPoint`, `DocumentReference` and the field sentinels; those get the general
 * message, which says the same thing without naming a class we would then have to keep in
 * step with somebody else's library.
 */
function refuse(path: string, constructorName: string, because?: string): ContentCryptoError {
  const where = shownPath(path);
  const message = constructorName === 'Timestamp'
    ? `blob value at "${where}" is a Timestamp; register `
      + 'firestoreTimestampAdapter(Timestamp) in ContentKeyScope.blobAdapters, or convert it to a '
      + 'Date or an ISO string.'
    : `blob value at "${where}" is a ${constructorName}${because ? ` — ${because}` : ''}; `
      + 'it has no encoding. Register a BlobAdapter for it in ContentKeyScope.blobAdapters, or '
      + 'convert it to a value the codec carries.';
  return new ContentCryptoError('BLOB_ENCODE_FAILED', message, { path: where, constructorName });
}

/**
 * The plain-object test INSIDE a blob — deliberately one notch looser than
 * `field-path.ts`'s `isPlainObject`, which must stay strict because it is what keeps
 * Firestore's field sentinels intact during a `mapPath`. Inside a blob there are no
 * sentinels to protect and a null-prototype map is a legitimate free-form map.
 */
function isBlobPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value) as unknown;
  // The prototype clauses come FIRST and the `constructor` clause last, which is not the
  // order the rule is usually written in. It matters: these are free-form client payloads,
  // and a map holding its own `constructor` key — ordinary in JSON-Schema-shaped data —
  // shadows the inherited one, so `value.constructor === Object` is false for an object
  // that plainly is one. Asking the prototype directly cannot be shadowed by a key. The
  // third clause is kept because it accepts a chain of plain objects, which the first two
  // do not, and refusing one of those would be a new refusal on data that already exists.
  return proto === Object.prototype || proto === null || value.constructor === Object;
}

/**
 * BRAND checks, not `instanceof`. An object whose prototype has been set to a `Date` or a
 * byte array passes `instanceof` and then throws a raw `TypeError` out of a getter — which
 * is neither total nor loud. `Object.prototype.toString` reads the built-in tag, which a
 * borrowed prototype cannot forge, so such a value falls through to the refusal and is named.
 */
const isDate = (value: object): value is Date =>
  Object.prototype.toString.call(value) === '[object Date]';

const isBytes = (value: object): value is Uint8Array =>
  Object.prototype.toString.call(value) === '[object Uint8Array]';

function constructorNameOf(value: unknown): string {
  if (value === null) return 'null';
  const t = typeof value;
  if (t === 'symbol') return 'Symbol';
  if (t === 'function') return 'Function';
  if (t !== 'object') return t;
  const proto = Object.getPrototypeOf(value as object) as { constructor?: unknown } | null;
  if (proto === null) return 'Object';
  const ctor = proto.constructor;
  return typeof ctor === 'function' && typeof ctor.name === 'string' && ctor.name !== ''
    ? ctor.name
    : 'Object';
}

// ---------------------------------------------------------------------------
// Decode
// ---------------------------------------------------------------------------

/**
 * The inverse of `encodeBlob`, over the COMPLETE plaintext. Reads byte 0 itself, so
 * `decodeBlob(openObject(...))` works unchanged on the spill path (§10.4).
 *
 * Throws `CONTENT_KIND_MISMATCH` on a byte that is neither 0x02 nor 0x03,
 * `VALIDATION_ERROR` on an empty buffer, and `CONTENT_DECRYPT_FAILED` on JSON that is not
 * `{"v":1,…}` or whose `v` is unknown — never partial output. A blob that half-parses has
 * been tampered with under our own key or corrupted by a double-seal, and neither is a case
 * to serve.
 *
 * `opts` supplies the scope's `adapters`, without which a `$x` tag has no decoder, and an
 * explicit `maxPlaintextBytes` if the caller wants the inflate bound tightened to its own
 * ceiling. Everything else on `BlobEncodeOptions` is ignored here.
 */
export function decodeBlob(plaintext: Buffer, opts?: BlobEncodeOptions): unknown {
  if (!(plaintext instanceof Uint8Array)) {
    throw new ContentCryptoError(
      'VALIDATION_ERROR', 'decodeBlob takes the complete blob plaintext as a Buffer.',
    );
  }
  if (plaintext.length < 1) {
    throw new ContentCryptoError(
      'VALIDATION_ERROR',
      'decodeBlob was given an empty buffer; a blob plaintext is at minimum its kind byte.',
    );
  }
  return decodeBlobBody(plaintext[0], Buffer.from(
    plaintext.buffer, plaintext.byteOffset + 1, plaintext.length - 1,
  ), opts);
}

/**
 * PACKAGE-INTERNAL. `blob-codec.ts` imports it; it is NOT on the barrel, for the same
 * reason `documentByteCost` is not: it takes an already-split kind and cannot check the
 * wire, so a caller reaching it from outside has skipped the one check that makes the kind
 * byte mean anything.
 *
 * `kind` is a `PayloadKind` — declared here as `number` only because `field-codec.ts`, which
 * owns that union alongside every wire prefix, lands three build steps later and this module
 * imports nothing from the package but `errors.ts`. Every `PayloadKind` is a `number`, so
 * the declared call site type-checks unchanged.
 */
export function decodeBlobBody(kind: number, body: Buffer, opts?: BlobEncodeOptions): unknown {
  let json: Buffer;
  if (kind === KIND_BLOB_JSON) {
    json = body;
  } else if (kind === KIND_BLOB_DEFLATE) {
    const bound = opts?.maxPlaintextBytes;
    try {
      json = inflateRawSync(body, {
        maxOutputLength: typeof bound === 'number' && bound > 0 ? bound : MAX_INFLATE_OUTPUT_BYTES,
      });
    } catch {
      throw corrupt('the compressed body did not inflate');
    }
  } else {
    throw new ContentCryptoError(
      'CONTENT_KIND_MISMATCH',
      `blob plaintext carries payload kind 0x${kind.toString(16).padStart(2, '0')}; a blob is `
      + '0x02 (typed JSON) or 0x03 (deflated typed JSON).',
    );
  }

  let envelope: unknown;
  try {
    envelope = JSON.parse(json.toString('utf8'));
  } catch {
    throw corrupt('the body is not JSON');
  }

  if (
    typeof envelope !== 'object' || envelope === null || Array.isArray(envelope)
    || (envelope as { v?: unknown }).v !== BLOB_SERIALISER_VERSION
    || !Object.prototype.hasOwnProperty.call(envelope, 'd')
  ) {
    throw corrupt(`the body is not {"v":${BLOB_SERIALISER_VERSION},…}`);
  }

  return decodeNode(
    (envelope as { d: unknown }).d, ROOT_PATH, 0, resolveAdapters(opts?.adapters),
  );
}

const corrupt = (why: string): ContentCryptoError => new ContentCryptoError(
  'CONTENT_DECRYPT_FAILED',
  `the opened blob is not a serialised payload: ${why}. It has been tampered with under our `
  + 'own key, or double-sealed; neither is a case to serve.',
);

function decodeNode(
  node: unknown, path: string, depth: number, adapters: readonly BlobAdapter[],
): unknown {
  if (depth > MAX_DECODE_DEPTH) throw corrupt('it is nested past any depth a writer may produce');
  if (node === null || typeof node !== 'object') return node;

  if (Array.isArray(node)) {
    const out: unknown[] = [];
    for (let i = 0; i < node.length; i += 1) {
      out.push(decodeNode(node[i], childIndexPath(path, i), depth + 1, adapters));
    }
    return out;
  }

  const keys = Object.keys(node);
  if (keys.length === 1 && TAG_SET.has(keys[0])) {
    return decodeTag(keys[0], (node as Record<string, unknown>)[keys[0]], path, depth, adapters);
  }

  // Not a tag: every key with a leading `$` loses one, and the rest are literal.
  //
  // Assigned with `Object.defineProperty`, never `out[key] = value`. A payload containing
  // `__proto__` therefore round-trips as an OWN DATA PROPERTY and cannot pollute a
  // prototype. `JSON.parse` is itself safe — it already defines rather than assigns — but
  // this re-walk is ours, and the same decoder runs over a lenient read of a pre-migration
  // plaintext map, which is not authenticated.
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    const plain = key.charCodeAt(0) === 0x24 ? key.slice(1) : key;
    if (Object.prototype.hasOwnProperty.call(out, plain)) {
      throw corrupt(`two keys collapse to "${plain}" once unescaped`);
    }
    Object.defineProperty(out, plain, {
      value: decodeNode(
        (node as Record<string, unknown>)[key], childKeyPath(path, plain), depth + 1, adapters,
      ),
      writable: true,
      enumerable: true,
      configurable: true,
    });
  }
  return out;
}

function decodeTag(
  tag: string, payload: unknown, path: string, depth: number, adapters: readonly BlobAdapter[],
): unknown {
  switch (tag) {
    case '$u':
      if (payload !== 0) throw corrupt('an undefined tag carries something other than 0');
      return undefined;
    case '$n':
      if (payload === '-0') return -0;
      if (payload === 'NaN') return NaN;
      if (payload === 'Infinity') return Infinity;
      if (payload === '-Infinity') return -Infinity;
      throw corrupt('a number tag carries an unknown label');
    case '$i':
      if (typeof payload !== 'string' || !DECIMAL_INTEGER.test(payload)) {
        throw corrupt('a bigint tag carries something that is not a decimal integer');
      }
      return BigInt(payload);
    case '$d': {
      if (typeof payload !== 'string' || !ISO_INSTANT.test(payload)) {
        throw corrupt('a date tag carries something that is not an ISO-8601 instant');
      }
      const date = new Date(payload);
      if (Number.isNaN(date.getTime())) throw corrupt('a date tag carries no representable time');
      return date;
    }
    case '$b': {
      if (typeof payload !== 'string' || payload.length % 4 !== 0 || !BASE64.test(payload)) {
        throw corrupt('a bytes tag carries something that is not canonical base64');
      }
      const bytes = Buffer.from(payload, 'base64');
      // `Buffer.from` accepts non-canonical trailing bits and drops them silently, which
      // would decode two distinct wires to the same value. Re-encode and compare.
      if (bytes.toString('base64') !== payload) {
        throw corrupt('a bytes tag carries non-canonical base64');
      }
      return bytes;
    }
    default: {
      // '$x' — the only remaining member of BUILTIN_TAGS.
      if (
        typeof payload !== 'object' || payload === null || Array.isArray(payload)
        || typeof (payload as { t?: unknown }).t !== 'string'
        || !Object.prototype.hasOwnProperty.call(payload, 'v')
      ) {
        throw corrupt('an adapter tag carries something that is not {t,v}');
      }
      const t = (payload as { t: string }).t;
      const adapter = adapters.find((candidate) => candidate.t === t);
      if (adapter === undefined) {
        throw corrupt(
          `no adapter is registered for tag "${t}". A payload is only readable by a scope `
          + 'that declares the adapters it was written with',
        );
      }
      const inner = decodeNode((payload as { v: unknown }).v, path, depth + 1, adapters);
      try {
        return adapter.decode(inner);
      } catch (err) {
        if (err instanceof ContentCryptoError) throw err;
        throw corrupt(`adapter "${t}" refused its own payload`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// The oracle
// ---------------------------------------------------------------------------

/**
 * encode → decode → deep-compare, returning false rather than throwing. For a product's own
 * tests and for a defensive pre-flight before a first write. O(2n) memory; not for a hot
 * path.
 *
 * It is an ORACLE, not a promise: it answers *"does this exact value survive?"*, and the
 * documented asymmetries (a `Uint8Array` coming back as a `Buffer`, a null-prototype map
 * coming back with `Object.prototype`, a sparse array coming back dense) make it answer
 * `false` for values that are nonetheless encoded faithfully. That is the point — callers
 * branch on it, so it must be as strict as the comparison a caller would write.
 */
export function blobRoundTrips(value: unknown, opts?: BlobEncodeOptions): boolean {
  try {
    return sameValue(value, decodeBlob(encodeBlob(value, opts), opts));
  } catch {
    return false;
  }
}

function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;

  // `constructor`, not the prototype: that is what a caller's own deep-equality check reads,
  // and the oracle is only useful if it answers the question the caller is really asking.
  if ((a as { constructor?: unknown }).constructor
    !== (b as { constructor?: unknown }).constructor) return false;

  if (isDate(a) && isDate(b)) return Object.is(a.getTime(), b.getTime());

  if (isBytes(a) && isBytes(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
    return true;
  }

  if (Array.isArray(a)) {
    const other = b as unknown[];
    if (a.length !== other.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      // Holes are unrepresentable in the encoding, so a sparse array is a documented
      // asymmetry and the oracle must say so.
      if ((i in a) !== (i in other)) return false;
      if (!sameValue(a[i], other[i])) return false;
    }
    return true;
  }

  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
    if (!sameValue((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])) {
      return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// The consumer's one adapter, supplied because it is the one everybody needs
// ---------------------------------------------------------------------------

/**
 * The ONE place the identifier `Timestamp` appears in this tree — as a parameter name. The
 * class is passed IN; the package imports firebase-admin nowhere, and this function is what
 * lets it stay that way while a product's timestamps still survive a round trip with their
 * nanoseconds intact.
 *
 * ```ts
 * import { Timestamp } from 'firebase-admin/firestore';
 * blobAdapters: [firestoreTimestampAdapter(Timestamp)],
 * // on the wire: {"$x":{"t":"ts","v":{"s":1789056306,"n":7000000}}}
 * ```
 */
export function firestoreTimestampAdapter(
  Timestamp: { new (s: number, n: number): unknown; prototype: object },
): BlobAdapter {
  const proto = Timestamp.prototype;
  return {
    t: 'ts',
    match(value: unknown): boolean {
      return typeof value === 'object' && value !== null
        && Object.prototype.isPrototypeOf.call(proto, value);
    },
    encode(value: unknown): unknown {
      const stamp = value as { seconds: number; nanoseconds: number };
      return { s: stamp.seconds, n: stamp.nanoseconds };
    },
    decode(payload: unknown): unknown {
      const parts = payload as { s?: unknown; n?: unknown } | null;
      if (
        typeof parts !== 'object' || parts === null
        || typeof parts.s !== 'number' || typeof parts.n !== 'number'
      ) {
        throw corrupt('a timestamp payload is not {s,n}');
      }
      return new Timestamp(parts.s, parts.n);
    },
  };
}

// ---------------------------------------------------------------------------
// The per-document budget's measuring stick (§8.6)
// ---------------------------------------------------------------------------

/**
 * PACKAGE-INTERNAL; `doc-codec.ts` imports it. NOT on the barrel (R15).
 *
 * A conservative approximation of Firestore's own document-size rule: 32 bytes of overhead,
 * plus the document path, plus for each field the UTF-8 name + 1 and the value's size.
 * Deliberately approximate and deliberately conservative: the job is to fail at ~1 MB with a
 * legible message, not to reimplement somebody else's accounting. Their limit remains the
 * real one.
 *
 * The document path is the caller's to add — this function is handed the field map and has
 * no way to know it. Total by construction: it never throws, because a size estimate that
 * can fail is a size estimate nobody dares call.
 */
export function documentByteCost(data: unknown): number {
  return 32 + valueByteCost(data, new WeakSet<object>());
}

function valueByteCost(value: unknown, seen: WeakSet<object>): number {
  if (value === undefined) return 0;
  if (value === null) return 1;

  switch (typeof value) {
    case 'boolean': return 1;
    case 'number': return 8;
    case 'bigint': return 8;
    case 'string': return Buffer.byteLength(value, 'utf8') + 1;
    case 'object': break;
    default: return 8;
  }

  const object = value as object;
  if (seen.has(object)) return 0;

  if (object instanceof Date) return 8;
  if (object instanceof Uint8Array) return object.byteLength;

  seen.add(object);
  let total = 0;
  if (Array.isArray(object)) {
    for (let i = 0; i < object.length; i += 1) total += valueByteCost(object[i], seen);
  } else {
    for (const key of Object.keys(object)) {
      total += Buffer.byteLength(key, 'utf8') + 1
        + valueByteCost((object as Record<string, unknown>)[key], seen);
    }
  }
  seen.delete(object);
  return total;
}

// ---------------------------------------------------------------------------
// Option validation
// ---------------------------------------------------------------------------

function wholeNumber(
  given: number | undefined, fallback: number, name: string, minimum: number,
): number {
  if (given === undefined) return fallback;
  if (!Number.isInteger(given) || given < minimum) {
    throw new ContentCryptoError(
      'VALIDATION_ERROR',
      `BlobEncodeOptions.${name} must be a whole number of at least ${minimum}.`,
    );
  }
  return given;
}

function resolveAdapters(adapters: readonly BlobAdapter[] | undefined): readonly BlobAdapter[] {
  if (adapters === undefined || adapters.length === 0) return EMPTY_ADAPTERS;
  const seen = new Set<string>();
  for (const adapter of adapters) {
    if (
      typeof adapter !== 'object' || adapter === null
      || typeof adapter.match !== 'function' || typeof adapter.encode !== 'function'
      || typeof adapter.decode !== 'function'
    ) {
      throw new ContentCryptoError(
        'VALIDATION_ERROR', 'a BlobAdapter must supply t, match, encode and decode.',
      );
    }
    if (typeof adapter.t !== 'string' || !ADAPTER_TAG.test(adapter.t)) {
      throw new ContentCryptoError(
        'VALIDATION_ERROR',
        'a BlobAdapter tag is 1 to 32 characters and may not contain "$", which is the '
        + 'escape character the encoding reserves.',
      );
    }
    if (seen.has(adapter.t)) {
      throw new ContentCryptoError(
        'VALIDATION_ERROR',
        `two BlobAdapters share the tag "${adapter.t}"; a tag is what a stored payload names, `
        + 'so it must resolve to exactly one decoder.',
      );
    }
    seen.add(adapter.t);
  }
  return adapters;
}
