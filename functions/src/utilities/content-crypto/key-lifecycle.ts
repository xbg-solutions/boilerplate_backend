/**
 * **The lifecycle rules, as pure planners over the `KeyStore` port.**
 *
 * The local lifecycle *implementation* is throwaway — collab already has one in production and
 * Accounts will own the real custodian from Phase B — but the lifecycle *rules* are needed again
 * by Accounts, and they are the expensive part to rediscover. So the rules ship and the
 * implementation does not: ten functions that take rows and return a `KeyPatch` or a `Refusal`,
 * with no I/O, no store handle, and no `Date.now()` except through an injected `now`.
 *
 * **`KeyStore` is a port the consumer drives; the planners never call it.** That is what lets
 * collab's custodian suite port against an in-memory store, where every rule becomes an
 * assertion on a returned patch rather than an assertion about a fake database.
 *
 * ── THE FOURTEEN FOOTGUNS ────────────────────────────────────────────────────────────────
 *
 * Each is implemented below with a one-line comment saying what it prevents, and each has a
 * named test. Line references are to `collab.xbg.solutions/functions/src/services/KeyCustodian.ts`
 * as at 2026-09-10, where every one of them was learned:
 *
 *   1  destroy refuses unless the row is already REVOKED                         `:729-735`
 *   2  regenerate mints N+1 BEFORE clearing the tombstone; `destroyedThrough` SURVIVES `:776`
 *   3  a generation row that EXISTS WITHOUT A WRAP is never minted into           `:379-386`
 *   4  a mint NEVER writes revokedAt / revokedCause / destroyedAt / destroyedThrough `:447`
 *   5  revokedCause is STORED, never derived                                      `:611-627`
 *   6  failRotation records the error and leaves the rotation OPEN                `:541-553`
 *   7  status is DERIVED at the wire boundary: destroyed ?? revoked ?? active     `:832`
 *   8  restore refuses with ACCOUNT_KEY_CAUSE_HOLDS while the cause still holds   `:649-655`
 *   9  beginRotation mints N+1, points the account at it, retires N, DELETES NOTHING `:482`
 *  10  drain erases the wrap on every generation <= through, `?? now` on the dates `:575`
 *  11  revoke PRESERVES revokedAt, OVERWRITES revokedCause, may create a keyless row `:622`
 *  12  destroy CLOSES an open rotation                                            `:753`
 *  13  destroy records `destroyedThrough = currentGeneration`                     `:738`
 *  14  EVERY mutating operation evicts that account's cache — as `KeyPatch.evict`
 *
 * ── WHAT THIS FILE DELIBERATELY DOES NOT CARRY ───────────────────────────────────────────
 *
 * - **The deactivation poll.** collab's `isAccountDeactivated` / `revokeIfDeactivated` is
 *   deleted outright: Accounts knows directly and revokes locally. `planRestore` takes
 *   `causeStillHolds` as a boolean and does no I/O. One behaviour of the poll is worth
 *   remembering when Accounts writes the replacement: **a read failure was treated as
 *   not-deactivated**, because a transient outage must not shred a working account's content.
 * - **The mint-outside-the-transaction dance.** A store concern; `KeyPatch.mint` names the
 *   ordering and atomicity lives in `apply`.
 * - **The KMS non-primary inline re-wrap.** A KEK concern, so it goes to Accounts' Phase B.
 */

import { assertNoKeyMaterial, ContentCryptoError } from './errors';
import {
  assertKeyPatch,
  KEY_PATCH_SERVER_TIME,
  refusal,
} from './key-store';
import type { GenerationPatch, GenerationRow, KeyAudit, KeyPatch, KeyPatchValue, KeyRow, Refusal } from './key-store';
import type {
  ContentKeyStatus,
  GenerationStatus,
  KeyStatus,
  OpenRotation,
  RevokedCause,
  RotationProgress,
} from './custodian';

// ---------------------------------------------------------------------------
// Derived status — footgun rule 7
// ---------------------------------------------------------------------------

/**
 * **DERIVED, never stored.** `destroyed ?? revoked ?? active`, in that order, because destruction
 * is the stronger fact and a destroyed key is always also a revoked one (rule 1 makes revocation
 * a precondition of destruction, so the pair always arrives in that order).
 *
 * A stored status would be a second copy of the truth. It drifts the moment one of two writes
 * lands, and the page then shows a healthy account whose content is gone — which is the failure
 * this whole rule exists to make impossible rather than unlikely.
 */
export function deriveStatus(row: Pick<KeyRow, 'revokedAt' | 'destroyedAt'>): KeyStatus {
  if (row.destroyedAt !== null && row.destroyedAt !== undefined) return 'destroyed';
  if (row.revokedAt !== null && row.revokedAt !== undefined) return 'revoked';
  return 'active';
}

/** The row as the wire renders it: every stored field, plus the one derived one. */
export function toContentKeyStatus(row: KeyRow): ContentKeyStatus {
  return Object.freeze({
    accountId: row.accountId,
    productId: row.productId,
    status: deriveStatus(row),
    currentGeneration: row.currentGeneration,
    createdAt: row.createdAt,
    revokedAt: row.revokedAt,
    // Rule 5: the CAUSE is stored and travels; only the STATUS is derived. The tension with
    // rule 7 is the point — a cause is a fact somebody asserted, a status is arithmetic over
    // two dates — and collapsing either into the other is how the restore button starts lying.
    revokedCause: row.revokedCause,
    destroyedAt: row.destroyedAt,
    destroyedThrough: row.destroyedThrough,
    rotation: row.rotation,
  });
}

/** Field for field, plus nothing. `GenerationRow` is already the wire shape; this is the copy
 *  that stops a caller handing a store row straight out and coupling the two. */
export function toGenerationStatus(row: GenerationRow): GenerationStatus {
  return Object.freeze({
    n: row.n,
    kmsKeyVersion: row.kmsKeyVersion,
    hasWrap: row.hasWrap,
    createdAt: row.createdAt,
    retiredAt: row.retiredAt,
    drainedAt: row.drainedAt,
    destroyedAt: row.destroyedAt,
  });
}

// ---------------------------------------------------------------------------
// The rotation error cap — §11.6.1, the third leak path
// ---------------------------------------------------------------------------

/**
 * The cap on `planFailRotation`'s `error` string, **including** the ellipsis it is truncated
 * with. A code is never near it; a body-echoing error usually is.
 */
export const MAX_ROTATION_ERROR_CHARS = 500;

/**
 * The package's own wire grammars, restated.
 *
 * `errors.ts` keeps the same list module-private for `assertNoSecrets` rule 5, and the honest
 * alternative here — routing this string through `assertNoSecrets({ code })` to reuse that
 * table — produces a refusal naming a detail key that does not exist at this call site, which
 * is worse than a three-element list with a test on it. `key-lifecycle.test.ts` asserts all
 * three prefixes are refused, so drift is caught by a test rather than by nobody.
 */
const ENVELOPE_PREFIXES = ['enc:', 'wrap:', 'dev:'];

/**
 * The three RotationProgress keys, as a total map over the interface: adding a field there
 * without adding it here is a compile error, and the deleted `valuesRewritten` /
 * `objectsRewritten` are now unknown keys that `planRecordProgress` refuses — which is the
 * deletion asserted rather than assumed.
 */
const ROTATION_PROGRESS_FIELDS: Readonly<Record<keyof RotationProgress, true>> = Object.freeze({
  recordsRewrapped: true,
  recordsTotal: true,
  conflicted: true,
});

// ---------------------------------------------------------------------------
// Internal: the one place a patch is assembled
// ---------------------------------------------------------------------------

interface Draft {
  readonly action: KeyAudit['action'];
  readonly accountId: string;
  readonly productId: string;
  readonly generation: number | null;
  readonly cause: RevokedCause | null;
  readonly at: string;
  /** The row as it was, or `null` where the planner may face a missing one. */
  readonly before: Pick<KeyRow, 'revokedAt' | 'destroyedAt'> | null;
  readonly key?: Readonly<Record<string, KeyPatchValue>>;
  readonly generations?: readonly GenerationPatch[];
  readonly mint?: { readonly generation: number } | null;
  readonly createIfMissing?: boolean;
}

/**
 * Assemble, derive both statuses from the SAME arithmetic, assert, freeze.
 *
 * `statusAfter` is computed by projecting this patch's own `key` over the row it was handed —
 * never stated by the planner — so an audit entry cannot disagree with what the patch writes.
 * That is the one assertion which would catch the class of bug where a planner clears
 * `revokedAt` and reports `revoked`, and it is cheaper to make impossible than to test for.
 */
function build(draft: Draft): KeyPatch {
  const key = Object.freeze({ ...(draft.key ?? {}) });
  const generations = Object.freeze((draft.generations ?? []).map((g) => Object.freeze({ ...g, set: Object.freeze({ ...g.set }) })));
  const mint = draft.mint ?? null;
  const changed = Object.keys(key).length + generations.length;

  const before = draft.before ?? { revokedAt: null, destroyedAt: null };
  const statusBefore = deriveStatus(before);
  const statusAfter = deriveStatus({
    revokedAt: project(key, 'revokedAt', before.revokedAt),
    destroyedAt: project(key, 'destroyedAt', before.destroyedAt),
  });

  const audit: KeyAudit = Object.freeze({
    action: draft.action,
    accountId: draft.accountId,
    productId: draft.productId,
    generation: draft.generation,
    statusBefore,
    statusAfter,
    cause: draft.cause,
    at: draft.at,
  });

  const patch: KeyPatch = Object.freeze({
    key,
    generations,
    mint,
    createIfMissing: draft.createIfMissing ?? false,
    // Footgun 14, and it is arithmetic rather than a decision: a consumer that wires `apply`
    // and forgets to evict fails invisibly, because everything works and revocations simply
    // never arrive until the TTL expires.
    evict: changed > 0 || mint !== null,
    audit,
    changed,
  });

  // Every planner leaves through here, so a rule broken inside this package throws at the
  // planner rather than at a store three services away.
  assertKeyPatch(patch);
  return patch;
}

/** What this patch leaves in one of the two tombstone fields. */
function project(
  key: Readonly<Record<string, KeyPatchValue>>,
  field: 'revokedAt' | 'destroyedAt',
  current: string | null,
): string | null {
  if (!Object.prototype.hasOwnProperty.call(key, field)) return current;
  const value = key[field];
  if (value === null) return null;
  if (typeof value === 'string') return value;
  // A server-time sentinel on a tombstone field would make the status underivable at plan time,
  // which is exactly the drift rule 7 exists to prevent. No planner writes one; this says so.
  throw new ContentCryptoError(
    'VALIDATION_ERROR',
    `a lifecycle patch may only write an ISO string or null to \`${field}\`; a sentinel there would make the status underivable`,
  );
}

/** `new Date()` reaches this file exactly once, and only when a caller supplied no clock. */
function stamp(now?: () => Date): string {
  const at = (now ?? (() => new Date()))();
  if (!(at instanceof Date) || Number.isNaN(at.getTime())) {
    throw new ContentCryptoError('VALIDATION_ERROR', '`now` must return a valid Date');
  }
  return at.toISOString();
}

/** Open means: there is a rotation and nothing has finished it. A failed rotation is OPEN
 *  (rule 6) — `error` is set and `finishedAt` is not — which is what stops a second rotation
 *  stacking on top of it and stranding a generation. */
function openRotation(row: KeyRow): OpenRotation | null {
  const r = row.rotation;
  if (r === null || r === undefined) return null;
  return r.finishedAt === null || r.finishedAt === undefined ? r : null;
}

function requireRow(row: KeyRow | null | undefined, planner: string): KeyRow {
  if (row === null || row === undefined) {
    throw new ContentCryptoError(
      'VALIDATION_ERROR',
      `${planner} needs a KeyRow. Only planMint and planRevoke can face a missing row; read the row first, and a 404 is the route's answer`,
    );
  }
  return row;
}

// ---------------------------------------------------------------------------
// planMint
// ---------------------------------------------------------------------------

/**
 * Mint the account's current generation, or explain why not.
 *
 * **The target generation is DERIVED, never passed** — `row?.currentGeneration ?? 1`. That is
 * footgun 3's teeth: there is no parameter through which a caller can ask to mint an arbitrary
 * generation, so "mint generation 4 because the read of 4 failed" is not expressible.
 */
export function planMint(args: {
  row: KeyRow | null;
  generationRow: GenerationRow | null;
  accountId: string;
  productId: string;
  now?: () => Date;
}): KeyPatch | Refusal {
  const { row, generationRow } = args;
  const accountId = requireId(args.accountId, 'accountId');
  const productId = requireId(args.productId, 'productId');
  const at = stamp(args.now);

  if (row !== null && row.accountId !== accountId) {
    throw new ContentCryptoError('VALIDATION_ERROR', 'planMint was handed a row belonging to a different account');
  }

  if (row?.destroyedAt) {
    return refusal('ACCOUNT_KEY_DESTROYED', 'this account key was destroyed; regenerate it before minting');
  }
  if (row?.revokedAt) {
    return refusal('ACCOUNT_KEY_REVOKED', 'this account key is revoked; restore it before minting');
  }

  const n = row?.currentGeneration ?? 1;

  if (generationRow !== null) {
    if (generationRow.hasWrap) {
      // Somebody won the race and their key is the one in use. Nothing to write, nothing to
      // evict: loading theirs is the correct outcome, and minting a second key here is how
      // half the values under this generation become permanently unreadable.
      return build({
        action: 'mint',
        accountId,
        productId,
        generation: n,
        cause: row?.revokedCause ?? null,
        at,
        before: row,
      });
    }
    // FOOTGUN 3 — prevents the account looking healthy while everything under this generation
    // became noise. A generation row that exists WITHOUT a wrap was drained or destroyed; only
    // a row that has NEVER existed may be minted into.
    return refusal(
      'ACCOUNT_KEY_DESTROYED',
      `generation ${n} exists with no wrapped key: it was drained or destroyed, and minting into it would make everything already sealed under it unreadable while reporting success`,
    );
  }

  return build({
    action: 'mint',
    accountId,
    productId,
    generation: n,
    cause: null,
    at,
    before: row,
    // FOOTGUN 4 — prevents a mint silently resurrecting a destroyed account as a side effect of
    // its merge. Note what is ABSENT: revokedAt, revokedCause, destroyedAt, destroyedThrough.
    // collab has to carry those forward explicitly because its merge writes a literal map; a
    // patch that omits the keys entirely reaches the same outcome and cannot be got wrong, so
    // the rule is structural here rather than a vigilance requirement.
    key: {
      accountId,
      productId,
      currentGeneration: n,
      createdAt: KEY_PATCH_SERVER_TIME,
    },
    mint: { generation: n },
    createIfMissing: true,
  });
}

// ---------------------------------------------------------------------------
// planRevoke
// ---------------------------------------------------------------------------

/**
 * Revoke. **Never refuses**, which is a deliberate departure from collab.
 *
 * collab throws `ACCOUNT_KEY_DESTROYED` when revoking a destroyed key. Here that is a no-op —
 * the key is already maximally unreadable — and the patch is `changed: 0` with
 * `statusBefore === statusAfter === 'destroyed'`. **Accounts' route turns that pair into its
 * 409**, so the operator is still told. This is the one place the port pushes a decision up to
 * its consumer, and it is named rather than left to be discovered.
 *
 * `accountId` / `productId` are needed only when `row` is null, because a revoke may create a
 * keyless row (rule 11) and an audit entry that cannot say whose key it was is not an audit
 * entry. See the note in `key-lifecycle.test.ts`: the spec's signature omits them and cannot be
 * implemented as written.
 */
export function planRevoke(args: {
  row: KeyRow | null;
  cause: RevokedCause;
  accountId?: string;
  productId?: string;
  now?: () => Date;
}): KeyPatch {
  const { row, cause } = args;
  if (typeof cause !== 'string' || cause.length === 0) {
    throw new ContentCryptoError(
      'VALIDATION_ERROR',
      // Rule 5: the cause is STORED. A revoke with no cause is a restore button that will do
      // nothing later, because the page cannot tell why the key went away.
      'planRevoke needs a RevokedCause: the cause is stored, never derived, and a revoke without one leaves a restore nothing to reason about',
    );
  }
  const at = stamp(args.now);

  const accountId = requireId(args.accountId ?? row?.accountId, 'accountId', 'planRevoke');
  const productId = requireId(args.productId ?? row?.productId, 'productId', 'planRevoke');
  if (row !== null && (args.accountId ?? row.accountId) !== row.accountId) {
    throw new ContentCryptoError('VALIDATION_ERROR', 'planRevoke was handed an accountId that disagrees with the row');
  }
  if (row !== null && (args.productId ?? row.productId) !== row.productId) {
    throw new ContentCryptoError('VALIDATION_ERROR', 'planRevoke was handed a productId that disagrees with the row');
  }

  if (row?.destroyedAt) {
    return build({
      action: 'revoke',
      accountId,
      productId,
      generation: row.currentGeneration,
      cause,
      at,
      before: row,
    });
  }

  if (row === null) {
    // RULE 11, second half — prevents a later first write minting under a revoked account. The
    // row is created carrying the revocation, so `planMint` refuses on the next attempt rather
    // than finding nothing and helpfully starting a fresh key.
    return build({
      action: 'revoke',
      accountId,
      productId,
      generation: 1,
      cause,
      at,
      before: null,
      key: {
        accountId,
        productId,
        currentGeneration: 1,
        createdAt: KEY_PATCH_SERVER_TIME,
        revokedAt: at,
        revokedCause: cause,
      },
      createIfMissing: true,
    });
  }

  return build({
    action: 'revoke',
    accountId,
    productId,
    generation: row.currentGeneration,
    cause,
    at,
    before: row,
    // RULE 11, first half — PRESERVES an existing revokedAt and OVERWRITES the cause. The date
    // is when access actually stopped and re-stamping it would erase that; the cause is the
    // current reason and the newest one is the true one.
    key: { revokedAt: row.revokedAt ?? at, revokedCause: cause },
  });
}

// ---------------------------------------------------------------------------
// planRestore
// ---------------------------------------------------------------------------

/**
 * Un-revoke. Refuses while the cause still holds, which is footgun 8.
 *
 * `causeStillHolds` is consulted **only when `revokedCause === 'account-deactivated'`**, and the
 * narrowness is the rule rather than an optimisation: a sysadmin revoke on an account that
 * happens to be deactivated must still restore, because the sysadmin is the one asking. The
 * planner does no I/O to answer it — Accounts knows locally.
 */
export function planRestore(args: {
  row: KeyRow;
  causeStillHolds: boolean;
  now?: () => Date;
}): KeyPatch | Refusal {
  const row = requireRow(args.row, 'planRestore');
  const at = stamp(args.now);

  if (row.destroyedAt) {
    return refusal(
      'ACCOUNT_KEY_DESTROYED',
      'this account key was destroyed; a restore cannot bring back key material that was erased. Regenerate to start a new generation',
    );
  }

  if (!row.revokedAt) {
    // A no-op restore: nothing to write, and `changed: 0` says so rather than a second return
    // shape a caller has to know about.
    return build({
      action: 'restore',
      accountId: row.accountId,
      productId: row.productId,
      generation: row.currentGeneration,
      cause: row.revokedCause,
      at,
      before: row,
    });
  }

  // FOOTGUN 8 — prevents a button that lies. Restoring while the account is still deactivated
  // puts the key back and the next sweep takes it away again, so the operator presses a control
  // that appears to do nothing.
  if (row.revokedCause === 'account-deactivated' && args.causeStillHolds === true) {
    return refusal(
      'ACCOUNT_KEY_CAUSE_HOLDS',
      'this key was revoked because the account was deactivated, and it still is. Reactivate the account first',
    );
  }

  return build({
    action: 'restore',
    accountId: row.accountId,
    productId: row.productId,
    generation: row.currentGeneration,
    cause: row.revokedCause,
    at,
    before: row,
    key: { revokedAt: null, revokedCause: null },
  });
}

// ---------------------------------------------------------------------------
// planDestroy
// ---------------------------------------------------------------------------

/**
 * Erase the wrapped key material on every generation and tombstone the row. **Irreversible.**
 */
export function planDestroy(args: {
  row: KeyRow;
  generations: readonly GenerationRow[];
  now?: () => Date;
}): KeyPatch | Refusal {
  const row = requireRow(args.row, 'planDestroy');
  const generations = args.generations ?? [];
  const at = stamp(args.now);

  if (row.destroyedAt) {
    return refusal('ACCOUNT_KEY_DESTROYED', 'this account key was already destroyed');
  }

  // FOOTGUN 1 — prevents irreversible erasure one click away from a healthy account. Revoked is
  // the cooling-off: content is already unreadable, and nothing has been erased yet.
  if (!row.revokedAt) {
    return refusal(
      'ACCOUNT_KEY_NOT_REVOKED',
      'revoke this account key before destroying it. A revoke makes the content unreadable and is reversible; a destroy erases the key material and is not',
    );
  }

  const key: Record<string, KeyPatchValue> = {
    destroyedAt: at,
    // RULE 13 — prevents the page being unable to say which material is gone after a later
    // regenerate. `currentGeneration` moves on; this does not.
    destroyedThrough: row.currentGeneration,
  };

  // RULE 12 — prevents a rotation left open over a destroyed key, with nothing left to drain
  // and a progress bar that will never move again.
  if (openRotation(row) !== null) key['rotation.finishedAt'] = at;

  return build({
    action: 'destroy',
    accountId: row.accountId,
    productId: row.productId,
    generation: row.currentGeneration,
    cause: row.revokedCause,
    at,
    before: row,
    key,
    generations: generations.map((g) => ({
      n: g.n,
      // `?? now` on both dates: a generation already retired keeps the date it was retired on,
      // because that date is when it stopped being written to and re-stamping it erases the fact.
      set: { destroyedAt: g.destroyedAt ?? at, retiredAt: g.retiredAt ?? at },
      // Explicit, never inferred from `destroyedAt`: a consumer that inferred it would tombstone
      // the row and leave the key material in it — a destroy that did not destroy.
      eraseWrap: g.hasWrap,
    })),
  });
}

// ---------------------------------------------------------------------------
// planRegenerate
// ---------------------------------------------------------------------------

/**
 * Bring a destroyed account back on a fresh generation. Everything sealed under the destroyed
 * generations stays unreadable for ever; this is a new start, not a recovery.
 */
export function planRegenerate(args: { row: KeyRow; now?: () => Date }): KeyPatch | Refusal {
  const row = requireRow(args.row, 'planRegenerate');
  const at = stamp(args.now);

  if (!row.destroyedAt) {
    return refusal(
      'ACCOUNT_KEY_NOT_DESTROYED',
      'regenerate applies to a destroyed account key. This one is not destroyed — use restore if it is revoked',
    );
  }

  const next = row.currentGeneration + 1;

  return build({
    action: 'regenerate',
    accountId: row.accountId,
    productId: row.productId,
    generation: next,
    cause: row.revokedCause,
    at,
    before: row,
    // FOOTGUN 2 — the mint comes FIRST and the patch's shape says so, which prevents a window
    // in which the account looks healthy while every read serves a generation that is gone.
    mint: { generation: next },
    key: {
      currentGeneration: next,
      destroyedAt: null,
      revokedAt: null,
      revokedCause: null,
      rotation: null,
      // `destroyedThrough` IS NOT HERE, and its absence is the rule (13). It survives, so the
      // page can still say which material was erased after the account came back.
    },
  });
}

// ---------------------------------------------------------------------------
// Rotation
// ---------------------------------------------------------------------------

/**
 * Start a rotation: mint N+1, point the account at it, retire N — **and delete nothing.**
 *
 * The wrap on N stays until the product reports the generation drained, because a value sealed
 * under N that the walk has not reached yet still needs N's key to be read.
 */
export function planBeginRotation(args: { row: KeyRow; now?: () => Date }): KeyPatch | Refusal {
  const row = requireRow(args.row, 'planBeginRotation');
  const at = stamp(args.now);

  if (row.destroyedAt) {
    return refusal('ACCOUNT_KEY_DESTROYED', 'this account key was destroyed; there is nothing to rotate');
  }
  if (row.revokedAt) {
    return refusal('ACCOUNT_KEY_REVOKED', 'this account key is revoked; restore it before rotating');
  }
  // FOOTGUN 9 — prevents stacking a rotation on a running one, which is how a generation gets
  // stranded: the second rotation retires N+1 while the first has not finished draining N.
  const open = openRotation(row);
  if (open !== null) {
    return refusal(
      'ROTATION_IN_PROGRESS',
      `a rotation to generation ${open.generation} is already open${
        open.error ? ' and has recorded an error' : ''
      }; finish or resolve it first`,
    );
  }

  const next = row.currentGeneration + 1;

  return build({
    action: 'beginRotation',
    accountId: row.accountId,
    productId: row.productId,
    generation: next,
    cause: null,
    at,
    before: row,
    mint: { generation: next },
    key: {
      currentGeneration: next,
      'rotation.generation': next,
      'rotation.startedAt': at,
      'rotation.finishedAt': null,
      'rotation.error': null,
      // Zeroed rather than deleted, so the page has three numbers from the first render.
      'rotation.progress.recordsRewrapped': 0,
      'rotation.progress.recordsTotal': 0,
      'rotation.progress.conflicted': 0,
    },
    // Retired, not drained and not erased. `eraseWrap: false` is stated rather than omitted
    // because "erases nothing" is the rule, and a false here is the readable form of it.
    generations: [{ n: row.currentGeneration, set: { retiredAt: at }, eraseWrap: false }],
  });
}

/**
 * Record how far a rotation has got. The only planner with nothing to say about status, and the
 * only one whose refusals are all caller mistakes.
 */
export function planRecordProgress(args: {
  row: KeyRow;
  progress: Partial<RotationProgress>;
  now?: () => Date;
}): KeyPatch | Refusal {
  const row = requireRow(args.row, 'planRecordProgress');
  const at = stamp(args.now);
  const open = openRotation(row);
  if (open === null) {
    return refusal('VALIDATION_ERROR', 'there is no open rotation on this account key to record progress against');
  }

  const progress = args.progress ?? {};
  if (typeof progress !== 'object' || progress === null || Array.isArray(progress)) {
    return refusal('VALIDATION_ERROR', 'progress must be a partial RotationProgress');
  }

  const key: Record<string, KeyPatchValue> = {};
  for (const field of Object.keys(progress)) {
    if (!Object.prototype.hasOwnProperty.call(ROTATION_PROGRESS_FIELDS, field)) {
      return refusal(
        'VALIDATION_ERROR',
        `\`${field}\` is not a RotationProgress field. A rotation rewraps and touches no content, so the ones it may report are ${Object.keys(
          ROTATION_PROGRESS_FIELDS,
        ).join(', ')}`,
      );
    }
    const value = (progress as Record<string, unknown>)[field];
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
      return refusal('VALIDATION_ERROR', `progress.${field} must be a non-negative integer`);
    }
    // Dotted, because it must MERGE into the running rotation. A whole-map write here would
    // clobber `startedAt` and the page would lose the one number that says how long this has
    // been going.
    key[`rotation.progress.${field}`] = value;
  }

  return build({
    action: 'recordProgress',
    accountId: row.accountId,
    productId: row.productId,
    generation: open.generation,
    cause: row.revokedCause,
    at,
    before: row,
    key,
  });
}

/**
 * Record that a rotation failed, and **leave it open** (footgun 6).
 *
 * ── HAND THIS A CODE, NEVER A CAUGHT ERROR'S MESSAGE. ────────────────────────────────────
 *
 * `error` is stored on `rotation.error`, `toContentKeyStatus` puts it on the wire, and Accounts'
 * sysadmin page renders it. The natural caller is
 * `catch (e) { failRotation(accountId, (e as Error).message) }` — and an upstream message is
 * exactly the string that may quote a plaintext DEK, arriving somewhere **more durable than a
 * log**. `ContentCryptoError.code` is the intended value.
 *
 * Three things stand between that habit and a leak, in the order they bite: this paragraph; the
 * cap at `MAX_ROTATION_ERROR_CHARS`, because a body-echoing error is long and a code is not; and
 * the scan below, which refuses key material in any of its spellings and refuses sealed material
 * outright — ciphertext has no business in a status field.
 */
export function planFailRotation(args: {
  row: KeyRow;
  error: string;
  now?: () => Date;
}): KeyPatch | Refusal {
  const row = requireRow(args.row, 'planFailRotation');
  const at = stamp(args.now);
  const open = openRotation(row);
  if (open === null) {
    return refusal('VALIDATION_ERROR', 'there is no open rotation on this account key to fail');
  }

  const capped = capRotationError(args.error);

  return build({
    action: 'failRotation',
    accountId: row.accountId,
    productId: row.productId,
    generation: open.generation,
    cause: row.revokedCause,
    at,
    before: row,
    // FOOTGUN 6 — the rotation stays OPEN. There is no `rotation.finishedAt` here, and its
    // absence prevents a second rotation stacking on a failed one, which is how a generation
    // gets stranded: N+1 becomes current, N is never drained, and nothing says so.
    key: { 'rotation.error': capped },
  });
}

/** Cap, then scan. Both, in that order, so a 50 kB body is not walked before it is refused. */
function capRotationError(error: string): string {
  if (typeof error !== 'string' || error.trim().length === 0) {
    throw new ContentCryptoError(
      'VALIDATION_ERROR',
      'planFailRotation needs a non-empty error string. Hand it a code — `ContentCryptoError.code` is the intended value — never the message of a caught error',
    );
  }

  const capped =
    error.length > MAX_ROTATION_ERROR_CHARS ? `${error.slice(0, MAX_ROTATION_ERROR_CHARS - 1)}…` : error;

  // Every spelling of 32 bytes, over the value itself.
  assertNoKeyMaterial(capped, 'the rotation error string');

  for (const prefix of ENVELOPE_PREFIXES) {
    if (capped.slice(0, prefix.length) === prefix) {
      throw new ContentCryptoError(
        'VALIDATION_ERROR',
        `planFailRotation will not store sealed material on rotation.error (it begins \`${prefix}\`). Hand it a code, never a value`,
      );
    }
  }

  return capped;
}

/** Close a rotation, successfully. Clears the error, because a finished rotation that still
 *  shows one is a page nobody trusts. */
export function planFinishRotation(args: { row: KeyRow; now?: () => Date }): KeyPatch | Refusal {
  const row = requireRow(args.row, 'planFinishRotation');
  const at = stamp(args.now);
  const open = openRotation(row);
  if (open === null) {
    return refusal('VALIDATION_ERROR', 'there is no open rotation on this account key to finish');
  }

  return build({
    action: 'finishRotation',
    accountId: row.accountId,
    productId: row.productId,
    generation: open.generation,
    cause: row.revokedCause,
    at,
    before: row,
    key: { 'rotation.finishedAt': at, 'rotation.error': null },
  });
}

// ---------------------------------------------------------------------------
// planDrain
// ---------------------------------------------------------------------------

/**
 * The product reports that everything sealed under generations up to and including `through` has
 * been rewrapped, so those wraps may go.
 *
 * **`through` is INCLUSIVE, and the boundary is not decoration.** collab's
 * `drainGenerationsBelow(accountId, generation)` drains everything *below* its argument; this
 * drains everything *up to and including* `through`. An off-by-one in an operation that erases
 * wraps is unrecoverable, so the boundary is stated in the name, here, and in a refusal: **you
 * may never drain the current generation.**
 *
 * The reporter is singular — one key per account per product — so there is no "wait for every
 * product using it" coordination to get wrong.
 */
export function planDrain(args: {
  row: KeyRow;
  generations: readonly GenerationRow[];
  through: number;
  now?: () => Date;
}): KeyPatch | Refusal {
  const row = requireRow(args.row, 'planDrain');
  const generations = args.generations ?? [];
  const at = stamp(args.now);
  const { through } = args;

  if (!Number.isInteger(through) || through < 1) {
    return refusal('VALIDATION_ERROR', '`through` must be a positive integer generation number');
  }
  if (through >= row.currentGeneration) {
    return refusal(
      'VALIDATION_ERROR',
      `\`through\` is ${through} and the current generation is ${row.currentGeneration}. Draining the current generation would erase the wrap the write path is using; \`through\` is INCLUSIVE and must be below it`,
    );
  }

  // RULE 10 — idempotent by construction. A generation with nothing left to do contributes no
  // patch at all, so a re-report is `changed: 0` rather than a second write of the same dates;
  // and `?? now` on the two dates means a re-report never rewrites history.
  const patches: GenerationPatch[] = [];
  for (const g of generations) {
    if (g.n > through) continue;
    if (!g.hasWrap && g.drainedAt !== null && g.retiredAt !== null) continue;
    patches.push({
      n: g.n,
      set: { drainedAt: g.drainedAt ?? at, retiredAt: g.retiredAt ?? at },
      eraseWrap: g.hasWrap,
    });
  }

  return build({
    action: 'drain',
    accountId: row.accountId,
    productId: row.productId,
    generation: through,
    cause: row.revokedCause,
    at,
    before: row,
    generations: patches,
  });
}

// ---------------------------------------------------------------------------

function requireId(value: string | undefined, what: string, planner = 'this planner'): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ContentCryptoError(
      'VALIDATION_ERROR',
      `${planner} needs ${what}: an audit entry that cannot say whose key it was is not an audit entry`,
    );
  }
  return value;
}
