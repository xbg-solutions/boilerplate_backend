/**
 * **The erasure promise, as a property.**
 *
 * This is the thing the whole programme exists to create: content becomes unreadable because the
 * key is gone, not because a row was deleted — which is why a shred reaches backups, exports and
 * replicas that no delete could ever reach.
 *
 * It gets its own suite because it is the only place the READ path and the WRITE path meet, and
 * they meet **in a test** rather than in `src/`: assembling them in `src/` would be the local
 * custodian that decision 1 deletes. The harness below is a lifecycle-aware in-memory key store
 * driven by the package's own planners, and it may not move into `testing.ts` — `testing.ts` ships,
 * and a shipped store that knows the lifecycle rules is a local custodian by another name
 * (check-mirror assertion (8) holds the other half of that).
 *
 * What the harness buys, beyond convenience: it proves the planners' `deriveStatus` and the read
 * path's refusal codes AGREE. Nothing else in the package checks that, and a consumer would
 * otherwise discover the disagreement in production.
 *
 * ## The destruction here is real, and that is the point
 *
 * A harness that derived DEK bytes from `sha256(accountId, generation)` would let a destroyed key
 * come back the moment anybody forgot a `hasWrap` check, and every assertion below would then be
 * testing a bookkeeping flag rather than an erasure. So generation material is drawn from
 * `randomBytes` at mint, held in one map, and **deleted** by `GenerationPatch.eraseWrap`. After a
 * destroy there is no code path anywhere in this file that can produce those bytes again.
 *
 * ## The three properties, and what would break each
 *
 *  - **The ciphertext never changes.** Snapshotted at step 1 and compared after every lifecycle
 *    action. A shred that rewrote content would be a delete wearing a shred's name.
 *  - **A partner keeps reading after the owner's shred.** The record key is `randomBytes`, derived
 *    from nothing, so nothing about it depends on the owner. Were it derived from an account
 *    secret, federation would be impossible and this test would fail — which is exactly why it is
 *    here and not left to the record-key module's own round-trip.
 *  - **You cannot grant access to a record you cannot reach.** Structural: `planWraps` needs an
 *    open `RecordKey`, and the only route to one from a `KeyWraps` is `unwrapRecordKey`, which
 *    needs a wrap and a live DEK. With the last wrap-holder shredded, both doors are shut.
 */

import { randomBytes } from 'node:crypto';

import { createContentCrypto } from '../content-crypto';
import type { WrapCommitter, WrapReceipt } from '../content-crypto';
import type { ContentCrypto } from '../content-crypto';
import { cachingDekSource } from '../custodian-cache';
import type { CachedDekSource, DekHandle, DekSource, RevokedCause } from '../custodian';
import {
  ContentCryptoError, HTTP_STATUS_FOR_CODE, isContentCryptoError, isKeyUnavailable, isUnreadable,
} from '../errors';
import { aggregateRecordRef } from '../key-scope';
import type { KeyScope } from '../key-scope';
import {
  deriveStatus, planDestroy, planMint, planRegenerate, planRestore, planRevoke,
} from '../key-lifecycle';
import { KEY_PATCH_DELETE, KEY_PATCH_SERVER_TIME, isRefusal } from '../key-store';
import type { GenerationRow, KeyPatch, KeyPatchValue, KeyRow, Refusal } from '../key-store';
import { defineRegistry } from '../registry';
import { holdersOf, isUnreachable, parseKeyWraps, wrapCount } from '../record-key';
import type { KeyWraps, RecordRef } from '../record-key';
import { dekFromBytes } from '../secret';
import { runWrapJob } from '../walk';
import type { RecordHead, WriteRow, WriteSink } from '../walk';

// ---------------------------------------------------------------------------
// The harness — fifteen lines of store, driven by the package's own planners
// ---------------------------------------------------------------------------

const PRODUCT = 'collab';

interface Account {
  row: KeyRow;
  generations: GenerationRow[];
}

interface LifecycleStore {
  /** The DEK source the façade is built over — lifecycle-aware, so a revoke really bites. */
  readonly source: DekSource;
  /** Apply a planner's patch. Refusals are returned to the caller, never applied. */
  apply(patch: KeyPatch): void;
  rowOf(accountId: string): KeyRow;
  generationsOf(accountId: string): readonly GenerationRow[];
  /** True while this generation's bytes still exist ANYWHERE in the harness. */
  hasMaterial(accountId: string, generation: number): boolean;
  ensure(accountId: string): void;
}

const at = (): string => new Date('2026-09-11T12:00:00.000Z').toISOString();

function memoryLifecycleStore(): LifecycleStore {
  const accounts = new Map<string, Account>();
  /** THE KEY MATERIAL. `eraseWrap` deletes from here, and nothing recreates it. */
  const material = new Map<string, Buffer>();
  const materialKey = (accountId: string, n: number): string => `${accountId}#${n}`;

  const blank = (accountId: string): KeyRow => ({
    accountId,
    productId: PRODUCT,
    currentGeneration: 1,
    createdAt: null,
    revokedAt: null,
    revokedCause: null,
    destroyedAt: null,
    destroyedThrough: null,
    rotation: null,
  });

  const resolveValue = (value: KeyPatchValue): unknown =>
    value === KEY_PATCH_SERVER_TIME ||
    (typeof value === 'object' && value !== null && (value as { op?: string }).op === 'serverTime')
      ? at()
      : value;

  const isDelete = (value: KeyPatchValue): boolean =>
    value === KEY_PATCH_DELETE ||
    (typeof value === 'object' && value !== null && (value as { op?: string }).op === 'delete');

  const applyFields = (
    target: Record<string, unknown>, set: Readonly<Record<string, KeyPatchValue>>,
  ): void => {
    for (const path of Object.keys(set)) {
      const value = set[path];
      const segments = path.split('.');
      let node = target;
      for (let i = 0; i < segments.length - 1; i += 1) {
        const next = node[segments[i]];
        node[segments[i]] = typeof next === 'object' && next !== null ? next : {};
        node = node[segments[i]] as Record<string, unknown>;
      }
      const leaf = segments[segments.length - 1];
      if (isDelete(value)) delete node[leaf];
      else node[leaf] = resolveValue(value);
    }
  };

  const accountOf = (accountId: string): Account => {
    const found = accounts.get(accountId);
    if (found !== undefined) return found;
    const made: Account = { row: blank(accountId), generations: [] };
    accounts.set(accountId, made);
    return made;
  };

  const apply = (patch: KeyPatch): void => {
    const account = accountOf(patch.audit.accountId);

    // ORDERING IS A RULE, and the patch's shape carries it: mint and wrap the generation BEFORE
    // applying the rest, so the account never looks healthy while pointing at a generation whose
    // material does not exist.
    if (patch.mint !== null) {
      const n = patch.mint.generation;
      material.set(materialKey(account.row.accountId, n), randomBytes(32));
      const existing = account.generations.find((g) => g.n === n);
      const minted: GenerationRow = {
        n, hasWrap: true, kmsKeyVersion: null, createdAt: at(),
        retiredAt: null, drainedAt: null, destroyedAt: null,
      };
      if (existing === undefined) account.generations.push(minted);
      else account.generations[account.generations.indexOf(existing)] = minted;
    }

    const draft = { ...account.row } as unknown as Record<string, unknown>;
    applyFields(draft, patch.key);
    account.row = draft as unknown as KeyRow;

    for (const generation of patch.generations) {
      const index = account.generations.findIndex((g) => g.n === generation.n);
      const base: GenerationRow = index === -1
        ? {
          n: generation.n, hasWrap: false, kmsKeyVersion: null, createdAt: null,
          retiredAt: null, drainedAt: null, destroyedAt: null,
        }
        : account.generations[index];
      const draftGeneration = { ...base } as unknown as Record<string, unknown>;
      applyFields(draftGeneration, generation.set);
      if (generation.eraseWrap) {
        draftGeneration.hasWrap = false;
        // THE ERASURE. Not a flag — the bytes leave the harness and nothing puts them back.
        material.delete(materialKey(account.row.accountId, generation.n));
      }
      const next = draftGeneration as unknown as GenerationRow;
      if (index === -1) account.generations.push(next);
      else account.generations[index] = next;
    }
  };

  const ensure = (accountId: string): void => {
    const account = accountOf(accountId);
    if (account.row.createdAt !== null) return;
    const patch = planMint({
      row: null, generationRow: null, accountId, productId: PRODUCT, now: () => new Date(at()),
    });
    if (isRefusal(patch)) throw new ContentCryptoError(patch.code, patch.message);
    apply(patch);
  };

  /** The one place a status becomes a refusal. It reads the row through `deriveStatus`, which is
   *  the planners' own derivation — which is how the two are proved to agree. */
  const guard = (accountId: string): Account => {
    const account = accountOf(accountId);
    const status = deriveStatus(account.row);
    if (status === 'destroyed') {
      throw new ContentCryptoError('ACCOUNT_KEY_DESTROYED', `key for '${accountId}' is destroyed`);
    }
    if (status === 'revoked') {
      throw new ContentCryptoError('ACCOUNT_KEY_REVOKED', `key for '${accountId}' is revoked`);
    }
    return account;
  };

  const handleFor = (accountId: string, n: number): DekHandle => {
    const bytes = material.get(materialKey(accountId, n));
    const row = accountOf(accountId).generations.find((g) => g.n === n);
    if (bytes === undefined || row === undefined || !row.hasWrap) {
      // An absent wrap is a destroy or a drain, NEVER a fresh key. A custodian that minted here
      // would make everything under this generation permanently unreadable while reporting success.
      throw new ContentCryptoError(
        'ACCOUNT_KEY_DESTROYED',
        `generation ${n} for '${accountId}' holds no wrapped key`,
      );
    }
    return { generation: n, key: dekFromBytes(Buffer.from(bytes), `${PRODUCT}/${accountId}@${n}`) };
  };

  const source: DekSource = {
    async getCurrentDek(accountId): Promise<DekHandle> {
      ensure(accountId);
      const account = guard(accountId);
      return handleFor(accountId, account.row.currentGeneration);
    },
    async getDek(accountId, generation): Promise<DekHandle> {
      guard(accountId);
      return handleFor(accountId, generation);
    },
    async currentGeneration(accountId): Promise<number> {
      return guard(accountId).row.currentGeneration;
    },
    evict(): void {
      /* the cache in front of this holds everything there is to hold */
    },
  };

  return {
    source,
    apply,
    rowOf: (accountId) => accountOf(accountId).row,
    generationsOf: (accountId) => accountOf(accountId).generations,
    hasMaterial: (accountId, n) => material.has(materialKey(accountId, n)),
    ensure,
  };
}

// ---------------------------------------------------------------------------
// The product on top of it
// ---------------------------------------------------------------------------

const registry = defineRegistry({
  projects: { strings: ['name'], blobs: ['settings'] },
});

type Collection = 'projects';

const scope: KeyScope<'project'> = {
  productId: PRODUCT,
  records: { project: 'aggregate' },
};

const OBJECT_REF = { bucket: 'xbgsolutions-collab', path: 'objects/ab/cd.bin' };
const OBJECT_BODY = Buffer.from('an attachment nobody may read after the shred', 'utf8');

interface Harness {
  readonly store: LifecycleStore;
  readonly dekSource: CachedDekSource;
  readonly crypto: ContentCrypto<Collection, 'project'>;
  readonly record: RecordRef;
  /** The operator actions, each applying its patch and honouring `KeyPatch.evict`. */
  revoke(accountId: string, cause?: RevokedCause): KeyPatch;
  restore(accountId: string, causeStillHolds?: boolean): KeyPatch | Refusal;
  destroy(accountId: string): KeyPatch | Refusal;
  regenerate(accountId: string): KeyPatch | Refusal;
}

/**
 * The wrap committer these fixtures wire.
 *
 * It WRITES — into a Map, a store being the thing this package is not allowed to know about — and
 * only then acknowledges, which is the conforming shape. Its refusals (create-only, a lost
 * precondition, a stub receipt) are asserted in `content-crypto.test.ts`, and the durability
 * property itself in `durability.test.ts`. Here the port is wiring rather than the subject, so it
 * is deliberately permissive about writing the same record twice.
 */
function recordingCommitter(): WrapCommitter & {
  readonly rows: Map<string, Readonly<Record<string, unknown>>>;
} {
  const rows = new Map<string, Readonly<Record<string, unknown>>>();
  return {
    rows,
    async commitWraps(requests): Promise<readonly WrapReceipt[]> {
      const committedAt = new Date().toISOString();
      for (const request of requests) rows.set(request.record.path, request.update);
      return requests.map(() => ({ committedAt }));
    },
    // The read-back R11 puts on the port: an independent look at the same rows, positional, and
    // the `keyWraps` map rather than the row that carries it. Answering from anything but the
    // store would be the second deliberate falsehood, which is the price read-back sets.
    async readWraps(records): Promise<readonly unknown[]> {
      return records.map((record) => rows.get(record.path)?.keyWraps);
    },
    isPreconditionFailure: (): boolean => false,
  };
}

function makeHarness(): Harness {
  const store = memoryLifecycleStore();
  const dekSource = cachingDekSource(store.source, {
    productId: PRODUCT,
    onGraceServe: () => {
      throw new Error('a revoked or destroyed key is grace-INELIGIBLE; no grace serve is expected');
    },
  });
  const crypto = createContentCrypto<Collection, 'project'>({
    scope, registry, dekSource, wrapCommitter: recordingCommitter(),
  });

  /** Footgun 14, honoured: every mutating patch drops this account's cached DEKs. A consumer that
   *  wires `apply` and forgets is invisible — everything works, and revocations never arrive. */
  const applyAndEvict = <P extends KeyPatch>(accountId: string, patch: P): P => {
    store.apply(patch);
    if (patch.evict) dekSource.evict(accountId);
    return patch;
  };

  return {
    store,
    dekSource,
    crypto,
    record: aggregateRecordRef('project', 'p_1', 'projects/p_1'),

    revoke(accountId, cause = 'client-request'): KeyPatch {
      store.ensure(accountId);
      return applyAndEvict(accountId, planRevoke({
        row: store.rowOf(accountId), cause, now: () => new Date(at()),
      }));
    },
    restore(accountId, causeStillHolds = false) {
      const patch = planRestore({
        row: store.rowOf(accountId), causeStillHolds, now: () => new Date(at()),
      });
      return isRefusal(patch) ? patch : applyAndEvict(accountId, patch);
    },
    destroy(accountId) {
      const patch = planDestroy({
        row: store.rowOf(accountId),
        generations: store.generationsOf(accountId),
        now: () => new Date(at()),
      });
      return isRefusal(patch) ? patch : applyAndEvict(accountId, patch);
    },
    regenerate(accountId) {
      const patch = planRegenerate({ row: store.rowOf(accountId), now: () => new Date(at()) });
      return isRefusal(patch) ? patch : applyAndEvict(accountId, patch);
    },
  };
}

/** Create the record, seal all three shapes, and hand back the stored bytes as a snapshot. */
async function seedRecord(h: Harness, owner = 'A'): Promise<{
  readonly keyWraps: KeyWraps;
  readonly stored: Record<string, unknown>;
  readonly storedJson: string;
  readonly objectBody: Buffer;
  readonly objectBodySnapshot: Buffer;
  readonly objectMetadata: Readonly<Record<string, string | undefined>>;
}> {
  // The wrap was made durable inside `createRecord`, before this session existed: there is no
  // second step here, which is the whole of R10a.
  const created = await h.crypto.createRecord({ record: h.record, owner });
  const session = created.session;
  try {
    const stored = session.encryptDoc('projects', 'p_1', {
      name: 'Alpha', settings: { theme: 'dark', seats: 4 },
    }) as Record<string, unknown>;
    const object = session.sealObject(OBJECT_REF, OBJECT_BODY);
    return {
      keyWraps: created.keyWraps,
      stored,
      storedJson: JSON.stringify(stored),
      objectBody: object.body,
      // An INDEPENDENT copy taken at seal time. Comparing `objectBody` against itself later would
      // be a tautology, and a tautology is exactly what a "nothing was rewritten" assertion must
      // not be.
      objectBodySnapshot: Buffer.from(object.body),
      objectMetadata: object.metadata,
    };
  } finally {
    session.close();
  }
}

async function asyncCodeOf(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (err) {
    return isContentCryptoError(err) ? err.code : `not a ContentCryptoError: ${String(err)}`;
  }
  return 'did not throw';
}

function recordingSink(): { readonly sink: WriteSink; readonly rows: WriteRow[] } {
  const rows: WriteRow[] = [];
  return {
    rows,
    sink: {
      maxBatchSize: 400,
      deleteField: '<<delete>>',
      async writeBatch(batch): Promise<void> {
        rows.push(...batch);
      },
      async writeOne(row): Promise<void> {
        rows.push(row);
      },
      isPreconditionFailure: () => false,
    },
  };
}

// ---------------------------------------------------------------------------
// The harness itself, asserted before anything is asserted THROUGH it
// ---------------------------------------------------------------------------

describe('the harness destroys real bytes, so everything below is about erasure and not bookkeeping', () => {
  it('erases generation material on destroy, and no code path can produce it again', async () => {
    const h = makeHarness();
    await h.crypto.createRecord({ record: h.record, owner: 'A' })
      .then((created) => created.session.close());

    expect(h.store.hasMaterial('A', 1)).toBe(true);
    h.revoke('A');
    // A REVOKE erases nothing — that is what makes it reversible, and it is the cooling-off the
    // destroy refusal below depends on.
    expect(h.store.hasMaterial('A', 1)).toBe(true);

    h.destroy('A');
    expect(h.store.hasMaterial('A', 1)).toBe(false);
    // The generation ROW survives, carrying `hasWrap: false`. "Row missing" and "material erased"
    // are different facts, and only the second is a shred.
    expect(h.store.generationsOf('A').map((g) => ({ n: g.n, hasWrap: g.hasWrap })))
      .toEqual([{ n: 1, hasWrap: false }]);
  });

  it('refuses to destroy a key that was never revoked — the cooling-off is a refusal', () => {
    const h = makeHarness();
    h.store.ensure('A');
    const refused = h.destroy('A');
    expect(isRefusal(refused)).toBe(true);
    expect(isRefusal(refused) ? refused.code : 'not a refusal').toBe('ACCOUNT_KEY_NOT_REVOKED');
    expect(h.store.hasMaterial('A', 1)).toBe(true);
  });

  it('agrees with deriveStatus: the row\'s derived status IS the refusal the read path gives', async () => {
    // Nothing else in the package checks this. The planners derive a status from two dates; the
    // read path refuses with a code. A consumer would otherwise discover the disagreement in
    // production, on the day it mattered.
    const h = makeHarness();
    h.store.ensure('A');
    expect(deriveStatus(h.store.rowOf('A'))).toBe('active');
    expect(await asyncCodeOf(() => h.dekSource.getCurrentDek('A'))).toBe('did not throw');

    h.revoke('A');
    expect(deriveStatus(h.store.rowOf('A'))).toBe('revoked');
    expect(await asyncCodeOf(() => h.dekSource.getCurrentDek('A'))).toBe('ACCOUNT_KEY_REVOKED');

    h.destroy('A');
    expect(deriveStatus(h.store.rowOf('A'))).toBe('destroyed');
    expect(await asyncCodeOf(() => h.dekSource.getCurrentDek('A'))).toBe('ACCOUNT_KEY_DESTROYED');
  });

  it('the cache eviction is LOAD-BEARING: without it a revoke does not bite', async () => {
    // The `KeyPatch.evict` flag exists because forgetting it is invisible — everything works and
    // the revocation simply never arrives until the TTL expires. This is that failure, produced on
    // purpose and then repaired, so the flag is proved to be doing something.
    const h = makeHarness();
    const seed = await seedRecord(h);
    const input = { record: h.record, keyWraps: seed.keyWraps };

    // Warm the cache with a real read.
    await h.crypto.withRecord(input, { as: 'A' }, async () => undefined);

    // Revoke WITHOUT evicting.
    h.store.apply(planRevoke({ row: h.store.rowOf('A'), cause: 'client-request', now: () => new Date(at()) }));
    expect(deriveStatus(h.store.rowOf('A'))).toBe('revoked');
    expect(await asyncCodeOf(() => h.crypto.openRecord(input, { as: 'A' }))).toBe('did not throw');

    // Now honour the flag.
    h.dekSource.evict('A');
    expect(await asyncCodeOf(() => h.crypto.openRecord(input, { as: 'A' })))
      .toBe('ACCOUNT_KEY_REVOKED');
  });
});

// ---------------------------------------------------------------------------
// The sequence: create → read → revoke → restore → destroy → regenerate
// ---------------------------------------------------------------------------

describe('revoke → destroy → regenerate, with the ciphertext unchanged throughout', () => {
  it('walks the whole lifecycle and never rewrites a byte of content', async () => {
    const h = makeHarness();
    const seed = await seedRecord(h);
    const input = { record: h.record, keyWraps: seed.keyWraps };
    const unchanged = (): void => {
      // THE ASSERTION THAT DISTINGUISHES A SHRED FROM A DELETE. Nothing was rewritten; only the
      // key is gone — which is why a shred reaches backups, exports and replicas.
      expect(JSON.stringify(seed.stored)).toBe(seed.storedJson);
    };

    // 1–2. Read back. All three shapes decrypt, and the reader is who they said they were.
    const readAll = async (as: string): Promise<void> => {
      await h.crypto.withRecord(input, { as }, async (session) => {
        expect(session.as).toBe(as);
        expect(session.decryptDoc('projects', 'p_1', { ...seed.stored }))
          .toEqual({ name: 'Alpha', settings: { theme: 'dark', seats: 4 } });
        expect(session.openBlobAt('projects', 'p_1', 'settings', seed.stored.settings))
          .toEqual({ theme: 'dark', seats: 4 });
        expect(session.openObject(OBJECT_REF, seed.objectBody, seed.objectMetadata)
          .equals(OBJECT_BODY)).toBe(true);
      });
    };
    await readAll('A');
    unchanged();

    // 3. Revoked. Reversible, and every read refuses with the reversible code.
    h.revoke('A');
    expect(await asyncCodeOf(() => h.crypto.openRecord(input, { as: 'A' })))
      .toBe('ACCOUNT_KEY_REVOKED');
    expect(await h.crypto.openRecordSafe(input, { as: 'A' })).toBeNull();
    unchanged();

    // 4. Restored. Readable again, and the stored bytes are the same bytes.
    expect(isRefusal(h.restore('A'))).toBe(false);
    await readAll('A');
    unchanged();

    // 5. Revoked, then destroyed. Irreversible.
    h.revoke('A');
    expect(isRefusal(h.destroy('A'))).toBe(false);
    expect(await asyncCodeOf(() => h.crypto.openRecord(input, { as: 'A' })))
      .toBe('ACCOUNT_KEY_DESTROYED');
    unchanged();
    // The object body too: the bytes in the bucket after the shred are the bytes that were put
    // there, compared against a copy taken before any of this happened.
    expect(seed.objectBody.equals(seed.objectBodySnapshot)).toBe(true);

    // 6. Regenerated. A new start, never a recovery.
    expect(isRefusal(h.regenerate('A'))).toBe(false);
    const row = h.store.rowOf('A');
    expect(row.currentGeneration).toBe(2);
    expect(deriveStatus(row)).toBe('active');
    // `destroyedThrough` SURVIVES the regenerate, so the operator page can still say which
    // material is gone after the account has been brought back.
    expect(row.destroyedThrough).toBe(1);

    // New content written at generation 2 reads — and its wrap NAMES generation 2, which is what
    // makes "a new start, not a recovery" checkable rather than merely stated.
    const remade = await h.crypto.createRecord({
      record: aggregateRecordRef('project', 'p_2', 'projects/p_2'), owner: 'A',
    });
    const freshSession = remade.session;
    try {
      expect(remade.keyWraps.A.gen).toBe(2);
      expect(seed.keyWraps.A.gen).toBe(1);
      const freshDoc = freshSession.encryptDoc('projects', 'p_2', { name: 'After the shred' });
      expect(freshSession.decryptDoc('projects', 'p_2', { ...freshDoc }))
        .toEqual({ name: 'After the shred' });
    } finally {
      freshSession.close();
    }

    // And the OLD content stays unreadable for ever: its wrap names generation 1, whose material
    // was erased, and `getDek` refuses rather than minting into the gap.
    expect(await asyncCodeOf(() => h.crypto.openRecord(input, { as: 'A' })))
      .toBe('ACCOUNT_KEY_DESTROYED');
    expect(h.store.hasMaterial('A', 1)).toBe(false);
    unchanged();
  });

  it('classifies the two refusals the way a route must — 409 both, one reversible', () => {
    // The pair a list page and an operator page both branch on. `isKeyUnavailable` says "the key
    // cannot be had"; `isUnreadable` adds "and I simply hold no wrap", which is ordinary.
    for (const code of ['ACCOUNT_KEY_REVOKED', 'ACCOUNT_KEY_DESTROYED'] as const) {
      const err = new ContentCryptoError(code, 'x');
      expect(HTTP_STATUS_FOR_CODE[code]).toBe(409);
      expect(err.status).toBe(409);
      expect(isKeyUnavailable(err)).toBe(true);
      expect(isUnreadable(err)).toBe(true);
    }
    // And the one that must NOT be swallowed, so a corrupted access list cannot become a quietly
    // shorter list page.
    expect(isUnreadable(new ContentCryptoError('RECORD_KEY_UNWRAP_FAILED', 'x'))).toBe(false);
  });

  it('openRecord throws where openRecordSafe returns null — the list page\'s whole ergonomics', async () => {
    const h = makeHarness();
    const seed = await seedRecord(h);
    const input = { record: h.record, keyWraps: seed.keyWraps };
    h.revoke('A');

    // The two MUST differ. A safe variant that also threw would put every federated list page back
    // to wrapping each row in try/catch.
    await expect(h.crypto.openRecord(input, { as: 'A' })).rejects.toThrow();
    expect(await h.crypto.openRecordSafe(input, { as: 'A' })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Federation — the last clause of the plan's §2 promise, working as intended
// ---------------------------------------------------------------------------

describe('a partner holding a wrap still reads after the owner has been shredded', () => {
  /** Create for A, grant B, and hand back what the store would hold. */
  async function shared(h: Harness): Promise<{
    readonly keyWraps: KeyWraps;
    readonly stored: Record<string, unknown>;
  }> {
    const created = await h.crypto.createRecord({ record: h.record, owner: 'A' });
    const session = created.session;
    try {
      const stored = session.encryptDoc('projects', 'p_1', {
        name: 'Alpha', settings: { theme: 'dark' },
      }) as Record<string, unknown>;
      const dekA = await h.dekSource.getCurrentDek('A');
      const dekB = await h.dekSource.getCurrentDek('B');
      const patch = session.planWraps({ A: dekA, B: dekB }, { scope: 'this-record' });
      return { keyWraps: patch.wraps, stored };
    } finally {
      session.close();
    }
  }

  it('B reads every field after A\'s key is destroyed — the record key is derived from nothing', async () => {
    // THE SHARPEST SINGLE TEST IN THE PACKAGE. Were the record key derived from the owner's
    // secret, federation would be impossible and this would fail — and crypto-shredding would be a
    // lie in the other direction, because destroying A's key would take B's access with it.
    const h = makeHarness();
    const { keyWraps, stored } = await shared(h);
    // `ownerAccountId` is supplied, so the package KNOWS the owner has been shredded and B still
    // reads: the key a read gets is the RECORD's, never the reader's and never the owner's. That
    // is what replaced collab's `resolveAccountId(projectId)`, and stating it here is what makes
    // the assertion catch a read path that went back to consulting the owner.
    const input = { record: h.record, keyWraps, ownerAccountId: 'A' };
    const before = JSON.stringify(stored);

    h.revoke('A');
    h.destroy('A');

    expect(await h.crypto.openRecordSafe(input, { as: 'A' })).toBeNull();
    await h.crypto.withRecord(input, { as: 'B' }, async (session) => {
      expect(session.decryptDoc('projects', 'p_1', { ...stored }))
        .toEqual({ name: 'Alpha', settings: { theme: 'dark' } });
    });
    expect(JSON.stringify(stored)).toBe(before);
  });

  it('and it is the WRAP that lets B in: revoke B\'s wrap and B is refused, key intact', async () => {
    // The negative control for the test above. B's survival must be because B holds a wrap, not
    // because the read path stopped checking — so the same B, with the wrap removed and their
    // account key perfectly healthy, is refused.
    const h = makeHarness();
    const { keyWraps, stored } = await shared(h);

    const session = await h.crypto.openRecord({ record: h.record, keyWraps }, { as: 'A' });
    const dekA = await h.dekSource.getCurrentDek('A');
    const afterRevoke = session.planWraps({ A: dekA }, {});
    session.close();

    expect(afterRevoke.diff.removed).toEqual(['B']);
    expect(afterRevoke.cutOff).toBe('wrap-only');
    expect(await asyncCodeOf(() =>
      h.crypto.openRecord({ record: h.record, keyWraps: afterRevoke.wraps }, { as: 'B' }),
    )).toBe('NO_WRAP_FOR_ACCOUNT');
    // A still reads, so the removal took exactly one party's access and no more.
    await h.crypto.withRecord(
      { record: h.record, keyWraps: afterRevoke.wraps }, { as: 'A' },
      async (s) => {
        expect(s.decryptDoc('projects', 'p_1', { ...stored }).name).toBe('Alpha');
      },
    );
  });

  it('two destroyed keys make the record UNREADABLE, which is not the same fact as unreachable', async () => {
    // This corrects the v1 plan (§9.2). `isUnreachable` is a property of the wrap SET, and the
    // erase sweep's job is to delete rows nobody will ever open again — a destroy can be followed
    // by a regenerate, and a record whose holders both have destroyed keys must not be swept.
    // Conflating the two ships a sweep that stops deleting anything the moment a key is destroyed.
    const h = makeHarness();
    const { keyWraps } = await shared(h);
    const input = { record: h.record, keyWraps };

    for (const account of ['A', 'B']) {
      h.revoke(account);
      h.destroy(account);
    }

    expect(await h.crypto.openRecordSafe(input, { as: 'A' })).toBeNull();
    expect(await h.crypto.openRecordSafe(input, { as: 'B' })).toBeNull();

    expect(isUnreachable(keyWraps)).toBe(false);
    expect(wrapCount(keyWraps)).toBe(2);
    expect(holdersOf(keyWraps)).toEqual(['A', 'B']);
  });
});

// ---------------------------------------------------------------------------
// The empty set marks the record for the sweep
// ---------------------------------------------------------------------------

describe('an empty wrap set is the erase signal, and the package deletes nothing', () => {
  it('gives holdersAfter [], deleteRecord true, and wrapHolders [] in the update', async () => {
    const h = makeHarness();
    const created = await h.crypto.createRecord({ record: h.record, owner: 'A' });
    const session = created.session;
    const patch = session.planWraps({}, {});
    session.close();

    expect(patch.holdersAfter).toEqual([]);
    expect(patch.deleteRecord).toBe(true);
    expect(patch.update.wrapHolders).toEqual([]);
    expect(patch.diff.removed).toEqual(['A']);
    expect(isUnreachable(patch.wraps)).toBe(true);
    expect(patch.audit.scope).toBeNull();
  });

  it('runWrapJob reports the record\'s SCOPEPATH in recordsToDelete, and writes an update', async () => {
    const h = makeHarness();
    const created = await h.crypto.createRecord({ record: h.record, owner: 'A' });
    const session = created.session;
    const patch = session.planWraps({}, {});
    session.close();

    const { sink, rows } = recordingSink();
    const head: RecordHead = {
      record: h.record,
      ownerAccountId: 'A',
      keyWraps: created.keyWraps,
      ref: { row: h.record.path },
      precondition: 'read-time',
    };
    const result = await runWrapJob({
      scope: h.crypto.scope,
      accountId: 'A',
      forEachRecord: async (_accountId, visit) => {
        await visit(head);
      },
      sink,
      desired: () => ({}),
      wrap: () => patch,
    });

    expect(result.recordsToDelete).toEqual(['projects/p_1']);
    expect(result.recordsWritten).toBe(1);

    // THE PACKAGE DELETES NOTHING. The sink received an UPDATE, and `WriteRow` has nowhere at all
    // to express a delete: at aggregate granularity what the product deletes is the whole
    // aggregate, and only the product knows what that means.
    expect(Object.keys(rows[0].update).sort()).toEqual(['keyWraps.A', 'wrapHolders']);
    expect(rows[0].update['keyWraps.A']).toBe('<<delete>>');
    // @ts-expect-error a WriteRow cannot say "delete this row"
    expect(rows[0].delete).toBeUndefined();
    expect(Object.keys(rows[0]).sort()).toEqual(['precondition', 'ref', 'update']);
  });

  it('reports a record whose wrap set was ALREADY empty, with nothing to write', async () => {
    // A record needs no write to belong in the sweep, and the sweep must still see it — otherwise
    // an erase interrupted after its write is a row nobody ever deletes.
    const h = makeHarness();
    const created = await h.crypto.createRecord({ record: h.record, owner: 'A' });
    const session = created.session;
    const patch = session.planWraps({}, { current: {} });
    session.close();

    expect(patch.changed).toBe(0);
    expect(patch.deleteRecord).toBe(true);

    const { sink, rows } = recordingSink();
    const result = await runWrapJob({
      scope: h.crypto.scope,
      accountId: 'A',
      forEachRecord: async (_accountId, visit) => {
        await visit({
          record: h.record, ownerAccountId: 'A', keyWraps: {}, ref: { row: h.record.path },
        });
      },
      sink,
      desired: () => ({}),
      wrap: () => patch,
    });

    expect(result.recordsVisited).toBe(1);
    expect(result.recordsWritten).toBe(0);
    expect(result.recordsToDelete).toEqual(['projects/p_1']);
    expect(rows).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// You cannot grant access to a record you cannot reach
// ---------------------------------------------------------------------------

describe('once the last wrap-holder is shredded, nobody can ever be added', () => {
  it('no session can be opened, and `session.planWraps` is the only bound reconcile', async () => {
    const h = makeHarness();
    const { keyWraps } = await (async () => {
      const created = await h.crypto.createRecord({ record: h.record, owner: 'A' });
      created.session.close();
      return created;
    })();
    const input = { record: h.record, keyWraps };

    h.revoke('A');
    h.destroy('A');

    // The holder's key is gone, so the ONE door — `unwrapRecordKey`, which needs a live DEK —
    // is shut; and for anybody else there was never a wrap to begin with.
    expect(await asyncCodeOf(() => h.crypto.openRecord(input, { as: 'A' })))
      .toBe('ACCOUNT_KEY_DESTROYED');
    for (const stranger of ['B', 'C', 'sysadmin']) {
      expect(await asyncCodeOf(() => h.crypto.openRecord(input, { as: stranger })))
        .toBe('NO_WRAP_FOR_ACCOUNT');
      expect(await h.crypto.openRecordSafe(input, { as: stranger })).toBeNull();
    }
    // No session ⟹ no `planWraps`. The property is structural rather than a check somebody runs:
    // the reconcile is bound to an open record key and there is no other bound form.
    expect(await h.crypto.openRecordSafe(input, { as: 'A' })).toBeNull();
  });

  it('an EMPTIED record is equally unreachable, and a stranger with a healthy key is still out', async () => {
    const h = makeHarness();
    const created = await h.crypto.createRecord({ record: h.record, owner: 'A' });
    const session = created.session;
    const emptied = session.planWraps({}, {});
    session.close();

    // Every account's key is perfectly healthy — asserted, so the refusals below are about the
    // absent wrap and not about a key that happens to be gone. There is no wrap, and no wrap is
    // no door.
    for (const account of ['A', 'B']) {
      h.store.ensure(account);
      expect(deriveStatus(h.store.rowOf(account))).toBe('active');
      expect(await h.dekSource.getCurrentDek(account)).toBeDefined();
      expect(
        await asyncCodeOf(() =>
          h.crypto.openRecord({ record: h.record, keyWraps: emptied.wraps }, { as: account }),
        ),
      ).toBe('NO_WRAP_FOR_ACCOUNT');
    }
    expect(parseKeyWraps(emptied.wraps)).toEqual({});
  });

  it('and "recovery" is not recovery: a fresh createRecord mints a key that opens nothing', async () => {
    // The last door somebody would try. `createRecord` on the same ref succeeds — it is a create,
    // and the record has no wraps — and the key it mints is a NEW key: every value sealed under
    // the old one stays noise. This is what makes the promise honest rather than hopeful.
    const h = makeHarness();
    const seed = await seedRecord(h);

    const session = await h.crypto.openRecord(
      { record: h.record, keyWraps: seed.keyWraps }, { as: 'A' },
    );
    const emptied = session.planWraps({}, {});
    session.close();

    const remade = await h.crypto.createRecord({
      record: h.record, owner: 'A', current: emptied.wraps,
    });
    const fresh = remade.session;
    try {
      expect(() => fresh.decryptDoc('projects', 'p_1', { ...seed.stored }))
        .toThrow(/could not be decrypted/);
    } finally {
      fresh.close();
    }
  });

  it('and a re-run that still HAS wraps is refused rather than obeyed, which is the other door', async () => {
    // The same data loss arriving the other way round: minting a second key on a record that
    // already has one strands everything the first key sealed. `createRecord` refuses.
    const h = makeHarness();
    const seed = await seedRecord(h);
    expect(await asyncCodeOf(() =>
      h.crypto.createRecord({ record: h.record, owner: 'A', current: seed.keyWraps }),
    )).toBe('VALIDATION_ERROR');
  });
});
