/**
 * The one AES call site. Spec §7.1.
 *
 * **Internal. Not exported from `index.ts`** — `check-mirror.js` assertion (7) fails the build if
 * the barrel ever re-exports from here. Every seal and open in the package goes through this file
 * and nowhere else: a field value, a blob, a record-key wrap, an object body. That is what makes
 * "one encryption model" a checkable property rather than an intention — `createCipheriv` appears
 * exactly twice in the tree, both times below, and both times with `{ authTagLength: 16 }`.
 *
 * These rules hold here, each asserted by `cipher.test.ts` — enumerated and not counted, so a
 * sixth joins the list and nothing above it needs editing:
 *
 *   1. **`{ authTagLength: 16 }` is passed explicitly on both sides.** Node defaults to 16 for GCM;
 *      passing it is what makes a truncated tag a construction error rather than an accepted one.
 *   2. **Decrypt order is fixed:** `createDecipheriv` -> `setAAD` -> `setAuthTag` -> `update` ->
 *      `final`. Any other order either throws or silently skips authentication depending on the
 *      Node version, and "silently skips authentication" is not a failure mode this package may
 *      have.
 *   3. **`assertAad` runs on every call.** An empty AAD is a `VALIDATION_ERROR`, never a default:
 *      AES-GCM accepts a zero-length AAD happily and would seal a value bound to nothing.
 *   4. **The IV is 12 fresh random bytes per seal**, from `randomBytes`, never a counter, never
 *      derived, and never `randomFillSync` into a reused buffer. See `MAX_SEALS_PER_KEY` and §18
 *      Q-IV for the budget that implies.
 *   5. **No key derivation anywhere.** Separation comes from the record key and from the AAD. No
 *      HKDF, no per-field subkey; adding one would be a format change, not an improvement.
 *
 * The bytes are reached through `secretBytes` and are never held in a local beyond the call. A
 * destroyed handle throws `KEY_MATERIAL_DESTROYED` from there, which is what makes
 * `session.close()` mean something.
 *
 * ── WHERE THE KIND REFUSAL LIVES, AND WHY NOT HERE (R14) ──
 *
 * `sealBuffer` takes `Secret<string>` rather than `RecordKey` because `record-key.ts` seals a
 * record key under an `AccountDek` through this same primitive. The rule that expresses plan §5a's
 * central point — an account DEK cannot reach a content codec — is therefore stated in the CODECS
 * above this file, not in it, and since R14 it is stated twice over: in the types
 * (`encryptField`, `encryptBlob`, `sealObject`, `createObjectEncryptStream` take a `RecordKey`;
 * `wrapRecordKey` takes a DEK handle) and at runtime, each of those five calling
 * `assertKind(key, …)` from `secret.ts` on the way in. A plain-JavaScript caller and a cast get
 * the same answer the compiler gives.
 *
 * It is not stated here, and the reason is worth writing down because "put the check at the choke
 * point" is the obvious instinct and is wrong in this one case:
 *
 *  - **A guard in `sealBuffer` would have to read the prefix to know which kind to demand**, and
 *    the prefixes are VALUES owned by `field-codec.ts`, which imports this module. Importing
 *    `WRAP_PREFIX` as a value rebuilds exactly the two-module runtime cycle R6/R9 removed, and
 *    re-spelling `'wrap:v1:'` here breaks the one-file-per-wire-prefix rule that
 *    `check-mirror.js` assertion (6) enforces. This module is handed a prefix, not a meaning —
 *    the same reason it cannot tell a broken wrap from corrupt content on the way back out.
 *  - **`sealParts` and `createSealStream` are handed even less**: bytes and an AAD, with no
 *    statement at all of what they are. A guard there would be guessing, and the package's own
 *    legacy fixtures build v1/v2 values through `sealParts` under a DEK precisely because those
 *    bytes were never content under a record key.
 *
 * So the rule is: **the refusal lives wherever the purpose is known.** For a field, a blob and an
 * object that is the codec; for a wrap it is `wrapRecordKey`, which asserts BOTH halves — `'dek'`
 * on the wrapping handle through `assertDekHandle`, `'record-key'` on the material being wrapped.
 * Every content seal in the package enters through one of those five doors; `cipher.test.ts`
 * reaches the primitives directly because it is testing the primitives.
 *
 * ── Where the AES-GCM parameters live, and why there is no cycle ──
 *
 * `IV_BYTES` and `TAG_BYTES` are declared HERE, beside the algorithm and the five cipher
 * constructions they parametrise. A 12-byte IV and a 16-byte tag are facts about AES-GCM, not
 * facts about the `enc:v3:` string: change the cipher and both change with it, while every other
 * wire fact in `field-codec.ts` would stand.
 *
 * They were declared in `field-codec.ts` until the owner's ruling R6/R9 moved them, and that move
 * removed a genuine two-module cycle as a side effect — this file imported two VALUES from
 * `field-codec.ts` while `field-codec.ts` imported `sealBuffer` and `openBuffer` from here. The
 * old note called the cycle safe because every use sat inside a function body. It probably was;
 * "probably safe under this emit" is a worse property to rest on than "not a cycle".
 *
 * What is left runs one way. `field-codec.ts` imports these two constants and the two primitives
 * from this file; this file imports from `field-codec.ts` **only types** — `PayloadKind`, and the
 * `typeof ENC_PREFIX_V3 | typeof WRAP_PREFIX` that spells `WirePrefix` — which erase at compile
 * time and are no runtime edge at all.
 *
 * The two constants stay PUBLISHED from `field-codec.ts` (§4), which re-exports them. Declaring
 * and publishing are different questions: a consumer asking how long an IV is asks the module that
 * owns the wire, and this module is not on the public surface for it to ask.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Transform } from 'node:stream';

import { assertAad } from './aad';
import { ContentCryptoError } from './errors';
import type { ENC_PREFIX_V3, PayloadKind, WRAP_PREFIX } from './field-codec';
import { secretBytes } from './secret';
import type { Secret } from './secret';

const ALGORITHM = 'aes-256-gcm';

/**
 * The AES-GCM parameters, declared once for the whole package (R6/R9).
 *
 * **12 bytes of IV** is GCM's native length: any other length is run through GHASH first, which is
 * slower and buys nothing, and 96 bits is what every interoperable implementation writes. See rule
 * 4 above and `MAX_SEALS_PER_KEY` for the collision budget a random 96-bit IV implies.
 *
 * **16 bytes of tag** is the full tag, passed explicitly as `{ authTagLength: TAG_BYTES }` on both
 * sides so that a truncated tag is a construction error rather than an accepted one — a 12-byte tag
 * is 2^32 times easier to forge, and Node will take one on `setAuthTag` unless the length was
 * pinned at construction.
 *
 * Both are on the WIRE as well as in the cipher, so `field-codec.ts` imports them for its strict
 * decoder and re-exports them: §4 publishes them from there, and a consumer asking how long an IV
 * is asks the module that owns the wire.
 */
export const IV_BYTES = 12;
export const TAG_BYTES = 16;

/**
 * The two prefixes a PACKED value can carry: content under a record key, and a record-key wrap
 * under an account DEK. Both are `typeof` an `ENC_PREFIX_*` constant rather than a literal spelled
 * again here, because every wire prefix is declared in one file and a second spelling of `enc:v3:`
 * is a second thing to change.
 *
 * v1 and v2 are absent on purpose. They are read by `legacy-readers.ts` through `openParts`, which
 * takes the pieces rather than a packed string, because a legacy plaintext carries no kind byte.
 */
export type WirePrefix = typeof ENC_PREFIX_V3 | typeof WRAP_PREFIX;

/**
 * Every part of a packed value is base64 with at most the two `=` of a canonical encoding. Shared
 * with `field-codec.ts`'s strict decoder in intent but declared separately in each: this one
 * guards the parse that immediately precedes a decrypt, and a single shared regex object with a
 * `g` flag would carry `lastIndex` between the two.
 */
const B64 = /^[A-Za-z0-9+/]*={0,2}$/;

/** The three parts of a packed value, unpacked but not yet authenticated. */
interface PackedParts {
  readonly iv: Buffer;
  readonly ciphertext: Buffer;
  readonly tag: Buffer;
}

/**
 * Seal `body` under `key` and pack it as `<prefix><iv>:<ct>:<tag>`.
 *
 * The kind byte is fed to the cipher as its OWN `update()` call — never
 * `Buffer.concat([kindByte, body])` — so sealing a 675 kB blob makes no extra copy of the
 * plaintext. GCM is a stream cipher, so the two `update` calls produce exactly `1 + body.length`
 * ciphertext bytes between them and the split is invisible on the wire.
 *
 * `maxSealedBytes`, when given, is checked as a PROJECTED length from §7.3's arithmetic, thrown
 * **before** `toString('base64')` runs: the whole point of the ceiling is to fail before a third
 * copy of a large payload exists (§8.5 step 3). The `details` carry the three byte counts and
 * nothing else — `collection`, `docId` and `fieldPath` are knowable only to `blob-codec.ts`, which
 * catches and re-throws with them.
 *
 * @throws VALIDATION_ERROR      an empty AAD, a non-Buffer body, a kind outside one byte
 * @throws BLOB_TOO_LARGE        the projected sealed length exceeds `maxSealedBytes`
 * @throws KEY_MATERIAL_DESTROYED  the handle has been zeroised (from `secretBytes`)
 */
export function sealBuffer(
  key: Secret<string>,
  aad: string,
  kind: PayloadKind,
  body: Buffer,
  prefix: WirePrefix,
  maxSealedBytes?: number,
): string {
  assertAad(aad);
  assertKindByte(kind);
  if (!Buffer.isBuffer(body)) {
    throw new ContentCryptoError(
      'VALIDATION_ERROR',
      `sealBuffer needs the payload as a Buffer, received ${typeName(body)}`,
      { constructorName: typeName(body) },
    );
  }

  if (maxSealedBytes !== undefined) {
    assertCeiling(maxSealedBytes);
    const projected = projectedSealedLength(prefix, body.length);
    if (projected > maxSealedBytes) {
      throw new ContentCryptoError(
        'BLOB_TOO_LARGE',
        `sealing ${body.length} plaintext bytes would emit ${projected} characters, over the ${maxSealedBytes}-character ceiling; refused before any base64 was produced`,
        { plaintextBytes: body.length, sealedBytes: projected, limitBytes: maxSealedBytes },
      );
    }
  }

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, secretBytes(key), iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  // The kind byte first, as its own call. `Buffer.from([kind])` is one byte; the body is passed
  // through untouched, which is the copy this shape exists to avoid.
  const head = cipher.update(Buffer.from([kind]));
  const rest = cipher.update(body);
  const last = cipher.final();
  const ciphertext = Buffer.concat([head, rest, last]);
  const tag = cipher.getAuthTag();

  return `${prefix}${iv.toString('base64')}:${ciphertext.toString('base64')}:${tag.toString('base64')}`;
}

/**
 * Open a packed value.
 *
 * `expect` is the set of payload kinds the caller can handle; a kind outside it is
 * `CONTENT_KIND_MISMATCH`, raised **after** the tag verifies, so it is a statement about
 * authenticated plaintext and never a guess about bytes.
 *
 * Returns the body WITHOUT the kind byte, and the kind BESIDE it (addendum finding 3). A blob's
 * kind is a real branch — `0x02` json, `0x03` deflated — that only the opened plaintext can
 * settle, and the object path already proves the discriminator must survive the open. The body is
 * a `subarray` view, so nothing is copied on this side either.
 *
 * **The failure code is the CONTENT one, and a wrap reader must re-code it.** A malformed envelope
 * or a tag that does not verify is `CONTENT_DECRYPT_FAILED` here; `record-key.ts` catches that and
 * re-throws `RECORD_KEY_UNWRAP_FAILED`, because from a wrap's position "this does not verify" means
 * the access list is broken rather than the content corrupt (§16.5 rows 7-10). This module cannot
 * make that distinction: it is handed a prefix, not a meaning.
 *
 * @throws VALIDATION_ERROR       an empty AAD, an empty `expect`, a non-string value
 * @throws CONTENT_DECRYPT_FAILED a malformed envelope, a wrong key, a wrong AAD, a tampered tag
 * @throws CONTENT_KIND_MISMATCH  authenticated plaintext of a kind the caller did not expect
 */
export function openBuffer(
  key: Secret<string>,
  aad: string,
  value: string,
  expect: readonly PayloadKind[],
  prefix: WirePrefix,
): { readonly kind: PayloadKind; readonly body: Buffer } {
  assertAad(aad);
  if (!Array.isArray(expect) || expect.length === 0) {
    throw new ContentCryptoError(
      'VALIDATION_ERROR',
      'openBuffer needs at least one permitted payload kind; a caller that expects none can never succeed',
    );
  }
  for (const kind of expect) assertKindByte(kind);

  const parts = unpack(value, prefix);
  const plaintext = openParts(key, aad, parts.iv, parts.tag, parts.ciphertext);
  // Defence, not a real branch: `unpack` already refused a zero-length ciphertext, and GCM
  // plaintext is the same length as its ciphertext. It is here so that if either of those two
  // facts ever changes, the failure is a coded error rather than `plaintext[0] === undefined`.
  if (plaintext.length < 1) {
    throw new ContentCryptoError(
      'CONTENT_DECRYPT_FAILED',
      'the authenticated plaintext is empty, so it carries no payload-kind byte',
    );
  }

  const kind = plaintext[0] as PayloadKind;
  if (!expect.includes(kind)) {
    throw new ContentCryptoError(
      'CONTENT_KIND_MISMATCH',
      `the value authenticated under this key and AAD carries payload kind 0x${kind.toString(16).padStart(2, '0')}, and this reader accepts ${expect.map((k) => `0x${k.toString(16).padStart(2, '0')}`).join(', ')}`,
    );
  }
  return { kind, body: plaintext.subarray(1) };
}

/**
 * Object bodies: raw bytes, no kind byte, `iv` and `tag` returned separately so the envelope can
 * carry them in custom metadata. collab's `encryptBuffer` (`lib/content-cipher.ts:143`),
 * generalised to a key handle.
 *
 * An object body is the one payload with no authenticated payload-kind byte, which is why the
 * object AAD keeps a domain prefix (§10.4). A blob spilled to an object keeps its kind byte anyway,
 * because `encodeBlob` returns it inside the plaintext buffer.
 */
export function sealParts(
  key: Secret<string>,
  aad: string,
  plaintext: Buffer,
): { readonly iv: Buffer; readonly tag: Buffer; readonly ciphertext: Buffer } {
  assertAad(aad);
  if (!Buffer.isBuffer(plaintext)) {
    throw new ContentCryptoError(
      'VALIDATION_ERROR',
      `sealParts needs the plaintext as a Buffer, received ${typeName(plaintext)}`,
      { constructorName: typeName(plaintext) },
    );
  }
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, secretBytes(key), iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { iv, tag: cipher.getAuthTag(), ciphertext };
}

/**
 * The inverse of `sealParts`, and the one open the legacy readers use — a v1/v2 plaintext has no
 * kind byte, so `openBuffer` would strip a byte of content off the front of it.
 *
 * A wrong-length `iv` or `tag` is `CONTENT_DECRYPT_FAILED` rather than `VALIDATION_ERROR`, which is
 * collab's choice (`content-cipher.ts:155`) and the right one: those two values arrive from object
 * metadata or from a decoded envelope, so a bad length is a broken envelope rather than a
 * programming error, and the caller must never serve those bytes.
 */
export function openParts(
  key: Secret<string>,
  aad: string,
  iv: Buffer,
  tag: Buffer,
  ciphertext: Buffer,
): Buffer {
  assertAad(aad);
  assertPart('iv', iv, IV_BYTES);
  assertPart('tag', tag, TAG_BYTES);
  if (!Buffer.isBuffer(ciphertext)) {
    throw new ContentCryptoError(
      'CONTENT_DECRYPT_FAILED',
      `the ciphertext is not bytes but a ${typeName(ciphertext)}`,
    );
  }

  // The fixed order. `setAAD` before `setAuthTag` before `update` before `final`.
  const decipher = createDecipheriv(ALGORITHM, secretBytes(key), iv, { authTagLength: TAG_BYTES });
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    // The caught error is DISCARDED, never wrapped and never carried as a `cause` (§11.3): it is
    // an upstream message on a path that ends in a log, and it says nothing this message does not.
    throw new ContentCryptoError(
      'CONTENT_DECRYPT_FAILED',
      'the value could not be decrypted: it is corrupt, it was sealed under a different key, or it has been moved to another field, document, record or bucket',
    );
  }
}

/**
 * Streaming seal for an object body. collab's `createEncryptStream`
 * (`lib/content-cipher.ts:219`), whose three hard-won behaviours are ported deliberately:
 *
 *   - `iv` is known up front, so a writer can begin the upload immediately;
 *   - `tag` resolves in `flush()`, AFTER the last plaintext chunk — which is why §10.6's write
 *     ordering exists at all: the marker and the tag must become visible in one operation;
 *   - the promise is PRE-CAUGHT, so a caller that never awaits it cannot turn a destroyed stream
 *     into an unhandled rejection that takes the process down, and it REJECTS on an early close
 *     rather than hanging for ever.
 */
export function createSealStream(
  key: Secret<string>,
  aad: string,
): { readonly stream: Transform; readonly iv: Buffer; readonly tag: Promise<Buffer> } {
  assertAad(aad);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, secretBytes(key), iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(aad, 'utf8'));

  let resolveTag!: (tag: Buffer) => void;
  let rejectTag!: (err: Error) => void;
  let settled = false;
  const tag = new Promise<Buffer>((resolve, reject) => {
    resolveTag = (t) => {
      settled = true;
      resolve(t);
    };
    rejectTag = (e) => {
      settled = true;
      reject(e);
    };
  });
  // A caller that never awaits the tag must not surface an unhandled rejection.
  tag.catch(() => undefined);

  const stream = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      try {
        callback(null, cipher.update(chunk));
      } catch {
        callback(sealStreamFailure());
      }
    },
    flush(callback) {
      try {
        const last = cipher.final();
        resolveTag(cipher.getAuthTag());
        callback(null, last);
      } catch {
        const err = sealStreamFailure();
        rejectTag(err);
        callback(err);
      }
    },
  });
  stream.on('error', (err: Error) => {
    if (!settled) rejectTag(err);
  });
  stream.on('close', () => {
    if (!settled) {
      rejectTag(
        new ContentCryptoError(
          'CONTENT_ENCRYPT_FAILED',
          'the seal stream closed before it finished, so there is no authentication tag: the object body is incomplete and its envelope must not be written',
        ),
      );
    }
  });
  return { stream, iv, tag };
}

/**
 * Streaming open for an object body, given the `iv` and `tag` from its envelope. collab's
 * `createDecryptStream` (`lib/content-cipher.ts:275`).
 *
 * **It emits plaintext before the tag is verified** — a GCM decrypt stream has no choice, the tag
 * is checked in `flush()` — so the stream emits `error` at the END if it does not verify. That is
 * why `createObjectDecryptStream` (§10.5) demands `unverifiedChunks: 'accepted'` at its call site
 * and why `openObject` is the default: a consumer that must not expose unverified bytes buffers
 * until `end`, and one that says so out loud is one that has thought about it.
 */
export function createOpenStream(
  key: Secret<string>,
  aad: string,
  iv: Buffer,
  tag: Buffer,
): Transform {
  assertAad(aad);
  assertPart('iv', iv, IV_BYTES);
  assertPart('tag', tag, TAG_BYTES);
  const decipher = createDecipheriv(ALGORITHM, secretBytes(key), iv, { authTagLength: TAG_BYTES });
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(tag);
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      try {
        callback(null, decipher.update(chunk));
      } catch {
        callback(
          new ContentCryptoError(
            'CONTENT_DECRYPT_FAILED',
            'the object body could not be decrypted: a chunk was rejected by the cipher',
          ),
        );
      }
    },
    flush(callback) {
      try {
        callback(null, decipher.final());
      } catch {
        callback(
          new ContentCryptoError(
            'CONTENT_DECRYPT_FAILED',
            'the object body could not be decrypted: it is corrupt or does not belong to this bucket and path',
          ),
        );
      }
    },
  });
}

/**
 * §7.3's arithmetic, as one function so nothing re-derives it:
 *
 *     sealed = prefix + 16 (iv) + 1 + 4*ceil(ctBytes/3) + 1 + 24 (tag)
 *            = prefix.length + 42 + 4*ceil((1 + bodyBytes)/3)
 *
 * which for `enc:v3:` is `49 + 4*ceil((1 + bodyBytes)/3)` and for `wrap:v1:` is one more. A
 * record-key wrap is therefore exactly 94 characters over its 33-byte plaintext (R17), and
 * `blob-json.ts`'s `maxPlaintextFor` is this function inverted.
 *
 * Package-internal: it takes a body length and a prefix, which is not a question a consumer can
 * ask usefully, and `maxPlaintextFor` is the public half.
 */
export function projectedSealedLength(prefix: WirePrefix, bodyBytes: number): number {
  const ciphertextBytes = 1 + bodyBytes;
  return prefix.length + 42 + 4 * Math.ceil(ciphertextBytes / 3);
}

// ---------------------------------------------------------------------------
// Module-private
// ---------------------------------------------------------------------------

/**
 * Split `<prefix><iv>:<ct>:<tag>` into its three parts, strictly.
 *
 * Every refusal is `CONTENT_DECRYPT_FAILED` and none of them names the bytes. On the content path
 * `decodeValue` has already run and turned a malformed value into `WRONG_KEY_LAYER` (§7.4), so
 * these arms are reachable in practice only from the wrap path, where `record-key.ts` re-codes
 * them — and from a caller that skipped the decoder, which is the case they exist for.
 *
 * The zero-length ciphertext refusal is decode rule 6: a packed plaintext is at minimum the kind
 * byte, so an empty ciphertext part is malformed by construction. Getting this wrong means a
 * hand-forged `enc:v3:<iv>::<tag>` reaches `createDecipheriv` and the resulting failure reads as
 * corruption rather than as a bad value.
 */
function unpack(value: string, prefix: WirePrefix): PackedParts {
  if (typeof value !== 'string') {
    throw new ContentCryptoError(
      'CONTENT_DECRYPT_FAILED',
      `a sealed value must be a string, received ${typeName(value)}`,
    );
  }
  if (!value.startsWith(prefix)) {
    throw new ContentCryptoError(
      'CONTENT_DECRYPT_FAILED',
      'the value does not carry the wire prefix this reader opens',
    );
  }
  const raw = value.slice(prefix.length).split(':');
  if (raw.length !== 3) {
    throw new ContentCryptoError(
      'CONTENT_DECRYPT_FAILED',
      `a sealed value has three parts after its prefix, and this one has ${raw.length}`,
    );
  }
  if (!raw.every((part) => B64.test(part))) {
    throw new ContentCryptoError(
      'CONTENT_DECRYPT_FAILED',
      'a sealed value carries three base64 parts, and one of these is not base64',
    );
  }
  const [iv, ciphertext, tag] = raw.map((part) => Buffer.from(part, 'base64'));
  if (iv.length !== IV_BYTES) {
    throw new ContentCryptoError(
      'CONTENT_DECRYPT_FAILED',
      `a sealed value carries a ${IV_BYTES}-byte IV, and this one decodes to ${iv.length}`,
    );
  }
  if (tag.length !== TAG_BYTES) {
    throw new ContentCryptoError(
      'CONTENT_DECRYPT_FAILED',
      `a sealed value carries a ${TAG_BYTES}-byte tag, and this one decodes to ${tag.length}`,
    );
  }
  if (ciphertext.length < 1) {
    throw new ContentCryptoError(
      'CONTENT_DECRYPT_FAILED',
      'a sealed value carries at least one ciphertext byte, because its plaintext begins with a payload-kind byte',
    );
  }
  return { iv, ciphertext, tag };
}

/** A payload kind is one byte. Nothing here knows which four are legal — `field-codec.ts` owns
 *  `PAYLOAD_KIND` — but a kind that cannot survive `Buffer.from([kind])` would be silently
 *  truncated into a different kind, and that is worth refusing where the byte is written. */
function assertKindByte(kind: PayloadKind): void {
  if (typeof kind !== 'number' || !Number.isInteger(kind) || kind < 0 || kind > 255) {
    throw new ContentCryptoError(
      'VALIDATION_ERROR',
      `a payload kind is a single byte, received ${String(kind)}`,
    );
  }
}

function assertCeiling(maxSealedBytes: number): void {
  if (typeof maxSealedBytes !== 'number' || !Number.isInteger(maxSealedBytes) || maxSealedBytes < 1) {
    throw new ContentCryptoError(
      'VALIDATION_ERROR',
      `a sealed-length ceiling is a positive integer, received ${String(maxSealedBytes)}`,
      { limitBytes: typeof maxSealedBytes === 'number' ? maxSealedBytes : null },
    );
  }
}

function assertPart(name: 'iv' | 'tag', part: Buffer, bytes: number): void {
  if (!Buffer.isBuffer(part) || part.length !== bytes) {
    throw new ContentCryptoError(
      'CONTENT_DECRYPT_FAILED',
      `the ${name} must be exactly ${bytes} bytes, and this one is ${Buffer.isBuffer(part) ? `${part.length} bytes` : `a ${typeName(part)}`}`,
    );
  }
}

/**
 * The one classification the seal streams make, and it is `CONTENT_ENCRYPT_FAILED` rather than
 * `VALIDATION_ERROR`.
 *
 * The distinction is one line: `VALIDATION_ERROR` says the caller supplied something this package
 * will not accept, and `CONTENT_ENCRYPT_FAILED` says the seal itself failed. Nothing invalid was
 * *supplied* here — `createSealStream` validated its AAD and its key when it was constructed, and
 * what fails afterwards is a `cipher.update` or a `cipher.final` inside a live stream. Reporting
 * that as a validation failure sends whoever is debugging it to inspect an input that was never
 * the problem, and that misdirection compounds for every later reader of the log.
 *
 * The upstream message is discarded rather than carried, as everywhere else (§11.3).
 */
function sealStreamFailure(): ContentCryptoError {
  return new ContentCryptoError(
    'CONTENT_ENCRYPT_FAILED',
    'the seal stream could not seal a chunk, so the object body is incomplete and its envelope must not be written',
  );
}

/** The constructor name of an arbitrary value, without invoking anything on it. */
function typeName(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  const proto: unknown = Object.getPrototypeOf(value as object);
  if (proto === null || proto === undefined) return 'Object';
  const ctor = (proto as { constructor?: { name?: unknown } }).constructor;
  return typeof ctor?.name === 'string' ? ctor.name : 'Object';
}
