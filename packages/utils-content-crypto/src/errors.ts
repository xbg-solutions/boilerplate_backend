/**
 * The error taxonomy, and the boundary that keeps key material out of everything the
 * package emits. Spec §11.6.
 *
 * THIS MODULE IMPORTS NOTHING. Not a package module, not a node: builtin. Everything else
 * in the tree imports it — `secret.ts` throws `KEY_MATERIAL_DESTROYED` from the accessor,
 * which is why the dependency runs errors → secret and never the other way. That is also
 * why rule 1 below detects a key handle STRUCTURALLY rather than calling `isSecret`:
 * importing `secret.ts` here would be a cycle through the one module whose whole purpose is
 * to be unreachable. The structural check is a better message, not the guarantee — rule 3
 * rejects every object, key handles included, and that is the guarantee.
 *
 * Two properties this file exists to hold, both of which have to be true by construction
 * rather than by discipline:
 *
 *   1. A `ContentCryptoError` NEVER carries a `cause`. Not as a constructor argument, not
 *      on `toJSON`. From Phase C the DEK arrives as the body of an HTTP response, and an
 *      upstream library's message can quote that body verbatim (§11.3: `Response.json()`
 *      on a non-JSON body puts the first ten characters of it in a `SyntaxError`'s
 *      message). A `cause` chain is the mechanism by which such a message reaches a log
 *      through an error we authored — every structured logger and every error serialiser
 *      walks it. So there is no chain to walk.
 *
 *   2. `details` is a CLOSED key set of scalars, scanned at construction and then frozen.
 *      The closed set is the actual guarantee. `assertNoSecrets`'s shape rules are a
 *      backstop for the day somebody widens the set without thinking, and §11.6 is candid
 *      that they cannot catch a fragment of a key embedded in a longer string.
 *
 * What is deliberately NOT defended is written down in §11.6.2: a determined caller in the
 * same process, the heap, and the DEK's transport representation.
 *
 * ── TWO CHECKS, TWO THREAT MODELS ────────────────────────────────────────────────────────
 *
 * `assertNoSecrets` is an ERROR-DETAILS assertion: a flat bag, a closed key set, scalars
 * only. Handing it a structured payload — an audit entry, a patch — is a category error, and
 * widening `SAFE_DETAIL_KEYS` so that it fits defeats the thing the closed set exists to do.
 *
 * `assertNoKeyMaterial` is the other check: RECURSIVE and VALUE-LEVEL, over a whole tree,
 * asking only "does anything in here look like key bytes". It says nothing about which keys
 * a payload may carry — that is not its question — and it is NOT a second entry point for
 * audit-shaped values into the details boundary. Use the first on `details`; use the second
 * on everything else the package hands back that somebody will log.
 */

// ---------------------------------------------------------------------------
// The taxonomy
// ---------------------------------------------------------------------------

/**
 * Every failure this package can raise, and nothing else. The comment on each is the HTTP
 * status `HTTP_STATUS_FOR_CODE` maps it to, which is what a product's error middleware
 * turns into a response.
 *
 * **The taxonomy is CLOSED to ad-hoc codes, and extended deliberately.** No call site may
 * invent a code to describe its own situation more finely; that is how a closed set becomes
 * a vocabulary nobody can switch on. But a taxonomy with no category for a failure mode that
 * really happens is not closed, it is incomplete — and the honest fix is to add the category,
 * name it for what failed, and write down what distinguishes it. `CONTENT_ENCRYPT_FAILED`
 * was added that way: the streaming seal in `cipher.ts` was reporting `VALIDATION_ERROR`,
 * which sent a debugger to inspect input that was never the problem.
 */
export type ContentCryptoCode =
  | 'CONTENT_DECRYPT_FAILED'                  // 500 — corrupt, tampered, or a ciphertext moved
  | 'CONTENT_ENCRYPT_FAILED'                  // 500 — the SEAL failed; nothing invalid was supplied
  | 'CONTENT_KIND_MISMATCH'                   // 500 — opened a blob as a string, or a wrap as content
  | 'CONTENT_PLAINTEXT_AT_REGISTERED_PATH'    // 500 — strict reads; the store is not fully encrypted
  | 'WRONG_KEY_LAYER'                         // 500 — a v1/v2 value reached the v3 reader, or vice versa
  | 'RECORD_KEY_UNWRAP_FAILED'                // 500 — the wrap does not verify under that DEK/AAD
  | 'NO_WRAP_FOR_ACCOUNT'                     // 403 — ROUTINE under federation, not exceptional
  | 'BLOB_ENCODE_FAILED'                      // 500 — an unserialisable value, path named
  | 'BLOB_ALREADY_SEALED'                     // 500 — re-sealing would produce a double envelope
  | 'BLOB_TOO_LARGE'                          // 400 — plaintextBytes, sealedBytes, limitBytes
  | 'BLOB_PARTIAL_UPDATE'                     // 400 — a dotted key reaching inside a sealed subtree
  | 'BLOB_SUBPATH_INVALID'                    // 400 — the subPath grammar (§8.9)
  | 'DOCUMENT_TOO_LARGE'                      // 400 — the per-document budget, with a breakdown
  | 'ACCOUNT_KEY_NOT_FOUND'                   // 404
  | 'ACCOUNT_KEY_REVOKED'                     // 409 — reversible
  | 'ACCOUNT_KEY_DESTROYED'                   // 409 — irreversible, or the generation was drained
  | 'ACCOUNT_KEY_NOT_REVOKED'                 // 409 — planDestroy's refusal (rule 1)
  | 'ACCOUNT_KEY_NOT_DESTROYED'               // 409 — planRegenerate's refusal
  | 'ACCOUNT_KEY_CAUSE_HOLDS'                 // 409 — planRestore's refusal (rule 8)
  | 'ROTATION_IN_PROGRESS'                    // 409 — planBeginRotation's refusal (rule 9)
  | 'KEY_STORE_CONFLICT'                      // 409 — a patch's precondition no longer holds
  | 'KEY_SOURCE_UNAVAILABLE'                  // 503 — the custodian could not be reached at all
  | 'KEY_MATERIAL_DESTROYED'                  // 500 — a closed session or zeroised handle was used
  | 'VALIDATION_ERROR';                       // 400 — a programming error in the caller

/**
 * `CONTENT_ENCRYPT_FAILED` vs `VALIDATION_ERROR`, in one line: the first says the seal itself
 * failed with nothing wrong at the call site, the second says the caller supplied something
 * this package will not accept — so the first sends a debugger to the cipher and the stream,
 * and the second sends them to their own arguments.
 *
 * It is the encrypt-side mirror of `CONTENT_DECRYPT_FAILED` and carries the same 500: a body
 * that could not be sealed was never written, and no partial envelope may be stored for it.
 */

/**
 * Total over the union, enforced by the `Record` annotation: a code added above without a
 * status here is a compile error, and a status here for a code that no longer exists is
 * one too. The runtime keys are also the only enumeration of the union that exists, which
 * is what `errors.test.ts` asserts as an equality.
 */
export const HTTP_STATUS_FOR_CODE: Readonly<Record<ContentCryptoCode, number>> = Object.freeze({
  CONTENT_DECRYPT_FAILED: 500,
  CONTENT_ENCRYPT_FAILED: 500,
  CONTENT_KIND_MISMATCH: 500,
  CONTENT_PLAINTEXT_AT_REGISTERED_PATH: 500,
  WRONG_KEY_LAYER: 500,
  RECORD_KEY_UNWRAP_FAILED: 500,
  NO_WRAP_FOR_ACCOUNT: 403,
  BLOB_ENCODE_FAILED: 500,
  BLOB_ALREADY_SEALED: 500,
  BLOB_TOO_LARGE: 400,
  BLOB_PARTIAL_UPDATE: 400,
  BLOB_SUBPATH_INVALID: 400,
  DOCUMENT_TOO_LARGE: 400,
  ACCOUNT_KEY_NOT_FOUND: 404,
  ACCOUNT_KEY_REVOKED: 409,
  ACCOUNT_KEY_DESTROYED: 409,
  ACCOUNT_KEY_NOT_REVOKED: 409,
  ACCOUNT_KEY_NOT_DESTROYED: 409,
  ACCOUNT_KEY_CAUSE_HOLDS: 409,
  ROTATION_IN_PROGRESS: 409,
  KEY_STORE_CONFLICT: 409,
  KEY_SOURCE_UNAVAILABLE: 503,
  KEY_MATERIAL_DESTROYED: 500,
  VALIDATION_ERROR: 400,
});

// ---------------------------------------------------------------------------
// The closed detail-key set
// ---------------------------------------------------------------------------

/**
 * The CLOSED set of detail keys. This — not the shape heuristic — is the actual guarantee.
 *
 * Every one of these is either a path component, a tenancy identifier, a byte count or a
 * label from a closed vocabulary. None of them is ever a value read out of client content,
 * and none of them is ever derived from key bytes. Widening this list is a decision about
 * the leak boundary, which is why it is a literal here rather than an open `string` key.
 */
export const SAFE_DETAIL_KEYS = Object.freeze([
  'path', 'scopePath', 'collection', 'docId', 'fieldPath', 'subPath',
  'accountId', 'productId', 'generation', 'recordType', 'recordId',
  'code', 'status', 'sealedBytes', 'plaintextBytes', 'limitBytes', 'depth', 'constructorName',
] as const);

/** A detail value is a scalar. Not an object, not an array, and never `undefined` (§B2). */
export type ErrorDetail = string | number | boolean | null;

/** The only shape a `ContentCryptoError`, a `GraceInfo` or an audit payload may carry. */
export type ErrorDetails = Readonly<Partial<Record<(typeof SAFE_DETAIL_KEYS)[number], ErrorDetail>>>;

const SAFE_DETAIL_KEY_SET: ReadonlySet<string> = new Set<string>(SAFE_DETAIL_KEYS);

// ---------------------------------------------------------------------------
// The error
// ---------------------------------------------------------------------------

/**
 * The one error type the package throws.
 *
 * NO `cause`, ever — not on the constructor and not on `toJSON` (§11.3). `'cause' in err`
 * is `false` and a test asserts it. If you are tempted to add one to keep an upstream
 * failure for debugging: that upstream failure is exactly the object whose message may
 * quote the plaintext DEK. Classify it into a code instead, which is what
 * `custodian-cache.ts` does with `GraceReason`.
 */
export class ContentCryptoError extends Error {
  readonly code: ContentCryptoCode;

  /** Derived from `code` through `HTTP_STATUS_FOR_CODE`, so the two can never disagree. */
  readonly status: number;

  /** Scanned by `assertNoSecrets`, copied, and frozen. Never the caller's own object. */
  readonly details: ErrorDetails;

  constructor(code: ContentCryptoCode, message: string, details?: ErrorDetails) {
    super(message);

    // `name` rather than the class name, because the class name does not survive
    // minification and this string reaches logs.
    this.name = 'ContentCryptoError';

    // A JS caller — a product's plain-JavaScript job, a test fixture — can hand over
    // anything. An unknown code would otherwise leave `status` undefined and produce a
    // 500-shaped hole at the middleware. The offending value goes into `details.code`,
    // where it is SCANNED, rather than into the message, where it would not be.
    if (!Object.prototype.hasOwnProperty.call(HTTP_STATUS_FOR_CODE, code)) {
      throw new ContentCryptoError(
        'VALIDATION_ERROR',
        'unknown ContentCryptoCode; see details.code',
        { code: String(code) },
      );
    }

    // Copy BEFORE scanning, and store the copy: scanning the caller's object and then
    // keeping a reference to it would let a later mutation put a secret into an error that
    // has already passed the boundary.
    const copied = copyDetails(details);
    assertNoSecrets(copied);
    this.details = Object.freeze(copied);

    this.code = code;
    this.status = HTTP_STATUS_FOR_CODE[code];

    // Drop this constructor from the trace so the throw site is the first frame. Guarded
    // because it is V8-specific and the package makes no promises about other runtimes.
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, ContentCryptoError);
    }
  }

  /**
   * Exactly three fields. Not `name`, not `stack`, and — the point of the whole file — not
   * `cause`. A logger that serialises this object gets the code, our own fixed message and
   * a closed set of scalars.
   */
  toJSON(): { code: ContentCryptoCode; message: string; details: ErrorDetails } {
    return { code: this.code, message: this.message, details: this.details };
  }
}

// ---------------------------------------------------------------------------
// Predicates
// ---------------------------------------------------------------------------

/**
 * `instanceof` first, then a structural fallback.
 *
 * The fallback is not defensive programming for its own sake: this package ships as
 * `packages/utils-content-crypto` AND as a byte-identical mirror under
 * `functions/src/utilities/content-crypto`, so one process can hold two copies of this
 * class with two prototypes. An `instanceof`-only predicate would then quietly answer
 * `false` for an error the other copy threw, and `openRecordSafe` would rethrow a
 * `NO_WRAP_FOR_ACCOUNT` it was supposed to swallow. The fallback demands an `Error` whose
 * `name` is ours, whose `code` is a key of the status table and whose `status` agrees with
 * it — which a foreign error does not accidentally satisfy.
 */
export function isContentCryptoError(err: unknown, code?: ContentCryptoCode): err is ContentCryptoError {
  if (!isOurError(err)) return false;
  return code === undefined || err.code === code;
}

function isOurError(err: unknown): err is ContentCryptoError {
  if (err instanceof ContentCryptoError) return true;
  if (!(err instanceof Error)) return false;
  const candidate = err as Partial<ContentCryptoError>;
  if (err.name !== 'ContentCryptoError') return false;
  if (typeof candidate.code !== 'string') return false;
  if (!Object.prototype.hasOwnProperty.call(HTTP_STATUS_FOR_CODE, candidate.code)) return false;
  return candidate.status === HTTP_STATUS_FOR_CODE[candidate.code];
}

/**
 * Exactly `{ ACCOUNT_KEY_REVOKED, ACCOUNT_KEY_DESTROYED }` — "this cannot be read", as
 * distinct from "this is broken". Both are ordinary states of a live account.
 */
export const KEY_UNAVAILABLE_CODES: ReadonlySet<ContentCryptoCode> = new Set<ContentCryptoCode>([
  'ACCOUNT_KEY_REVOKED', 'ACCOUNT_KEY_DESTROYED',
]);

export function isKeyUnavailable(err: unknown): boolean {
  return isOurError(err) && KEY_UNAVAILABLE_CODES.has(err.code);
}

/**
 * `KEY_UNAVAILABLE_CODES` plus `NO_WRAP_FOR_ACCOUNT` — the list-page "skip this row"
 * predicate, and exactly what `openRecordSafe` swallows.
 *
 * `RECORD_KEY_UNWRAP_FAILED` is deliberately NOT in this set. A wrap that exists and will
 * not open is broken, not withheld; swallowing it turns a corrupted access list into a
 * quietly shorter list page (§B3).
 */
export const UNREADABLE_CODES: ReadonlySet<ContentCryptoCode> = new Set<ContentCryptoCode>([
  'ACCOUNT_KEY_REVOKED', 'ACCOUNT_KEY_DESTROYED', 'NO_WRAP_FOR_ACCOUNT',
]);

export function isUnreadable(err: unknown): boolean {
  return isOurError(err) && UNREADABLE_CODES.has(err.code);
}

// ---------------------------------------------------------------------------
// The scan
// ---------------------------------------------------------------------------

/**
 * 32 bytes, in its four canonical spellings, matched WHOLE — each carrying its own diagnosis,
 * so that whoever hits a refusal can tell in one read whether it is real.
 *
 * Exact-shape only, and that is a deliberate narrowing rather than laziness. A substring
 * scan false-positives on legitimate values, because a `scopePath` like
 * `projects/plTfBLFHrIdQSNEH/topics/tabcde/versions/v3` is fifty characters drawn entirely
 * from the base64 alphabet, `/` included. So this catches a whole key assigned to a widened
 * detail key — the case where somebody adds a key for one without thinking — and it does
 * NOT catch a ten-character fragment quoted inside a longer message. Nothing in a runtime
 * guard could, which is exactly why the closed key set is the guarantee and this is not.
 *
 * **base64url is the fourth spelling, and its false positive is taken deliberately.** It is
 * exactly what a Phase-C JSON API returns for a DEK, so leaving it out would be a false
 * NEGATIVE on the one encoding the transport actually uses. It also matches any 43-character
 * identifier drawn from `[A-Za-z0-9_-]` — a hyphenated id of that length loses. The trade is
 * the right way round: a false positive is loud, immediate and fixable at the call site, and
 * a false negative ships key material into a log silently and leaves it there.
 */
const THIRTY_TWO_BYTES: ReadonlyArray<{ readonly shape: RegExp; readonly diagnosis: string }> = [
  { shape: /^[A-Za-z0-9+/]{43}=$/, diagnosis: 'decodes to 32 bytes as padded base64' },
  { shape: /^[A-Za-z0-9+/]{43}$/, diagnosis: 'decodes to 32 bytes as unpadded base64' },
  { shape: /^[0-9a-fA-F]{64}$/, diagnosis: 'decodes to 32 bytes as hexadecimal' },
  {
    shape: /^[A-Za-z0-9_-]{43}$/,
    diagnosis:
      'decodes to 32 bytes as base64url; if this is a legitimate identifier it needs an exemption',
  },
];

/** The package's own wire grammars. Sealed material has no business in a detail field. */
const ENVELOPE_PREFIXES = ['enc:', 'wrap:', 'dev:'];

/**
 * Throws `VALIDATION_ERROR` — carrying the offending KEY and never the offending VALUE —
 * on any of the five rules of §11.6. Runs at every boundary the package emits through:
 * every `ContentCryptoError` construction, every `GraceInfo` before `onGraceServe`, every
 * `WrapAudit` and `KeyAudit` before the patch carrying it is returned, and every
 * `KeyPatch.key` / `GenerationPatch.set` value.
 */
export function assertNoSecrets(details: unknown): asserts details is ErrorDetails {
  requirePlainObject(details);

  // `Reflect.ownKeys`, not `Object.keys`: a symbol key is invisible to `JSON.stringify` but
  // very visible to `util.inspect`, and a non-enumerable one is invisible to both while
  // still being read by anything walking property descriptors.
  for (const rawKey of Reflect.ownKeys(details as object)) {
    const label = keyLabel(rawKey);
    const value: unknown = (details as Record<string | symbol, unknown>)[rawKey as string];

    // Rule 1 — key material, by shape. This is the better message; rule 3 is the guarantee,
    // and it catches every one of these again as "not a scalar".
    if (isKeyMaterialShaped(value)) {
      throw refuse(`detail key \`${label}\` holds key material or raw bytes`);
    }

    // Rule 2 — the closed set. THIS is the guarantee.
    if (typeof rawKey === 'symbol' || !SAFE_DETAIL_KEY_SET.has(rawKey)) {
      throw refuse(`detail key \`${label}\` is not one of SAFE_DETAIL_KEYS`);
    }

    // Rule 3 — scalars only, which forbids a nested object and with it the recursion a
    // redactor would need. `undefined` is refused too: omit the key instead of setting it,
    // because an absent optional field and a field explicitly set to nothing are the same
    // fact and only one of them survives serialisation.
    if (!isScalar(value)) {
      throw refuse(
        value === undefined
          ? `detail key \`${label}\` is present with no value; omit the key instead`
          : `detail key \`${label}\` is not a string, number, boolean or null`,
      );
    }

    if (typeof value === 'string') {
      // Rule 4 — the backstop. The diagnosis travels with the refusal, because the whole
      // value of a false positive is that somebody can see immediately that it is one.
      for (const { shape, diagnosis } of THIRTY_TWO_BYTES) {
        if (shape.test(value)) {
          throw refuse(
            `detail key \`${label}\` holds a string shaped exactly like 32 bytes of key material: it ${diagnosis}`,
          );
        }
      }
      // Rule 5 — our own envelope grammars.
      for (const prefix of ENVELOPE_PREFIXES) {
        if (value.slice(0, prefix.length) === prefix) {
          throw refuse(`detail key \`${label}\` holds sealed material`);
        }
      }
    }
  }
}

/**
 * Drop every entry whose value is `undefined`, so that OMISSION is the easy path.
 *
 * Rule 3 rejects a key that is present with no value, and that strictness is deliberate: an
 * absent optional field and a field explicitly set to `undefined` are the same fact, and only
 * one of them survives a round trip through JSON or through a store. Keeping the rule strict
 * without making omission easy is how a builder ends up written as a chain of `if`s, or worse,
 * as a spread that puts the `undefined` back.
 *
 * So an audit or a detail bag is built in one expression:
 *
 *     new ContentCryptoError('ACCOUNT_KEY_REVOKED', message, compact({ status, reason }))
 *
 * and a `reason` that is not known this time is simply not there. One helper, strictness
 * intact.
 *
 * It copies EVERY own key that survives — symbols and non-enumerables included — because
 * dropping them here would launder past `assertNoSecrets` exactly the keys it goes out of its
 * way to see. It is one level deep and says so: a nested bag is not a detail bag, and rule 3
 * refuses one anyway.
 */
export function compact<T extends object>(bag: T): { readonly [K in keyof T]?: Exclude<T[K], undefined> } {
  if (bag === null || typeof bag !== 'object' || Array.isArray(bag)) {
    throw new ContentCryptoError(
      'VALIDATION_ERROR',
      'compact needs a plain object; there is nothing to omit from an array or a scalar',
    );
  }
  const out: Record<string | symbol, unknown> = {};
  for (const key of Reflect.ownKeys(bag)) {
    const value: unknown = (bag as Record<string | symbol, unknown>)[key as string];
    if (value !== undefined) out[key as string] = value;
  }
  return out as { readonly [K in keyof T]?: Exclude<T[K], undefined> };
}

function requirePlainObject(details: unknown): void {
  if (details === null || typeof details !== 'object' || Array.isArray(details)) {
    throw refuse('details must be a plain object of scalars');
  }
  // A class instance — a key handle, a Buffer, a Map, an Error — is not a detail bag. The
  // prototype test is what makes "plain" mean plain rather than "typeof object".
  const proto: unknown = Object.getPrototypeOf(details);
  if (proto !== Object.prototype && proto !== null) {
    throw refuse('details must be a plain object of scalars');
  }
}

/**
 * A shallow copy carrying EVERY own key across — symbols and non-enumerables included — so
 * that whatever `assertNoSecrets` would have refused on the caller's object it refuses on
 * this one. `undefined` details become `{}`, which is the only shape `toJSON` may emit for
 * an error constructed without any.
 */
function copyDetails(details: unknown): Record<string | symbol, unknown> {
  const copy: Record<string | symbol, unknown> = {};
  if (details === undefined) return copy;
  requirePlainObject(details);
  for (const key of Reflect.ownKeys(details as object)) {
    copy[key as string] = (details as Record<string | symbol, unknown>)[key as string];
  }
  return copy;
}

function isScalar(value: unknown): value is ErrorDetail {
  return value === null
    || typeof value === 'string'
    || typeof value === 'number'
    || typeof value === 'boolean';
}

/**
 * Rule 1, structurally. See the file docblock for why this cannot call `isSecret`.
 *
 * `ArrayBuffer.isView` covers every `TypedArray`, `DataView` and `Buffer` — including ones
 * from another realm, which `instanceof` would miss. The `toStringTag` reads cover the
 * buffers themselves. The key-handle test matches `secret.ts`'s `SecretHandle`: its own
 * properties are prototype getters, so `Object.keys` is empty and only a read finds them.
 */
function isKeyMaterialShaped(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  if (ArrayBuffer.isView(value)) return true;

  const tag = Object.prototype.toString.call(value);
  if (tag === '[object ArrayBuffer]' || tag === '[object SharedArrayBuffer]') return true;

  try {
    const handle = value as { kind?: unknown; label?: unknown; byteLength?: unknown; destroyed?: unknown };
    if ((value as Record<symbol, unknown>)[Symbol.toStringTag] === 'Secret') return true;
    return typeof handle.kind === 'string'
      && typeof handle.label === 'string'
      && typeof handle.byteLength === 'number'
      && typeof handle.destroyed === 'boolean';
  } catch {
    // A getter that throws is somebody else's problem; rule 3 refuses the object anyway.
    return false;
  }
}

/**
 * The offending key, made safe to interpolate.
 *
 * §11.6 requires the refusal to name the key, and a key is normally one of eighteen fixed
 * words. It is not always: `{ [dekBase64]: 1 }` is legal JavaScript, and a message quoting
 * that key would be the leak this function exists to report. So the key goes through the
 * same shape rules as a value, and is capped — a real detail key is never long.
 */
function keyLabel(rawKey: string | symbol): string {
  const asText = typeof rawKey === 'symbol' ? String(rawKey) : rawKey;
  for (const { shape } of THIRTY_TWO_BYTES) {
    if (shape.test(asText)) return '[redacted]';
  }
  for (const prefix of ENVELOPE_PREFIXES) {
    if (asText.slice(0, prefix.length) === prefix) return '[redacted]';
  }
  return asText.length > 64 ? `${asText.slice(0, 64)}…` : asText;
}

/**
 * Every refusal above, with no details of its own — which is what stops the recursion:
 * the error this builds carries `{}`, and scanning `{}` terminates immediately.
 */
function refuse(message: string): ContentCryptoError {
  return new ContentCryptoError('VALIDATION_ERROR', `assertNoSecrets: ${message}`);
}

// ---------------------------------------------------------------------------
// The recursive, value-level check
// ---------------------------------------------------------------------------

/**
 * Deep enough for anything this package hands back, and finite.
 *
 * It is the same 64 that `blob-json.ts` enforces on a serialised blob, restated rather than
 * imported because this module imports nothing (see the file docblock). A tree deeper than
 * the deepest thing the package will serialise is one this check refuses rather than walks:
 * "I gave up" and "there is nothing here" must never be the same answer.
 */
const MAX_KEY_MATERIAL_DEPTH = 64;

/** `Array.from(buffer).join(',')` for a 32-byte key: thirty-two decimal byte values. */
const BYTE_ARRAY_DECIMAL = /^(?:\d{1,3},){31}\d{1,3}$/;

/** 32 bytes, one code unit each. */
const KEY_MATERIAL_CODE_UNITS = 32;

/**
 * Walk `value` and refuse if ANYTHING anywhere in it looks like key material.
 *
 * **This is not a second `assertNoSecrets`, and it is not a widened one.** `assertNoSecrets`
 * asks "is this a legal error-details bag" — a closed key set, scalars, one level — and
 * applying it to a structured payload such as a `WrapAudit` is a category error. This asks a
 * different question, over a different threat model: never mind the shape, are there key
 * bytes in here. It says nothing about which keys a payload may carry, so it must NEVER be
 * used to let an audit-shaped object into `ContentCryptoError.details`.
 *
 * Where it belongs: on every structured thing this package hands back that somebody will log
 * — an audit payload, a patch, a callback payload — as a standing guard, so that adding a
 * field to one of those shapes is not the same as adding a leak. A point-in-time sweep proves
 * only that the tree was clean on the day somebody ran it.
 *
 * It knows the SEVEN spellings of 32 bytes: padded base64, unpadded base64, hexadecimal in
 * either case, base64url, latin1, and the decimal byte array. It also refuses a `Buffer`,
 * any `TypedArray`, a `DataView`, an `ArrayBuffer`, a `SharedArrayBuffer` and a key handle
 * wherever they appear, and it walks arrays, plain objects, class instances, `Map` and `Set`.
 *
 * What it deliberately does NOT do:
 *
 *   - **It does not flag sealed material.** `enc:v3:…` and `wrap:v1:…` are ciphertext, which
 *     is meant to be stored and logged; a whole-string shape cannot match one anyway. Sealed
 *     material in an error DETAIL is a different matter and `assertNoSecrets` rule 5 refuses
 *     it there.
 *   - **It does not find fragments.** Like rule 4 it matches whole values, for the same
 *     reason: a substring scan false-positives on ordinary paths and identifiers. The test
 *     harness's `expectNoKeyMaterial` (§16) registers fixture bytes and can therefore chase
 *     fragments; production code has no fixture to compare against.
 *
 * The refusal names the PATH it found the value at and never the value, and the path's own
 * segments go through `keyLabel`, because a key can itself be key material.
 *
 * @param label what to call the root in a refusal — `'audit'`, `'patch'`, and so on.
 */
export function assertNoKeyMaterial(value: unknown, label = 'value'): void {
  walkForKeyMaterial(value, label, 0, new Set<object>());
}

function walkForKeyMaterial(node: unknown, path: string, depth: number, seen: Set<object>): void {
  if (typeof node === 'string') {
    const diagnosis = keyMaterialSpelling(node);
    if (diagnosis !== null) throw refuseKeyMaterial(`${path} ${diagnosis}`);
    return;
  }
  // A number, boolean, bigint, symbol, function, null or undefined carries no key on its own.
  // A byte in an array is caught by the array rule below, where the run of them is visible.
  if (typeof node !== 'object' || node === null) return;

  if (isKeyMaterialShaped(node)) {
    throw refuseKeyMaterial(`${path} holds raw bytes or a key handle`);
  }

  // A cycle is not a leak, and the node it points back to has been checked already.
  if (seen.has(node)) return;
  seen.add(node);

  if (depth >= MAX_KEY_MATERIAL_DEPTH) {
    throw refuseKeyMaterial(
      `${path} nests more than ${MAX_KEY_MATERIAL_DEPTH} levels deep, so this check cannot prove there is no key material below it`,
    );
  }

  if (Array.isArray(node)) {
    if (isByteArray(node)) {
      throw refuseKeyMaterial(`${path} is 32 byte values in a row, which is 32 raw bytes with the Buffer taken off`);
    }
    for (let i = 0; i < node.length; i += 1) {
      walkForKeyMaterial(node[i], `${path}[${i}]`, depth + 1, seen);
    }
    return;
  }

  // Tag reads rather than `instanceof`, so a Map from another realm is still a Map. A Date or
  // a RegExp holds no key material and has nothing worth walking.
  const tag = Object.prototype.toString.call(node);
  if (tag === '[object Date]' || tag === '[object RegExp]') return;

  if (tag === '[object Map]') {
    let i = 0;
    for (const [mapKey, mapValue] of node as Map<unknown, unknown>) {
      const at = typeof mapKey === 'string' ? `${path}.${keyLabel(mapKey)}` : `${path}.<entry ${i}>`;
      walkForKeyMaterial(mapKey, `${at} (key)`, depth + 1, seen);
      walkForKeyMaterial(mapValue, at, depth + 1, seen);
      i += 1;
    }
    return;
  }

  if (tag === '[object Set]') {
    let i = 0;
    for (const member of node as Set<unknown>) {
      walkForKeyMaterial(member, `${path}.<member ${i}>`, depth + 1, seen);
      i += 1;
    }
    return;
  }

  // `Reflect.ownKeys` again, for the same reason as the scan: a symbol key is invisible to
  // `JSON.stringify` and very visible to `util.inspect`, and a non-enumerable one is read by
  // anything walking descriptors. Prototype getters are NOT walked — a look-alike key handle
  // hides its state there, and `isKeyMaterialShaped` above is what reads those.
  for (const rawKey of Reflect.ownKeys(node)) {
    let child: unknown;
    try {
      child = (node as Record<string | symbol, unknown>)[rawKey as string];
    } catch {
      // A getter that throws is somebody else's problem, and nothing serialising this payload
      // would reach the value either.
      continue;
    }
    walkForKeyMaterial(child, `${path}.${keyLabel(rawKey)}`, depth + 1, seen);
  }
}

/**
 * The seven spellings, as a diagnosis or `null`.
 *
 * The latin1 rule is the one worth explaining. Raw bytes read as latin1 are 32 code units,
 * every one of them below 0x100, and 32 random bytes contain a control character with
 * probability better than 0.9999 — so "exactly 32 code units, all latin1, at least one of
 * them a control byte" is a strong signal and is almost impossible to hit by writing prose.
 * A 32-character line of ordinary text is not refused, which is the point.
 */
function keyMaterialSpelling(text: string): string | null {
  for (const { shape, diagnosis } of THIRTY_TWO_BYTES) {
    if (shape.test(text)) return diagnosis;
  }

  if (text.length === KEY_MATERIAL_CODE_UNITS && looksLikeLatin1Bytes(text)) {
    return 'is 32 latin1 code units with control bytes among them, which is what 32 raw bytes look like read as a string';
  }

  if (BYTE_ARRAY_DECIMAL.test(text) && text.split(',').every((part) => Number(part) <= 0xff)) {
    return 'is 32 decimal byte values, which is what joining a 32-byte buffer produces';
  }

  return null;
}

function looksLikeLatin1Bytes(text: string): boolean {
  let sawControl = false;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code > 0xff) return false;
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) sawControl = true;
  }
  return sawControl;
}

/** `Array.from(buffer)` for a 32-byte key, once the Buffer has been taken off it. */
function isByteArray(value: readonly unknown[]): boolean {
  if (value.length !== KEY_MATERIAL_CODE_UNITS) return false;
  return value.every(
    (element) => typeof element === 'number' && Number.isInteger(element) && element >= 0 && element <= 0xff,
  );
}

/**
 * Every refusal from the walk. Like `refuse` it carries no details of its own, so the error
 * cannot itself become an egress, and the path is capped: a deep tree makes a long path and a
 * message nobody reads is a message nobody acts on.
 */
function refuseKeyMaterial(message: string): ContentCryptoError {
  const capped = message.length > 240 ? `…${message.slice(-200)}` : message;
  return new ContentCryptoError('VALIDATION_ERROR', `assertNoKeyMaterial: ${capped}`);
}
