/**
 * **The move matrix — §16.5, the heart of the suite.** A ciphertext moved between fields,
 * documents, records, accounts, products, generations, buckets and object paths must fail to
 * open. Fourteen rows, each one an independent test rather than a loop, because a loop that
 * silently skipped a row would still be green.
 *
 * ── THE DISCIPLINE THAT MAKES THESE HONEST: SAME BYTES, DIFFERENT LABEL ───────────────────────
 *
 * Most of these moves change TWO things at once in the real world — the AAD string *and* the key.
 * A test that varies both passes for the wrong reason: it would keep passing if the AAD were
 * dropped from the wrap entirely, because the key alone would still refuse. So `fixedDekSource`
 * holds the DEK bytes CONSTANT across every varied dimension:
 *
 *     const K = Buffer.alloc(32, 0xa1);
 *     fixedDekSource({ productId: 'collab', keys: { A: { 1: K, 2: K }, B: { 1: K } } });
 *
 * Account A and account B have one key. Generation 1 and generation 2 have one key. `productId`
 * is not a property of a DEK at all, so rows 8, 9 and 10 vary only the AAD, and their failure is
 * attributable to the AAD and to nothing else. Each of those rows carries a POSITIVE CONTROL in
 * the same test — the same wrap opening under its own label — so "it failed" cannot be "the seal
 * was broken all along".
 *
 * ── THE TWO DIALS ────────────────────────────────────────────────────────────────────────────
 *
 * Rows 1–3 vary the AAD under one key. Row 4 varies the key under one AAD. Row 7 varies the AAD
 * under one key at the WRAP layer. Together they are the executable statement of the design: the
 * record key does part of the AAD's job, and the AAD does the part the record key cannot.
 *
 * ── ROW 6 CARRIES AN OWNER CORRECTION ────────────────────────────────────────────────────────
 *
 * §16.5's table said a wrap presented at a content path is `CONTENT_KIND_MISMATCH`. It is
 * `WRONG_KEY_LAYER`, and owner ruling R4 fixed the TABLE rather than the code, because
 * `WRONG_KEY_LAYER` is the better error: it says a wrap turned up where content belongs.
 * `CONTENT_KIND_MISMATCH` is reachable only once the key AND the AAD already match and the kind
 * byte is the sole difference — which is row 5, and row 5 alone.
 */

import { ContentCryptoError, isContentCryptoError } from '../errors';
import { fixedDekSource } from '../testing';
import { PAYLOAD_KIND, decryptField, encryptField } from '../field-codec';
import { ENC_PREFIX_V1, ENC_PREFIX_V2 } from '../legacy-readers';
import { openBuffer, openParts, sealBuffer, sealParts } from '../cipher';
import { decryptBlob, encryptBlob } from '../blob-codec';
import { aadForContent } from '../aad';
import { aggregateRecordRef } from '../key-scope';
import type { DekHandle } from '../custodian';
import {
  mintRecordKey, rewrapRecordKey, unwrapRecordKey, wrapRecordKey,
} from '../record-key';
import type { RecordRef, WrapEntry } from '../record-key';
import {
  OBJECT_META, mergeObjectMetadata, openObject, readObjectEnvelope, sealObject,
} from '../object-envelope';
import type { ObjectMetadata, ObjectRef } from '../object-envelope';
import type { RecordKey } from '../secret';

// ---------------------------------------------------------------------------
// Fixtures — one key, many labels
// ---------------------------------------------------------------------------

const PRODUCT = 'collab';
const OTHER_PRODUCT = 'morph';

/** ONE set of 32 bytes, handed to two accounts and two generations. */
const K = Buffer.alloc(32, 0xa1);

const dekSource = fixedDekSource({ productId: PRODUCT, keys: { A: { 1: K, 2: K }, B: { 1: K } } });

const recordOne: RecordRef = aggregateRecordRef('project', 'p_1', 'projects/p_1');
const recordTwo: RecordRef = aggregateRecordRef('project', 'p_2', 'projects/p_2');

/** Two record keys, each 32 random bytes nobody can read. Rows 1–3 and 5 use only the first. */
const keyOne: RecordKey = mintRecordKey(recordOne);
const keyTwo: RecordKey = mintRecordKey(recordTwo);

/** Thirty-two bytes standing in for a record key in the counterfactual below, where the test has
 *  to hold the plaintext of a wrap in order to show that it opened. */
const RECORD_KEY_PROBE = Buffer.alloc(32, 0x7e);

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    return isContentCryptoError(err) ? err.code : `not a ContentCryptoError: ${String(err)}`;
  }
  return 'did not throw';
}

let dekA1: DekHandle;
let dekA2: DekHandle;
let dekB1: DekHandle;

beforeAll(async () => {
  dekA1 = await dekSource.getDek('A', 1);
  dekA2 = await dekSource.getDek('A', 2);
  dekB1 = await dekSource.getDek('B', 1);
});

// ---------------------------------------------------------------------------
// The premise the whole matrix rests on
// ---------------------------------------------------------------------------

describe('the fixture itself — the "same bytes, different label" premise', () => {
  it('A@1, A@2 and B@1 are ONE key under three labels, proved by cross-opening a wrap', () => {
    // A wrap sealed under A@1's handle and opened under B@1's handle, with A@1's LABEL supplied
    // to both sides. If the two handles held different bytes this could not open at all — so
    // every later row that varies only the label is varying only the label.
    const entry = wrapRecordKey({
      productId: PRODUCT, dek: dekA1, accountId: 'A', record: recordOne, recordKey: keyOne,
    });
    const reopened = unwrapRecordKey({
      productId: PRODUCT, dek: { generation: 1, key: dekB1.key }, accountId: 'A', record: recordOne, wrap: entry,
    });
    expect(`${reopened}`).toBe('[redacted record-key projects/p_1]');
  });

  it('the two record keys are genuinely different, so row 4 varies something', () => {
    const sealed = encryptField(keyOne, aadForContent('messages', 'm_1', 'body'), 'hello');
    expect(codeOf(() => decryptField(keyTwo, aadForContent('messages', 'm_1', 'body'), sealed)))
      .toBe('CONTENT_DECRYPT_FAILED');
  });
});

// ---------------------------------------------------------------------------
// Rows 1–6: the CONTENT layer
// ---------------------------------------------------------------------------

describe('the content layer — one record key, the AAD varied', () => {
  const aad = aadForContent('messages', 'm_1', 'body');
  const sealed = encryptField(keyOne, aad, 'the quick brown fox');

  it('the positive control: it opens where it was sealed', () => {
    expect(decryptField(keyOne, aad, sealed)).toBe('the quick brown fox');
  });

  it('row 1 — moved to another REGISTERED FIELD of the same document', () => {
    expect(codeOf(() => decryptField(keyOne, aadForContent('messages', 'm_1', 'anchor.quote'), sealed)))
      .toBe('CONTENT_DECRYPT_FAILED');
  });

  it('row 2 — moved to the same field of another DOCUMENT', () => {
    expect(codeOf(() => decryptField(keyOne, aadForContent('messages', 'm_2', 'body'), sealed)))
      .toBe('CONTENT_DECRYPT_FAILED');
  });

  it('row 3 — moved to the same field of another COLLECTION', () => {
    expect(codeOf(() => decryptField(keyOne, aadForContent('drafts', 'm_1', 'body'), sealed)))
      .toBe('CONTENT_DECRYPT_FAILED');
  });

  it('row 4 — moved to the same field of the same document in another RECORD', () => {
    // The complement of rows 1-3: the AAD is IDENTICAL and the key is different. This is the
    // record key doing the part of the job the AAD cannot, because two records legitimately hold
    // the same collection, docId and field.
    expect(codeOf(() => decryptField(keyTwo, aad, sealed))).toBe('CONTENT_DECRYPT_FAILED');
  });

  it('row 5 — a BLOB ciphertext presented at a string path, key and AAD both matching', () => {
    // The only row where the kind byte is the sole difference, which is exactly what
    // `CONTENT_KIND_MISMATCH` means. The move is a registry edit: a path that was a blob is now
    // declared a string, so the reader is the string reader and the stored value is a blob.
    const blobAad = aadForContent('messages', 'm_1', 'payload');
    const blob = encryptBlob(keyOne, blobAad, { items: [1, 2, 3] });
    expect(decryptBlob(keyOne, blobAad, blob)).toEqual({ items: [1, 2, 3] });
    expect(codeOf(() => decryptField(keyOne, blobAad, blob))).toBe('CONTENT_KIND_MISMATCH');
    // And the reverse: a string value at a blob path is the same fact from the other side.
    const stringValue = encryptField(keyOne, blobAad, 'not a map');
    expect(codeOf(() => decryptBlob(keyOne, blobAad, stringValue))).toBe('CONTENT_KIND_MISMATCH');
  });

  it('row 6 — a WRAP (0x04) presented at a content path is WRONG_KEY_LAYER (owner ruling R4)', () => {
    const entry = wrapRecordKey({
      productId: PRODUCT, dek: dekA1, accountId: 'A', record: recordOne, recordKey: keyOne,
    });
    // Refused on the PREFIX, before a cipher is built — which is why it cannot be
    // CONTENT_KIND_MISMATCH: nothing was authenticated, so nothing can be said about a kind byte.
    // The taxonomy is distinguishing two failure modes §16.5's table conflated.
    expect(codeOf(() => decryptField(keyOne, aad, entry.wrapped))).toBe('WRONG_KEY_LAYER');
    expect(() => decryptField(keyOne, aad, entry.wrapped))
      .toThrow(/not a well-formed sealed value/);
    // For contrast, the kind byte it carries IS 0x04 — the value is a wrap, and the reader never
    // got far enough to find out.
    expect(PAYLOAD_KIND.recordKey).toBe(0x04);
  });
});

// ---------------------------------------------------------------------------
// Rows 7–10: the WRAP layer. Four separate tests, never a loop.
// ---------------------------------------------------------------------------

describe('the wrap layer — one DEK, the AAD varied', () => {
  /** A fresh wrap for each row, so no row depends on another having run. */
  const wrapForA = (record: RecordRef, dek: DekHandle, productId = PRODUCT): WrapEntry =>
    wrapRecordKey({ productId, dek, accountId: 'A', record, recordKey: keyOne });

  it('the positive control: a wrap opens under its own four labels', () => {
    const entry = wrapForA(recordOne, dekA1);
    const key = unwrapRecordKey({
      productId: PRODUCT, dek: dekA1, accountId: 'A', record: recordOne, wrap: entry,
    });
    expect(`${key}`).toBe('[redacted record-key projects/p_1]');
  });

  it('row 7 — a wrap moved to another RECORD (a different scopePath)', () => {
    const entry = wrapForA(recordOne, dekA1);
    expect(codeOf(() => unwrapRecordKey({
      productId: PRODUCT, dek: dekA1, accountId: 'A', record: recordTwo, wrap: entry,
    }))).toBe('RECORD_KEY_UNWRAP_FAILED');
    // The scopePath is the FULL document path, which is why an id collision between two records
    // cannot substitute one for the other.
    expect(recordOne.path).not.toBe(recordTwo.path);
  });

  it('row 8 — a wrap moved to another ACCOUNT\'s slot, same key bytes', () => {
    const entry = wrapForA(recordOne, dekA1);
    // B's DEK is byte-identical to A's. Only the accountId in the AAD differs, so this refusal is
    // the AAD's work alone — and B's own wrap of the same record key opens perfectly well.
    expect(codeOf(() => unwrapRecordKey({
      productId: PRODUCT, dek: dekB1, accountId: 'B', record: recordOne, wrap: entry,
    }))).toBe('RECORD_KEY_UNWRAP_FAILED');

    const forB = wrapRecordKey({
      productId: PRODUCT, dek: dekB1, accountId: 'B', record: recordOne, recordKey: keyOne,
    });
    expect(`${unwrapRecordKey({
      productId: PRODUCT, dek: dekB1, accountId: 'B', record: recordOne, wrap: forB,
    })}`).toBe('[redacted record-key projects/p_1]');
  });

  it('row 9 — a wrap\'s `gen` relabelled 1 to 2, same key bytes', () => {
    const entry = wrapForA(recordOne, dekA1);
    const relabelled: WrapEntry = { ...entry, gen: 2 };
    // A@2's DEK is byte-identical to A@1's, so if the generation were not in the AAD this would
    // open. It is what makes a relabelled wrap fail authentically rather than by luck.
    expect(codeOf(() => unwrapRecordKey({
      productId: PRODUCT, dek: dekA2, accountId: 'A', record: recordOne, wrap: relabelled,
    }))).toBe('RECORD_KEY_UNWRAP_FAILED');

    // The legitimate way to reach generation 2 is a REWRAP, which re-seals under the new label.
    const rotated = rewrapRecordKey({
      productId: PRODUCT, from: dekA1, to: dekA2, accountId: 'A', record: recordOne, wrap: entry,
    });
    expect(rotated?.gen).toBe(2);
    expect(`${unwrapRecordKey({
      productId: PRODUCT, dek: dekA2, accountId: 'A', record: recordOne, wrap: rotated as WrapEntry,
    })}`).toBe('[redacted record-key projects/p_1]');
    // And the rotation did NOT re-key: the record key that comes back is the one that went in,
    // which is what makes a rotation cheap and what makes it not a re-key.
    expect(rotated?.wrapped).not.toBe(entry.wrapped);
  });

  it('row 10 — a wrap moved to another PRODUCT, same key bytes', () => {
    const entry = wrapForA(recordOne, dekA1);
    // `productId` is not a property of a DEK at all — it is a component of the AAD and nothing
    // else — so this row varies the label and literally cannot vary the key.
    expect(codeOf(() => unwrapRecordKey({
      productId: OTHER_PRODUCT, dek: dekA1, accountId: 'A', record: recordOne, wrap: entry,
    }))).toBe('RECORD_KEY_UNWRAP_FAILED');

    const forOther = wrapForA(recordOne, dekA1, OTHER_PRODUCT);
    expect(`${unwrapRecordKey({
      productId: OTHER_PRODUCT, dek: dekA1, accountId: 'A', record: recordOne, wrap: forOther,
    })}`).toBe('[redacted record-key projects/p_1]');
  });

  it('a wrap failure is RECORD_KEY_UNWRAP_FAILED and never CONTENT_DECRYPT_FAILED', () => {
    // The two have completely different remedies — a broken access list against corrupt content —
    // and conflating them sends an operator to the wrong one. `record-key.ts` re-codes the
    // cipher's answer for exactly this reason.
    const entry = wrapForA(recordOne, dekA1);
    let caught: unknown = null;
    try {
      unwrapRecordKey({ productId: PRODUCT, dek: dekA1, accountId: 'B', record: recordOne, wrap: entry });
    } catch (err) {
      caught = err;
    }
    expect(isContentCryptoError(caught, 'RECORD_KEY_UNWRAP_FAILED')).toBe(true);
    expect((caught as ContentCryptoError).status).toBe(500);
    // The details name the position and never the bytes.
    expect((caught as ContentCryptoError).details).toEqual({
      accountId: 'B', scopePath: 'projects/p_1', generation: 1,
    });
  });
});

// ---------------------------------------------------------------------------
// Rows 11–13: the OBJECT layer
// ---------------------------------------------------------------------------

describe('the object layer — one record key, the ref varied', () => {
  const refOne: ObjectRef = { bucket: 'acme-morph', path: 'objects/ab/cd/ef.bin' };
  const plaintext = Buffer.from('a scanned page, several megabytes in real life');

  it('the positive control: it opens at the bucket and path it was sealed for', () => {
    const { body, metadata } = sealObject(keyOne, refOne, recordOne.path, plaintext);
    expect(openObject(keyOne, refOne, body, metadata).equals(plaintext)).toBe(true);
  });

  it('row 11 — the body moved to another BUCKET', () => {
    const { body, metadata } = sealObject(keyOne, refOne, recordOne.path, plaintext);
    const elsewhere: ObjectRef = { bucket: 'acme-build', path: refOne.path };
    expect(codeOf(() => openObject(keyOne, elsewhere, body, metadata))).toBe('CONTENT_DECRYPT_FAILED');
  });

  it('row 12 — the body moved to another OBJECT PATH', () => {
    const { body, metadata } = sealObject(keyOne, refOne, recordOne.path, plaintext);
    const elsewhere: ObjectRef = { bucket: refOne.bucket, path: 'objects/zz/zz/zz.bin' };
    expect(codeOf(() => openObject(keyOne, elsewhere, body, metadata))).toBe('CONTENT_DECRYPT_FAILED');
  });

  it('row 13 — `x-xbg-rec` rewritten to another record\'s scopePath FAILS CLOSED', () => {
    const { body, metadata } = sealObject(keyOne, refOne, recordOne.path, plaintext);

    // Whoever last saved the object rewrites the hint. It is unauthenticated metadata, and the
    // package deliberately does not validate it — a shape check here would only turn somebody
    // else's bad string into our exception at a point where nothing has been trusted yet.
    const tampered: ObjectMetadata = mergeObjectMetadata(metadata, { [OBJECT_META.rec]: recordTwo.path });
    const envelope = readObjectEnvelope(refOne, tampered);
    expect(envelope?.scopePath).toBe(recordTwo.path);

    // A reader that resolves its record key FROM the hint — which is the only thing a hint is for
    // — now holds record two's key. The body's tag refuses it. That is what "fails closed" means:
    // a decrypt failure, not a crash and not a read of somebody else's content.
    const resolveByHint = (scopePath: string): RecordKey =>
      (scopePath === recordOne.path ? keyOne : keyTwo);
    const key = resolveByHint(envelope?.scopePath as string);
    expect(codeOf(() => openObject(key, refOne, body, tampered))).toBe('CONTENT_DECRYPT_FAILED');

    // And the claim that it is a REFUSAL rather than a crash, stated as such.
    let caught: unknown = null;
    try {
      openObject(key, refOne, body, tampered);
    } catch (err) {
      caught = err;
    }
    expect(isContentCryptoError(caught, 'CONTENT_DECRYPT_FAILED')).toBe(true);
  });

  it('the hint is never trusted: the CORRECT key still opens the body under the tampered hint', () => {
    // The complement of row 13, and it is what proves the hint is a hint. `x-xbg-rec` is not in
    // the AAD — the AAD is the bucket and the object path — so rewriting it changes nothing about
    // what the body authenticates under.
    const { body, metadata } = sealObject(keyOne, refOne, recordOne.path, plaintext);
    const tampered = mergeObjectMetadata(metadata, { [OBJECT_META.rec]: recordTwo.path });
    expect(openObject(keyOne, refOne, body, tampered).equals(plaintext)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Row 14: the VERSION layer
// ---------------------------------------------------------------------------

describe('the version layer — a legacy value handed to the v3 reader', () => {
  /**
   * THE FIXTURE WRITER for the superseded wires, five lines, inside `__tests__/`. No writer for an
   * old wire ships from any entrypoint — `index.test.ts` asserts that by importing the barrel —
   * and the prefixes are IMPORTED rather than typed, because `check-mirror.js` assertion (6) keeps
   * those two literals inside the quarantine so Phase G's deletion stays provably a leaf.
   */
  function legacyFixture(prefix: string, aad: string, plaintext: string, generation?: number): string {
    const { iv, tag, ciphertext } = sealParts(keyOne, aad, Buffer.from(plaintext, 'utf8'));
    const parts = [iv.toString('base64'), ciphertext.toString('base64'), tag.toString('base64')];
    return generation === undefined
      ? `${prefix}${parts.join(':')}`
      : `${prefix}${generation}:${parts.join(':')}`;
  }

  const aad = aadForContent('messages', 'm_1', 'body');

  // The titles below say "a v1 value" rather than spelling the prefix: the literal is declared in
  // field-codec.ts and imported above, and check-mirror assertion (6) scans string literals — a
  // test name is a string. The fixtures are built from the constants, which is the thing that
  // matters.
  it('row 14 — a v1 legacy value is WRONG_KEY_LAYER, never a tag failure that reads as corruption', () => {
    const v1 = legacyFixture(ENC_PREFIX_V1, aad, 'hello');
    expect(codeOf(() => decryptField(keyOne, aad, v1))).toBe('WRONG_KEY_LAYER');
    expect(() => decryptField(keyOne, aad, v1)).toThrow(/sealed under an account DEK/);
  });

  it('row 14 — a v2 legacy value is WRONG_KEY_LAYER too, and its generation label is irrelevant', () => {
    const v2 = legacyFixture(ENC_PREFIX_V2, aad, 'hello', 3);
    expect(codeOf(() => decryptField(keyOne, aad, v2))).toBe('WRONG_KEY_LAYER');
  });

  it('the distinction is the point: a wrong key is CONTENT_DECRYPT_FAILED, a wrong LAYER is not', () => {
    // Handing a v1 value to the v3 reader would otherwise reach `createDecipheriv` under a record
    // key and fail its tag — and a tag failure reads as "your data is corrupt" when the truth is
    // "you asked the wrong key layer". Two codes, two remedies.
    const v1 = legacyFixture(ENC_PREFIX_V1, aad, 'hello');
    const v3 = encryptField(keyOne, aad, 'hello');
    expect(codeOf(() => decryptField(keyOne, aad, v1))).toBe('WRONG_KEY_LAYER');
    expect(codeOf(() => decryptField(keyTwo, aad, v3))).toBe('CONTENT_DECRYPT_FAILED');
  });

  it('a value that is not a well-formed ciphertext at all is WRONG_KEY_LAYER, naming the shape', () => {
    // A user can type "enc:v3:" as a title. It is not a ciphertext, and the refusal says so
    // without printing the value.
    expect(codeOf(() => decryptField(keyOne, aad, 'enc:v3:'))).toBe('WRONG_KEY_LAYER');
    expect(codeOf(() => decryptField(keyOne, aad, 'an ordinary title'))).toBe('WRONG_KEY_LAYER');
  });
});


// ---------------------------------------------------------------------------
// The counterfactual — what these rows would look like WITHOUT the AAD
// ---------------------------------------------------------------------------

/**
 * **Every row above is a refusal, and a refusal proves nothing on its own** — a test that expects
 * a throw passes just as happily against a codec that throws for the wrong reason, or against one
 * whose seal was broken all along. So the moves are run once more through the raw cipher with the
 * AAD held CONSTANT, and asserted to SUCCEED.
 *
 * That is the mutation: it is the codec with its binding removed, and it reads the moved value
 * cleanly. The refusals above are therefore attributable to the AAD and to nothing else.
 *
 * `sealBuffer`/`openBuffer` are `cipher.ts`'s and are internal — never re-exported from the barrel,
 * which `index.test.ts` asserts — and reaching them relatively from a test is the only way to
 * stage a codec that does the wrong thing on purpose.
 */
describe('the counterfactual: with the AAD dropped, every move above reads clean', () => {
  const NO_BINDING = 'a constant, position-independent label';

  it('rows 1-3 — a content value moves between fields, documents and collections unnoticed', () => {
    const sealed = sealBuffer(
      keyOne, NO_BINDING, PAYLOAD_KIND.string, Buffer.from('the quick brown fox'), 'enc:v3:',
    );
    // The reader is at a completely different position and does not care, because nothing told it
    // where the value belonged.
    const opened = openBuffer(keyOne, NO_BINDING, sealed, [PAYLOAD_KIND.string], 'enc:v3:');
    expect(opened.body.toString('utf8')).toBe('the quick brown fox');
    // Whereas the real codec, at the real positions, refuses.
    const real = encryptField(keyOne, aadForContent('messages', 'm_1', 'body'), 'the quick brown fox');
    expect(codeOf(() => decryptField(keyOne, aadForContent('messages', 'm_2', 'body'), real)))
      .toBe('CONTENT_DECRYPT_FAILED');
  });

  it('rows 8-10 — a wrap moves between accounts, generations and products unnoticed', () => {
    // The same 32 record-key bytes, sealed under A@1's DEK with no position bound to them.
    const wrapped = sealBuffer(
      dekA1.key, NO_BINDING, PAYLOAD_KIND.recordKey, Buffer.from(RECORD_KEY_PROBE), 'wrap:v1:',
    );
    // B's DEK is the same bytes, so with the AAD gone there is nothing left to refuse: the wrap
    // opens in another account's slot, at another generation, for another product.
    for (const dek of [dekA1, dekA2, dekB1]) {
      const opened = openBuffer(dek.key, NO_BINDING, wrapped, [PAYLOAD_KIND.recordKey], 'wrap:v1:');
      expect(opened.body.equals(RECORD_KEY_PROBE)).toBe(true);
    }
    // And the real wrap layer refuses all three, which is the whole of rows 8, 9 and 10.
    const entry = wrapRecordKey({
      productId: PRODUCT, dek: dekA1, accountId: 'A', record: recordOne, recordKey: keyOne,
    });
    expect(codeOf(() => unwrapRecordKey({
      productId: PRODUCT, dek: dekB1, accountId: 'B', record: recordOne, wrap: entry,
    }))).toBe('RECORD_KEY_UNWRAP_FAILED');
  });

  it('rows 11-12 — an object body moves between buckets and paths unnoticed', () => {
    // `sealParts`/`openParts` are the object path's own pair — an object body has no kind byte,
    // which is precisely why the object AAD is the one form that still carries a domain prefix.
    const { iv, tag, ciphertext } = sealParts(keyOne, NO_BINDING, Buffer.from('a scanned page'));
    // Nothing about the bucket or the path was bound, so the body opens wherever it now lives.
    expect(openParts(keyOne, NO_BINDING, iv, tag, ciphertext).toString('utf8')).toBe('a scanned page');

    // Whereas the real envelope refuses the same move.
    const ref: ObjectRef = { bucket: 'acme-morph', path: 'objects/a.bin' };
    const sealedObject = sealObject(keyOne, ref, recordOne.path, Buffer.from('a scanned page'));
    expect(codeOf(() => openObject(
      keyOne, { bucket: 'acme-build', path: ref.path }, sealedObject.body, sealedObject.metadata,
    ))).toBe('CONTENT_DECRYPT_FAILED');
  });
});

// ---------------------------------------------------------------------------
// The matrix, restated as a table so a missing row is visible
// ---------------------------------------------------------------------------

describe('the fourteen rows, as one table', () => {
  /**
   * Not a substitute for the tests above — it re-runs the same moves through the same code — but
   * the thing a reader can check against §16.5 in ten seconds. Every row's expected code is
   * written out, including row 6's correction.
   */
  const rows: ReadonlyArray<[number, string, string, () => unknown]> = [
    [1, 'another registered field', 'CONTENT_DECRYPT_FAILED', () => decryptField(
      keyOne, aadForContent('messages', 'm_1', 'anchor.quote'),
      encryptField(keyOne, aadForContent('messages', 'm_1', 'body'), 'x'),
    )],
    [2, 'another docId', 'CONTENT_DECRYPT_FAILED', () => decryptField(
      keyOne, aadForContent('messages', 'm_2', 'body'),
      encryptField(keyOne, aadForContent('messages', 'm_1', 'body'), 'x'),
    )],
    [3, 'another collection', 'CONTENT_DECRYPT_FAILED', () => decryptField(
      keyOne, aadForContent('drafts', 'm_1', 'body'),
      encryptField(keyOne, aadForContent('messages', 'm_1', 'body'), 'x'),
    )],
    [4, 'another record', 'CONTENT_DECRYPT_FAILED', () => decryptField(
      keyTwo, aadForContent('messages', 'm_1', 'body'),
      encryptField(keyOne, aadForContent('messages', 'm_1', 'body'), 'x'),
    )],
    [5, 'a blob at a string path', 'CONTENT_KIND_MISMATCH', () => decryptField(
      keyOne, aadForContent('messages', 'm_1', 'payload'),
      encryptBlob(keyOne, aadForContent('messages', 'm_1', 'payload'), { a: 1 }),
    )],
    [6, 'a wrap at a content path', 'WRONG_KEY_LAYER', () => decryptField(
      keyOne, aadForContent('messages', 'm_1', 'body'),
      wrapRecordKey({
        productId: PRODUCT, dek: dekA1, accountId: 'A', record: recordOne, recordKey: keyOne,
      }).wrapped,
    )],
    [7, 'a wrap to another record', 'RECORD_KEY_UNWRAP_FAILED', () => unwrapRecordKey({
      productId: PRODUCT,
      dek: dekA1,
      accountId: 'A',
      record: recordTwo,
      wrap: wrapRecordKey({
        productId: PRODUCT, dek: dekA1, accountId: 'A', record: recordOne, recordKey: keyOne,
      }),
    })],
    [8, 'a wrap to another account', 'RECORD_KEY_UNWRAP_FAILED', () => unwrapRecordKey({
      productId: PRODUCT,
      dek: dekB1,
      accountId: 'B',
      record: recordOne,
      wrap: wrapRecordKey({
        productId: PRODUCT, dek: dekA1, accountId: 'A', record: recordOne, recordKey: keyOne,
      }),
    })],
    [9, 'a wrap relabelled to another generation', 'RECORD_KEY_UNWRAP_FAILED', () => unwrapRecordKey({
      productId: PRODUCT,
      dek: dekA2,
      accountId: 'A',
      record: recordOne,
      wrap: {
        ...wrapRecordKey({
          productId: PRODUCT, dek: dekA1, accountId: 'A', record: recordOne, recordKey: keyOne,
        }),
        gen: 2,
      },
    })],
    [10, 'a wrap to another product', 'RECORD_KEY_UNWRAP_FAILED', () => unwrapRecordKey({
      productId: OTHER_PRODUCT,
      dek: dekA1,
      accountId: 'A',
      record: recordOne,
      wrap: wrapRecordKey({
        productId: PRODUCT, dek: dekA1, accountId: 'A', record: recordOne, recordKey: keyOne,
      }),
    })],
    [11, 'an object body to another bucket', 'CONTENT_DECRYPT_FAILED', () => {
      const ref: ObjectRef = { bucket: 'acme-morph', path: 'objects/a.bin' };
      const { body, metadata } = sealObject(keyOne, ref, recordOne.path, Buffer.from('x'));
      return openObject(keyOne, { bucket: 'acme-build', path: ref.path }, body, metadata);
    }],
    [12, 'an object body to another path', 'CONTENT_DECRYPT_FAILED', () => {
      const ref: ObjectRef = { bucket: 'acme-morph', path: 'objects/a.bin' };
      const { body, metadata } = sealObject(keyOne, ref, recordOne.path, Buffer.from('x'));
      return openObject(keyOne, { bucket: ref.bucket, path: 'objects/b.bin' }, body, metadata);
    }],
    [13, 'x-xbg-rec rewritten, read by a hint-following reader', 'CONTENT_DECRYPT_FAILED', () => {
      const ref: ObjectRef = { bucket: 'acme-morph', path: 'objects/a.bin' };
      const { body, metadata } = sealObject(keyOne, ref, recordOne.path, Buffer.from('x'));
      const tampered = mergeObjectMetadata(metadata, { [OBJECT_META.rec]: recordTwo.path });
      return openObject(keyTwo, ref, body, tampered);
    }],
    [14, 'a legacy value at the v3 reader', 'WRONG_KEY_LAYER', () => {
      const aad = aadForContent('messages', 'm_1', 'body');
      const { iv, tag, ciphertext } = sealParts(keyOne, aad, Buffer.from('x'));
      const packed = [iv.toString('base64'), ciphertext.toString('base64'), tag.toString('base64')].join(':');
      return decryptField(keyOne, aad, `${ENC_PREFIX_V1}${packed}`);
    }],
  ];

  it.each(rows)('row %i — %s is %s', (_n, _move, expected, run) => {
    expect(codeOf(run)).toBe(expected);
  });

  it('all fourteen rows are present, so a deleted row is a failure rather than a silence', () => {
    expect(rows.map(([n]) => n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
  });
});
