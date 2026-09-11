/**
 * The record-key layer: mint, wrap, unwrap, rewrap, and the `keyWraps` stored shape.
 *
 * **A record key exists at rest ONLY as wraps.** It is 32 bytes of `randomBytes`, derived from
 * nothing, and the only two routes to one are `mintRecordKey` (which invents it) and
 * `unwrapRecordKey` (which needs a `DekHandle`, which needs the custodian to have said yes). That
 * is what makes "to read you must unwrap" structural rather than a policy anyone can forget: the
 * set of wraps IS the access list, and there is no other door.
 *
 * Three consequences worth holding in mind before changing anything here:
 *
 * - **The key is not derived.** A record survives its owner's shred while a partner still holds a
 *   wrap, because nothing about the key depends on the owner. Deriving it from an account secret
 *   would make federation impossible and crypto-shredding a lie in the other direction.
 * - **`gen` is per WRAP, not per record.** Two parties sit at different account-key generations
 *   and both read; a rotation is therefore one field write per party rather than a coordination.
 * - **The wrap lives on the wrap HOLDER and nowhere else** — the document at `RecordRef.path`.
 *   At aggregate granularity that is the aggregate root, and anything that walks children looking
 *   for a wrap has the design wrong.
 *
 * The two asymmetries the plan names, restated because they are easy to lose:
 *
 * - **Rotation does not re-key.** `rewrapRecordKey` changes who can reach the record key; the key
 *   the content sits under is untouched. A record key that leaks is compromised permanently.
 * - **Removing a wrap is not revoking a key.** It removes a party's path to *obtain* the key. If
 *   they captured it, they can still decrypt.
 */

import { randomBytes } from 'node:crypto';

import { aadForRecordKeyWrap } from './aad';
import { openBuffer, sealBuffer } from './cipher';
import type { DekHandle } from './custodian';
import { ContentCryptoError, isContentCryptoError } from './errors';
import type { ContentCryptoCode, ErrorDetails } from './errors';
import { PAYLOAD_KIND, WRAP_PREFIX } from './field-codec';
import { KEY_BYTES, assertKind, recordKeyFromBytes, secretBytes, zeroise } from './secret';
import type { RecordKey } from './secret';

// ---------------------------------------------------------------------------
// The stored shape
// ---------------------------------------------------------------------------

/**
 * Where a record key lives, said three ways so the three can never disagree.
 *
 * `path` is supplied by the product, never derived by this package: only the product knows how
 * its own documents are laid out, and a ref rebuilt from an id is a ref that silently moves when
 * the id does. **A record whose document path changes invalidates every wrap on it** — the path
 * is inside each wrap's AAD, so a moved record is an unreadable one.
 */
export interface RecordRef {
  /** The granularity dial's key. At `document` granularity this IS the registry collection key. */
  readonly type: string;
  readonly id: string;
  /** The FULL document path of the record key's holder — the `scopePath` of every wrap AAD on
   *  this record. Per document: that document. Per aggregate: the AGGREGATE ROOT. Per account:
   *  the product's account key row. Never a bare id; ids are not reliably unique. */
  readonly path: string;
}

/**
 * One entry in the access list: this account's copy of the record key, sealed under that
 * account's DEK.
 *
 * There is no `aad` field. The plan says the AAD string "is never stored"; it is derived at read
 * time from `gen`, the holder's id and `RecordRef.path`, which deletes a whole class of
 * store-it-and-refuse-a-mismatch code and the mismatch refusal that went with it.
 */
export interface WrapEntry {
  /** The ACCOUNT-DEK generation this wrap is under. The generation lives HERE, not in the value:
   *  a reader uses it to choose which DEK to fetch, and the AAD binds it so a relabelled wrap
   *  fails authentically rather than by luck. */
  readonly gen: number;
  /** `wrap:v1:<iv>:<ct>:<tag>` over the 32 record-key bytes, payload kind 0x04. Exactly 94
   *  characters — see the envelope arithmetic in §7.3, and `record-key.test.ts` pins it. */
  readonly wrapped: string;
  /** ISO-8601. Feeds the "who can read this?" UI and the audit entry. */
  readonly at?: string;
}

/** accountId → wrap. **THE ACCESS LIST.** */
export type KeyWraps = { readonly [accountId: string]: WrapEntry };

/**
 * The map field. Written ON THE WRAP HOLDER — at `document` granularity the document itself, at
 * `aggregate` granularity the aggregate root and nowhere else, at `account` granularity the
 * product's own account key row. `RecordRef.path` is that document's path and the two must agree
 * by construction. **Anything that walks children to find a wrap has the design wrong.**
 */
export const KEY_WRAPS_FIELD = 'keyWraps' as const;

/**
 * The SAME set as `Object.keys(keyWraps)`, as an array, because a map field is not indexable.
 * Every wrap patch writes both, atomically, in one update. It buys the two queries the design
 * needs and cannot otherwise have:
 *
 *   - `array-contains accountId` → the holder-scoped walk for rotate / grant / revoke
 *   - `wrapHolders == []`        → the erase sweep's "last man standing"
 *
 * It is the package's business because the patch is the only thing that knows the after-set.
 */
export const WRAP_HOLDERS_FIELD = 'wrapHolders' as const;

// ---------------------------------------------------------------------------
// Validation — shared by every entry point, so one rule has one implementation
// ---------------------------------------------------------------------------

function fail(code: ContentCryptoCode, message: string, details?: ErrorDetails): never {
  throw new ContentCryptoError(code, message, details);
}

function typeName(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  return `a ${typeof value}`;
}

/** An object we can read named properties off: not null, not an array, not a primitive. A store
 *  hands back plain maps, so this is deliberately looser than `isPlainObject`. */
function isReadableObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The ref's own shape, and only that. The `scopePath` grammar — no leading or trailing `/`, no
 * empty segment, an even segment count — belongs to `assertScopePath` in `key-scope.ts`, where a
 * path is constructed. Two half-copies of one grammar is how the two drift.
 */
function assertRecordRef(record: unknown): asserts record is RecordRef {
  if (!isReadableObject(record)) {
    fail('VALIDATION_ERROR', `A record ref must be an object, received ${typeName(record)}`);
  }
  for (const key of ['type', 'id', 'path'] as const) {
    const value = record[key];
    if (typeof value !== 'string' || value.length === 0) {
      fail(
        'VALIDATION_ERROR',
        `A record ref needs a non-empty '${key}'; a wrap AAD binds the full path of its holder ` +
          'and cannot be built from a partial ref',
        { recordType: typeof record.type === 'string' ? record.type : '' },
      );
    }
  }
}

/** `assertKind` moved to `secret.ts` at R14, unchanged in shape or message: the three content
 *  codecs now make the same refusal, and the module that owns the two kinds is the one place the
 *  sentence can be spelled once. This module still makes both halves of the wrap-path check —
 *  `assertDekHandle` below on the wrapping key, `wrapRecordKey` on the key being wrapped. */

function assertDekHandle(dek: unknown, what: string): asserts dek is DekHandle {
  if (!isReadableObject(dek)) {
    fail('VALIDATION_ERROR', `${what} must be a DekHandle, received ${typeName(dek)}`);
  }
  const generation = dek.generation;
  if (typeof generation !== 'number' || !Number.isSafeInteger(generation) || generation <= 0) {
    fail(
      'VALIDATION_ERROR',
      `${what} needs a positive safe integer generation, received ${String(generation)}`,
      Number.isFinite(generation) ? { generation: generation as number } : undefined,
    );
  }
  assertKind(dek.key, 'dek', `${what}.key`);
}

/**
 * A structural read of one stored entry, returning a normalised copy or `null`.
 *
 * Normalised, not passed through: a stored entry may carry fields we deleted (v1's `aad`) or
 * fields nobody declared, and letting those ride along means the resulting `KeyWraps` is not the
 * shape the type says it is. A non-string `at` costs the entry its timestamp, never its
 * readability — losing the "who can read this" label is a cosmetic loss and refusing the wrap is
 * a data loss.
 */
function readWrapEntry(value: unknown): WrapEntry | null {
  if (!isReadableObject(value)) return null;
  const gen = value.gen;
  if (typeof gen !== 'number' || !Number.isSafeInteger(gen) || gen <= 0) return null;
  const wrapped = value.wrapped;
  if (typeof wrapped !== 'string' || !wrapped.startsWith(WRAP_PREFIX)) return null;
  const at = value.at;
  return Object.freeze(
    typeof at === 'string' && at.length > 0 ? { gen, wrapped, at } : { gen, wrapped },
  );
}

/**
 * Set one entry without ever writing through a `__proto__` assignment.
 *
 * An accountId is a store-supplied string, and `out['__proto__'] = entry` on an ordinary object
 * invokes the prototype setter instead of creating a key — which would silently drop a holder AND
 * reshape the object. `defineProperty` creates a data property whatever the key is, so the
 * tolerant parser stays tolerant without becoming a prototype-pollution seam.
 * (`Object.fromEntries` would do the same job and is ES2019; the tree targets es2017.)
 */
function setEntry<T>(out: Record<string, T>, key: string, value: T): void {
  Object.defineProperty(out, key, { value, enumerable: true, writable: true, configurable: true });
}

// ---------------------------------------------------------------------------
// Mint / wrap / unwrap / rewrap
// ---------------------------------------------------------------------------

/**
 * 32 bytes from `randomBytes`. **No derivation from anything** — which is what lets a record
 * survive its owner's shred while a partner still holds a wrap.
 *
 * The record is taken so the handle prints as `record-key {path}`: a key that cannot be traced in
 * a log to the record it belongs to is a key nobody can reason about during an incident. The path
 * is a label here and an AAD component in `wrapRecordKey`; it is never mixed into the bytes.
 *
 * **Nothing may be sealed under the returned key until a wrap for it is durable.** A crash between
 * the first seal and the wrap's write leaves ciphertext under a key that was never persisted —
 * permanent, silent data loss. The façade carries that by COMMITTING the wrap itself, through the
 * `WrapCommitter` its options require, before any object capable of sealing exists (R10a); at this
 * level it is a rule, and a caller holding a bare `RecordKey` — an `--apply`-gated backfill script
 * is the one legitimate case — owns it. A migration or backfill re-run must likewise adopt an
 * existing key with `unwrapRecordKey` whenever `keyWraps` is non-empty rather than minting a
 * second one.
 */
export function mintRecordKey(record: RecordRef): RecordKey {
  assertRecordRef(record);
  return recordKeyFromBytes(randomBytes(KEY_BYTES), record.path);
}

/**
 * Seal a record key for one holder, under that holder's account DEK.
 *
 * `accountId` is **the holder** — for a shared record, the RECIPIENT — and it is also the account
 * whose DEK does the wrapping, which is why the two are one argument rather than two. The AAD is
 * `record-key/{productId}/{accountId}/{generation}/{scopePath}`, so the same record key wrapped
 * for two accounts produces two wraps under two different AADs, and neither can be moved into the
 * other's slot.
 */
export function wrapRecordKey(args: {
  readonly productId: string;
  readonly dek: DekHandle;
  readonly accountId: string;
  readonly record: RecordRef;
  readonly recordKey: RecordKey;
  readonly now?: () => Date;
}): WrapEntry {
  const { productId, dek, accountId, record, recordKey, now } = args;
  assertDekHandle(dek, 'wrapRecordKey needs a DekHandle');
  assertRecordRef(record);
  assertKind(recordKey, 'record-key', 'wrapRecordKey recordKey');

  // `aadForRecordKeyWrap` validates productId, accountId and generation; a bad one throws
  // VALIDATION_ERROR here rather than producing a wrap nobody can open.
  const aad = aadForRecordKeyWrap(productId, accountId, dek.generation, record.path);

  // The bytes are read at the call and held in no local beyond it: `secretBytes` returns the
  // LIVE buffer, so a copy here would be a second set of key bytes `zeroise` cannot reach.
  const wrapped = sealBuffer(
    dek.key,
    aad,
    PAYLOAD_KIND.recordKey,
    secretBytes(recordKey),
    WRAP_PREFIX,
  );

  return Object.freeze({
    gen: dek.generation,
    wrapped,
    at: (now ? now() : new Date()).toISOString(),
  });
}

/**
 * The one place a cipher failure becomes a wrap failure.
 *
 * A zeroised DEK handle is a lifecycle bug in the caller and keeps its own code — it is what makes
 * `session.close()` mean something. EVERYTHING else the cipher can say about these bytes is one
 * event with one remedy: this wrap did not open under this DEK. No `cause` and no upstream
 * message travels with it: an unbounded string from somebody else's library is exactly what must
 * not reach a log from a key path.
 */
function openWrapped(
  dek: DekHandle,
  aad: string,
  entry: WrapEntry,
  accountId: string,
  record: RecordRef,
): Buffer {
  try {
    return openBuffer(dek.key, aad, entry.wrapped, [PAYLOAD_KIND.recordKey], WRAP_PREFIX).body;
  } catch (err) {
    if (isContentCryptoError(err, 'KEY_MATERIAL_DESTROYED')) throw err;
    return fail(
      'RECORD_KEY_UNWRAP_FAILED',
      `The wrap for account '${accountId}' on record '${record.path}' did not verify under that ` +
        `account's generation ${entry.gen} DEK. The wrap is broken, was moved from another ` +
        'record, or is labelled with a generation it was not sealed under',
      { accountId, scopePath: record.path, generation: entry.gen },
    );
  }
}

/**
 * **The ONLY way to obtain an existing record key.** It needs a `DekHandle`, which needs the
 * custodian to have said yes.
 *
 * Throws `RECORD_KEY_UNWRAP_FAILED`, distinct from `CONTENT_DECRYPT_FAILED`, so a broken or moved
 * wrap is never diagnosed as corrupt content — the two have completely different remedies and
 * conflating them sends an operator to the wrong one.
 *
 * The AAD's generation is `wrap.gen`, the label stored beside the ciphertext, because that is
 * what the reader used to choose the DEK it is holding. A caller that fetched a different
 * generation gets `RECORD_KEY_UNWRAP_FAILED` rather than a special error: from here, a DEK that
 * does not open this wrap and a DEK for the wrong generation are the same event.
 */
export function unwrapRecordKey(args: {
  readonly productId: string;
  readonly dek: DekHandle;
  readonly accountId: string;
  readonly record: RecordRef;
  readonly wrap: WrapEntry;
}): RecordKey {
  const { productId, dek, accountId, record, wrap } = args;
  assertDekHandle(dek, 'unwrapRecordKey needs a DekHandle');
  assertRecordRef(record);

  const entry = readWrapEntry(wrap);
  if (entry === null) {
    fail(
      'RECORD_KEY_UNWRAP_FAILED',
      `The wrap for account '${accountId}' on record '${record.path}' is not a well-formed wrap ` +
        'entry, so there is nothing to open',
      { accountId: typeof accountId === 'string' ? accountId : '', scopePath: record.path },
    );
  }

  const aad = aadForRecordKeyWrap(productId, accountId, entry.gen, record.path);
  const body = openWrapped(dek, aad, entry, accountId, record);

  if (body.length !== KEY_BYTES) {
    // The tag verified, so these bytes are ours — and they are still the wrong length, which
    // means something wrote a wrap this package did not produce.
    fail(
      'RECORD_KEY_UNWRAP_FAILED',
      `The wrap for account '${accountId}' on record '${record.path}' opened to ` +
        `${body.length} bytes where a record key is ${KEY_BYTES}`,
      { accountId, scopePath: record.path },
    );
  }

  return recordKeyFromBytes(body, record.path);
}

/**
 * Rotation: unwrap under generation N, seal under N+1. **The record key does not change**, so no
 * content is touched and no ciphertext is rewritten — which is what makes a rotation cheap and
 * what makes it *not* a re-key (§9.6).
 *
 * Returns `null` when `wrap.gen === to.generation`. That identity is the skip protocol: an
 * already-rotated record costs one comparison and no write, so a re-run of a rotation walk is
 * free rather than a second full pass.
 *
 * The intermediate record key is exclusively owned by this call and is zeroised before it
 * returns — the plaintext key exists here for the length of one seal and nowhere else.
 */
export function rewrapRecordKey(args: {
  readonly productId: string;
  readonly from: DekHandle;
  readonly to: DekHandle;
  readonly accountId: string;
  readonly record: RecordRef;
  readonly wrap: WrapEntry;
  readonly now?: () => Date;
}): WrapEntry | null {
  const { productId, from, to, accountId, record, wrap, now } = args;
  assertDekHandle(to, 'rewrapRecordKey needs a target DekHandle');

  // The skip comes FIRST, before the source handle is even inspected: a caller sweeping a page of
  // already-rotated records should not have to hold a usable generation-N DEK to discover there
  // is nothing to do.
  const entry = readWrapEntry(wrap);
  if (entry !== null && entry.gen === to.generation) return null;

  const recordKey = unwrapRecordKey({ productId, dek: from, accountId, record, wrap });
  try {
    return wrapRecordKey({ productId, dek: to, accountId, record, recordKey, now });
  } finally {
    zeroise(recordKey);
  }
}

// ---------------------------------------------------------------------------
// The holder predicates
// ---------------------------------------------------------------------------

/**
 * The holders, sorted, and only the ones that are really holders.
 *
 * Sorted because `wrapHolders` is written from this and an unstable order would make an
 * otherwise-identical patch look like a change; filtered because a malformed entry — a raw
 * `{ op: 'delete' }` sentinel that some caller wrote without translating it, say — is not a party
 * that can read anything, and a holder list that counts one is a revoked partner still showing as
 * having access.
 */
export function holdersOf(wraps: KeyWraps | undefined): readonly string[] {
  if (!isReadableObject(wraps)) return [];
  const out: string[] = [];
  for (const key of Object.keys(wraps)) {
    if (readWrapEntry((wraps as Record<string, unknown>)[key]) !== null) out.push(key);
  }
  return out.sort();
}

export function hasWrap(wraps: KeyWraps | undefined, accountId: string): boolean {
  if (!isReadableObject(wraps) || typeof accountId !== 'string' || accountId.length === 0) {
    return false;
  }
  if (!Object.prototype.hasOwnProperty.call(wraps, accountId)) return false;
  return readWrapEntry((wraps as Record<string, unknown>)[accountId]) !== null;
}

export function wrapCount(wraps: KeyWraps | undefined): number {
  return holdersOf(wraps).length;
}

/** The erase predicate — "last man standing". True when this account holds a wrap and is the only
 *  one that does, so removing it takes the wrap set to empty and the record with it. */
export function isLastWrap(wraps: KeyWraps | undefined, accountId: string): boolean {
  return hasWrap(wraps, accountId) && wrapCount(wraps) === 1;
}

/**
 * No wraps remain: nobody can ever be added, and the erase sweep will delete the record.
 *
 * **This is a property of the wrap SET, not of readability.** Two destroyed account keys make a
 * record unreadable while its wrap set is still non-empty — it is unreadable and it is not
 * unreachable, and it must not reach the sweep, because the sweep's job is to delete rows nobody
 * will ever open again and a destroy can be followed by a regenerate. Conflating the two ships a
 * sweep that stops deleting anything the moment a key is destroyed.
 */
export function isUnreachable(wraps: KeyWraps | undefined): boolean {
  return wrapCount(wraps) === 0;
}

// ---------------------------------------------------------------------------
// Reading what the store returned
// ---------------------------------------------------------------------------

/**
 * Tolerant read of whatever the store returned. Drops malformed entries rather than throwing.
 *
 * The split from `assertKeyWraps` is deliberate and is about who is at fault. The store returns
 * whatever is there — a half-written map, a sentinel somebody forgot to translate, a field from a
 * version of this package that no longer exists — and **a single bad entry must not make a
 * readable record unreadable** for every other holder. So the read path parses and the write path
 * asserts.
 *
 * What survives is normalised: `{ gen, wrapped }` plus `at` when it is a non-empty string, frozen,
 * with every other property dropped.
 */
export function parseKeyWraps(value: unknown): KeyWraps {
  const out: Record<string, WrapEntry> = {};
  if (!isReadableObject(value)) return out;
  for (const key of Object.keys(value)) {
    const entry = readWrapEntry(value[key]);
    if (entry !== null) setEntry(out, key, entry);
  }
  return out;
}

/**
 * The strict counterpart, for the write path and for a caller asserting that what it holds really
 * is an access list. Throws `VALIDATION_ERROR` naming the offending accountId — never the wrap
 * ciphertext, and never anything derived from key bytes.
 *
 * Unknown properties on an entry are tolerated, because TypeScript's structural typing tolerates
 * them and an assertion that is stricter than the type it asserts is an assertion callers route
 * around.
 */
export function assertKeyWraps(value: unknown): asserts value is KeyWraps {
  if (!isReadableObject(value)) {
    fail('VALIDATION_ERROR', `A keyWraps map must be an object, received ${typeName(value)}`);
  }
  for (const key of Object.keys(value)) {
    if (key.length === 0) {
      fail('VALIDATION_ERROR', 'A keyWraps map cannot have an empty accountId as a key');
    }
    const entry = value[key];
    if (!isReadableObject(entry)) {
      fail('VALIDATION_ERROR', `The wrap for account '${key}' must be an object, received ${typeName(entry)}`, {
        accountId: key,
      });
    }
    const gen = entry.gen;
    if (typeof gen !== 'number' || !Number.isSafeInteger(gen) || gen <= 0) {
      fail(
        'VALIDATION_ERROR',
        `The wrap for account '${key}' needs a positive safe integer 'gen'; the generation lives ` +
          'on the wrap, and a reader trusts that label to choose which DEK to fetch',
        { accountId: key },
      );
    }
    const wrapped = entry.wrapped;
    if (typeof wrapped !== 'string' || !wrapped.startsWith(WRAP_PREFIX)) {
      fail(
        'VALIDATION_ERROR',
        `The wrap for account '${key}' must be a '${WRAP_PREFIX}' value sealed under that ` +
          "account's DEK",
        { accountId: key, generation: gen },
      );
    }
    if (entry.at !== undefined && typeof entry.at !== 'string') {
      fail('VALIDATION_ERROR', `The wrap for account '${key}' has a non-string 'at'`, {
        accountId: key,
      });
    }
  }
}
