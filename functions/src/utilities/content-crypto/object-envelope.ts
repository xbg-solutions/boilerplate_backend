/**
 * The object envelope — `x-xbg-*` custom metadata, the buffered seal and open, and the streaming
 * pair. Spec §10.
 *
 * **Custom metadata only.** No storage client, no bucket-name literal, no ambient bucket
 * resolution: Cloud Storage is one bucket per product (workspace CLAUDE.md, settled 2026-08-17)
 * and the consumer owns its own. It hands in an `ObjectRef` and this module returns bytes and a
 * bag of metadata strings; who writes them, and in what order, is the consumer's business, subject
 * to the one ordering rule in §10.6 that this file's docblocks restate because streaming needs it.
 *
 * ── FOUR HEADERS, AND WHY THERE IS NO FIFTH ────────────────────────────────────────────────
 *
 * `x-xbg-enc` is the marker, `x-xbg-iv` and `x-xbg-tag` are the envelope, `x-xbg-rec` is a lookup
 * hint. **There is no keygen header**, and its absence is the whole point of the design: under
 * record keys the wrap lives on the owning record, so rotating an object is a metadata patch on a
 * Firestore document and touches no object bytes at all. collab's v1/v2 envelope carries a keygen,
 * which is why it also carries a re-encrypt-in-place routine and a bucket listing beside it; both
 * disappear. For Morph's lake — where the alternative is download, decrypt, re-encrypt and upload
 * every object in a tenant — that is the difference between a programme and an afternoon.
 *
 * ── THE OBJECT AAD IS THIS SPEC'S CHOICE, NOT THE PLAN'S ───────────────────────────────────
 *
 * `obj/{bucket}/{objectPath}` is the ONE AAD form in this package that still carries a domain
 * prefix, and — unlike the other three — **the programme plan does not fix it.** §18 Q-O is open on
 * it and wants a fourth row in `01-content-key-custody.md` §5a, for exactly the reason the other
 * three got one: three designers invented three different forms for the one unspecified AAD, which
 * is the evidence that an unspecified AAD does not stay unspecified. Until that row exists this is
 * a decision made here, and it freezes on first write like every other AAD.
 *
 * Two things it does that the unprefixed forms cannot:
 *
 *   1. **It stands in for the payload-kind byte.** An object body deliberately carries no kind byte
 *      (below), so the unforgeable-discriminator defence of §6.3 does not reach objects. Under one
 *      record key an unprefixed object AAD could in principle equal a content AAD; `obj/` cannot,
 *      because `RESERVED_ROOTS` refuses a collection or `root` named `obj`.
 *   2. **It binds the bucket**, so a body cannot be moved between two products' buckets even if
 *      both were somehow reachable under one key — and a misconfigured `--cors-file` or `storage`
 *      block is the documented way products reach each other's buckets by accident.
 *
 * ── NO KIND BYTE, AND WHAT THAT COSTS ──────────────────────────────────────────────────────
 *
 * An object body is raw bytes. Adding a payload-kind byte would force `createObjectDecryptStream`
 * to buffer and inspect its first plaintext byte before emitting anything, which defeats the reason
 * the streaming path exists. The asymmetry is deliberate and permanent.
 *
 * A blob SPILLED to an object keeps its kind byte anyway, because `encodeBlob` returns the byte
 * inside the plaintext buffer: `sealObject(key, ref, scopePath, encodeBlob(value))` writes
 * `[0x02|0x03][json]` as the object body and `decodeBlob(openObject(...))` reads it back and
 * verifies it. That is one grammar, not two, and it is why `openObject` returns the WHOLE body
 * rather than stripping a byte off the front of it the way `openBuffer` does.
 *
 * ── BUFFERED IS THE DEFAULT ────────────────────────────────────────────────────────────────
 *
 * `openObject` verifies the tag before it returns a single byte. `createObjectDecryptStream`
 * cannot — a GCM decrypt stream emits plaintext long before `flush()` verifies — so it demands
 * `unverifiedChunks: 'accepted'` as a REQUIRED argument, which puts the acknowledgement at the call
 * site instead of delegating it to five consumers remembering a docblock. Use the streaming pair
 * for Morph's lake and sf-mapper's 26 MB dumps; everything else uses `openObject`.
 *
 * ── WHAT `x-xbg-rec` LEAKS, STATED PLAINLY ─────────────────────────────────────────────────
 *
 * The hint is the record's **full document path**, not an opaque id, because under decision 4 a
 * record's identity IS its path and the wrap AAD binds that path — so the hint must name the same
 * thing the reader will use. For sf-mapper that path contains the accountId and the Salesforce
 * orgId. It leaks to anyone with bucket-metadata read, which is already a substantial privilege and
 * usually less revealing than the object path beside it; that is accepted, and it is more than v1
 * admitted, so the README says the extra sentence.
 *
 * It is a hint and **not a binding**: it is not in the AAD, and rewriting it redirects a reader to
 * unwrap a different record's key, whose tag then fails the body. It fails CLOSED, and the failure
 * is `CONTENT_DECRYPT_FAILED`, which from the reader's position is exactly what happened.
 */

import { Transform } from 'node:stream';

import { aadForObject } from './aad';
import {
  IV_BYTES,
  TAG_BYTES,
  createOpenStream,
  createSealStream,
  openParts,
  sealParts,
} from './cipher';
import { ContentCryptoError, isContentCryptoError } from './errors';
import { assertScopePath } from './key-scope';
import { assertKind } from './secret';
import type { RecordKey } from './secret';

// ---------------------------------------------------------------------------
// The shapes
// ---------------------------------------------------------------------------

/**
 * A bucket and a path within it. The consumer builds this; the package never derives a bucket name
 * and never holds one as a literal.
 *
 * `aad.ts` declares a structurally identical `ObjectRefLike` rather than importing this type,
 * because it lands ten build steps earlier. TypeScript is structural, so a ref built here passes
 * there with no cast; this is the one public name for the shape.
 */
export interface ObjectRef {
  readonly bucket: string;
  readonly path: string;
}

/**
 * Custom metadata as a storage client hands it over and takes it back: string values, and
 * `undefined` for a key that is not set.
 *
 * **An `undefined` value is an absent key throughout this module** — `isEncryptedObject` and
 * `readObjectEnvelope` both treat it that way, and `mergeObjectMetadata` drops it rather than
 * materialising a key that reads as present to `Object.keys` and absent to every reader here.
 */
export type ObjectMetadata = Readonly<Record<string, string | undefined>>;

/** The only version this module writes, and the only one it reads. */
export const OBJECT_ENC_VERSION = 'v3' as const;

/**
 * The four custom-metadata keys. Declared once, in one place, and every read and write in this file
 * goes through this object rather than spelling a header again.
 */
export const OBJECT_META = {
  enc: 'x-xbg-enc',
  iv: 'x-xbg-iv',
  tag: 'x-xbg-tag',
  rec: 'x-xbg-rec',
} as const;

/**
 * The envelope, read back off an object's metadata.
 *
 * `scopePath` is the `x-xbg-rec` hint and is `null` when the header is absent — which is legal:
 * an object sealed by a consumer that knows its record from context needs no hint, and a hint is
 * never trusted anyway.
 */
export interface ObjectEnvelope {
  readonly enc: typeof OBJECT_ENC_VERSION;
  readonly iv: Buffer;
  readonly tag: Buffer;
  readonly scopePath: string | null;
}

/**
 * The acknowledgement `createObjectDecryptStream` demands, spelled as a type with exactly one
 * inhabitant so that a caller cannot pass `true` by reflex.
 *
 * It is a required argument rather than an option with a default because the property it
 * acknowledges — plaintext leaves the stream before the tag is checked — is a property of GCM that
 * no amount of care in this file can remove. The only useful place to record that somebody thought
 * about it is the call site.
 */
export type UnverifiedStreamAck = 'accepted';

// ---------------------------------------------------------------------------
// Reading the envelope
// ---------------------------------------------------------------------------

/**
 * Is this object marked as encrypted at all?
 *
 * **It asks whether the MARKER is present, not whether this reader can open it**, and the
 * difference matters in exactly one place, which is the place it will be called from: a finalize
 * trigger deciding whether to seal an object it has just been handed. An object marked with a
 * version this build does not know is still an encrypted object; answering `false` for it would
 * seal ciphertext a second time and lose the plaintext. So the marked-but-unreadable object reports
 * `true` here and throws from `readObjectEnvelope`, which together say "do not touch it, and do not
 * serve it" — the only pair of answers that is safe.
 */
export function isEncryptedObject(custom: ObjectMetadata | undefined): boolean {
  return markerOf(custom) !== null;
}

/**
 * The envelope, or `null` when the object carries no marker.
 *
 * **Marker present but the envelope broken is a throw, never a `null`.** An unknown version, a
 * missing IV or tag, or one that is not the length it must be, means a half-written or foreign
 * object — never a case to serve, and never a case to pass through as plaintext. Every such refusal
 * is `CONTENT_DECRYPT_FAILED` and names the object path in `details` and nothing else; the metadata
 * values themselves are attacker-influenced strings on a path that ends in a log, so they are not
 * interpolated into a message.
 *
 * **Marker absent is `null`, and the PRODUCT decides what a plaintext object means** — during a
 * migration, read it; afterwards, refuse it. That decision changes on a date this package does not
 * know, so it cannot live here. `openObject` makes the other choice, because a caller that has
 * asked to open a sealed object has already decided.
 *
 * `ref` is used only to name the object in a refusal: the envelope is read out of metadata, not out
 * of the ref. It is shape-checked here; `aadForObject` remains the authority on the deeper rules
 * that keep the AAD injective, and it runs on every path that actually seals or opens.
 */
export function readObjectEnvelope(
  ref: ObjectRef,
  custom: ObjectMetadata | undefined,
): ObjectEnvelope | null {
  assertObjectRef(ref, 'readObjectEnvelope');

  const marker = markerOf(custom);
  if (marker === null) return null;
  if (marker !== OBJECT_ENC_VERSION) {
    throw broken(
      ref,
      `the object is marked with an encryption version this reader does not know; it opens ${OBJECT_ENC_VERSION} objects only, and an unknown version is never passed through as plaintext`,
    );
  }

  // Narrowed by `markerOf`: a marker was found, so `custom` is an object.
  const meta = custom as Readonly<Record<string, string | undefined>>;
  const iv = decodeEnvelopePart(ref, 'iv', meta[OBJECT_META.iv], IV_BYTES);
  const tag = decodeEnvelopePart(ref, 'tag', meta[OBJECT_META.tag], TAG_BYTES);

  const hint = meta[OBJECT_META.rec];
  const scopePath = typeof hint === 'string' && hint.length > 0 ? hint : null;

  // The hint is NOT validated against `assertScopePath`. It is unauthenticated metadata written by
  // whoever last saved the object, so a shape check here would only turn somebody else's bad string
  // into our exception at a point where nothing has been trusted yet. It fails closed one step
  // later — a bad hint finds the wrong record key, and the body's tag refuses it.
  return Object.freeze({ enc: OBJECT_ENC_VERSION, iv, tag, scopePath });
}

// ---------------------------------------------------------------------------
// Writing the envelope
// ---------------------------------------------------------------------------

/**
 * The four headers for one sealed body, with their exact value shapes: `v3`, sixteen unpadded
 * base64 characters of IV, twenty-four `==`-padded characters of tag, and the record's full
 * document path.
 *
 * **A wrong-length `iv` or `tag` here is a `VALIDATION_ERROR`, not a `CONTENT_DECRYPT_FAILED`**,
 * and the asymmetry with `readObjectEnvelope` is deliberate: on this side the two buffers came out
 * of a seal that just happened in this process, so a bad length is a programming error; on that
 * side they came out of object metadata, so a bad length is a broken envelope. Same check, two
 * meanings, and the code is what tells a debugger which of the two to go and look at.
 */
export function objectEnvelopeMetadata(iv: Buffer, tag: Buffer, scopePath: string): ObjectMetadata {
  assertWrittenPart('iv', iv, IV_BYTES);
  assertWrittenPart('tag', tag, TAG_BYTES);
  assertScopePath(scopePath);

  return Object.freeze({
    [OBJECT_META.enc]: OBJECT_ENC_VERSION,
    [OBJECT_META.iv]: iv.toString('base64'),
    [OBJECT_META.tag]: tag.toString('base64'),
    [OBJECT_META.rec]: scopePath,
  });
}

/**
 * The consumer's existing custom metadata with an envelope laid over it — collab's
 * `{ ...custom, ...envelope }`, with three things it did not have.
 *
 * 1. **`contentType` is not custom metadata and is not here.** Cloud Storage drops what you do not
 *    resend on a save, so the consumer must carry it on the save call itself. This function cannot
 *    do it for them, and a docblock is the only place to say so.
 * 2. **It deletes nothing.** A storage client removes a key by sending an explicit null, which this
 *    type does not admit — so the collab migration's *"the `x-collab-*` keys are dropped, not left
 *    beside the new ones"* is the migration's own work, not a side effect of merging.
 * 3. **The merged bag may not claim the marker without the rest of the envelope.** The check is on
 *    the RESULT, not on either argument: an object saying "encrypted" with no IV or no tag can
 *    never be opened, and a reader that trusts the marker would serve its ciphertext as content.
 *    It is the §10.6 window written down on purpose rather than raced into. Refused as a
 *    `VALIDATION_ERROR`. Laying a plain label over metadata whose envelope is already complete is
 *    not that case and is allowed, which is the ordinary thing a consumer does.
 *
 * Keys are assigned with `defineProperty`, never `out[key] = value`: metadata keys come from a
 * store and one of them could be `__proto__`, which as an ordinary assignment reshapes the object
 * instead of adding a key to it.
 */
export function mergeObjectMetadata(
  existing: ObjectMetadata | undefined,
  envelope: ObjectMetadata,
): ObjectMetadata {
  const out: Record<string, string> = {};
  if (existing !== undefined && existing !== null) copyMetadataInto(out, existing, 'existing');
  copyMetadataInto(out, envelope, 'envelope');

  if (Object.prototype.hasOwnProperty.call(out, OBJECT_META.enc)) {
    for (const key of [OBJECT_META.iv, OBJECT_META.tag] as const) {
      if (!Object.prototype.hasOwnProperty.call(out, key)) {
        throw new ContentCryptoError(
          'VALIDATION_ERROR',
          `the merged metadata carries ${OBJECT_META.enc} but no ${key}: an object that claims to be encrypted and names no authentication tag can never be opened, and a reader that trusts the marker would serve its ciphertext as content`,
        );
      }
    }
  }
  return Object.freeze(out);
}

// ---------------------------------------------------------------------------
// The buffered pair — the default
// ---------------------------------------------------------------------------

/**
 * Seal an object body and return it with the complete envelope.
 *
 * **Write the body and the whole envelope in one save**, so no reader can ever see the marker
 * without the tag. That is achievable here and it is what the buffered path is for; the streaming
 * path cannot manage it and carries its own two-clause contract instead.
 *
 * There is no size ceiling on this path and there is not meant to be one. The blob ceilings of §8.5
 * exist because a sealed blob has to fit inside a Firestore document; an object has no such
 * neighbour, and the whole reason a spilled blob becomes an object is to leave that budget behind.
 *
 * Four arguments, here and on the streaming twin, which resolves v1's arity contradiction once:
 * `RecordSession.sealObject(ref, plaintext)` is the two-argument form, and it can be, because a
 * session already knows its `scopePath`.
 *
 * @throws VALIDATION_ERROR        a malformed ref, a malformed scopePath, a non-Buffer plaintext,
 *                                 a key that is not a record key (R14)
 * @throws KEY_MATERIAL_DESTROYED  the session that owns this key has been closed
 */
export function sealObject(
  key: RecordKey,
  ref: ObjectRef,
  scopePath: string,
  plaintext: Buffer,
): { readonly body: Buffer; readonly metadata: ObjectMetadata } {
  // R14, and first: a 10 MB body sealed under an account DEK is a 10 MB body with no wrap on the
  // record and no route back. The kind is the cheapest thing here to check and the dearest to
  // get wrong — an object is the one payload nobody re-reads by accident.
  assertKind(key, 'record-key', 'sealObject key');
  const aad = aadForObject(ref);
  // Before the seal, not after: a scopePath this package will not accept should cost nothing.
  assertScopePath(scopePath);

  const { iv, tag, ciphertext } = sealParts(key, aad, plaintext);
  return Object.freeze({ body: ciphertext, metadata: objectEnvelopeMetadata(iv, tag, scopePath) });
}

/**
 * Open an object body, tag verified before a single byte is returned.
 *
 * **An unmarked object is a refusal here**, and it is
 * `CONTENT_PLAINTEXT_AT_REGISTERED_PATH`: the caller asked to open something sealed and the store
 * handed back plaintext, which is the same fact that code names on the content path. A product
 * still mid-migration must not reach this arm at all — it branches on `isEncryptedObject` first and
 * reads the plaintext itself, which is the decision §10.5 leaves to the product because it changes
 * on a date this package does not know.
 *
 * The returned buffer is the WHOLE body. There is no kind byte to strip: an object sealed from
 * `encodeBlob` carries its kind byte as the first byte of its plaintext, and `decodeBlob` reads it.
 *
 * @throws CONTENT_PLAINTEXT_AT_REGISTERED_PATH  the object carries no marker
 * @throws CONTENT_DECRYPT_FAILED  a broken envelope, a wrong key, a body moved to another bucket or
 *                                 path, or a tampered body or tag
 */
export function openObject(
  key: RecordKey,
  ref: ObjectRef,
  body: Buffer,
  custom: ObjectMetadata | undefined,
): Buffer {
  const envelope = readObjectEnvelope(ref, custom);
  if (envelope === null) throw plaintextObject(ref, 'openObject');
  return openParts(key, aadForObject(ref), envelope.iv, envelope.tag, body);
}

// ---------------------------------------------------------------------------
// The streaming pair — an explicit opt-in, with a named reason
// ---------------------------------------------------------------------------

/**
 * A `Transform` that seals what is written through it, and the envelope that describes what came
 * out — which does not exist until the last chunk has flushed.
 *
 * ── THE WRITE-ORDERING CONTRACT, WHICH IS ON THE CONSUMER ──
 *
 * The buffered path writes body and envelope in one save. This path cannot: the tag is not known
 * until the stream ends, so the body lands first and the metadata follows. The naive ordering
 * leaves a window in which the object exists with no marker — and a reader that treats an absent
 * marker as "plaintext" will happily serve ciphertext as content. It is collab's deploy-order
 * failure arriving through a different door. So, one of these two, and the consumer picks:
 *
 *   1. **Stream to a staging path the readers do not serve**, then copy or rewrite to the final
 *      path only once `metadata` has resolved and been applied; or
 *   2. **set `x-xbg-enc` only in the final `setMetadata` call**, together with `x-xbg-iv` and
 *      `x-xbg-tag`, so the marker and the envelope become visible in the same operation.
 *
 * ── THE PROMISE ──
 *
 * `metadata` resolves in the stream's `flush`, is PRE-CAUGHT so that a caller who never awaits it
 * cannot turn a destroyed stream into an unhandled rejection that takes the process down, and
 * rejects — rather than hanging for ever — if the stream is destroyed early. All three were found
 * the hard way in collab and are ported deliberately.
 *
 * **It rejects with `CONTENT_ENCRYPT_FAILED`, never `VALIDATION_ERROR`** (owner ruling R5). Nothing
 * invalid was supplied: the ref, the scopePath and the key were all checked below, before the
 * stream existed, and what fails afterwards is a cipher inside a live stream or a consumer
 * destroying it. A caller told `VALIDATION_ERROR` goes and inspects their own arguments, which is
 * the wrong place, and that misdirection compounds for every later reader of the log. An error
 * arriving from elsewhere — a downstream `destroy(err)`, say — is REPLACED rather than wrapped or
 * carried as a `cause`: it is an unbounded string from somebody else's library on a path that ends
 * in a log, and it says nothing this code does not.
 */
export function createObjectEncryptStream(
  key: RecordKey,
  ref: ObjectRef,
  scopePath: string,
): { readonly stream: Transform; readonly metadata: Promise<ObjectMetadata> } {
  // R14, beside the ref and the scopePath, and for the reason the paragraph above gives: these
  // three are checked BEFORE the stream exists, so a refusal is a throw at the call site rather
  // than a rejection arriving after a consumer has begun uploading.
  assertKind(key, 'record-key', 'createObjectEncryptStream key');
  const aad = aadForObject(ref);
  assertScopePath(scopePath);

  const { stream, iv, tag } = createSealStream(key, aad);
  const metadata = tag.then(
    (resolved) => objectEnvelopeMetadata(iv, resolved, scopePath),
    (err: unknown) => {
      throw sealStreamFailure(err);
    },
  );
  // `createSealStream` pre-catches its own promise; this is a NEW promise derived from it, and an
  // un-awaited derived rejection is just as fatal as an un-awaited original one.
  metadata.catch(() => undefined);

  return Object.freeze({ stream, metadata });
}

/**
 * A `Transform` that opens what is written through it, given the envelope already on the object.
 *
 * **It emits plaintext before the tag is verified**, because a GCM decrypt stream has no choice —
 * the tag is checked in `flush`, so a body that does not authenticate surfaces as an `error` at the
 * END, after chunks have already left. `unverifiedChunks: 'accepted'` is required so that fact is
 * acknowledged where somebody can see it. A consumer that must not expose unverified bytes buffers
 * to `end`, or uses `openObject`, which is the default for good reason.
 *
 * @throws VALIDATION_ERROR  the acknowledgement is missing or is not `'accepted'`
 * @throws CONTENT_PLAINTEXT_AT_REGISTERED_PATH  the object carries no marker
 * @throws CONTENT_DECRYPT_FAILED  a broken envelope — raised here, before a byte is read
 */
export function createObjectDecryptStream(
  key: RecordKey,
  ref: ObjectRef,
  custom: ObjectMetadata | undefined,
  opts: { readonly unverifiedChunks: UnverifiedStreamAck },
): Transform {
  if (opts === null || typeof opts !== 'object' || opts.unverifiedChunks !== 'accepted') {
    throw new ContentCryptoError(
      'VALIDATION_ERROR',
      "createObjectDecryptStream emits plaintext before its authentication tag is verified, so it requires { unverifiedChunks: 'accepted' } at the call site; a reader that must not expose unverified bytes buffers to end, or uses openObject",
    );
  }
  const envelope = readObjectEnvelope(ref, custom);
  if (envelope === null) throw plaintextObject(ref, 'createObjectDecryptStream');
  return createOpenStream(key, aadForObject(ref), envelope.iv, envelope.tag);
}

// ---------------------------------------------------------------------------
// Module-private
// ---------------------------------------------------------------------------

/**
 * Every part of an envelope is base64 with at most the two `=` of a canonical encoding, and `=`
 * only at the end. `Buffer.from(x, 'base64')` is famously tolerant — it silently skips characters
 * it does not recognise and returns an empty buffer for a string that is not base64 at all — which
 * is precisely how a marked-but-broken object would come to be served.
 */
const B64 = /^[A-Za-z0-9+/]*={0,2}$/;

/** The marker, or `null` when there is none. An `undefined` or empty value is an absent key. */
function markerOf(custom: ObjectMetadata | undefined): string | null {
  if (custom === null || typeof custom !== 'object') return null;
  const raw = (custom as Record<string, unknown>)[OBJECT_META.enc];
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
}

/**
 * One envelope part, decoded strictly: the exact canonical character count, the base64 alphabet,
 * and then the exact byte count as well.
 *
 * The character count is checked as well as the byte count because they are not the same claim. A
 * padded sixteen-byte IV and an unpadded one decode to the same bytes and are two spellings of one
 * envelope, and two spellings is how a value comes to be compared as a string somewhere and stop
 * matching. There is exactly one way to write this, and it is the one `objectEnvelopeMetadata`
 * emits.
 */
function decodeEnvelopePart(
  ref: ObjectRef,
  name: 'iv' | 'tag',
  raw: string | undefined,
  bytes: number,
): Buffer {
  const characters = 4 * Math.ceil(bytes / 3);
  if (typeof raw !== 'string' || raw.length === 0) {
    throw broken(
      ref,
      `the object is marked ${OBJECT_ENC_VERSION} but carries no ${name}, so its body cannot be authenticated`,
    );
  }
  if (raw.length !== characters || !B64.test(raw)) {
    throw broken(
      ref,
      `the object's ${name} is not ${characters} characters of canonical base64, which is the only shape a ${bytes}-byte ${name} is written in`,
    );
  }
  const part = Buffer.from(raw, 'base64');
  if (part.length !== bytes) {
    throw broken(ref, `the object's ${name} decodes to ${part.length} bytes and must be ${bytes}`);
  }
  return part;
}

/**
 * The shape check `readObjectEnvelope` needs so a refusal can name its object.
 *
 * Deliberately shallower than `aadForObject`, which owns the rules that keep the AAD injective — a
 * bucket containing `/` among them. Every path that seals or opens goes through that function, so
 * the deep check is never skipped; this one exists because reading metadata does not build an AAD
 * and should not be made to.
 */
function assertObjectRef(ref: ObjectRef, where: string): void {
  if (ref === null || typeof ref !== 'object') {
    throw new ContentCryptoError(
      'VALIDATION_ERROR',
      `${where} needs an object ref of { bucket, path }, received ${typeName(ref)}`,
    );
  }
  for (const key of ['bucket', 'path'] as const) {
    const value = ref[key];
    if (typeof value !== 'string' || value.length === 0) {
      throw new ContentCryptoError(
        'VALIDATION_ERROR',
        `${where}: an object ref's ${key} must be a non-empty string, received ${typeName(value)}`,
      );
    }
  }
}

/** A part being WRITTEN, whose length is this process's own mistake if it is wrong. */
function assertWrittenPart(name: 'iv' | 'tag', part: Buffer, bytes: number): void {
  if (!Buffer.isBuffer(part) || part.length !== bytes) {
    throw new ContentCryptoError(
      'VALIDATION_ERROR',
      `an object envelope's ${name} is exactly ${bytes} bytes, and this one is ${Buffer.isBuffer(part) ? `${part.length} bytes` : typeName(part)}`,
    );
  }
}

/** Copy one metadata bag into the accumulator, refusing anything a store cannot hold. */
function copyMetadataInto(
  out: Record<string, string>,
  bag: ObjectMetadata,
  which: 'existing' | 'envelope',
): void {
  if (typeof bag !== 'object' || bag === null || Array.isArray(bag)) {
    throw new ContentCryptoError(
      'VALIDATION_ERROR',
      `mergeObjectMetadata needs the ${which} metadata as an object of strings, received ${typeName(bag)}`,
    );
  }
  for (const key of Object.keys(bag)) {
    const value = (bag as Record<string, unknown>)[key];
    if (value === undefined) continue;
    if (typeof value !== 'string') {
      throw new ContentCryptoError(
        'VALIDATION_ERROR',
        `custom metadata holds strings, and the ${which} bag's "${key}" is ${typeName(value)}`,
      );
    }
    // Never `out[key] = value`: a bag carrying `__proto__` would reshape the accumulator rather
    // than gain a key. `defineProperty` creates a data property whatever the key is.
    Object.defineProperty(out, key, { value, enumerable: true, writable: true, configurable: true });
  }
}

/** A marked-but-broken envelope. The object path travels in `details`; no metadata value does. */
function broken(ref: ObjectRef, message: string): ContentCryptoError {
  return new ContentCryptoError('CONTENT_DECRYPT_FAILED', message, { path: ref.path });
}

/** An object with no marker, on a path that has asked for one. */
function plaintextObject(ref: ObjectRef, where: string): ContentCryptoError {
  return new ContentCryptoError(
    'CONTENT_PLAINTEXT_AT_REGISTERED_PATH',
    `${where}: the object carries no ${OBJECT_META.enc} marker, so it is not encrypted and there is nothing to open. A product still reading plaintext objects during a migration branches on isEncryptedObject before it reaches here`,
    { path: ref.path },
  );
}

/**
 * The one classification the streaming seal makes, and it is `CONTENT_ENCRYPT_FAILED` (R5).
 *
 * One of ours passes through unchanged — `cipher.ts` already codes both of its stream-seal failures
 * this way and its messages are better than a generic one. Anything else is REPLACED: the seal
 * failed, the caller supplied nothing invalid, and the upstream message is discarded rather than
 * carried as a `cause`.
 */
function sealStreamFailure(err: unknown): ContentCryptoError {
  if (isContentCryptoError(err)) return err;
  return new ContentCryptoError(
    'CONTENT_ENCRYPT_FAILED',
    'the object stream did not finish sealing, so there is no authentication tag: the body is incomplete and its envelope must not be written',
  );
}

/** The constructor name of an arbitrary value, without invoking anything on it. */
function typeName(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return 'an array';
  return typeof value === 'object' ? 'an object' : `a ${typeof value}`;
}
