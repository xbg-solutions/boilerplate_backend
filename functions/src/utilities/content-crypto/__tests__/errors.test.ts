/**
 * The taxonomy and the leak boundary — spec §16.11.
 *
 * Three things are being proved here, and only one of them is a normal unit test:
 *
 *   1. `HTTP_STATUS_FOR_CODE` is TOTAL over the code union, asserted as an equality against
 *      a written-down list. TypeScript already enforces totality at build time; the runtime
 *      list is what makes a *deletion* fail loudly, which is the failure a subset check
 *      cannot see.
 *   2. A `ContentCryptoError` never carries a `cause`. That is the whole §11.3 defence: an
 *      upstream HTTP error's message can quote the plaintext DEK, and a `cause` chain is
 *      how it would reach a log through an error we authored.
 *   3. `assertNoSecrets` refuses everything outside the CLOSED key set. The suite states,
 *      case by case, which assertions are the guarantee (the closed set) and which are the
 *      backstop (the shape rules) — including one test that asserts the backstop does NOT
 *      catch a key quoted inside a longer string, because pretending otherwise is how the
 *      real boundary stops being maintained.
 *   4. `assertNoKeyMaterial` sees key material anywhere in a tree, in all SEVEN spellings —
 *      and the last describe in this file is a NEGATIVE CONTROL, because a check that cannot
 *      see real key material proves only that the check is broken. It is a different question
 *      from `assertNoSecrets`, over a different threat model, and the suite asserts that too:
 *      passing an audit-shaped object through it does not make that object a legal `details`.
 *
 * Mirrorable: one relative import, no clock, no randomness, no environment, no path
 * literal reaching above the mirrored root.
 */

import {
  ContentCryptoError,
  HTTP_STATUS_FOR_CODE,
  KEY_UNAVAILABLE_CODES,
  SAFE_DETAIL_KEYS,
  UNREADABLE_CODES,
  assertNoKeyMaterial,
  assertNoSecrets,
  compact,
  isContentCryptoError,
  isKeyUnavailable,
  isUnreadable,
} from '../errors';
import type { ContentCryptoCode, ErrorDetails } from '../errors';

/**
 * The twenty-four codes and the status each maps to, written out rather than derived from
 * the module under test. A test that reads its expectations out of the implementation
 * proves only that the implementation equals itself.
 *
 * `CONTENT_ENCRYPT_FAILED` is the newest, and it is here rather than in `VALIDATION_ERROR`
 * because a taxonomy with no category for a failure that really happens is not closed, it is
 * incomplete. The taxonomy stays closed to codes invented at a call site.
 */
const DECLARED: ReadonlyArray<readonly [string, number]> = [
  ['ACCOUNT_KEY_CAUSE_HOLDS', 409],
  ['ACCOUNT_KEY_DESTROYED', 409],
  ['ACCOUNT_KEY_NOT_DESTROYED', 409],
  ['ACCOUNT_KEY_NOT_FOUND', 404],
  ['ACCOUNT_KEY_NOT_REVOKED', 409],
  ['ACCOUNT_KEY_REVOKED', 409],
  ['BLOB_ALREADY_SEALED', 500],
  ['BLOB_ENCODE_FAILED', 500],
  ['BLOB_PARTIAL_UPDATE', 400],
  ['BLOB_SUBPATH_INVALID', 400],
  ['BLOB_TOO_LARGE', 400],
  ['CONTENT_DECRYPT_FAILED', 500],
  ['CONTENT_ENCRYPT_FAILED', 500],
  ['CONTENT_KIND_MISMATCH', 500],
  ['CONTENT_PLAINTEXT_AT_REGISTERED_PATH', 500],
  ['DOCUMENT_TOO_LARGE', 400],
  ['KEY_MATERIAL_DESTROYED', 500],
  ['KEY_SOURCE_UNAVAILABLE', 503],
  ['KEY_STORE_CONFLICT', 409],
  ['NO_WRAP_FOR_ACCOUNT', 403],
  ['RECORD_KEY_UNWRAP_FAILED', 500],
  ['ROTATION_IN_PROGRESS', 409],
  ['VALIDATION_ERROR', 400],
  ['WRONG_KEY_LAYER', 500],
];

const ALL_CODES = DECLARED.map(([code]) => code as ContentCryptoCode);

/** 32 bytes, in the four spellings rule 4 knows about. Fixed bytes, never random. */
const THIRTY_TWO = Buffer.alloc(32, 0x5a);
const DEK_BASE64_PADDED = THIRTY_TWO.toString('base64');                       // 44 chars, one '='
const DEK_BASE64_UNPADDED = DEK_BASE64_PADDED.replace(/=+$/, '');              // 43 chars
const DEK_HEX = THIRTY_TWO.toString('hex');                                    // 64 chars

/**
 * A second fixed 32 bytes, chosen so that every spelling is DISTINCT: its base64 carries `+`
 * and `/`, so its base64url spelling really does differ (it carries `-` and `_`); its latin1
 * spelling contains control bytes, which is what makes raw bytes recognisable as a string.
 * `0x5a` repeated thirty-two times has none of those properties and would let a rule pass by
 * being caught accidentally by its neighbour.
 *
 * Fixed and derived arithmetically rather than random: this suite mirrors byte-for-byte into
 * the functions tree, so it reads no clock, no environment and no RNG.
 */
const KEY_MATERIAL = Buffer.from(Array.from({ length: 32 }, (_, i) => (i * 251 + 5) & 0xff));

/** The seven spellings the value-level check knows, each labelled by the rule that owns it. */
const SPELLINGS: ReadonlyArray<readonly [string, string]> = [
  ['padded base64', KEY_MATERIAL.toString('base64')],
  ['unpadded base64', KEY_MATERIAL.toString('base64').replace(/=+$/, '')],
  ['hex', KEY_MATERIAL.toString('hex')],
  ['uppercase hex', KEY_MATERIAL.toString('hex').toUpperCase()],
  ['base64url', KEY_MATERIAL.toString('base64url')],
  ['latin1', KEY_MATERIAL.toString('latin1')],
  ['decimal byte array', Array.from(KEY_MATERIAL).join(',')],
];

/** Anything cast through this is a caller the type system would already have stopped. */
const asDetails = (value: unknown): ErrorDetails => value as ErrorDetails;

/**
 * A stand-in for `secret.ts`'s `SecretHandle`, built the way §5.2 requires the real one to
 * be built: every property a PROTOTYPE getter, so `Object.keys` is empty and only a read
 * finds it. `errors.ts` cannot import `secret.ts` — that module throws
 * `KEY_MATERIAL_DESTROYED` from its accessor, so the dependency runs the other way — which
 * is why the scan detects a handle structurally and why this fixture has to mimic the
 * shape rather than the class.
 */
function secretShapedHandle(): unknown {
  const proto = {
    get kind(): string { return 'dek'; },
    get label(): string { return 'dek prod/acc_1@3'; },
    get byteLength(): number { return 32; },
    get destroyed(): boolean { return false; },
    get [Symbol.toStringTag](): string { return 'Secret'; },
    toJSON(): string { return '[redacted dek prod/acc_1@3]'; },
  };
  return Object.create(proto);
}

describe('the code taxonomy', () => {
  it('maps every declared code to a status, and declares no code that is not in the union', () => {
    expect(Object.keys(HTTP_STATUS_FOR_CODE).sort()).toEqual(ALL_CODES.slice().sort());
  });

  it('maps each code to the status the specification gives it', () => {
    const table: Record<string, number> = {};
    for (const [code, status] of DECLARED) table[code] = status;
    expect({ ...HTTP_STATUS_FOR_CODE }).toEqual(table);
  });

  it('gives every code a client or server status, never a success or a redirect', () => {
    for (const code of ALL_CODES) {
      const status = HTTP_STATUS_FOR_CODE[code];
      expect(Number.isInteger(status)).toBe(true);
      expect(status).toBeGreaterThanOrEqual(400);
      expect(status).toBeLessThan(600);
    }
  });

  it('routes the one code that is routine under federation to 403, not to a 5xx', () => {
    // NO_WRAP_FOR_ACCOUNT is "you hold no wrap", which is an ordinary answer once records
    // are shared across accounts. A 500 here would page somebody every time it happened.
    expect(HTTP_STATUS_FOR_CODE.NO_WRAP_FOR_ACCOUNT).toBe(403);
  });

  it('is frozen, so a consumer cannot re-map a status at runtime', () => {
    expect(Object.isFrozen(HTTP_STATUS_FOR_CODE)).toBe(true);
  });
});

describe('ContentCryptoError', () => {
  it('is an Error, names itself, and derives its status from the table for every code', () => {
    for (const code of ALL_CODES) {
      const err = new ContentCryptoError(code, 'a fixed message');
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(ContentCryptoError);
      expect(err.name).toBe('ContentCryptoError');
      expect(err.message).toBe('a fixed message');
      expect(err.code).toBe(code);
      expect(err.status).toBe(HTTP_STATUS_FOR_CODE[code]);
    }
  });

  it('NEVER carries a cause — not for any code, not after being thrown and caught', () => {
    // The single most load-bearing assertion in this file. From Phase C the DEK arrives as
    // an HTTP response body, and an upstream parser's message can quote it; a cause chain
    // is the mechanism that carries such a message into a log through an error of ours.
    for (const code of ALL_CODES) {
      const err = new ContentCryptoError(code, 'a fixed message', { accountId: 'acc_1' });
      expect('cause' in err).toBe(false);
      expect((err as unknown as { cause?: unknown }).cause).toBeUndefined();
    }

    let caught: unknown;
    try {
      throw new ContentCryptoError('KEY_SOURCE_UNAVAILABLE', 'a fixed message');
    } catch (e) {
      caught = e;
    }
    expect('cause' in (caught as object)).toBe(false);
  });

  it('gives a serialiser walking cause recursively nothing to find', () => {
    // The shape of an error serialiser in the wild: follow `cause` until it runs out, and
    // collect every message on the way. Here it runs out immediately.
    const err = new ContentCryptoError('RECORD_KEY_UNWRAP_FAILED', 'the wrap did not verify');
    const chain: string[] = [];
    let node: unknown = err;
    while (node instanceof Error) {
      chain.push(node.message);
      node = (node as { cause?: unknown }).cause;
    }
    expect(chain).toEqual(['the wrap did not verify']);
  });

  it('serialises to exactly code, message and details — no name, no stack, no cause', () => {
    const err = new ContentCryptoError('BLOB_TOO_LARGE', 'too large', {
      plaintextBytes: 1_000_000,
      sealedBytes: 1_400_000,
      limitBytes: 900_000,
    });
    expect(Object.keys(err.toJSON()).sort()).toEqual(['code', 'details', 'message']);
    expect(err.toJSON()).toEqual({
      code: 'BLOB_TOO_LARGE',
      message: 'too large',
      details: { plaintextBytes: 1_000_000, sealedBytes: 1_400_000, limitBytes: 900_000 },
    });

    const roundTripped = JSON.parse(JSON.stringify(err)) as Record<string, unknown>;
    expect(Object.keys(roundTripped).sort()).toEqual(['code', 'details', 'message']);
    expect(roundTripped).not.toHaveProperty('cause');
    expect(roundTripped).not.toHaveProperty('stack');
  });

  it('defaults details to an empty object rather than to undefined', () => {
    const err = new ContentCryptoError('VALIDATION_ERROR', 'a fixed message');
    expect(err.details).toEqual({});
    expect(err.toJSON().details).toEqual({});
  });

  it('copies the details it was given, so a later mutation cannot slip a value into it', () => {
    // The scan happens once, at construction. Keeping a reference to the caller's object
    // would make the scan a snapshot of a value nobody has to keep true.
    const supplied: Record<string, unknown> = { accountId: 'acc_1' };
    const err = new ContentCryptoError('ACCOUNT_KEY_NOT_FOUND', 'a fixed message', asDetails(supplied));
    supplied.accountId = 'acc_2';
    supplied.docId = 'doc_9';
    expect(err.details).toEqual({ accountId: 'acc_1' });
  });

  it('freezes the details it stores', () => {
    const err = new ContentCryptoError('ACCOUNT_KEY_NOT_FOUND', 'a fixed message', { docId: 'doc_1' });
    expect(Object.isFrozen(err.details)).toBe(true);
    expect(() => {
      (err.details as Record<string, unknown>).docId = 'doc_2';
    }).toThrow(TypeError);
  });

  it('scans its details at construction — a Buffer in a detail bag never becomes an error', () => {
    expect(() => new ContentCryptoError('VALIDATION_ERROR', 'a fixed message', asDetails({ accountId: THIRTY_TWO })))
      .toThrow(ContentCryptoError);
  });

  it('refuses a code that is not in the union, and puts the offending value where it is scanned', () => {
    // A plain-JavaScript caller can hand over anything; an unknown code would otherwise
    // leave `status` undefined and produce a 500-shaped hole at the middleware.
    let caught: ContentCryptoError | null = null;
    try {
      new ContentCryptoError('NOT_A_CODE' as ContentCryptoCode, 'a fixed message');
    } catch (e) {
      caught = e as ContentCryptoError;
    }
    expect(caught).toBeInstanceOf(ContentCryptoError);
    expect(caught?.code).toBe('VALIDATION_ERROR');
    expect(caught?.status).toBe(400);
    expect(caught?.details).toEqual({ code: 'NOT_A_CODE' });
  });
});

describe('the predicates', () => {
  it('recognises our own error, optionally narrowing to one code', () => {
    const err = new ContentCryptoError('NO_WRAP_FOR_ACCOUNT', 'a fixed message');
    expect(isContentCryptoError(err)).toBe(true);
    expect(isContentCryptoError(err, 'NO_WRAP_FOR_ACCOUNT')).toBe(true);
    expect(isContentCryptoError(err, 'ACCOUNT_KEY_REVOKED')).toBe(false);
  });

  it('says no to everything that is not one of ours', () => {
    for (const notOurs of [null, undefined, 'NO_WRAP_FOR_ACCOUNT', 403, {}, [], new Error('nope')]) {
      expect(isContentCryptoError(notOurs)).toBe(false);
      expect(isKeyUnavailable(notOurs)).toBe(false);
      expect(isUnreadable(notOurs)).toBe(false);
    }
  });

  it('recognises an error thrown by the mirrored copy of this module', () => {
    // This package ships twice — as the package and as its byte-identical mirror under the
    // functions tree — so one process can hold two copies of the class with two prototypes.
    // An instanceof-only predicate would answer `false` for the other copy's error, and
    // openRecordSafe would rethrow a NO_WRAP_FOR_ACCOUNT it was meant to swallow.
    const fromTheOtherCopy = Object.assign(new Error('a fixed message'), {
      name: 'ContentCryptoError',
      code: 'ACCOUNT_KEY_REVOKED',
      status: 409,
    });
    expect(isContentCryptoError(fromTheOtherCopy)).toBe(true);
    expect(isContentCryptoError(fromTheOtherCopy, 'ACCOUNT_KEY_REVOKED')).toBe(true);
    expect(isKeyUnavailable(fromTheOtherCopy)).toBe(true);
    expect(isUnreadable(fromTheOtherCopy)).toBe(true);
  });

  it('is not fooled by an error that merely borrows the name', () => {
    const impostor = Object.assign(new Error('a fixed message'), { name: 'ContentCryptoError' });
    expect(isContentCryptoError(impostor)).toBe(false);

    const wrongStatus = Object.assign(new Error('a fixed message'), {
      name: 'ContentCryptoError', code: 'ACCOUNT_KEY_REVOKED', status: 200,
    });
    expect(isContentCryptoError(wrongStatus)).toBe(false);

    const unknownCode = Object.assign(new Error('a fixed message'), {
      name: 'ContentCryptoError', code: 'SOMETHING_ELSE', status: 409,
    });
    expect(isContentCryptoError(unknownCode)).toBe(false);
  });

  it('treats exactly two codes as "cannot be read"', () => {
    expect([...KEY_UNAVAILABLE_CODES].sort()).toEqual(['ACCOUNT_KEY_DESTROYED', 'ACCOUNT_KEY_REVOKED']);
    for (const code of ALL_CODES) {
      const err = new ContentCryptoError(code, 'a fixed message');
      expect(isKeyUnavailable(err)).toBe(KEY_UNAVAILABLE_CODES.has(code));
    }
  });

  it('treats those two plus NO_WRAP_FOR_ACCOUNT as "skip this row"', () => {
    expect([...UNREADABLE_CODES].sort())
      .toEqual(['ACCOUNT_KEY_DESTROYED', 'ACCOUNT_KEY_REVOKED', 'NO_WRAP_FOR_ACCOUNT']);
    for (const code of KEY_UNAVAILABLE_CODES) expect(UNREADABLE_CODES.has(code)).toBe(true);
    for (const code of ALL_CODES) {
      const err = new ContentCryptoError(code, 'a fixed message');
      expect(isUnreadable(err)).toBe(UNREADABLE_CODES.has(code));
    }
  });

  it('does NOT treat RECORD_KEY_UNWRAP_FAILED as unreadable', () => {
    // A wrap that exists and will not open is broken, not withheld. Swallowing it turns a
    // corrupted access list into a quietly shorter list page, which is the failure mode a
    // list endpoint hides best.
    const err = new ContentCryptoError('RECORD_KEY_UNWRAP_FAILED', 'a fixed message');
    expect(UNREADABLE_CODES.has('RECORD_KEY_UNWRAP_FAILED')).toBe(false);
    expect(isUnreadable(err)).toBe(false);
    expect(isKeyUnavailable(err)).toBe(false);
  });

  it('names only codes that exist in both sets', () => {
    for (const code of [...KEY_UNAVAILABLE_CODES, ...UNREADABLE_CODES]) {
      expect(Object.prototype.hasOwnProperty.call(HTTP_STATUS_FOR_CODE, code)).toBe(true);
    }
  });
});

describe('assertNoSecrets — the closed key set, which is the guarantee', () => {
  it('accepts an empty bag and every declared key carrying a scalar', () => {
    expect(() => assertNoSecrets({})).not.toThrow();
    for (const key of SAFE_DETAIL_KEYS) {
      expect(() => assertNoSecrets({ [key]: 'a value' })).not.toThrow();
      expect(() => assertNoSecrets({ [key]: 42 })).not.toThrow();
      expect(() => assertNoSecrets({ [key]: true })).not.toThrow();
      expect(() => assertNoSecrets({ [key]: null })).not.toThrow();
    }
  });

  it('declares eighteen keys, and the list is frozen', () => {
    expect(SAFE_DETAIL_KEYS.length).toBe(18);
    expect(new Set(SAFE_DETAIL_KEYS).size).toBe(18);
    expect(Object.isFrozen(SAFE_DETAIL_KEYS)).toBe(true);
  });

  it('refuses a key outside the set, naming the key and never the value', () => {
    let caught: ContentCryptoError | null = null;
    try {
      assertNoSecrets({ dek: 'the-value-that-must-not-be-logged' });
    } catch (e) {
      caught = e as ContentCryptoError;
    }
    expect(caught).toBeInstanceOf(ContentCryptoError);
    expect(caught?.code).toBe('VALIDATION_ERROR');
    expect(caught?.message).toContain('dek');
    expect(caught?.message).not.toContain('the-value-that-must-not-be-logged');
    // The refusal carries no details of its own, so it cannot itself become an egress.
    expect(caught?.details).toEqual({});
    expect('cause' in (caught as object)).toBe(false);
  });

  it('sees a symbol key and a non-enumerable key, which JSON.stringify does not', () => {
    const withSymbol: Record<string | symbol, unknown> = {};
    withSymbol[Symbol.for('dek')] = 'value';
    expect(() => assertNoSecrets(withSymbol)).toThrow(ContentCryptoError);

    const hidden = {};
    Object.defineProperty(hidden, 'dek', { value: 'value', enumerable: false });
    expect(() => assertNoSecrets(hidden)).toThrow(ContentCryptoError);
  });

  it('refuses a nested object, and with it the recursion a redactor would need', () => {
    expect(() => assertNoSecrets({ path: { nested: 'value' } })).toThrow(ContentCryptoError);
    expect(() => assertNoSecrets({ path: ['a', 'b'] })).toThrow(ContentCryptoError);
    expect(() => assertNoSecrets({ path: () => 'value' })).toThrow(ContentCryptoError);
  });

  it('refuses a key that is present with no value, rather than quietly ignoring it', () => {
    // An optional field spread in as `undefined` and an absent field are the same fact,
    // and only one of them survives a round trip. Omit the key.
    let caught: ContentCryptoError | null = null;
    try {
      assertNoSecrets({ status: undefined });
    } catch (e) {
      caught = e as ContentCryptoError;
    }
    expect(caught?.code).toBe('VALIDATION_ERROR');
    expect(caught?.message).toContain('status');
    expect(caught?.message).toContain('omit the key');
  });

  it('refuses anything that is not a plain bag of scalars', () => {
    for (const notABag of [null, undefined, 'path', 7, true, [], THIRTY_TWO, new Map(), new Error('x'), secretShapedHandle()]) {
      expect(() => assertNoSecrets(notABag)).toThrow(ContentCryptoError);
    }
  });

  it('accepts a prototype-less bag, which is what a careful caller builds', () => {
    const bag = Object.create(null) as Record<string, unknown>;
    bag.accountId = 'acc_1';
    expect(() => assertNoSecrets(bag)).not.toThrow();
  });
});

describe('assertNoSecrets — the shape rules, which are the backstop', () => {
  it('refuses raw bytes under a perfectly legitimate key', () => {
    // utils-logger redacts by field NAME, and a Buffer handed to it as metadata is expanded
    // into thirty-two numbered fields and logged whole. So no Buffer may reach a payload
    // this package emits, whatever the field is called.
    const shared = typeof SharedArrayBuffer === 'function' ? [new SharedArrayBuffer(32)] : [];
    const rawBytes: unknown[] = [
      THIRTY_TWO,
      new Uint8Array(32),
      new Uint32Array(8),
      new ArrayBuffer(32),
      new DataView(new ArrayBuffer(32)),
      ...shared,
    ];
    for (const bytes of rawBytes) {
      expect(() => assertNoSecrets({ accountId: bytes })).toThrow(ContentCryptoError);
    }
  });

  it('refuses a key handle, detected by shape because it cannot be detected by import', () => {
    let caught: ContentCryptoError | null = null;
    try {
      assertNoSecrets({ generation: secretShapedHandle() });
    } catch (e) {
      caught = e as ContentCryptoError;
    }
    expect(caught?.code).toBe('VALIDATION_ERROR');
    expect(caught?.message).toContain('key material');
  });

  it('refuses a string that is exactly 32 bytes in any of the four canonical spellings', () => {
    for (const spelling of [DEK_BASE64_PADDED, DEK_BASE64_UNPADDED, DEK_HEX, DEK_HEX.toUpperCase()]) {
      expect(() => assertNoSecrets({ scopePath: spelling })).toThrow(ContentCryptoError);
    }
    expect(DEK_BASE64_PADDED).toHaveLength(44);
    expect(DEK_BASE64_UNPADDED).toHaveLength(43);
    expect(DEK_HEX).toHaveLength(64);
  });

  it('refuses base64url, which is the spelling a Phase-C JSON API actually returns', () => {
    // The fourth spelling. Leaving it out was a false NEGATIVE on the one encoding the
    // transport uses: from Phase C the DEK arrives as base64url in a response body, and a
    // handler that puts it in a detail field would have passed the scan.
    const base64url = KEY_MATERIAL.toString('base64url');
    expect(base64url).toHaveLength(43);
    expect(/[-_]/.test(base64url)).toBe(true);            // genuinely not base64
    expect(/^[A-Za-z0-9+/]+={0,2}$/.test(base64url)).toBe(false);

    let caught: ContentCryptoError | null = null;
    try {
      assertNoSecrets({ scopePath: base64url });
    } catch (e) {
      caught = e as ContentCryptoError;
    }
    expect(caught?.code).toBe('VALIDATION_ERROR');
    expect(caught?.message).not.toContain(base64url);
    // The diagnosis travels with the refusal, because the whole worth of a false positive is
    // that the person who hits it can see in one read that it is one.
    expect(caught?.message).toContain('base64url');
    expect(caught?.message).toContain('if this is a legitimate identifier it needs an exemption');
  });

  it('takes the base64url false positive knowingly: a 43-character hyphenated id is refused', () => {
    // The accepted cost of the rule above, written down rather than discovered in production.
    // A false positive is loud, immediate and fixable at the call site — widen the detail, or
    // shorten the identifier. A false negative ships key material into a log and stays there.
    const identifier = 'run-2026-09-11-morph-export-000000000000042';
    expect(identifier).toHaveLength(43);
    expect(() => assertNoSecrets({ path: identifier })).toThrow(ContentCryptoError);
    // One character either side and it is ordinary again, which is what "exact shape" means.
    expect(() => assertNoSecrets({ path: `${identifier}0` })).not.toThrow();
  });

  it('refuses sealed material and wraps, which have no business in a status field', () => {
    for (const sealed of ['enc:v3:aaa:bbb:ccc', 'wrap:v1:aaa', 'dev:aaa']) {
      expect(() => assertNoSecrets({ path: sealed })).toThrow(ContentCryptoError);
    }
  });

  it('lets through a long scopePath drawn entirely from the base64 alphabet', () => {
    // The false positive rule 4 is narrowed to avoid. A substring scan would refuse this
    // path — a real one from a live store, every character of it in the base64 alphabet,
    // `/` included — and the refusal would land in the middle of a product's read path.
    const path = 'projects/plTfBLFHrIdQSNEH/topics/tabcde/versions/v3';
    expect(/^[A-Za-z0-9+/]+$/.test(path)).toBe(true);
    expect(() => assertNoSecrets({ scopePath: path })).not.toThrow();
    expect(() => assertNoSecrets({ path: 'documents/enc/settings' })).not.toThrow();
    expect(() => assertNoSecrets({ fieldPath: 'body.sections[2].encoding' })).not.toThrow();
  });

  it('does NOT catch a key quoted inside a longer string, and this is stated rather than hidden', () => {
    // §11.6 is candid about it: exact-shape matching cannot see a fragment, and nothing in
    // a runtime guard could. What actually stops the §11.3 leak is the closed key set here
    // plus check-mirror.js assertion (11) — `custodian-cache.ts` may not contain `.message`
    // at all. If this test ever starts failing because the rule was widened, read the
    // false-positive test above before celebrating.
    expect(() => assertNoSecrets({ path: `upstream said: ${DEK_BASE64_PADDED}` })).not.toThrow();
  });

  it('is honest about the cost of exact-shape matching: a path of exactly that length is refused', () => {
    // The other side of the same trade. A forty-three-character path drawn from the base64
    // alphabet is indistinguishable from an unpadded key, so it loses. Widening the detail
    // to carry it is the fix; loosening the rule is not.
    const unluckyPath = 'a'.repeat(43);
    expect(() => assertNoSecrets({ scopePath: unluckyPath })).toThrow(ContentCryptoError);
  });

  it('redacts a key name that is itself shaped like key material', () => {
    // `{ [dekBase64]: 1 }` is legal JavaScript, and a refusal quoting that key would be the
    // very leak this function reports.
    let caught: ContentCryptoError | null = null;
    try {
      assertNoSecrets({ [DEK_BASE64_PADDED]: 1 });
    } catch (e) {
      caught = e as ContentCryptoError;
    }
    expect(caught?.message).not.toContain(DEK_BASE64_PADDED);
    expect(caught?.message).toContain('[redacted]');
  });

  it('caps an absurdly long key name rather than putting it all in a message', () => {
    let caught: ContentCryptoError | null = null;
    try {
      assertNoSecrets({ ['z'.repeat(400)]: 1 });
    } catch (e) {
      caught = e as ContentCryptoError;
    }
    expect(caught).toBeInstanceOf(ContentCryptoError);
    expect((caught as ContentCryptoError).message.length).toBeLessThan(160);
  });
});

describe('compact — because rule 3 is strict on purpose', () => {
  it('drops the undefined entries and keeps every other scalar, null and false included', () => {
    expect(compact({ accountId: 'acc_1', status: undefined })).toEqual({ accountId: 'acc_1' });
    expect(compact({ generation: 0, status: false, docId: null })).toEqual({
      generation: 0, status: false, docId: null,
    });
    expect(compact({})).toEqual({});
  });

  it('makes omission the easy path, which is the whole reason it exists', () => {
    // Rule 3 refuses `{ status: undefined }` deliberately: an absent optional field and one
    // set to nothing are the same fact, and only one of them survives serialisation. Without
    // this helper an audit builder is a chain of `if`s, or a spread that puts it back.
    const reason: string | undefined = undefined;
    const status = 'revoked';
    expect(() => assertNoSecrets({ status, code: reason } as ErrorDetails)).toThrow(ContentCryptoError);
    expect(() => assertNoSecrets(compact({ status, code: reason }))).not.toThrow();
  });

  it('is accepted by the error constructor with no cast, which is the point of the typing', () => {
    const accountId = 'acc_1';
    const status: string | undefined = undefined;
    const err = new ContentCryptoError('ACCOUNT_KEY_REVOKED', 'a fixed message', compact({ accountId, status }));
    expect(err.details).toEqual({ accountId: 'acc_1' });
    expect('status' in err.details).toBe(false);
  });

  it('carries every own key across, symbols and non-enumerables included', () => {
    // Dropping them would launder past `assertNoSecrets` exactly the keys it goes out of its
    // way to see — a symbol key is invisible to JSON.stringify and very visible to inspect.
    const symbol = Symbol.for('dek');
    const bag: Record<string | symbol, unknown> = { accountId: 'acc_1' };
    bag[symbol] = 'value';
    Object.defineProperty(bag, 'hidden', { value: 'value', enumerable: false });

    const compacted = compact(bag) as Record<string | symbol, unknown>;
    expect(Object.getOwnPropertySymbols(compacted)).toEqual([symbol]);
    expect(Object.getOwnPropertyNames(compacted).sort()).toEqual(['accountId', 'hidden']);
    expect(() => assertNoSecrets(compacted)).toThrow(ContentCryptoError);
  });

  it('is one level deep, and does not pretend otherwise', () => {
    // A nested bag is not a detail bag, and rule 3 refuses one whatever is inside it.
    const nested = compact({ path: { inner: undefined } }) as Record<string, unknown>;
    expect(nested.path).toEqual({ inner: undefined });
    expect(() => assertNoSecrets(nested)).toThrow(ContentCryptoError);
  });

  it('refuses an array or a scalar, rather than quietly returning an empty bag', () => {
    for (const notABag of [[], ['a'], 'path', 7, null]) {
      expect(() => compact(notABag as unknown as object)).toThrow(ContentCryptoError);
    }
  });
});

describe('assertNoKeyMaterial — a different question, over a different threat model', () => {
  /** A `WrapAudit`-shaped payload: structured, nested, and entirely legitimate. */
  const audit = {
    productId: 'collab',
    record: { type: 'project', id: 'p_1', path: 'projects/p_1' },
    granularity: 'document',
    actorAccountId: 'acc_1',
    scope: 'this-record',
    cutOff: null,
    diff: { added: ['acc_2'], removed: [], rewrapped: [], unchanged: ['acc_1'] },
    holdersBefore: ['acc_1'],
    holdersAfter: ['acc_1', 'acc_2'],
    at: '2026-09-11T00:00:00.000Z',
  };

  it('passes a structured audit payload, which assertNoSecrets could never accept', () => {
    // The category error the two checks exist to separate. `assertNoSecrets` refuses this
    // object — `record` and `diff` are not scalars and `granularity` is not a declared key —
    // and it is right to, because it is answering "is this a legal details bag".
    expect(() => assertNoKeyMaterial(audit, 'audit')).not.toThrow();
    expect(() => assertNoSecrets(audit)).toThrow(ContentCryptoError);
  });

  it('is NOT a second entry point into details: passing it changes nothing about the bag', () => {
    // Widening `SAFE_DETAIL_KEYS` so an audit fits would defeat the closed set. Neither does
    // clearing this check.
    assertNoKeyMaterial(audit, 'audit');
    expect(() => new ContentCryptoError('VALIDATION_ERROR', 'a fixed message', audit as unknown as ErrorDetails))
      .toThrow(ContentCryptoError);
  });

  it('finds key material at depth, and names the path rather than the value', () => {
    const dek = KEY_MATERIAL.toString('base64');
    let caught: ContentCryptoError | null = null;
    try {
      assertNoKeyMaterial({ audit, extra: { rows: [{ note: 'fine' }, { note: dek }] } }, 'patch');
    } catch (e) {
      caught = e as ContentCryptoError;
    }
    expect(caught).toBeInstanceOf(ContentCryptoError);
    expect(caught?.code).toBe('VALIDATION_ERROR');
    expect(caught?.message).toContain('patch.extra.rows[1].note');
    expect(caught?.message).not.toContain(dek);
    expect(caught?.details).toEqual({});
    expect('cause' in (caught as object)).toBe(false);
  });

  it('walks arrays, Maps, Sets and symbol keys, not just plain objects', () => {
    const dek = KEY_MATERIAL.toString('hex');
    expect(() => assertNoKeyMaterial([1, 'two', [{ deep: dek }]])).toThrow(ContentCryptoError);
    expect(() => assertNoKeyMaterial(new Map([['dek', dek]]))).toThrow(ContentCryptoError);
    expect(() => assertNoKeyMaterial(new Map([[dek, 'a value']]))).toThrow(ContentCryptoError);
    expect(() => assertNoKeyMaterial(new Set(['fine', dek]))).toThrow(ContentCryptoError);

    const withSymbol: Record<symbol, unknown> = {};
    withSymbol[Symbol.for('note')] = dek;
    expect(() => assertNoKeyMaterial(withSymbol)).toThrow(ContentCryptoError);
  });

  it('refuses raw bytes and a key handle wherever they appear', () => {
    const shared = typeof SharedArrayBuffer === 'function' ? [new SharedArrayBuffer(32)] : [];
    const rawBytes: unknown[] = [
      THIRTY_TWO,
      new Uint8Array(32),
      new Uint32Array(8),
      new ArrayBuffer(32),
      new DataView(new ArrayBuffer(32)),
      ...shared,
      secretShapedHandle(),
    ];
    for (const bytes of rawBytes) {
      expect(() => assertNoKeyMaterial(bytes)).toThrow(ContentCryptoError);
      expect(() => assertNoKeyMaterial({ audit, held: bytes })).toThrow(ContentCryptoError);
    }
  });

  it('refuses a Buffer that has been through JSON, which is where a Buffer usually turns up', () => {
    // `JSON.stringify(buffer)` yields `{ type: 'Buffer', data: [ … ] }`, and the bytes are
    // just as present for having lost their class.
    const asJson = JSON.parse(JSON.stringify(KEY_MATERIAL)) as unknown;
    expect(() => assertNoKeyMaterial(asJson)).toThrow(ContentCryptoError);
    expect(() => assertNoKeyMaterial({ data: Array.from(KEY_MATERIAL) })).toThrow(ContentCryptoError);
  });

  it('does NOT flag sealed material, which is meant to be stored and logged', () => {
    // Ciphertext is not key material. Without this, every assertion over a WrapPatch would
    // fail on the patch's own legitimate `wrapped` values. Sealed material in an error DETAIL
    // is a different matter, and `assertNoSecrets` rule 5 refuses it there.
    const wrap = `wrap:v1:${'a'.repeat(16)}:${'b'.repeat(64)}:${'c'.repeat(24)}`;
    expect(() => assertNoKeyMaterial({ keyWraps: { acc_1: { wrapped: wrap, gen: 3 } } })).not.toThrow();
    expect(() => assertNoKeyMaterial({ value: 'enc:v3:aaa:bbb:ccc' })).not.toThrow();
    expect(() => assertNoSecrets({ path: 'enc:v3:aaa:bbb:ccc' })).toThrow(ContentCryptoError);
  });

  it('does not find fragments, and says so rather than implying it does', () => {
    // The same honesty as rule 4, for the same reason: a substring scan false-positives on
    // ordinary paths. The test harness registers fixture bytes and can chase fragments;
    // production code has nothing to compare a fragment against.
    expect(() => assertNoKeyMaterial({ note: `upstream said: ${KEY_MATERIAL.toString('base64')}` }))
      .not.toThrow();
  });

  it('accepts the ordinary strings a payload is made of', () => {
    for (const ordinary of [
      'projects/plTfBLFHrIdQSNEH/topics/tabcde/versions/v3',
      'body.sections[2].encoding',
      '2026-09-11T00:00:00.000Z',
      'a line of perfectly ordinary prose',
      'acc_1',
      '',
    ]) {
      expect(() => assertNoKeyMaterial({ value: ordinary })).not.toThrow();
    }
    // 32 characters of text is not 32 bytes of latin1: the latin1 rule wants control bytes,
    // which is what stops it refusing an ordinary sentence of that length.
    const thirtyTwoChars = 'the quick brown fox jumped again';
    expect(thirtyTwoChars).toHaveLength(32);
    expect(() => assertNoKeyMaterial({ value: thirtyTwoChars })).not.toThrow();
  });

  it('survives a cycle instead of recursing for ever', () => {
    const node: Record<string, unknown> = { productId: 'collab' };
    node.self = node;
    node.children = [node, { parent: node }];
    expect(() => assertNoKeyMaterial(node)).not.toThrow();

    node.dek = KEY_MATERIAL.toString('base64');
    expect(() => assertNoKeyMaterial(node)).toThrow(ContentCryptoError);
  });

  it('refuses a tree too deep to walk rather than reporting it clean', () => {
    // "I gave up" and "there is nothing here" must never be the same answer. The bound is the
    // 64 that blob-json.ts enforces on a serialised blob, so nothing this package will
    // serialise is refused for depth alone.
    let shallow: Record<string, unknown> = { note: 'nothing here' };
    for (let i = 0; i < 60; i += 1) shallow = { nested: shallow };
    expect(() => assertNoKeyMaterial(shallow)).not.toThrow();

    let deep: Record<string, unknown> = { note: 'nothing here' };
    for (let i = 0; i < 80; i += 1) deep = { nested: deep };
    let caught: ContentCryptoError | null = null;
    try {
      assertNoKeyMaterial(deep);
    } catch (e) {
      caught = e as ContentCryptoError;
    }
    expect(caught?.code).toBe('VALIDATION_ERROR');
    expect(caught?.message).toContain('cannot prove');
  });

  it('redacts a path segment that is itself key material, and caps the message', () => {
    const dek = KEY_MATERIAL.toString('base64');
    let caught: ContentCryptoError | null = null;
    try {
      assertNoKeyMaterial({ [dek]: { [dek]: dek } });
    } catch (e) {
      caught = e as ContentCryptoError;
    }
    expect(caught).toBeInstanceOf(ContentCryptoError);
    expect(caught?.message).not.toContain(dek);
    expect(caught?.message).toContain('[redacted]');
    expect((caught as ContentCryptoError).message.length).toBeLessThan(320);
  });
});

describe('assertNoKeyMaterial — the negative control', () => {
  // A check that cannot see real key material proves only that the check is broken. So the
  // fixture is a real 32-byte key, spelled seven ways, and every one of them must be caught —
  // at the root, nested inside a payload, and behind a Map, which are the three shapes a leak
  // has ever arrived in.
  for (const [encoding, spelling] of SPELLINGS) {
    it(`sees 32 bytes of key material spelled as ${encoding}`, () => {
      expect(() => assertNoKeyMaterial(spelling)).toThrow(ContentCryptoError);
      expect(() => assertNoKeyMaterial({ audit: { note: [spelling] } })).toThrow(ContentCryptoError);
      expect(() => assertNoKeyMaterial(new Map([['note', spelling]]))).toThrow(ContentCryptoError);
    });
  }

  it('catches each spelling by its own rule, not by a neighbour', () => {
    const diagnosis = (value: string): string => {
      try {
        assertNoKeyMaterial(value);
      } catch (e) {
        return (e as ContentCryptoError).message;
      }
      throw new Error('the check saw nothing, which is the failure this suite exists to catch');
    };
    expect(diagnosis(KEY_MATERIAL.toString('base64'))).toContain('padded base64');
    expect(diagnosis(KEY_MATERIAL.toString('base64').replace(/=+$/, ''))).toContain('unpadded base64');
    expect(diagnosis(KEY_MATERIAL.toString('hex'))).toContain('hexadecimal');
    expect(diagnosis(KEY_MATERIAL.toString('hex').toUpperCase())).toContain('hexadecimal');
    expect(diagnosis(KEY_MATERIAL.toString('base64url'))).toContain('base64url');
    expect(diagnosis(KEY_MATERIAL.toString('latin1'))).toContain('latin1');
    expect(diagnosis(Array.from(KEY_MATERIAL).join(','))).toContain('decimal byte values');
  });

  it('the fixture really is seven distinct spellings, so no rule passes by accident', () => {
    expect(new Set(SPELLINGS.map(([, value]) => value)).size).toBe(7);
    expect(KEY_MATERIAL).toHaveLength(32);
  });
});
