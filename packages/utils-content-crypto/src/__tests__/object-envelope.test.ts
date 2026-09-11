/**
 * The object envelope — §16.2's `object-envelope.test.ts` row: `x-xbg-*`, buffered and streaming,
 * `unverifiedChunks`.
 *
 * What is being proved here, as distinct from "objects encrypt":
 *
 *   1. **Every header has exactly one legal value shape**, and a marked object whose envelope does
 *      not have it is refused rather than served. That is the whole of §10.1, and it is the half of
 *      this module a reader depends on being paranoid.
 *   2. **The marker is presence, not readability.** `isEncryptedObject` answers `true` for an
 *      object marked with a version this build cannot read, because the caller asking is a finalize
 *      trigger deciding whether to seal, and `false` there would seal ciphertext twice.
 *   3. **The AAD binds the bucket and the path** (§16.5 rows 11 and 12) **and does not bind the
 *      hint** (row 13). Both halves of row 13 are asserted here: rewriting `x-xbg-rec` does not
 *      stop the body opening under the right key, and the key the rewritten hint points at cannot
 *      open it. That is what "fails closed" means, and it is the module-local expectation
 *      `tamper.test.ts` should lift rather than re-derive.
 *   4. **The streaming seal's promise rejects with `CONTENT_ENCRYPT_FAILED`** (owner ruling R5) and
 *      never with `VALIDATION_ERROR`, is pre-caught, and rejects rather than hanging.
 *   5. **A blob spilled to an object keeps its payload-kind byte** — `openObject` returns the whole
 *      body, so `decodeBlob(openObject(...))` is the spill path with no second grammar in it.
 *
 * Mirrorable (§16.3): relative imports only, no manifest read, no path above the mirrored root, no
 * environment, no wall clock. The IVs are real randomness because that is what the module does with
 * them, and no assertion depends on their value.
 */

import { AAD_OBJECT_DOMAIN, aadForObject } from '../aad';
import { sealParts } from '../cipher';
import { decodeBlob, encodeBlob } from '../blob-json';
import { isContentCryptoError } from '../errors';
import { encryptField } from '../field-codec';
import {
  OBJECT_ENC_VERSION,
  OBJECT_META,
  createObjectDecryptStream,
  createObjectEncryptStream,
  isEncryptedObject,
  mergeObjectMetadata,
  objectEnvelopeMetadata,
  openObject,
  readObjectEnvelope,
  sealObject,
} from '../object-envelope';
import type { ObjectMetadata, ObjectRef } from '../object-envelope';
import { RESERVED_ROOTS } from '../registry';
import { KEY_BYTES, dekFromBytes, recordKeyFromBytes, zeroise } from '../secret';
import type { RecordKey } from '../secret';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Fixed bytes, never random: a failure must reproduce from the test name alone. */
const KEY_A = Buffer.alloc(KEY_BYTES, 0xa1);
const KEY_B = Buffer.alloc(KEY_BYTES, 0xb2);

/** sf-mapper's real shape — the 26 MB dump a client uploads back through a signed slot. */
const SCAN_PATH = 'accounts/acc-1/sfmapper/org-9/scans/scan-3';
const SCAN_REF: ObjectRef = {
  bucket: 'xbgsolutions-sfmapper',
  path: 'uploads/acc-1/org-9/scan-3/9f1c.json',
};

/** Morph's lake, in the other product's bucket, which is the move rows 11 and 12 exercise. */
const LAKE_REF: ObjectRef = { bucket: 'xbgsolutions-morph', path: 'objects/ab/cd/ef.bin' };
const LAKE_PATH = 'objects/obj_7';

const BODY = Buffer.from('a scan export, or a lake object, or anything else that is bytes', 'utf8');

const key = (bytes: Buffer = KEY_A, holder = SCAN_PATH): RecordKey =>
  recordKeyFromBytes(bytes, holder);

/** Codes are read structurally, never by `instanceof`: the package ships twice in one process and
 *  the mirror's class is a different prototype. */
function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    if (isContentCryptoError(err)) return err.code;
    return `not a ContentCryptoError: ${String(err)}`;
  }
  return 'did not throw';
}

async function codeOfAsync(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    if (isContentCryptoError(err)) return err.code;
    return `not a ContentCryptoError: ${String(err)}`;
  }
  return 'did not reject';
}

/** Collect everything a stream emits, and its error if it has one. */
function drain(stream: NodeJS.ReadableStream): Promise<{ chunks: Buffer[]; error: unknown }> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('error', (error) => resolve({ chunks, error }));
    stream.on('end', () => resolve({ chunks, error: null }));
  });
}

/** A metadata bag as a mutable copy, so a tamper is one explicit substitution. */
function tamper(metadata: ObjectMetadata, changes: Record<string, string | undefined>): ObjectMetadata {
  return { ...metadata, ...changes };
}

// ---------------------------------------------------------------------------
// The four headers
// ---------------------------------------------------------------------------

describe('the x-xbg-* headers', () => {
  it('are exactly four, spelled once, and there is no keygen among them', () => {
    // The absent fifth is the design. Under record keys the wrap lives on the owning record, so
    // rotating an object names no generation, touches no object bytes and lists no bucket.
    expect(OBJECT_META).toEqual({
      enc: 'x-xbg-enc',
      iv: 'x-xbg-iv',
      tag: 'x-xbg-tag',
      rec: 'x-xbg-rec',
    });
    expect(Object.keys(OBJECT_META)).toHaveLength(4);
    for (const name of Object.values(OBJECT_META)) {
      expect(name.startsWith('x-xbg-')).toBe(true);
      expect(name).not.toMatch(/keygen|gen$/);
    }
  });

  it('carry the value shapes §10.1 pins: v3, a 16-character IV and a 24-character padded tag', () => {
    const { metadata } = sealObject(key(), SCAN_REF, SCAN_PATH, BODY);

    expect(metadata[OBJECT_META.enc]).toBe('v3');
    expect(OBJECT_ENC_VERSION).toBe('v3');

    const iv = metadata[OBJECT_META.iv] as string;
    expect(iv).toHaveLength(16);
    expect(iv).not.toContain('=');
    expect(Buffer.from(iv, 'base64')).toHaveLength(12);

    const tag = metadata[OBJECT_META.tag] as string;
    expect(tag).toHaveLength(24);
    expect(tag.endsWith('==')).toBe(true);
    expect(Buffer.from(tag, 'base64')).toHaveLength(16);

    expect(metadata[OBJECT_META.rec]).toBe(SCAN_PATH);
    expect(Object.keys(metadata).sort()).toEqual([...Object.values(OBJECT_META)].sort());
  });

  it('carry the record hint as the FULL document path, not a bare id — which is what it leaks', () => {
    // Stated as a test because §10.2 accepts the leak explicitly: bucket-metadata read now sees
    // the accountId and the Salesforce orgId, and that is more than v1 admitted.
    const { metadata } = sealObject(key(), SCAN_REF, SCAN_PATH, BODY);
    expect(metadata[OBJECT_META.rec]).toBe('accounts/acc-1/sfmapper/org-9/scans/scan-3');
    expect(metadata[OBJECT_META.rec]).toContain('acc-1');
    expect(metadata[OBJECT_META.rec]).toContain('org-9');
  });

  it('refuse a scopePath that is not a document path, on the write side only', () => {
    // A COLLECTION path has an odd segment count, and a wrap bound to a collection is a wrap
    // bound to every document in it. `assertScopePath` owns that rule; this asserts it runs here.
    expect(codeOf(() => sealObject(key(), SCAN_REF, 'accounts/acc-1/sfmapper', BODY))).toBe('VALIDATION_ERROR');
    expect(codeOf(() => objectEnvelopeMetadata(Buffer.alloc(12), Buffer.alloc(16), ''))).toBe('VALIDATION_ERROR');
    expect(codeOf(() => objectEnvelopeMetadata(Buffer.alloc(12), Buffer.alloc(16), '/projects/p_1'))).toBe('VALIDATION_ERROR');
  });

  it('are a VALIDATION_ERROR when a part written is the wrong length, not a decrypt failure', () => {
    // The asymmetry with the read side is the point: on this side the buffers came out of a seal
    // that just happened in this process, so a bad length is a programming error.
    expect(codeOf(() => objectEnvelopeMetadata(Buffer.alloc(11), Buffer.alloc(16), SCAN_PATH))).toBe('VALIDATION_ERROR');
    expect(codeOf(() => objectEnvelopeMetadata(Buffer.alloc(12), Buffer.alloc(15), SCAN_PATH))).toBe('VALIDATION_ERROR');
    expect(codeOf(() => objectEnvelopeMetadata('not bytes' as unknown as Buffer, Buffer.alloc(16), SCAN_PATH))).toBe('VALIDATION_ERROR');
  });
});

// ---------------------------------------------------------------------------
// The marker
// ---------------------------------------------------------------------------

describe('the marker', () => {
  it('is the whole test for "is this object encrypted", which is what a finalize trigger asks', () => {
    const { metadata } = sealObject(key(), SCAN_REF, SCAN_PATH, BODY);
    expect(isEncryptedObject(metadata)).toBe(true);
    expect(isEncryptedObject({})).toBe(false);
    expect(isEncryptedObject(undefined)).toBe(false);
    expect(isEncryptedObject({ contentType: 'application/json' })).toBe(false);
    expect(isEncryptedObject({ [OBJECT_META.enc]: undefined })).toBe(false);
    expect(isEncryptedObject({ [OBJECT_META.enc]: '' })).toBe(false);
  });

  it('reports an UNREADABLE version as encrypted, because sealing it a second time destroys it', () => {
    // The pair of answers that is safe: `true` here, and a throw from `readObjectEnvelope`. Answer
    // `false` and a finalize trigger seals ciphertext again and the plaintext is gone.
    const future = { [OBJECT_META.enc]: 'v4', [OBJECT_META.iv]: 'x', [OBJECT_META.tag]: 'y' };
    expect(isEncryptedObject(future)).toBe(true);
    expect(codeOf(() => readObjectEnvelope(SCAN_REF, future))).toBe('CONTENT_DECRYPT_FAILED');
  });

  it('is absent -> null from readObjectEnvelope, because what a plaintext object MEANS is the product’s call', () => {
    expect(readObjectEnvelope(SCAN_REF, {})).toBeNull();
    expect(readObjectEnvelope(SCAN_REF, undefined)).toBeNull();
    expect(readObjectEnvelope(SCAN_REF, { contentType: 'application/json' })).toBeNull();
  });

  it('is absent -> a refusal from openObject, because a caller that asked to open has decided', () => {
    expect(codeOf(() => openObject(key(), SCAN_REF, BODY, {}))).toBe('CONTENT_PLAINTEXT_AT_REGISTERED_PATH');
    expect(codeOf(() => openObject(key(), SCAN_REF, BODY, undefined))).toBe('CONTENT_PLAINTEXT_AT_REGISTERED_PATH');
    expect(
      codeOf(() => createObjectDecryptStream(key(), SCAN_REF, {}, { unverifiedChunks: 'accepted' })),
    ).toBe('CONTENT_PLAINTEXT_AT_REGISTERED_PATH');
  });
});

// ---------------------------------------------------------------------------
// A marked-but-broken envelope is never served
// ---------------------------------------------------------------------------

describe('a marked but broken envelope', () => {
  const { body, metadata } = sealObject(key(), SCAN_REF, SCAN_PATH, BODY);

  const cases: ReadonlyArray<readonly [string, Record<string, string | undefined>]> = [
    ['an unknown version', { [OBJECT_META.enc]: 'v2' }],
    ['a version that is not a version', { [OBJECT_META.enc]: 'yes' }],
    ['no IV', { [OBJECT_META.iv]: undefined }],
    ['an empty IV', { [OBJECT_META.iv]: '' }],
    ['no tag', { [OBJECT_META.tag]: undefined }],
    ['an empty tag', { [OBJECT_META.tag]: '' }],
    ['a short IV', { [OBJECT_META.iv]: Buffer.alloc(11).toString('base64') }],
    ['a long IV', { [OBJECT_META.iv]: Buffer.alloc(13).toString('base64') }],
    ['a truncated tag', { [OBJECT_META.tag]: Buffer.alloc(12).toString('base64') }],
    ['an IV that is not base64', { [OBJECT_META.iv]: 'not base64!!!!!!' }],
    ['a tag that is not base64', { [OBJECT_META.tag]: 'nope nope nope nope nope' }],
    ['a padded IV, which is a second spelling of one envelope', { [OBJECT_META.iv]: `${Buffer.alloc(12).toString('base64')}==` }],
  ];

  it.each(cases)('%s is CONTENT_DECRYPT_FAILED, never bytes', (_label, changes) => {
    const broken = tamper(metadata, changes);
    expect(codeOf(() => readObjectEnvelope(SCAN_REF, broken))).toBe('CONTENT_DECRYPT_FAILED');
    expect(codeOf(() => openObject(key(), SCAN_REF, body, broken))).toBe('CONTENT_DECRYPT_FAILED');
    expect(codeOf(() => createObjectDecryptStream(key(), SCAN_REF, broken, { unverifiedChunks: 'accepted' }))).toBe(
      'CONTENT_DECRYPT_FAILED',
    );
  });

  it('names the object path in details and no metadata value in the message', () => {
    // Metadata is written by whoever last saved the object. Interpolating one of its values into a
    // message puts an attacker-influenced string on a path that ends in Cloud Logging.
    const broken = tamper(metadata, { [OBJECT_META.enc]: '<script>v9' });
    try {
      readObjectEnvelope(SCAN_REF, broken);
      throw new Error('did not throw');
    } catch (err) {
      if (!isContentCryptoError(err)) throw err;
      expect(err.details).toEqual({ path: SCAN_REF.path });
      expect(err.message).not.toContain('<script>');
      expect(err.message).not.toContain(metadata[OBJECT_META.iv] as string);
      expect(err.message).not.toContain(metadata[OBJECT_META.tag] as string);
    }
  });

  it('refuses a malformed ref before it looks at any metadata', () => {
    expect(codeOf(() => readObjectEnvelope(undefined as unknown as ObjectRef, {}))).toBe('VALIDATION_ERROR');
    expect(codeOf(() => readObjectEnvelope({ bucket: '', path: 'a' }, {}))).toBe('VALIDATION_ERROR');
    expect(codeOf(() => readObjectEnvelope({ bucket: 'b' } as unknown as ObjectRef, {}))).toBe('VALIDATION_ERROR');
  });
});

// ---------------------------------------------------------------------------
// The buffered pair
// ---------------------------------------------------------------------------

describe('the buffered pair', () => {
  it('round-trips a body, and the ciphertext is exactly the plaintext length', () => {
    const k = key();
    const { body, metadata } = sealObject(k, SCAN_REF, SCAN_PATH, BODY);
    expect(body).toHaveLength(BODY.length);
    expect(body.equals(BODY)).toBe(false);
    expect(openObject(k, SCAN_REF, body, metadata).equals(BODY)).toBe(true);
  });

  it('round-trips an empty body, which is a real object and not an error', () => {
    const k = key();
    const empty = Buffer.alloc(0);
    const { body, metadata } = sealObject(k, SCAN_REF, SCAN_PATH, empty);
    expect(body).toHaveLength(0);
    expect(openObject(k, SCAN_REF, body, metadata)).toHaveLength(0);
  });

  it('verifies the tag BEFORE it returns a byte, which is why it is the default', () => {
    const k = key();
    const { body, metadata } = sealObject(k, SCAN_REF, SCAN_PATH, BODY);
    const corrupted = Buffer.from(body);
    corrupted[0] ^= 0xff;
    expect(codeOf(() => openObject(k, SCAN_REF, corrupted, metadata))).toBe('CONTENT_DECRYPT_FAILED');
  });

  it('refuses a tampered tag', () => {
    const k = key();
    const { body, metadata } = sealObject(k, SCAN_REF, SCAN_PATH, BODY);
    const forged = Buffer.from(metadata[OBJECT_META.tag] as string, 'base64');
    forged[0] ^= 0xff;
    const changed = tamper(metadata, { [OBJECT_META.tag]: forged.toString('base64') });
    expect(codeOf(() => openObject(k, SCAN_REF, body, changed))).toBe('CONTENT_DECRYPT_FAILED');
  });

  it('refuses a body opened under a different record key', () => {
    const { body, metadata } = sealObject(key(KEY_A), SCAN_REF, SCAN_PATH, BODY);
    expect(codeOf(() => openObject(key(KEY_B), SCAN_REF, body, metadata))).toBe('CONTENT_DECRYPT_FAILED');
  });

  it('carries no size ceiling, because an object has no document to fit inside', () => {
    const k = key();
    const large = Buffer.alloc(2_000_000, 0x7a);
    const { body, metadata } = sealObject(k, SCAN_REF, SCAN_PATH, large);
    expect(body).toHaveLength(large.length);
    expect(openObject(k, SCAN_REF, body, metadata)).toHaveLength(large.length);
  });

  it('throws KEY_MATERIAL_DESTROYED once the session that owns the key has closed', () => {
    const k = key();
    const { body, metadata } = sealObject(k, SCAN_REF, SCAN_PATH, BODY);
    zeroise(k);
    expect(codeOf(() => sealObject(k, SCAN_REF, SCAN_PATH, BODY))).toBe('KEY_MATERIAL_DESTROYED');
    expect(codeOf(() => openObject(k, SCAN_REF, body, metadata))).toBe('KEY_MATERIAL_DESTROYED');
    expect(codeOf(() => createObjectEncryptStream(k, SCAN_REF, SCAN_PATH))).toBe('KEY_MATERIAL_DESTROYED');
  });
});

// ---------------------------------------------------------------------------
// The AAD — §16.5 rows 11, 12 and 13
// ---------------------------------------------------------------------------

describe('the object AAD', () => {
  it('is obj/{bucket}/{objectPath}, which is this spec’s choice and not the plan’s (Q-O)', () => {
    expect(aadForObject(LAKE_REF)).toBe('obj/xbgsolutions-morph/objects/ab/cd/ef.bin');
    expect(aadForObject(LAKE_REF).startsWith(`${AAD_OBJECT_DOMAIN}/`)).toBe(true);
  });

  it('cannot collide with a content AAD, because no collection or root may be named obj', () => {
    // §10.4 statement 2: the prefix stands in for the payload-kind byte an object body does not
    // carry, and this is the property that makes it stand in for anything at all.
    expect(RESERVED_ROOTS.has(AAD_OBJECT_DOMAIN)).toBe(true);
  });

  it('MOVE MATRIX ROW 11 — a body moved to another BUCKET is CONTENT_DECRYPT_FAILED', () => {
    // Same bytes, same key, same object path: only the bucket varies, which is what makes this a
    // test of the AAD rather than of the key. One bucket per product, expressed in the crypto.
    const k = key();
    const { body, metadata } = sealObject(k, LAKE_REF, LAKE_PATH, BODY);
    const otherBucket: ObjectRef = { bucket: 'xbgsolutions-build', path: LAKE_REF.path };
    expect(codeOf(() => openObject(k, otherBucket, body, metadata))).toBe('CONTENT_DECRYPT_FAILED');
  });

  it('MOVE MATRIX ROW 12 — a body moved to another OBJECT PATH is CONTENT_DECRYPT_FAILED', () => {
    const k = key();
    const { body, metadata } = sealObject(k, LAKE_REF, LAKE_PATH, BODY);
    const otherPath: ObjectRef = { bucket: LAKE_REF.bucket, path: 'objects/ab/cd/00.bin' };
    expect(codeOf(() => openObject(k, otherPath, body, metadata))).toBe('CONTENT_DECRYPT_FAILED');
  });

  it('MOVE MATRIX ROW 13 — x-xbg-rec is a HINT: rewriting it does not stop the right key opening the body', () => {
    // ── §16.5 MOVE MATRIX, ROW 13 — the module-local half. This is the expectation
    // `tamper.test.ts` must LIFT, not re-derive from the table. The row's claim is "fails closed",
    // and it has two halves, which are the next two tests together:
    //
    //   (a) the hint is NOT in the AAD, so rewriting it authenticates exactly as before; and
    //   (b) the reader that followed the rewritten hint holds a DIFFERENT record key, and the
    //       body's tag then refuses it — CONTENT_DECRYPT_FAILED, which from the reader's position
    //       is precisely what happened.
    //
    // Asserting only (b) would pass just as well if the hint WERE authenticated, which is the
    // wrong reason, and would make the eventual removal of the hint from the envelope invisible.
    const k = key();
    const { body, metadata } = sealObject(k, SCAN_REF, SCAN_PATH, BODY);
    const redirected = tamper(metadata, {
      [OBJECT_META.rec]: 'accounts/acc-9/sfmapper/org-1/scans/scan-1',
    });
    expect(readObjectEnvelope(SCAN_REF, redirected)?.scopePath).toBe('accounts/acc-9/sfmapper/org-1/scans/scan-1');
    expect(openObject(k, SCAN_REF, body, redirected).equals(BODY)).toBe(true);
  });

  it('MOVE MATRIX ROW 13 — and the key the rewritten hint points at cannot open it: it fails CLOSED', () => {
    const { body, metadata } = sealObject(key(KEY_A), SCAN_REF, SCAN_PATH, BODY);
    const redirected = tamper(metadata, {
      [OBJECT_META.rec]: 'accounts/acc-9/sfmapper/org-1/scans/scan-1',
    });
    // What a reader following the hint would hold: the other record's key.
    const otherRecordKey = key(KEY_B, 'accounts/acc-9/sfmapper/org-1/scans/scan-1');
    expect(codeOf(() => openObject(otherRecordKey, SCAN_REF, body, redirected))).toBe('CONTENT_DECRYPT_FAILED');
  });

  it('a hint that is absent is null, and an object with no hint still opens', () => {
    const k = key();
    const { body, metadata } = sealObject(k, SCAN_REF, SCAN_PATH, BODY);
    const hintless = tamper(metadata, { [OBJECT_META.rec]: undefined });
    expect(readObjectEnvelope(SCAN_REF, hintless)?.scopePath).toBeNull();
    expect(openObject(k, SCAN_REF, body, hintless).equals(BODY)).toBe(true);
  });

  it('a hint that is not a document path is NOT validated on read, because nothing has been trusted yet', () => {
    // The write side refuses it; the read side is handed somebody else's string and must not turn
    // it into our exception before a single byte has been authenticated.
    const k = key();
    const { body, metadata } = sealObject(k, SCAN_REF, SCAN_PATH, BODY);
    const nonsense = tamper(metadata, { [OBJECT_META.rec]: '/not//a/path/' });
    expect(readObjectEnvelope(SCAN_REF, nonsense)?.scopePath).toBe('/not//a/path/');
    expect(openObject(k, SCAN_REF, body, nonsense).equals(BODY)).toBe(true);
  });

  it('an object body and a content value under one record key do not share an AAD', () => {
    // The kind byte cannot help here — an object body has none — so this is the prefix doing the
    // job §10.4 gives it. A content ciphertext handed to openObject fails; the reverse fails too.
    const k = key();
    const content = encryptField(k, 'objects/obj_7.name', 'a lens result');
    const asBody = Buffer.from(content, 'utf8');
    const { metadata } = sealObject(k, LAKE_REF, LAKE_PATH, BODY);
    expect(codeOf(() => openObject(k, LAKE_REF, asBody, metadata))).toBe('CONTENT_DECRYPT_FAILED');
  });
});

// ---------------------------------------------------------------------------
// The spill path — one grammar, one kind byte
// ---------------------------------------------------------------------------

describe('a blob spilled to an object', () => {
  it('keeps its payload-kind byte, so decodeBlob(openObject(...)) round-trips with no second grammar', () => {
    // §10.4 statement 3. v1's spill path was the one place "one grammar, one kind byte" was
    // abandoned; this is the executable form of it no longer being.
    const k = key();
    const value = { structuredOutput: { findings: [1, 2, 3], note: 'a lens result' }, ok: true };
    const plaintext = encodeBlob(value);
    const { body, metadata } = sealObject(k, LAKE_REF, LAKE_PATH, plaintext);
    const opened = openObject(k, LAKE_REF, body, metadata);
    expect(opened[0]).toBe(plaintext[0]);
    expect(decodeBlob(opened)).toStrictEqual(value);
  });

  it('is returned WHOLE by openObject — no byte is stripped off the front of an object body', () => {
    const k = key();
    const plaintext = Buffer.from([0x02, 0x7b, 0x7d]);
    const { body, metadata } = sealObject(k, LAKE_REF, LAKE_PATH, plaintext);
    expect(openObject(k, LAKE_REF, body, metadata).equals(plaintext)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// mergeObjectMetadata
// ---------------------------------------------------------------------------

describe('mergeObjectMetadata', () => {
  it('preserves the consumer’s existing custom metadata and lets the envelope win', () => {
    const { metadata } = sealObject(key(), SCAN_REF, SCAN_PATH, BODY);
    const merged = mergeObjectMetadata({ uploadedBy: 'acc-1', scanId: 'scan-3' }, metadata);
    expect(merged.uploadedBy).toBe('acc-1');
    expect(merged.scanId).toBe('scan-3');
    expect(merged[OBJECT_META.enc]).toBe('v3');
    expect(merged[OBJECT_META.tag]).toBe(metadata[OBJECT_META.tag]);
  });

  it('replaces a stale envelope entirely rather than leaving two beside each other', () => {
    const k = key();
    const first = sealObject(k, SCAN_REF, SCAN_PATH, BODY);
    const second = sealObject(k, SCAN_REF, SCAN_PATH, Buffer.from('re-uploaded'));
    const merged = mergeObjectMetadata(first.metadata, second.metadata);
    expect(merged[OBJECT_META.iv]).toBe(second.metadata[OBJECT_META.iv]);
    expect(merged[OBJECT_META.tag]).toBe(second.metadata[OBJECT_META.tag]);
    expect(openObject(k, SCAN_REF, second.body, merged).toString('utf8')).toBe('re-uploaded');
  });

  it('drops an undefined value rather than materialising a key that reads as present', () => {
    const { metadata } = sealObject(key(), SCAN_REF, SCAN_PATH, BODY);
    const merged = mergeObjectMetadata({ stale: undefined }, metadata);
    expect(Object.keys(merged)).not.toContain('stale');
  });

  it('takes undefined for "no existing metadata", which is what a fresh object has', () => {
    const { metadata } = sealObject(key(), SCAN_REF, SCAN_PATH, BODY);
    expect(mergeObjectMetadata(undefined, metadata)).toEqual({ ...metadata });
  });

  it('refuses to produce a bag that claims the marker without the rest of the envelope', () => {
    // The §10.6 window, written down on purpose rather than raced into: an object saying
    // "encrypted" with no tag can never be opened, and a reader trusting the marker serves
    // ciphertext as content.
    const { metadata } = sealObject(key(), SCAN_REF, SCAN_PATH, BODY);
    expect(codeOf(() => mergeObjectMetadata({ [OBJECT_META.enc]: 'v3' }, {}))).toBe('VALIDATION_ERROR');
    expect(
      codeOf(() =>
        mergeObjectMetadata(
          { [OBJECT_META.enc]: 'v3', [OBJECT_META.iv]: metadata[OBJECT_META.iv] },
          { contentLanguage: 'en-AU' },
        ),
      ),
    ).toBe('VALIDATION_ERROR');

    // The boundary, stated so it is not mistaken for a stricter rule than it is: this checks the
    // MERGED bag, not that the second argument is an envelope. Laying a non-envelope over metadata
    // whose envelope is already complete is exactly how a consumer adds a label to a sealed object,
    // and it is allowed.
    expect(mergeObjectMetadata(metadata, { contentLanguage: 'en-AU' })[OBJECT_META.tag]).toBe(
      metadata[OBJECT_META.tag],
    );
    expect(mergeObjectMetadata({ contentLanguage: 'en-AU' }, metadata)[OBJECT_META.tag]).toBe(
      metadata[OBJECT_META.tag],
    );
  });

  it('refuses a non-string value, which a store cannot hold anyway', () => {
    const { metadata } = sealObject(key(), SCAN_REF, SCAN_PATH, BODY);
    expect(codeOf(() => mergeObjectMetadata({ size: 42 as unknown as string }, metadata))).toBe('VALIDATION_ERROR');
    expect(codeOf(() => mergeObjectMetadata(['a'] as unknown as ObjectMetadata, metadata))).toBe('VALIDATION_ERROR');
  });

  it('does not pollute the prototype when a metadata key is __proto__', () => {
    const { metadata } = sealObject(key(), SCAN_REF, SCAN_PATH, BODY);
    const hostile = JSON.parse('{"__proto__": "polluted"}') as ObjectMetadata;
    const merged = mergeObjectMetadata(hostile, metadata);
    expect(({} as { polluted?: unknown }).polluted).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(merged, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(merged)).toBe(Object.prototype);
  });
});

// ---------------------------------------------------------------------------
// The streaming pair
// ---------------------------------------------------------------------------

describe('the streaming pair', () => {
  it('round-trips a multi-chunk body, with the metadata resolving only at the end', async () => {
    const k = key();
    const { stream, metadata } = createObjectEncryptStream(k, LAKE_REF, LAKE_PATH);

    let resolved = false;
    void metadata.then(() => {
      resolved = true;
    });

    const sealedChunks = drain(stream);
    stream.write(Buffer.from('one '));
    stream.write(Buffer.from('two '));
    // The metadata cannot exist yet: the tag does not exist until the last chunk has flushed,
    // which is the whole reason §10.6's write-ordering contract exists.
    expect(resolved).toBe(false);
    stream.end(Buffer.from('three'));

    const sealed = Buffer.concat((await sealedChunks).chunks);
    const envelope = await metadata;
    expect(sealed).toHaveLength('one two three'.length);
    expect(envelope[OBJECT_META.enc]).toBe('v3');
    expect(envelope[OBJECT_META.rec]).toBe(LAKE_PATH);

    // The buffered reader opens what the streaming writer produced. One format, two writers.
    expect(openObject(k, LAKE_REF, sealed, envelope).toString('utf8')).toBe('one two three');
  });

  it('is opened by the streaming reader too, given the acknowledgement', async () => {
    const k = key();
    const { body, metadata } = sealObject(k, LAKE_REF, LAKE_PATH, BODY);
    const open = createObjectDecryptStream(k, LAKE_REF, metadata, { unverifiedChunks: 'accepted' });
    const opened = drain(open);
    open.end(body);
    const { chunks, error } = await opened;
    expect(error).toBeNull();
    expect(Buffer.concat(chunks).equals(BODY)).toBe(true);
  });

  it('demands unverifiedChunks: ‘accepted’ at the call site, and takes nothing else for it', async () => {
    const k = key();
    const { metadata } = sealObject(k, LAKE_REF, LAKE_PATH, BODY);
    const bad: ReadonlyArray<unknown> = [
      undefined,
      null,
      {},
      { unverifiedChunks: true },
      { unverifiedChunks: 'yes' },
      { unverifiedChunks: 'ACCEPTED' },
    ];
    for (const opts of bad) {
      expect(
        codeOf(() =>
          createObjectDecryptStream(
            k,
            LAKE_REF,
            metadata,
            opts as { readonly unverifiedChunks: 'accepted' },
          ),
        ),
      ).toBe('VALIDATION_ERROR');
    }
  });

  it('emits plaintext BEFORE the tag is verified — the property the acknowledgement exists for', async () => {
    const k = key();
    const { body, metadata } = sealObject(k, LAKE_REF, LAKE_PATH, BODY);
    const forged = Buffer.from(metadata[OBJECT_META.tag] as string, 'base64');
    forged[0] ^= 0xff;
    const tampered = tamper(metadata, { [OBJECT_META.tag]: forged.toString('base64') });

    const open = createObjectDecryptStream(k, LAKE_REF, tampered, { unverifiedChunks: 'accepted' });
    const result = drain(open);
    open.end(body);
    const { chunks, error } = await result;
    // Both halves matter: bytes DID come out, and the failure still arrived.
    expect(Buffer.concat(chunks).length).toBeGreaterThan(0);
    expect(isContentCryptoError(error, 'CONTENT_DECRYPT_FAILED')).toBe(true);
  });

  it('rejects its metadata promise with CONTENT_ENCRYPT_FAILED when the stream is destroyed early (R5)', async () => {
    // NOT `VALIDATION_ERROR`. Nothing invalid was supplied — the ref, the scopePath and the key
    // were all checked before the stream existed — and a caller sent to inspect their own
    // arguments is a caller looking in the wrong place.
    const k = key();
    const { stream, metadata } = createObjectEncryptStream(k, LAKE_REF, LAKE_PATH);
    stream.write(Buffer.from('half an object'));
    stream.destroy();
    expect(await codeOfAsync(metadata)).toBe('CONTENT_ENCRYPT_FAILED');
  });

  it('replaces a foreign error rather than carrying it, so no upstream message reaches a log', async () => {
    const k = key();
    const { stream, metadata } = createObjectEncryptStream(k, LAKE_REF, LAKE_PATH);
    stream.destroy(new Error('ECONNRESET from somebody else’s library'));
    try {
      await metadata;
      throw new Error('did not reject');
    } catch (err) {
      if (!isContentCryptoError(err)) throw err;
      expect(err.code).toBe('CONTENT_ENCRYPT_FAILED');
      expect(err.message).not.toContain('ECONNRESET');
      expect((err as { cause?: unknown }).cause).toBeUndefined();
    }
  });

  it('does not turn an un-awaited metadata promise into an unhandled rejection', async () => {
    // The derived promise is a NEW promise: `createSealStream` pre-catching its own is not enough,
    // and without the catch inside the module this crashes the process on the next tick.
    const k = key();
    const rejections: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      rejections.push(reason);
    };
    process.on('unhandledRejection', onUnhandled);
    try {
      const { stream } = createObjectEncryptStream(k, LAKE_REF, LAKE_PATH);
      stream.destroy();
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
    expect(rejections).toEqual([]);
  });

  it('validates the ref and the scopePath when it is CONSTRUCTED, not when it flushes', () => {
    const k = key();
    expect(codeOf(() => createObjectEncryptStream(k, { bucket: 'b/c', path: 'x' }, LAKE_PATH))).toBe('VALIDATION_ERROR');
    expect(codeOf(() => createObjectEncryptStream(k, LAKE_REF, 'objects'))).toBe('VALIDATION_ERROR');
  });
});

// ---------------------------------------------------------------------------
// The write-ordering rule, as far as a unit test can reach it
// ---------------------------------------------------------------------------

describe('the write ordering §10.6 requires', () => {
  it('gives the buffered path a body and a COMPLETE envelope in one value, so one save carries both', () => {
    const sealed = sealObject(key(), SCAN_REF, SCAN_PATH, BODY);
    expect(Object.keys(sealed).sort()).toEqual(['body', 'metadata']);
    for (const header of Object.values(OBJECT_META)) {
      expect(Object.prototype.hasOwnProperty.call(sealed.metadata, header)).toBe(true);
    }
  });

  it('gives the streaming path a marker only in the resolved metadata, never before', async () => {
    // Clause 2 of the contract is only reachable if the marker is not available early. It is not:
    // the metadata promise is the only source of `x-xbg-enc` on this path.
    const k = key();
    const handle = createObjectEncryptStream(k, LAKE_REF, LAKE_PATH);
    expect(Object.keys(handle).sort()).toEqual(['metadata', 'stream']);
    const drained = drain(handle.stream);
    handle.stream.end(BODY);
    await drained;
    expect((await handle.metadata)[OBJECT_META.enc]).toBe('v3');
  });
});

// ---------------------------------------------------------------------------
// The envelope is not where key material lives
// ---------------------------------------------------------------------------

describe('the envelope', () => {
  it('carries an IV and a tag and no key material, which is why metadata may be read freely', () => {
    // Stated as a test because the entire rotation story rests on it: if the envelope carried any
    // key material, patching metadata could not be the rotation.
    const k = key();
    const { metadata } = sealObject(k, SCAN_REF, SCAN_PATH, BODY);
    const serialised = JSON.stringify(metadata);
    expect(serialised).not.toContain(KEY_A.toString('base64'));
    expect(serialised).not.toContain(KEY_A.toString('hex'));
    expect(Object.values(metadata)).toHaveLength(4);
  });

  it('is frozen, so a caller cannot edit one header of a sealed pair and save the rest', () => {
    const { metadata } = sealObject(key(), SCAN_REF, SCAN_PATH, BODY);
    expect(Object.isFrozen(metadata)).toBe(true);
  });

  it('is the same four headers however it was built, streaming or buffered', async () => {
    const k = key();
    const parts = sealParts(k, aadForObject(LAKE_REF), BODY);
    const built = objectEnvelopeMetadata(parts.iv, parts.tag, LAKE_PATH);
    const { metadata } = sealObject(k, LAKE_REF, LAKE_PATH, BODY);
    expect(Object.keys(built).sort()).toEqual(Object.keys(metadata).sort());
    expect(openObject(k, LAKE_REF, parts.ciphertext, built).equals(BODY)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// R14 — only a record key may seal an object
// ---------------------------------------------------------------------------

describe('R14 — only a record key may seal an object', () => {
  const dek = (): RecordKey => dekFromBytes(KEY_A, 'sfmapper/acc-1@1') as unknown as RecordKey;

  const messageOf = (fn: () => unknown): string => {
    try {
      fn();
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
    return '(no throw)';
  };

  it('sealObject refuses an account DEK', () => {
    expect(codeOf(() => sealObject(dek(), SCAN_REF, SCAN_PATH, BODY))).toBe('VALIDATION_ERROR');
    expect(messageOf(() => sealObject(dek(), SCAN_REF, SCAN_PATH, BODY))).toContain(
      'sealObject key must be a record-key handle',
    );
  });

  it('createObjectEncryptStream refuses one as a THROW at the call site, never a rejection', () => {
    // It matters which: a rejection arrives after a consumer has begun piping a 26 MB upload,
    // and the stream has already been handed out by then.
    expect(codeOf(() => createObjectEncryptStream(dek(), SCAN_REF, SCAN_PATH))).toBe(
      'VALIDATION_ERROR',
    );
    expect(messageOf(() => createObjectEncryptStream(dek(), SCAN_REF, SCAN_PATH))).toContain(
      'createObjectEncryptStream key must be a record-key handle',
    );
  });

  it('checks the key before the scopePath, because an object body is the dearest thing to seal twice', () => {
    // Both refusals are VALIDATION_ERROR, so only the message separates them. With a bad key AND
    // a bad scopePath the key is reported, because it is the fact that makes the other moot.
    expect(messageOf(() => sealObject(dek(), SCAN_REF, '', BODY))).toContain('sealObject key');
    expect(messageOf(() => createObjectEncryptStream(dek(), SCAN_REF, ''))).toContain(
      'createObjectEncryptStream key',
    );
  });

  it('leaves the read side alone: a body sealed under its record key still opens', () => {
    const k = key();
    const { body, metadata } = sealObject(k, SCAN_REF, SCAN_PATH, BODY);
    expect(openObject(k, SCAN_REF, body, metadata).equals(BODY)).toBe(true);
  });
});
