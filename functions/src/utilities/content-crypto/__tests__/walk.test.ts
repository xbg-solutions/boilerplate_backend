/**
 * The traversal seam, the batch writer and the one wrap job.
 *
 * Three properties are load-bearing here and each is asserted as a mechanism rather than as a
 * claim:
 *
 *   1. **Nothing walks children to find a wrap.** `assertHead` refuses a head below the aggregate
 *      root, `WalkedDoc` has nowhere to put a wrap, and `runWrapJob` never calls the content
 *      traversal at all — asserted as a call count on a spy that would have yielded five hundred
 *      documents.
 *   2. **A precondition loss means different things for different patches.** Skipping one is right
 *      for a rewrap and WRONG for a revoke, where it silently drops the revocation. That is
 *      `conflictPolicyFor`, and the job honours it per patch rather than per job.
 *   3. **Every patch is materialised before it is enqueued.** A raw `{ op: 'delete' }` stored at
 *      `keyWraps.{accountId}` is dropped by the tolerant parser on read, which leaves a ghost
 *      holder in the RAW key map — visible to `Object.keys(keyWraps)` and to nothing else, since
 *      `wrapHolders` is a plain array and writes correctly even raw. It is not permanent either:
 *      `planWraps` diffs on raw keys, so the next reconcile removes it, and that is asserted
 *      end-to-end over a store below rather than left as a claim.
 *   4. **The single-record apply is the same job, not a second one.** `applyWrapPatch` is
 *      `runWrapJob` over a traversal of one record, which is what leaves `materialiseWrapPatch`
 *      with exactly one call site in the package — and is why it could come off the barrel (R13).
 */

import { createHash } from 'node:crypto';

import {
  WALK_PAGE_SIZE, applyWrapPatch, assertHead, createBatchWriter, runWrapJob,
} from '../walk';
import type {
  ForEachContentDoc, RecordHead, WalkedDoc, WrapApplyArgs, WriteRow, WriteSink,
} from '../walk';
import { isContentCryptoError } from '../errors';
import { defineRegistry } from '../registry';
import {
  accountRecordRef, aggregateRecordRef, documentRecordRef, resolveScope,
} from '../key-scope';
import type { ResolvedScope } from '../key-scope';
import { holdersOf, mintRecordKey, wrapRecordKey } from '../record-key';
import type { KeyWraps, RecordRef } from '../record-key';
import { planWraps } from '../wrap-patch';
import type { DesiredWraps, WrapPatch } from '../wrap-patch';
import { dekFromBytes } from '../secret';
import type { DekHandle } from '../custodian';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PRODUCT = 'collab';

/** THE sentinel the fake store uses. A symbol, so an accidental structural match is impossible. */
const DELETE_FIELD = Symbol('the store\'s own delete sentinel');

const registry = defineRegistry({
  messages: { strings: ['body'] },
  projects: { strings: ['title'] },
});

const aggregateScope: ResolvedScope<'project'> = resolveScope(
  { productId: PRODUCT, records: { project: 'aggregate' }, accountRecordPath: (a) => `accountSettings/${a}` },
  registry,
);

const documentScope: ResolvedScope<'messages'> = resolveScope(
  { productId: PRODUCT, records: { messages: 'document' } },
  registry,
);

const dekAt = (accountId: string, generation: number): DekHandle => ({
  generation,
  key: dekFromBytes(
    createHash('sha256').update(`${PRODUCT}#${accountId}#${generation}`).digest(),
    `${PRODUCT}/${accountId}@${generation}`,
  ),
});

const projectRecord = (id: string): RecordRef =>
  aggregateRecordRef('project', id, `projects/${id}`);

/** A record with one wrap, at the named generation. */
function wrapsFor(record: RecordRef, holders: readonly string[], generation = 1): KeyWraps {
  const recordKey = mintRecordKey(record);
  const wraps: Record<string, ReturnType<typeof wrapRecordKey>> = {};
  for (const accountId of holders) {
    wraps[accountId] = wrapRecordKey({
      productId: PRODUCT, dek: dekAt(accountId, generation), accountId, record, recordKey,
    });
  }
  return wraps;
}

/** The reconcile a job's `wrap` closure would do, with the key unwrapped in the closure. */
function planFor(
  record: RecordRef,
  current: KeyWraps,
  desired: DesiredWraps,
  opts?: { actor?: string; grant?: boolean },
): WrapPatch {
  // A job's real closure calls `unwrapRecordKey` here — synchronously, from a DekHandle fetched
  // before the walk. This fixture mints instead, because what is being tested below is the JOB and
  // not the reconcile, and `wrap-patch.test.ts` owns the reconcile.
  return planWraps({
    current,
    desired,
    recordKey: mintRecordKey(record),
    productId: PRODUCT,
    record,
    granularity: aggregateScope.granularityOf('project'),
    actorAccountId: opts?.actor ?? 'A',
    scope: opts?.grant === false ? undefined : 'this-record',
  });
}

interface FakeSink extends WriteSink {
  readonly batches: WriteRow[][];
  readonly ones: WriteRow[];
}

function makeSink(opts?: {
  maxBatchSize?: number;
  failBatch?: boolean;
  precondition?: (row: WriteRow) => boolean;
  hardFail?: (row: WriteRow) => boolean;
}): FakeSink {
  const batches: WriteRow[][] = [];
  const ones: WriteRow[] = [];
  return {
    maxBatchSize: opts?.maxBatchSize ?? 500,
    deleteField: DELETE_FIELD,
    batches,
    ones,
    async writeBatch(rows): Promise<void> {
      batches.push([...rows]);
      if (opts?.failBatch === true) throw new Error('the batch failed');
      if (opts?.precondition !== undefined && rows.some(opts.precondition)) {
        throw new Error('the batch failed');
      }
      if (opts?.hardFail !== undefined && rows.some(opts.hardFail)) {
        throw new Error('the batch failed');
      }
    },
    async writeOne(row): Promise<void> {
      ones.push(row);
      if (opts?.precondition?.(row) === true) throw Object.assign(new Error('lost'), { kind: 'pre' });
      if (opts?.hardFail?.(row) === true) throw new Error('permission denied');
    },
    isPreconditionFailure(err): boolean {
      return (err as { kind?: string } | null)?.kind === 'pre';
    },
  };
}

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    return isContentCryptoError(err) ? err.code : `not a ContentCryptoError: ${String(err)}`;
  }
  return 'did not throw';
}

// ---------------------------------------------------------------------------

describe('WALK_PAGE_SIZE', () => {
  it('is 400, and is ONE constant rather than two that agree today', () => {
    // collab's `content-walk.ts` sets its batch size to its page size for a reason: a page in
    // memory and a batch in flight being different numbers is how a walk holds two pages while
    // writing one.
    expect(WALK_PAGE_SIZE).toBe(400);
  });
});

describe('assertHead — the wrap is on the holder, and nothing below it', () => {
  const head = (record: RecordRef, ownerAccountId: string): RecordHead => ({
    record, ownerAccountId, keyWraps: {}, ref: null,
  });

  it('accepts an aggregate root and refuses anything under it', () => {
    expect(() => assertHead(aggregateScope, head(projectRecord('p_1'), 'A'))).not.toThrow();

    // A path BELOW the aggregate root is the walked-children bug, and this is where it becomes a
    // refusal rather than a second wrap on a child row.
    expect(codeOf(() => assertHead(
      aggregateScope,
      head(aggregateRecordRef('project', 'p_1', 'projects/p_1/messages/m_1'), 'A'),
    ))).toBe('VALIDATION_ERROR');

    // ...and a path that does not end with `/{id}` is a ref built by hand and wrong.
    expect(codeOf(() => assertHead(
      aggregateScope,
      head(aggregateRecordRef('project', 'p_1', 'projects/p_2'), 'A'),
    ))).toBe('VALIDATION_ERROR');
  });

  it('accepts a DEEP aggregate root: depth is fine, depth below the root is not', () => {
    // sf-mapper's real path is six segments deep and correct. The rule is not "shallow paths
    // only", it is "the record key's holder and nothing under it".
    const scan = aggregateRecordRef(
      'project', 'scan-3', 'accounts/acc-1/sfmapper/org-9/scans/scan-3',
    );
    expect(() => assertHead(aggregateScope, head(scan, 'acc-1'))).not.toThrow();
  });

  it('at document granularity the record type IS the registry collection', () => {
    expect(() => assertHead(
      documentScope,
      head(documentRecordRef('messages', 'm_1', 'projects/p_1/messages/m_1'), 'A'),
    )).not.toThrow();

    expect(codeOf(() => assertHead(
      documentScope,
      head(documentRecordRef('morphObject', 'o_1', 'objects/o_1'), 'A'),
    ))).toBe('VALIDATION_ERROR');
  });

  it('at the degenerate granularity the record IS the owner', () => {
    const row = accountRecordRef('A', 'accountContentKeys/A');
    expect(() => assertHead(aggregateScope, head(row, 'A'))).not.toThrow();
    expect(codeOf(() => assertHead(aggregateScope, head(row, 'B')))).toBe('VALIDATION_ERROR');
  });

  it('refuses a head with no owner, because the degenerate case is checked against it', () => {
    expect(codeOf(() => assertHead(
      aggregateScope,
      { record: projectRecord('p_1'), keyWraps: {}, ref: null } as unknown as RecordHead,
    ))).toBe('VALIDATION_ERROR');
  });
});

describe('createBatchWriter', () => {
  const row = (n: number): WriteRow => ({ ref: `r_${n}`, update: { n } });

  it('batches to min(sink.maxBatchSize, WALK_PAGE_SIZE)', async () => {
    const sink = makeSink({ maxBatchSize: 500 });
    const writer = createBatchWriter({ sink, policy: 'retry' });
    for (let i = 0; i < WALK_PAGE_SIZE + 3; i += 1) await writer.enqueue(row(i));
    await writer.flush();

    expect(sink.batches.map((b) => b.length)).toEqual([WALK_PAGE_SIZE, 3]);
    expect(writer.written).toBe(WALK_PAGE_SIZE + 3);
  });

  it('takes the sink\'s ceiling when it is the smaller of the two', async () => {
    const sink = makeSink({ maxBatchSize: 5 });
    const writer = createBatchWriter({ sink, policy: 'retry' });
    for (let i = 0; i < 12; i += 1) await writer.enqueue(row(i));
    await writer.flush();
    expect(sink.batches.map((b) => b.length)).toEqual([5, 5, 2]);
  });

  it('retries row by row after a failed batch, so one bad row costs only itself', async () => {
    // A batch is all-or-nothing, so one row whose precondition moved would otherwise cost the
    // whole batch — four hundred records re-planned to redo one.
    const sink = makeSink({ precondition: (r) => (r.update as { n: number }).n === 2 });
    const writer = createBatchWriter({ sink, policy: 'skip' });
    for (let i = 0; i < 4; i += 1) await writer.enqueue(row(i));
    await writer.flush();

    expect(sink.batches).toHaveLength(1);
    expect(sink.ones).toHaveLength(4);
    expect(writer.written).toBe(3);
    expect(writer.skipped).toBe(1);
  });

  it('counts a precondition loss as skipped under \'skip\' — the live writer already did it', async () => {
    const sink = makeSink({ precondition: () => true });
    const writer = createBatchWriter({ sink, policy: 'skip' });
    await writer.enqueue(row(1));
    await writer.flush();
    expect(writer.skipped).toBe(1);
    expect(writer.written).toBe(0);
  });

  it('RAISES a precondition loss under \'retry\', because dropping it drops a revocation', async () => {
    // The row-by-row write IS the retry. If the row still loses its own precondition the change is
    // genuinely contested: the remedy is a re-read and a re-plan, and only the caller can do that.
    // Swallowing it here is exactly how a revocation gets dropped in silence.
    const sink = makeSink({ precondition: () => true });
    const writer = createBatchWriter({ sink, policy: 'retry' });
    await writer.enqueue(row(1));
    await expect(writer.flush()).rejects.toThrow('lost');
    expect(writer.skipped).toBe(0);
  });

  it('propagates anything that is not a precondition failure, under either policy', async () => {
    for (const policy of ['skip', 'retry'] as const) {
      const sink = makeSink({ hardFail: () => true });
      const writer = createBatchWriter({ sink, policy });
      await writer.enqueue(row(1));
      await expect(writer.flush()).rejects.toThrow('permission denied');
    }
  });

  it('refuses a sink with no delete sentinel, and a policy nobody derived', () => {
    const { deleteField, ...withoutSentinel } = makeSink();
    expect(deleteField).toBe(DELETE_FIELD);
    expect(codeOf(() => createBatchWriter({
      sink: withoutSentinel as unknown as WriteSink, policy: 'retry',
    }))).toBe('VALIDATION_ERROR');
    expect(codeOf(() => createBatchWriter({
      sink: makeSink(), policy: 'whatever' as unknown as 'skip',
    }))).toBe('VALIDATION_ERROR');
  });
});

// ---------------------------------------------------------------------------
// The sink that SHRINKS THE ROWS IT WAS HANDED
// ---------------------------------------------------------------------------

/**
 * **The batch is handed over and then re-read, so the sink must not be able to change it.**
 *
 * `drain` splices a page off `pending` and hands that array to `sink.writeBatch`. On a throw it
 * hands **the same array** to `writeRowByRow`, which is the retry that makes one conflicted row
 * cost only itself. A sink that shrinks the array it was given and then throws — "drop the rows I
 * have dealt with", "drain the array as I write it", the array reused as a scratch buffer — makes
 * that retry iterate what is LEFT, and the rows it removed are never written and never reported.
 * Measured on the unfixed code, four rows enqueued and a sink that dropped two before throwing:
 *
 *     enqueued: r1, r2, r3, r4 | written by retry: r3, r4 | rows SILENTLY LOST: 2
 *
 * **Under `policy: 'retry'` those rows are grants and REVOCATIONS**, and a revocation dropped in
 * silence leaves a partner able to read — the exact failure `conflictPolicyFor` exists to prevent,
 * arriving by another route and reported as success. The second probe found the same mutation on a
 * SUCCEEDING batch corrupting `WrapJobResult.recordsWritten`, because `written += rows.length`
 * reads the array after the sink has emptied it, and that number is operator-facing.
 *
 * The fix is `Object.freeze(pending.splice(0, maxBatchSize))`. The array is the package's own — it
 * came from `splice` — so freezing it costs nothing and turns the mutation into a throw at the
 * point it is written, which `drain`'s catch then treats as a failed batch: every row is retried
 * individually and every one of them lands. Removing the freeze turns this section red.
 *
 * A sink is free to shrink a COPY, which is the last case below and is all that was ever asked of
 * it.
 */

interface ShrinkingSink extends WriteSink {
  /** Every row this sink actually applied, in order — the durable truth the counters are read
   *  against, rather than the counters being read against themselves. */
  readonly applied: WriteRow[];
  /** Each batch as it ARRIVED, copied before the sink lays a finger on it. */
  readonly attempted: WriteRow[][];
  readonly ones: WriteRow[];
  /** Did the in-place shrink go through? `false` is the freeze, observed — and it is the half of
   *  the property a test that only counted rows would leave unproven. */
  readonly state: { shrank: boolean };
}

function shrinkingSink(opts: { mode: 'shrink-then-throw' | 'consume'; drop?: number }): ShrinkingSink {
  const applied: WriteRow[] = [];
  const attempted: WriteRow[][] = [];
  const ones: WriteRow[] = [];
  const state = { shrank: false };
  return {
    applied,
    attempted,
    ones,
    state,
    maxBatchSize: 500,
    deleteField: DELETE_FIELD,
    async writeBatch(rows): Promise<void> {
      attempted.push([...rows]);
      const mutable = rows as WriteRow[];
      if (opts.mode === 'consume') {
        // "Drain the array as I write it": every row applied, the array left empty, and the batch
        // reported to the caller as the complete success it genuinely was.
        while (mutable.length > 0) applied.push(mutable.shift() as WriteRow);
        state.shrank = true;
        return;
      }
      // "Drop what I have dealt with", and then fail on what is left of the batch.
      mutable.splice(0, opts.drop ?? 1);
      state.shrank = true;
      throw new Error('the batch failed');
    },
    async writeOne(row): Promise<void> {
      ones.push(row);
      applied.push(row);
    },
    isPreconditionFailure(): boolean {
      return false;
    },
  };
}

const refOf = (row: WriteRow): unknown => row.ref;

describe('a sink cannot shrink the rows it was handed', () => {
  const row = (n: number): WriteRow => ({ ref: `r_${n}`, update: { n } });

  it('shrinking the batch and then throwing cannot make the retry skip rows', async () => {
    const sink = shrinkingSink({ mode: 'shrink-then-throw', drop: 2 });
    const writer = createBatchWriter({ sink, policy: 'retry' });
    for (let i = 1; i <= 4; i += 1) await writer.enqueue(row(i));
    await writer.flush();

    // THE PROPERTY, first, so a red run names the data loss rather than the mechanism: the retry
    // saw the WHOLE batch and not what was left of it.
    expect(sink.ones.map(refOf)).toEqual(['r_1', 'r_2', 'r_3', 'r_4']);

    // NOTHING SILENTLY LOST. Every enqueued row is either written or explicitly reported, and the
    // two counters together account for all four — which is the assertion a dropped row fails.
    expect(sink.applied.map(refOf)).toEqual(['r_1', 'r_2', 'r_3', 'r_4']);
    expect(writer.written).toBe(4);
    expect(writer.skipped).toBe(0);
    expect(writer.written + writer.skipped).toBe(4);

    // …and the mechanism that buys it: the batch is the package's own array, handed over frozen,
    // so the splice threw where it was written rather than quietly succeeding.
    expect(sink.state.shrank).toBe(false);
    expect(sink.attempted.map((batch) => batch.map(refOf))).toEqual([['r_1', 'r_2', 'r_3', 'r_4']]);
  });

  it('under \'retry\' the REVOCATION among the rows is not the one that gets dropped', async () => {
    // The consequence in its real shape. `conflictPolicyFor` says `'retry'` the moment anything
    // was added or removed, so these rows carry revocations; a revocation dropped in silence
    // leaves the revoked partner able to read, and the job reports success either way.
    const records = ['p_1', 'p_2', 'p_3'].map(projectRecord);
    const heads: RecordHead[] = records.map((record, i) => ({
      record, ownerAccountId: 'A', keyWraps: wrapsFor(record, ['A', 'B'], 1), ref: `r_${i}`,
    }));
    const sink = shrinkingSink({ mode: 'shrink-then-throw', drop: 1 });

    const result = await runWrapJob({
      scope: aggregateScope,
      accountId: 'A',
      forEachRecord: async (_a, visit) => {
        for (const head of heads) await visit(head);
      },
      sink,
      desired: () => ({ A: dekAt('A', 1) }),
      wrap: (h, desired) => planFor(h.record, h.keyWraps, desired),
    });

    // Every one of the three reached the store, the dropped head included…
    expect(sink.applied.map(refOf)).toEqual(['r_0', 'r_1', 'r_2']);
    // …and every one of them really was a REVOCATION, so "not dropped" is about the write that
    // matters rather than about a row count.
    expect(sink.applied.map((written) => (written.update as Record<string, unknown>)['keyWraps.B']))
      .toEqual([DELETE_FIELD, DELETE_FIELD, DELETE_FIELD]);
    expect(result.recordsWritten).toBe(3);
    expect(result.recordsSkipped).toBe(0);
  });

  it('a sink that consumes a SUCCESSFUL batch cannot corrupt recordsWritten', async () => {
    // `recordsWritten` is what an operator reads to decide whether a rotation finished. Unfixed,
    // `written += rows.length` reads the array AFTER the sink emptied it, so a job that wrote
    // every row reports that it wrote none — and the batch succeeded, so nothing else complains.
    const records = ['p_1', 'p_2', 'p_3'].map(projectRecord);
    const heads: RecordHead[] = records.map((record, i) => ({
      record, ownerAccountId: 'A', keyWraps: wrapsFor(record, ['A'], 1), ref: `r_${i}`,
    }));
    const sink = shrinkingSink({ mode: 'consume' });

    const result = await runWrapJob({
      scope: aggregateScope,
      accountId: 'A',
      forEachRecord: async (_a, visit) => {
        for (const head of heads) await visit(head);
      },
      sink,
      desired: () => ({ A: dekAt('A', 2) }),
      wrap: (h, desired) => planFor(h.record, h.keyWraps, desired),
    });

    expect(result.recordsWritten).toBe(3);
    expect(sink.applied.map(refOf)).toEqual(['r_0', 'r_1', 'r_2']);
    // …exactly once each: the retry rewrote the batch the freeze refused, it did not double it.
    expect(sink.applied).toHaveLength(new Set(sink.applied.map(refOf)).size);
    expect(sink.state.shrank).toBe(false);
  });

  it('is not vacuous: a sink that shrinks a COPY is one nothing here objects to', async () => {
    // The freeze refuses a MUTATION, not a sink with bookkeeping of its own. This is the same
    // draining write loop one `[...]` earlier, and it is all that was ever asked for.
    const applied: WriteRow[] = [];
    const sink: WriteSink = {
      maxBatchSize: 500,
      deleteField: DELETE_FIELD,
      async writeBatch(rows): Promise<void> {
        const mine = [...rows];
        while (mine.length > 0) applied.push(mine.shift() as WriteRow);
      },
      async writeOne(one): Promise<void> {
        applied.push(one);
      },
      isPreconditionFailure: (): boolean => false,
    };
    const writer = createBatchWriter({ sink, policy: 'retry' });
    for (let i = 1; i <= 4; i += 1) await writer.enqueue(row(i));
    await writer.flush();

    expect(applied.map(refOf)).toEqual(['r_1', 'r_2', 'r_3', 'r_4']);
    expect(writer.written).toBe(4);
  });
});

describe('runWrapJob — NO CONTENT IS READ', () => {
  /** collab-shaped: one aggregate, five hundred child documents, one wrap. */
  function collabShaped(): {
    head: RecordHead;
    forEachRecord: jest.Mock;
    forEachContentDoc: jest.Mock;
  } {
    const record = projectRecord('p_1');
    const head: RecordHead = {
      record,
      ownerAccountId: 'A',
      keyWraps: wrapsFor(record, ['A'], 1),
      ref: 'projects/p_1',
      precondition: 'updateTime-1',
      cursor: 'p_1',
    };
    const forEachRecord = jest.fn(async (_accountId: string, visit: (h: RecordHead) => Promise<void>) => {
      await visit(head);
    });
    const forEachContentDoc: jest.Mock = jest.fn(async (_h, visit) => {
      for (let i = 0; i < 500; i += 1) {
        await visit({ collection: 'messages', aadDocId: `m_${i}`, data: {}, ref: `m_${i}` });
      }
    });
    return { head, forEachRecord, forEachContentDoc };
  }

  it('replaces 500 reads and 500 writes with ONE read and ONE write', async () => {
    const { head, forEachRecord, forEachContentDoc } = collabShaped();
    const sink = makeSink();

    const result = await runWrapJob({
      scope: aggregateScope,
      accountId: 'A',
      forEachRecord,
      sink,
      desired: () => ({ A: dekAt('A', 2) }),
      wrap: (h, desired) => planFor(h.record, h.keyWraps, desired),
    });

    // The content traversal exists and would have yielded five hundred documents. It is never
    // called, because a rotation under record keys rewraps and touches no content at all.
    expect((forEachContentDoc as unknown as ForEachContentDoc<'messages'>)).toBeDefined();
    expect(forEachContentDoc).not.toHaveBeenCalled();
    expect(result.recordsVisited).toBe(1);
    expect(result.recordsWritten).toBe(1);
    expect(sink.batches).toHaveLength(1);
    expect(sink.batches[0]).toHaveLength(1);
    expect(Object.keys(sink.batches[0][0].update).sort()).toEqual(['keyWraps.A', 'wrapHolders']);
    expect(sink.batches[0][0].ref).toBe(head.ref);
    expect(sink.batches[0][0].precondition).toBe('updateTime-1');
    expect(result.lastCursor).toBe('p_1');
  });

  it('the SAME fixture at document granularity is 500 heads and 500 rows', async () => {
    // The rule is that the wrap follows `scopePath`, not that there is always one wrap. Turning
    // the dial changes the arithmetic and not the code path.
    const heads: RecordHead[] = [];
    for (let i = 0; i < 500; i += 1) {
      const record = documentRecordRef('messages', `m_${i}`, `projects/p_1/messages/m_${i}`);
      heads.push({
        record, ownerAccountId: 'A', keyWraps: wrapsFor(record, ['A'], 1), ref: `m_${i}`,
      });
    }
    const sink = makeSink();
    const result = await runWrapJob({
      scope: documentScope,
      accountId: 'A',
      forEachRecord: async (_a, visit) => {
        for (const h of heads) await visit(h);
      },
      sink,
      desired: () => ({ A: dekAt('A', 2) }),
      wrap: (h, desired) => planWraps({
        current: h.keyWraps,
        desired,
        recordKey: mintRecordKey(h.record),
        productId: PRODUCT,
        record: h.record,
        granularity: documentScope.granularityOf('messages'),
        actorAccountId: 'A',
      }),
    });

    expect(result.recordsVisited).toBe(500);
    expect(result.recordsWritten).toBe(500);
    expect(sink.batches.map((b) => b.length)).toEqual([400, 100]);
  });

  it('runs assertHead on every head, so a walked-children head aborts the job', async () => {
    const record = aggregateRecordRef('project', 'p_1', 'projects/p_1/messages/m_1');
    const sink = makeSink();
    await expect(runWrapJob({
      scope: aggregateScope,
      accountId: 'A',
      forEachRecord: async (_a, visit) => {
        await visit({ record, ownerAccountId: 'A', keyWraps: {}, ref: 'x' });
      },
      sink,
      desired: () => ({}),
      wrap: (h, desired) => planFor(h.record, h.keyWraps, desired),
    })).rejects.toThrow();
    expect(sink.batches).toHaveLength(0);
  });
});

describe('runWrapJob — the sentinel, the policies and the sweep', () => {
  function revokeJob(sink: WriteSink) {
    const record = projectRecord('p_1');
    const current = wrapsFor(record, ['A', 'B'], 1);
    return {
      record,
      current,
      run: () => runWrapJob({
        scope: aggregateScope,
        accountId: 'A',
        forEachRecord: async (_a, visit) => {
          await visit({ record, ownerAccountId: 'A', keyWraps: current, ref: 'projects/p_1' });
        },
        sink,
        desired: () => ({ A: dekAt('A', 1) }),
        wrap: (h, desired) => planFor(h.record, h.keyWraps, desired),
      }),
    };
  }

  it('materialises every patch, so no WriteRow value is a raw delete sentinel', async () => {
    const sink = makeSink();
    await revokeJob(sink).run();

    const update = sink.batches[0][0].update as Record<string, unknown>;
    // Written raw, `{ op: 'delete' }` is STORED as a literal map at `keyWraps.B`, which the
    // tolerant parser then drops on read — so B is not a holder and `wrapHolders` is right, but
    // anything reading the raw map's keys still sees B until the next reconcile diffs it away.
    expect(update['keyWraps.B']).toBe(DELETE_FIELD);
    for (const value of Object.values(update)) {
      expect((value as { op?: string } | null)?.op).not.toBe('delete');
    }
    expect(update.wrapHolders).toEqual(['A']);
  });

  it('does not skip a revocation on a precondition loss', async () => {
    // `conflictPolicyFor` says `'retry'` the moment anything was added or removed. If the job had
    // one writer and picked `'skip'`, this revocation would be dropped and reported as success.
    const sink = makeSink({ precondition: () => true });
    await expect(revokeJob(sink).run()).rejects.toThrow('lost');
  });

  it('DOES skip a pure rewrap on a precondition loss — the live writer already wrapped it', async () => {
    const record = projectRecord('p_1');
    const current = wrapsFor(record, ['A'], 1);
    const sink = makeSink({ precondition: () => true });
    const result = await runWrapJob({
      scope: aggregateScope,
      accountId: 'A',
      forEachRecord: async (_a, visit) => {
        await visit({ record, ownerAccountId: 'A', keyWraps: current, ref: 'projects/p_1' });
      },
      sink,
      desired: () => ({ A: dekAt('A', 2) }),
      wrap: (h, desired) => planFor(h.record, h.keyWraps, desired),
    });
    expect(result.recordsSkipped).toBe(1);
    expect(result.recordsWritten).toBe(0);
  });

  it('keeps the two policies in separate batches, so one cannot borrow the other\'s', async () => {
    const rewrapped = projectRecord('p_1');
    const revoked = projectRecord('p_2');
    const heads: RecordHead[] = [
      { record: rewrapped, ownerAccountId: 'A', keyWraps: wrapsFor(rewrapped, ['A'], 1), ref: 'a' },
      { record: revoked, ownerAccountId: 'A', keyWraps: wrapsFor(revoked, ['A', 'B'], 1), ref: 'b' },
    ];
    const sink = makeSink();
    const result = await runWrapJob({
      scope: aggregateScope,
      accountId: 'A',
      forEachRecord: async (_a, visit) => {
        for (const h of heads) await visit(h);
      },
      sink,
      desired: (h) => (h.ref === 'a' ? { A: dekAt('A', 2) } : { A: dekAt('A', 1) }),
      wrap: (h, desired) => planFor(h.record, h.keyWraps, desired),
    });

    expect(result.recordsWritten).toBe(2);
    expect(sink.batches).toHaveLength(2);
    expect(sink.batches.flat().map((r) => r.ref).sort()).toEqual(['a', 'b']);
  });

  it('reports the scopePaths whose wrap set is now empty, and deletes nothing itself', async () => {
    const record = projectRecord('p_1');
    const sink = makeSink();
    const result = await runWrapJob({
      scope: aggregateScope,
      accountId: 'A',
      forEachRecord: async (_a, visit) => {
        await visit({
          record, ownerAccountId: 'A', keyWraps: wrapsFor(record, ['A'], 1), ref: 'projects/p_1',
        });
      },
      sink,
      desired: () => ({}),
      wrap: (h, desired) => planFor(h.record, h.keyWraps, desired, { grant: false }),
    });

    // The erase sweep's delete set is not "every record of account A", it is "every record whose
    // remaining wrap set is empty" — which is the federation decision working as intended: a
    // record still wrapped for a partner survives the owner's shred.
    expect(result.recordsToDelete).toEqual(['projects/p_1']);
    // The package deletes no rows. `WriteRow` has nowhere to express a delete, and at aggregate
    // granularity what the product removes is the whole aggregate rather than one document.
    expect(sink.batches[0][0].update.wrapHolders).toEqual([]);
    expect(Object.keys(sink.batches[0][0])).toEqual(
      expect.not.arrayContaining(['delete', 'remove']),
    );
  });

  it('audits what it changed, and manufactures nothing on an idempotent re-run', async () => {
    const record = projectRecord('p_1');
    const current = wrapsFor(record, ['A'], 1);
    const sink = makeSink();
    const result = await runWrapJob({
      scope: aggregateScope,
      accountId: 'A',
      forEachRecord: async (_a, visit) => {
        // Already at the target generation: nothing to do, and the re-run must cost one
        // comparison and no write.
        await visit({ record, ownerAccountId: 'A', keyWraps: current, ref: 'projects/p_1' });
      },
      sink,
      desired: () => ({ A: dekAt('A', 1) }),
      wrap: (h, desired) => planFor(h.record, h.keyWraps, desired),
    });

    expect(result.recordsVisited).toBe(1);
    expect(result.recordsWritten).toBe(0);
    expect(result.audit).toEqual([]);
    expect(sink.batches).toHaveLength(0);
  });
});

describe('runWrapJob — quiesce, resume and validation', () => {
  const trivialHead = (): RecordHead => {
    const record = projectRecord('p_1');
    return {
      record, ownerAccountId: 'A', keyWraps: wrapsFor(record, ['A'], 1), ref: 'x', cursor: 'c_1',
    };
  };

  it('waits the quiesce BEFORE it walks, and only when one was asked for', async () => {
    const slept: number[] = [];
    const order: string[] = [];
    const sink = makeSink();
    await runWrapJob({
      scope: aggregateScope,
      accountId: 'A',
      forEachRecord: async (_a, visit) => {
        order.push('walk');
        await visit(trivialHead());
      },
      sink,
      desired: () => ({ A: dekAt('A', 2) }),
      wrap: (h, desired) => planFor(h.record, h.keyWraps, desired),
      quiesceMs: 120_000,
      sleep: async (ms) => {
        slept.push(ms);
        order.push('sleep');
      },
    });
    // The point of the quiesce is that no warm instance is still minting at the old generation
    // when the first write lands, so it has to come first or it is not a quiesce.
    expect(order).toEqual(['sleep', 'walk']);
    expect(slept).toEqual([120_000]);

    const noSleep = jest.fn();
    await runWrapJob({
      scope: aggregateScope,
      accountId: 'A',
      forEachRecord: async (_a, visit) => visit(trivialHead()),
      sink: makeSink(),
      desired: () => ({ A: dekAt('A', 2) }),
      wrap: (h, desired) => planFor(h.record, h.keyWraps, desired),
      sleep: noSleep,
    });
    // A grant, revoke, transfer or erase publishes no new generation and has nothing to wait for.
    // Defaulting to two minutes would put a sleep in front of every revocation.
    expect(noSleep).not.toHaveBeenCalled();
  });

  it('passes `from` through and reports the last cursor it saw', async () => {
    let seen: string | undefined = 'not called';
    const result = await runWrapJob({
      scope: aggregateScope,
      accountId: 'A',
      forEachRecord: async (_a, visit, from) => {
        seen = from;
        await visit(trivialHead());
      },
      sink: makeSink(),
      desired: () => ({ A: dekAt('A', 2) }),
      wrap: (h, desired) => planFor(h.record, h.keyWraps, desired),
      from: 'c_0',
    });
    expect(seen).toBe('c_0');
    expect(result.lastCursor).toBe('c_1');
  });

  it('needs a scope, a sink with a sentinel, and both closures', async () => {
    const base = {
      accountId: 'A',
      forEachRecord: async (): Promise<void> => undefined,
      sink: makeSink(),
      desired: () => ({}),
      wrap: () => ({}) as unknown as WrapPatch,
    };
    await expect(runWrapJob({ ...base, scope: undefined as never })).rejects.toThrow();
    await expect(runWrapJob({ ...base, scope: aggregateScope, accountId: '' })).rejects.toThrow();
    await expect(runWrapJob({
      ...base, scope: aggregateScope, forEachRecord: undefined as never,
    })).rejects.toThrow();
  });

  it('refuses a wrap() that returned something other than a WrapPatch', async () => {
    await expect(runWrapJob({
      scope: aggregateScope,
      accountId: 'A',
      forEachRecord: async (_a, visit) => visit(trivialHead()),
      sink: makeSink(),
      desired: () => ({}),
      wrap: () => undefined as unknown as WrapPatch,
    })).rejects.toThrow(/planWraps/);
  });
});

describe('WalkedDoc has nowhere to put a wrap', () => {
  it('does not compile with a keyWraps field', () => {
    // "Anything that walks children to find a wrap has the design wrong", expressed as a type.
    // A child document is content only, and this is the half of that rule the type system carries;
    // `assertHead` is the other half.
    const doc: WalkedDoc<'messages'> = {
      collection: 'messages',
      aadDocId: 'm_1',
      data: {},
      ref: null,
      // @ts-expect-error a walked child document has no wrap field, and no product may add one
      keyWraps: { A: { gen: 1, wrapped: 'x', at: 'y' } },
    };
    expect(Object.keys(doc)).toContain('collection');
  });
});

// ---------------------------------------------------------------------------
// R13 — the single-record route, and a store to prove it against
// ---------------------------------------------------------------------------

/**
 * A store small enough to read and real enough to apply a dotted update — which is what the
 * self-healing question needs. A `WriteSink` alone cannot answer it: the claim is about what is in
 * the document AFTER the write, and a sink that only records rows never has a document.
 */
interface FakeStore {
  readonly doc: { keyWraps: Record<string, unknown>; wrapHolders: readonly string[] };
  readonly sink: WriteSink;
  /** The untranslated write, as a product would do it with a materialiser on the barrel. */
  writeRaw(update: Readonly<Record<string, unknown>>): void;
}

function makeStore(initial: KeyWraps): FakeStore {
  const doc = {
    keyWraps: { ...(initial as Record<string, unknown>) },
    wrapHolders: holdersOf(initial),
  };
  const apply = (update: Readonly<Record<string, unknown>>): void => {
    for (const key of Object.keys(update)) {
      const value = update[key];
      const dot = key.indexOf('.');
      if (dot === -1) {
        (doc as Record<string, unknown>)[key] = value;
        continue;
      }
      const tail = key.slice(dot + 1);
      if (value === DELETE_FIELD) delete doc.keyWraps[tail];
      else doc.keyWraps[tail] = value;
    }
  };
  return {
    doc,
    writeRaw: apply,
    sink: {
      maxBatchSize: 400,
      deleteField: DELETE_FIELD,
      async writeBatch(rows): Promise<void> {
        for (const row of rows) apply(row.update);
      },
      async writeOne(row): Promise<void> {
        apply(row.update);
      },
      isPreconditionFailure(err): boolean {
        return (err as { kind?: string } | null)?.kind === 'pre';
      },
    },
  };
}

describe('applyWrapPatch — the single-record grant, un-share, transfer and erase (R13)', () => {
  const record = projectRecord('p_1');

  /** Everything but the patch: the four things a single-record apply needs and no more. */
  const rest = (current: KeyWraps, sink: WriteSink) => ({
    scope: aggregateScope,
    current,
    ownerAccountId: 'A',
    sink,
    ref: 'projects/p_1',
    precondition: 'update-time-7',
  });

  it('GRANTS: one row, one audit entry, and the holders mirror moves with the wrap', async () => {
    const current = wrapsFor(record, ['A'], 1);
    const sink = makeSink();
    const patch = planFor(record, current, { A: dekAt('A', 1), B: dekAt('B', 1) });

    const result = await applyWrapPatch({ ...rest(current, sink), patch });

    expect(result.recordsVisited).toBe(1);
    expect(result.recordsWritten).toBe(1);
    expect(result.recordsToDelete).toEqual([]);
    expect(result.audit).toHaveLength(1);
    expect(result.audit[0].diff.added).toEqual(['B']);
    // The precondition is carried into the row exactly as the walking path carries it.
    const row = sink.batches[0][0];
    expect(row.precondition).toBe('update-time-7');
    expect(row.ref).toBe('projects/p_1');
    expect(row.update.wrapHolders).toEqual(['A', 'B']);
  });

  it('UN-SHARES: the removal is the store\'s own sentinel and never a literal map', async () => {
    const current = wrapsFor(record, ['A', 'B'], 1);
    const store = makeStore(current);
    const patch = planFor(record, current, { A: dekAt('A', 1) }, { grant: false });

    const result = await applyWrapPatch({ ...rest(current, store.sink), patch });

    expect(result.recordsWritten).toBe(1);
    // THE property R13 turns on: the caller supplied no sentinel, the sink's own was used, and
    // what reached the store is a deletion rather than a map that reads like one.
    expect(Object.keys(store.doc.keyWraps)).toEqual(['A']);
    expect(store.doc.wrapHolders).toEqual(['A']);
    expect(holdersOf(store.doc.keyWraps as KeyWraps)).toEqual(['A']);
  });

  it('TRANSFERS in one row: the wraps and the product\'s own fields, or neither', async () => {
    const current = wrapsFor(record, ['A'], 1);
    const store = makeStore(current);
    const patch = planFor(record, current, { B: dekAt('B', 1) });

    const result = await applyWrapPatch({
      ...rest(current, store.sink),
      patch,
      // collab's transfer: `accountId` and `ownerId` are two facts about ONE relationship, and
      // splitting them from the wrap move is the window `planWraps` is a single patch to avoid.
      also: { accountId: 'B', ownerId: 'u_9' },
    });

    expect(result.recordsWritten).toBe(1);
    expect(result.audit[0].diff).toMatchObject({ added: ['B'], removed: ['A'] });
    expect(Object.keys(store.doc.keyWraps)).toEqual(['B']);
    expect((store.doc as unknown as Record<string, unknown>).accountId).toBe('B');
    expect((store.doc as unknown as Record<string, unknown>).ownerId).toBe('u_9');
  });

  it('ERASES to empty: the sweep signal, and the package deletes nothing itself', async () => {
    const current = wrapsFor(record, ['A'], 1);
    const store = makeStore(current);
    const patch = planFor(record, current, {}, { grant: false });

    const result = await applyWrapPatch({ ...rest(current, store.sink), patch });

    expect(result.recordsToDelete).toEqual(['projects/p_1']);
    expect(store.doc.keyWraps).toEqual({});
    expect(store.doc.wrapHolders).toEqual([]);
  });

  it('reports an ALREADY empty record to the sweep without writing anything', async () => {
    const sink = makeSink();
    const patch = planFor(record, {}, {}, { grant: false });

    const result = await applyWrapPatch({ ...rest({}, sink), patch });

    expect(result.recordsToDelete).toEqual(['projects/p_1']);
    expect(result.recordsWritten).toBe(0);
    expect(sink.batches).toHaveLength(0);
  });

  it('PROPAGATES a lost precondition on a revoke — it does not report success', async () => {
    // `conflictPolicyFor` says `'retry'` the moment anything was added or removed, and the
    // single-record route reads it from the same place the walk does. Swallowing this is how a
    // revocation gets dropped in silence, which is the whole reason the policy is derived.
    const current = wrapsFor(record, ['A', 'B'], 1);
    const sink = makeSink({ precondition: () => true });
    const patch = planFor(record, current, { A: dekAt('A', 1) }, { grant: false });

    await expect(applyWrapPatch({ ...rest(current, sink), patch })).rejects.toThrow('lost');
  });

  it('SKIPS a lost precondition on a pure rewrap — the live writer already did it', async () => {
    const current = wrapsFor(record, ['A'], 1);
    const sink = makeSink({ precondition: () => true });
    const patch = planFor(record, current, { A: dekAt('A', 2) });

    const result = await applyWrapPatch({ ...rest(current, sink), patch });

    expect(result.recordsSkipped).toBe(1);
    expect(result.recordsWritten).toBe(0);
  });

  it('honours assertHead: a path below the aggregate root is refused, not wrapped', async () => {
    const child = aggregateRecordRef('project', 'p_1', 'projects/p_1/messages/m_1');
    const current = wrapsFor(child, ['A'], 1);
    const sink = makeSink();
    const patch = planFor(child, current, { A: dekAt('A', 1), B: dekAt('B', 1) });

    await expect(applyWrapPatch({ ...rest(current, sink), patch })).rejects.toThrow();
    expect(sink.batches).toHaveLength(0);
  });
});

describe('applyWrapPatch — `precondition` is REQUIRED, and its opt-out is a WORD (R18)', () => {
  const record = projectRecord('p_1');
  /** Everything but the patch and the precondition. */
  const base = (current: KeyWraps, sink: WriteSink) => ({
    scope: aggregateScope,
    current,
    ownerAccountId: 'A',
    sink,
    ref: 'projects/p_1',
  });

  it('carries the store\'s own token into the row', async () => {
    const current = wrapsFor(record, ['A'], 1);
    const sink = makeSink();
    const patch = planFor(record, current, { A: dekAt('A', 1), B: dekAt('B', 1) });

    await applyWrapPatch({ ...base(current, sink), patch, precondition: { updateTime: 7 } });

    expect(sink.batches[0][0].precondition).toEqual({ updateTime: 7 });
  });

  it('writes NO precondition for the word — \'unconditional\' never reaches the sink', async () => {
    // The blind write is what the caller asked for, in writing. What must never happen is the
    // WORD arriving at the store as a token, where it would compare-and-set against a string.
    const current = wrapsFor(record, ['A'], 1);
    const sink = makeSink();
    const patch = planFor(record, current, { A: dekAt('A', 1), B: dekAt('B', 1) });

    await applyWrapPatch({ ...base(current, sink), patch, precondition: 'unconditional' });

    const row = sink.batches[0][0];
    expect(row.precondition).toBeUndefined();
    // Omitted, not set to undefined — the rule the type states, checked as a fact about the row.
    expect(Object.prototype.hasOwnProperty.call(row, 'precondition')).toBe(false);
  });

  it('refuses undefined, null and omission at RUNTIME, naming what to type', async () => {
    // The compiler refuses all three (the type test below). THIS is the caller with no compiler:
    // a plain-JavaScript migration script, which is the caller the required field exists for. The
    // message has to say what to type, because "precondition is required" sends somebody looking
    // for a token they may not have.
    const current = wrapsFor(record, ['A'], 1);
    const patch = planFor(record, current, { A: dekAt('A', 1), B: dekAt('B', 1) });

    for (const precondition of [undefined, null]) {
      await expect(applyWrapPatch({
        ...base(current, makeSink()), patch, precondition,
      } as unknown as WrapApplyArgs<'project'>)).rejects.toThrow(/unconditional/);
    }
    await expect(applyWrapPatch(
      { ...base(current, makeSink()), patch } as unknown as WrapApplyArgs<'project'>,
    )).rejects.toThrow(/unconditional/);
  });

  it('refuses the blind write BEFORE it looks at the patch', async () => {
    // Otherwise a JS caller is told about their patch, fixes it, and discovers the blind write on
    // the next run — or never, because by then it writes.
    await expect(applyWrapPatch({
      scope: aggregateScope, patch: undefined, current: {}, ownerAccountId: 'A',
      sink: makeSink(), ref: 'projects/p_1',
    } as unknown as WrapApplyArgs<'project'>)).rejects.toThrow(/unconditional/);
  });

  it('is a TYPE error in each accidental form, and the word is not', async () => {
    // ts-jest runs with diagnostics ON, so an UNUSED `@ts-expect-error` is TS2578 and the suite
    // fails at that exact line. These three directives are therefore the type test itself: relax
    // the field back to optional and all three become unused directives and go red.
    const current = wrapsFor(record, ['A'], 1);
    const sink = makeSink();
    const patch = planFor(record, current, { A: dekAt('A', 1) });

    // @ts-expect-error undefined is the accidental value this ruling exists to exclude
    const withUndefined: WrapApplyArgs<'project'> = { ...base(current, sink), patch, precondition: undefined };
    // @ts-expect-error null arrives from an unset variable, a failed lookup, a JSON round trip
    const withNull: WrapApplyArgs<'project'> = { ...base(current, sink), patch, precondition: null };
    // @ts-expect-error and the field cannot be omitted at all: there is no "I did not think about it"
    const omitted: WrapApplyArgs<'project'> = { ...base(current, sink), patch };

    // The two LEGAL forms, on the same type and built the same way — so the three directives above
    // are failing on the field and not on some other incompatibility in the object.
    const withToken: WrapApplyArgs<'project'> = {
      ...base(current, sink), patch, precondition: 'update-time-7',
    };
    const withWord: WrapApplyArgs<'project'> = {
      ...base(current, sink), patch, precondition: 'unconditional',
    };

    expect([withUndefined, withNull, omitted, withToken, withWord]).toHaveLength(5);
    await expect(applyWrapPatch(withWord)).resolves.toBeDefined();
  });
});

describe('applyWrapPatch — `also`, and the read the patch was planned against', () => {
  const record = projectRecord('p_1');
  const rest = (current: KeyWraps, sink: WriteSink) => ({
    scope: aggregateScope,
    current,
    ownerAccountId: 'A',
    sink,
    ref: 'projects/p_1',
    // These cases are about `also` and about `current`, and the write itself is not
    // compare-and-set — which R18 (precondition) makes them SAY rather than leave off.
    precondition: 'unconditional' as const,
  });

  it('writes the product\'s fields even when the wrap set did not move', async () => {
    // Morph re-saving the same audience with a different `visibility`: `changed` is 0 and the
    // `scope` field still has to land. A row dropped here loses the product's change silently,
    // which is the failure this clause exists to prevent.
    const current = wrapsFor(record, ['A'], 1);
    const store = makeStore(current);
    const patch = planFor(record, current, { A: dekAt('A', 1) });
    expect(patch.changed).toBe(0);

    const result = await applyWrapPatch({
      ...rest(current, store.sink),
      patch,
      also: { scope: { visibility: 'private' }, scopeChangedAt: '2026-09-11T00:00:00.000Z' },
    });

    expect(result.recordsWritten).toBe(1);
    expect((store.doc as unknown as Record<string, unknown>).scope).toEqual({ visibility: 'private' });
    // ...and no wrap audit entry is manufactured for a row that changed no wrap.
    expect(result.audit).toEqual([]);
    expect(Object.keys(store.doc.keyWraps)).toEqual(['A']);
  });

  it('never SKIPS a row carrying the product\'s fields, even on a pure rewrap', async () => {
    // `'skip'` means "the live writer already did this exact work", and nothing the live writer
    // did wrote these fields.
    const current = wrapsFor(record, ['A'], 1);
    const sink = makeSink({ precondition: () => true });
    const patch = planFor(record, current, { A: dekAt('A', 2) });

    await expect(applyWrapPatch({
      ...rest(current, sink), patch, also: { rotatedAt: 'now' },
    })).rejects.toThrow('lost');
  });

  it('refuses `also` keys that address a wrap field — the raw write by another door', async () => {
    const current = wrapsFor(record, ['A'], 1);
    const patch = planFor(record, current, { A: dekAt('A', 2) });
    for (const also of [
      { 'keyWraps.B': { op: 'delete' } },
      { keyWraps: {} },
      { wrapHolders: ['A'] },
    ]) {
      await expect(applyWrapPatch({
        ...rest(current, makeSink()), patch, also,
      })).rejects.toThrow(/WrapPatch/);
    }
  });

  it('refuses a `current` that is not the read the patch was planned against', async () => {
    // On the walking path the wrap set and the precondition come from ONE visit and cannot
    // disagree. A single-record apply assembles the head from separate arguments, so what the
    // walk gets structurally is asserted here instead.
    const current = wrapsFor(record, ['A'], 1);
    const patch = planFor(record, current, { A: dekAt('A', 1), B: dekAt('B', 1) });
    const stale = wrapsFor(record, ['A', 'C'], 1);

    await expect(applyWrapPatch({
      ...rest(stale, makeSink()), patch,
    })).rejects.toThrow(/ONE read/);
  });

  it('refuses a patch that is not one planWraps produced', async () => {
    const sink = makeSink();
    for (const patch of [undefined, null, {}, { changed: 1, update: {} }]) {
      await expect(applyWrapPatch({
        ...rest({}, sink), patch: patch as unknown as WrapPatch,
      })).rejects.toThrow();
    }
  });
});

describe('an untranslated `{ op: \'delete\' }` heals at the next reconcile', () => {
  const record = projectRecord('p_1');

  it('is a ghost in the RAW key map only, and is gone after one reconcile', async () => {
    // Step 1 — the mistake, executed. This is exactly what a product did with a materialiser on
    // the barrel: the patch, written raw.
    const current = wrapsFor(record, ['A', 'B'], 1);
    const store = makeStore(current);
    const raw = planFor(record, current, { A: dekAt('A', 1) }, { grant: false });
    store.writeRaw(raw.update);

    // Step 2 — what it actually costs, stated precisely rather than as "a revocation that
    // half-works for ever". B is NOT a holder; `wrapHolders` is right, because a plain array
    // writes correctly even raw. The ghost is visible to `Object.keys` and to nothing else.
    expect(store.doc.keyWraps.B).toEqual({ op: 'delete' });
    expect(Object.keys(store.doc.keyWraps).sort()).toEqual(['A', 'B']);
    expect(holdersOf(store.doc.keyWraps as KeyWraps)).toEqual(['A']);
    expect(store.doc.wrapHolders).toEqual(['A']);

    // Step 3 — the next reconcile on this record. `planWraps` diffs on RAW keys, so the ghost is
    // something it must remove rather than something it cannot see.
    const after = store.doc.keyWraps as KeyWraps;
    const heal = planFor(record, after, { A: dekAt('A', 1) }, { grant: false });
    expect(heal.diff.removed).toEqual(['B']);

    await applyWrapPatch({
      scope: aggregateScope,
      patch: heal,
      current: after,
      ownerAccountId: 'A',
      sink: store.sink,
      ref: 'projects/p_1',
      precondition: 'unconditional',
    });

    // Step 4 — gone. SELF-HEALING HOLDS: the exposure is bounded by the next reconcile on this
    // record, not permanent.
    expect(Object.keys(store.doc.keyWraps)).toEqual(['A']);
    expect(store.doc.keyWraps.B).toBeUndefined();
  });

  it('heals the other way too, when the ghost account is still wanted', async () => {
    const current = wrapsFor(record, ['A', 'B'], 1);
    const store = makeStore(current);
    store.writeRaw(planFor(record, current, { A: dekAt('A', 1) }, { grant: false }).update);

    // B is not a parsed holder, so a reconcile that still wants B ADDS it back — a real wrap
    // replacing the literal map. Either direction resolves the ghost; neither leaves it.
    const after = store.doc.keyWraps as KeyWraps;
    const regrant = planFor(record, after, { A: dekAt('A', 1), B: dekAt('B', 1) });
    expect(regrant.diff.added).toEqual(['B']);

    await applyWrapPatch({
      scope: aggregateScope,
      patch: regrant,
      current: after,
      ownerAccountId: 'A',
      sink: store.sink,
      ref: 'projects/p_1',
      precondition: 'unconditional',
    });

    expect(holdersOf(store.doc.keyWraps as KeyWraps)).toEqual(['A', 'B']);
    expect(store.doc.keyWraps.B).not.toEqual({ op: 'delete' });
  });
});
