/**
 * The blob codec — spec §16.4 (placement, the ceilings, the kind byte) and §16.8's blob half
 * (`applyBlobPatch`, the `subPath` semantics table, the eight real build call sites).
 *
 * The serialiser's own table and property tests live in `blob-json.test.ts` and are not repeated
 * here: this suite is about the half that holds a key. What it must prove, in the order §16.4 and
 * §16.8 name it:
 *
 *   - the two payload-kind bytes agree ACROSS the module boundary — seam (a);
 *   - the read and write sides agree about that byte, including on a deflated payload, which is
 *     the addendum's finding 3 and the one nothing before it would have caught;
 *   - the scope's adapters reach the decoder — seam (b);
 *   - a subPath is capped at the payload's depth — seam (c);
 *   - a size refusal names the document and the field — seam (d);
 *   - §8.8's placement table and §7.4's blob read rows, exhaustively, including a document with no
 *     blob path present coming back BY REFERENCE;
 *   - §8.9's `subPath` semantics, case by case, because it is what unblocks build's live dotted
 *     updates and every one of those is a read-modify-write over client content.
 */

import {
  applyBlobPatch,
  decryptBlob,
  encryptBlob,
  openBlobNode,
  payloadKindsAgree,
  sealBlobNode,
} from '../blob-codec';
import type { BlobResealRequest, BlobSite } from '../blob-codec';
import {
  DEFAULT_MAX_DEPTH,
  DEFAULT_MAX_SEALED_BYTES,
  decodeBlob,
  encodeBlob,
  firestoreTimestampAdapter,
  maxPlaintextFor,
} from '../blob-json';
import type { BlobAdapter } from '../blob-json';
import { sealBuffer } from '../cipher';
import { isContentCryptoError } from '../errors';
import {
  ENC_PREFIX_V3,
  PAYLOAD_KIND,
  decodeValue,
  decryptField,
  isSealedBlobCandidate,
} from '../field-codec';
import { blobKeyRelation, mapPathNode, parseFieldPath } from '../field-path';
// The v1/v2 prefixes are IMPORTED, never typed. Every wire prefix is declared in field-codec.ts
// and re-exported here; a hand-typed copy is a second declaration that Phase G's deletion would
// not find. A test may reach legacy-readers; a production module may not.
import { ENC_PREFIX_V1, ENC_PREFIX_V2 } from '../legacy-readers';
import { KEY_BYTES, dekFromBytes, recordKeyFromBytes } from '../secret';
import type { RecordKey } from '../secret';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const KEY_A = Buffer.alloc(KEY_BYTES, 0xa1);
const KEY_B = Buffer.alloc(KEY_BYTES, 0xb2);

const key = (bytes: Buffer = KEY_A): RecordKey => recordKeyFromBytes(bytes, 'projects/p_1');

const AAD = 'results/r_88.structuredOutput';
const OTHER_AAD = 'results/r_88.citations';

const SITE: BlobSite = { collection: 'results', docId: 'r_88', fieldPath: 'structuredOutput' };

/** The code of whatever a thunk throws, or `'(no throw)'`. Never the message. */
function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    return isContentCryptoError(err) ? err.code : `(foreign: ${String(err)})`;
  }
  return '(no throw)';
}

function thrown(fn: () => unknown): { code: string; message: string; details: unknown } {
  try {
    fn();
  } catch (err) {
    if (!isContentCryptoError(err)) throw err;
    return { code: err.code, message: err.message, details: err.details };
  }
  throw new Error('expected a throw');
}

/** A payload that certainly compresses, so `deflateOver` fires deterministically. */
const compressible = { note: 'x'.repeat(4_096), rows: Array.from({ length: 64 }, () => 'y'.repeat(64)) };

// ---------------------------------------------------------------------------
// Seam (a) — the two kind bytes, across a boundary neither module can see over
// ---------------------------------------------------------------------------

describe('seam (a): the payload-kind bytes agree across blob-json.ts and field-codec.ts', () => {
  it('is asserted at module load, and the assertion is callable', () => {
    // `blob-json.ts` restates 0x02 and 0x03 as PRIVATE literals — it is a leaf that lands three
    // build steps before `field-codec.ts` exists — and its docblock names this module as where the
    // equality is asserted. The literals cannot be compared by name, so they are compared by what
    // `encodeBlob` actually writes.
    expect(payloadKindsAgree()).toBe(true);
  });

  it('writes PAYLOAD_KIND.blobJson at index 0 of an uncompressed plaintext', () => {
    expect(encodeBlob(null)[0]).toBe(PAYLOAD_KIND.blobJson);
    expect(encodeBlob({ a: 1 })[0]).toBe(PAYLOAD_KIND.blobJson);
  });

  it('writes PAYLOAD_KIND.blobDeflate at index 0 when compression fired', () => {
    expect(encodeBlob(compressible, { deflateOver: 1 })[0]).toBe(PAYLOAD_KIND.blobDeflate);
  });

  it('pins the two bytes as 0x02 and 0x03, so a change to either file is a red test here', () => {
    expect(PAYLOAD_KIND.blobJson).toBe(0x02);
    expect(PAYLOAD_KIND.blobDeflate).toBe(0x03);
  });
});

// ---------------------------------------------------------------------------
// The wire
// ---------------------------------------------------------------------------

describe('encryptBlob / decryptBlob — one model, one wire', () => {
  it('emits an enc:v3: value that the strict decoder reads as v3 under a record key', () => {
    const sealed = encryptBlob(key(), AAD, { a: 1 });
    expect(sealed.startsWith(ENC_PREFIX_V3)).toBe(true);
    expect(decodeValue(sealed)).toMatchObject({ version: 'v3', keySource: 'record-key', generation: null });
    expect(isSealedBlobCandidate(sealed)).toBe(true);
  });

  it.each([
    ['an empty object', {}],
    ['an empty array', []],
    ['a nested map', { a: { b: [1, 2, { c: 'd' }] } }],
    ['every scalar the encoding tags', {
      minusZero: -0, nan: NaN, inf: Infinity, big: BigInt('1000000000000000000000000000000'),
      when: new Date('2026-09-11T04:05:06.007Z'), bytes: Buffer.from('hello'),
      nothing: undefined, empty: null, flag: false, text: 'enc:v3:not-really',
    }],
    ['an array root', [1, 'two', { three: 3 }]],
  ])('round-trips %s', (_label, value) => {
    const k = key();
    expect(decryptBlob(k, AAD, encryptBlob(k, AAD, value))).toStrictEqual(value);
  });

  it('produces a different ciphertext every time — a fresh IV, so there is nothing to compare', () => {
    const k = key();
    expect(encryptBlob(k, AAD, { a: 1 })).not.toBe(encryptBlob(k, AAD, { a: 1 }));
  });

  it('binds the AAD: the same bytes under a different AAD do not open', () => {
    const k = key();
    expect(codeOf(() => decryptBlob(k, OTHER_AAD, encryptBlob(k, AAD, { a: 1 }))))
      .toBe('CONTENT_DECRYPT_FAILED');
  });

  it('binds the key: another record key does not open it', () => {
    expect(codeOf(() => decryptBlob(key(KEY_B), AAD, encryptBlob(key(KEY_A), AAD, { a: 1 }))))
      .toBe('CONTENT_DECRYPT_FAILED');
  });

  it('is WRONG_KEY_LAYER, not a tag failure, for a legacy value at a blob path', () => {
    // A tag failure would read as "your data is corrupt" when the truth is "you asked the wrong
    // key layer" — only the migration reads v1/v2, and it reads them through legacy-readers.ts.
    const packed = 'AAAAAAAAAAAAAAAA:AAAA:AAAAAAAAAAAAAAAAAAAAAA==';
    expect(codeOf(() => decryptBlob(key(), AAD, `${ENC_PREFIX_V1}${packed}`))).toBe('WRONG_KEY_LAYER');
    expect(codeOf(() => decryptBlob(key(), AAD, `${ENC_PREFIX_V2}3:${packed}`))).toBe('WRONG_KEY_LAYER');
  });

  it('is WRONG_KEY_LAYER for anything that is not a well-formed sealed value', () => {
    for (const value of ['', 'enc:v3:', 'enc:v3:not:base64:here', 'a title someone typed']) {
      expect(codeOf(() => decryptBlob(key(), AAD, value))).toBe('WRONG_KEY_LAYER');
    }
  });

  it('never returns its input, exactly as decryptField never does', () => {
    // Leniency is a document-layer decision (§7.4). A codec that sometimes returns plaintext
    // cannot be reasoned about: the caller does not know whether it decrypted.
    expect(codeOf(() => decryptBlob(key(), AAD, '{"a":1}'))).toBe('WRONG_KEY_LAYER');
  });
});

// ---------------------------------------------------------------------------
// The read/write symmetry about the payload-kind byte (addendum finding 3)
// ---------------------------------------------------------------------------

describe('the kind byte survives the open — addendum finding 3', () => {
  it('round-trips a blob written with deflateOver set', () => {
    const k = key();
    const sealed = encryptBlob(k, AAD, compressible, { deflateOver: 1 });
    expect(decryptBlob(k, AAD, sealed)).toStrictEqual(compressible);
  });

  it('makes the field path and the object spill path agree on a DEFLATED payload', () => {
    // This is the whole of finding 3. `encodeBlob` returns the COMPLETE plaintext with the kind
    // byte at index 0, which is what the spill path seals (`sealObject(key, ref, scopePath,
    // encodeBlob(value))`) and what `decodeBlob` reads back for itself. The field path splits the
    // byte off to seal and must put it back on to open — before the fix `openBuffer` discarded it
    // and `decryptBlob` had to guess which of 0x02 / 0x03 it was looking at.
    const k = key();
    const opts = { deflateOver: 1 };

    const spillPlaintext = encodeBlob(compressible, opts);      // what sealObject would carry
    expect(spillPlaintext[0]).toBe(PAYLOAD_KIND.blobDeflate);
    const viaSpill = decodeBlob(spillPlaintext);                 // decodeBlob(openObject(...))

    const viaField = decryptBlob(k, AAD, encryptBlob(k, AAD, compressible, opts));

    expect(viaField).toStrictEqual(viaSpill);
    expect(viaField).toStrictEqual(compressible);
  });

  it('agrees on an UNCOMPRESSED payload too, so the symmetry is not deflate-specific', () => {
    const k = key();
    const value = { a: [1, 2, 3], b: { c: new Date(0) } };
    expect(decryptBlob(k, AAD, encryptBlob(k, AAD, value))).toStrictEqual(decodeBlob(encodeBlob(value)));
  });

  it('is CONTENT_KIND_MISMATCH, not a JSON parse failure, for a 0x01 plaintext at a blob path', () => {
    // A field value sealed under the same key and AAD. The registry refuses to register one path
    // as both a string and a blob, so this cannot arise from the package — and the kind byte is
    // what turns "a silently wrong-typed value" into a coded refusal if it ever does.
    const k = key();
    const asField = sealBuffer(k, AAD, PAYLOAD_KIND.string, Buffer.from('{"v":1,"d":{}}', 'utf8'), ENC_PREFIX_V3);
    expect(codeOf(() => decryptBlob(k, AAD, asField))).toBe('CONTENT_KIND_MISMATCH');
  });

  it('is CONTENT_KIND_MISMATCH the other way round — a blob read by the field reader', () => {
    const k = key();
    expect(codeOf(() => decryptField(k, AAD, encryptBlob(k, AAD, { a: 1 })))).toBe('CONTENT_KIND_MISMATCH');
  });

  it('is CONTENT_DECRYPT_FAILED, never partial output, for authenticated plaintext that is not {"v":1,…}', () => {
    const k = key();
    const notAPayload = sealBuffer(k, AAD, PAYLOAD_KIND.blobJson, Buffer.from('{"v":2,"d":{}}', 'utf8'), ENC_PREFIX_V3);
    expect(codeOf(() => decryptBlob(k, AAD, notAPayload))).toBe('CONTENT_DECRYPT_FAILED');
  });
});

// ---------------------------------------------------------------------------
// Seam (b) — the scope's adapters reach the decoder
// ---------------------------------------------------------------------------

/** A `Timestamp`-shaped class, so the suite needs no firebase-admin (assertion 3). */
class FakeTimestamp {
  constructor(readonly seconds: number, readonly nanoseconds: number) {}
}

describe('seam (b): the scope adapters are threaded through the read as well as the write', () => {
  const adapters: readonly BlobAdapter[] = [firestoreTimestampAdapter(FakeTimestamp as never)];
  const value = { createdAt: new FakeTimestamp(1_789_056_306, 7_000_000) };

  it('round-trips a product type when both sides get the adapters', () => {
    const k = key();
    const back = decryptBlob(k, AAD, encryptBlob(k, AAD, value, { adapters }), { adapters }) as typeof value;
    expect(back.createdAt).toBeInstanceOf(FakeTimestamp);
    expect(back.createdAt.nanoseconds).toBe(7_000_000);
  });

  it('fails loudly when the READ side is not given them — the failure seam (b) exists to close', () => {
    const k = key();
    const sealed = encryptBlob(k, AAD, value, { adapters });
    const failure = thrown(() => decryptBlob(k, AAD, sealed));
    expect(failure.code).toBe('CONTENT_DECRYPT_FAILED');
    expect(failure.message).toContain('no adapter is registered for tag "ts"');
  });

  it('threads them through applyBlobPatch as well, on both the open and the reseal', () => {
    const k = key();
    const sealed = encryptBlob(k, AAD, value, { adapters });
    const resealed = applyBlobPatch(
      k,
      { ...request(), patches: [{ op: 'set', subPath: 'label', value: 'first' }] },
      sealed,
      { adapters },
    );
    const back = decryptBlob(k, AAD, resealed, { adapters }) as { createdAt: FakeTimestamp; label: string };
    expect(back.label).toBe('first');
    expect(back.createdAt).toBeInstanceOf(FakeTimestamp);
    expect(back.createdAt.nanoseconds).toBe(7_000_000);
  });

  it('refuses a Timestamp smuggled in through a patch, with §8.4\'s message', () => {
    const k = key();
    const failure = thrown(() => applyBlobPatch(
      k,
      { ...request(), patches: [{ op: 'set', subPath: 'when', value: new FakeTimestamp(1, 2) }] },
      encryptBlob(k, AAD, {}),
    ));
    expect(failure.code).toBe('BLOB_ENCODE_FAILED');
    expect(failure.message).toContain('FakeTimestamp');
    expect(failure.message).toContain('blobAdapters');
  });
});

// ---------------------------------------------------------------------------
// The ceilings, and seam (d)
// ---------------------------------------------------------------------------

describe('§8.5 the two ceilings', () => {
  it('derives the plaintext ceiling from the sealed one, so the two cannot drift', () => {
    // 900 000 sealed is 674 960 of JSON — the pinned number, and the relation the caller gets for
    // free by naming only `maxSealedBytes`.
    expect(maxPlaintextFor(DEFAULT_MAX_SEALED_BYTES)).toBe(674_960);
    const failure = thrown(() => encryptBlob(key(), AAD, { a: 'x'.repeat(2_000) }, { maxSealedBytes: 1_000 }));
    expect(failure.code).toBe('BLOB_TOO_LARGE');
    expect(failure.details).toMatchObject({ limitBytes: maxPlaintextFor(1_000) });
  });

  it('lets an explicit plaintext ceiling win over the derived one', () => {
    const failure = thrown(() => encryptBlob(
      key(), AAD, { a: 'x'.repeat(200) }, { maxSealedBytes: 900_000, maxPlaintextBytes: 50 },
    ));
    expect(failure.details).toMatchObject({ limitBytes: 50 });
  });

  it('aborts inside the walk, naming the sub-path that crossed the line', () => {
    const failure = thrown(() => encryptBlob(
      key(), AAD, { head: 'ok', items: [{ transcript: 'x'.repeat(4_000) }] }, { maxPlaintextBytes: 500 },
    ));
    expect(failure.code).toBe('BLOB_TOO_LARGE');
    expect(failure.details).toMatchObject({ path: 'items[0].transcript', limitBytes: 500 });
  });

  it('produces no base64 when the PROJECTED sealed length exceeds the ceiling', () => {
    // §8.5 step 3: the whole point of the ceiling is to fail before a third copy of a large
    // payload exists. The plaintext budget is set out of the way so that step 3 is what fires.
    const spy = jest.spyOn(Buffer.prototype, 'toString');
    try {
      expect(codeOf(() => encryptBlob(
        key(), AAD, { a: 'x'.repeat(5_000) }, { maxSealedBytes: 200, maxPlaintextBytes: 10_000_000 },
      ))).toBe('BLOB_TOO_LARGE');
      expect(spy.mock.calls.filter((call) => call[0] === 'base64')).toHaveLength(0);
    } finally {
      spy.mockRestore();
    }
  });

  it('does no seal-time check at all when no sealed ceiling was named', () => {
    // The serialiser's own default still applies; this is only about step 3, which needs a number
    // the serialiser does not carry.
    expect(() => encryptBlob(key(), AAD, { a: 'x'.repeat(5_000) })).not.toThrow();
  });
});

describe('seam (d): a size refusal names the document and the field', () => {
  it('produces §8.5\'s sentence, with the original details intact and three added', () => {
    const failure = thrown(() => encryptBlob(
      key(),
      'deliverables/d_12.structuredContent',
      { items: [{ transcript: 'x'.repeat(4_000) }] },
      { maxPlaintextBytes: 500 },
      { collection: 'deliverables', docId: 'd_12', fieldPath: 'structuredContent' },
    ));
    expect(failure.code).toBe('BLOB_TOO_LARGE');
    expect(failure.message).toMatch(
      /^blob at deliverables\/d_12\.structuredContent exceeds its plaintext budget at "items\[0\]\.transcript": \d+ bytes so far, the limit is 500\.$/,
    );
    expect(failure.details).toMatchObject({
      collection: 'deliverables', docId: 'd_12', fieldPath: 'structuredContent',
      path: 'items[0].transcript', limitBytes: 500,
    });
  });

  it('names the position on the SEAL-time refusal too, where the message is phrased differently', () => {
    const failure = thrown(() => encryptBlob(
      key(), AAD, { a: 'x'.repeat(5_000) },
      { maxSealedBytes: 200, maxPlaintextBytes: 10_000_000 },
      SITE,
    ));
    expect(failure.message.startsWith('blob at results/r_88.structuredOutput: sealing ')).toBe(true);
    expect(failure.details).toMatchObject({
      collection: 'results', docId: 'r_88', fieldPath: 'structuredOutput',
      limitBytes: 200, sealedBytes: expect.any(Number), plaintextBytes: expect.any(Number),
    });
  });

  it('carries no position when no site was supplied — the three keys are absent, not null', () => {
    const failure = thrown(() => encryptBlob(key(), AAD, { a: 'x'.repeat(4_000) }, { maxPlaintextBytes: 100 }));
    expect(Object.keys(failure.details as object).sort()).toEqual(['limitBytes', 'path', 'plaintextBytes']);
  });

  it('leaves every other code alone — a BLOB_ENCODE_FAILED is not re-wrapped', () => {
    const failure = thrown(() => encryptBlob(key(), AAD, { fn: () => 1 }, undefined, SITE));
    expect(failure.code).toBe('BLOB_ENCODE_FAILED');
    expect(failure.message.startsWith('blob at ')).toBe(false);
  });

  it('names the position on a reseal, from the request rather than from an argument', () => {
    const k = key();
    const failure = thrown(() => applyBlobPatch(
      k,
      { ...request(), patches: [{ op: 'set', subPath: 'big', value: 'x'.repeat(4_000) }] },
      encryptBlob(k, AAD, {}),
      { maxPlaintextBytes: 200 },
    ));
    expect(failure.code).toBe('BLOB_TOO_LARGE');
    expect(failure.details).toMatchObject({ collection: 'results', docId: 'r_88', fieldPath: 'structuredOutput' });
  });
});

// ---------------------------------------------------------------------------
// §8.8 placement — write
// ---------------------------------------------------------------------------

class Sentinel {
  constructor(readonly op: string) {}
}

describe('§8.8 the placement table, on write', () => {
  it.each([
    ['absent / undefined', undefined],
    ['null — "no payload", and sealing it costs a reader the ability to see absence', null],
  ])('skips %s, returning the node by reference', (_label, node) => {
    expect(sealBlobNode(key(), AAD, node, SITE)).toBe(node);
  });

  it.each([
    ['a plain object', { a: 1 }],
    ['an array', [1, 2]],
    ['the EMPTY object — a real value whose absence is a different fact', {}],
    ['the EMPTY array', []],
  ])('seals %s', (_label, node) => {
    const k = key();
    const out = sealBlobNode(k, AAD, node, SITE);
    expect(typeof out).toBe('string');
    expect(isSealedBlobCandidate(out)).toBe(true);
    expect(decryptBlob(k, AAD, out as string)).toStrictEqual(node);
  });

  it('seals a null-prototype map, which inside a blob is a legitimate free-form map', () => {
    // The plain-object test at a blob ROOT is one notch looser than `field-path.ts`'s
    // `isPlainObject`, and identical to the one `blob-json.ts` uses INSIDE a blob — because a blob
    // root is inside the blob. It comes back with `Object.prototype`, which is one of the
    // serialiser's three documented asymmetries and is asserted here rather than smoothed over.
    const k = key();
    const node = Object.assign(Object.create(null) as object, { a: 1 });
    const back = decryptBlob(k, AAD, sealBlobNode(k, AAD, node, SITE) as string);
    expect(back).toEqual({ a: 1 });
    expect(Object.getPrototypeOf(back)).toBe(Object.prototype);
  });

  it('is BLOB_ALREADY_SEALED for a well-formed v3 ciphertext — never a double envelope', () => {
    const k = key();
    const failure = thrown(() => sealBlobNode(k, AAD, encryptBlob(k, AAD, { a: 1 }), SITE));
    expect(failure.code).toBe('BLOB_ALREADY_SEALED');
    expect(failure.message).toContain('results/r_88.structuredOutput');
    expect(failure.details).toMatchObject({ collection: 'results', docId: 'r_88', fieldPath: 'structuredOutput' });
  });

  it.each([
    ['a number', 42],
    ['a boolean', true],
    ['a Date', new Date(0)],
    ['a bigint', BigInt(7)],
    ['a non-ciphertext string', 'hello'],
    ['a string that merely starts enc:v3:', 'enc:v3: something a user typed'],
    ['bytes — a value, not an instruction, and leaving them unsealed is the leak the registry exists to stop', Buffer.from('hi')],
  ])('is BLOB_ENCODE_FAILED for %s at a blob path', (_label, node) => {
    const failure = thrown(() => sealBlobNode(key(), AAD, node, SITE));
    expect(failure.code).toBe('BLOB_ENCODE_FAILED');
    expect(failure.details).toMatchObject({ fieldPath: 'structuredOutput' });
  });

  it('steps over an object it cannot name — a FieldValue sentinel survives the walk', () => {
    // The package cannot import the class, so the rule is inverted: values the codec can NAME are
    // refused, and an unrecognised object is assumed to be an instruction. Widening this is how a
    // sentinel silently becomes `{}` on its way to a write.
    const sentinel = new Sentinel('delete');
    expect(sealBlobNode(key(), AAD, sentinel, SITE)).toBe(sentinel);
  });

  it('always encrypts, including a plaintext that happens to look like data already written', () => {
    const k = key();
    const out = sealBlobNode(k, AAD, { text: 'enc:v3:AAAA' }, SITE);
    expect(decryptBlob(k, AAD, out as string)).toStrictEqual({ text: 'enc:v3:AAAA' });
  });
});

// ---------------------------------------------------------------------------
// §7.4 placement — read
// ---------------------------------------------------------------------------

describe('§7.4 the blob read rows', () => {
  it.each([['undefined', undefined], ['null', null]])('leaves %s untouched in both modes', (_label, node) => {
    expect(openBlobNode(key(), AAD, node, SITE, 'strict')).toBe(node);
    expect(openBlobNode(key(), AAD, node, SITE, 'lenient')).toBe(node);
  });

  it('opens a well-formed v3 ciphertext in both modes', () => {
    const k = key();
    const sealed = encryptBlob(k, AAD, { a: 1 });
    expect(openBlobNode(k, AAD, sealed, SITE, 'strict')).toStrictEqual({ a: 1 });
    expect(openBlobNode(k, AAD, sealed, SITE, 'lenient')).toStrictEqual({ a: 1 });
  });

  it('is CONTENT_DECRYPT_FAILED for a bad tag in BOTH modes — integrity is not a mode', () => {
    const k = key();
    const sealed = encryptBlob(k, AAD, { a: 1 });
    for (const reads of ['strict', 'lenient'] as const) {
      expect(codeOf(() => openBlobNode(k, OTHER_AAD, sealed, SITE, reads))).toBe('CONTENT_DECRYPT_FAILED');
    }
  });

  it('is WRONG_KEY_LAYER for a v1/v2 value in BOTH modes', () => {
    const legacy = `${ENC_PREFIX_V2}3:AAAAAAAAAAAAAAAA:AAAA:AAAAAAAAAAAAAAAAAAAAAA==`;
    for (const reads of ['strict', 'lenient'] as const) {
      expect(codeOf(() => openBlobNode(key(), AAD, legacy, SITE, reads))).toBe('WRONG_KEY_LAYER');
    }
  });

  it.each([
    ['a plain object — the pre-migration shape', { a: 1 }],
    ['an array', [1]],
    ['a bare string', 'hello'],
    ['a number', 42],
  ])('is CONTENT_PLAINTEXT_AT_REGISTERED_PATH under strict for %s', (_label, node) => {
    const failure = thrown(() => openBlobNode(key(), AAD, node, SITE, 'strict'));
    expect(failure.code).toBe('CONTENT_PLAINTEXT_AT_REGISTERED_PATH');
    expect(failure.message).toContain('results/r_88.structuredOutput');
  });

  it('returns the same values untouched, by reference, under lenient', () => {
    const node = { a: 1 };
    expect(openBlobNode(key(), AAD, node, SITE, 'lenient')).toBe(node);
  });

  it('is idempotent under lenient — decrypting twice is decrypting once', () => {
    const k = key();
    const once = openBlobNode(k, AAD, encryptBlob(k, AAD, { a: 1 }), SITE, 'lenient');
    const twice = openBlobNode(k, AAD, once, SITE, 'lenient');
    expect(twice).toBe(once);
  });
});

// ---------------------------------------------------------------------------
// The composition doc-codec will make: mapPathNode with these as its leaf
// ---------------------------------------------------------------------------

describe('placement over a document, through mapPathNode', () => {
  const segments = parseFieldPath('payload');

  it('hands the document back BY REFERENCE when the blob path is absent', () => {
    // "a document with nothing to encrypt costs nothing and mints nothing", executable.
    const data = { status: 'open', other: { deep: [1, 2] } };
    const out = mapPathNode(data, segments, (node) => sealBlobNode(key(), AAD, node, SITE));
    expect(out).toBe(data);
  });

  it('hands it back by reference when the blob path holds null', () => {
    const data = { payload: null, status: 'open' };
    expect(mapPathNode(data, segments, (node) => sealBlobNode(key(), AAD, node, SITE))).toBe(data);
  });

  it('hands it back by reference when the blob path holds a sentinel', () => {
    const data = { payload: new Sentinel('delete') };
    expect(mapPathNode(data, segments, (node) => sealBlobNode(key(), AAD, node, SITE))).toBe(data);
  });

  it('copies only along the touched path when it does seal', () => {
    const k = key();
    const untouched = { deep: [1, 2] };
    const data = { payload: { a: 1 }, other: untouched };
    const out = mapPathNode(data, segments, (node) => sealBlobNode(k, AAD, node, SITE)) as typeof data;
    expect(out).not.toBe(data);
    expect(out.other).toBe(untouched);
    expect(decryptBlob(k, AAD, out.payload as unknown as string)).toStrictEqual({ a: 1 });
  });

  it('reaches a nested blob path and leaves its siblings alone', () => {
    const k = key();
    const nested = parseFieldPath('spec.fields');
    const data = { spec: { fields: { a: 1 }, name: 'keep' } };
    const out = mapPathNode(data, nested, (node) => sealBlobNode(k, AAD, node, SITE)) as typeof data;
    expect(out.spec.name).toBe('keep');
    expect(decryptBlob(k, AAD, out.spec.fields as unknown as string)).toStrictEqual({ a: 1 });
  });
});

// ---------------------------------------------------------------------------
// §8.9 applyBlobPatch
// ---------------------------------------------------------------------------

function request(patches: readonly BlobResealRequest['patches'][number][] = []): BlobResealRequest {
  return {
    collection: 'results', docId: 'r_88', fieldPath: 'structuredOutput', aad: AAD, patches,
  };
}

/** Open whatever `applyBlobPatch` produced, under the same AAD it was told to reseal at. */
function patched(current: unknown, ...patches: BlobResealRequest['patches'][number][]): unknown {
  const k = key();
  return decryptBlob(k, AAD, applyBlobPatch(k, request(patches), current));
}

/** A sealed payload to patch. */
function sealed(value: unknown): string {
  return encryptBlob(key(), AAD, value);
}

describe('applyBlobPatch — the four shapes of `current`', () => {
  it('opens an EncryptedBlob under req.aad and reseals at the same AAD', () => {
    const k = key();
    const out = applyBlobPatch(k, request([{ op: 'set', subPath: 'a', value: 2 }]), sealed({ a: 1 }));
    expect(decryptBlob(k, AAD, out)).toStrictEqual({ a: 2 });
    // The same value under any other AAD does not open, which is the AAD doing its job.
    expect(codeOf(() => decryptBlob(k, OTHER_AAD, out))).toBe('CONTENT_DECRYPT_FAILED');
  });

  it('refuses a value sealed under a DIFFERENT AAD, at the open rather than at the reseal', () => {
    const k = key();
    const elsewhere = encryptBlob(k, OTHER_AAD, { a: 1 });
    expect(codeOf(() => applyBlobPatch(k, request([{ op: 'set', subPath: 'a', value: 2 }]), elsewhere)))
      .toBe('CONTENT_DECRYPT_FAILED');
  });

  it('patches a pre-migration plain object as it stands, so patch and migration are one write', () => {
    expect(patched({ a: 1, keep: true }, { op: 'set', subPath: 'a', value: 2 }))
      .toStrictEqual({ a: 2, keep: true });
  });

  it('does not mutate the caller\'s pre-migration object', () => {
    // A caller that read the payload out of a snapshot must not find its own object changed
    // underneath it when the transaction retries.
    const current = { a: 1, nested: { deep: [1, 2] } };
    patched(current, { op: 'set', subPath: 'nested.deep[0]', value: 9 });
    expect(current).toStrictEqual({ a: 1, nested: { deep: [1, 2] } });
  });

  it.each([['undefined', undefined], ['null', null]])('creates the root from %s — {} when the first segment is a key', (_label, current) => {
    expect(patched(current, { op: 'set', subPath: 'a.b', value: 1 })).toStrictEqual({ a: { b: 1 } });
  });

  it('creates the root as [] when the first segment is an index — a blob root may be an array', () => {
    expect(patched(undefined, { op: 'set', subPath: '[0].name', value: 'x' }))
      .toStrictEqual([{ name: 'x' }]);
  });

  it.each([
    ['a bare string', 'hello'],
    ['a number', 7],
    ['a Date', new Date(0)],
  ])('is BLOB_ENCODE_FAILED for %s as `current`', (_label, current) => {
    expect(codeOf(() => patched(current, { op: 'set', subPath: 'a', value: 1 }))).toBe('BLOB_ENCODE_FAILED');
  });
});

describe('applyBlobPatch — `set`, case by case', () => {
  it('assigns at a terminal key, creating or replacing', () => {
    expect(patched(sealed({}), { op: 'set', subPath: 'a', value: 1 })).toStrictEqual({ a: 1 });
    expect(patched(sealed({ a: 1 }), { op: 'set', subPath: 'a', value: 2 })).toStrictEqual({ a: 2 });
  });

  it('creates intermediates for KEY segments and only for key segments', () => {
    expect(patched(sealed({}), { op: 'set', subPath: 'a.b.c', value: 1 }))
      .toStrictEqual({ a: { b: { c: 1 } } });
  });

  it('refuses an intermediate index whose parent is absent — auto-vivifying needs holes', () => {
    const failure = thrown(() => patched(sealed({}), { op: 'set', subPath: 'a[0].b', value: 1 }));
    expect(failure.code).toBe('BLOB_SUBPATH_INVALID');
    expect(failure.message).toContain('an index never creates one');
  });

  it('refuses an intermediate index whose parent is not an array', () => {
    expect(codeOf(() => patched(sealed({ a: { b: 1 } }), { op: 'set', subPath: 'a[0]', value: 1 })))
      .toBe('BLOB_SUBPATH_INVALID');
  });

  it('refuses to traverse a scalar — Firestore clobbers here and we do not', () => {
    const failure = thrown(() => patched(sealed({ a: { b: 'text' } }), { op: 'set', subPath: 'a.b.c', value: 1 }));
    expect(failure.code).toBe('BLOB_SUBPATH_INVALID');
    expect(failure.message).toContain('traverses a string at "a.b"');
  });

  it('replaces element n when n < length', () => {
    expect(patched(sealed({ xs: [1, 2, 3] }), { op: 'set', subPath: 'xs[1]', value: 9 }))
      .toStrictEqual({ xs: [1, 9, 3] });
  });

  it('appends when n === length — the one auto-extension, and it produces no hole', () => {
    expect(patched(sealed({ xs: [1, 2] }), { op: 'set', subPath: 'xs[2]', value: 3 }))
      .toStrictEqual({ xs: [1, 2, 3] });
  });

  it('extends by one at an INTERMEDIATE index too, which is what makes `[0].name` work on a fresh root', () => {
    // The same fact in both positions: appending element `length` produces no hole. It is what
    // §8.9's `current` rule needs — a root created as `[]` and then addressed at `[0]`.
    expect(patched(sealed({ xs: [{ a: 1 }] }), { op: 'set', subPath: 'xs[1].b', value: 2 }))
      .toStrictEqual({ xs: [{ a: 1 }, { b: 2 }] });
  });

  it('refuses when n > length', () => {
    const failure = thrown(() => patched(sealed({ xs: [1, 2] }), { op: 'set', subPath: 'xs[5]', value: 3 }));
    expect(failure.code).toBe('BLOB_SUBPATH_INVALID');
    expect(failure.message).toContain('extending past the end would need holes');
  });

  it('sets a key PRESENT with value undefined, which is a different fact from absent', () => {
    const out = patched(sealed({ a: 1 }), { op: 'set', subPath: 'a', value: undefined }) as Record<string, unknown>;
    expect('a' in out).toBe(true);
    expect(out.a).toBeUndefined();
  });

  it('differs from unset, which removes the key — both exist because the encoding tells them apart', () => {
    const out = patched(sealed({ a: 1 }), { op: 'unset', subPath: 'a' }) as Record<string, unknown>;
    expect('a' in out).toBe(false);
  });

  it('lands a `__proto__` key as an own data property and pollutes nothing', () => {
    const out = patched(sealed({}), { op: 'set', subPath: '`__proto__`.polluted', value: 'yes' }) as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(out, '__proto__')).toBe(true);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('addresses a key containing a dot through a backtick-quoted segment', () => {
    expect(patched(sealed({}), { op: 'set', subPath: '`a.b`.c', value: 1 }))
      .toStrictEqual({ 'a.b': { c: 1 } });
  });
});

describe('applyBlobPatch — `unset` is total and idempotent by construction', () => {
  it('deletes a terminal key', () => {
    expect(patched(sealed({ a: 1, b: 2 }), { op: 'unset', subPath: 'a' })).toStrictEqual({ b: 2 });
  });

  it('SPLICES an array element — not a hole and not a null placeholder', () => {
    expect(patched(sealed({ xs: [1, 2, 3] }), { op: 'unset', subPath: 'xs[1]' }))
      .toStrictEqual({ xs: [1, 3] });
  });

  it('is a no-op out of range', () => {
    expect(patched(sealed({ xs: [1] }), { op: 'unset', subPath: 'xs[9]' })).toStrictEqual({ xs: [1] });
  });

  it.each([
    ['an absent intermediate', { a: 1 }, 'nope.deep'],
    ['the wrong container type', { a: 'text' }, 'a.b'],
    ['an index into a non-array', { a: { b: 1 } }, 'a[0]'],
    ['an absent terminal key', { a: 1 }, 'b'],
  ])('is a no-op for %s', (_label, value, subPath) => {
    expect(patched(sealed(value), { op: 'unset', subPath })).toStrictEqual(value);
  });

  it('is idempotent — running it twice is running it once', () => {
    const once = patched(sealed({ a: 1, b: 2 }), { op: 'unset', subPath: 'a' });
    const twice = patched(sealed({ a: 1, b: 2 }), { op: 'unset', subPath: 'a' }, { op: 'unset', subPath: 'a' });
    expect(twice).toStrictEqual(once);
  });

  it('never throws on the shape of the DATA, only on the shape of the subPath', () => {
    expect(codeOf(() => patched(sealed({}), { op: 'unset', subPath: 'a..b' }))).toBe('BLOB_SUBPATH_INVALID');
  });
});

describe('applyBlobPatch — `append` is append, not union', () => {
  it('creates [] where the target is absent, then appends', () => {
    expect(patched(sealed({}), { op: 'append', subPath: 'xs', values: [1, 2] }))
      .toStrictEqual({ xs: [1, 2] });
  });

  it.each([['undefined', undefined], ['null', null]])('creates [] where the target is %s', (_label, existing) => {
    expect(patched(sealed({ xs: existing }), { op: 'append', subPath: 'xs', values: [1] }))
      .toStrictEqual({ xs: [1] });
  });

  it('appends to an existing array in order', () => {
    expect(patched(sealed({ xs: [1] }), { op: 'append', subPath: 'xs', values: [2, 3] }))
      .toStrictEqual({ xs: [1, 2, 3] });
  });

  it('does NOT dedupe — dedupe needs an identity we do not have', () => {
    expect(patched(sealed({ xs: [1] }), { op: 'append', subPath: 'xs', values: [1, 1] }))
      .toStrictEqual({ xs: [1, 1, 1] });
  });

  it('creates intermediates for key segments, as `set` does', () => {
    expect(patched(sealed({}), { op: 'append', subPath: 'a.b.xs', values: [1] }))
      .toStrictEqual({ a: { b: { xs: [1] } } });
  });

  it('refuses a non-array target, naming the constructor and the transaction rule', () => {
    const failure = thrown(() => patched(sealed({ xs: 'text' }), { op: 'append', subPath: 'xs', values: [1] }));
    expect(failure.code).toBe('BLOB_SUBPATH_INVALID');
    expect(failure.message).toContain('a string');
    expect(failure.message).toContain('must run inside a transaction');
  });

  it('appends into an element of an array', () => {
    expect(patched(sealed({ rows: [{ tags: ['a'] }] }), { op: 'append', subPath: 'rows[0].tags', values: ['b'] }))
      .toStrictEqual({ rows: [{ tags: ['a', 'b'] }] });
  });

  it('documents WHY a transaction is mandatory: a stale read gives a different answer', () => {
    // Not a failure case. It is the reason `reseals` exists, so that nobody optimises the
    // transaction away by reading once and writing later.
    const k = key();
    const before = sealed({ xs: [1] });                       // the stale read
    const fresh = applyBlobPatch(k, request([{ op: 'append', subPath: 'xs', values: [2] }]), before);
    const stale = applyBlobPatch(k, request([{ op: 'append', subPath: 'xs', values: [3] }]), before);
    const onFresh = applyBlobPatch(k, request([{ op: 'append', subPath: 'xs', values: [3] }]), fresh);

    expect(decryptBlob(k, AAD, stale)).toStrictEqual({ xs: [1, 3] });     // element 2 is lost
    expect(decryptBlob(k, AAD, onFresh)).toStrictEqual({ xs: [1, 2, 3] });
  });
});

describe('applyBlobPatch — ordering, reseal and validation', () => {
  it('applies patches in array order, each against the result of the previous', () => {
    expect(patched(sealed({}),
      { op: 'set', subPath: 'a', value: 1 },
      { op: 'set', subPath: 'a', value: 2 })).toStrictEqual({ a: 2 });
  });

  it('makes unset-then-set a replace', () => {
    expect(patched(sealed({ a: { keep: 1 } }),
      { op: 'unset', subPath: 'a' },
      { op: 'set', subPath: 'a.fresh', value: 2 })).toStrictEqual({ a: { fresh: 2 } });
  });

  it('always produces a NEW ciphertext, even when every patch was a no-op', () => {
    const k = key();
    const current = sealed({ a: 1 });
    const out = applyBlobPatch(k, request([{ op: 'unset', subPath: 'nope' }]), current);
    expect(out).not.toBe(current);
    expect(decryptBlob(k, AAD, out)).toStrictEqual({ a: 1 });
  });

  it('accepts an empty patch list as a plain reseal under a fresh IV', () => {
    const k = key();
    const out = applyBlobPatch(k, request(), sealed({ a: 1 }));
    expect(decryptBlob(k, AAD, out)).toStrictEqual({ a: 1 });
  });

  it('re-measures the result against the same ceilings, so a patch that grows past budget fails HERE', () => {
    const k = key();
    expect(codeOf(() => applyBlobPatch(
      k,
      request([{ op: 'set', subPath: 'big', value: 'x'.repeat(4_000) }]),
      encryptBlob(k, AAD, {}),
      { maxPlaintextBytes: 200 },
    ))).toBe('BLOB_TOO_LARGE');
  });

  it.each([
    ['a missing collection', { docId: 'd', fieldPath: 'f', aad: AAD, patches: [] }],
    ['an empty docId', { collection: 'c', docId: '', fieldPath: 'f', aad: AAD, patches: [] }],
    ['a missing aad', { collection: 'c', docId: 'd', fieldPath: 'f', patches: [] }],
    ['patches that are not an array', { collection: 'c', docId: 'd', fieldPath: 'f', aad: AAD, patches: {} }],
  ])('is VALIDATION_ERROR for a request with %s', (_label, req) => {
    expect(codeOf(() => applyBlobPatch(key(), req as unknown as BlobResealRequest, undefined)))
      .toBe('VALIDATION_ERROR');
  });

  it.each([
    ['an unknown op', { op: 'merge', subPath: 'a', value: 1 }],
    ['a non-string subPath', { op: 'set', subPath: 3, value: 1 }],
    ['append with no values array', { op: 'append', subPath: 'a' }],
    ['a null op', null],
  ])('is VALIDATION_ERROR for %s', (_label, patch) => {
    expect(codeOf(() => applyBlobPatch(
      key(),
      { ...request(), patches: [patch as never] },
      sealed({}),
    ))).toBe('VALIDATION_ERROR');
  });

  it.each(['', 'a..b', 'a.', '.a', 'a[]', 'a[01]', 'a[-1]', 'a[1e3]'])(
    'is BLOB_SUBPATH_INVALID for the subPath %p', (subPath) => {
      expect(codeOf(() => patched(sealed({}), { op: 'set', subPath, value: 1 })))
        .toBe('BLOB_SUBPATH_INVALID');
    },
  );
});

describe('seam (c): a subPath is capped at the payload\'s own depth', () => {
  const deep = (n: number): string => Array.from({ length: n }, (_, i) => `s${i}`).join('.');

  it('accepts a subPath exactly DEFAULT_MAX_DEPTH segments deep', () => {
    expect(() => patched(sealed({}), { op: 'set', subPath: deep(DEFAULT_MAX_DEPTH), value: 1 })).not.toThrow();
  });

  it('refuses one segment more, naming both numbers', () => {
    const failure = thrown(() => patched(sealed({}), { op: 'set', subPath: deep(DEFAULT_MAX_DEPTH + 1), value: 1 }));
    expect(failure.code).toBe('BLOB_SUBPATH_INVALID');
    expect(failure.message).toContain(`${DEFAULT_MAX_DEPTH + 1} segments deep`);
    expect(failure.message).toContain(`depth cap is ${DEFAULT_MAX_DEPTH}`);
  });

  it('honours a caller\'s own maxDepth, which is the scope\'s number', () => {
    const k = key();
    expect(codeOf(() => applyBlobPatch(
      k, request([{ op: 'set', subPath: 'a.b.c', value: 1 }]), sealed({}), { maxDepth: 2 },
    ))).toBe('BLOB_SUBPATH_INVALID');
  });

  it('rejects a maxDepth that is not a whole number of at least 1', () => {
    expect(codeOf(() => applyBlobPatch(
      key(), request([{ op: 'set', subPath: 'a', value: 1 }]), sealed({}), { maxDepth: 0 },
    ))).toBe('VALIDATION_ERROR');
  });
});

// ---------------------------------------------------------------------------
// §8.9's acceptance criteria: build's live dotted-update call sites
// ---------------------------------------------------------------------------

/**
 * The dotted remainder after a blob path, with each numeric part read as an index — §8.10's
 * conversion rule, hand-rolled here because it is `planUpdate`'s to own (doc-codec, step 10) and
 * this suite must not pre-empt where it lives. It exists so the eight rows below can be stated as
 * the UPDATE KEY the live code writes today, which is what makes them acceptance criteria rather
 * than fixtures somebody transcribed.
 */
function subPathFor(updateKey: string, blobPath: string): string {
  const rest = updateKey.slice(blobPath.length + 1).split('.');
  return rest.reduce<string>(
    (acc, part, i) => (/^(?:0|[1-9][0-9]*)$/.test(part)
      ? `${acc}[${part}]`
      : (i === 0 ? part : `${acc}.${part}`)),
    '',
  );
}

describe('§8.9 the eight live build call sites', () => {
  const items = [{ id: 'i1', acknowledgedAt: null }];
  const checkins = [{ at: '2026-09-11', note: 'ok' }];

  const rows: readonly {
    readonly site: string;
    readonly updateKey: string;
    readonly blobPath: string;
    readonly subPath: string;
    readonly value: unknown;
    readonly before: Record<string, unknown>;
    readonly after: Record<string, unknown>;
  }[] = [
    {
      site: 'CodeAnalysisService.ts:972',
      updateKey: 'structuredContent.loopbackItems', blobPath: 'structuredContent',
      subPath: 'loopbackItems', value: items,
      before: { summary: 'keep' }, after: { summary: 'keep', loopbackItems: items },
    },
    {
      site: 'CodeAnalysisService.ts:995',
      updateKey: 'structuredContent.loopbackItems', blobPath: 'structuredContent',
      subPath: 'loopbackItems', value: items,
      before: { loopbackItems: [] }, after: { loopbackItems: items },
    },
    {
      site: 'CheckpointManagementService.ts:431 (already in runTransaction)',
      updateKey: 'payload.checkins', blobPath: 'payload',
      subPath: 'checkins', value: checkins,
      before: {}, after: { checkins },
    },
    {
      site: 'CheckpointManagementService.ts:432',
      updateKey: 'payload.gitContext', blobPath: 'payload',
      subPath: 'gitContext', value: null,
      before: { gitContext: { sha: 'abc' } }, after: { gitContext: null },
    },
    {
      site: 'CheckpointManagementService.ts:733 (already in runTransaction)',
      updateKey: 'payload.checkins', blobPath: 'payload',
      subPath: 'checkins', value: checkins,
      before: { checkins: [] }, after: { checkins },
    },
    {
      site: 'backfill-list-slots-to-group.ts:111',
      updateKey: 'fields.contentSlots', blobPath: 'fields',
      subPath: 'contentSlots', value: [{ slot: 1 }],
      before: { contentSlots: [] }, after: { contentSlots: [{ slot: 1 }] },
    },
    {
      site: 'backfill-list-slots-to-group.ts:160',
      updateKey: 'fields.composition', blobPath: 'fields',
      subPath: 'composition', value: { mode: 'group' },
      before: { composition: { mode: 'list' } }, after: { composition: { mode: 'group' } },
    },
    {
      site: 'backfill-content-fill-v9.ts:100',
      updateKey: 'fields.composition', blobPath: 'fields',
      subPath: 'composition', value: { rows: [1, 2] },
      before: {}, after: { composition: { rows: [1, 2] } },
    },
  ];

  it.each(rows)('$site — $updateKey becomes a depth-1 set of $subPath', (row) => {
    // 1. the key sits INSIDE the blob path, which is what makes it a reseal rather than a write
    expect(blobKeyRelation(row.updateKey, parseFieldPath(row.blobPath))).toBe('inside');
    // 2. the remainder converts to the subPath §8.9's table names
    expect(subPathFor(row.updateKey, row.blobPath)).toBe(row.subPath);
    // 3. and the patch produces the payload the live code intends
    const k = key();
    const aad = `deliverables/d_1.${row.blobPath}`;
    const out = applyBlobPatch(
      k,
      {
        collection: 'deliverables', docId: 'd_1', fieldPath: row.blobPath, aad,
        patches: [{ op: 'set', subPath: row.subPath, value: row.value }],
      },
      encryptBlob(k, aad, row.before),
    );
    expect(decryptBlob(k, aad, out)).toStrictEqual(row.after);
  });

  it('every live site is a depth-1 set, which is why `append` is the addition and not the port', () => {
    // The mechanism has to be AT LEAST what the live code does; the grammar has to be MORE, because
    // `append` is what stops the next author reintroducing the lost update that Firestore's
    // field-level merge was quietly preventing.
    for (const row of rows) {
      expect(row.subPath).not.toContain('.');
      expect(row.subPath).not.toContain('[');
    }
  });

  it('converts a numeric part into an index segment, inheriting Firestore\'s own ambiguity', () => {
    expect(subPathFor('structuredContent.loopbackItems.0.acknowledgedAt', 'structuredContent'))
      .toBe('loopbackItems[0].acknowledgedAt');
    expect(subPathFor('payload.checkins.2.status', 'payload')).toBe('checkins[2].status');
  });
});

// ---------------------------------------------------------------------------
// R14 — only a record key may seal a blob
// ---------------------------------------------------------------------------

describe('R14 — only a record key may seal a blob', () => {
  const dek = (): RecordKey => dekFromBytes(KEY_A, 'collab/acc_1@1') as unknown as RecordKey;

  it('refuses an account DEK before encodeBlob walks a single node', () => {
    const t = thrown(() => encryptBlob(dek(), AAD, { a: 1 }));
    expect(t.code).toBe('VALIDATION_ERROR');
    expect(t.message).toContain('encryptBlob key must be a record-key handle');
    expect(t.message).toContain('received a dek handle');
  });

  it('names the key and not the document, even when a site is supplied', () => {
    // The check sits OUTSIDE `atSite`, deliberately. A wrong key is not a fact about a collection
    // and a field, and dressing it as one sends whoever is reading the log to the data.
    const t = thrown(() => encryptBlob(dek(), AAD, { a: 1 }, undefined, SITE));
    expect(t.code).toBe('VALIDATION_ERROR');
    expect(t.message).toContain('encryptBlob key');
    expect(t.message).not.toContain('r_88');
    expect(t.message).not.toContain('structuredOutput');
  });

  it('refuses a DEK even for a payload that would have been refused anyway', () => {
    // A payload over the ceiling AND the wrong key: the key wins, because it is the fact that
    // makes every other diagnosis beside the point.
    const t = thrown(() => encryptBlob(dek(), AAD, { a: 'x'.repeat(2000) }, { maxSealedBytes: 100 }));
    expect(t.code).toBe('VALIDATION_ERROR');
    expect(t.message).toContain('encryptBlob key');
  });

  it('seals and opens under a record key exactly as before', () => {
    const k = key();
    expect(decryptBlob(k, AAD, encryptBlob(k, AAD, { a: 1, b: ['x'] }))).toStrictEqual({
      a: 1,
      b: ['x'],
    });
  });
});
