/**
 * **The ONE reconcile.**
 *
 * `planWraps(current, desired)` is the only wrap operation there is. Grant, un-share, transfer,
 * rotate and erase are not five functions and not a verb parameter — they are five shapes of one
 * question, *who should hold a wrap on this record, and under which generation*, answered by set
 * arithmetic:
 *
 *   grant     set + B                       rotate  the same set, each at generation N+1
 *   un-share  set − B                       erase   the empty set
 *   transfer  set − A + B, in ONE patch
 *
 * Two of those are properties rather than conveniences, and both are why the verbs are gone:
 *
 * - **A transfer is one patch.** Composed as grant-then-remove there is a window in which both
 *   accounts hold wraps, and a failure between the halves leaves the record silently shared with
 *   nobody to report it, because both halves succeeded as far as either could see. One patch, one
 *   commit, no window.
 * - **The audit payload IS the diff.** The reconcile has to compute `added` / `removed` /
 *   `rewrapped` to build `update` at all, so publishing them costs nothing and the audit entry
 *   cannot disagree with what was written. A `verb` field can, and does, the moment somebody
 *   reuses a verb for a slightly different purpose.
 *
 * What this module does **not** do: delete rows. `deleteRecord` is a signal to the product's own
 * ordered delete path, and at aggregate granularity what that path deletes is the whole aggregate
 * rather than one document.
 */

import type { DekHandle } from './custodian';
import { ContentCryptoError, assertNoKeyMaterial } from './errors';
import type { ContentCryptoCode, ErrorDetails } from './errors';
import type { RecordGranularity } from './key-scope';
import {
  KEY_WRAPS_FIELD,
  WRAP_HOLDERS_FIELD,
  parseKeyWraps,
  wrapRecordKey,
} from './record-key';
import type { KeyWraps, RecordRef, WrapEntry } from './record-key';
import { isSecret } from './secret';
import type { RecordKey } from './secret';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Why a wrap was granted. A grant needs a *scope*, not a boolean: the choice is made rather than
 *  assumed, and it lands in the audit payload where somebody can be asked about it later. */
export type GrantScope = 'this-record' | 'this-record-and-history' | 'this-engagement';

/**
 * `null`: nobody was cut off. `'wrap-only'`: a party's path to OBTAIN the key was removed; if they
 * had already captured it they can still decrypt.
 *
 * **There is no `'complete'`.** A true cut-off needs a new record key and a content re-key, which
 * this function neither performs nor can detect — the difference between a rotate and a re-key is
 * whether the caller ran a content walk, and no signature can see that. The consequence is a
 * standing obligation on every operator UI: a wrap removal must not be labelled "Revoke access".
 */
export type CutOff = null | 'wrap-only';

/** accountId → the `DekHandle` whose generation that account's wrap should sit at. Handles rather
 *  than bare ids is what makes "rotate = the same set at N+1" expressible at all. */
export type DesiredWraps = Readonly<Record<string, DekHandle>>;

/** The diff. **This IS the audit payload.** */
export interface WrapDiff {
  readonly added: readonly string[];
  readonly removed: readonly string[];
  /** Held before and after, at a DIFFERENT generation. */
  readonly rewrapped: readonly string[];
  /** Held at the SAME generation — no write, which is the whole idempotency contract. */
  readonly unchanged: readonly string[];
}

export interface WrapAudit {
  readonly productId: string;
  /** `.path` is the scopePath every wrap AAD on this record bound. */
  readonly record: RecordRef;
  readonly granularity: RecordGranularity;
  readonly actorAccountId: string;
  /** Non-null exactly when `added` is non-empty. */
  readonly scope: GrantScope | null;
  readonly cutOff: CutOff;
  readonly diff: WrapDiff;
  readonly holdersBefore: readonly string[];
  readonly holdersAfter: readonly string[];
  readonly at: string;
}

/**
 * Everything a `WrapPatch.update` can hold. **Not** `ContentKeyPatchValue`: a wrap patch never emits a
 * server timestamp, and a union wider than the truth makes `materialiseWrapPatch` partial for no
 * reason.
 */
export type WrapPatchValue = WrapEntry | readonly string[] | { readonly op: 'delete' };

export interface WrapPatch {
  /**
   * Dotted `keyWraps.{accountId}` keys plus `wrapHolders`, and NOTHING else. A removal is the
   * `{ op: 'delete' }` sentinel — plain data, assertable and loggable, the same choice
   * `ContentKeyPatchValue` makes.
   *
   * **DO NOT WRITE THIS YOURSELF.** It must be translated, and since R13 the translator is
   * internal: apply a patch through `applyWrapPatch` (one record) or `runWrapJob` (a set), both in
   * `./walk`, which materialise it through the `WriteSink`'s own `deleteField`. The sink already
   * carries the store's sentinel, which is the thing a caller was previously asked to supply.
   *
   * What a raw write costs, stated accurately: the literal map lands at `keyWraps.{accountId}`,
   * the tolerant parser drops it on read, so the account is NOT a holder and `wrapHolders` is
   * right too — a plain array writes correctly raw. The exposure is the raw key map: anything
   * reading `Object.keys(keyWraps)` rather than `holdersOf()` sees a ghost holder. And it is not
   * permanent — `planWraps` diffs on RAW keys, so the next reconcile on that record removes it.
   */
  readonly update: Readonly<Record<string, WrapPatchValue>>;
  /** Wraps added, removed or rewrapped. `0` ⟹ `update` is `{}` ⟹ do not write. */
  readonly changed: number;
  /** The resulting set. */
  readonly wraps: KeyWraps;
  readonly diff: WrapDiff;
  readonly holdersBefore: readonly string[];
  readonly holdersAfter: readonly string[];
  /** TRUE iff `holdersAfter` is empty. **THE erase signal**: the product's sweep deletes the
   *  record — and at aggregate granularity what it deletes is the whole aggregate. "Last man
   *  standing" stops being a special case in the caller: it is one boolean on the one patch. */
  readonly deleteRecord: boolean;
  /** Derived: `'wrap-only'` when anything was removed, else `null`. */
  readonly cutOff: CutOff;
  readonly audit: WrapAudit;
}

/**
 * `'skip'` ONLY for a pure rewrap (added and removed both empty): a precondition failure there
 * means the live writer already wrapped at the current generation, so there is nothing to redo.
 *
 * Everything else is `'retry'`, because a conflict means nobody else is applying *this* change and
 * dropping it would **silently drop a revocation**. The default is the safe one and the dangerous
 * one is derived — never the other way round.
 */
export type ConflictPolicy = 'skip' | 'retry';

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function fail(code: ContentCryptoCode, message: string, details?: ErrorDetails): never {
  throw new ContentCryptoError(code, message, details);
}

function typeName(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  return `a ${typeof value}`;
}

function isReadableObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Create a data property whatever the key is. An accountId is a store-supplied string, and
 * `out['__proto__'] = value` on an ordinary object invokes the prototype setter instead of
 * creating a key — which would silently drop a holder and reshape the object at the same time.
 * (`Object.fromEntries` would do the same job and is ES2019; the tree targets es2017.)
 */
function setEntry<T>(out: Record<string, T>, key: string, value: T): void {
  Object.defineProperty(out, key, { value, enumerable: true, writable: true, configurable: true });
}

const GRANT_SCOPES: readonly GrantScope[] = [
  'this-record',
  'this-record-and-history',
  'this-engagement',
];

/**
 * An accountId that can safely be the tail of a dotted `keyWraps.{accountId}` key.
 *
 * `.` is refused because the update key is dotted by construction (`WrapPatch.update`'s own
 * contract), so an accountId carrying one addresses a nested map instead of a holder — a wrap
 * written somewhere nobody will look for it. `/` is refused for the same reason the wrap AAD
 * refuses it: every component after it would shift, and the form would stop parsing to one tuple.
 */
function assertAccountId(accountId: string): void {
  if (typeof accountId !== 'string' || accountId.length === 0) {
    fail('VALIDATION_ERROR', `A wrap holder id must be a non-empty string, received ${typeName(accountId)}`);
  }
  if (accountId.includes('.') || accountId.includes('/')) {
    fail(
      'VALIDATION_ERROR',
      `The wrap holder id '${accountId}' cannot contain '.' or '/': the patch addresses each wrap ` +
        `as '${KEY_WRAPS_FIELD}.{accountId}', and either character makes that key mean something ` +
        'other than one holder',
      { accountId },
    );
  }
}

function assertDekHandle(dek: unknown, accountId: string): asserts dek is DekHandle {
  if (!isReadableObject(dek)) {
    fail('VALIDATION_ERROR', `The desired wrap for account '${accountId}' must be a DekHandle, received ${typeName(dek)}`, {
      accountId,
    });
  }
  const generation = dek.generation;
  if (typeof generation !== 'number' || !Number.isSafeInteger(generation) || generation <= 0) {
    fail(
      'VALIDATION_ERROR',
      `The desired wrap for account '${accountId}' needs a positive safe integer generation, ` +
        `received ${String(generation)}`,
      { accountId },
    );
  }
  // Validated even for a holder that turns out to be `unchanged`: comparing a stored `gen` against
  // a missing `generation` would quietly answer "unchanged" and skip the rewrap the caller asked
  // for, which is a rotation that reports success having done nothing.
  if (!isSecret(dek.key) || dek.key.kind !== 'dek') {
    fail(
      'VALIDATION_ERROR',
      `The desired wrap for account '${accountId}' needs an account DEK handle; a record key ` +
        'cannot wrap a record key',
      { accountId },
    );
  }
}

function assertRecordKey(recordKey: unknown): asserts recordKey is RecordKey {
  if (!isSecret(recordKey) || recordKey.kind !== 'record-key') {
    fail(
      'VALIDATION_ERROR',
      `planWraps needs the open record key, received ${typeName(recordKey)}. It is pure and ` +
        'synchronous precisely because the caller has already unwrapped it',
    );
  }
}

// ---------------------------------------------------------------------------
// The sentinel
// ---------------------------------------------------------------------------

/** The one removal sentinel. Frozen and shared, so identity works as a fast path — but the shape
 *  check below is the real test, because a patch may have crossed a queue and been re-parsed. */
const DELETE_SENTINEL: { readonly op: 'delete' } = Object.freeze({ op: 'delete' as const });

function isDeleteSentinel(value: unknown): value is { readonly op: 'delete' } {
  if (value === DELETE_SENTINEL) return true;
  return isReadableObject(value) && value.op === 'delete';
}

/**
 * Translate a `WrapPatch` into what the product's store writes. The one sentinel a wrap patch can
 * carry becomes the store's own delete sentinel; every other value passes through by reference.
 *
 * **INTERNAL since R13, and off the barrel.** It has exactly one call site — `runWrapJob`, which
 * `applyWrapPatch` also routes through — so "a wrap write that skipped the translation" is not a
 * shape a consumer can produce rather than one a reviewer has to look for. It was exported before
 * on the reasoning that a consumer outside `runWrapJob` would need it, and that reasoning did not
 * survive: the caller who writes the sentinel raw is precisely the caller who does not know a
 * materialiser exists, so the export helped only whoever already knew to look for it. The gap it
 * was excusing — the single-record apply — is now a door of its own.
 *
 * Kept exported from this MODULE because `walk.ts` calls it and `wrap-patch.test.ts` asserts it
 * directly; the gate that matters is `check-mirror.js` assertion (7), which refuses it on the
 * barrel.
 */
export function materialiseWrapPatch(
  patch: WrapPatch,
  sentinels: { readonly deleteField: unknown },
): Record<string, unknown> {
  if (!isReadableObject(patch) || !isReadableObject(patch.update)) {
    fail('VALIDATION_ERROR', `materialiseWrapPatch needs a WrapPatch, received ${typeName(patch)}`);
  }
  if (!isReadableObject(sentinels) || sentinels.deleteField === undefined) {
    fail(
      'VALIDATION_ERROR',
      "materialiseWrapPatch needs the store's own delete sentinel as `deleteField`. Without one a " +
        'removal would be written as a literal map, and a revocation that half-works is worse ' +
        'than one that fails',
    );
  }
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(patch.update)) {
    const value = patch.update[key];
    setEntry(out, key, isDeleteSentinel(value) ? sentinels.deleteField : value);
  }
  return out;
}

// ---------------------------------------------------------------------------
// The reconcile
// ---------------------------------------------------------------------------

/**
 * The ONE reconcile. Pure and synchronous — the caller has already unwrapped `recordKey`, which is
 * what keeps a session free of I/O.
 *
 * `current` is read tolerantly: a holder whose stored entry is malformed is not a holder, but its
 * key is still **in the map**, so it is removed rather than left behind. That is the only way a
 * `{ op: 'delete' }` somebody wrote without translating it ever leaves the store.
 *
 * Throws `VALIDATION_ERROR` when `diff.added` is non-empty and `scope` is absent: a grant needs a
 * scope, not a boolean.
 */
export function planWraps(args: {
  readonly current: KeyWraps;
  readonly desired: DesiredWraps;
  readonly recordKey: RecordKey;
  readonly productId: string;
  readonly record: RecordRef;
  readonly granularity: RecordGranularity;
  readonly actorAccountId: string;
  readonly scope?: GrantScope;
  readonly now?: () => Date;
}): WrapPatch {
  const { current, desired, recordKey, productId, record, granularity, actorAccountId, scope, now } =
    args;

  assertRecordKey(recordKey);
  if (typeof productId !== 'string' || productId.length === 0) {
    fail('VALIDATION_ERROR', `planWraps needs a productId, received ${typeName(productId)}`);
  }
  // The ref's full shape is `assertRecord`'s business in key-scope.ts; what this needs is that the
  // three components the audit and every wrap AAD read are really there, because an erase plans no
  // wraps at all and would otherwise put an unvalidated ref into the audit entry.
  if (
    !isReadableObject(record) ||
    typeof record.type !== 'string' ||
    typeof record.id !== 'string' ||
    typeof record.path !== 'string' ||
    record.path.length === 0
  ) {
    fail(
      'VALIDATION_ERROR',
      'planWraps needs a record ref with a non-empty path: the path is the scopePath every wrap ' +
        'AAD on this record binds, and it is what the audit entry names',
    );
  }
  if (typeof actorAccountId !== 'string' || actorAccountId.length === 0) {
    fail(
      'VALIDATION_ERROR',
      'planWraps needs an actorAccountId: an audit entry that cannot say who acted is not an audit entry',
    );
  }
  if (desired !== undefined && !isReadableObject(desired)) {
    fail('VALIDATION_ERROR', `planWraps needs a desired map, received ${typeName(desired)}`);
  }
  if (scope !== undefined && !GRANT_SCOPES.includes(scope)) {
    fail('VALIDATION_ERROR', `Unknown grant scope '${String(scope)}'`);
  }

  const before = parseKeyWraps(current);
  const rawKeys = isReadableObject(current) ? Object.keys(current) : [];
  const desiredKeys = isReadableObject(desired) ? Object.keys(desired) : [];

  for (const accountId of desiredKeys) {
    assertAccountId(accountId);
    assertDekHandle(desired[accountId], accountId);
  }
  // The same rule on the way out. A holder this patch cannot address as `keyWraps.{accountId}` is
  // one it cannot remove either, and silently leaving it behind would break the property the whole
  // reconcile rests on: applying the update produces the wraps the patch claims.
  for (const accountId of rawKeys) assertAccountId(accountId);

  const holdersBefore = Object.keys(before).sort();
  const holdersAfter = desiredKeys.slice().sort();
  const wanted = new Set(desiredKeys);

  const added: string[] = [];
  const rewrapped: string[] = [];
  const unchanged: string[] = [];
  const unchangedSet = new Set<string>();
  for (const accountId of holdersAfter) {
    const entry = Object.prototype.hasOwnProperty.call(before, accountId)
      ? before[accountId]
      : undefined;
    if (entry === undefined) {
      added.push(accountId);
    } else if (entry.gen === desired[accountId].generation) {
      unchanged.push(accountId);
      unchangedSet.add(accountId);
    } else {
      rewrapped.push(accountId);
    }
  }

  // RAW keys, not holders: an entry we could not parse is still an entry in the map, and leaving
  // it behind is how a half-written revocation survives every later reconcile.
  const removed = rawKeys.filter((accountId) => !wanted.has(accountId)).sort();

  if (added.length > 0 && scope === undefined) {
    fail(
      'VALIDATION_ERROR',
      `Granting a wrap to ${added.length === 1 ? `account '${added[0]}'` : `${added.length} accounts`} ` +
        'needs a scope. A grant is a decision about how far access reaches, and a boolean cannot ' +
        'carry it into the audit entry',
      { accountId: added.length === 1 ? added[0] : '' },
    );
  }

  const stamp = (now ? now() : new Date()).toISOString();
  const update: Record<string, WrapPatchValue> = {};
  const wraps: Record<string, WrapEntry> = {};

  for (const accountId of holdersAfter) {
    if (unchangedSet.has(accountId)) {
      // No write. The stored wrap already sits at the desired generation, and rewriting it would
      // make an idempotent reconcile look like a change to everything downstream of the patch.
      setEntry(wraps, accountId, before[accountId]);
      continue;
    }
    const entry = wrapRecordKey({
      productId,
      dek: desired[accountId],
      accountId,
      record,
      recordKey,
      now: () => new Date(stamp),
    });
    setEntry(wraps, accountId, entry);
    setEntry(update, `${KEY_WRAPS_FIELD}.${accountId}`, entry);
  }

  for (const accountId of removed) {
    setEntry(update, `${KEY_WRAPS_FIELD}.${accountId}`, DELETE_SENTINEL);
  }

  const changed = added.length + removed.length + rewrapped.length;
  if (changed > 0) {
    // Both fields, atomically, in one update: the holders mirror is the only thing that makes the
    // holder-scoped walk and the erase sweep queryable, and the patch is the only thing that knows
    // the after-set.
    update[WRAP_HOLDERS_FIELD] = Object.freeze(holdersAfter.slice());
  }

  const diff: WrapDiff = Object.freeze({
    added: Object.freeze(added),
    removed: Object.freeze(removed),
    rewrapped: Object.freeze(rewrapped),
    unchanged: Object.freeze(unchanged),
  });
  const cutOff: CutOff = removed.length > 0 ? 'wrap-only' : null;
  const frozenBefore = Object.freeze(holdersBefore);
  const frozenAfter = Object.freeze(holdersAfter);

  const audit: WrapAudit = Object.freeze({
    productId,
    record,
    granularity,
    actorAccountId,
    // Non-null EXACTLY when something was added. A scope passed on a revoke is not a grant scope
    // and must not be recorded as though a grant happened.
    scope: added.length > 0 && scope !== undefined ? scope : null,
    cutOff,
    diff,
    holdersBefore: frozenBefore,
    holdersAfter: frozenAfter,
    at: stamp,
  });

  // The STANDING guard, and the reason it is here rather than in a test. `assertNoSecrets` cannot
  // do this job: it polices an error-DETAILS bag — one level, a closed 18-key allowlist, scalars —
  // and running a structured audit payload through it is a category error, so widening that
  // allowlist to admit an audit would defeat the thing it exists to do. This asks the other
  // question, recursively and over values: never mind the shape, are there key bytes in here.
  //
  // Both of these leave this function and are logged. `audit` is what a product writes to its
  // audit trail; `update` is what it writes to its store, and `materialiseWrapPatch` only
  // substitutes the delete sentinel, so whatever is in here is what lands. A sweep in a test
  // proves the tree was clean the day somebody ran it — this is what makes adding a field to
  // `WrapAudit` fail on the spot instead.
  assertNoKeyMaterial(audit, 'WrapAudit');
  assertNoKeyMaterial(update, 'WrapPatch.update');

  return Object.freeze({
    update: Object.freeze(changed > 0 ? update : {}),
    changed,
    wraps: Object.freeze(wraps),
    diff,
    holdersBefore: frozenBefore,
    holdersAfter: frozenAfter,
    deleteRecord: holdersAfter.length === 0,
    cutOff,
    audit,
  });
}

/**
 * `'skip'` for a pure rewrap, `'retry'` for everything else — including a patch that changes
 * nothing, because the cost of a redundant retry is a wasted read and the cost of a wrong skip is
 * a revocation that never happened.
 */
export function conflictPolicyFor(patch: WrapPatch): ConflictPolicy {
  if (!isReadableObject(patch) || !isReadableObject(patch.diff)) {
    fail('VALIDATION_ERROR', `conflictPolicyFor needs a WrapPatch, received ${typeName(patch)}`);
  }
  if (!Array.isArray(patch.diff.added) || !Array.isArray(patch.diff.removed)) {
    fail('VALIDATION_ERROR', 'conflictPolicyFor needs a WrapPatch carrying its diff');
  }
  return patch.diff.added.length === 0 && patch.diff.removed.length === 0 ? 'skip' : 'retry';
}
