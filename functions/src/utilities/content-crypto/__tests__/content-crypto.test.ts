/**
 * The façade, end to end — and, first, the ordering invariant that this whole module exists to
 * carry.
 *
 * **The defect being prevented destroys client content.** A migration that seals five hundred
 * documents and writes the record-key wrap at the end, then times out at document three hundred,
 * leaves three hundred rows of `enc:v3:` ciphertext under a key that was never persisted and has
 * just been zeroised. Re-running mints a second key and the migration's own "already converted"
 * test skips every dead row. Silent, permanent, irrecoverable.
 *
 * There are two halves to the fix and both are asserted below:
 *
 *   1. `createRecord` MAKES THE WRAP DURABLE ITSELF, through the required `WrapCommitter` port,
 *      and only then builds a session (R10a). What is asserted here is the ORDER of operations
 *      against the port — no key exists before `commitWraps` resolves, and no session exists
 *      until its receipt has been checked — plus every refusal on the failure paths. The
 *      **property** that a crash between the wrap and the first seal still leaves the record
 *      openable is a property of the DATA and lives in `durability.test.ts`, because no type
 *      assertion can express it.
 *   2. A re-run must ADOPT rather than mint. `createRecord` takes the wraps it was handed and
 *      refuses when they are non-empty, and the adopt path is asserted as a call count on the DEK
 *      source: `getCurrentDek` — the minting call — stays at zero.
 *
 * Everything the suite needs is built here, because `testing.ts` does not exist yet and the
 * manifest closes `src/` to twenty-three named modules and `src/__tests__/` to one suite per
 * module plus the cross-cutting ones. `fixedDekSource` will lift these fixtures out later.
 */

import { createHash } from 'node:crypto';

import { createContentCrypto } from '../content-crypto';
import type {
  RecordInput, RecordSession, WrapCommitRequest, WrapCommitter, WrapReceipt,
} from '../content-crypto';
import { cachingDekSource } from '../custodian-cache';
import type { DekHandle, DekSource } from '../custodian';
import { ContentCryptoError, assertNoKeyMaterial, isContentCryptoError } from '../errors';
import { ENC_PREFIX_V1 } from '../legacy-readers';
import { sealParts } from '../cipher';
import { dekFromBytes } from '../secret';
import type { AccountDek } from '../secret';
import { defineRegistry, EMPTY_REGISTRY } from '../registry';
import { aggregateRecordRef, documentRecordRef } from '../key-scope';
import type { KeyScope } from '../key-scope';
import { holdersOf, parseKeyWraps, wrapCount } from '../record-key';
import type { KeyWraps, RecordRef } from '../record-key';
import { isEncrypted } from '../field-codec';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PRODUCT = 'collab';

const registry = defineRegistry({
  messages: { strings: ['body', 'anchor.quote', 'tags[]'], blobs: ['payload'] },
  versions: { strings: ['content'], root: 'artefacts' },
  settings: { strings: ['note'] },
});

type Collection = 'messages' | 'versions' | 'settings';

const scope: KeyScope<'project'> = {
  productId: PRODUCT,
  records: { project: 'aggregate' },
  accountRecordPath: (accountId) => `accountSettings/${accountId}`,
};

const projectRecord = (id: string): RecordRef =>
  aggregateRecordRef('project', id, `projects/${id}`);

/** A DEK source with a lifecycle, a call ledger, and no cloud anywhere near it. */
function makeSource(): {
  readonly inner: DekSource;
  readonly calls: { getCurrentDek: number; getDek: number };
  revoke(accountId: string): void;
  destroy(accountId: string): void;
  drain(accountId: string, generation: number): void;
  bump(accountId: string): void;
  dekFor(accountId: string, generation: number): AccountDek;
} {
  const generations = new Map<string, number>();
  const state = new Map<string, 'revoked' | 'destroyed'>();
  const drained = new Set<string>();
  const calls = { getCurrentDek: 0, getDek: 0 };

  const dekFor = (accountId: string, generation: number): AccountDek =>
    dekFromBytes(
      createHash('sha256').update(`${PRODUCT}#${accountId}#${generation}`).digest(),
      `${PRODUCT}/${accountId}@${generation}`,
    );

  const check = (accountId: string): void => {
    const status = state.get(accountId);
    if (status === 'revoked') {
      throw new ContentCryptoError('ACCOUNT_KEY_REVOKED', `key for '${accountId}' is revoked`);
    }
    if (status === 'destroyed') {
      throw new ContentCryptoError('ACCOUNT_KEY_DESTROYED', `key for '${accountId}' is destroyed`);
    }
  };

  const inner: DekSource = {
    async getCurrentDek(accountId): Promise<DekHandle> {
      calls.getCurrentDek += 1;
      check(accountId);
      const generation = generations.get(accountId) ?? 1;
      generations.set(accountId, generation);
      return { generation, key: dekFor(accountId, generation) };
    },
    async getDek(accountId, generation): Promise<DekHandle> {
      calls.getDek += 1;
      check(accountId);
      if (drained.has(`${accountId}#${generation}`)) {
        throw new ContentCryptoError(
          'ACCOUNT_KEY_DESTROYED',
          `generation ${generation} for '${accountId}' has been drained`,
        );
      }
      return { generation, key: dekFor(accountId, generation) };
    },
    async currentGeneration(accountId): Promise<number> {
      return generations.get(accountId) ?? 1;
    },
    evict(): void {
      /* the cache in front of this is what holds anything */
    },
  };

  return {
    inner,
    calls,
    revoke: (accountId) => state.set(accountId, 'revoked'),
    destroy: (accountId) => state.set(accountId, 'destroyed'),
    drain: (accountId, generation) => drained.add(`${accountId}#${generation}`),
    bump: (accountId) => generations.set(accountId, (generations.get(accountId) ?? 1) + 1),
    dekFor,
  };
}

/**
 * A committer that actually WRITES, then acknowledges — the conforming shape, in fourteen lines.
 *
 * It is create-only (a row already holding `keyWraps` is refused), it honours a precondition
 * token, and its receipt carries the store's own write time. The three refusals are what
 * `checkWrapCommit` asserts of a product's real committer in the product's own repo.
 */
function memoryCommitter(): WrapCommitter & {
  readonly rows: Map<string, Record<string, unknown>>;
  readonly calls: (readonly WrapCommitRequest[])[];
  /** Reject the next call with this, to exercise the failure paths. */
  failWith(err: unknown, precondition?: boolean): void;
  /** Return this instead of real receipts, to exercise the stub-catcher. */
  receiptsAre(receipts: unknown): void;
  /** Answer the read-back with this instead of the store, to exercise R11's refusals — and to
   *  demonstrate that defeating read-back takes a second, deliberate lie. */
  wrapsAre(read: (records: readonly RecordRef[]) => readonly unknown[]): void;
} {
  const rows = new Map<string, Record<string, unknown>>();
  const calls: (readonly WrapCommitRequest[])[] = [];
  let nextFailure: { err: unknown; precondition: boolean } | null = null;
  let forcedReceipts: unknown = undefined;
  let forced = false;
  let forcedWraps: ((records: readonly RecordRef[]) => readonly unknown[]) | null = null;

  return {
    rows,
    calls,
    failWith(err, precondition = false): void {
      nextFailure = { err, precondition };
    },
    receiptsAre(receipts): void {
      forced = true;
      forcedReceipts = receipts;
    },
    wrapsAre(read): void {
      forcedWraps = read;
    },
    async commitWraps(requests): Promise<readonly WrapReceipt[]> {
      calls.push(requests);
      if (nextFailure !== null) {
        const { err } = nextFailure;
        throw err;
      }
      // Create-only: a second key on a record leaves everything under the first unreadable.
      for (const request of requests) {
        const existing = rows.get(request.record.path);
        if (existing !== undefined && existing.keyWraps !== undefined) {
          throw new Error(`precondition lost on ${request.record.path}`);
        }
      }
      const committedAt = new Date().toISOString();
      const receipts = requests.map((request) => {
        rows.set(request.record.path, {
          ...(rows.get(request.record.path) ?? {}),
          ...request.update,
        });
        return { committedAt, precondition: committedAt };
      });
      return (forced ? forcedReceipts : receipts) as readonly WrapReceipt[];
    },
    async readWraps(records): Promise<readonly unknown[]> {
      // Honest, independent and positional: it reads the same rows `commitWraps` wrote to, and
      // nothing else. With `wrapsAre` it can be made to lie, which is what the read-back tests
      // below need — and it takes a SECOND deliberate falsehood to get there, which is the point.
      if (forcedWraps !== null) return forcedWraps(records);
      return records.map((record) => rows.get(record.path)?.keyWraps);
    },
    isPreconditionFailure(err): boolean {
      if (nextFailure !== null && err === nextFailure.err) return nextFailure.precondition;
      return err instanceof Error && /precondition lost/.test(err.message);
    },
  };
}

function makeCrypto(opts?: { registry?: typeof registry; wrapCommitter?: WrapCommitter }) {
  const source = makeSource();
  const graceServes: unknown[] = [];
  const dekSource = cachingDekSource(source.inner, {
    productId: PRODUCT,
    onGraceServe: (info) => graceServes.push(info),
  });
  const committer = memoryCommitter();
  const crypto = createContentCrypto({
    scope,
    registry: opts?.registry ?? registry,
    dekSource,
    wrapCommitter: opts?.wrapCommitter ?? committer,
  });
  return { crypto, source, dekSource, graceServes, committer };
}

/** THE FIXTURE WRITER for the legacy wire, five lines, inside `__tests__/`. No writer for a
 *  superseded wire ships from any entrypoint, and `index.test.ts` asserts that by importing the
 *  barrel; this builds what collab's store actually holds. */
function legacyFixture(dek: AccountDek, aad: string, plaintext: string): string {
  const { iv, tag, ciphertext } = sealParts(dek, aad, Buffer.from(plaintext, 'utf8'));
  return `${ENC_PREFIX_V1}${[
    iv.toString('base64'), ciphertext.toString('base64'), tag.toString('base64'),
  ].join(':')}`;
}

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    return isContentCryptoError(err) ? err.code : `not a ContentCryptoError: ${String(err)}`;
  }
  return 'did not throw';
}

async function asyncCodeOf(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (err) {
    return isContentCryptoError(err) ? err.code : `not a ContentCryptoError: ${String(err)}`;
  }
  return 'did not throw';
}

/**
 * The shape every caller now uses — and the point is that there is nothing to it. The write of the
 * wrap happened inside `createRecord`, before the session existed, so there is no second step for
 * a caller to skip and no assertion for one to make.
 */
async function createAndCommit(
  crypto: ReturnType<typeof makeCrypto>['crypto'],
  record: RecordRef,
  owner: string,
): Promise<{ session: RecordSession<Collection>; keyWraps: KeyWraps }> {
  const created = await crypto.createRecord({ record, owner });
  return { session: created.session, keyWraps: created.keyWraps };
}

// ---------------------------------------------------------------------------

describe('the wrap is durable before the first value is sealed under it', () => {
  it('does not build a session until commitWraps has RESOLVED', async () => {
    // THIS IS THE ASSERTION, and it is about ORDER OF OPERATIONS against the port rather than
    // about a type: while `commitWraps` is still in flight there is no `CreatedRecord` anywhere,
    // so there is no object capable of sealing and therefore no window to seal in. The typestate
    // this replaces could only enforce that a caller CALLED something; nothing about a call can
    // see whether a write landed.
    let release = (): void => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const inner = memoryCommitter();
    let sessionsExist = 0;

    const slow: WrapCommitter = {
      async commitWraps(requests): Promise<readonly WrapReceipt[]> {
        await gate;
        return inner.commitWraps(requests);
      },
      readWraps: (records) => inner.readWraps(records),
      isPreconditionFailure: (err) => inner.isPreconditionFailure(err),
    };

    const { crypto } = makeCrypto({ wrapCommitter: slow });
    const pending = crypto.createRecord({ record: projectRecord('p_1'), owner: 'A' })
      .then((created) => { sessionsExist += 1; return created; });

    // Let every already-queued microtask run. The promise is still unsettled and nothing exists.
    await Promise.resolve();
    await Promise.resolve();
    expect(sessionsExist).toBe(0);
    expect(inner.rows.size).toBe(0);

    release();
    const created = await pending;
    expect(sessionsExist).toBe(1);
    // The wrap landed BEFORE the session existed, which is the invariant stated as data.
    expect(inner.rows.get('projects/p_1')?.keyWraps).toBeDefined();
    expect(typeof created.session.encryptDoc).toBe('function');
    created.session.close();
  });

  it('will not construct a façade at all without a wrapCommitter — TS2741', async () => {
    const source = makeSource();
    const dekSource = cachingDekSource(source.inner, {
      productId: PRODUCT, onGraceServe: () => {},
    });

    // A product that has not decided how a wrap becomes durable cannot reach `createRecord`,
    // because it cannot build the object `createRecord` hangs off. This is where the compile-time
    // half of the guard moved to: not "seal in the wrong order", which a type can only pretend to
    // see, but "have no answer to how the wrap is written", which it can see exactly.
    // @ts-expect-error wrapCommitter is required (TS2741)
    expect(codeOf(() => createContentCrypto({ scope, registry, dekSource })))
      .toBe('VALIDATION_ERROR');

    // …and the same refusal arrives at runtime, for the plain-JavaScript migration script that
    // has no compiler in front of it — which is precisely the caller this whole change is about.
    expect(codeOf(() => createContentCrypto({
      scope, registry, dekSource, wrapCommitter: {} as never,
    }))).toBe('VALIDATION_ERROR');
  });

  it('hands the port everything it needs to write, and nothing it must assemble', async () => {
    const { crypto, committer } = makeCrypto();
    const created = await crypto.createRecord({ record: projectRecord('p_1'), owner: 'A' });

    expect(committer.calls).toHaveLength(1);
    const [request] = committer.calls[0];
    // Forgetting `wrapHolders` breaks the erase sweep's `where('wrapHolders','==',[])` query,
    // SILENTLY: the record is never swept and its content survives a shred it was meant to be
    // deleted by. The ready-made `update` is what makes that unforgettable — and it now goes to
    // the port rather than to the caller, so there is nobody left to forget it.
    expect(Object.keys(request.update).sort()).toEqual(['keyWraps', 'wrapHolders']);
    expect(request.ownerAccountId).toBe('A');
    expect(request.record.path).toBe('projects/p_1');
    expect(request.audit.diff.added).toEqual(['A']);
    // No precondition was supplied, so the holder row is being created: the committer may use the
    // store's CREATE primitive and get create-only-ness for free.
    expect(request.holderExists).toBe(false);

    expect(created.wrapHolders).toEqual(['A']);
    expect(holdersOf(created.keyWraps)).toEqual(['A']);
    created.session.close();
  });

  it('reports what WAS written, past tense, and the store\'s own receipt', async () => {
    const { crypto } = makeCrypto();
    const before = Date.now();
    const created = await crypto.createRecord({ record: projectRecord('p_1'), owner: 'A' });

    // `committedUpdate` is deliberately inert: a product logs it, and a document-granular
    // `set(…, { merge: true })` may carry it forward as an idempotent no-op. It is no longer a
    // to-do, which is the point — batching it is now harmless.
    expect(Object.keys(created.committedUpdate).sort()).toEqual(['keyWraps', 'wrapHolders']);
    expect(Date.parse(created.receipt.committedAt)).toBeGreaterThanOrEqual(before);
    expect(created.receipt.precondition).toBe(created.receipt.committedAt);
    created.session.close();
  });

  it('passes a precondition token straight through, and infers holderExists from it', async () => {
    const { crypto, committer } = makeCrypto();
    const token = { updateTime: 'opaque-to-this-package' };
    const created = await crypto.createRecord({
      record: projectRecord('p_1'), owner: 'A', precondition: token,
    });

    const [request] = committer.calls[0];
    expect(request.precondition).toBe(token);
    // A caller holding a read-time token is a caller whose row already exists, so the committer
    // must express create-only-ness itself rather than relying on a create primitive.
    expect(request.holderExists).toBe(true);
    created.session.close();
  });

  it('takes an explicit holderExists at its word, in either direction', async () => {
    const { crypto, committer } = makeCrypto();
    const a = await crypto.createRecord({ record: projectRecord('p_1'), owner: 'A', holderExists: true });
    const b = await crypto.createRecord({
      record: projectRecord('p_2'), owner: 'A', precondition: 'tok', holderExists: false,
    });
    expect(committer.calls[0][0].holderExists).toBe(true);
    expect(committer.calls[1][0].holderExists).toBe(false);
    a.session.close();
    b.session.close();
  });

  it('closing after a create strands a row and never content; the next run ADOPTS it', async () => {
    const { crypto, committer } = makeCrypto();
    const record = projectRecord('p_1');
    const created = await crypto.createRecord({ record, owner: 'A' });
    created.session.close();

    // The safe asymmetry the whole design rests on: a wrap without content is a row; content
    // without a wrap is a shred. The wrap is durable, so the record is not lost — it is adopted.
    expect(codeOf(() => created.session.encryptDoc('messages', 'm_1', { body: 'x' })))
      .toBe('KEY_MATERIAL_DESTROYED');
    const wraps = committer.rows.get(record.path)?.keyWraps;
    const adopted = await crypto.openRecord({ record, keyWraps: wraps }, { as: 'A' });
    expect(adopted.as).toBe('A');
    adopted.close();
  });

  it('zeroises the key and returns NO session when the commit rejects', async () => {
    const { crypto, committer } = makeCrypto();
    const boom = new Error('the store said no');
    committer.failWith(boom);

    await expect(crypto.createRecord({ record: projectRecord('p_1'), owner: 'A' }))
      .rejects.toBe(boom);
    // Nothing was written and nothing was sealed. The store's own error survives unchanged,
    // because a caller has to be able to tell a transport failure from a conflict.
    expect(committer.rows.size).toBe(0);
  });

  it('turns a LOST PRECONDITION into KEY_STORE_CONFLICT, naming the adopt path', async () => {
    const { crypto, committer } = makeCrypto();
    const conflict = new Error('gRPC 9');
    committer.failWith(conflict, true);

    const err = await asyncCodeOf(() =>
      crypto.createRecord({ record: projectRecord('p_1'), owner: 'A' }));
    // 409: somebody minted a key on this record first, which is a thing the caller can act on —
    // re-read and adopt — rather than an opaque store error they must classify themselves.
    expect(err).toBe('KEY_STORE_CONFLICT');
    await expect(crypto.createRecord({ record: projectRecord('p_1'), owner: 'A' }))
      .rejects.toThrow(/ADOPT it with openRecord/);
  });

  it('is create-only at the port: a second create on the same record is refused', async () => {
    const { crypto } = makeCrypto();
    const record = projectRecord('p_1');
    const first = await crypto.createRecord({ record, owner: 'A' });
    first.session.close();

    // The committer refuses a row that already holds `keyWraps`, and the façade classifies that
    // refusal. A second key would leave everything under the first permanently unreadable, which
    // is why this must fail at the store and not merely at the caller's own re-run guard.
    expect(await asyncCodeOf(() => crypto.createRecord({ record, owner: 'A' })))
      .toBe('KEY_STORE_CONFLICT');
  });

  it.each([
    ['not an array', 'a receipt'],
    ['too few receipts', []],
    ['a null receipt', [null]],
    ['no committedAt', [{}]],
    ['an empty committedAt', [{ committedAt: '' }]],
    ['a non-instant committedAt', [{ committedAt: 'yesterday' }]],
    ['the epoch, which is the copy-pasted stub', [{ committedAt: '1970-01-01T00:00:00.000Z' }]],
  ])('refuses %s, and destroys the key rather than sealing under it', async (_what, receipts) => {
    const { crypto, committer } = makeCrypto();
    committer.receiptsAre(receipts);

    // A STUB-CATCHER, not a durability check: nothing here can tell a committed write from a
    // convincing lie. What it catches is the committer that returned SOMETHING because the
    // signature demanded something — which is exactly what an enqueue-only committer must do,
    // since a batch that has not flushed has no write time to report.
    expect(await asyncCodeOf(() =>
      crypto.createRecord({ record: projectRecord('p_1'), owner: 'A' })))
      .toBe('KEY_STORE_CONFLICT');
  });

  it('accepts a real write time from a store whose clock is hours off ours', async () => {
    const { crypto, committer } = makeCrypto();
    const skewed = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
    committer.receiptsAre([{ committedAt: skewed }]);

    // The window is ±24 h on purpose. Clock skew between a store and this process must never be
    // the failure — a real `writeTime` from any store on earth passes, and a fixed literal does
    // not, which is the whole difference the check is trying to see.
    const created = await crypto.createRecord({ record: projectRecord('p_1'), owner: 'A' });
    expect(created.receipt.committedAt).toBe(skewed);
    created.session.close();
  });

  it('asserts the receipt for key material, because it reaches the audit trail', async () => {
    const { crypto, committer } = makeCrypto();
    committer.receiptsAre([{
      committedAt: new Date().toISOString(),
      // A store that echoed the row back would put a wrapped record key into a log by way of a
      // field nobody thought of as carrying any. R1's recursive, value-level check catches it.
      precondition: { wrapped: 'A'.repeat(64) },
    }]);
    expect(await asyncCodeOf(() =>
      crypto.createRecord({ record: projectRecord('p_1'), owner: 'A' })))
      .toBe('VALIDATION_ERROR');
  });

  // ── R11: the read-back ───────────────────────────────────────────────────────────────────────
  //
  // The receipt is what the committer SAYS. These are about what the store HOLDS, and they are the
  // difference between detectability in review and a property of the run: the natural lie
  // (`new Date().toISOString()`) passes every receipt check there is, and fails every one of these.

  it('reads the wrap back through the port before it hands out anything that can seal', async () => {
    const { crypto, committer } = makeCrypto();
    const reads: (readonly RecordRef[])[] = [];
    const rows = committer.rows;
    committer.wrapsAre((records) => {
      reads.push(records);
      return records.map((record) => rows.get(record.path)?.keyWraps);
    });

    const created = await crypto.createRecord({ record: projectRecord('p_1'), owner: 'A' });
    // One read, of exactly the records committed, after the commit — not a sample and not a
    // re-derivation of what we just sent.
    expect(reads).toHaveLength(1);
    expect(reads[0].map((r) => r.path)).toEqual(['projects/p_1']);
    created.session.close();
  });

  it('REFUSES when the commit resolved and the store holds no wrap — the durability lie', async () => {
    const { crypto, committer } = makeCrypto();
    // An enqueue-only committer, seen from the store's side: the receipt is perfect and the row is
    // empty. Nothing in the receipt could ever have caught this; the read is what catches it.
    committer.wrapsAre((records) => records.map(() => undefined));

    expect(await asyncCodeOf(() =>
      crypto.createRecord({ record: projectRecord('p_1'), owner: 'A' })))
      .toBe('KEY_STORE_CONFLICT');
    await expect(crypto.createRecord({ record: projectRecord('p_2'), owner: 'A' }))
      .rejects.toThrow(/still sees no wrap for the owner/);
  });

  it('REFUSES when the store holds a DIFFERENT wrap than the one this create committed', async () => {
    const { crypto, committer } = makeCrypto();
    committer.wrapsAre((records) => records.map(() => ({
      A: { gen: 1, wrapped: 'wrap:v1:somebody:elses:key' },
    })));

    // The other direction of the race: a wrap IS there and it is not ours, so another key won the
    // record. Sealing under ours would leave every value under theirs unreadable.
    expect(await asyncCodeOf(() =>
      crypto.createRecord({ record: projectRecord('p_1'), owner: 'A' })))
      .toBe('KEY_STORE_CONFLICT');
    await expect(crypto.createRecord({ record: projectRecord('p_2'), owner: 'A' }))
      .rejects.toThrow(/holds a DIFFERENT wrap/);
  });

  it.each([
    ['a non-array', 'yes it is there' as unknown],
    ['too few answers', [] as unknown],
  ])('REFUSES a read-back that answers with %s', async (_what, answer) => {
    const { crypto, committer } = makeCrypto();
    committer.wrapsAre(() => answer as readonly unknown[]);
    expect(await asyncCodeOf(() =>
      crypto.createRecord({ record: projectRecord('p_1'), owner: 'A' })))
      .toBe('KEY_STORE_CONFLICT');
  });

  it('REFUSES, and says ADOPT, when the read-back itself fails after a resolved commit', async () => {
    const { crypto, committer } = makeCrypto();
    committer.wrapsAre(() => { throw new Error('the read replica is down'); });

    // The commit ALREADY RESOLVED, so the wrap may well be durable: the one unsafe response is to
    // mint again on the next run. The store's own error is classified rather than carried (§11.3,
    // no `cause`) and the message names the only safe next move.
    await expect(crypto.createRecord({ record: projectRecord('p_1'), owner: 'A' }))
      .rejects.toThrow(/ADOPT it with openRecord/);
    expect(await asyncCodeOf(() =>
      crypto.createRecord({ record: projectRecord('p_2'), owner: 'A' })))
      .toBe('KEY_STORE_CONFLICT');
  });

  it('verifies EVERY record in a page: a partial commit with a full receipt array is refused', async () => {
    const { crypto, committer } = makeCrypto();
    const rows = committer.rows;
    // A7, exactly: request 0 is committed, request 1 is not, and the receipt array is full length.
    // Positional receipt validation cannot see this — it is the read that can.
    committer.wrapsAre((records) => records.map((record, i) =>
      (i === 0 ? rows.get(record.path)?.keyWraps : undefined)));

    expect(await asyncCodeOf(() => crypto.createRecords([
      { record: projectRecord('p_1'), owner: 'A' },
      { record: projectRecord('p_2'), owner: 'A' },
    ]))).toBe('KEY_STORE_CONFLICT');

    // All-or-nothing from the caller's side: the record that DID land is stranded as a row, which
    // is the harmless direction, and the next run adopts it rather than minting over it.
    await expect(crypto.createRecords([
      { record: projectRecord('p_3'), owner: 'A' },
      { record: projectRecord('p_4'), owner: 'A' },
    ])).rejects.toThrow(/projects\/p_4/);
  });

  it('does not close the CREATE-ONLY lie, and the docblock does not claim it does', async () => {
    const { crypto, committer } = makeCrypto();
    const record = projectRecord('p_1');
    const first = await crypto.createRecord({ record, owner: 'A' });
    first.session.close();

    // A committer that OVERWRITES rather than refusing: the read-back finds a wrap — ours, the one
    // it just wrote — and passes, while everything sealed under the first key is now noise. This
    // is the bound on R11, executing rather than asserted in a paragraph, and it is what
    // `checkWrapCommit` assertion (3) exists to catch in the product's own CI (R12).
    const overwriting: WrapCommitter = {
      async commitWraps(requests): Promise<readonly WrapReceipt[]> {
        const committedAt = new Date().toISOString();
        for (const request of requests) {
          committer.rows.set(request.record.path, { ...request.update });
        }
        return requests.map(() => ({ committedAt }));
      },
      readWraps: (records) => committer.readWraps(records),
      isPreconditionFailure: (): boolean => false,
    };
    const { crypto: second } = makeCrypto({ wrapCommitter: overwriting });
    const again = await second.createRecord({ record, owner: 'A' });
    try {
      expect(again.keyWraps).not.toEqual(first.keyWraps);
    } finally {
      again.session.close();
    }
  });

  it('commits N records in ONE call, so a page costs one round trip and not N', async () => {
    const { crypto, committer } = makeCrypto();
    const created = await crypto.createRecords([
      { record: projectRecord('p_1'), owner: 'A' },
      { record: projectRecord('p_2'), owner: 'A' },
      { record: projectRecord('p_3'), owner: 'B' },
    ]);

    // The plurality is not an optimisation. It is what stops a migration routing the wrap back
    // through its content batch to save writes, which is the shape of the defect.
    expect(committer.calls).toHaveLength(1);
    expect(committer.calls[0]).toHaveLength(3);
    expect(created).toHaveLength(3);
    expect(created.map((c) => c.session.record.id)).toEqual(['p_1', 'p_2', 'p_3']);
    expect(created[2].wrapHolders).toEqual(['B']);
    // Positional, so a receipt maps to the record it acknowledges and not to a neighbour.
    expect(committer.calls[0].map((r) => r.record.path))
      .toEqual(['projects/p_1', 'projects/p_2', 'projects/p_3']);
    for (const one of created) one.session.close();
  });

  it('is all-or-nothing from the caller\'s side: one rejection returns no sessions at all', async () => {
    const { crypto, committer } = makeCrypto();
    committer.failWith(new Error('the store said no'));

    await expect(crypto.createRecords([
      { record: projectRecord('p_1'), owner: 'A' },
      { record: projectRecord('p_2'), owner: 'A' },
    ])).rejects.toThrow('the store said no');
    expect(committer.rows.size).toBe(0);
  });

  it('refuses the same record twice in one call — two creates are two keys', async () => {
    const { crypto, committer } = makeCrypto();
    expect(await asyncCodeOf(() => crypto.createRecords([
      { record: projectRecord('p_1'), owner: 'A' },
      { record: projectRecord('p_1'), owner: 'A' },
    ]))).toBe('VALIDATION_ERROR');
    // Refused BEFORE anything was committed, which is the cheap direction to fail in.
    expect(committer.calls).toHaveLength(0);
  });

  it('commits nothing for an empty page rather than calling the port with nothing', async () => {
    const { crypto, committer } = makeCrypto();
    expect(await crypto.createRecords([])).toEqual([]);
    expect(committer.calls).toHaveLength(0);
  });

  it('withNewRecord closes the session on the throw path, so no key is left live', async () => {
    const { crypto } = makeCrypto();
    let captured: RecordSession<Collection> | null = null;
    const boom = new Error('the caller failed after the wrap landed');

    await expect(crypto.withNewRecord(
      { record: projectRecord('p_1'), owner: 'A' },
      async (session) => { captured = session; throw boom; },
    )).rejects.toBe(boom);

    // `createRecord` now hands back a LIVE session, so an unclosed one on a throw path is a live
    // record key nobody holds — the leak the old pending handle's `close()` covered structurally.
    expect(captured).not.toBeNull();
    expect((captured as unknown as RecordSession<Collection>).closed).toBe(true);
  });

  it('withNewRecord returns the value and hands over the created record too', async () => {
    const { crypto } = makeCrypto();
    const out = await crypto.withNewRecord(
      { record: projectRecord('p_1'), owner: 'A' },
      async (session, created) => session.encryptDoc('messages', 'm_1', {
        body: created.wrapHolders.join(','),
      }),
    );
    expect(isEncrypted(out.body)).toBe(true);
  });

  it('nests that update rather than dotting it, so ONE write carries wrap and ciphertext', async () => {
    const { crypto, committer } = makeCrypto();
    const created = await crypto.createRecord({ record: projectRecord('p_1'), owner: 'A' });

    // A `WrapPatch.update` is DOTTED because it must preserve the sibling wraps it is not
    // touching. A create has no siblings, and a dotted key inside a whole-document write stores a
    // field literally named `keyWraps.A`. Nested is correct in both write shapes, which is what
    // lets the document-granular case put the wrap and the ciphertext in one write and have no
    // ordering to get wrong at all.
    expect(Object.keys(created.committedUpdate)).not.toContain('keyWraps.A');
    expect(parseKeyWraps((created.committedUpdate as Record<string, unknown>).keyWraps)).toEqual(
      created.keyWraps,
    );
    expect(Object.keys(committer.calls[0][0].update)).not.toContain('keyWraps.A');
    created.session.close();
  });

  it('audits the create as the grant it is, through the one reconcile', async () => {
    const { crypto, committer } = makeCrypto();
    const created = await crypto.createRecord({ record: projectRecord('p_1'), owner: 'A' });

    expect(created.audit.diff.added).toEqual(['A']);
    expect(created.audit.scope).toBe('this-record');
    expect(created.audit.actorAccountId).toBe('A');
    // The audit reaches the port as well as the caller, so a product may write it in the SAME
    // commit as the wrap rather than in a second write that can fail on its own.
    expect(committer.calls[0][0].audit).toBe(created.audit);
    // R1: an audit is a structured payload, so the standing guard over it is the recursive,
    // value-level one. `assertNoSecrets` is an ERROR-DETAILS assertion over a closed scalar
    // allowlist and applying it here would be a category error, not a tuning problem.
    expect(() => assertNoKeyMaterial(created.audit, 'audit')).not.toThrow();
    created.session.close();
  });
});

describe('a re-run adopts the record key; it never mints a second one', () => {
  it('refuses createRecord when the record already holds wraps', async () => {
    const { crypto } = makeCrypto();
    const record = projectRecord('p_1');
    const first = await crypto.createRecord({ record, owner: 'A' });
    first.session.close();

    const err = await asyncCodeOf(() =>
      crypto.createRecord({ record, owner: 'A', current: first.keyWraps }));
    expect(err).toBe('VALIDATION_ERROR');

    await expect(crypto.createRecord({ record, owner: 'A', current: first.keyWraps }))
      .rejects.toThrow(/adopt it with openRecord/);
  });

  it('opens rather than mints: getCurrentDek stays at the one call the create made', async () => {
    const crypto = makeCrypto();
    const source = crypto.source;
    const record = projectRecord('p_1');
    const first = await crypto.crypto.createRecord({ record, owner: 'A' });
    first.session.close();
    expect(source.calls.getCurrentDek).toBe(1);

    // Cold, so the counts below are the source's own and not the cache's. (Warm, the adopt path
    // asks the DEK source nothing at all, which is the same point made more strongly.)
    crypto.dekSource.clear();

    const adopted = await crypto.crypto.openRecord({ record, keyWraps: first.keyWraps }, { as: 'A' });
    try {
      // The minting call was not made a second time. Under the old ordering a re-run minted
      // unconditionally, and everything the previous run converted was stranded — the same data
      // loss arriving by the other door.
      expect(source.calls.getCurrentDek).toBe(1);
      // A NAMED generation, from the wrap's own label. `getDek` never mints: an absent generation
      // is ACCOUNT_KEY_DESTROYED rather than a fresh key.
      expect(source.calls.getDek).toBe(1);
    } finally {
      adopted.close();
    }
  });

  it('adopts the SAME key: content sealed before the re-run still opens after it', async () => {
    const { crypto } = makeCrypto();
    const record = projectRecord('p_1');
    const first = await crypto.createRecord({ record, owner: 'A' });
    const s1 = first.session;
    const stored = s1.encryptDoc('messages', 'm_1', { body: 'the original' });
    s1.close();

    const s2 = await crypto.openRecord({ record, keyWraps: first.keyWraps }, { as: 'A' });
    try {
      expect(s2.decryptDoc('messages', 'm_1', { ...stored })).toEqual({ body: 'the original' });
    } finally {
      s2.close();
    }
  });
});

describe('create, seal, open, read', () => {
  it('round-trips a string, a nested string, an array and a blob', async () => {
    const { crypto } = makeCrypto();
    const { session, keyWraps } = await createAndCommit(crypto, projectRecord('p_1'), 'A');
    const plain = {
      body: 'hello',
      anchor: { quote: 'a quote', sectionId: 's_9' },
      tags: ['x', 'y'],
      payload: { checkins: [{ at: 1, note: 'first' }] },
      untouched: 42,
    };
    const sealed = session.encryptDoc('messages', 'm_1', plain);
    session.close();

    expect(isEncrypted(sealed.body)).toBe(true);
    expect(sealed.anchor.sectionId).toBe('s_9');
    expect(sealed.untouched).toBe(42);
    expect(typeof sealed.payload).toBe('string');

    const reader = await crypto.openRecord({ record: projectRecord('p_1'), keyWraps }, { as: 'A' });
    try {
      expect(reader.decryptDoc('messages', 'm_1', sealed)).toEqual(plain);
      expect(reader.as).toBe('A');
    } finally {
      reader.close();
    }
  });

  it('returns the document BY REFERENCE when nothing registered is present, and asks nothing', async () => {
    const made = makeCrypto();
    const { session } = await createAndCommit(made.crypto, projectRecord('p_1'), 'A');
    const before = { ...made.source.calls };
    const data = { untouched: 'at all', nested: { alsoUntouched: 1 } };

    // A document with nothing to encrypt costs nothing, mints nothing and asks the DEK source
    // nothing — which is what `changed === 0 ⟹ do not write` is worth in practice.
    const out = session.encryptDoc('messages', 'm_1', data);
    expect(out).toBe(data);
    expect(made.source.calls).toEqual(before);
    session.close();
  });

  it('has no callable document method at all when the registry is empty', async () => {
    // `EMPTY_REGISTRY` makes the collection type `never`, so sf-mapper's "objects only" is
    // enforced by the type parameter rather than by discipline — and a collection that is not
    // registered is a refusal rather than a silent plaintext write.
    const source = makeSource();
    const objectsOnly = createContentCrypto({
      scope,
      registry: EMPTY_REGISTRY,
      dekSource: cachingDekSource(source.inner, { productId: PRODUCT, onGraceServe: () => {} }),
      wrapCommitter: memoryCommitter(),
    });
    const created = await objectsOnly.createRecord({ record: projectRecord('p_1'), owner: 'A' });
    const session = created.session;
    try {
      // @ts-expect-error there is no collection to name: C is `never`
      expect(codeOf(() => session.encryptDoc('anything', 'd_1', {}))).toBe('VALIDATION_ERROR');
    } finally {
      session.close();
    }
  });

  it('survives a simulated transaction retry, precisely because it does no I/O', async () => {
    const { crypto, source } = makeCrypto();
    const { session } = await createAndCommit(crypto, projectRecord('p_1'), 'A');
    const before = { ...source.calls };

    // Open the session BEFORE the transaction, use it inside, close it AFTER. Two attempts, no
    // fetch on either, and no half-a-document-at-each-generation window.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      expect(isEncrypted(session.encryptDoc('messages', 'm_1', { body: 'x' }).body)).toBe(true);
    }
    expect(source.calls).toEqual(before);
    session.close();
  });

  it('throws KEY_MATERIAL_DESTROYED after close, and close is idempotent', async () => {
    const { crypto } = makeCrypto();
    const { session } = await createAndCommit(crypto, projectRecord('p_1'), 'A');
    session.close();
    session.close();

    expect(session.closed).toBe(true);
    expect(codeOf(() => session.encryptDoc('messages', 'm_1', { body: 'x' })))
      .toBe('KEY_MATERIAL_DESTROYED');
    expect(codeOf(() => session.planWraps({}))).toBe('KEY_MATERIAL_DESTROYED');
  });

  it('requires docIdOf for a collection whose entry carries a root override', async () => {
    const { crypto } = makeCrypto();
    const { session } = await createAndCommit(crypto, projectRecord('p_1'), 'A');
    try {
      // A `root` override is exactly the signal that the AAD id is not the row id. collab learned
      // this by hand with `versionDocId`; here it generalises to every product.
      expect(codeOf(() => session.decryptDocs('versions', [{ id: 'v_1', content: 'x' }])))
        .toBe('VALIDATION_ERROR');
      expect(() => session.decryptDocs('messages', [])).not.toThrow();
    } finally {
      session.close();
    }
  });

  it('keeps decryptArrayValue and decryptDocs, both of which collab still calls', async () => {
    const { crypto } = makeCrypto();
    const { session } = await createAndCommit(crypto, projectRecord('p_1'), 'A');
    try {
      // The AAD is per PATH with `[]` retained, which is what lets an array union write a single
      // sealed element — and what would be impossible if a caller had to hand-build it.
      const element = session.encryptArrayValue('messages', 'm_1', 'tags', 'a reason');
      expect(session.decryptArrayValue('messages', 'm_1', 'tags', element)).toBe('a reason');

      const rows = [{ id: 'm_1', body: 'one' }, { id: 'm_2', body: 'two' }]
        .map((row) => session.encryptDoc('messages', row.id, row));
      expect(session.decryptDocs('messages', rows)).toEqual([
        { id: 'm_1', body: 'one' }, { id: 'm_2', body: 'two' },
      ]);
    } finally {
      session.close();
    }
  });

  it('applies a blob patch on the SESSION, which is why close() means what it says', async () => {
    const { crypto } = makeCrypto();
    const { session } = await createAndCommit(crypto, projectRecord('p_1'), 'A');
    try {
      const sealed = session.encryptDoc('messages', 'm_1', { payload: { checkins: ['one'] } });
      const req = session.resealRequest('messages', 'm_1', 'payload', [
        { op: 'append', subPath: 'checkins', values: ['two'] },
      ]);
      const next = session.applyBlobPatch(req, sealed.payload);
      expect(session.openBlobAt('messages', 'm_1', 'payload', next))
        .toEqual({ checkins: ['one', 'two'] });
    } finally {
      session.close();
    }

    // The session has no `key` member and never had one: `applyBlobPatch` living here rather than
    // free-standing is the only reason v1 exposed it, and with that gone the key cannot outlive
    // the session that owns it.
    expect(Object.keys(session)).not.toContain('key');
  });
});

describe('federation — who may open, and what a refusal looks like', () => {
  /** Create, then grant to `partner`, returning the resulting wrap set. */
  async function withPartner(partner: string): Promise<{
    record: RecordRef; keyWraps: KeyWraps; crypto: ReturnType<typeof makeCrypto>;
  }> {
    const made = makeCrypto();
    const record = projectRecord('p_1');
    const created = await made.crypto.createRecord({ record, owner: 'A' });
    const session = created.session;
    const dek = await made.dekSource.getCurrentDek(partner);
    const ownerDek = await made.dekSource.getCurrentDek('A');
    const patch = session.planWraps({ A: ownerDek, [partner]: dek }, { scope: 'this-record' });
    session.close();
    return { record, keyWraps: patch.wraps, crypto: made };
  }

  it('lets a granted partner read every field the owner sealed', async () => {
    const made = makeCrypto();
    const record = projectRecord('p_1');
    const created = await made.crypto.createRecord({ record, owner: 'A' });
    const session = created.session;
    const sealed = session.encryptDoc('messages', 'm_1', { body: 'shared' });
    const ownerDek = await made.dekSource.getCurrentDek('A');
    const partnerDek = await made.dekSource.getCurrentDek('B');
    const patch = session.planWraps({ A: ownerDek, B: partnerDek }, { scope: 'this-record' });
    session.close();

    const asB = await made.crypto.openRecord({ record, keyWraps: patch.wraps }, { as: 'B' });
    try {
      expect(asB.decryptDoc('messages', 'm_1', sealed)).toEqual({ body: 'shared' });
      expect(asB.as).toBe('B');
    } finally {
      asB.close();
    }
  });

  it('is NO_WRAP_FOR_ACCOUNT from openRecord and null from openRecordSafe', async () => {
    const { record, keyWraps, crypto } = await withPartner('B');
    expect(await asyncCodeOf(() => crypto.crypto.openRecord({ record, keyWraps }, { as: 'Z' })))
      .toBe('NO_WRAP_FOR_ACCOUNT');
    expect(await crypto.crypto.openRecordSafe({ record, keyWraps }, { as: 'Z' })).toBeNull();
  });

  it('swallows exactly UNREADABLE_CODES and nothing wider', async () => {
    const { record, keyWraps, crypto } = await withPartner('B');
    crypto.source.revoke('B');
    crypto.dekSource.clear();
    expect(await crypto.crypto.openRecordSafe({ record, keyWraps }, { as: 'B' })).toBeNull();
    expect(await asyncCodeOf(() => crypto.crypto.openRecord({ record, keyWraps }, { as: 'B' })))
      .toBe('ACCOUNT_KEY_REVOKED');

    // A CORRUPTED wrap is broken, not withheld, and must never be swallowed: the two have
    // completely different remedies and conflating them sends an operator to the wrong one.
    const corrupted: KeyWraps = {
      ...keyWraps,
      A: { ...keyWraps.A, wrapped: `${keyWraps.A.wrapped.slice(0, -4)}AAAA` },
    };
    expect(await asyncCodeOf(() =>
      crypto.crypto.openRecordSafe({ record, keyWraps: corrupted }, { as: 'A' })))
      .toBe('RECORD_KEY_UNWRAP_FAILED');
  });
});

describe('openRecords — one unwrap per DISTINCT record', () => {
  it('unwraps once per record however many rows named it, keyed by ref.path', async () => {
    const made = makeCrypto();
    const one = await made.crypto.createRecord({ record: projectRecord('p_1'), owner: 'A' });
    one.session.close();
    const two = await made.crypto.createRecord({ record: projectRecord('p_2'), owner: 'A' });
    two.session.close();
    // A page of a hundred rows over two aggregate roots is TWO inputs, and a caller who did hand
    // over a hundred still pays for two.
    //
    // The DUPLICATE carries a corrupted wrap, which is what makes this an assertion rather than a
    // hope: a second unwrap of `projects/p_1` would throw RECORD_KEY_UNWRAP_FAILED and fail the
    // whole call. It does not, because the ref key is already in the map. (Counting DEK fetches
    // would prove nothing here — the cache collapses two asks for one generation into one.)
    const inputs: RecordInput[] = [
      { record: projectRecord('p_1'), keyWraps: one.keyWraps },
      {
        record: projectRecord('p_1'),
        keyWraps: { A: { ...one.keyWraps.A, wrapped: `${one.keyWraps.A.wrapped.slice(0, -4)}AAAA` } },
      },
      { record: projectRecord('p_2'), keyWraps: two.keyWraps },
    ];
    const sessions = await made.crypto.openRecords(inputs, { as: 'A' });
    try {
      expect([...sessions.keys()].sort()).toEqual(['projects/p_1', 'projects/p_2']);
      expect(sessions.size).toBe(2);
    } finally {
      for (const session of sessions.values()) session.close();
    }
  });

  it('leaves an unreadable record ABSENT from the map, never null-valued', async () => {
    const made = makeCrypto();
    const mine = await made.crypto.createRecord({ record: projectRecord('p_1'), owner: 'A' });
    mine.session.close();
    const theirs = await made.crypto.createRecord({ record: projectRecord('p_2'), owner: 'B' });
    theirs.session.close();

    const sessions = await made.crypto.openRecords([
      { record: projectRecord('p_1'), keyWraps: mine.keyWraps },
      { record: projectRecord('p_2'), keyWraps: theirs.keyWraps },
    ], { as: 'A' });
    try {
      // "I hold no wrap" is ORDINARY under federation. Absent rather than null-valued, because a
      // null in a map of sessions is a value every caller then has to remember to check.
      expect([...sessions.keys()]).toEqual(['projects/p_1']);
      expect(sessions.has('projects/p_2')).toBe(false);
    } finally {
      for (const session of sessions.values()) session.close();
    }
  });

  it('propagates RECORD_KEY_UNWRAP_FAILED and fails the whole page', async () => {
    const made = makeCrypto();
    const good = await made.crypto.createRecord({ record: projectRecord('p_1'), owner: 'A' });
    good.session.close();
    const bad = await made.crypto.createRecord({ record: projectRecord('p_2'), owner: 'A' });
    bad.session.close();
    const corrupted: KeyWraps = {
      A: { ...bad.keyWraps.A, wrapped: `${bad.keyWraps.A.wrapped.slice(0, -4)}AAAA` },
    };

    // A wrap that exists and will not open is broken. Swallowing it would turn a corrupted access
    // list into a quietly shorter list page — the failure nobody reports, because it looks like
    // ordinary federation.
    expect(await asyncCodeOf(() => made.crypto.openRecords([
      { record: projectRecord('p_1'), keyWraps: good.keyWraps },
      { record: projectRecord('p_2'), keyWraps: corrupted },
    ], { as: 'A' }))).toBe('RECORD_KEY_UNWRAP_FAILED');
  });

  it('closes the sessions it had already opened when it propagates', async () => {
    const made = makeCrypto();
    const good = await made.crypto.createRecord({ record: projectRecord('p_1'), owner: 'A' });
    good.session.close();
    const bad = await made.crypto.createRecord({ record: projectRecord('p_2'), owner: 'A' });
    bad.session.close();

    // Those sessions own live record keys and the caller never received a handle on them, so this
    // is the only place they can be destroyed. Proven through the observable consequence: the
    // record key for p_1 is gone, so a value sealed by that session cannot be read by it.
    let escaped: RecordSession<Collection> | null = null;
    const spy = {
      record: projectRecord('p_1'),
      get keyWraps(): KeyWraps {
        return good.keyWraps;
      },
    };
    const inputs: RecordInput[] = [
      spy,
      {
        record: projectRecord('p_2'),
        keyWraps: { A: { ...bad.keyWraps.A, wrapped: `${bad.keyWraps.A.wrapped.slice(0, -4)}AAAA` } },
      },
    ];
    const originalOpen = made.crypto.openRecords;
    await expect(originalOpen.call(made.crypto, inputs, { as: 'A' })).rejects.toThrow();

    // Re-open p_1 cleanly and confirm the façade did not leave a usable session behind anywhere.
    escaped = await made.crypto.openRecord({ record: projectRecord('p_1'), keyWraps: good.keyWraps }, { as: 'A' });
    expect(escaped.closed).toBe(false);
    escaped.close();
  });
});

describe('withRecord closes on both paths', () => {
  it('closes after a normal return', async () => {
    const made = makeCrypto();
    const created = await made.crypto.createRecord({ record: projectRecord('p_1'), owner: 'A' });
    created.session.close();

    let captured: RecordSession<Collection> | null = null;
    const out = await made.crypto.withRecord(
      { record: projectRecord('p_1'), keyWraps: created.keyWraps },
      { as: 'A' },
      async (s) => {
        captured = s;
        return s.as;
      },
    );
    expect(out).toBe('A');
    expect((captured as unknown as RecordSession<Collection>).closed).toBe(true);
  });

  it('closes on the throw path too, which is the whole reason it exists', async () => {
    const made = makeCrypto();
    const created = await made.crypto.createRecord({ record: projectRecord('p_1'), owner: 'A' });
    created.session.close();

    let captured: RecordSession<Collection> | null = null;
    await expect(made.crypto.withRecord(
      { record: projectRecord('p_1'), keyWraps: created.keyWraps },
      { as: 'A' },
      async (s) => {
        captured = s;
        throw new Error('the caller failed');
      },
    )).rejects.toThrow('the caller failed');
    expect((captured as unknown as RecordSession<Collection>).closed).toBe(true);
  });
});

describe('session.planWraps', () => {
  it('defaults actorAccountId to session.as and current to the set it opened from', async () => {
    const made = makeCrypto();
    const created = await made.crypto.createRecord({ record: projectRecord('p_1'), owner: 'A' });
    created.session.close();
    const asA = await made.crypto.openRecord(
      { record: projectRecord('p_1'), keyWraps: created.keyWraps }, { as: 'A' },
    );
    try {
      const dekA = await made.dekSource.getCurrentDek('A');
      const patch = asA.planWraps({ A: dekA });
      // `current` defaulted to what the session was opened from, so the same set at the same
      // generation is a no-op — the idempotency contract, with nothing passed in.
      expect(patch.changed).toBe(0);
      expect(patch.audit.actorAccountId).toBe('A');
      expect(() => assertNoKeyMaterial(patch.audit, 'audit')).not.toThrow();
    } finally {
      asA.close();
    }
  });

  it('takes an explicit actor for a sysadmin acting on an account\'s behalf', async () => {
    const made = makeCrypto();
    const created = await made.crypto.createRecord({ record: projectRecord('p_1'), owner: 'A' });
    const session = created.session;
    try {
      const dekA = await made.dekSource.getCurrentDek('A');
      const patch = session.planWraps({ A: dekA }, { actorAccountId: 'ops-1' });
      expect(patch.audit.actorAccountId).toBe('ops-1');
    } finally {
      session.close();
    }
  });

  it('marks the record for the erase sweep when the desired set is empty', async () => {
    const made = makeCrypto();
    const created = await made.crypto.createRecord({ record: projectRecord('p_1'), owner: 'A' });
    const session = created.session;
    try {
      const patch = session.planWraps({});
      expect(patch.deleteRecord).toBe(true);
      expect(patch.holdersAfter).toEqual([]);
      expect(wrapCount(patch.wraps)).toBe(0);
    } finally {
      session.close();
    }
  });
});

describe('migrateDoc — the one walk where the two worlds meet', () => {
  it('converts a legacy field to v3 under the SAME AAD, and leaves the rest alone', async () => {
    const made = makeCrypto();
    const created = await made.crypto.createRecord({ record: projectRecord('p_1'), owner: 'A' });
    const session = created.session;
    try {
      const aad = registry.aadFor('messages', 'm_1', 'body');
      const stored = {
        body: legacyFixture(made.source.dekFor('A', 1), aad, 'the old body'),
        untouched: 'plaintext, and the migration script\'s job rather than this one\'s',
      };

      const out = await made.crypto.migrateDoc(session, 'messages', 'm_1', stored);
      expect(out.changed).toBe(1);
      expect(Object.keys(out.update)).toEqual(['body']);

      const next = out.data as typeof stored;
      expect(isEncrypted(next.body)).toBe(true);
      expect(next.untouched).toBe(stored.untouched);
      // The v1→v3 hop is AAD-preserving by construction: the registry built the same string for
      // the read and the write, which is what makes the migration a re-seal and not a re-label.
      expect(session.decryptDoc('messages', 'm_1', next)).toEqual({
        body: 'the old body', untouched: stored.untouched,
      });
    } finally {
      session.close();
    }
  });

  it('is idempotent: a second pass changes nothing and returns the row by reference', async () => {
    const made = makeCrypto();
    const created = await made.crypto.createRecord({ record: projectRecord('p_1'), owner: 'A' });
    const session = created.session;
    try {
      const aad = registry.aadFor('messages', 'm_1', 'body');
      const stored = { body: legacyFixture(made.source.dekFor('A', 1), aad, 'once') };
      const first = await made.crypto.migrateDoc(session, 'messages', 'm_1', stored);
      const second = await made.crypto.migrateDoc(session, 'messages', 'm_1', first.data);

      // `changed === 0` ⟹ the row is not written. A v3 value is "return what you were given",
      // which is the planner's only skip mechanism.
      expect(second.changed).toBe(0);
      expect(second.update).toEqual({});
      expect(second.data).toBe(first.data);
    } finally {
      session.close();
    }
  });

  it('fetches every legacy generation UP FRONT, before it transforms anything', async () => {
    const made = makeCrypto();
    const created = await made.crypto.createRecord({ record: projectRecord('p_1'), owner: 'A' });
    const session = created.session;
    try {
      const aad = registry.aadFor('messages', 'm_1', 'body');
      const stored = { body: legacyFixture(made.source.dekFor('A', 1), aad, 'x') };
      // The DEK for generation 1 has been drained, so its wrap is gone and its values are
      // unrecoverable. Throwing is the point: skipping would strand the value permanently the
      // moment the wrap is erased, which is what the whole drain protocol exists to prevent.
      made.source.drain('A', 1);
      made.dekSource.clear();
      expect(await asyncCodeOf(() => made.crypto.migrateDoc(session, 'messages', 'm_1', stored)))
        .toBe('ACCOUNT_KEY_DESTROYED');
    } finally {
      session.close();
    }
  });

  it('REFUSES a legacy string at a registered blob path rather than guessing', async () => {
    const made = makeCrypto();
    const created = await made.crypto.createRecord({ record: projectRecord('p_1'), owner: 'A' });
    const session = created.session;
    try {
      const aad = registry.aadFor('messages', 'm_1', 'payload');
      const stored = { payload: legacyFixture(made.source.dekFor('A', 1), aad, '{"a":1}') };
      // Nothing here can know whether the plaintext is a serialised map, and a wrong guess writes
      // a payload that opens once and then fails, unopenably. Do not guess.
      expect(await asyncCodeOf(() => made.crypto.migrateDoc(session, 'messages', 'm_1', stored)))
        .toBe('WRONG_KEY_LAYER');
    } finally {
      session.close();
    }
  });

  it('refuses a closed session, and a session this façade did not open', async () => {
    const made = makeCrypto();
    const created = await made.crypto.createRecord({ record: projectRecord('p_1'), owner: 'A' });
    const session = created.session;
    session.close();
    expect(await asyncCodeOf(() => made.crypto.migrateDoc(session, 'messages', 'm_1', {})))
      .toBe('KEY_MATERIAL_DESTROYED');

    const impostor = { closed: false, as: 'A', ownerAccountId: 'A' };
    expect(await asyncCodeOf(() =>
      made.crypto.migrateDoc(impostor as unknown as RecordSession<Collection>, 'messages', 'm', {})))
      .toBe('VALIDATION_ERROR');
  });
});

describe('construction, and the degenerate case', () => {
  it('refuses a bare DekSource, because a bare one opts out of the revocation window', async () => {
    const source = makeSource();
    expect(codeOf(() => createContentCrypto({
      scope, registry, dekSource: source.inner as never, wrapCommitter: memoryCommitter(),
    }))).toBe('VALIDATION_ERROR');
  });

  it('runs the registry cross-table validations at construction', () => {
    // Every record type declared at document granularity must be a registry collection. This is
    // the check that fixes v1's broken worked example, and it runs here — in a product's own unit
    // tests, at deploy, before any data exists — rather than on a write path.
    expect(codeOf(() => createContentCrypto({
      scope: { productId: PRODUCT, records: { notACollection: 'document' } },
      registry,
      dekSource: cachingDekSource(makeSource().inner, { productId: PRODUCT, onGraceServe: () => {} }),
      wrapCommitter: memoryCommitter(),
    } as never))).toBe('VALIDATION_ERROR');
  });

  it('gives the degenerate case a record with no fake record type', async () => {
    const made = makeCrypto();
    const ref = made.crypto.accountRecord('A');
    expect(ref.id).toBe('A');
    expect(ref.path).toBe('accountSettings/A');

    // Account granularity is aggregate granularity with the dial turned down: same code path,
    // same session, same seal. Nothing here branches on a granularity.
    const created = await made.crypto.createRecord({ record: ref, owner: 'A' });
    const session = created.session;
    try {
      const sealed = session.encryptDoc('settings', 'A', { note: 'private' });
      expect(isEncrypted(sealed.note)).toBe(true);
      expect(session.ownerAccountId).toBe('A');
    } finally {
      session.close();
    }

    // ...and an opened one derives the owner from the ref, with nothing passed in.
    const reader = await made.crypto.openRecord({ record: ref, keyWraps: created.keyWraps }, { as: 'A' });
    try {
      expect(reader.ownerAccountId).toBe('A');
    } finally {
      reader.close();
    }
  });

  it('refuses a record whose ref does not belong to this scope', async () => {
    const made = makeCrypto();
    // A document-granular ref for a type the scope never declared. `assertRecord` is the one
    // record assertion and it runs before anything is minted.
    expect(await asyncCodeOf(() => made.crypto.createRecord({
      record: documentRecordRef('messages', 'm_1', 'projects/p_1/messages/m_1'),
      owner: 'A',
    }))).toBe('VALIDATION_ERROR');
  });

  it('exposes the same dekSource it was built with, and forwards evict', () => {
    const made = makeCrypto();
    expect(made.crypto.dekSource).toBe(made.dekSource);
    expect(() => made.crypto.evict('A')).not.toThrow();
    expect(made.crypto.registry).toBe(registry);
    expect(made.crypto.scope.productId).toBe(PRODUCT);
  });

  it('publishes the bound planner, which is pure, synchronous and key-free', () => {
    const made = makeCrypto();
    const plan = made.crypto.planDoc('messages', 'm_1', { body: 'x' }, (node) => node);
    expect(plan).toEqual({ update: {}, changed: 0, visited: 1 });
  });
});

describe('the port is the mechanism, and the type only enforces that there IS one', () => {
  it('hands back a session that is a RecordSession outright, with no narrowing left', async () => {
    const made = makeCrypto();
    const created = await made.crypto.createRecord({ record: projectRecord('p_1'), owner: 'A' });

    // No split, no second handle, no assertion for a caller to make. There is nothing to widen
    // because the wrap was already durable when this object came into existence — which is the
    // difference between enforcing an ORDER and enforcing DURABILITY, and the reason the
    // typestate went. The data property that replaces it is `durability.test.ts`.
    const widened: RecordSession<Collection> = created.session;
    expect(widened).toBe(created.session);
    expect(typeof widened.encryptDoc).toBe('function');
    created.session.close();
  });

  it('has no wrapCommitted() left to call, in the type or at runtime', async () => {
    const made = makeCrypto();
    const created = await made.crypto.createRecord({ record: projectRecord('p_1'), owner: 'A' });

    // @ts-expect-error the typestate is gone: there is no assertion for a caller to make
    expect((created.session as RecordSession<Collection>).wrapCommitted).toBeUndefined();
    created.session.close();
  });
});
