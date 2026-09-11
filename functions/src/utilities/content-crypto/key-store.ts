/**
 * **The `ContentKeyStore` port** — types and sentinels, and nothing that does anything.
 *
 * Accounts and collab implement this against different paths, a different key name and
 * different auth. None of those three appears below, which is what makes it a port rather than
 * an abstract Firestore. Accounts' `accounts/{id}/contentKeys/{productId}` and collab's
 * `collab-projects/accountKeys/{id}` are the same port; so is anything else, because the port
 * cannot see a path.
 *
 * Five properties, each earning its place:
 *
 * 1. **Row-shaped, never path-shaped.** Paths, collection names, database ids, the KMS key name
 *    and the auth mechanism sit entirely behind `readKey`/`apply`.
 * 2. **ISO strings at the boundary.** No `Timestamp` class crosses it, which lines the port up
 *    with the workspace rule *serialise timestamps at the API* and deletes the adapter pair a
 *    `Timestamp`-shaped port would have needed at both ends.
 * 3. **`GenerationRow` exposes `hasWrap`, never `wrappedDek`.** The package never sees wrapped
 *    key material, let alone a KEK. **This is the checkable form of "no local custodian"** —
 *    stronger than "no Firestore import", because a port *could* have carried the wrap and
 *    would then have needed to know how to unwrap it.
 * 4. **Sentinels are plain data**, so a patch compares with `toEqual`, survives
 *    `JSON.parse(JSON.stringify(patch))` unchanged, and logs without a redactor.
 * 5. **`mint` is an instruction, not an action.** The mint itself — random bytes, the KEK wrap,
 *    the transaction that decides the winner of a race — is the consumer's, because the KEK is.
 *
 * The rules that drive this port live in `key-lifecycle.ts` and are pure: they never call it.
 * That is what lets a lifecycle suite run against an in-memory store where every rule is an
 * assertion on a returned patch — a better test than a store fake, not a worse one.
 */

import { assertNoKeyMaterial, ContentCryptoError } from './errors';
import type { ContentCryptoCode } from './errors';
import type { ContentKeyState, OpenRotation, RevokedCause } from './custodian';

// ---------------------------------------------------------------------------
// Patch values and the two sentinels
// ---------------------------------------------------------------------------

/**
 * A patch value a PURE planner can name without importing a cloud SDK.
 *
 * The alternative — and it is what v1 did — is to inject a `deleteField: () => FieldValue.delete()`
 * callback and let the planner call it. A patch containing a closure is neither assertable nor
 * loggable: `toEqual` cannot compare it, `JSON.stringify` drops it, and the thing a consumer
 * writes to its store is then something no test ever saw. Plain JSON is both assertable and
 * loggable, and it deletes a glue line from every consumer.
 */
export type ContentKeyPatchValue =
  | string
  | number
  | boolean
  | null
  | { readonly op: 'delete' } // the consumer maps this to its own delete sentinel
  | { readonly op: 'serverTime' }; // and this to its own server timestamp

/**
 * Frozen, because a mutated sentinel is a sentinel that stops comparing equal — and every
 * consumer's `apply` recognises these by value, not by identity, since a patch may have crossed
 * a JSON boundary (a Cloud Tasks payload, a log, a test fixture) before it arrives.
 */
export const KEY_PATCH_DELETE: ContentKeyPatchValue = Object.freeze({ op: 'delete' as const });
export const KEY_PATCH_SERVER_TIME: ContentKeyPatchValue = Object.freeze({ op: 'serverTime' as const });

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

/**
 * The account's content key, as one row. **Timestamps cross this boundary as ISO-8601 STRINGS.**
 *
 * There is no `status` field and there never will be: status is DERIVED from `revokedAt` and
 * `destroyedAt` at the wire boundary (`deriveStatus`, footgun rule 7). A stored status is a
 * second copy of the truth that drifts from the timestamps the moment one write lands and the
 * other does not. `revokedCause` goes the other way and IS stored (rule 5), and the tension
 * between the two is the point rather than an inconsistency: the cause is a fact somebody
 * asserted, the status is arithmetic over two dates.
 */
export interface ContentKeyRow {
  readonly accountId: string;
  readonly productId: string;
  readonly currentGeneration: number;
  readonly createdAt: string | null;
  readonly revokedAt: string | null;
  readonly revokedCause: RevokedCause | null;
  readonly destroyedAt: string | null;
  /**
   * The generation the destroy covered. It **survives a regenerate** (rule 13), which is what
   * lets a sysadmin page say which material is gone after the account has been brought back.
   */
  readonly destroyedThrough: number | null;
  readonly rotation: OpenRotation | null;
}

export interface GenerationRow {
  readonly n: number;
  /** Whether a wrap is PRESENT. **Never the wrap itself** — see property 3 above. */
  readonly hasWrap: boolean;
  readonly kmsKeyVersion: string | null;
  readonly createdAt: string | null;
  readonly retiredAt: string | null;
  readonly drainedAt: string | null;
  readonly destroyedAt: string | null;
}

// ---------------------------------------------------------------------------
// Patches
// ---------------------------------------------------------------------------

export interface GenerationPatch {
  readonly n: number;
  readonly set: Readonly<Record<string, ContentKeyPatchValue>>;
  /**
   * Erase the wrapped key material on this generation row, whatever the store calls it. TRUE
   * only where the row currently `hasWrap`, so a re-applied patch writes nothing.
   *
   * A flag rather than a `wrappedDek: KEY_PATCH_DELETE` entry in `set`, because naming the field
   * would put the storage field name back into the port through the write side — and because it
   * has to be EXPLICIT rather than inferred from `destroyedAt`: a consumer that forgot the
   * inference would tombstone the row and leave the key material sitting in it, which is a
   * destroy that did not destroy while reporting success.
   */
  readonly eraseWrap: boolean;
}

/**
 * What an operator action did to the store.
 *
 * **The audit payload is part of the patch**, so an audit entry cannot disagree with what was
 * written — the same reason `WrapAudit` carries the diff the reconcile had to compute anyway.
 * `statusBefore`/`statusAfter` are both DERIVED, by the planner, from the row it was handed and
 * from the row its own `key` will produce; there is no third place where a status is decided.
 */
export interface ContentKeyAudit {
  readonly action:
    | 'mint'
    | 'revoke'
    | 'restore'
    | 'destroy'
    | 'regenerate'
    | 'beginRotation'
    | 'recordProgress'
    | 'failRotation'
    | 'finishRotation'
    | 'drain';
  readonly accountId: string;
  readonly productId: string;
  readonly generation: number | null;
  readonly statusBefore: ContentKeyState;
  readonly statusAfter: ContentKeyState;
  readonly cause: RevokedCause | null;
  readonly at: string;
}

export interface ContentKeyPatch {
  /**
   * Field paths on the key row. The only dotted prefix any planner emits is `rotation.`, because
   * `planRecordProgress` and its siblings must merge into a running rotation without clobbering
   * `startedAt`.
   */
  readonly key: Readonly<Record<string, ContentKeyPatchValue>>;
  readonly generations: readonly GenerationPatch[];
  /**
   * Non-null means: **MINT AND WRAP THIS GENERATION BEFORE APPLYING THE REST.** Ordering is a
   * RULE (footgun 2), expressed in the patch's shape rather than in a comment a reimplementation
   * misses.
   */
  readonly mint: { readonly generation: number } | null;
  /**
   * The row may not exist and must be created.
   *
   * Dotted keys are a store trap in exactly one direction: under Firestore they are field paths
   * for `update()` and **literal field names** under `set(…, { merge: true })`, so
   * `set({ 'rotation.error': x }, { merge: true })` silently creates a top-level field called
   * `rotation.error`. This flag lets `apply` choose without inferring.
   *
   * `assertContentKeyPatch` holds the invariant that makes it safe to honour: **a patch that may create
   * a row contains no dotted key.** It is deliberately a one-way implication and not the
   * biconditional — `planRestore` writes two undotted keys on a row that must already exist —
   * so "no dotted key" does not on its own mean "create it".
   */
  readonly createIfMissing: boolean;
  /**
   * Every mutating operation drops this account's cached DEKs (footgun 14). The flag is on the
   * patch rather than in a docblock, because a consumer wiring `apply` and forgetting is
   * invisible: everything works, revocations just never arrive until the TTL expires.
   *
   * `evict === (changed > 0 || mint !== null)`, asserted.
   */
  readonly evict: boolean;
  readonly audit: ContentKeyAudit;
  /**
   * How many writes this patch carries: the number of key fields plus the number of generation
   * patches. **0 means nothing to write**, and then `key` and `generations` are both empty —
   * the same contract as `WrapPatch.changed`, so a consumer's "don't write" branch is uniform
   * across the patch types.
   */
  readonly changed: number;
}

// ---------------------------------------------------------------------------
// Refusals
// ---------------------------------------------------------------------------

/**
 * A planner's *no*, as a value rather than as a throw.
 *
 * A refusal is a legitimate answer about the state of the world — the key is not revoked yet, a
 * rotation is already open — and every one of them is a 409 that a route turns into a message an
 * operator reads. Throwing would put those on the same channel as a programming error, and the
 * route would then have to distinguish them by code anyway. So: refusals return, and a
 * programming error (a `through` that is not a number, an error string that is key material)
 * still throws `VALIDATION_ERROR`.
 */
export interface Refusal {
  readonly refused: true;
  readonly code: ContentCryptoCode;
  readonly message: string;
}

export function refusal(code: ContentCryptoCode, message: string): Refusal {
  if (!code || typeof code !== 'string') {
    throw new ContentCryptoError('VALIDATION_ERROR', 'a refusal needs a ContentCryptoCode');
  }
  if (typeof message !== 'string' || message.length === 0) {
    throw new ContentCryptoError(
      'VALIDATION_ERROR',
      'a refusal needs a message: an operator page renders it, and "409" on its own is not an answer',
    );
  }
  return Object.freeze({ refused: true as const, code, message });
}

/**
 * Structural, not `instanceof`: a refusal is plain data and may have crossed a JSON boundary.
 * A `ContentKeyPatch` has no `refused` key, so the two never collide.
 */
export function isRefusal(v: unknown): v is Refusal {
  return typeof v === 'object' && v !== null && (v as { refused?: unknown }).refused === true;
}

// ---------------------------------------------------------------------------
// assertContentKeyPatch
// ---------------------------------------------------------------------------

const AUDIT_ACTIONS: Readonly<Record<ContentKeyAudit['action'], true>> = Object.freeze({
  mint: true,
  revoke: true,
  restore: true,
  destroy: true,
  regenerate: true,
  beginRotation: true,
  recordProgress: true,
  failRotation: true,
  finishRotation: true,
  drain: true,
});

const KEY_STATUSES: Readonly<Record<ContentKeyState, true>> = Object.freeze({
  active: true,
  revoked: true,
  destroyed: true,
});

/**
 * Everything that must be true of a patch before a store touches it.
 *
 * Every planner runs this on the way out, so a rule broken inside this package throws here
 * rather than reaching a store — and a consumer can run it again on a patch that arrived over a
 * queue, where the planner's guarantee no longer travels with the value.
 *
 * What it asserts:
 *
 *  - **the dotted-key invariant** — `createIfMissing` implies no dotted key, so `apply` may
 *    honour the flag without inference;
 *  - **`changed === 0` implies nothing to write** — the shared contract with `WrapPatch`;
 *  - **`evict === (changed > 0 || mint !== null)`** — footgun 14, as arithmetic;
 *  - **every value is a `ContentKeyPatchValue`** — plain JSON or one of the two sentinels, which is
 *    what a closure creeping back in would fail;
 *  - **no key material anywhere**, through `assertNoKeyMaterial`. A patch is a loggable object
 *    by design, and that is precisely the property that makes it an egress. Note this is NOT
 *    `assertNoSecrets`: that one asks "is this a legal error-details bag" over a closed key set,
 *    and a patch is not one — its keys are field paths. Different question, different check.
 */
export function assertContentKeyPatch(patch: ContentKeyPatch): void {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
    throw refuse('a ContentKeyPatch must be an object');
  }

  const key: unknown = patch.key;
  if (key === null || typeof key !== 'object' || Array.isArray(key)) {
    throw refuse('ContentKeyPatch.key must be a plain object of field paths');
  }
  if (!Array.isArray(patch.generations)) {
    throw refuse('ContentKeyPatch.generations must be an array');
  }
  if (typeof patch.createIfMissing !== 'boolean') throw refuse('ContentKeyPatch.createIfMissing must be a boolean');
  if (typeof patch.evict !== 'boolean') throw refuse('ContentKeyPatch.evict must be a boolean');
  if (!Number.isInteger(patch.changed) || patch.changed < 0) {
    throw refuse('ContentKeyPatch.changed must be a non-negative integer');
  }

  const keyPaths = Object.keys(key as Record<string, unknown>);
  for (const path of keyPaths) {
    assertFieldPath(path, 'ContentKeyPatch.key');
    assertPatchValue((key as Record<string, unknown>)[path], `ContentKeyPatch.key['${path}']`);
  }

  // The invariant that makes `createIfMissing` safe to honour without inference. One way only:
  // a patch that may create a row carries no dotted key. The converse is deliberately NOT
  // asserted — `planRestore` writes `revokedAt`/`revokedCause`, neither of them dotted, onto a
  // row that must already exist — so an undotted patch says nothing about creation.
  if (patch.createIfMissing) {
    const dotted = keyPaths.find((path) => path.includes('.'));
    if (dotted !== undefined) {
      throw refuse(
        `ContentKeyPatch.createIfMissing is true and the patch writes the dotted field path \`${dotted}\`. ` +
          'A create writes a literal map, under which a dotted key becomes a top-level field with a dot in its name',
      );
    }
  }

  const seen = new Set<number>();
  for (const g of patch.generations) {
    if (g === null || typeof g !== 'object') throw refuse('a GenerationPatch must be an object');
    if (!Number.isInteger(g.n) || g.n < 1) throw refuse('GenerationPatch.n must be a positive integer');
    if (seen.has(g.n)) throw refuse(`generation ${g.n} is patched twice in one ContentKeyPatch`);
    seen.add(g.n);
    if (typeof g.eraseWrap !== 'boolean') throw refuse('GenerationPatch.eraseWrap must be a boolean');
    if (g.set === null || typeof g.set !== 'object' || Array.isArray(g.set)) {
      throw refuse('GenerationPatch.set must be a plain object');
    }
    for (const path of Object.keys(g.set)) {
      assertFieldPath(path, `GenerationPatch(${g.n}).set`);
      assertPatchValue(g.set[path], `GenerationPatch(${g.n}).set['${path}']`);
    }
  }

  if (patch.mint !== null) {
    if (typeof patch.mint !== 'object' || !Number.isInteger(patch.mint.generation) || patch.mint.generation < 1) {
      throw refuse('ContentKeyPatch.mint must be null or { generation: <positive integer> }');
    }
  }

  const expectedChanged = keyPaths.length + patch.generations.length;
  if (patch.changed !== expectedChanged) {
    throw refuse(
      `ContentKeyPatch.changed is ${patch.changed} but the patch carries ${keyPaths.length} key field(s) ` +
        `and ${patch.generations.length} generation patch(es)`,
    );
  }
  if (patch.changed === 0 && (keyPaths.length > 0 || patch.generations.length > 0)) {
    throw refuse('ContentKeyPatch.changed is 0 but the patch has something to write');
  }

  // Footgun 14, as arithmetic rather than as vigilance.
  const shouldEvict = patch.changed > 0 || patch.mint !== null;
  if (patch.evict !== shouldEvict) {
    throw refuse(
      `ContentKeyPatch.evict is ${String(patch.evict)} but changed=${patch.changed} and mint=${
        patch.mint === null ? 'null' : String(patch.mint.generation)
      }; every mutating operation must evict the account's cached DEKs`,
    );
  }

  assertAudit(patch.audit);

  // The standing guard. A point-in-time leak sweep proves only that the tree was clean on the
  // day somebody ran it; this runs on every patch, so adding a field to `ContentKeyAudit` is not the
  // same as adding a leak.
  assertNoKeyMaterial(patch.key, 'ContentKeyPatch.key');
  for (const g of patch.generations) assertNoKeyMaterial(g.set, `ContentKeyPatch.generations[${g.n}].set`);
  assertNoKeyMaterial(patch.audit, 'ContentKeyPatch.audit');
}

function assertAudit(audit: ContentKeyAudit): void {
  if (audit === null || typeof audit !== 'object') throw refuse('ContentKeyPatch.audit is required');
  if (!Object.prototype.hasOwnProperty.call(AUDIT_ACTIONS, audit.action)) {
    throw refuse(`ContentKeyPatch.audit.action \`${String(audit.action)}\` is not one of the ten lifecycle actions`);
  }
  for (const field of ['accountId', 'productId', 'at'] as const) {
    if (typeof audit[field] !== 'string' || audit[field].length === 0) {
      throw refuse(`ContentKeyPatch.audit.${field} must be a non-empty string`);
    }
  }
  for (const field of ['statusBefore', 'statusAfter'] as const) {
    if (!Object.prototype.hasOwnProperty.call(KEY_STATUSES, audit[field])) {
      throw refuse(`ContentKeyPatch.audit.${field} \`${String(audit[field])}\` is not a ContentKeyState`);
    }
  }
  if (audit.generation !== null && (!Number.isInteger(audit.generation) || audit.generation < 1)) {
    throw refuse('ContentKeyPatch.audit.generation must be null or a positive integer');
  }
}

/**
 * Field paths are the store's business, but two shapes are wrong everywhere: an empty segment
 * makes a path no store can address, and whitespace at either end is a typo that becomes a
 * different field.
 */
function assertFieldPath(path: string, where: string): void {
  if (path.length === 0) throw refuse(`${where} has an empty field path`);
  if (path !== path.trim()) throw refuse(`${where} field path \`${path}\` has leading or trailing whitespace`);
  if (path.split('.').some((segment) => segment.length === 0)) {
    throw refuse(`${where} field path \`${path}\` has an empty segment`);
  }
}

/**
 * A patch value is plain JSON or one of the two sentinels — matched by SHAPE, so a sentinel that
 * has been through `JSON.parse(JSON.stringify(patch))` is still one, and an object carrying an
 * extra property alongside `op` is not.
 */
function assertPatchValue(value: unknown, where: string): void {
  if (value === null) return;
  const t = typeof value;
  if (t === 'string' || t === 'boolean') return;
  if (t === 'number') {
    if (!Number.isFinite(value as number)) {
      throw refuse(`${where} is ${String(value)}, which does not survive JSON`);
    }
    return;
  }
  if (t === 'object' && !Array.isArray(value)) {
    const own = Reflect.ownKeys(value as object);
    const op = (value as { op?: unknown }).op;
    if (own.length === 1 && own[0] === 'op' && (op === 'delete' || op === 'serverTime')) return;
  }
  throw refuse(
    `${where} is not a ContentKeyPatchValue: a patch value is a string, number, boolean, null, ` +
      'KEY_PATCH_DELETE or KEY_PATCH_SERVER_TIME, and nothing else — a closure or a store handle here ' +
      'is neither assertable nor loggable',
  );
}

function refuse(message: string): ContentCryptoError {
  return new ContentCryptoError('VALIDATION_ERROR', `assertContentKeyPatch: ${message}`);
}

// ---------------------------------------------------------------------------
// The port itself
// ---------------------------------------------------------------------------

/**
 * The four operations a consumer implements. There is no implementation in this package, and an
 * in-memory one lives only in the test suite.
 *
 * **What `apply` must do, in order:**
 *
 * 1. If `patch.mint !== null`, **mint and wrap that generation first**, then apply the rest. The
 *    mint itself is the consumer's, because the KEK is.
 * 2. Create the row if `createIfMissing` and it is absent; otherwise apply `key` as field paths.
 * 3. Apply each `GenerationPatch`: `set` as field paths on generation row `n`, then erase the
 *    wrap if `eraseWrap`.
 * 4. Translate the sentinels: `KEY_PATCH_DELETE` to the store's delete sentinel,
 *    `KEY_PATCH_SERVER_TIME` to its server timestamp.
 * 5. Atomically where the store can be. **Where it cannot, apply the generation patches BEFORE
 *    the key patch**, so a partial failure leaves the row saying *less* has happened than has: a
 *    generation erased under a row not yet tombstoned is recoverable by re-running, and a row
 *    tombstoned over live wraps is a destroy that lies.
 * 6. Honour `patch.evict` by calling `DekSource.evict(accountId)` (footgun 14).
 *
 * `patch.changed === 0` means steps 2–5 write nothing.
 */
export interface ContentKeyStore {
  readKey(accountId: string): Promise<ContentKeyRow | null>;
  readGeneration(accountId: string, n: number): Promise<GenerationRow | null>;
  listGenerations(accountId: string): Promise<readonly GenerationRow[]>;
  /** Applied atomically where the store can be. The consumer performs `patch.mint` FIRST. */
  apply(accountId: string, patch: ContentKeyPatch): Promise<void>;
}
