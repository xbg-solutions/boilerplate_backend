/**
 * The v3 string codec, every wire prefix, and the strict decoder. Spec §7.2 and §7.4.
 *
 * This module owns the WIRE. Four prefixes are declared here and nowhere else — the two that are
 * written (`enc:v3:` for content under a record key, `wrap:v1:` for a record-key wrap under an
 * account DEK) and the two that are only ever read (`enc:v1:`, `enc:v2:`, re-exported by
 * `legacy-readers.ts`, which reads them but does not own them). `check-mirror.js` assertion (6)
 * asserts that ownership, because a wire prefix spelled in two files is a wire that can change in
 * one of them.
 *
 * The one wire fact this module does NOT declare is the pair of byte counts: `IV_BYTES` and
 * `TAG_BYTES` are AES-GCM parameters and live in `cipher.ts` (R6/R9), re-exported below so that §4
 * still publishes them from here. That is also what keeps the two modules acyclic — see the
 * "Where the AES-GCM parameters live" section of `cipher.ts`.
 *
 * ```
 * enc:v3:<iv-b64>:<ct-b64>:<tag-b64>     content — a field value OR a blob, under the RECORD key
 * wrap:v1:<iv-b64>:<ct-b64>:<tag-b64>    a record-key wrap, under an ACCOUNT DEK
 * enc:v2:<gen>:<iv>:<ct>:<tag>           legacy, account DEK at <gen>        (read only)
 * enc:v1:<iv>:<ct>:<tag>                 legacy, account DEK at generation 1 (read only)
 * ```
 *
 * **The first plaintext byte is an authenticated payload-kind discriminator**, inside the GCM tag.
 * Under one record key a field ciphertext and a blob ciphertext at the same path would share an
 * AAD — which cannot happen, because the registry refuses to register one path as both. If it ever
 * did, the kind byte is what turns "a silently wrong-typed value" into `CONTENT_KIND_MISMATCH`. Do
 * not remove it, do not make it optional, and do not add a fifth kind without a format note.
 *
 * **Leniency does not live here.** collab's `decryptValue` passes an unprefixed value through
 * unchanged; that one lenient rule moves up a layer wholesale (§7.4), because a codec that
 * sometimes returns its input cannot be reasoned about — the caller does not know whether it
 * decrypted. `decryptField` never returns its input. Read strictness is a per-collection document
 * decision resolved as `registry entry reads ?? scope reads ?? strict`, and `strict` is the
 * default everywhere but collab, for the duration of Phase C only.
 */

import { ContentCryptoError } from './errors';
import { IV_BYTES, TAG_BYTES, openBuffer, sealBuffer } from './cipher';
import { assertKind } from './secret';
import type { RecordKey } from './secret';

// ---------------------------------------------------------------------------
// The wire
// ---------------------------------------------------------------------------

/** Content under a RECORD key: a field value or a blob. The only content prefix written. */
export const ENC_PREFIX_V3 = 'enc:v3:';

/** A record-key wrap, under an ACCOUNT DEK, kind 0x04. Declared here because every wire prefix
 *  lives in one file; `record-key.ts` imports it. */
export const WRAP_PREFIX = 'wrap:v1:';

/**
 * The two legacy prefixes. **Read only — no writer ships from any entrypoint** (§7.5).
 *
 * They are declared here rather than in `legacy-readers.ts` for the reason above and for one more:
 * `decodeValue` below has to recognise them to return its v1 and v2 arms at all, so a declaration
 * that lived only in the quarantined module would put the literals back in this file anyway. A v1
 * *reader* is not a v1 *prefix*; Phase G deletes the reader, and deletes these two constants and
 * the two arms with it.
 */
export const ENC_PREFIX_V1 = 'enc:v1:';
export const ENC_PREFIX_V2 = 'enc:v2:';

/**
 * The IV and tag lengths, **declared in `cipher.ts`** and republished here.
 *
 * They are cipher parameters — 12 bytes of IV and a 16-byte tag are facts about AES-GCM (R6/R9) —
 * but they are also on the wire, which is why `decodeParts` below checks them and why §4 publishes
 * them from this module rather than from the internal one. Declaring them here as well would be a
 * second `12` and a second `16` to disagree about, which is the failure the single-declaration rule
 * exists to prevent; re-exporting keeps one declaration and one published home.
 */
export { IV_BYTES, TAG_BYTES };

/**
 * The authenticated payload-kind byte, at plaintext index 0 of every packed value.
 *
 * `0x03` is the same JSON as `0x02` after `deflateRaw`, and compression is off by default (§8.7),
 * so a store holding no `0x03` byte is the expected state rather than evidence of anything.
 */
export const PAYLOAD_KIND = {
  string: 0x01,      // utf-8 field value
  blobJson: 0x02,    // typed JSON (§8.3)
  blobDeflate: 0x03, // deflateRaw of the same JSON — off by default (§8.7)
  recordKey: 0x04,   // 32 raw record-key bytes (a keyWraps entry)
} as const;
export type PayloadKind = (typeof PAYLOAD_KIND)[keyof typeof PAYLOAD_KIND];

/**
 * The kinds a blob reader accepts. Package-internal and **not on the barrel**: it is the `expect`
 * argument of exactly one call, `decryptBlob`'s, and a consumer branching on it would be a
 * consumer deciding which compression a value used, which is not their decision to make.
 */
export const BLOB_KINDS: readonly PayloadKind[] = [PAYLOAD_KIND.blobJson, PAYLOAD_KIND.blobDeflate];

/** `enc:v3:<iv>:<ct>:<tag>` whose plaintext is [0x01][utf-8 string]. */
export type EncryptedField = string & { readonly __sealed: 'field' };

// ---------------------------------------------------------------------------
// Strict decode
// ---------------------------------------------------------------------------

/**
 * A well-formed sealed value, decomposed. **Keyless**: it can say which key LAYER a value belongs
 * to and, for v2, which generation, but never whether the bytes verify.
 *
 * `generation` is a discriminated-union member and never a nullable number: `1` for v1 (the
 * absence of a generation IS generation 1, never "the current generation", which after a rotation
 * is silently the wrong key), the label for v2, and `null` for v3 where null means *ask the
 * record's wrap*. The union is also what makes the compiler enumerate every call site at Phase G.
 */
export type DecodedValue =
  | {
      readonly version: 'v3';
      readonly keySource: 'record-key';
      readonly generation: null;
      readonly iv: Buffer;
      readonly ciphertext: Buffer;
      readonly tag: Buffer;
    }
  | {
      readonly version: 'v2';
      readonly keySource: 'account-dek';
      readonly generation: number;
      readonly iv: Buffer;
      readonly ciphertext: Buffer;
      readonly tag: Buffer;
    }
  | {
      readonly version: 'v1';
      readonly keySource: 'account-dek';
      readonly generation: 1;
      readonly iv: Buffer;
      readonly ciphertext: Buffer;
      readonly tag: Buffer;
    };

/** Every part is base64 with at most the two `=` of a canonical encoding. collab's, unchanged. */
const B64 = /^[A-Za-z0-9+/]*={0,2}$/;

/** A generation is a plain positive decimal — no sign, no padding, bounded so a hostile string
 *  cannot be huge. collab's (`content-cipher.ts:82`), unchanged. */
const GENERATION = /^[1-9][0-9]{0,8}$/;

/**
 * Decode a value, or `null` when it is not a well-formed ciphertext. **NEVER throws** — it is
 * called on arbitrary store content, including values a user typed.
 *
 * The order is enforced and never relaxed:
 *
 *   1. `typeof value === 'string'`.
 *   2. **Prefix first, then part count.** v1 and v3 are byte-identical in shape and differ only by
 *      prefix. *"Three parts means v1"* is the bug someone writes; the named test for it is
 *      `decodes an enc:v3: value with three parts as v3, never as v1`.
 *   3. v2 only: the generation grammar above.
 *   4. base64 on every part.
 *   5. `iv.length === 12 && tag.length === 16`.
 *   6. **v3 requires `ciphertext.length >= 1`.** GCM ciphertext is the same length as its
 *      plaintext and a v3 plaintext is at minimum the kind byte, so a zero-length v3 ciphertext is
 *      malformed by construction. v1's "an empty ciphertext part is legal" is true of v1 and v2
 *      only — under v3 the empty string seals to a one-byte ciphertext. Getting this wrong means a
 *      hand-forged `enc:v3:<iv>::<tag>` reaches `createDecipheriv` instead of being rejected as
 *      malformed, and the resulting failure reads as corruption rather than as a bad value.
 *
 * A value that merely *starts* `enc:v3:` — a user can type that as a title — fails the shape check
 * and is not a ciphertext.
 */
export function decodeValue(value: unknown): DecodedValue | null {
  if (typeof value !== 'string') return null;

  // Prefix first. Each arm fixes the part count it expects, so a v1 value can never be read as v3
  // or the reverse, whatever the store holds.
  if (value.startsWith(ENC_PREFIX_V3)) {
    const parts = splitParts(value, ENC_PREFIX_V3, 3);
    if (!parts) return null;
    if (parts.ciphertext.length < 1) return null;
    return { version: 'v3', keySource: 'record-key', generation: null, ...parts };
  }
  if (value.startsWith(ENC_PREFIX_V2)) {
    const raw = value.slice(ENC_PREFIX_V2.length).split(':');
    if (raw.length !== 4 || !GENERATION.test(raw[0])) return null;
    const parts = decodeParts(raw.slice(1));
    if (!parts) return null;
    return { version: 'v2', keySource: 'account-dek', generation: Number(raw[0]), ...parts };
  }
  if (value.startsWith(ENC_PREFIX_V1)) {
    const parts = splitParts(value, ENC_PREFIX_V1, 3);
    if (!parts) return null;
    return { version: 'v1', keySource: 'account-dek', generation: 1, ...parts };
  }
  return null;
}

/** True for a well-formed sealed value of ANY version. "Does this look encrypted at all". */
export function isEncrypted(value: unknown): value is string {
  return decodeValue(value) !== null;
}

/** The wire version of a value, or `null` when it is not a well-formed ciphertext. */
export function versionOf(value: unknown): 'v1' | 'v2' | 'v3' | null {
  return decodeValue(value)?.version ?? null;
}

/**
 * True for a well-formed v3 value. It is a CANDIDATE, not a proof: whether the plaintext is a blob
 * or a string is knowable only with the key, because `decodeValue` is keyless and cannot see the
 * kind byte. Used to decide "already sealed?" at a registered blob path, where the registry
 * already says which kind it must be.
 */
export function isSealedBlobCandidate(value: unknown): value is string {
  return decodeValue(value)?.version === 'v3';
}

// ---------------------------------------------------------------------------
// The v3 string codec
// ---------------------------------------------------------------------------

/**
 * Seal one string field value. Always v3, always kind `0x01`.
 *
 * **No generation parameter**: a record key does not rotate, and a rotation rewraps rather than
 * re-keys (§13.2). That absence is the whole shape of the change from collab's `encryptValue`,
 * which had to carry one.
 *
 * A non-string plaintext is a `VALIDATION_ERROR` rather than a coercion — collab's `encryptValue`
 * did the same (`content-cipher.ts:180`) and it is what catches the "we passed the whole object"
 * bug at the boundary instead of storing `"[object Object]"` under a key nobody can recover it
 * from.
 *
 * `RecordKey`, not `Secret<string>`: an `AccountDek` cannot reach a content codec. The single
 * exception in the whole package is `legacy-readers.ts`, and that exception is the reason the file
 * exists as a quarantine rather than as a mode.
 *
 * **And the type is no longer the only thing saying so (R14).** `assertKind` repeats it at
 * runtime, first, before the plaintext is even looked at. A DEK arriving here is not a caller
 * asking for something odd: it seals content under a key that appears in no `keyWraps` map
 * anywhere — `unwrapRecordKey` produces record keys and nothing else — so the value is
 * well-formed, opens under that DEK alone, and is unreachable through every route this package
 * offers. The compile-time narrowing catches that in TypeScript; a plain-JavaScript job script, a
 * fixture, or one `as unknown as RecordKey` walks straight past it.
 */
export function encryptField(key: RecordKey, aad: string, plaintext: string): EncryptedField {
  assertKind(key, 'record-key', 'encryptField key');
  if (typeof plaintext !== 'string') {
    throw new ContentCryptoError(
      'VALIDATION_ERROR',
      `encryptField seals a string, and this value is a ${typeName(plaintext)}; a registered string path that holds something else is left untouched by the walker rather than coerced here`,
      { constructorName: typeName(plaintext) },
    );
  }
  return sealBuffer(
    key,
    aad,
    PAYLOAD_KIND.string,
    Buffer.from(plaintext, 'utf8'),
    ENC_PREFIX_V3,
  ) as EncryptedField;
}

/**
 * Open one v3 string field value. **Never returns its input.**
 *
 *   - a v1/v2 value              -> `WRONG_KEY_LAYER`, never a tag failure that reads as corruption
 *   - not a well-formed v3 value -> `WRONG_KEY_LAYER`, naming the shape and never the bytes
 *   - a bad tag                  -> `CONTENT_DECRYPT_FAILED`, always, in every read mode
 *   - kind byte != 0x01          -> `CONTENT_KIND_MISMATCH`
 *
 * The first two arms are the ones worth the words: handing a v1 value to this reader would
 * otherwise reach `createDecipheriv` under a record key and fail its tag, and a tag failure reads
 * as "your data is corrupt" when the truth is "you asked the wrong key layer". Only `migrateDoc`
 * reads legacy, and it reads it through `legacy-readers.ts`.
 */
export function decryptField(key: RecordKey, aad: string, value: string): string {
  const decoded = decodeValue(value);
  if (decoded === null) {
    throw new ContentCryptoError(
      'WRONG_KEY_LAYER',
      'this is not a well-formed sealed value: a v3 value is a prefix, a 12-byte IV, at least one ciphertext byte and a 16-byte tag, all base64 and colon-separated',
    );
  }
  if (decoded.version !== 'v3') {
    throw new ContentCryptoError(
      'WRONG_KEY_LAYER',
      `this is a ${decoded.version} value, sealed under an account DEK, and the v3 reader holds a record key; only the migration reads the legacy layer`,
    );
  }
  const { body } = openBuffer(key, aad, value, [PAYLOAD_KIND.string], ENC_PREFIX_V3);
  return body.toString('utf8');
}

// ---------------------------------------------------------------------------
// Module-private
// ---------------------------------------------------------------------------

/** The three-part arms: slice off the prefix, demand exactly `count` parts, decode them. */
function splitParts(
  value: string,
  prefix: string,
  count: number,
): { iv: Buffer; ciphertext: Buffer; tag: Buffer } | null {
  const raw = value.slice(prefix.length).split(':');
  if (raw.length !== count) return null;
  return decodeParts(raw);
}

/** base64, then the two fixed lengths. Shared by all three arms so they cannot drift. */
function decodeParts(raw: readonly string[]): { iv: Buffer; ciphertext: Buffer; tag: Buffer } | null {
  if (!raw.every((part) => B64.test(part))) return null;
  const [iv, ciphertext, tag] = raw.map((part) => Buffer.from(part, 'base64'));
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) return null;
  return { iv, ciphertext, tag };
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
