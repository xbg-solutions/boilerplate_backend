/**
 * The blob codec — spec §8.2, §8.5 (step 3), §8.8, §8.9. Build step 7.
 *
 * `blob-json.ts` turns a free-form subtree into bytes and back; this module is the half that
 * holds a key. It is **not a second encryption model**: `encryptBlob` is `sealBuffer` on the same
 * `enc:v3:` wire, under the same record key, with the same tight AAD. The only difference from
 * `encryptField` is what the plaintext bytes are, and the authenticated payload-kind byte at index
 * 0 is what says which.
 *
 * ── THE FOUR SEAMS THE EARLIER STEPS LEFT HERE ────────────────────────────────────────────────
 *
 * Each is named by the module that left it, because each is a fact two files know and neither can
 * check alone:
 *
 * (a) **`blob-json.ts` restates `0x02` and `0x03` as private literals.** It is a leaf that lands
 *     three steps before `field-codec.ts` exists, so it cannot import `PAYLOAD_KIND`; its docblock
 *     names *this* module as where the equality is asserted, because this is the first file to
 *     hold both. It cannot be asserted by name — the literals are module-private — so it is
 *     asserted by BEHAVIOUR, at module load, in `assertPayloadKindsAgree` below.
 *
 * (b) **The scope's `blobAdapters` have to reach the decoder.** `decodeBlobBody` cannot decode a
 *     `$x` tag without them, and neither `decryptBlob` nor the free-standing `applyBlobPatch`
 *     holds a `ResolvedScope` (R13). Both therefore take `opts`, and both thread `opts.adapters`
 *     through. A read that drops them turns a product's own `Timestamp` into a
 *     `CONTENT_DECRYPT_FAILED` months after the write.
 *
 * (c) **`parseSubPath` does not cap depth**, and says so: `maxDepth` is the scope's, and the
 *     grammar is a leaf with no way to reach it. This is the first place that holds both a parsed
 *     subPath and the caller's options, so this is where the cap is applied (§8.9: *"Depth is
 *     capped at `maxDepth`, the same cap as the payload"*).
 *
 * (d) **`sealBuffer`'s `BLOB_TOO_LARGE` names three byte counts and no position**, and its docblock
 *     says why: `collection`, `docId` and `fieldPath` are knowable only here. `blob-json.ts`'s
 *     walk-abort has the same gap. `atSite` catches both and re-throws with the position, which is
 *     what turns *"something exceeded a budget"* into §8.5's sentence — the document, the field and
 *     the sub-path inside the payload that crossed the line.
 *
 * ── WHAT IS HERE AND WHAT IS THE DOCUMENT PLANNER'S ───────────────────────────────────────────
 *
 * `encryptBlob` / `decryptBlob` / `applyBlobPatch` are §4's three public names. Beside them sit two
 * PACKAGE-INTERNAL leaves, `sealBlobNode` and `openBlobNode`, which are §8.8's write table and
 * §7.4's blob read rows applied to the node at a registered blob path. They are the leaf
 * `doc-codec.ts` (step 10) will hand to `mapPathNode`, and they are here rather than there because
 * the rules are the codec's — what may be sealed, what is already sealed, what is a sentinel to be
 * stepped over — not the walker's. They are not on the barrel: a consumer that reached one would be
 * deciding placement for itself, and the whole point of the registry is that it does not.
 *
 * Neither of them mints, opens or copies anything when there is nothing at the path, which is what
 * makes `mapPathNode` return the document BY REFERENCE — *"a document with nothing to encrypt costs
 * nothing and mints nothing"* — and that composition is asserted in this module's suite.
 */

import { DEFAULT_MAX_DEPTH, decodeBlobBody, encodeBlob, maxPlaintextFor } from './blob-json';
import type { BlobEncodeOptions } from './blob-json';
import { openBuffer, sealBuffer } from './cipher';
import { ContentCryptoError, compact, isContentCryptoError } from './errors';
import {
  BLOB_KINDS, ENC_PREFIX_V3, PAYLOAD_KIND, decodeValue, isSealedBlobCandidate,
} from './field-codec';
import type { PayloadKind } from './field-codec';
import { formatSubPath, parseSubPath } from './field-path';
import type { SubPathSegment } from './field-path';
import type { ReadStrictness } from './registry';
import { assertKind } from './secret';
import type { RecordKey } from './secret';

// ---------------------------------------------------------------------------
// Seam (a) — the two payload-kind bytes, asserted across the module boundary
// ---------------------------------------------------------------------------

/**
 * `blob-json.ts` writes its own `KIND_BLOB_JSON` / `KIND_BLOB_DEFLATE` at index 0 of every
 * plaintext it produces; `field-codec.ts` owns `PAYLOAD_KIND`, which is what `openBuffer` checks
 * against. Nothing in the type system connects the two, and a drift would be invisible until a
 * reader somewhere refused a value it wrote itself.
 *
 * So the check is behavioural and runs once, at module load, on two payloads small enough that the
 * cost is a rounding error on a cold start:
 *
 *   - `encodeBlob(null)` must carry `PAYLOAD_KIND.blobJson`;
 *   - a payload that certainly compresses, with `deflateOver: 1`, must carry
 *     `PAYLOAD_KIND.blobDeflate`.
 *
 * It is exported so that the suite can call it directly and name it, and it returns rather than
 * throws so that the failure is the caller's to raise — the module-load guard below raises it, and
 * raising at import is correct for a wire-format contradiction: a function that cannot agree with
 * itself about a byte must not start and then write.
 */
export function payloadKindsAgree(): boolean {
  return encodeBlob(null)[0] === PAYLOAD_KIND.blobJson
    && encodeBlob('x'.repeat(256), { deflateOver: 1 })[0] === PAYLOAD_KIND.blobDeflate;
}

if (!payloadKindsAgree()) {
  throw new ContentCryptoError(
    'CONTENT_KIND_MISMATCH',
    'the blob serialiser and the payload-kind table disagree about the blob kind bytes; '
    + 'blob-json.ts restates 0x02 and 0x03 as private literals and field-codec.ts owns '
    + 'PAYLOAD_KIND, and the two have drifted',
  );
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** `enc:v3:<iv>:<ct>:<tag>` whose plaintext is `[0x02|0x03][typed JSON]`. */
export type EncryptedBlob = string & { readonly __sealed: 'blob' };

/**
 * `BlobEncodeOptions` plus the SEALED ceiling, which the serialiser has no use for and the codec
 * cannot do without: §8.5's step 3 is a projected-length check on the emitted `enc:v3:` string,
 * thrown before any base64 exists.
 *
 * A caller supplies it from `derivePathCeilings(entry, path, scope)` (R8: ceilings are per PATH,
 * not per collection) and supplies nothing else — `maxPlaintextBytes` defaults to
 * `maxPlaintextFor(maxSealedBytes)`, so raising one raises the other and the two cannot drift.
 * Passing a plain `BlobEncodeOptions` is still legal everywhere, which is why this widens §8.2's
 * declared parameter type rather than replacing it.
 */
export interface BlobSealOptions extends BlobEncodeOptions {
  /** The ceiling on the emitted `enc:v3:` string, per value. Defaults to no seal-time check. */
  readonly maxSealedBytes?: number;
}

/**
 * Where a blob sits, for ERROR ATTRIBUTION only.
 *
 * It carries no AAD: the AAD is built by the registry and passed beside it, and a site that could
 * also produce one would be a second builder of a binding that must have exactly one (§13.1's rule
 * for `PlannedAt`, for the same reason).
 */
export interface BlobSite {
  readonly collection: string;
  readonly docId: string;
  /** The registered blob path, which for a blob is always the full dotted path (§8.8). */
  readonly fieldPath: string;
}

/** One patch against a position inside a decoded payload (§8.9). */
export type BlobPatchOp =
  | { readonly op: 'set'; readonly subPath: string; readonly value: unknown }
  | { readonly op: 'unset'; readonly subPath: string }
  | { readonly op: 'append'; readonly subPath: string; readonly values: readonly unknown[] };

/**
 * A read-modify-write against one sealed blob. `planUpdate` emits one per dotted update key that
 * reached INSIDE a blob path, and the caller applies it — **in a transaction** (§14.7), because
 * every one of these is a read followed by a write and Firestore's own field-level merge was the
 * thing quietly preventing the lost update until the value became one ciphertext.
 */
export interface BlobResealRequest {
  readonly collection: string;
  readonly docId: string;
  /** The registered blob path. */
  readonly fieldPath: string;
  /** Built by the registry; never rebuilt by a caller. */
  readonly aad: string;
  readonly patches: readonly BlobPatchOp[];
}

// ---------------------------------------------------------------------------
// Seam (d) — the position a ceiling failure cannot know where it is raised
// ---------------------------------------------------------------------------

/**
 * Run `body`, and if it fails a size ceiling, re-raise the failure with the position.
 *
 * Two throw sites need this and neither can do it itself: `blob-json.ts`'s encode walk, which
 * aborts at the first chunk to cross `maxPlaintextBytes` and knows only the sub-path inside the
 * payload; and `cipher.ts`'s `sealBuffer`, which checks the projected sealed length and knows only
 * three byte counts. Both docblocks say the position is this module's to add.
 *
 * Every detail the original carried survives — `path`, `plaintextBytes`, `sealedBytes`,
 * `limitBytes` — and three are added. The result is §8.5's message:
 *
 *     blob at deliverables/d_12.structuredContent exceeds its plaintext budget at
 *     "items[418].transcript": 674961 bytes so far, the limit is 674960.
 *
 * `BLOB_TOO_LARGE` only. A `BLOB_ENCODE_FAILED` already names the path inside the payload and a
 * constructor, and re-wrapping every code here would put this function between a caller and errors
 * it did not raise.
 */
function atSite<T>(site: BlobSite | undefined, body: () => T): T {
  if (site === undefined) return body();
  try {
    return body();
  } catch (err) {
    if (!isContentCryptoError(err) || err.code !== 'BLOB_TOO_LARGE') throw err;
    const where = `${site.collection}/${site.docId}.${site.fieldPath}`;
    // "blob exceeds its plaintext budget at …" becomes "blob at <where> exceeds …", which is the
    // sentence §8.5 pins. Anything not phrased that way — sealBuffer's projected-length refusal —
    // is prefixed instead, so no message is ever silently reworded into something it does not say.
    const message = err.message.startsWith('blob ')
      ? `blob at ${where} ${err.message.slice('blob '.length)}`
      : `blob at ${where}: ${err.message}`;
    throw new ContentCryptoError('BLOB_TOO_LARGE', message, compact({
      ...err.details,
      collection: site.collection,
      docId: site.docId,
      fieldPath: site.fieldPath,
    }));
  }
}

// ---------------------------------------------------------------------------
// The codec
// ---------------------------------------------------------------------------

/**
 * Seal a subtree. `sealBuffer(key, aad, kind, body, ENC_PREFIX_V3)` over `encodeBlob`'s plaintext,
 * with the kind byte lifted out of index 0 and the body passed as a `subarray` VIEW — no copy of a
 * 675 kB payload is made to split one byte off the front.
 *
 * Both ceilings apply, in §8.5's order: the plaintext budget aborts inside the walk, at the first
 * chunk that crosses it, and the projected sealed length is checked before `toString('base64')`
 * runs. A `site` turns either failure into a message naming the document and the field.
 *
 * **It does not refuse an already-sealed string, and that is deliberate.** A root-level string is a
 * legitimate payload — §8.4 pins that strings "including ones that look like ciphertext" round-trip
 * — and the double-seal hazard is a PLACEMENT fact: it arises when a value at a registered blob
 * path is already a ciphertext, which is `sealBlobNode`'s question and where `BLOB_ALREADY_SEALED`
 * is raised.
 *
 * **It does refuse an account DEK, at runtime (R14)**, before `encodeBlob` walks anything. Same
 * refusal as `encryptField`'s and for the same reason: a blob sealed under a DEK has no wrap on
 * the record and never can have one, so it is a well-formed value nothing in this package can
 * reach again. The check is OUTSIDE `atSite`, deliberately — a wrong key is not a fact about a
 * document and a field, and dressing it as one sends the reader to the data.
 */
export function encryptBlob(
  key: RecordKey, aad: string, value: unknown, opts?: BlobSealOptions, site?: BlobSite,
): EncryptedBlob {
  assertKind(key, 'record-key', 'encryptBlob key');
  return atSite(site, () => {
    const plaintext = encodeBlob(value, encodeOptionsFor(opts));
    return sealBuffer(
      key,
      aad,
      plaintext[0] as PayloadKind,
      plaintext.subarray(1),
      ENC_PREFIX_V3,
      opts?.maxSealedBytes,
    ) as EncryptedBlob;
  });
}

/**
 * Open a sealed blob. **Never returns its input**, exactly as `decryptField` never does: leniency
 * is a document-layer decision (§7.4) and lives in `openBlobNode`, not here.
 *
 *   - a v1/v2 value              -> `WRONG_KEY_LAYER`, never a tag failure that reads as corruption
 *   - not a well-formed v3 value -> `WRONG_KEY_LAYER`, naming the shape and never the bytes
 *   - a bad tag                  -> `CONTENT_DECRYPT_FAILED`
 *   - kind byte not 0x02 / 0x03  -> `CONTENT_KIND_MISMATCH` (a field value at a blob path)
 *   - plaintext not `{"v":1,…}`  -> `CONTENT_DECRYPT_FAILED`, never partial output
 *
 * **The kind survives the open** (addendum finding 3). `openBuffer` returns `{ kind, body }` and
 * this hands both to `decodeBlobBody`, which is the same function `decodeBlob` calls after reading
 * byte 0 itself. That is the whole of the read/write symmetry: the object spill path
 * (`decodeBlob(openObject(...))`, §10.4) and the field path below decode through one function, so a
 * deflated blob cannot open on one and fail on the other. Before the fix, `openBuffer` stripped the
 * byte and the field path had to guess.
 *
 * `opts.adapters` is seam (b): without the scope's adapters a `$x` tag has no decoder.
 */
export function decryptBlob(
  key: RecordKey, aad: string, value: string, opts?: BlobEncodeOptions,
): unknown {
  assertV3(value, 'decryptBlob');
  const { kind, body } = openBuffer(key, aad, value, BLOB_KINDS, ENC_PREFIX_V3);
  return decodeBlobBody(kind, body, opts);
}

// ---------------------------------------------------------------------------
// Placement — §8.8's write table and §7.4's blob read rows
// ---------------------------------------------------------------------------

/**
 * PACKAGE-INTERNAL. §8.8's WRITE table, over the node at a registered blob path. Returns the node
 * it was given — by reference — for every row that says *skip*, which is what makes `mapPathNode`
 * hand the whole document back unchanged.
 *
 * | at the blob path | result |
 * |---|---|
 * | absent / `undefined` | skip; no key is touched |
 * | `null` | skip. `null` is "no payload": sealing it costs a reader the ability to see absence |
 * | plain object or array, `{}` and `[]` included | sealed. An empty container is a real value |
 * | a well-formed v3 ciphertext | `BLOB_ALREADY_SEALED` |
 * | any other scalar — number, boolean, `Date`, bytes, a non-ciphertext string | `BLOB_ENCODE_FAILED` |
 * | anything else object-shaped | untouched: it is the store's own sentinel |
 *
 * **The last two rows are one decision and it is worth stating.** A `FieldValue` sentinel must
 * survive a walk untouched — `mapPath` already steps over one for strings — and this package cannot
 * import the class to recognise it. So the rule is inverted: the values the codec can NAME as data
 * are refused, and an unrecognised object is assumed to be an instruction and stepped over. `Date`
 * and byte arrays are named because §8.8 names `Date` and because leaving client bytes unsealed at
 * a registered path is the failure the registry exists to prevent — they are values, not
 * instructions, and refusing them loudly is the only way anybody finds out.
 *
 * Re-sealing is refused rather than made idempotent: an outer seal over a v3 string decodes to a
 * string that is not `{"v":1,…}`, so the value opens once and then fails, unopenably. `migrateDoc`
 * stays idempotent by CHECKING `isSealedBlobCandidate` first — there is no `idempotent` flag.
 */
export function sealBlobNode(
  key: RecordKey, aad: string, node: unknown, site: BlobSite, opts?: BlobSealOptions,
): unknown {
  if (node === undefined || node === null) return node;

  if (Array.isArray(node) || isBlobRootObject(node)) {
    return encryptBlob(key, aad, node, opts, site);
  }

  if (typeof node === 'string') {
    if (isSealedBlobCandidate(node)) {
      throw new ContentCryptoError(
        'BLOB_ALREADY_SEALED',
        `the value at ${where(site)} is already a v3 ciphertext; sealing it again produces a `
        + 'double envelope whose outer decode yields a string that is not a serialised payload, '
        + 'and nothing can open it. A migration checks isSealedBlobCandidate first.',
        siteDetails(site),
      );
    }
    return refuseAtBlobPath(node, site);
  }

  if (typeof node === 'object' && !(node instanceof Date) && !ArrayBuffer.isView(node)) {
    // An object this codec cannot name is the store's own sentinel — a delete, an increment, a
    // server timestamp. Stepped over and not counted, which is `mapPath`'s rule for strings.
    return node;
  }

  return refuseAtBlobPath(node, site);
}

/**
 * PACKAGE-INTERNAL. §7.4's read rows for a blob path, which differ from the write table in exactly
 * one way: what is NOT a ciphertext is a question about how far the migration has got, so it is
 * answered by the collection's read strictness rather than by the codec.
 *
 * | at the blob path | `strict` | `lenient` |
 * |---|---|---|
 * | absent / `undefined` / `null` | untouched | untouched |
 * | well-formed v3 ciphertext | opened; a bad tag is `CONTENT_DECRYPT_FAILED`, always | same |
 * | v1/v2 ciphertext | `WRONG_KEY_LAYER` — only `migrateDoc` reads legacy | same |
 * | a plain object or array | `CONTENT_PLAINTEXT_AT_REGISTERED_PATH` | untouched — the pre-migration shape |
 * | any other value | `CONTENT_PLAINTEXT_AT_REGISTERED_PATH` | untouched |
 *
 * Lenient is collab's Phase-C exit ramp and nothing else's, and it is a silent
 * plaintext-substitution path for as long as it is set: an adversary with store write access
 * replaces a sealed value with a plaintext map and every reader accepts it.
 *
 * Idempotent under leniency by construction — an already-opened payload is a plain object, which
 * the fourth row returns untouched — so `decryptDoc` twice is `decryptDoc` once.
 */
export function openBlobNode(
  key: RecordKey, aad: string, node: unknown, site: BlobSite,
  reads: ReadStrictness, opts?: BlobEncodeOptions,
): unknown {
  if (node === undefined || node === null) return node;

  if (typeof node === 'string') {
    const decoded = decodeValue(node);
    if (decoded?.version === 'v3') return decryptBlob(key, aad, node, opts);
    // A WELL-FORMED value of an older wire is a migration that has not run, and it is
    // `WRONG_KEY_LAYER` in BOTH read modes: leniency is about plaintext left behind, never about
    // ciphertext under the wrong key layer. Anything else falls through to the strictness rows.
    if (decoded !== null) assertV3(node, 'a blob path');
  }

  if (reads === 'lenient') return node;

  throw new ContentCryptoError(
    'CONTENT_PLAINTEXT_AT_REGISTERED_PATH',
    `the value at ${where(site)} is not sealed: a registered blob path under strict reads holds a `
    + `v3 ciphertext, and this is ${describe(node)}. Either the migration has not reached this `
    + 'document, or something wrote past the codec.',
    siteDetails(site),
  );
}

// ---------------------------------------------------------------------------
// applyBlobPatch — §8.9
// ---------------------------------------------------------------------------

/**
 * Open a sealed blob, apply the patches in order, and reseal at the SAME AAD. Pure and
 * synchronous.
 *
 * Free-standing and exported because a migration script legitimately holds a key outside a session
 * — build's two `--apply`-gated backfills are exactly that. Every product otherwise uses
 * `session.applyBlobPatch(req, current)`, which is why `session.key` could be deleted and `close()`
 * could start meaning what it says.
 *
 * **`current`, in all four shapes it arrives in** (§8.9):
 *
 *   - an `EncryptedBlob` string — opened under `req.aad`. A value sealed under a DIFFERENT AAD
 *     fails here, which is the AAD doing its job;
 *   - a plain object or array — pre-migration, lenient scopes only — patched as it stands and then
 *     sealed, so the patch and the migration happen in one write;
 *   - `undefined` or `null` — `set` and `append` create the root: `{}` when the first segment is a
 *     key, `[]` when it is an index;
 *   - anything else — `BLOB_ENCODE_FAILED`.
 *
 * **Patches apply in array order, each against the result of the previous**, so two ops on one
 * subPath compose predictably and an `unset` followed by a `set` is a replace.
 *
 * **A reseal always produces a new ciphertext**, under a fresh IV, even when every patch was a
 * no-op: two seals of identical plaintext differ, so there is no comparison to make and nothing to
 * skip. **A reseal is a write.** A caller must not enqueue one it does not need.
 *
 * The resealed value is re-measured against the same ceilings, so a patch that grows a payload past
 * its budget fails at the patch rather than at the next full write.
 *
 * **Nothing the caller handed in is mutated.** Containers are copied along the touched path only —
 * `mapPath`'s discipline, for the same reason: a caller that read the payload out of a snapshot and
 * passed it here must not find its own object changed underneath it when the transaction retries.
 */
export function applyBlobPatch(
  key: RecordKey, req: BlobResealRequest, current: unknown, opts?: BlobSealOptions,
): EncryptedBlob {
  assertResealRequest(req);
  const site: BlobSite = {
    collection: req.collection, docId: req.docId, fieldPath: req.fieldPath,
  };
  const maxDepth = depthCapOf(opts);

  let root = openCurrent(key, req, current, site, opts);

  for (let i = 0; i < req.patches.length; i += 1) {
    const patch = req.patches[i];
    assertPatchOp(patch, i);
    // Seam (c): `parseSubPath` deliberately does not cap depth — `maxDepth` is the scope's and the
    // grammar is a leaf that cannot reach it. This is the first place holding both.
    const segments = parseSubPath(patch.subPath);
    if (segments.length > maxDepth) {
      throw invalidSubPath(
        patch.subPath,
        `it is ${segments.length} segments deep and the payload's depth cap is ${maxDepth}`,
      );
    }
    switch (patch.op) {
      case 'set':
        root = setAt(root, segments, 0, patch.value, patch.subPath);
        break;
      case 'unset':
        root = unsetAt(root, segments, 0);
        break;
      default:
        root = appendAt(root, segments, 0, patch.values, patch.subPath);
        break;
    }
  }

  return encryptBlob(key, req.aad, root, opts, site);
}

/** §8.9's four `current` shapes, resolved to a working root. */
function openCurrent(
  key: RecordKey, req: BlobResealRequest, current: unknown, site: BlobSite,
  opts?: BlobEncodeOptions,
): unknown {
  if (current === undefined || current === null) return undefined;
  if (typeof current === 'string') {
    if (isSealedBlobCandidate(current)) return decryptBlob(key, req.aad, current, opts);
    return refuseAtBlobPath(current, site);
  }
  if (Array.isArray(current) || isBlobRootObject(current)) return current;
  return refuseAtBlobPath(current, site);
}

// ── set ──────────────────────────────────────────────────────────────────────

/**
 * `set`, per §8.9's table.
 *
 * | situation | behaviour |
 * |---|---|
 * | every intermediate `{key}` exists as an object | descend |
 * | an intermediate `{key}` is absent | create `{}` and descend — auto-creation is for key segments, and ONLY for key segments |
 * | an intermediate `{index}`'s parent is absent or is not an array | `BLOB_SUBPATH_INVALID` — auto-vivifying an array means deciding what fills the holes, and the encoding has no holes |
 * | an intermediate segment is a scalar and the path continues through it | `BLOB_SUBPATH_INVALID`. Firestore's own dotted update clobbers here; we refuse, because a partial update that silently replaces a subtree is the lost update this mechanism exists to prevent |
 * | terminal key | assign — create or replace |
 * | terminal `[n]`, `n < length` | replace element `n` |
 * | terminal `[n]`, `n === length` | append — the one auto-extension, and it produces no hole |
 * | terminal `[n]`, `n > length` | `BLOB_SUBPATH_INVALID` |
 * | `value` is `undefined` | the key is set PRESENT with value `undefined`, which the serialiser preserves and which is a different fact from absent. `unset` removes it; both exist because the encoding can tell them apart |
 *
 * `null` is treated as absent for an intermediate, exactly as `append`'s own table treats it at the
 * target — the two ops share a grammar and a rule that held in one and not the other is a rule
 * nobody remembers.
 */
function setAt(
  node: unknown, segments: readonly SubPathSegment[], at: number,
  value: unknown, subPath: string,
): unknown {
  const segment = segments[at];
  const terminal = at === segments.length - 1;

  if ('index' in segment) {
    const array = arrayForIndex(node, segments, at, subPath, 'set');
    const n = segment.index;
    // `n === length` is the ONE auto-extension, and it applies to an intermediate index as well as
    // to a terminal one — because it is the same fact in both positions: appending element `length`
    // produces no hole, and `[0].name` against a root that §8.9 has just created as `[]` is exactly
    // that case. `n > length` refuses in both, because filling the gap would need holes.
    if (n > array.length) throw pastTheEnd(subPath, segments, at, array.length, 'set');
    const out = array.slice();
    out[n] = terminal ? value : setAt(array[n], segments, at + 1, value, subPath);
    return out;
  }

  const base = objectForKey(node, segments, at, subPath, 'set');
  const out = { ...base };
  // `defineProperty`, never assignment: a payload containing `__proto__` is free-form client data
  // and must land as an own data property rather than reaching a prototype.
  const next = terminal ? value : setAt(base[segment.key], segments, at + 1, value, subPath);
  Object.defineProperty(out, segment.key, {
    value: next, writable: true, enumerable: true, configurable: true,
  });
  return out;
}

// ── unset ────────────────────────────────────────────────────────────────────

/**
 * `unset` — total and idempotent by construction, which is what makes a retried task safe. It is
 * the one op that never throws on the shape of the DATA, only on the shape of the subPath.
 *
 * | situation | behaviour |
 * |---|---|
 * | terminal key on an object | `delete` — the key disappears |
 * | terminal `[n]` on an array, `n < length` | SPLICE — the element is removed and the tail shifts. Not a hole and not a `null` placeholder: holes are unrepresentable in the encoding, and a `null` would be a silent data change nobody asked for |
 * | terminal `[n]`, `n >= length` | no-op |
 * | any intermediate absent, or the wrong container type | no-op |
 *
 * A no-op returns the node BY REFERENCE, so an `unset` that removed nothing copies nothing.
 */
function unsetAt(node: unknown, segments: readonly SubPathSegment[], at: number): unknown {
  const segment = segments[at];
  const terminal = at === segments.length - 1;

  if ('index' in segment) {
    if (!Array.isArray(node) || segment.index >= node.length) return node;
    if (terminal) {
      const out = node.slice();
      out.splice(segment.index, 1);
      return out;
    }
    const next = unsetAt(node[segment.index], segments, at + 1);
    if (next === node[segment.index]) return node;
    const out = node.slice();
    out[segment.index] = next;
    return out;
  }

  if (!isBlobRootObject(node)) return node;
  const base = node as Record<string, unknown>;
  if (!Object.prototype.hasOwnProperty.call(base, segment.key)) return node;
  if (terminal) {
    const out = { ...base };
    delete out[segment.key];
    return out;
  }
  const next = unsetAt(base[segment.key], segments, at + 1);
  if (next === base[segment.key]) return node;
  const out = { ...base };
  Object.defineProperty(out, segment.key, {
    value: next, writable: true, enumerable: true, configurable: true,
  });
  return out;
}

// ── append ───────────────────────────────────────────────────────────────────

/**
 * `append` — the op that stops the next author reintroducing the lost update that Firestore's
 * field-level merge was quietly preventing.
 *
 * A target that is absent, `undefined` or `null` becomes `[]` and is then appended to; an array
 * takes `values` in order; anything else is `BLOB_SUBPATH_INVALID` naming the constructor.
 * Intermediates are created as for `set`.
 *
 * **`append` is append, not union.** There is no dedupe, because dedupe over free-form values needs
 * an identity we do not have and guessing one would be a silent data policy embedded in a codec.
 *
 * **It must run inside a transaction**, and the refusals say so: an append is read-modify-write
 * over one ciphertext, and against a stale read it produces a different array than against a fresh
 * one. That is not a failure mode the package can detect; it is the reason `reseals` exists.
 */
function appendAt(
  node: unknown, segments: readonly SubPathSegment[], at: number,
  values: readonly unknown[], subPath: string,
): unknown {
  const segment = segments[at];
  const terminal = at === segments.length - 1;

  if ('index' in segment) {
    const array = arrayForIndex(node, segments, at, subPath, 'append');
    const n = segment.index;
    if (n > array.length) throw pastTheEnd(subPath, segments, at, array.length, 'append');
    const out = array.slice();
    out[n] = terminal
      ? extend(array[n], values, subPath, segments, at)
      : appendAt(array[n], segments, at + 1, values, subPath);
    return out;
  }

  const base = objectForKey(node, segments, at, subPath, 'append');
  const out = { ...base };
  const next = terminal
    ? extend(base[segment.key], values, subPath, segments, at)
    : appendAt(base[segment.key], segments, at + 1, values, subPath);
  Object.defineProperty(out, segment.key, {
    value: next, writable: true, enumerable: true, configurable: true,
  });
  return out;
}

/** The terminal half of `append`: create `[]` where there is nothing, refuse anything else. */
function extend(
  target: unknown, values: readonly unknown[], subPath: string,
  segments: readonly SubPathSegment[], at: number,
): unknown[] {
  if (target === undefined || target === null) return [...values];
  if (Array.isArray(target)) return [...target, ...values];
  throw invalidSubPath(
    subPath,
    `append needs an array at "${pathTo(segments, at + 1)}" and found ${describe(target)}; and an `
    + 'append is a read-modify-write over one ciphertext, so it must run inside a transaction',
  );
}

// ---------------------------------------------------------------------------
// Container resolution, shared by set and append
// ---------------------------------------------------------------------------

/**
 * The container for a `{key}` segment: an object, auto-created where there is nothing.
 *
 * The auto-creation is the ONLY one in the grammar, and it is what makes
 * `{ op:'set', subPath:'gitContext', value: … }` work against a payload that has never held one.
 */
function objectForKey(
  node: unknown, segments: readonly SubPathSegment[], at: number,
  subPath: string, op: 'set' | 'append',
): Record<string, unknown> {
  if (node === undefined || node === null) return {};
  if (isBlobRootObject(node)) return node as Record<string, unknown>;
  throw invalidSubPath(
    subPath,
    `${op} at "${subPath}" traverses ${describe(node)} at "${pathTo(segments, at)}"`,
  );
}

/**
 * The container for an `{index}` segment: an array, and never created.
 *
 * The exception is the ROOT, where §8.9's `current` rules say an absent payload becomes `[]` when
 * the first segment is an index — a blob root may itself be an array. Below the root an absent
 * parent is a refusal, because auto-vivifying an array from an index means deciding what fills the
 * holes and the encoding has none.
 */
function arrayForIndex(
  node: unknown, segments: readonly SubPathSegment[], at: number,
  subPath: string, op: 'set' | 'append',
): readonly unknown[] {
  if (Array.isArray(node)) return node;
  if (at === 0 && (node === undefined || node === null)) return [];
  throw invalidSubPath(
    subPath,
    `${op} at "${subPath}" needs an array at "${pathTo(segments, at)}" and found `
    + `${describe(node)}; an index never creates one, because filling the gap would need holes `
    + 'and the encoding has none',
  );
}

function pastTheEnd(
  subPath: string, segments: readonly SubPathSegment[], at: number,
  length: number, op: 'set' | 'append',
): ContentCryptoError {
  const segment = segments[at];
  const index = 'index' in segment ? segment.index : -1;
  return invalidSubPath(
    subPath,
    `${op} at "${subPath}" addresses element ${index} of the ${length}-element array at `
    + `"${pathTo(segments, at)}"; extending past the end would need holes, and only element `
    + `${length} may be appended`,
  );
}

// ---------------------------------------------------------------------------
// Validation and small helpers
// ---------------------------------------------------------------------------

function assertResealRequest(req: unknown): asserts req is BlobResealRequest {
  if (req === null || typeof req !== 'object' || Array.isArray(req)) {
    throw new ContentCryptoError(
      'VALIDATION_ERROR', `a BlobResealRequest is an object, received ${describe(req)}`,
    );
  }
  const bag = req as Record<string, unknown>;
  for (const field of ['collection', 'docId', 'fieldPath', 'aad'] as const) {
    if (typeof bag[field] !== 'string' || bag[field] === '') {
      throw new ContentCryptoError(
        'VALIDATION_ERROR',
        `BlobResealRequest.${field} must be a non-empty string; the AAD is built by the registry `
        + 'and the position is what a size refusal is named after',
      );
    }
  }
  if (!Array.isArray(bag.patches)) {
    throw new ContentCryptoError(
      'VALIDATION_ERROR',
      `BlobResealRequest.patches must be an array, received ${describe(bag.patches)}`,
    );
  }
}

/**
 * One op, checked before it is applied.
 *
 * An empty `patches` array is LEGAL and is a reseal of the same payload under a fresh IV — §8.9
 * settles that a reseal happens even when every patch was a no-op, and a caller that enqueued one
 * it did not need has made a decision this codec cannot second-guess.
 */
function assertPatchOp(patch: unknown, at: number): asserts patch is BlobPatchOp {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new ContentCryptoError(
      'VALIDATION_ERROR', `patches[${at}] is not a BlobPatchOp: it is ${describe(patch)}`,
    );
  }
  const bag = patch as Record<string, unknown>;
  if (bag.op !== 'set' && bag.op !== 'unset' && bag.op !== 'append') {
    throw new ContentCryptoError(
      'VALIDATION_ERROR',
      `patches[${at}].op is ${JSON.stringify(bag.op)}; the three ops are set, unset and append`,
    );
  }
  if (typeof bag.subPath !== 'string') {
    throw new ContentCryptoError(
      'VALIDATION_ERROR', `patches[${at}].subPath must be a string`,
    );
  }
  if (bag.op === 'append' && !Array.isArray(bag.values)) {
    throw new ContentCryptoError(
      'VALIDATION_ERROR',
      `patches[${at}].values must be an array — append takes the elements to add, in order, and `
      + 'appends them rather than uniting them',
    );
  }
}

/**
 * `WRONG_KEY_LAYER` for anything that is not a well-formed v3 value, in the same two arms and the
 * same words as `decryptField`.
 *
 * It asks `decodeValue`, which is keyless and never throws, rather than testing a prefix — so no
 * wire literal is spelled in this file. Every wire prefix is declared in `field-codec.ts` and
 * nowhere else (`check-mirror.js` assertion 6), and `legacy-readers.test.ts` clause 2 asserts it
 * over the whole tree.
 */
function assertV3(value: unknown, reader: string): void {
  const decoded = decodeValue(value);
  if (decoded === null) {
    throw new ContentCryptoError(
      'WRONG_KEY_LAYER',
      `${reader} was given something that is not a well-formed sealed value: a v3 value is a `
      + 'prefix, a 12-byte IV, at least one ciphertext byte and a 16-byte tag, all base64 and '
      + 'colon-separated',
    );
  }
  if (decoded.version !== 'v3') {
    throw new ContentCryptoError(
      'WRONG_KEY_LAYER',
      `${reader} holds a record key and this is a ${decoded.version} value, sealed under an `
      + 'account DEK; only the migration reads the legacy layer',
    );
  }
}

/**
 * Seam (b) and the ceiling relation, in one place.
 *
 * A caller that named a sealed ceiling and no plaintext ceiling gets `maxPlaintextFor` of it, which
 * is §8.5's rule that raising one raises the other so the two cannot drift. Everything else —
 * `adapters` above all — passes straight through to the serialiser.
 */
function encodeOptionsFor(opts?: BlobSealOptions): BlobEncodeOptions | undefined {
  if (opts === undefined) return undefined;
  if (opts.maxPlaintextBytes !== undefined || opts.maxSealedBytes === undefined) return opts;
  return { ...opts, maxPlaintextBytes: maxPlaintextFor(opts.maxSealedBytes) };
}

/**
 * The subPath depth cap (seam c), which is the PAYLOAD's own cap — `DEFAULT_MAX_DEPTH` imported
 * from the serialiser rather than restated, because a subPath deeper than a payload may be is a
 * subPath that addresses a position the reseal could not then write.
 */
function depthCapOf(opts?: BlobSealOptions): number {
  const given = opts?.maxDepth;
  if (given === undefined) return DEFAULT_MAX_DEPTH;
  if (!Number.isInteger(given) || given < 1) {
    throw new ContentCryptoError(
      'VALIDATION_ERROR', 'BlobEncodeOptions.maxDepth must be a whole number of at least 1',
    );
  }
  return given;
}

function invalidSubPath(subPath: string, why: string): ContentCryptoError {
  return new ContentCryptoError(
    'BLOB_SUBPATH_INVALID', `The blob subPath "${subPath}" is not valid: ${why}.`, { subPath },
  );
}

/** `<root>` for the empty prefix, and the subPath grammar for everything else. */
function pathTo(segments: readonly SubPathSegment[], at: number): string {
  return at === 0 ? '<root>' : formatSubPath(segments.slice(0, at));
}

const where = (site: BlobSite): string => `${site.collection}/${site.docId}.${site.fieldPath}`;

const siteDetails = (site: BlobSite) => ({
  collection: site.collection, docId: site.docId, fieldPath: site.fieldPath,
});

function refuseAtBlobPath(node: unknown, site: BlobSite): never {
  throw new ContentCryptoError(
    'BLOB_ENCODE_FAILED',
    `the value at ${where(site)} is ${describe(node)}; a blob path holds a map or an array, and `
    + 'allowing a bare scalar there would make "is this sealed?" ambiguous for ever',
    { ...siteDetails(site), constructorName: constructorNameOf(node) },
  );
}

/**
 * The plain-object test at a blob ROOT: `constructor === Object` or a null prototype.
 *
 * One notch looser than `field-path.ts`'s `isPlainObject`, and identical to the test
 * `blob-json.ts` uses INSIDE a blob — which is the point, because a blob root is inside the blob.
 * There are no sentinels to protect within a payload and a null-prototype map is a legitimate
 * free-form map. `isPlainObject` stays strict where it is, because that strictness is what keeps
 * Firestore sentinels intact during a `mapPath`.
 */
function isBlobRootObject(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return (value as object).constructor === Object || Object.getPrototypeOf(value) === null;
}

/** Names a shape, NEVER a value: these strings reach error messages. */
function describe(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return 'an array';
  if (typeof value === 'object') return `a ${constructorNameOf(value)}`;
  return `a ${typeof value}`;
}

function constructorNameOf(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  const proto: unknown = Object.getPrototypeOf(value as object);
  if (proto === null || proto === undefined) return 'Object';
  const ctor = (proto as { constructor?: { name?: unknown } }).constructor;
  return typeof ctor?.name === 'string' ? ctor.name : 'Object';
}
