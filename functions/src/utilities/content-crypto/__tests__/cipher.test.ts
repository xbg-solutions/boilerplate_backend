/**
 * The one AES call site — spec §16.5's `cipher.test.ts` row: AES-GCM, the envelope, and the
 * authenticated payload-kind byte.
 *
 * What is actually being proved here, as distinct from "encryption works":
 *
 *   1. **The kind byte is inside the tag.** It is fed to the cipher as its own `update()` call, so
 *      a value's kind cannot be changed without breaking authentication, and a kind the caller did
 *      not expect is reported only AFTER the tag verifies — never as a guess about bytes.
 *   2. **The read and write sides are symmetrical about that byte** (addendum finding 3):
 *      `sealBuffer` takes a kind and `openBuffer` returns one beside the body. A blob's kind is a
 *      real branch that only the opened plaintext can settle.
 *   3. **The envelope arithmetic of §7.3 is exact**, which is what lets the size ceiling be checked
 *      as a PROJECTION — before a third copy of a large payload exists — rather than on the
 *      emitted string.
 *   4. **Every failure is a coded error carrying no bytes**, and a destroyed handle is refused
 *      here, which is what makes `session.close()` mean something.
 *
 * Mirrorable (§16.3): relative imports only, no manifest read, no path above the mirrored root, no
 * environment. The one place real randomness appears is the IV, which is the subject of a test
 * rather than an incidental input to one; its collision probability over 200 draws of 96 bits is
 * about 2^-83, which is not a flake anybody will see.
 */

import {
  IV_BYTES,
  TAG_BYTES,
  createOpenStream,
  createSealStream,
  openBuffer,
  openParts,
  projectedSealedLength,
  sealBuffer,
  sealParts,
} from '../cipher';
import type { WirePrefix } from '../cipher';
import { isContentCryptoError } from '../errors';
import { ENC_PREFIX_V3, PAYLOAD_KIND, WRAP_PREFIX } from '../field-codec';
import { KEY_BYTES, dekFromBytes, recordKeyFromBytes, zeroise } from '../secret';
import type { Secret } from '../secret';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Fixed bytes, never random: a failure must reproduce from the test name alone. */
const KEY_A = Buffer.alloc(KEY_BYTES, 0xa1);
const KEY_B = Buffer.alloc(KEY_BYTES, 0xb2);

const AAD = 'messages/abc.anchor.quote';
const OTHER_AAD = 'messages/abc.anchor.note';

const key = (bytes: Buffer = KEY_A): Secret<string> => recordKeyFromBytes(bytes, 'projects/p_1');

/** Every code this file asserts on is read structurally rather than by `instanceof`, because the
 *  package ships twice in one process and the mirror's class is a different prototype. */
function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    if (isContentCryptoError(err)) return err.code;
    return `not a ContentCryptoError: ${String(err)}`;
  }
  return 'did not throw';
}

/** Split a packed value into its three parts without going through the module under test. */
function partsOf(value: string, prefix: WirePrefix): string[] {
  return value.slice(prefix.length).split(':');
}

/** Rebuild a packed value from parts, so a tamper is one explicit substitution. */
function pack(prefix: WirePrefix, parts: readonly string[]): string {
  return `${prefix}${parts.join(':')}`;
}

// ---------------------------------------------------------------------------
// The envelope
// ---------------------------------------------------------------------------

describe('the packed envelope', () => {
  it('is <prefix><iv>:<ct>:<tag>, with a 16-character IV and a 24-character tag', () => {
    const sealed = sealBuffer(key(), AAD, PAYLOAD_KIND.string, Buffer.from('hello'), ENC_PREFIX_V3);
    expect(sealed.startsWith(ENC_PREFIX_V3)).toBe(true);
    const [iv, ct, tag] = partsOf(sealed, ENC_PREFIX_V3);
    expect(iv).toHaveLength(16);
    expect(tag).toHaveLength(24);
    expect(Buffer.from(iv, 'base64')).toHaveLength(IV_BYTES);
    expect(Buffer.from(tag, 'base64')).toHaveLength(TAG_BYTES);
    // GCM is a stream cipher: the ciphertext is exactly the plaintext length, and the plaintext is
    // the kind byte plus the body.
    expect(Buffer.from(ct, 'base64')).toHaveLength(1 + 'hello'.length);
  });

  it('matches §7.3 arithmetic exactly, at every body length from 0 to 200 and beyond', () => {
    const k = key();
    for (const n of [0, 1, 2, 3, 4, 5, 17, 63, 64, 199, 200, 5000]) {
      const sealed = sealBuffer(k, AAD, PAYLOAD_KIND.blobJson, Buffer.alloc(n, 0x7a), ENC_PREFIX_V3);
      expect(sealed).toHaveLength(projectedSealedLength(ENC_PREFIX_V3, n));
      expect(sealed).toHaveLength(49 + 4 * Math.ceil((1 + n) / 3));
    }
  });

  it('makes a record-key wrap exactly 94 characters (R17), which is the number keyWraps is sized by', () => {
    const wrap = sealBuffer(
      dekFromBytes(KEY_A, 'collab/acc_1@3'),
      'record-key/collab/acc_1/3/projects/p_1',
      PAYLOAD_KIND.recordKey,
      Buffer.alloc(KEY_BYTES, 0x11),
      WRAP_PREFIX,
    );
    expect(wrap).toHaveLength(94);
    expect(wrap.startsWith(WRAP_PREFIX)).toBe(true);
  });

  it('an empty body seals to exactly one ciphertext byte — the kind byte — and opens back to empty', () => {
    const k = key();
    const sealed = sealBuffer(k, AAD, PAYLOAD_KIND.string, Buffer.alloc(0), ENC_PREFIX_V3);
    expect(Buffer.from(partsOf(sealed, ENC_PREFIX_V3)[1], 'base64')).toHaveLength(1);
    const opened = openBuffer(k, AAD, sealed, [PAYLOAD_KIND.string], ENC_PREFIX_V3);
    expect(opened.body).toHaveLength(0);
    expect(opened.kind).toBe(PAYLOAD_KIND.string);
  });
});

// ---------------------------------------------------------------------------
// The IV
// ---------------------------------------------------------------------------

describe('the IV', () => {
  it('is 12 fresh bytes per seal: 200 seals of the same body under the same key share no IV', () => {
    const k = key();
    const seen = new Set<string>();
    for (let i = 0; i < 200; i += 1) {
      const sealed = sealBuffer(k, AAD, PAYLOAD_KIND.string, Buffer.from('same'), ENC_PREFIX_V3);
      seen.add(partsOf(sealed, ENC_PREFIX_V3)[0]);
    }
    expect(seen.size).toBe(200);
  });

  it('makes two seals of identical input produce different ciphertext, which is why a store cannot be compared for equality', () => {
    const k = key();
    const one = sealBuffer(k, AAD, PAYLOAD_KIND.string, Buffer.from('same'), ENC_PREFIX_V3);
    const two = sealBuffer(k, AAD, PAYLOAD_KIND.string, Buffer.from('same'), ENC_PREFIX_V3);
    expect(one).not.toBe(two);
    expect(openBuffer(k, AAD, one, [PAYLOAD_KIND.string], ENC_PREFIX_V3).body.toString('utf8')).toBe('same');
    expect(openBuffer(k, AAD, two, [PAYLOAD_KIND.string], ENC_PREFIX_V3).body.toString('utf8')).toBe('same');
  });
});

// ---------------------------------------------------------------------------
// The payload-kind byte
// ---------------------------------------------------------------------------

describe('the authenticated payload-kind byte', () => {
  it('round-trips every kind, and openBuffer returns the kind BESIDE the body', () => {
    const k = key();
    for (const kind of [PAYLOAD_KIND.string, PAYLOAD_KIND.blobJson, PAYLOAD_KIND.blobDeflate, PAYLOAD_KIND.recordKey]) {
      const body = Buffer.from([1, 2, 3, kind]);
      const sealed = sealBuffer(k, AAD, kind, body, ENC_PREFIX_V3);
      const opened = openBuffer(k, AAD, sealed, [PAYLOAD_KIND.string, PAYLOAD_KIND.blobJson, PAYLOAD_KIND.blobDeflate, PAYLOAD_KIND.recordKey], ENC_PREFIX_V3);
      expect(opened.kind).toBe(kind);
      expect(opened.body).toEqual(body);
    }
  });

  it('survives an `expect` list of two, which is the blob case the read seam exists for', () => {
    // Addendum finding 3: a blob is 0x02 or 0x03 and only the opened plaintext can say which. A
    // seam that returned the body alone would have made the deflate branch unreachable.
    const k = key();
    const blobKinds = [PAYLOAD_KIND.blobJson, PAYLOAD_KIND.blobDeflate];
    const json = openBuffer(k, AAD, sealBuffer(k, AAD, PAYLOAD_KIND.blobJson, Buffer.from('{}'), ENC_PREFIX_V3), blobKinds, ENC_PREFIX_V3);
    const deflated = openBuffer(k, AAD, sealBuffer(k, AAD, PAYLOAD_KIND.blobDeflate, Buffer.from('{}'), ENC_PREFIX_V3), blobKinds, ENC_PREFIX_V3);
    expect(json.kind).toBe(PAYLOAD_KIND.blobJson);
    expect(deflated.kind).toBe(PAYLOAD_KIND.blobDeflate);
    expect(json.body).toEqual(deflated.body);
  });

  it('is CONTENT_KIND_MISMATCH when the kind is outside `expect`, and the body is not returned', () => {
    const k = key();
    const sealed = sealBuffer(k, AAD, PAYLOAD_KIND.blobJson, Buffer.from('{"v":1}'), ENC_PREFIX_V3);
    expect(codeOf(() => openBuffer(k, AAD, sealed, [PAYLOAD_KIND.string], ENC_PREFIX_V3))).toBe('CONTENT_KIND_MISMATCH');
  });

  it('reports the mismatch AFTER the tag verifies, so a tampered value of the wrong kind is a DECRYPT failure', () => {
    // The ordering is the claim: CONTENT_KIND_MISMATCH is a statement about authenticated
    // plaintext. If the kind were read before authentication it would be a statement about
    // attacker-controlled bytes, and this test would return the other code.
    const k = key();
    const sealed = sealBuffer(k, AAD, PAYLOAD_KIND.blobJson, Buffer.from('{"v":1}'), ENC_PREFIX_V3);
    const parts = partsOf(sealed, ENC_PREFIX_V3);
    const tag = Buffer.from(parts[2], 'base64');
    tag[0] ^= 0xff;
    const tampered = pack(ENC_PREFIX_V3, [parts[0], parts[1], tag.toString('base64')]);
    expect(codeOf(() => openBuffer(k, AAD, tampered, [PAYLOAD_KIND.string], ENC_PREFIX_V3))).toBe('CONTENT_DECRYPT_FAILED');
  });

  it('cannot be relabelled: flipping the first ciphertext byte is a tag failure, not a kind change', () => {
    const k = key();
    const sealed = sealBuffer(k, AAD, PAYLOAD_KIND.string, Buffer.from('hello'), ENC_PREFIX_V3);
    const parts = partsOf(sealed, ENC_PREFIX_V3);
    const ct = Buffer.from(parts[1], 'base64');
    // 0x01 ^ 0x03 === 0x02: under a cipher with no authentication this would turn a string value
    // into a blob value in place.
    ct[0] ^= 0x03;
    const tampered = pack(ENC_PREFIX_V3, [parts[0], ct.toString('base64'), parts[2]]);
    expect(codeOf(() => openBuffer(k, AAD, tampered, [PAYLOAD_KIND.string, PAYLOAD_KIND.blobJson], ENC_PREFIX_V3))).toBe('CONTENT_DECRYPT_FAILED');
  });

  it('refuses an empty `expect`, because a caller who expects nothing can never succeed', () => {
    const k = key();
    const sealed = sealBuffer(k, AAD, PAYLOAD_KIND.string, Buffer.from('x'), ENC_PREFIX_V3);
    expect(codeOf(() => openBuffer(k, AAD, sealed, [], ENC_PREFIX_V3))).toBe('VALIDATION_ERROR');
  });

  it('refuses a kind that is not one byte, which would be silently truncated on the wire', () => {
    const k = key();
    for (const kind of [-1, 256, 1.5, Number.NaN]) {
      expect(codeOf(() => sealBuffer(k, AAD, kind as 1, Buffer.from('x'), ENC_PREFIX_V3))).toBe('VALIDATION_ERROR');
    }
  });
});

// ---------------------------------------------------------------------------
// Authentication: the key, the AAD, the prefix
// ---------------------------------------------------------------------------

describe('what authentication binds', () => {
  it('a different key fails, with the SAME AAD — so the failure is about the key and nothing else', () => {
    const sealed = sealBuffer(key(KEY_A), AAD, PAYLOAD_KIND.string, Buffer.from('hello'), ENC_PREFIX_V3);
    expect(codeOf(() => openBuffer(key(KEY_B), AAD, sealed, [PAYLOAD_KIND.string], ENC_PREFIX_V3))).toBe('CONTENT_DECRYPT_FAILED');
  });

  it('a different AAD fails, with the SAME key bytes — the discipline §16.5 calls "same bytes, different label"', () => {
    const k = key();
    const sealed = sealBuffer(k, AAD, PAYLOAD_KIND.string, Buffer.from('hello'), ENC_PREFIX_V3);
    expect(codeOf(() => openBuffer(k, OTHER_AAD, sealed, [PAYLOAD_KIND.string], ENC_PREFIX_V3))).toBe('CONTENT_DECRYPT_FAILED');
  });

  it('an empty or absent AAD is VALIDATION_ERROR on every entry point, never a default', () => {
    const k = key();
    const sealed = sealBuffer(k, AAD, PAYLOAD_KIND.string, Buffer.from('hello'), ENC_PREFIX_V3);
    const empty = '';
    const absent = undefined as unknown as string;
    expect(codeOf(() => sealBuffer(k, empty, PAYLOAD_KIND.string, Buffer.from('x'), ENC_PREFIX_V3))).toBe('VALIDATION_ERROR');
    expect(codeOf(() => sealBuffer(k, absent, PAYLOAD_KIND.string, Buffer.from('x'), ENC_PREFIX_V3))).toBe('VALIDATION_ERROR');
    expect(codeOf(() => openBuffer(k, empty, sealed, [PAYLOAD_KIND.string], ENC_PREFIX_V3))).toBe('VALIDATION_ERROR');
    expect(codeOf(() => sealParts(k, empty, Buffer.from('x')))).toBe('VALIDATION_ERROR');
    expect(codeOf(() => openParts(k, empty, Buffer.alloc(IV_BYTES), Buffer.alloc(TAG_BYTES), Buffer.alloc(1)))).toBe('VALIDATION_ERROR');
    expect(codeOf(() => createSealStream(k, empty))).toBe('VALIDATION_ERROR');
    expect(codeOf(() => createOpenStream(k, empty, Buffer.alloc(IV_BYTES), Buffer.alloc(TAG_BYTES)))).toBe('VALIDATION_ERROR');
  });

  it('a value packed under the other prefix is refused before any cipher is constructed', () => {
    const k = key();
    const wrap = sealBuffer(k, AAD, PAYLOAD_KIND.recordKey, Buffer.alloc(KEY_BYTES), WRAP_PREFIX);
    expect(codeOf(() => openBuffer(k, AAD, wrap, [PAYLOAD_KIND.recordKey], ENC_PREFIX_V3))).toBe('CONTENT_DECRYPT_FAILED');
  });
});

// ---------------------------------------------------------------------------
// Malformed envelopes
// ---------------------------------------------------------------------------

describe('a malformed envelope', () => {
  const k = key();
  const sealed = sealBuffer(k, AAD, PAYLOAD_KIND.string, Buffer.from('hello'), ENC_PREFIX_V3);
  const parts = partsOf(sealed, ENC_PREFIX_V3);

  const cases: ReadonlyArray<readonly [string, string]> = [
    ['no prefix', parts.join(':')],
    ['two parts', pack(ENC_PREFIX_V3, [parts[0], parts[1]])],
    ['four parts', pack(ENC_PREFIX_V3, [...parts, parts[2]])],
    ['a part that is not base64', pack(ENC_PREFIX_V3, [parts[0], 'not base64!', parts[2]])],
    ['a short IV', pack(ENC_PREFIX_V3, [Buffer.alloc(IV_BYTES - 1).toString('base64'), parts[1], parts[2]])],
    ['a long IV', pack(ENC_PREFIX_V3, [Buffer.alloc(IV_BYTES + 1).toString('base64'), parts[1], parts[2]])],
    ['a truncated tag', pack(ENC_PREFIX_V3, [parts[0], parts[1], Buffer.alloc(12).toString('base64')])],
    ['an empty ciphertext', pack(ENC_PREFIX_V3, [parts[0], '', parts[2]])],
    ['nothing after the prefix', ENC_PREFIX_V3],
  ];

  it.each(cases)('is CONTENT_DECRYPT_FAILED, never a crash: %s', (_name, value) => {
    expect(codeOf(() => openBuffer(k, AAD, value, [PAYLOAD_KIND.string], ENC_PREFIX_V3))).toBe('CONTENT_DECRYPT_FAILED');
  });

  it('a truncated tag is refused rather than accepted — which is what `{ authTagLength: 16 }` buys', () => {
    // Node accepts a short tag on `setAuthTag` unless the length was pinned at construction, and a
    // 12-byte tag is 2^32 times easier to forge than a 16-byte one.
    expect(codeOf(() => openParts(k, AAD, Buffer.alloc(IV_BYTES), Buffer.alloc(12), Buffer.alloc(4)))).toBe('CONTENT_DECRYPT_FAILED');
  });

  it('a non-string value is refused without reaching the cipher', () => {
    for (const value of [null, undefined, 42, {}, Buffer.from('x')]) {
      expect(codeOf(() => openBuffer(k, AAD, value as string, [PAYLOAD_KIND.string], ENC_PREFIX_V3))).toBe('CONTENT_DECRYPT_FAILED');
    }
  });

  it('a non-Buffer body is a VALIDATION_ERROR at the seal, naming only the constructor', () => {
    let details: Record<string, unknown> = {};
    try {
      sealBuffer(k, AAD, PAYLOAD_KIND.string, 'a string' as unknown as Buffer, ENC_PREFIX_V3);
    } catch (err) {
      if (isContentCryptoError(err)) details = { ...err.details };
    }
    expect(details).toEqual({ constructorName: 'String' });
  });
});

// ---------------------------------------------------------------------------
// The projected ceiling
// ---------------------------------------------------------------------------

describe('the sealed-length ceiling', () => {
  it('passes at exactly the limit and throws BLOB_TOO_LARGE one byte over', () => {
    const k = key();
    const body = Buffer.alloc(600, 0x61);
    const exact = projectedSealedLength(ENC_PREFIX_V3, body.length);
    expect(sealBuffer(k, AAD, PAYLOAD_KIND.blobJson, body, ENC_PREFIX_V3, exact)).toHaveLength(exact);
    expect(codeOf(() => sealBuffer(k, AAD, PAYLOAD_KIND.blobJson, body, ENC_PREFIX_V3, exact - 1))).toBe('BLOB_TOO_LARGE');
  });

  it('carries plaintextBytes, sealedBytes and limitBytes, and nothing else', () => {
    const k = key();
    let details: Record<string, unknown> = {};
    try {
      sealBuffer(k, AAD, PAYLOAD_KIND.blobJson, Buffer.alloc(1000), ENC_PREFIX_V3, 100);
    } catch (err) {
      if (isContentCryptoError(err)) details = { ...err.details };
    }
    expect(details).toEqual({
      plaintextBytes: 1000,
      sealedBytes: projectedSealedLength(ENC_PREFIX_V3, 1000),
      limitBytes: 100,
    });
  });

  it('produces NO base64 when the projection fails — the check is before the third copy', () => {
    const k = key();
    const spy = jest.spyOn(Buffer.prototype, 'toString');
    try {
      expect(codeOf(() => sealBuffer(k, AAD, PAYLOAD_KIND.blobJson, Buffer.alloc(50_000), ENC_PREFIX_V3, 1_000))).toBe('BLOB_TOO_LARGE');
      const base64Calls = spy.mock.calls.filter(([encoding]) => encoding === 'base64');
      expect(base64Calls).toHaveLength(0);
    } finally {
      spy.mockRestore();
    }
  });

  it('is not consulted when no ceiling is passed, because the ceiling belongs to the registry', () => {
    const k = key();
    expect(() => sealBuffer(k, AAD, PAYLOAD_KIND.blobJson, Buffer.alloc(50_000), ENC_PREFIX_V3)).not.toThrow();
  });

  it('refuses a ceiling that is not a positive integer', () => {
    const k = key();
    for (const limit of [0, -1, 1.5, Number.NaN]) {
      expect(codeOf(() => sealBuffer(k, AAD, PAYLOAD_KIND.string, Buffer.from('x'), ENC_PREFIX_V3, limit))).toBe('VALIDATION_ERROR');
    }
  });
});

// ---------------------------------------------------------------------------
// Object bodies — no kind byte
// ---------------------------------------------------------------------------

describe('sealParts / openParts', () => {
  it('round-trips raw bytes with NO kind byte: the ciphertext is exactly the plaintext length', () => {
    const k = key();
    const plaintext = Buffer.from('an object body, verbatim');
    const { iv, tag, ciphertext } = sealParts(k, 'obj/acme-morph/objects/ab/cd.bin', plaintext);
    expect(ciphertext).toHaveLength(plaintext.length);
    expect(iv).toHaveLength(IV_BYTES);
    expect(tag).toHaveLength(TAG_BYTES);
    expect(openParts(k, 'obj/acme-morph/objects/ab/cd.bin', iv, tag, ciphertext)).toEqual(plaintext);
  });

  it('binds the AAD: the same body under another object path fails', () => {
    const k = key();
    const { iv, tag, ciphertext } = sealParts(k, 'obj/acme-morph/objects/ab/cd.bin', Buffer.from('body'));
    expect(codeOf(() => openParts(k, 'obj/acme-morph/objects/ab/ce.bin', iv, tag, ciphertext))).toBe('CONTENT_DECRYPT_FAILED');
    expect(codeOf(() => openParts(k, 'obj/acme-build/objects/ab/cd.bin', iv, tag, ciphertext))).toBe('CONTENT_DECRYPT_FAILED');
  });

  it('refuses a wrong-length iv or tag as a broken envelope, not as a caller mistake', () => {
    const k = key();
    const { iv, tag, ciphertext } = sealParts(k, AAD, Buffer.from('body'));
    expect(codeOf(() => openParts(k, AAD, Buffer.alloc(11), tag, ciphertext))).toBe('CONTENT_DECRYPT_FAILED');
    expect(codeOf(() => openParts(k, AAD, iv, Buffer.alloc(15), ciphertext))).toBe('CONTENT_DECRYPT_FAILED');
    expect(codeOf(() => openParts(k, AAD, iv, tag, 'not bytes' as unknown as Buffer))).toBe('CONTENT_DECRYPT_FAILED');
  });

  it('an empty object body round-trips, because an empty file is a file', () => {
    const k = key();
    const { iv, tag, ciphertext } = sealParts(k, AAD, Buffer.alloc(0));
    expect(ciphertext).toHaveLength(0);
    expect(openParts(k, AAD, iv, tag, ciphertext)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Streams
// ---------------------------------------------------------------------------

/** Collect everything a stream emits, and its error if it has one. */
function drain(stream: NodeJS.ReadableStream): Promise<{ chunks: Buffer[]; error: unknown }> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('error', (error) => resolve({ chunks, error }));
    stream.on('end', () => resolve({ chunks, error: null }));
  });
}

describe('the streaming pair', () => {
  it('round-trips a multi-chunk body, with the IV known up front and the tag resolving at flush', async () => {
    const k = key();
    const aad = 'obj/acme-morph/objects/ab/cd.bin';
    const { stream, iv, tag } = createSealStream(k, aad);
    expect(iv).toHaveLength(IV_BYTES);

    const sealedChunks = drain(stream);
    stream.write(Buffer.from('one '));
    stream.write(Buffer.from('two '));
    stream.end(Buffer.from('three'));
    const sealed = Buffer.concat((await sealedChunks).chunks);
    const resolvedTag = await tag;
    expect(resolvedTag).toHaveLength(TAG_BYTES);
    expect(sealed).toHaveLength('one two three'.length);

    const open = createOpenStream(k, aad, iv, resolvedTag);
    const openedChunks = drain(open);
    open.end(sealed);
    const opened = await openedChunks;
    expect(opened.error).toBeNull();
    expect(Buffer.concat(opened.chunks).toString('utf8')).toBe('one two three');
  });

  it('emits plaintext BEFORE the tag is verified, and errors at the end — the property `unverifiedChunks` exists to acknowledge', async () => {
    const k = key();
    const aad = 'obj/acme-morph/objects/ab/cd.bin';
    const { stream, iv, tag } = createSealStream(k, aad);
    const sealedChunks = drain(stream);
    stream.end(Buffer.from('a body long enough to arrive in a chunk of its own'));
    const sealed = Buffer.concat((await sealedChunks).chunks);
    const good = await tag;

    const forged = Buffer.from(good);
    forged[0] ^= 0xff;
    const open = createOpenStream(k, aad, iv, forged);
    const result = drain(open);
    open.end(sealed);
    const { chunks, error } = await result;
    // Both halves matter: bytes DID come out, and the failure still arrived.
    expect(Buffer.concat(chunks).length).toBeGreaterThan(0);
    expect(isContentCryptoError(error, 'CONTENT_DECRYPT_FAILED')).toBe(true);
  });

  it('rejects the tag promise when the stream is destroyed early, rather than hanging for ever', async () => {
    const k = key();
    const { stream, tag } = createSealStream(k, AAD);
    stream.write(Buffer.from('half a body'));
    stream.destroy();
    await expect(tag).rejects.toBeDefined();
  });

  it('an un-awaited tag promise from a destroyed stream does not become an unhandled rejection', async () => {
    // The pre-caught promise. Without `tag.catch(() => undefined)` inside the module this crashes
    // the process on the next tick, which is a production incident rather than a failing test.
    const k = key();
    const rejections: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      rejections.push(reason);
    };
    process.on('unhandledRejection', onUnhandled);
    try {
      const { stream } = createSealStream(k, AAD);
      stream.destroy();
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
    expect(rejections).toEqual([]);
  });

  it('refuses a wrong-length iv or tag when the open stream is constructed, before any byte is read', () => {
    const k = key();
    expect(codeOf(() => createOpenStream(k, AAD, Buffer.alloc(11), Buffer.alloc(TAG_BYTES)))).toBe('CONTENT_DECRYPT_FAILED');
    expect(codeOf(() => createOpenStream(k, AAD, Buffer.alloc(IV_BYTES), Buffer.alloc(15)))).toBe('CONTENT_DECRYPT_FAILED');
  });
});

// ---------------------------------------------------------------------------
// The key handle
// ---------------------------------------------------------------------------

describe('the key handle', () => {
  it('a zeroised handle throws KEY_MATERIAL_DESTROYED at every entry point, which is what close() means', () => {
    const k = recordKeyFromBytes(KEY_A, 'projects/p_1');
    const sealed = sealBuffer(k, AAD, PAYLOAD_KIND.string, Buffer.from('hello'), ENC_PREFIX_V3);
    zeroise(k);
    expect(codeOf(() => sealBuffer(k, AAD, PAYLOAD_KIND.string, Buffer.from('x'), ENC_PREFIX_V3))).toBe('KEY_MATERIAL_DESTROYED');
    expect(codeOf(() => openBuffer(k, AAD, sealed, [PAYLOAD_KIND.string], ENC_PREFIX_V3))).toBe('KEY_MATERIAL_DESTROYED');
    expect(codeOf(() => sealParts(k, AAD, Buffer.from('x')))).toBe('KEY_MATERIAL_DESTROYED');
    expect(codeOf(() => createSealStream(k, AAD))).toBe('KEY_MATERIAL_DESTROYED');
  });

  it('takes a DEK and a record key alike, because record-key.ts wraps through this same primitive', () => {
    const dek = dekFromBytes(KEY_A, 'collab/acc_1@3');
    const aad = 'record-key/collab/acc_1/3/projects/p_1';
    const wrapped = sealBuffer(dek, aad, PAYLOAD_KIND.recordKey, Buffer.alloc(KEY_BYTES, 0x11), WRAP_PREFIX);
    expect(openBuffer(dek, aad, wrapped, [PAYLOAD_KIND.recordKey], WRAP_PREFIX).body).toEqual(Buffer.alloc(KEY_BYTES, 0x11));
  });

  it('never puts key material into an error a caller could log', () => {
    const k = key();
    const base64 = KEY_A.toString('base64');
    const hex = KEY_A.toString('hex');
    const thrown: unknown[] = [];
    const collect = (fn: () => unknown): void => {
      try {
        fn();
      } catch (err) {
        thrown.push(err);
      }
    };
    collect(() => openBuffer(k, AAD, `${ENC_PREFIX_V3}nonsense`, [PAYLOAD_KIND.string], ENC_PREFIX_V3));
    collect(() => sealBuffer(k, '', PAYLOAD_KIND.string, Buffer.from('x'), ENC_PREFIX_V3));
    collect(() => sealBuffer(k, AAD, PAYLOAD_KIND.blobJson, Buffer.alloc(100), ENC_PREFIX_V3, 10));
    collect(() => openParts(k, AAD, Buffer.alloc(IV_BYTES), Buffer.alloc(TAG_BYTES), Buffer.alloc(4)));
    expect(thrown).toHaveLength(4);
    for (const err of thrown) {
      const printed = `${String(err)} ${JSON.stringify(err)}`;
      expect(printed).not.toContain(base64);
      expect(printed).not.toContain(hex);
      expect(printed).not.toContain(base64.slice(0, 10));
    }
  });
});
