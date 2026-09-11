/**
 * `secret.test.ts` — opacity under every serialiser, `zeroise`, and the branding (§16.11).
 *
 * The suite is written as a leak test rather than as a unit test, because the failure this
 * module exists to prevent is not "the getter returned the wrong thing": it is 32 bytes of
 * AES key sitting in Cloud Logging forever. So every row of §5.2's measured table is
 * asserted, and each is asserted against the ACTUAL key bytes in both of their canonical
 * spellings — base64 and hex — rather than against a redaction string, so a future
 * implementation that redacts *differently* still fails if the material survives anywhere.
 *
 * Two deliberate choices worth stating:
 *
 *  - **`structuredClone` is asserted to carry no key material, never to throw** (R1). It does
 *    not throw — measured on Node v22.20.0, it returns `{}`. Asserting the throw would be a
 *    brittle test of Node's structured-clone algorithm rather than of our property.
 *  - **Nothing here asserts emit shape** (§16.3): no `getOwnPropertyNames` of the prototype,
 *    no `__classPrivateFieldGet`. `Object.getOwnPropertyNames` of an INSTANCE is a statement
 *    about the public surface and holds identically at es2017 and es2022, which is what makes
 *    this file mirrorable.
 *
 * Errors are asserted by `code`, not by class, so this suite states the contract of
 * `secret.ts` and leaves the contract of `ContentCryptoError` to `errors.test.ts`.
 */

import { inspect } from 'node:util';

import {
  dekFromBytes,
  isDestroyed,
  isSecret,
  KEY_BYTES,
  MAX_SEALS_PER_KEY,
  recordKeyFromBytes,
  secretBytes,
  zeroise,
  type AccountDek,
  type RecordKey,
  type Secret,
} from '../secret';

/** Fixed, never random: a flaky assertion in the mirrored copy is the one nobody is watching. */
const KEY = Buffer.alloc(KEY_BYTES, 0x5a);
const KEY_B64 = KEY.toString('base64');
const KEY_HEX = KEY.toString('hex');

const DEK_IDENTITY = 'collab/acc_1@3';
const DEK_LABEL = 'dek collab/acc_1@3';
const DEK_REDACTION = '[redacted dek collab/acc_1@3]';

const RECORD_IDENTITY = 'projects/p_1';
const RECORD_REDACTION = '[redacted record-key projects/p_1]';

const newDek = (): AccountDek => dekFromBytes(KEY, DEK_IDENTITY);
const newRecordKey = (): RecordKey => recordKeyFromBytes(KEY, RECORD_IDENTITY);

/** The code carried by a ContentCryptoError, read without importing the class. */
const codeOf = (thrown: unknown): unknown => (thrown as { code?: unknown }).code;

function expectThrowsCode(fn: () => unknown, code: string): void {
  let thrown: unknown;
  try {
    fn();
  } catch (err) {
    thrown = err;
  }
  expect(thrown).toBeInstanceOf(Error);
  expect(codeOf(thrown)).toBe(code);
}

/**
 * A deliberately naive serialiser: the shape of the thing that leaks. It walks own enumerable
 * properties, arrays, `Map`/`Set` and — the §11.3 path — `cause`, collecting every string it
 * can produce. If a key can reach a log through a helper somebody wrote in an afternoon, it
 * reaches it through this.
 */
function collectStrings(value: unknown, out: string[] = [], depth = 0): string[] {
  if (depth > 8 || value === null || value === undefined) return out;
  if (typeof value === 'string') {
    out.push(value);
    return out;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    out.push(String(value));
    return out;
  }
  if (typeof value === 'bigint' || typeof value === 'symbol' || typeof value === 'function') {
    out.push(String(value));
    return out;
  }
  // An object: everything a log helper would try.
  out.push(String(value));
  out.push(inspect(value, { depth: null, showHidden: true }));
  try {
    out.push(JSON.stringify(value) ?? '');
  } catch {
    /* circular — a real serialiser would give up here too */
  }
  if (value instanceof Uint8Array) {
    out.push(Buffer.from(value).toString('base64'), Buffer.from(value).toString('hex'));
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out, depth + 1);
    return out;
  }
  if (value instanceof Map) {
    for (const [k, v] of value) {
      collectStrings(k, out, depth + 1);
      collectStrings(v, out, depth + 1);
    }
    return out;
  }
  if (value instanceof Set) {
    for (const item of value) collectStrings(item, out, depth + 1);
    return out;
  }
  for (const key of Object.keys(value as object)) {
    collectStrings((value as Record<string, unknown>)[key], out, depth + 1);
  }
  const cause: unknown = (value as { cause?: unknown }).cause;
  if (cause !== undefined) collectStrings(cause, out, depth + 1);
  return out;
}

function expectNoKeyBytes(strings: readonly string[]): void {
  for (const s of strings) {
    expect(s).not.toContain(KEY_B64);
    expect(s).not.toContain(KEY_HEX);
    // The unpadded spelling, and the first half of each, so a truncated copy is caught too.
    expect(s).not.toContain(KEY_B64.replace(/=+$/, ''));
    expect(s).not.toContain(KEY_HEX.slice(0, 32));
  }
}

describe('the constants', () => {
  it('KEY_BYTES is 32, which is AES-256 and is not negotiable', () => {
    expect(KEY_BYTES).toBe(32);
  });

  it('MAX_SEALS_PER_KEY is 2 ** 32 — the IV budget a consumer reasons about (Q-IV)', () => {
    // No test can reach 2^32 seals; the constant is exported so a consumer can do the
    // arithmetic, and asserted here so it cannot be quietly changed.
    expect(MAX_SEALS_PER_KEY).toBe(2 ** 32);
    expect(MAX_SEALS_PER_KEY).toBe(4294967296);
  });
});

describe('constructing a handle', () => {
  it('labels a DEK and a record key with the kind and the identity', () => {
    expect(newDek().label).toBe(DEK_LABEL);
    expect(newRecordKey().label).toBe('record-key projects/p_1');
  });

  it('reports its kind and its byte length', () => {
    expect(newDek().kind).toBe('dek');
    expect(newRecordKey().kind).toBe('record-key');
    expect(newDek().byteLength).toBe(32);
  });

  it('does not double the prefix when the caller passes a whole label', () => {
    // Both spellings are natural at a call site; `dek dek collab/acc_1@3` in a log is not.
    expect(dekFromBytes(KEY, DEK_LABEL).label).toBe(DEK_LABEL);
  });

  it('trims the identity, so a stray newline cannot break a log line', () => {
    expect(dekFromBytes(KEY, '  collab/acc_1@3  ').label).toBe(DEK_LABEL);
  });

  it('refuses an empty identity: a handle that prints as nothing is a handle nobody can trace', () => {
    expectThrowsCode(() => dekFromBytes(KEY, ''), 'VALIDATION_ERROR');
    expectThrowsCode(() => dekFromBytes(KEY, '   '), 'VALIDATION_ERROR');
  });

  it('refuses anything that is not exactly 32 bytes', () => {
    expectThrowsCode(() => dekFromBytes(Buffer.alloc(16, 0x5a), DEK_IDENTITY), 'VALIDATION_ERROR');
    expectThrowsCode(() => dekFromBytes(Buffer.alloc(33, 0x5a), DEK_IDENTITY), 'VALIDATION_ERROR');
    expectThrowsCode(() => dekFromBytes(Buffer.alloc(0), DEK_IDENTITY), 'VALIDATION_ERROR');
  });

  it('names the length in the message, and never the bytes', () => {
    let message = '';
    try {
      dekFromBytes(Buffer.alloc(16, 0x5a), DEK_IDENTITY);
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain('16');
    expect(message).toContain('32');
    expectNoKeyBytes([message]);
    expect(message).not.toContain(Buffer.alloc(16, 0x5a).toString('base64'));
  });

  it('refuses a non-buffer', () => {
    expectThrowsCode(() => dekFromBytes(KEY_B64 as unknown as Buffer, DEK_IDENTITY), 'VALIDATION_ERROR');
    expectThrowsCode(() => dekFromBytes(null as unknown as Buffer, DEK_IDENTITY), 'VALIDATION_ERROR');
    expectThrowsCode(() => dekFromBytes(undefined as unknown as Buffer, DEK_IDENTITY), 'VALIDATION_ERROR');
    expectThrowsCode(
      () => dekFromBytes({ length: 32 } as unknown as Buffer, DEK_IDENTITY),
      'VALIDATION_ERROR',
    );
  });

  it('accepts a plain Uint8Array, because that is what a base64 decode elsewhere may hand it', () => {
    const view = new Uint8Array(KEY);
    expect(secretBytes(dekFromBytes(view, DEK_IDENTITY)).equals(KEY)).toBe(true);
  });

  it('COPIES the bytes: the caller keeps no view into the handle', () => {
    const caller = Buffer.alloc(KEY_BYTES, 0x5a);
    const dek = dekFromBytes(caller, DEK_IDENTITY);
    caller.fill(0xff);                                  // the caller reuses or wipes its own buffer
    expect(secretBytes(dek).equals(KEY)).toBe(true);
    expect(secretBytes(dek)).not.toBe(caller);
  });
});

describe('the accessor', () => {
  it('returns the key material to a caller inside the package', () => {
    expect(secretBytes(newDek()).equals(KEY)).toBe(true);
  });

  it('returns the LIVE buffer, not a copy — a copy is a second key zeroise cannot reach', () => {
    const dek = newDek();
    expect(secretBytes(dek)).toBe(secretBytes(dek));
  });

  it('refuses anything that is not a handle', () => {
    expectThrowsCode(() => secretBytes(KEY as unknown as Secret<string>), 'VALIDATION_ERROR');
    expectThrowsCode(
      () => secretBytes({ kind: 'dek', label: DEK_LABEL } as unknown as Secret<string>),
      'VALIDATION_ERROR',
    );
  });
});

describe('isSecret', () => {
  it('is true for a handle of either kind', () => {
    expect(isSecret(newDek())).toBe(true);
    expect(isSecret(newRecordKey())).toBe(true);
  });

  it('is false for a look-alike with the same four accessors', () => {
    // This is the case that matters: `assertNoSecrets` leans on `isSecret` as its first rule,
    // so an answer derived from shape rather than identity would let a hand-rolled object
    // holding real bytes past the boundary.
    const lookAlike = {
      kind: 'dek',
      label: DEK_LABEL,
      byteLength: 32,
      destroyed: false,
      toJSON: () => DEK_REDACTION,
      toString: () => DEK_REDACTION,
    };
    expect(isSecret(lookAlike)).toBe(false);
  });

  it('is false for everything else a walker will meet', () => {
    for (const value of [null, undefined, 0, '', KEY_B64, KEY, new Uint8Array(32), {}, [], new Map()]) {
      expect(isSecret(value)).toBe(false);
    }
  });
});

describe('opacity — the seven rows of the measured table', () => {
  it('has no own properties, so Object.keys and getOwnPropertyNames are empty', () => {
    const dek = newDek();
    expect(Object.keys(dek)).toEqual([]);
    expect(Object.getOwnPropertyNames(dek)).toEqual([]);
    expect(Object.getOwnPropertySymbols(dek)).toEqual([]);
  });

  it('spreads to {}', () => {
    expect({ ...newDek() }).toEqual({});
    expect(Object.assign({}, newDek())).toEqual({});
  });

  it('structuredClone SUCCEEDS and carries no key material — it does not throw (R1)', () => {
    const clone = structuredClone(newDek()) as unknown as Record<string, unknown>;
    expect(Object.keys(clone)).toEqual([]);
    expectNoKeyBytes(collectStrings(clone));
  });

  it('util.inspect prints the redaction, at any depth and with showHidden', () => {
    const dek = newDek();
    expect(inspect(dek)).toBe(DEK_REDACTION);
    expect(inspect(dek, { depth: null, showHidden: true })).toBe(DEK_REDACTION);
    expect(inspect({ dek }, { depth: null, showHidden: true })).toContain(DEK_REDACTION);
    expectNoKeyBytes([inspect(dek, { depth: null, showHidden: true })]);
    expectNoKeyBytes([inspect({ nested: { dek } }, { depth: null, showHidden: true })]);
  });

  it('JSON.stringify prints the redaction, bare and nested', () => {
    expect(JSON.stringify(newDek())).toBe(`"${DEK_REDACTION}"`);
    expect(JSON.stringify({ dek: newDek() })).toBe(`{"dek":"${DEK_REDACTION}"}`);
    expect(JSON.stringify([newRecordKey()])).toBe(`["${RECORD_REDACTION}"]`);
  });

  it('string interpolation and String() print the redaction', () => {
    const dek = newDek();
    expect(`${dek}`).toBe(DEK_REDACTION);
    expect(String(dek)).toBe(DEK_REDACTION);
    expect([dek].join('')).toBe(DEK_REDACTION);
    expect(`${newRecordKey()}`).toBe(RECORD_REDACTION);
  });

  it('carries the Secret toStringTag', () => {
    expect(Object.prototype.toString.call(newDek())).toBe('[object Secret]');
  });

  it('leaks tenancy in the label, which is the deliberate trade, and nothing else', () => {
    // Stated as an assertion so the trade stays visible: productId, accountId and generation
    // are printed by design (§11.6.2). Key material is not.
    expect(DEK_REDACTION).toContain('collab');
    expect(DEK_REDACTION).toContain('acc_1');
    expect(DEK_REDACTION).toContain('@3');
  });
});

describe('opacity — the serialisers nobody declares', () => {
  it('survives a hand-rolled walker that follows cause recursively', () => {
    // The §11.3 path, built the way it actually arrives: a handle caught up in an error's
    // context object, wrapped, wrapped again. The package never sets `cause`; a consumer's
    // logger does, and this is that logger.
    const dek = newDek();
    const inner = Object.assign(new Error('unwrap failed'), { context: { dek }, keys: [dek] });
    const outer = Object.assign(new Error('request failed'), { cause: inner });
    expectNoKeyBytes(collectStrings(outer));
  });

  it('survives a payload of the kind a queue or an audit record carries', () => {
    const payload = {
      accountId: 'acc_1',
      keys: new Map([['acc_1', newDek()]]),
      handles: new Set([newRecordKey()]),
      nested: [{ deeper: { dek: newDek() } }],
    };
    expectNoKeyBytes(collectStrings(payload));
  });

  it('a destroyed handle is no more talkative than a live one', () => {
    const dek = newDek();
    zeroise(dek);
    expect(String(dek)).toBe(DEK_REDACTION);
    expect(inspect(dek, { depth: null, showHidden: true })).toBe(DEK_REDACTION);
    expectNoKeyBytes(collectStrings({ dek }));
  });
});

describe('zeroise', () => {
  it('wipes the bytes in place', () => {
    const dek = newDek();
    const live = secretBytes(dek);                       // the handle's own buffer, before the wipe
    expect(live.equals(KEY)).toBe(true);
    zeroise(dek);
    expect(live.equals(Buffer.alloc(KEY_BYTES, 0))).toBe(true);
  });

  it('marks the handle destroyed', () => {
    const dek = newDek();
    expect(isDestroyed(dek)).toBe(false);
    expect(dek.destroyed).toBe(false);
    zeroise(dek);
    expect(isDestroyed(dek)).toBe(true);
    expect(dek.destroyed).toBe(true);
  });

  it('makes every later use throw KEY_MATERIAL_DESTROYED — which is what close() means', () => {
    const key = newRecordKey();
    zeroise(key);
    expectThrowsCode(() => secretBytes(key), 'KEY_MATERIAL_DESTROYED');
  });

  it('names the handle in that error, and never the bytes', () => {
    const key = newRecordKey();
    zeroise(key);
    let message = '';
    try {
      secretBytes(key);
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain(RECORD_REDACTION);
    expectNoKeyBytes([message]);
  });

  it('is idempotent: close() may be called twice, and withRecord always closes', () => {
    const key = newRecordKey();
    zeroise(key);
    expect(() => zeroise(key)).not.toThrow();
    expect(isDestroyed(key)).toBe(true);
  });

  it('leaves the label, kind and byteLength readable, so the failure can be diagnosed', () => {
    const dek = newDek();
    zeroise(dek);
    expect(dek.label).toBe(DEK_LABEL);
    expect(dek.kind).toBe('dek');
    expect(dek.byteLength).toBe(32);
  });

  it('destroys one handle, never the handles built beside it', () => {
    // The asymmetry §5.2 insists on, in its smallest form: a cached AccountDek is shared, and
    // wiping one caller's handle must not reach into another's. Two handles over the same
    // input bytes are two allocations.
    const mine = newDek();
    const theirs = newDek();
    zeroise(mine);
    expect(isDestroyed(theirs)).toBe(false);
    expect(secretBytes(theirs).equals(KEY)).toBe(true);
  });

  it('refuses anything that is not a handle', () => {
    expectThrowsCode(() => zeroise(KEY as unknown as Secret<string>), 'VALIDATION_ERROR');
  });
});

describe('isDestroyed', () => {
  it('refuses a non-handle rather than answering a question that has no true answer', () => {
    expectThrowsCode(() => isDestroyed({} as unknown as Secret<string>), 'VALIDATION_ERROR');
    expectThrowsCode(() => isDestroyed(null as unknown as Secret<string>), 'VALIDATION_ERROR');
  });
});

describe('the phantom brand', () => {
  it('refuses in both directions', () => {
    const dek = newDek();
    const recordKey = newRecordKey();

    // @ts-expect-error an AccountDek is not a RecordKey: an account key cannot reach a content codec
    const asRecordKey: RecordKey = dek;
    // @ts-expect-error a RecordKey is not an AccountDek: a record key cannot wrap anything
    const asDek: AccountDek = recordKey;

    // Used, so the assertions above are about the types and not about an unused local.
    expect(asRecordKey.kind).toBe('dek');
    expect(asDek.kind).toBe('record-key');
  });

  it('accepts either where Secret<string> is asked for, which is what cipher.ts takes', () => {
    const anyKey: Secret<string>[] = [newDek(), newRecordKey()];
    expect(anyKey.map((k) => k.kind)).toEqual(['dek', 'record-key']);
  });
});
