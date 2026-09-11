/**
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * DELETE THIS FILE AT PHASE G. Deletion condition, in full, so nobody has to go and find it:
 *   1. collab's Phase-C walk completes, AND a census query — not the walk's own counters —
 *      reports zero v1 values, zero v2 values and zero objects whose encryption marker is v1 or
 *      v2.
 *   2. collab drops `legacy` from its KeyScope and flips `reads` to strict. Any survivor now
 *      fails loudly in staging rather than being read quietly for ever.
 *   3. One release later, delete together: this file, its test, the fenced legacy section of
 *      index.ts, LegacyScope and KeyScope.legacy, the two legacy prefixes and the v1/v2 arms of
 *      DecodedValue in field-codec.ts, the account-dek arms of DecodedValue and ObjectEnvelope,
 *      and ContentCrypto.migrateDoc. The union arms are typed, so the compiler enumerates every
 *      call site that must change.
 *   4. That is a MAJOR version of this package: a legacy value stops being readable. Scheduled,
 *      coordinated, multi-repo. Every product but collab ships with no `legacy` block from day
 *      one and therefore reacts to nothing.
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * The **only** file in the package where an `AccountDek` touches content. Everywhere else an
 * account DEK exists solely to wrap and unwrap record keys. That single-file quarantine is the
 * design: the legacy model is not a mode of the current one, it is a different model that is on
 * its way out, and the difference is what makes the deletion a `git rm` rather than a refactor.
 *
 * The quarantine is asserted rather than asserted-about, in each of these places:
 *
 *   - `check-mirror.js` assertion (6): only `content-crypto.ts`, `object-envelope.ts` and
 *     `index.ts` may import this module, and the legacy wire literals live in `field-codec.ts`
 *     with every other wire prefix — which is why this file re-exports them and declares none.
 *   - the import-graph test in `__tests__/legacy-readers.test.ts`: this module imports downward
 *     only, and nothing in the list it imports from imports it back.
 *   - `index.test.ts`: no v1/v2 WRITER ships from any entrypoint. collab's `encryptValueV1`
 *     (`content-cipher.ts:191`) is explicitly a fixture writer; if it existed on this package's
 *     surface somebody would write v1 in 2027. Tests build legacy fixtures with a local helper
 *     inside `__tests__/` which cannot escape.
 *
 * Objects are the one place the AAD genuinely changes across the v1->v3 hop (§10.7): the legacy
 * form is the BARE object path, the current form is `obj/{bucket}/{path}`. Field values do not
 * change AAD at all, which is the dividend §6.4 exists to name — the migration moves the key
 * layer and nothing else.
 */

import { openParts } from './cipher';
import { ContentCryptoError } from './errors';
import { ENC_PREFIX_V1, ENC_PREFIX_V2, decodeValue } from './field-codec';
import { mapPath } from './field-path';
import type { FieldRegistry } from './registry';
import type { AccountDek } from './secret';

/**
 * The two legacy wire prefixes, re-exported from where every wire prefix is declared. A v1
 * *reader* is not a v1 *prefix*: the reader is deleted at Phase G, and the prefixes are deleted
 * from `field-codec.ts` in the same commit.
 */
export { ENC_PREFIX_V1, ENC_PREFIX_V2 };

/** The absence of a generation IS generation 1. Never "the current generation" — after a
 *  rotation that is silently the wrong key, which is the failure carrying the generation in the
 *  ciphertext was introduced to prevent. */
export const LEGACY_GENERATION = 1;

/** A generation is a plain positive decimal — the same grammar the v2 wire uses, so a value that
 *  round-trips through that wire cannot name a generation `assertGeneration` would refuse. */
const GENERATION = /^[1-9][0-9]{0,8}$/;

/** True for a well-formed v1 or v2 value, and false for a v3 one. */
export function isLegacyValue(value: unknown): value is string {
  return legacyVersionOf(value) !== null;
}

/** `'v1'`, `'v2'`, or `null` for a v3 value and for anything that is not a ciphertext at all. */
export function legacyVersionOf(value: unknown): 'v1' | 'v2' | null {
  const decoded = decodeValue(value);
  if (decoded === null || decoded.version === 'v3') return null;
  return decoded.version;
}

/**
 * The generation a legacy value is sealed under, or `null` when it is not a legacy value. This is
 * what lets a reader ask the custodian for the RIGHT key rather than for the current one.
 */
export function legacyGenerationOf(value: unknown): number | null {
  const decoded = decodeValue(value);
  if (decoded === null || decoded.version === 'v3') return null;
  return decoded.generation;
}

/**
 * Open one v1/v2 field value under an account DEK. **The one place a DEK touches content.**
 *
 * `dek` must be the key for `legacyGenerationOf(value)`; passing another generation fails the tag,
 * which is the whole point of carrying the generation on the wire. A v3 value is `WRONG_KEY_LAYER`
 * rather than a tag failure, for the same reason `decryptField` refuses a v1 one: "you asked the
 * wrong key layer" and "your data is corrupt" must not arrive as the same error.
 *
 * The AAD is the SAME string the v3 reader would use for that field — `aadForContent(root, docId,
 * fieldPath)` — because the plan's content AAD *is* the bare form collab already writes. There is
 * no legacy content AAD to switch to, which is why `LegacyScope` has no `aad` option and why
 * `legacyFieldAad` does not exist.
 */
export function decryptLegacyField(dek: AccountDek, aad: string, value: string): string {
  const decoded = decodeValue(value);
  if (decoded === null) {
    throw new ContentCryptoError(
      'WRONG_KEY_LAYER',
      'this is not a well-formed sealed value, so there is no legacy value here to read',
    );
  }
  if (decoded.version === 'v3') {
    throw new ContentCryptoError(
      'WRONG_KEY_LAYER',
      'this is a v3 value, sealed under a record key, and the legacy reader holds an account DEK; read it with decryptField instead',
    );
  }
  // No kind byte: a legacy plaintext is the utf-8 string and nothing else, which is exactly why
  // this path uses `openParts` and never `openBuffer`.
  return openParts(dek, aad, decoded.iv, decoded.tag, decoded.ciphertext).toString('utf8');
}

/**
 * Every generation named by a v1/v2 value at any registered path of `collection`, in one walk.
 *
 * It drives the migration's key prefetch: **keys before the transform, always** — collab's
 * `loadAllDeks` rule — so that no document is left half-converted at each generation. A document
 * written across a rotation legitimately holds two, which is why this returns a set rather than
 * the first generation it finds.
 *
 * Registered BLOB paths are walked too. A blob path holding a legacy string is collab's
 * hand-serialised-map case (§7.5); it is refused later, by `migrateDoc`, and refusing it here
 * would mean the prefetch could not name the key that refusal has to mention.
 */
export function legacyGenerationsIn<C extends string>(
  registry: FieldRegistry<C>,
  collection: C,
  data: unknown,
): ReadonlySet<number> {
  const generations = new Set<number>();
  for (const path of registry.pathsFor(collection)) {
    // `mapPath` visits every string leaf under the path — including each element of an `[]`
    // segment — and returns the input by identity when the callback changes nothing, which this
    // one never does. Reusing the walker rather than writing a second one is what keeps "which
    // values are registered" a single answer.
    mapPath(data, path.segments, (value) => {
      const generation = legacyGenerationOf(value);
      if (generation !== null) generations.add(generation);
      return value;
    });
  }
  return generations;
}

/**
 * The pre-custody OBJECT AAD: the bare object path, e.g.
 * `projects/p1/topics/t1/attachments/m_4/9f2-brief.pdf` (collab `lib/storage.ts:299`).
 *
 * It binds no bucket, which is exactly the weakness the current form fixes (§10.3) and is why the
 * object migration is a re-seal rather than a re-label.
 */
export function legacyObjectAad(objectPath: string): string {
  if (typeof objectPath !== 'string' || objectPath.length === 0) {
    throw new ContentCryptoError(
      'VALIDATION_ERROR',
      'a legacy object AAD is the object path, which must be a non-empty string',
    );
  }
  return objectPath;
}

/** The legacy object envelope, read from custom metadata under a product-supplied prefix. */
export interface LegacyObjectEnvelope {
  /** The metadata prefix this envelope was read under, from `KeyScope.legacy.objectMetaPrefix`. */
  readonly prefix: string;
  readonly enc: 'v1' | 'v2';
  /** v1 may omit its keygen key, and that absence IS generation 1; v2 MUST carry one. */
  readonly generation: number;
  readonly iv: Buffer;
  readonly tag: Buffer;
}

/** The four metadata keys, as suffixes of the product's prefix. collab's `OBJECT_META`
 *  (`lib/storage.ts:63`) with the prefix factored out, because the package may not name a
 *  product's metadata namespace. */
const META_SUFFIX = { enc: 'enc', keygen: 'keygen', iv: 'iv', tag: 'tag' } as const;

/** The only two envelope versions this reader accepts. v3 objects are `object-envelope.ts`'s. */
const READABLE_ENC_VERSIONS: readonly string[] = ['v1', 'v2'];

/**
 * collab's `envelopeOf` (`lib/storage.ts:224`) with its three refusals intact, each one a
 * decision: an unknown version throws; a v2 object naming no generation throws; a missing or
 * unparseable IV or tag throws. **It never returns bytes for a marked-but-broken object** — that
 * is a half-written or foreign object, never a case to serve.
 *
 * Marker absent -> `null`, and the PRODUCT decides what a plaintext object means: during a
 * migration, read it; afterwards, refuse it. That decision cannot live here, because it changes
 * on a date this package does not know.
 */
export function readLegacyObjectEnvelope(
  prefix: string,
  custom: Readonly<Record<string, string | undefined>>,
): LegacyObjectEnvelope | null {
  if (typeof prefix !== 'string' || prefix.length === 0) {
    throw new ContentCryptoError(
      'VALIDATION_ERROR',
      'reading a legacy object envelope needs the metadata prefix the product wrote it under; a product with no legacy block has no legacy objects to read',
    );
  }
  const meta: Readonly<Record<string, string | undefined>> =
    custom && typeof custom === 'object' ? custom : {};

  const version = meta[prefix + META_SUFFIX.enc];
  // The marker is the whole test for "is this object encrypted at all", which is what a finalize
  // trigger checks to skip its own rewrite.
  if (typeof version !== 'string' || version.length === 0) return null;
  if (!READABLE_ENC_VERSIONS.includes(version)) {
    throw new ContentCryptoError(
      'CONTENT_DECRYPT_FAILED',
      `the object is marked with an encryption version this reader does not know; the legacy reader accepts ${READABLE_ENC_VERSIONS.join(' and ')}`,
    );
  }

  const rawGeneration = meta[prefix + META_SUFFIX.keygen];
  let generation = LEGACY_GENERATION;
  if (typeof rawGeneration === 'string' && rawGeneration.length > 0) {
    generation = Number(rawGeneration);
    if (!Number.isInteger(generation) || generation < 1) {
      throw new ContentCryptoError(
        'CONTENT_DECRYPT_FAILED',
        'the object names an invalid key generation',
      );
    }
  } else if (version !== 'v1') {
    throw new ContentCryptoError(
      'CONTENT_DECRYPT_FAILED',
      `the object is marked ${version} but names no key generation, and only a v1 object may omit one`,
    );
  }

  const iv = decodeMetaBytes(meta[prefix + META_SUFFIX.iv]);
  const tag = decodeMetaBytes(meta[prefix + META_SUFFIX.tag]);
  if (iv.length === 0 || tag.length === 0) {
    throw new ContentCryptoError(
      'CONTENT_DECRYPT_FAILED',
      'the object is marked encrypted but its IV or tag is missing',
    );
  }

  return { prefix, enc: version as 'v1' | 'v2', generation, iv, tag };
}

/**
 * Open a legacy object body under the account DEK its envelope names. The AAD is
 * `legacyObjectAad(objectPath)` — the bare path — and the migration re-seals under
 * `aadForObject(ref)`, which is the one AAD change in the whole hop.
 *
 * Buffered, deliberately: there is no legacy STREAMING reader and there will not be one. collab
 * has five such objects, the migration reads each once, and a streaming path here would be a
 * second unverified-chunk contract to reason about on the way to deleting the file.
 */
export function openLegacyObject(
  dek: AccountDek,
  aad: string,
  env: LegacyObjectEnvelope,
  body: Buffer,
): Buffer {
  if (env === null || typeof env !== 'object') {
    throw new ContentCryptoError(
      'VALIDATION_ERROR',
      'opening a legacy object needs the envelope read from its metadata',
    );
  }
  return openParts(dek, aad, env.iv, env.tag, body);
}

/**
 * A generation must be a positive integer that survives the v2 wire grammar. collab's
 * (`content-cipher.ts:168`), unchanged, and it stays here rather than moving to `aad.ts` because
 * the v2 wire is the only thing that still needs a generation validated as a wire component.
 */
export function assertGeneration(generation: unknown): asserts generation is number {
  if (
    typeof generation !== 'number' ||
    !Number.isInteger(generation) ||
    !GENERATION.test(String(generation))
  ) {
    throw new ContentCryptoError(
      'VALIDATION_ERROR',
      `a key generation is a positive integer of at most nine digits, received ${String(generation)}`,
      { generation: typeof generation === 'number' ? generation : null },
    );
  }
}

// ---------------------------------------------------------------------------
// Module-private
// ---------------------------------------------------------------------------

/**
 * base64 out of a metadata string, or zero bytes when the key is absent. Zero bytes is the signal
 * the caller turns into a refusal — `Buffer.from(x, 'base64')` is famously tolerant and returns an
 * empty buffer for a value that is not base64 at all, which is precisely the "marked but broken"
 * case that must never be served.
 */
function decodeMetaBytes(value: string | undefined): Buffer {
  return typeof value === 'string' ? Buffer.from(value, 'base64') : Buffer.alloc(0);
}
