/**
 * **The leak boundary, swept.** Cross-cutting, because a key that reaches an audit payload or a
 * callback payload is the same failure as one that reaches an error, with a different name — and
 * no single module owns "nothing this package hands back contains key bytes".
 *
 * ── WHAT THIS FILE IS, AND WHAT IT IS NOT ─────────────────────────────────────────────────────
 *
 * It is NOT a second copy of `errors.test.ts`. That suite already tests `assertNoSecrets` against
 * the closed `SAFE_DETAIL_KEYS` set and `assertNoKeyMaterial` against its seven spellings, one
 * rule at a time. This file does the other half: it takes REAL objects — handles, errors, wrap
 * entries, patches, audits, callback payloads, whole sessions — pushes each through EVERY
 * serialiser a key could plausibly reach, and looks for the actual bytes.
 *
 * ── THE TWO CHECKS, AND WHY BOTH ─────────────────────────────────────────────────────────────
 *
 *  1. **The needle scan.** This suite KNOWS the key bytes — it built them — so it can look for
 *     them in seven spellings inside every rendering. That is the strongest form of the check and
 *     it is available nowhere else: production holds no fixture to compare against.
 *  2. **`expectNoKeyMaterial`**, which runs the SHIPPED guard `assertNoKeyMaterial` (owner ruling
 *     R1 promoted it out of a scratch harness into `errors.ts`, where `key-store.ts` and
 *     `custodian-cache.ts` now call it as a standing guard) plus the fixture-fragment scan. Using
 *     the shipped matcher here is the point: a weakness in the guard is a failure in this suite.
 *
 * ── THE NEGATIVE CONTROL IS MANDATORY ────────────────────────────────────────────────────────
 *
 * Every sweep in this file is run once more against real key material, and asserted to FAIL.
 * Without that, a green sweep proves only that the sweep is broken — which is exactly what a leak
 * check that has quietly stopped matching looks like from the outside.
 */

import { createHash } from 'node:crypto';
import { inspect } from 'node:util';

import { expectNoKeyMaterial, fixedDekSource, registerKeyMaterialFixture } from '../testing';
import {
  ContentCryptoError, assertNoKeyMaterial, assertNoSecrets, isContentCryptoError,
} from '../errors';
import { cachingDekSource, DEFAULT_DEK_TTL_MS } from '../custodian-cache';
import type { GraceInfo } from '../custodian-cache';
import type { DekHandle } from '../custodian';
import { dekFromBytes, isDestroyed, recordKeyFromBytes, secretBytes, zeroise } from '../secret';
import type { AccountDek, RecordKey } from '../secret';
import { aadForContent } from '../aad';
import { decryptField, encryptField } from '../field-codec';
import { encryptBlob } from '../blob-codec';
import { aggregateRecordRef } from '../key-scope';
import {
  holdersOf, unwrapRecordKey, wrapRecordKey,
} from '../record-key';
import type { RecordRef, WrapEntry } from '../record-key';
import { conflictPolicyFor, materialiseWrapPatch, planWraps } from '../wrap-patch';
import type { WrapPatch } from '../wrap-patch';
import { sealObject } from '../object-envelope';

// ---------------------------------------------------------------------------
// The key material this suite knows about
// ---------------------------------------------------------------------------

const PRODUCT = 'collab';

/**
 * DETERMINISTIC bytes, not `randomBytes` (§16.3 rule 5: no real randomness in an assertion). They
 * are hash output rather than a repeated fill, so their spellings carry no degenerate run that
 * could match an unrelated string by accident.
 */
const DEK_BYTES = createHash('sha256').update('leak.test dek b64url').digest();
const RECORD_KEY_BYTES = createHash('sha256').update('leak.test record key').digest();
const OTHER_DEK_BYTES = createHash('sha256').update('leak.test other dek').digest();

const record: RecordRef = aggregateRecordRef('project', 'p_1', 'projects/p_1');
const otherRecord: RecordRef = aggregateRecordRef('project', 'p_2', 'projects/p_2');

/**
 * The record key is built from KNOWN bytes rather than minted, precisely so this suite can spell
 * it. `recordKeyFromBytes` is module-internal — it is not on the barrel, and `index.test.ts`
 * asserts that — and a test importing it relatively is how the package's own opacity gets checked
 * at all.
 */
const recordKey: RecordKey = recordKeyFromBytes(RECORD_KEY_BYTES, record.path);
const accountDek: AccountDek = dekFromBytes(DEK_BYTES, `${PRODUCT}/A@1`);

const dekA: DekHandle = { generation: 1, key: accountDek };
const dekWrong: DekHandle = { generation: 1, key: dekFromBytes(OTHER_DEK_BYTES, `${PRODUCT}/B@1`) };

registerKeyMaterialFixture(DEK_BYTES);
registerKeyMaterialFixture(RECORD_KEY_BYTES);
registerKeyMaterialFixture(OTHER_DEK_BYTES);

/** The seven spellings of 32 bytes, which is what a leak actually looks like in a log line. */
function spellingsOf(bytes: Buffer): readonly string[] {
  return [
    bytes.toString('base64'),
    bytes.toString('base64').replace(/=+$/, ''),
    bytes.toString('base64url'),
    bytes.toString('hex'),
    bytes.toString('hex').toUpperCase(),
    bytes.toString('latin1'),
    Array.from(bytes).join(','),
  ].filter((spelling) => spelling.length > 8);
}

const NEEDLES: readonly string[] = [
  ...spellingsOf(DEK_BYTES),
  ...spellingsOf(RECORD_KEY_BYTES),
  ...spellingsOf(OTHER_DEK_BYTES),
];

// ---------------------------------------------------------------------------
// The sweep
// ---------------------------------------------------------------------------

/**
 * Every rendering of `value` a key could plausibly reach: the six rows of §5.2's measured table
 * plus the property-descriptor reads that a structured logger and an error serialiser perform.
 *
 * A serialiser that THROWS contributes the thrown thing instead, rendered the same way. That is
 * deliberate: `structuredClone` on some shapes throws, and §16.11 is explicit that the assertion
 * is *no key material survives the clone*, never *the clone throws* — asserting the throw would
 * be a brittle test of Node's structured-clone algorithm rather than of our property.
 */
function renderings(value: unknown): readonly string[] {
  const out: string[] = [];
  const push = (produce: () => unknown): void => {
    try {
      const rendered = produce();
      out.push(typeof rendered === 'string' ? rendered : String(rendered));
    } catch (err) {
      out.push(inspect(err, { depth: null, showHidden: true }));
    }
  };

  push(() => inspect(value, { depth: null, showHidden: true }));
  push(() => JSON.stringify(value));
  push(() => String(value));
  push(() => inspect({ ...(value as object) }, { depth: null, showHidden: true }));
  push(() => inspect(structuredClone(value), { depth: null, showHidden: true }));
  push(() => JSON.stringify(Object.keys(value as object)));
  push(() => JSON.stringify(Object.getOwnPropertyNames(value as object)));
  push(() => JSON.stringify(Object.getOwnPropertySymbols(value as object).map(String)));
  push(() => inspect(Object.getOwnPropertyDescriptors(value as object), { depth: null, showHidden: true }));
  push(() => {
    const toJSON = (value as { toJSON?: () => unknown } | null)?.toJSON;
    return typeof toJSON === 'function' ? JSON.stringify(toJSON.call(value)) : '';
  });
  return out;
}

/**
 * Render `value` every way and fail on any needle. A producer that throws is swept on its THROWN
 * value, because a refusal path is exactly where key material is most likely to arrive.
 *
 * This is the check that applies to EVERYTHING, including the objects a payload may legitimately
 * hold in memory but must never log.
 */
function sweepRenderings(label: string, produce: () => unknown): unknown {
  let value: unknown;
  try {
    value = produce();
  } catch (err) {
    value = err;
  }
  for (const rendered of renderings(value)) {
    for (const needle of NEEDLES) {
      if (rendered.includes(needle)) {
        throw new Error(`${label}: a rendering disclosed key material: ${rendered.slice(0, 200)}`);
      }
    }
  }
  return value;
}

/**
 * The renderings sweep PLUS the shipped guard — for a value that is meant to be LOGGABLE.
 *
 * **The two are not the same check and must not be run on the same set of objects.**
 * `assertNoKeyMaterial` refuses a key handle, a `Buffer` and every `TypedArray` wherever it finds
 * one, and it is right to: a payload carrying one is a payload that will be carrying bytes the day
 * somebody gives it a `toJSON`. But a `RecordKey`, a `DekHandle` and a sealed object BODY all
 * legitimately hold exactly those things — they are values a process holds, not values a process
 * logs. So handles and buffers get `sweepRenderings` (which proves they disclose nothing under
 * every serialiser) and a separate assertion that the guard REFUSES them (which proves they may
 * not be logged); everything a product would actually put on a log line gets both.
 */
function sweep(label: string, produce: () => unknown): void {
  const value = sweepRenderings(label, produce);
  expectNoKeyMaterial(value, label);
}

/** The companion to `sweepRenderings`: the guard refuses this, and that refusal is the property. */
function expectRefusedByTheGuard(label: string, value: unknown): void {
  expect(() => assertNoKeyMaterial(value, label)).toThrow(ContentCryptoError);
}

// ---------------------------------------------------------------------------
// The sweep can see — the mandatory negative control
// ---------------------------------------------------------------------------

describe('the sweep itself, proved able to fail', () => {
  it('THE NEGATIVE CONTROL: real key material fed to the same sweep is caught', () => {
    // The one place in this package's tests where key bytes are deliberately put on a string.
    // If this ever stops throwing, every green assertion in this file is worthless.
    expect(() => sweep('control', () => secretBytes(recordKey).toString('base64'))).toThrow();
    expect(() => sweep('control', () => secretBytes(accountDek).toString('hex'))).toThrow();
    expect(() => sweep('control', () => ({ note: `dek=${DEK_BYTES.toString('base64url')}` }))).toThrow();
    expect(() => sweep('control', () => ({ bytes: Buffer.from(DEK_BYTES) }))).toThrow();
    expect(() => sweep('control', () => ({ bytes: Array.from(DEK_BYTES) }))).toThrow();
  });

  it('it catches a FRAGMENT too, which is the shape §11.3 describes and no runtime guard can see', () => {
    const fragment = DEK_BYTES.toString('base64').slice(6, 18);
    expect(() => sweep('control', () => new Error(`Unexpected token: "${fragment}..."`))).toThrow();
  });

  it('it catches material buried under a serialiser rather than at the top level', () => {
    // A `toJSON` that discloses is the exact failure mode a redaction is supposed to prevent, and
    // it is invisible to a check that only walks own properties.
    const sneaky = { toJSON: (): unknown => ({ key: DEK_BYTES.toString('base64') }) };
    expect(() => sweep('control', () => sneaky)).toThrow();
  });

  it('and it does NOT fire on an ordinary payload, so it is not simply always throwing', () => {
    expect(() => sweep('control', () => ({ accountId: 'A', scopePath: record.path }))).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// The handles
// ---------------------------------------------------------------------------

describe('key handles, through every serialiser', () => {
  it('a RecordKey discloses nothing under any rendering, and may never be logged', () => {
    sweepRenderings('recordKey', () => recordKey);
    expectRefusedByTheGuard('recordKey', recordKey);
  });

  it('an AccountDek discloses nothing under any rendering, and may never be logged', () => {
    sweepRenderings('accountDek', () => accountDek);
    expectRefusedByTheGuard('accountDek', accountDek);
  });

  it('a DekHandle — the shape a custodian returns — discloses nothing, and may never be logged', () => {
    sweepRenderings('dekHandle', () => dekA);
    expectRefusedByTheGuard('dekHandle', dekA);
  });

  it('the measured table of §5.2 holds exactly, and the redaction is the label and nothing else', () => {
    expect(Object.keys(recordKey)).toEqual([]);
    expect(Object.getOwnPropertyNames(recordKey)).toEqual([]);
    expect({ ...(recordKey as unknown as object) }).toEqual({});
    expect(JSON.stringify(recordKey)).toBe('"[redacted record-key projects/p_1]"');
    expect(`${recordKey}`).toBe('[redacted record-key projects/p_1]');
    expect(inspect(recordKey, { depth: null, showHidden: true })).toBe('[redacted record-key projects/p_1]');
  });

  it('structuredClone carries no key material across — asserted as the property, not as a throw', () => {
    const cloned = structuredClone(recordKey as unknown as Record<string, unknown>);
    // The clone is an EMPTY object, so it passes the guard as well as the needle scan — which is
    // the strongest form of "nothing survived": what came out is not merely redacted, it is empty.
    expect(cloned).toEqual({});
    sweep('structuredClone(recordKey)', () => cloned);
  });

  it('a handle nested inside an ordinary payload is still opaque, and still refused by the guard', () => {
    // The guard refuses a handle wherever it appears, even though the handle itself discloses
    // nothing: a payload carrying one is a payload that will be carrying bytes the day somebody
    // adds a `toJSON`. Two different questions, and this file asks both.
    sweepRenderings('payload with a handle', () => ({ note: 'a log line', key: recordKey }));
    expectRefusedByTheGuard('payload', { key: recordKey });
  });
});

// ---------------------------------------------------------------------------
// Every refusal path
// ---------------------------------------------------------------------------

describe('every refusal path, serialised both ways', () => {
  it('KEY_MATERIAL_DESTROYED — a zeroised handle used again', () => {
    const doomed = recordKeyFromBytes(RECORD_KEY_BYTES, record.path);
    zeroise(doomed);
    expect(isDestroyed(doomed)).toBe(true);
    sweep('KEY_MATERIAL_DESTROYED', () => encryptField(doomed, aadForContent('messages', 'm_1', 'body'), 'x'));

    let caught: unknown = null;
    try {
      encryptField(doomed, aadForContent('messages', 'm_1', 'body'), 'x');
    } catch (err) {
      caught = err;
    }
    expect(isContentCryptoError(caught, 'KEY_MATERIAL_DESTROYED')).toBe(true);
    // The message names the LABEL, which is tenancy and never key material.
    expect((caught as ContentCryptoError).message).toContain('[redacted record-key projects/p_1]');
  });

  it('RECORD_KEY_UNWRAP_FAILED — a wrap that will not open under the DEK it was handed', () => {
    const entry = wrapRecordKey({ productId: PRODUCT, dek: dekA, accountId: 'A', record, recordKey });
    sweep('RECORD_KEY_UNWRAP_FAILED', () => unwrapRecordKey({
      productId: PRODUCT, dek: dekWrong, accountId: 'A', record, wrap: entry,
    }));
    // And the same failure reached through the WRONG RECORD, which is the other half of the row.
    sweep('RECORD_KEY_UNWRAP_FAILED (moved)', () => unwrapRecordKey({
      productId: PRODUCT, dek: dekA, accountId: 'A', record: otherRecord, wrap: entry,
    }));
  });

  it('CONTENT_DECRYPT_FAILED — a value opened under the wrong record key', () => {
    const aad = aadForContent('messages', 'm_1', 'body');
    const sealed = encryptField(recordKey, aad, 'the plaintext, which must not appear either');
    const wrongKey = recordKeyFromBytes(OTHER_DEK_BYTES, otherRecord.path);
    sweep('CONTENT_DECRYPT_FAILED', () => decryptField(wrongKey, aad, sealed));

    let caught: unknown = null;
    try {
      decryptField(wrongKey, aad, sealed);
    } catch (err) {
      caught = err;
    }
    // The message is OURS and fixed: no upstream string, no ciphertext, no plaintext.
    expect(isContentCryptoError(caught, 'CONTENT_DECRYPT_FAILED')).toBe(true);
    expect((caught as ContentCryptoError).message).not.toContain(sealed);
    expect((caught as ContentCryptoError).message).not.toContain('plaintext, which must not appear');
  });

  it('a ContentCryptoError NEVER carries a cause, which is the mechanism a serialiser would walk', () => {
    const err = new ContentCryptoError('CONTENT_DECRYPT_FAILED', 'a fixed message', { scopePath: record.path });
    expect('cause' in err).toBe(false);
    expect(Object.keys(err.toJSON()).sort()).toEqual(['code', 'details', 'message']);
    // Serialised BOTH ways, which is what a structured logger and a console log do respectively.
    sweep('error.toJSON', () => err.toJSON());
    sweep('error inspected', () => err);
  });

  it('an upstream error quoting key material cannot ride into one of ours, because there is no chain', () => {
    // The §11.3 leak, staged: a library error whose message quotes a DEK. Our error is built from
    // a CODE, never from that object, so the quoted bytes have nowhere to travel.
    const upstream = new SyntaxError(`Unexpected token in JSON: "${DEK_BYTES.toString('base64')}"`);
    expect(() => expectNoKeyMaterial(upstream, 'upstream')).toThrow();   // the control: it IS in there
    const ours = new ContentCryptoError('KEY_SOURCE_UNAVAILABLE', 'the content key source could not be reached');
    sweep('classified, not wrapped', () => ours);
    expect('cause' in ours).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Wraps, patches and audits
// ---------------------------------------------------------------------------

describe('the wrap layer — entries, patches and the audit payload', () => {
  const entry: WrapEntry = wrapRecordKey({
    productId: PRODUCT, dek: dekA, accountId: 'A', record, recordKey, now: () => new Date('2026-01-01T00:00:00.000Z'),
  });

  it('a WrapEntry carries ciphertext and a label, and nothing else', () => {
    sweep('wrapEntry', () => entry);
    expect(Object.keys(entry).sort()).toEqual(['at', 'gen', 'wrapped']);
    // The wrapped record key IS the record key, sealed — so the sweep passing here is a real
    // statement about the cipher and not about the shape.
    expect(entry.wrapped.startsWith('wrap:v1:')).toBe(true);
  });

  const plan = (desired: Record<string, DekHandle>, scope?: 'this-record'): WrapPatch => planWraps({
    current: { A: entry },
    desired,
    recordKey,
    productId: PRODUCT,
    record,
    granularity: 'aggregate',
    actorAccountId: 'A',
    scope,
    now: () => new Date('2026-01-02T00:00:00.000Z'),
  });

  it('every transition\'s patch and audit is clean: grant, revoke, rotate, transfer and erase', () => {
    const dekB: DekHandle = { generation: 1, key: dekFromBytes(OTHER_DEK_BYTES, `${PRODUCT}/B@1`) };
    const dekA2: DekHandle = { generation: 2, key: dekFromBytes(DEK_BYTES, `${PRODUCT}/A@2`) };

    const transitions: ReadonlyArray<[string, WrapPatch]> = [
      ['grant', plan({ A: dekA, B: dekB }, 'this-record')],
      ['revoke', plan({ A: dekA })],
      ['transfer', plan({ B: dekB }, 'this-record')],
      ['rotate', plan({ A: dekA2 })],
      ['erase', plan({})],
    ];

    for (const [name, patch] of transitions) {
      sweep(`patch:${name}`, () => patch);
      sweep(`audit:${name}`, () => patch.audit);
      sweep(`update:${name}`, () => materialiseWrapPatch(patch, { deleteField: '<<delete>>' }));
      sweep(`policy:${name}`, () => conflictPolicyFor(patch));
    }

    // The erase case is the one an operator's page renders, so it is worth naming: it carries the
    // record's path and the holder sets, all of which are tenancy rather than key material.
    const erase = transitions[4][1];
    expect(erase.deleteRecord).toBe(true);
    expect(erase.holdersAfter).toEqual([]);
  });

  it('a WrapAudit is scalars, string arrays and a RecordRef — asserted as an EQUALITY on its keys', () => {
    // **This is the SHAPE backstop, beside the standing guard rather than instead of it.**
    // `planWraps` now runs `assertNoKeyMaterial` over `audit` and `update` before it returns, so
    // key BYTES are refused at the point of production. This equality catches the other half: a
    // new field arriving at all — one holding something that is not key material but is still
    // nobody's business on a log line. See this file's closing note.
    const patch = plan({ A: dekA });
    expect(Object.keys(patch.audit).sort()).toEqual([
      'actorAccountId', 'at', 'cutOff', 'diff', 'granularity', 'holdersAfter', 'holdersBefore',
      'productId', 'record', 'scope',
    ]);
    expect(Object.keys(patch.audit.diff).sort()).toEqual(['added', 'removed', 'rewrapped', 'unchanged']);
    expect(Object.keys(patch.audit.record).sort()).toEqual(['id', 'path', 'type']);
    expect(() => assertNoKeyMaterial(patch.audit, 'audit')).not.toThrow();
  });

  it('the holder predicates hand back account ids and never anything derived from a key', () => {
    sweep('holdersOf', () => holdersOf({ A: entry }));
    expect(holdersOf({ A: entry })).toEqual(['A']);
  });
});

// ---------------------------------------------------------------------------
// The standing guards, proved to fire
// ---------------------------------------------------------------------------

describe('the standing guards that R1 put in production, proved to fire', () => {
  it('assertNoKeyMaterial refuses a key handle, raw bytes and every spelling, naming the PATH not the value', () => {
    const dekText = DEK_BYTES.toString('base64');
    let caught: ContentCryptoError | null = null;
    try {
      assertNoKeyMaterial({ audit: { rows: [{ note: dekText }] } }, 'patch');
    } catch (err) {
      caught = err as ContentCryptoError;
    }
    expect(caught?.code).toBe('VALIDATION_ERROR');
    expect(caught?.message).toContain('patch.audit.rows[0].note');
    expect(caught?.message).not.toContain(dekText);
  });

  it('assertNoSecrets refuses a detail bag holding key material, and says which spelling it saw', () => {
    let caught: ContentCryptoError | null = null;
    try {
      assertNoSecrets({ scopePath: DEK_BYTES.toString('base64url') });
    } catch (err) {
      caught = err as ContentCryptoError;
    }
    // R2: base64url is the fourth spelling, taken with its false positive, and the DIAGNOSIS
    // travels with the refusal so whoever hits it can tell in one read whether it is real.
    expect(caught?.message).toContain('base64url');
    expect(caught?.message).toContain('legitimate identifier');
    expect(caught?.message).not.toContain(DEK_BYTES.toString('base64url'));
  });

  it('a ContentCryptoError cannot be CONSTRUCTED with key material in its details', () => {
    // The guard runs in the constructor, so there is no window in which such an error exists.
    expect(() => new ContentCryptoError('VALIDATION_ERROR', 'x', { scopePath: DEK_BYTES.toString('hex') }))
      .toThrow(ContentCryptoError);
    expect(() => new ContentCryptoError(
      'VALIDATION_ERROR', 'x', { path: DEK_BYTES } as unknown as Record<string, string>,
    )).toThrow(ContentCryptoError);
  });
});

// ---------------------------------------------------------------------------
// Callback payloads
// ---------------------------------------------------------------------------

describe('callback payloads — the surface an error check would miss entirely', () => {
  it('a GraceInfo handed to onGraceServe carries counts, labels and a closed reason', async () => {
    let clock = 0;
    let failing = false;
    const served: GraceInfo[] = [];

    const inner = fixedDekSource({
      productId: PRODUCT,
      keys: { A: { 1: DEK_BYTES } },
      fail: () => (failing
        ? new ContentCryptoError('KEY_SOURCE_UNAVAILABLE', 'the custodian could not be reached')
        : null),
    });
    const cached = cachingDekSource(inner, {
      productId: PRODUCT,
      now: () => clock,
      onGraceServe: (info) => served.push(info),
    });

    await cached.getDek('A', 1);
    failing = true;
    clock += DEFAULT_DEK_TTL_MS + 1;
    const handle = await cached.getDek('A', 1);

    expect(served).toHaveLength(1);
    expect(served[0].reason).toBe('http-5xx');
    // The payload, the handle it served, and the cache's own stats — every one of which is the
    // kind of object that ends up on a log line or a /healthz response.
    sweep('graceInfo', () => served[0]);
    sweep('cache stats', () => cached.stats());
    // The handle it served holds a key, so it gets the renderings sweep and the guard's refusal —
    // it is a value the request holds, never a value the request logs.
    sweepRenderings('graced handle', () => handle);
    expectRefusedByTheGuard('graced handle', handle);
    expect(Object.keys(served[0]).sort()).toEqual(['accountId', 'ageMs', 'code', 'generation', 'productId', 'reason', 'status']);
  });

  it('the refusal when grace runs out is ours, and carries no upstream string', async () => {
    const clock = 0;
    const inner = fixedDekSource({
      productId: PRODUCT,
      keys: { A: { 1: DEK_BYTES } },
      fail: () => new ContentCryptoError(
        'KEY_SOURCE_UNAVAILABLE',
        // An upstream message quoting a DEK, which is the §11.3 shape exactly.
        `upstream said: ${DEK_BYTES.toString('base64')}`,
      ),
    });
    const cached = cachingDekSource(inner, {
      productId: PRODUCT, now: () => clock, onGraceServe: () => undefined,
    });

    let caught: unknown = null;
    try {
      await cached.getDek('A', 1);
    } catch (err) {
      caught = err;
    }
    // The cache CLASSIFIES rather than wraps — `check-mirror.js` assertion (11) forbids the token
    // `.message` in that file for exactly this reason — so the upstream string does not travel.
    expect(isContentCryptoError(caught)).toBe(true);
    sweep('grace exhausted', () => caught);
  });
});

// ---------------------------------------------------------------------------
// Everything the package hands a product back
// ---------------------------------------------------------------------------

describe('the objects a product actually receives', () => {
  it('a sealed field, a sealed blob and a sealed object envelope disclose nothing', () => {
    const aad = aadForContent('messages', 'm_1', 'body');
    sweep('sealed field', () => encryptField(recordKey, aad, 'client content'));
    sweep('sealed blob', () => encryptBlob(recordKey, aadForContent('messages', 'm_1', 'payload'), {
      items: [{ transcript: 'client content' }],
    }));
    // The object seal returns its ciphertext as a BUFFER, and the guard refuses a Buffer wherever
    // it appears — correctly, because it cannot tell ciphertext bytes from key bytes and must not
    // try. So the body gets the renderings sweep; its metadata, which is what reaches a log, gets
    // the full one.
    sweepRenderings('sealed object', () => sealObject(
      recordKey, { bucket: 'acme-morph', path: 'objects/a.bin' }, record.path, Buffer.from('client content'),
    ));
  });

  it('the object envelope metadata carries an IV, a tag and a scopePath — tenancy, never a key', () => {
    const { metadata } = sealObject(
      recordKey, { bucket: 'acme-morph', path: 'objects/a.bin' }, record.path, Buffer.from('x'),
    );
    sweep('object metadata', () => metadata);
    // `x-xbg-rec` leaks the record's PATH, which is a documented and accepted disclosure (§10.2)
    // and is not key material. Pinned so a reader knows it is deliberate.
    expect(metadata['x-xbg-rec']).toBe('projects/p_1');
  });

  it('a fixedDekSource, which is the one object in the tree built FROM raw bytes, discloses nothing', () => {
    sweep('fixedDekSource', () => fixedDekSource({ productId: PRODUCT, keys: { A: { 1: DEK_BYTES } } }));
  });
});

/**
 * ── THE STANDING GUARDS, AND WHERE THEY ARE ───────────────────────────────────────────────────
 *
 * Every structured payload this package hands back for logging is guarded at the point it is
 * PRODUCED, not merely swept here: `key-store.ts`'s `assertKeyPatch` runs `assertNoKeyMaterial`
 * over `patch.key`, every `GenerationPatch.set` and `patch.audit`; `custodian-cache.ts` runs it
 * over every `GraceInfo` before `onGraceServe`; `key-lifecycle.ts` runs it over a rotation error
 * string; and `wrap-patch.ts` runs it over `audit` and `update` before `planWraps` returns.
 *
 * That last one closed the gap this note used to describe. It matters because the sweeps above
 * are POINT-IN-TIME — they prove the tree was clean the day somebody ran this suite, in this
 * repo. The guard in `planWraps` is what refuses on the spot, in the five products that consume
 * the package and never run this file. The key-set equality in "a WrapAudit is scalars, string
 * arrays and a RecordRef" stays as the shape backstop: the guard catches key BYTES, the equality
 * catches a new field arriving at all, which is the day somebody should be asking the question.
 */
