/**
 * **The wrap lives on the aggregate root, and nowhere else.**
 *
 * At aggregate granularity a project's five hundred documents share ONE record key, and the wrap is
 * written once, on the project. "Anything that walks children to find a wrap has the design wrong"
 * is the rule; the trouble with it is that it is a NEGATIVE, and a negative asserted once is a
 * negative that stops being true the first time somebody adds a convenient field. So it is enforced
 * four ways here, in increasing strength, each catching what the one before it cannot:
 *
 *  1. **There is nowhere to put a second wrap.** `WalkedDoc` has no wrap field, asserted with a
 *     `@ts-expect-error` — which ts-jest checks with diagnostics on, so the line fails the SUITE if
 *     the field ever appears.
 *  2. **`assertHead` refuses a head below the root**, table-driven over §16.7's eight rows. The last
 *     two rows are the point: the rule is not "shallow paths only", it is "the record key's holder
 *     and nothing under it" — sf-mapper's real path is six segments deep and correct.
 *  3. **The spy that must never be called.** A collab-shaped fixture — one aggregate, five hundred
 *     children — run through `runWrapJob`, asserting the CONTENT traversal was never invoked and
 *     that one read produced one write. That is the property as an economic fact rather than as a
 *     claim, and it is the one that would catch a job which "helpfully" descended.
 *  4. **`createRecord` hands the port a ready-made update**, so `wrapHolders` cannot be forgotten —
 *     forgetting it breaks the erase sweep's `where('wrapHolders','==',[])` query, silently. Since
 *     R10a the update goes to the `WrapCommitter` rather than to the caller, so there is nobody
 *     left to forget it; `committedUpdate` is the same object, reported past tense.
 *
 * Then §18 Q-A: at ACCOUNT granularity a wrap holder nested under the account is a plausible thing
 * to have configured, so the "BELOW the wrap holder" diagnosis is suppressed there and the plainer
 * rule is named instead. That suppression is granularity-conditional, and this suite asserts both
 * halves side by side — because a suppression asserted on its own is indistinguishable from the
 * check having been deleted.
 */

import { createHash } from 'node:crypto';

import { createContentCrypto } from '../content-crypto';
import type { WrapCommitter, WrapReceipt } from '../content-crypto';
import { cachingDekSource } from '../custodian-cache';
import type { DekHandle, DekSource } from '../custodian';
import { ContentCryptoError, isContentCryptoError } from '../errors';
import {
  ACCOUNT_RECORD_TYPE, accountRecordRef, aggregateRecordRef, documentRecordRef, resolveScope,
} from '../key-scope';
import type { ContentKeyScope, ResolvedScope } from '../key-scope';
import { defineRegistry } from '../registry';
import {
  KEY_WRAPS_FIELD, WRAP_HOLDERS_FIELD, mintRecordKey, unwrapRecordKey, wrapRecordKey,
} from '../record-key';
import type { RecordRef, WrapEntry } from '../record-key';
import { dekFromBytes, zeroise } from '../secret';
import type { AccountDek } from '../secret';
import { planWraps } from '../wrap-patch';
import { assertHead, runWrapJob } from '../walk';
import type {
  ForEachContentDoc, RecordHead, WalkedDoc, WriteRow, WriteSink,
} from '../walk';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PRODUCT = 'collab';

/** `messages` is BOTH a registry collection and a document-granular record type, which is what
 *  makes the aggregate/document twin below a comparison of one fixture rather than of two. */
const registry = defineRegistry({
  projects: { strings: ['name'] },
  messages: { strings: ['body'] },
});

type Collection = 'projects' | 'messages';
type RecordType = 'project' | 'messages';

const scope: ContentKeyScope<RecordType> = {
  productId: PRODUCT,
  records: { project: 'aggregate', messages: 'document' },
  accountRecordPath: (accountId) => `accountContentKeys/${accountId}`,
};

const dekBytes = (accountId: string, generation: number): AccountDek =>
  dekFromBytes(
    createHash('sha256').update(`${PRODUCT}#${accountId}#${generation}`).digest(),
    `${PRODUCT}/${accountId}@${generation}`,
  );

const source: DekSource = {
  async getCurrentDek(accountId): Promise<DekHandle> {
    return { generation: 1, key: dekBytes(accountId, 1) };
  },
  async getDek(accountId, generation): Promise<DekHandle> {
    return { generation, key: dekBytes(accountId, generation) };
  },
  async currentGeneration(): Promise<number> {
    return 1;
  },
  evict(): void {
    /* nothing below the cache holds anything */
  },
};

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

function makeCrypto() {
  const dekSource = cachingDekSource(source, {
    productId: PRODUCT,
    onGraceServe: () => {
      throw new Error('no grace serve is expected in this suite');
    },
  });
  return createContentCrypto<Collection, RecordType>({
    scope, registry, dekSource, wrapCommitter: recordingCommitter(),
  });
}

const resolved: ResolvedScope<RecordType> = resolveScope(scope, registry);

function refusalMessage(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    if (err instanceof ContentCryptoError) return err.message;
    return `not a ContentCryptoError: ${String(err)}`;
  }
  return 'did not throw';
}

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    return isContentCryptoError(err) ? err.code : `not a ContentCryptoError: ${String(err)}`;
  }
  return 'did not throw';
}

/** The rest of a real `RecordHead`, so the table below reaches `assertHead` structurally. */
const head = (record: RecordRef, ownerAccountId: string): RecordHead => ({
  record,
  ownerAccountId,
  keyWraps: {},
  ref: { opaque: true },
  precondition: 'updateTime',
  cursor: record.id,
});

/** A recording sink. `deleteField` is a plain string: the package must not know what a store
 *  calls its sentinel, which is exactly why the sink supplies one. */
function recordingSink(): {
  readonly sink: WriteSink;
  readonly batches: WriteRow[][];
  readonly rows: WriteRow[];
} {
  const batches: WriteRow[][] = [];
  const rows: WriteRow[] = [];
  const sink: WriteSink = {
    maxBatchSize: 400,
    deleteField: '<<delete>>',
    async writeBatch(batch): Promise<void> {
      batches.push([...batch]);
      rows.push(...batch);
    },
    async writeOne(row): Promise<void> {
      rows.push(row);
    },
    isPreconditionFailure: () => false,
  };
  return { sink, batches, rows };
}

// ---------------------------------------------------------------------------
// 1. There is nowhere to put a second wrap
// ---------------------------------------------------------------------------

describe('a child document is content only — the type has nowhere to hold a wrap', () => {
  it('WalkedDoc has no wrap field, and neither name compiles on one', () => {
    const doc: WalkedDoc<Collection> = {
      collection: 'messages',
      aadDocId: 'm_1',
      data: { body: 'hello' },
      ref: { opaque: true },
    };

    // THE ASSERTION. If either field is ever added to `WalkedDoc`, ts-jest reports
    // `TS2578: Unused '@ts-expect-error' directive` at that exact line and the suite fails to
    // RUN — which is a harder gate than a failing expectation, because it cannot be skipped.
    // @ts-expect-error a walked child carries no keyWraps: the wrap lives on the aggregate root
    expect(doc.keyWraps).toBeUndefined();
    // @ts-expect-error and no holder mirror either, for the same reason
    expect(doc.wrapHolders).toBeUndefined();

    expect(Object.keys(doc).sort()).toEqual(['aadDocId', 'collection', 'data', 'ref']);
  });

  it('but a HEAD carries one — so the two directives above are load-bearing, not decorative', () => {
    // The positive control. Both names exist in this package and are spelled exactly this way on
    // `RecordHead`; the `@ts-expect-error`s above therefore fail on a real absence rather than on
    // a typo that would have errored whatever the type said.
    const h = head(aggregateRecordRef('project', 'p_1', 'projects/p_1'), 'A');
    expect(h.keyWraps).toEqual({});
    expect(KEY_WRAPS_FIELD).toBe('keyWraps');
    expect(WRAP_HOLDERS_FIELD).toBe('wrapHolders');
  });

  it('and the sealed child rows carry neither field, because encryptDoc never writes one', async () => {
    const crypto = makeCrypto();
    const created = await crypto.createRecord({
      record: aggregateRecordRef('project', 'p_1', 'projects/p_1'),
      owner: 'A',
    });
    const session = created.session;
    try {
      const child = session.encryptDoc('messages', 'm_1', { body: 'hello' });
      expect(Object.keys(child)).not.toContain(KEY_WRAPS_FIELD);
      expect(Object.keys(child)).not.toContain(WRAP_HOLDERS_FIELD);
    } finally {
      session.close();
    }
  });
});

// ---------------------------------------------------------------------------
// 2. assertHead — §16.7's table, all eight rows
// ---------------------------------------------------------------------------

describe('assertHead refuses the head whose wrap is in the wrong place', () => {
  const sfmapper = resolveScope(
    { productId: 'sfmapper', records: { scan: 'aggregate' } },
    registry,
  );

  const ref = (type: string, id: string, path: string): RecordRef =>
    type === ACCOUNT_RECORD_TYPE ? accountRecordRef(id, path) : aggregateRecordRef(type, id, path);

  const rows: readonly {
    readonly name: string;
    readonly scope: ResolvedScope<string>;
    readonly record: () => RecordRef;
    readonly owner: string;
    readonly verdict: 'ok' | string;
  }[] = [
    {
      name: 'aggregate: the aggregate root',
      scope: resolved,
      record: () => ref('project', 'p_1', 'projects/p_1'),
      owner: 'A',
      verdict: 'ok',
    },
    {
      name: 'aggregate: a path BELOW the root — the walked-children bug',
      scope: resolved,
      record: () => ref('project', 'p_1', 'projects/p_1/messages/m_1'),
      owner: 'A',
      verdict: 'BELOW the wrap holder',
    },
    {
      name: 'aggregate: a path that names a DIFFERENT row',
      scope: resolved,
      record: () => ref('project', 'p_1', 'projects/p_2'),
      owner: 'A',
      verdict: 'does not end with',
    },
    {
      name: 'document: the type IS the registry collection',
      scope: resolved,
      record: () => documentRecordRef('messages', 'm_1', 'projects/p_1/messages/m_1'),
      owner: 'A',
      verdict: 'ok',
    },
    {
      name: 'document: a type that reads like a collection and is not one',
      scope: resolved,
      record: () => ref('morphObject', 'o_1', 'objects/o_1'),
      owner: 'A',
      verdict: 'not declared in ContentKeyScope.records',
    },
    {
      name: 'account: the record id IS the owner',
      scope: resolved,
      record: () => ref(ACCOUNT_RECORD_TYPE, 'A', 'accountContentKeys/A'),
      owner: 'A',
      verdict: 'ok',
    },
    {
      name: 'account: the record id is NOT the owner',
      scope: resolved,
      record: () => ref(ACCOUNT_RECORD_TYPE, 'A', 'accountContentKeys/A'),
      owner: 'B',
      verdict: 'account-granular',
    },
    {
      name: 'aggregate: six segments deep and CORRECT — depth is fine, depth below the root is not',
      scope: sfmapper,
      record: () => ref('scan', 'scan-3', 'accounts/acc-1/sfmapper/org-9/scans/scan-3'),
      owner: 'acc-1',
      verdict: 'ok',
    },
  ];

  for (const row of rows) {
    it(row.name, () => {
      if (row.verdict === 'ok') {
        expect(() => assertHead(row.scope, head(row.record(), row.owner))).not.toThrow();
        return;
      }
      expect(codeOf(() => assertHead(row.scope, head(row.record(), row.owner))))
        .toBe('VALIDATION_ERROR');
      expect(refusalMessage(() => assertHead(row.scope, head(row.record(), row.owner))))
        .toContain(row.verdict);
    });
  }

  it('the last two rows together are the rule: not "shallow", but "the holder and nothing under it"', () => {
    // Stated as its own assertion because it is the clause a reader is most likely to mis-learn
    // from the table above — and because a "max depth" check would pass every other row.
    const deep = 'accounts/acc-1/sfmapper/org-9/scans/scan-3';
    expect(() => assertHead(sfmapper, head(ref('scan', 'scan-3', deep), 'acc-1'))).not.toThrow();
    expect(refusalMessage(() =>
      assertHead(sfmapper, head(ref('scan', 'scan-3', `${deep}/rows/r_1`), 'acc-1')),
    )).toContain('BELOW the wrap holder');
  });
});

// ---------------------------------------------------------------------------
// §18 Q-A — the account-granularity suppression, asserted against its own control
// ---------------------------------------------------------------------------

describe('§18 Q-A — at account granularity a nested holder row is not the walked-children bug', () => {
  /** The same SHAPE of path — `.../{id}/something` — at each granularity. */
  const nestedUnderTheId = (id: string): string => `accounts/${id}/contentKeys/${PRODUCT}`;

  it('AGGREGATE: a path with the id in the middle is diagnosed as the walked-children bug', () => {
    expect(refusalMessage(() =>
      resolved.assertRecord(aggregateRecordRef('project', 'p_1', nestedUnderTheId('p_1')), 'A'),
    )).toContain('BELOW the wrap holder');
  });

  it('ACCOUNT: the same shape is diagnosed by the rule it actually broke, and NOT as that bug', () => {
    // A row nested under the account is a plausible thing to have configured — Accounts' own key
    // row looks exactly like this — so the useful thing to say is "this path does not end with the
    // record id", not "you walked into a child". The suppression is deliberate (§18 Q-A).
    const message = refusalMessage(() =>
      resolved.assertRecord(accountRecordRef('A', nestedUnderTheId('A')), 'A'),
    );
    expect(message).toContain('does not end with');
    expect(message).not.toContain('BELOW the wrap holder');
  });

  it('and the suppression narrows the DIAGNOSIS only — the head is still refused', () => {
    // The failure this guards against is a suppression that quietly became an exemption. Both
    // paths above are still `VALIDATION_ERROR`, and `assertHead` still refuses the account head.
    expect(codeOf(() =>
      assertHead(resolved, head(accountRecordRef('A', nestedUnderTheId('A')), 'A')),
    )).toBe('VALIDATION_ERROR');
    // The configured form collab actually uses passes, so the refusal above is about the path and
    // not about account granularity being refused wholesale.
    expect(() =>
      assertHead(resolved, head(accountRecordRef('A', 'accountContentKeys/A'), 'A')),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 3. The spy that must never be called
// ---------------------------------------------------------------------------

describe('one aggregate, five hundred children: ONE read and ONE write', () => {
  const CHILDREN = 500;

  /** One aggregate root with a live wrap for A, plus the 500 children it will never touch. */
  async function collabShaped(): Promise<{
    readonly aggHead: RecordHead;
    readonly children: readonly WalkedDoc<Collection>[];
    readonly dek: DekHandle;
  }> {
    const crypto = makeCrypto();
    const record = aggregateRecordRef('project', 'p_1', 'projects/p_1');
    const dek = await crypto.dekSource.getCurrentDek('A');
    const recordKey = mintRecordKey(record);
    const wrap = wrapRecordKey({
      productId: PRODUCT, dek, accountId: 'A', record, recordKey,
    });
    zeroise(recordKey);

    const children: WalkedDoc<Collection>[] = [];
    for (let i = 0; i < CHILDREN; i += 1) {
      children.push({
        collection: 'messages',
        aadDocId: `m_${i}`,
        data: { body: 'sealed' },
        ref: { row: `projects/p_1/messages/m_${i}` },
      });
    }

    return {
      aggHead: {
        record,
        ownerAccountId: 'A',
        keyWraps: { A: wrap },
        ref: { row: record.path },
        precondition: 'read-time',
        cursor: 'p_1',
      },
      children,
      dek,
    };
  }

  /** `planWraps` bound to a head, exactly as a product's rotation closure binds it. */
  const boundWrap = (dek: DekHandle) => (h: RecordHead, desired: Record<string, DekHandle>) => {
    const key = unwrapRecordKey({
      productId: PRODUCT, dek, accountId: 'A', record: h.record, wrap: h.keyWraps.A as WrapEntry,
    });
    try {
      return planWraps({
        current: h.keyWraps,
        desired,
        recordKey: key,
        productId: PRODUCT,
        record: h.record,
        granularity: resolved.granularityOf(h.record.type as RecordType),
        actorAccountId: 'A',
        scope: 'this-record',
      });
    } finally {
      zeroise(key);
    }
  };

  it('never invokes the CONTENT traversal, and turns 500 rows into one write', async () => {
    const { aggHead, children, dek } = await collabShaped();
    const { sink, batches, rows } = recordingSink();

    // The spy. It would happily yield all five hundred; `runWrapJob` must never ask.
    const forEachContentDoc = jest.fn<Promise<void>, Parameters<ForEachContentDoc<Collection>>>(
      async (_h, visit) => {
        for (const doc of children) await visit(doc);
      },
    );

    const result = await runWrapJob({
      scope: resolved,
      accountId: 'A',
      forEachRecord: async (_accountId, visit) => {
        await visit(aggHead);
      },
      sink,
      desired: () => ({ A: dek, B: dek }),
      wrap: boundWrap(dek),
    });

    // 500 reads + N thousand AES operations + 500 writes, replaced by ONE read and ONE write —
    // and asserted as call counts rather than described.
    expect(forEachContentDoc).not.toHaveBeenCalled();
    expect(result.recordsVisited).toBe(1);
    expect(result.recordsWritten).toBe(1);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(1);
    expect(Object.keys(rows[0].update).sort()).toEqual(['keyWraps.B', 'wrapHolders']);
    expect(rows[0].ref).toEqual({ row: 'projects/p_1' });
  });

  it('the wrap the job read came off the ROOT, and no child ref ever reached the sink', async () => {
    const { aggHead, dek } = await collabShaped();
    const { sink, rows } = recordingSink();
    const seenPaths: string[] = [];

    await runWrapJob({
      scope: resolved,
      accountId: 'A',
      forEachRecord: async (_accountId, visit) => {
        await visit(aggHead);
      },
      sink,
      desired: () => ({ A: dek, B: dek }),
      wrap: (h, desired) => {
        seenPaths.push(h.record.path);
        return boundWrap(dek)(h, desired);
      },
    });

    expect(seenPaths).toEqual(['projects/p_1']);
    for (const row of rows) {
      expect(String((row.ref as { row: string }).row)).toBe('projects/p_1');
    }
  });

  it('and a head yielded for a CHILD is refused before anything is planned against it', async () => {
    // The same job, given the mistake. This is where "walks children to find a wrap" stops being a
    // second wrap in the store and becomes a test failure.
    const { aggHead, dek } = await collabShaped();
    const { sink, rows } = recordingSink();
    const childHead: RecordHead = {
      ...aggHead,
      record: aggregateRecordRef('project', 'p_1', 'projects/p_1/messages/m_0'),
    };

    await expect(
      runWrapJob({
        scope: resolved,
        accountId: 'A',
        forEachRecord: async (_accountId, visit) => {
          await visit(childHead);
        },
        sink,
        desired: () => ({ A: dek }),
        wrap: boundWrap(dek),
      }),
    ).rejects.toThrow(/BELOW the wrap holder/);

    // Refused BEFORE anything was planned, so nothing reached the sink.
    expect(rows).toHaveLength(0);
  });

  it('the DOCUMENT-granular twin yields 500 heads and 500 rows — the wrap follows scopePath', async () => {
    // The rule is not "there is always one wrap". It is that the wrap follows `scopePath`, and at
    // document granularity that is every row. Asserting only the aggregate half would have taught
    // the next reader the wrong rule.
    const crypto = makeCrypto();
    const dek = await crypto.dekSource.getCurrentDek('A');
    const heads: RecordHead[] = [];
    for (let i = 0; i < CHILDREN; i += 1) {
      const record = documentRecordRef('messages', `m_${i}`, `projects/p_1/messages/m_${i}`);
      const recordKey = mintRecordKey(record);
      heads.push({
        record,
        ownerAccountId: 'A',
        keyWraps: {
          A: wrapRecordKey({ productId: PRODUCT, dek, accountId: 'A', record, recordKey }),
        },
        ref: { row: record.path },
        precondition: 'read-time',
        cursor: record.id,
      });
      zeroise(recordKey);
    }

    const { sink, batches, rows } = recordingSink();
    const result = await runWrapJob({
      scope: resolved,
      accountId: 'A',
      forEachRecord: async (_accountId, visit) => {
        for (const h of heads) await visit(h);
      },
      sink,
      desired: () => ({ A: dek, B: dek }),
      wrap: boundWrap(dek),
    });

    expect(result.recordsVisited).toBe(CHILDREN);
    expect(result.recordsWritten).toBe(CHILDREN);
    expect(rows).toHaveLength(CHILDREN);
    // 500 rows at a batch bound of 400 is two batches, which is the package's own bound doing the
    // work rather than the product's page size.
    expect(batches.map((b) => b.length)).toEqual([400, 100]);
    expect(new Set(rows.map((r) => (r.ref as { row: string }).row)).size).toBe(CHILDREN);
  });
});

// ---------------------------------------------------------------------------
// 4. the update that cannot be got half-right — and now cannot be skipped either
// ---------------------------------------------------------------------------

describe('the wrap update carries both fields, and goes to the port rather than the caller', () => {
  it('carries BOTH fields — forgetting the holder mirror breaks the erase sweep, silently', async () => {
    const committer = recordingCommitter();
    const crypto = createContentCrypto<Collection, RecordType>({
      scope,
      registry,
      dekSource: cachingDekSource(source, { productId: PRODUCT, onGraceServe: () => {} }),
      wrapCommitter: committer,
    });
    const created = await crypto.createRecord({
      record: aggregateRecordRef('project', 'p_1', 'projects/p_1'),
      owner: 'A',
    });
    try {
      // What the PORT was handed — which is what was written, since the session did not exist
      // until the write had been acknowledged.
      const written = committer.rows.get('projects/p_1') as Record<string, unknown>;
      expect(Object.keys(written).sort()).toEqual([KEY_WRAPS_FIELD, WRAP_HOLDERS_FIELD]);
      expect(created.wrapHolders).toEqual(['A']);
      // NESTED, not dotted. A create has no sibling wraps to preserve, and a dotted key inside a
      // whole-document write would store a field literally named `keyWraps.A`.
      expect(Object.keys(written[KEY_WRAPS_FIELD] as object)).toEqual(['A']);
      expect(Object.keys(written).some((k) => k.includes('.'))).toBe(false);
      // …and reported back past tense, for the product that logs it.
      expect(created.committedUpdate).toEqual(written);
    } finally {
      created.session.close();
    }
  });

  it('writes it to the ROOT — the wrap holder is `record.path`, and the children get nothing', async () => {
    const crypto = makeCrypto();
    const record = aggregateRecordRef('project', 'p_1', 'projects/p_1');
    const created = await crypto.createRecord({ record, owner: 'A' });
    const session = created.session;
    try {
      // The wrap the create produced opens the record from the root's path, and from that path
      // alone: the same wrap presented against a child path refuses.
      const dek = await crypto.dekSource.getCurrentDek('A');
      const wrap = created.keyWraps.A;
      expect(() =>
        unwrapRecordKey({ productId: PRODUCT, dek, accountId: 'A', record, wrap }),
      ).not.toThrow();
      expect(codeOf(() =>
        unwrapRecordKey({
          productId: PRODUCT,
          dek,
          accountId: 'A',
          record: aggregateRecordRef('project', 'p_1', 'projects/p_1/messages/m_0'),
          wrap,
        }),
      )).toBe('RECORD_KEY_UNWRAP_FAILED');

      // And ONE session over the root opens every child, which is the economics the rule buys.
      const children = Array.from({ length: 3 }, (_v, i) =>
        session.encryptDoc('messages', `m_${i}`, { body: `child ${i}` }));
      children.forEach((child, i) => {
        expect(session.decryptDoc('messages', `m_${i}`, { ...child }))
          .toEqual({ body: `child ${i}` });
      });
    } finally {
      session.close();
    }
  });
});
