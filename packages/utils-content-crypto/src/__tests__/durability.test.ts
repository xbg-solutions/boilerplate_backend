/**
 * **KILL-BETWEEN: a crash between the wrap write and the first seal leaves the record openable.**
 *
 * This is the suite the whole R10a pass exists for, and it asserts a property of the DATA rather
 * than a property of the types:
 *
 * > For every kill point, in a fresh process, **every `enc:v3:` value and every sealed object
 * > surviving in the store opens under the wraps that are in the store.**
 *
 * Nothing below is about call order. The typestate it replaced could only ever say that a caller
 * CALLED something; a wrap sitting unflushed in a four-hundred-row batch satisfies any such type
 * perfectly and destroys the content anyway. What a crash actually does is two things, and both
 * are modelled here:
 *
 *  1. **Unflushed writes never land.** The `Kill` is thrown from inside the run and the writer is
 *     abandoned without `flush()`.
 *  2. **Process memory is gone.** `session.close()` — which zeroises, the strongest model
 *     available and stronger than dropping the reference — then the façade is discarded, and the
 *     survivor is a SECOND façade over the same store. That is what "the next run" means.
 *
 * ── THE FIXTURE MODELS COLLAB'S WRITER, NOT AN IDEALISED ONE ─────────────────────────────────
 *
 * `FakeStore.writer()` is `__scripts__/encrypt-existing.js`'s `Writer`, faithfully: one shared
 * pending FIFO for the whole run, a flush when it fills, and — on a failed batch — a row-by-row
 * retry that SWALLOWS a lost precondition and counts the row as conflicted. That last clause is
 * correct for a content row (the live app already encrypted it) and is a shredder for a wrap row,
 * which is why `F2` below exists. `saveObject` is `file.save`: applied IMMEDIATELY, out of band
 * from the FIFO, which is the hazard `F1` turns into a dead object.
 *
 * **One deliberate departure, and it makes the model HARSHER rather than kinder:** a batch here
 * applies row by row, so the knife may fall between two rows of one batch. Firestore's batch is
 * atomic, so a property that survives partial application survives atomicity too — and an atomic
 * batch would make all but three kill points unreachable, at which point the knife stops varying
 * and the suite stops proving anything.
 *
 * ── THE READ-BACK CHANGED WHAT F1-F3 PROVE (R11) ─────────────────────────────────────────────
 *
 * `createRecord` now READS THE WRAPS BACK through the port after the commit resolves and refuses
 * unless the store holds every one of them. So each of the three counter-example committers below
 * appears TWICE: once with the honest reader a product would actually write — where the create is
 * now refused and nothing can be sealed — and once wrapped in `withInventedReader`, a reader that
 * answers from what its writer was handed. The second form still destroys content, and that is the
 * residue stated exactly: read-back does not remove it, it raises the price from one accidental
 * falsehood (a receipt an enqueue-only committer MUST invent) to two deliberate ones. What it does
 * not touch at all is the CREATE-ONLY lie — a committer that overwrites an existing wrap finds a
 * wrap on read-back, ours, and passes — which is `checkWrapCommit` assertion (3)'s, in the
 * product's own CI, required rather than advisory (R12).
 *
 * ── PROVEN ABLE TO GO RED ────────────────────────────────────────────────────────────────────
 *
 * Four counter-example fixtures are permanent members of this suite, and the distinguishing
 * property of the set is that **the mutation which breaks durability is a fixture swap, never an
 * edit to an assertion**:
 *
 *   F1  `enqueueOnlyCommitter`   the defect itself — collab's `Writer.update`, which resolves on
 *                                the enqueue and has to invent a receipt. REFUSED since R11.
 *   F2  `swallowingCommitter`    collab's `flush()` — a lost precondition logged, not thrown.
 *                                REFUSED since R11.
 *   F3  `noopCommitter`          the residue: refused with an honest reader, and still passing
 *                                when the reader lies in step with the writer
 *   F4  the by-hand migration    §14.4's old worked example, reassembled from the package's own
 *                                modules — R10 took `mintRecordKey` and the free `planWraps` off
 *                                the barrel precisely so a CONSUMER can no longer assemble it —
 *                                with the wrap written LAST, which also proves `auditStore` bites
 *
 * Beyond those, the positive suite was PROVEN RED by hand. Dropping the `await` on
 * `commitWraps` in `content-crypto.ts` — so the wrap is on its way while the caller is already
 * sealing, which is precisely what the typestate permitted — turns **eight of the nine kill points
 * red**. The ninth (`k = 800`) survives, because a run long enough to finish is a run long enough
 * for the deferred write to land: which is the reason the knife is a SET of points and not one,
 * and the reason `land()` costs a full turn of the event loop rather than a microtask. A
 * durability test that has never been shown to fail is decoration.
 */

import { createHash } from 'node:crypto';

import { createContentCrypto } from '../content-crypto';
import type {
  CreatedRecord, RecordSession, WrapCommitRequest, WrapCommitter, WrapReceipt,
} from '../content-crypto';
import { cachingDekSource } from '../custodian-cache';
import { ContentCryptoError } from '../errors';
import { defineRegistry } from '../registry';
import { aggregateRecordRef, resolveScope } from '../key-scope';
import type { ContentKeyScope } from '../key-scope';
import * as recordKeyModule from '../record-key';
import {
  KEY_WRAPS_FIELD, WRAP_HOLDERS_FIELD, mintRecordKey, parseKeyWraps, wrapCount,
} from '../record-key';
import type { KeyWraps, RecordRef } from '../record-key';
import { planWraps } from '../wrap-patch';
import { createDocPlanner } from '../doc-codec';
import type { PlannedAt } from '../doc-codec';
import { encryptField, isEncrypted } from '../field-codec';
import { isEncryptedObject } from '../object-envelope';
import type { ObjectMetadata, ObjectRef } from '../object-envelope';
import { zeroise } from '../secret';
import type { RecordKey } from '../secret';
import { expectNoKeyMaterial, fixedDekSource } from '../testing';

// ---------------------------------------------------------------------------
// The world: one collab-shaped project, five hundred rows and five objects
// ---------------------------------------------------------------------------

const PRODUCT = 'collab';
const OWNER = 'A';

const registry = defineRegistry({
  messages: { strings: ['body'] },
});
type Collection = 'messages';

const scope: ContentKeyScope<'project'> = {
  productId: PRODUCT,
  records: { project: 'aggregate' },
  accountRecordPath: (accountId) => `accountSettings/${accountId}`,
};

const RECORD: RecordRef = aggregateRecordRef('project', 'p_1', 'projects/p_1');
const BUCKET = 'a-bucket';

/** 500 rows and 5 objects, which is collab's real migration at collab's real shape. */
const DOCS = 500;
const OBJECTS = 5;
const TOTAL_SEALABLE = DOCS + OBJECTS;

/** collab's `const BATCH_SIZE = 400`. */
const BATCH_SIZE = 400;

const docPath = (i: number): string => `projects/p_1/messages/m_${i}`;
const docId = (i: number): string => `m_${i}`;
const objectRef = (i: number): ObjectRef => ({ bucket: BUCKET, path: `projects/p_1/o_${i}` });

const dekBytes = (accountId: string, generation: number): Buffer =>
  createHash('sha256').update(`${PRODUCT}#${accountId}#${generation}`).digest();

/**
 * A FRESH façade over the same store: fresh cache, fresh sessions, no memory of any key. Calling
 * it twice is what "the next run, in a new process" means here.
 */
function makeCrypto(opts: { store: FakeStore; committer?: WrapCommitter }) {
  const dekSource = cachingDekSource(
    fixedDekSource({ productId: PRODUCT, keys: { A: { 1: dekBytes('A', 1) } } }),
    { productId: PRODUCT, onGraceServe: () => { throw new Error('no grace serve is expected'); } },
  );
  return createContentCrypto<Collection, 'project'>({
    scope,
    registry,
    dekSource,
    wrapCommitter: opts.committer ?? opts.store.committer(),
  });
}

// ---------------------------------------------------------------------------
// The store, the writer and the knife
// ---------------------------------------------------------------------------

/** The crash. Thrown from inside the run; the writer is abandoned without a flush. */
class Kill extends Error {
  constructor(after: number) {
    super(`the process died after ${after} durable write(s)`);
    this.name = 'Kill';
  }
}

interface StoredObject {
  readonly body: Buffer;
  readonly metadata: ObjectMetadata;
}

/**
 * A store with a knife in it.
 *
 * `durableWrites` counts LANDINGS and nothing else — never an enqueue — which is what makes
 * `killAfterDurableWrites: k` mean *the k-th durable write lands, then the process dies*.
 */
class FakeStore {
  readonly rows = new Map<string, Record<string, unknown>>();

  readonly objects = new Map<string, StoredObject>();

  durableWrites = 0;

  /** Landings still permitted before the knife falls. `Infinity` until `arm` is called. */
  private allowance = Infinity;

  /** Paths whose next write must lose its precondition — how F2 is set up. */
  readonly loseprecondition = new Set<string>();

  arm(killAfterDurableWrites: number): void {
    this.allowance = killAfterDurableWrites;
  }

  /** The knife belonged to the process that died. The NEXT process starts without one. */
  disarm(): void {
    this.allowance = Number.POSITIVE_INFINITY;
  }

  /**
   * Apply one durable write, or die instead. Every landing in this file goes through here.
   *
   * **It takes a full turn of the event loop, and that is load-bearing.** A durable write is I/O.
   * A fixture that applied synchronously — or on a microtask — could not tell an AWAITED commit
   * from a fired-and-forgotten one, because any number of intervening `await`s would drain the
   * microtask queue and land it anyway. `setImmediate` is what makes "the package awaited its
   * wrap" an observable fact, and it is why moving the `await` off `commitWraps` turns this whole
   * suite red instead of leaving it green.
   */
  private async land(apply: () => void): Promise<void> {
    await new Promise<void>((resolve) => { setImmediate(resolve); });
    if (this.allowance <= 0) throw new Kill(this.durableWrites);
    apply();
    this.durableWrites += 1;
    this.allowance -= 1;
  }

  /** The conforming committer: it WRITES, all-or-nothing, and only then acknowledges. */
  committer(): WrapCommitter {
    return {
      commitWraps: async (requests): Promise<readonly WrapReceipt[]> => {
        for (const request of requests) {
          const existing = this.rows.get(request.record.path);
          if (existing !== undefined && existing[KEY_WRAPS_FIELD] !== undefined) {
            throw new Error(`precondition lost on ${request.record.path}`);
          }
          if (this.loseprecondition.has(request.record.path)) {
            throw new Error(`precondition lost on ${request.record.path}`);
          }
        }
        const committedAt = new Date().toISOString();
        for (const request of requests) {
          await this.land(() => this.merge(request.record.path, request.update));
        }
        return requests.map(() => ({ committedAt }));
      },
      // R11's read, answered HONESTLY: from the rows, positionally, and with no memory of what
      // `commitWraps` was handed. It costs no landing — a read is not a durable write, and
      // counting it as one would move every kill point in this file.
      readWraps: async (records): Promise<readonly unknown[]> =>
        records.map((record) => this.rows.get(record.path)?.[KEY_WRAPS_FIELD]),
      isPreconditionFailure: (err): boolean =>
        err instanceof Error && /precondition lost/.test(err.message),
    };
  }

  /**
   * collab's `Writer`, faithfully: ONE pending FIFO for the whole run, a flush when it fills, and
   * a row-by-row retry on a failed batch that SWALLOWS a lost precondition. The `update` call
   * RESOLVES IMMEDIATELY when the batch is not yet full — which is the enqueue-then-hope shape,
   * and the reason a `WrapCommitter` must never be built on one.
   */
  writer(): {
    update(path: string, data: Record<string, unknown>): Promise<void>;
    flush(): Promise<void>;
    readonly conflicted: readonly string[];
  } {
    const pending: { path: string; data: Record<string, unknown> }[] = [];
    const conflicted: string[] = [];

    const flush = async (): Promise<void> => {
      const rows = pending.splice(0, pending.length);
      for (const row of rows) {
        if (this.loseprecondition.has(row.path)) {
          // The row-by-row retry, and its swallow. Right for a content row the live app already
          // converted; a shred for a wrap row, which nothing here can tell apart.
          conflicted.push(row.path);
          continue;
        }
        await this.land(() => this.merge(row.path, row.data));
      }
    };

    return {
      conflicted,
      async update(path, data): Promise<void> {
        pending.push({ path, data });
        if (pending.length >= BATCH_SIZE) await flush();
      },
      flush,
    };
  }

  /** `file.save`: applied IMMEDIATELY, out of band from the FIFO. */
  async saveObject(ref: ObjectRef, sealed: StoredObject): Promise<void> {
    await this.land(() => { this.objects.set(ref.path, sealed); });
  }

  private merge(path: string, data: Readonly<Record<string, unknown>>): void {
    this.rows.set(path, { ...(this.rows.get(path) ?? {}), ...data });
  }
}

// ---------------------------------------------------------------------------
// The migration, and the audit
// ---------------------------------------------------------------------------

/**
 * collab's migration, at collab's shape.
 *
 * The objects go first within the project, and that is not a detail: `encrypt-existing.js` calls
 * `migrateProjectObjects` per project with **no flush of the pending rows on either side of it**,
 * so an object is saved durably while the whole FIFO — the wrap included, under an enqueue-only
 * committer — is still pending. Which side of the row walk they sit on is an implementation
 * detail of the script; that they are out of band is the property, and putting them first is what
 * stops a flush that happened to fire from masking it.
 */
async function runMigration(
  session: RecordSession<Collection>,
  store: FakeStore,
  opts: { killAfterDurableWrites: number },
): Promise<void> {
  store.arm(opts.killAfterDurableWrites);
  const writer = store.writer();

  for (let i = 0; i < OBJECTS; i += 1) {
    const ref = objectRef(i);
    await store.saveObject(ref, session.sealObject(ref, Buffer.from(`object ${i}`, 'utf8')));
  }

  for (let i = 0; i < DOCS; i += 1) {
    const sealed = session.encryptDoc('messages', docId(i), { body: `message ${i}` });
    await writer.update(docPath(i), { ...sealed, id: docId(i) });
  }

  await writer.flush();

  // The process may die at any point, INCLUDING after the last write landed. Without this a kill
  // point beyond the total simply completes and the `rejects.toThrow(Kill)` below would be a
  // statement about the fixture rather than about the code.
  throw new Kill(store.durableWrites);
}

interface Audit {
  readonly sealed: number;
  readonly opened: number;
  readonly unopenable: number;
}

/**
 * Scan everything in the store and try to open it with the session provided.
 *
 * Registry-driven for the rows and envelope-driven for the objects, so it counts what a READER
 * would find rather than what the run believes it wrote. `unopenable` is the number that matters:
 * it is data we destroyed.
 */
function auditStore(store: FakeStore, session: RecordSession<Collection>): Audit {
  let sealed = 0;
  let opened = 0;
  let unopenable = 0;

  for (const [path, row] of store.rows) {
    if (!path.startsWith('projects/p_1/messages/')) continue;
    if (!isEncrypted(row.body)) continue;
    sealed += 1;
    try {
      const out = session.decryptDoc('messages', String(row.id), { ...row });
      if (typeof out.body === 'string' && out.body.startsWith('message ')) opened += 1;
      else unopenable += 1;
    } catch {
      unopenable += 1;
    }
  }

  for (const [path, object] of store.objects) {
    if (!isEncryptedObject(object.metadata)) continue;
    sealed += 1;
    try {
      session.openObject({ bucket: BUCKET, path }, object.body, object.metadata);
      opened += 1;
    } catch {
      unopenable += 1;
    }
  }

  return { sealed, opened, unopenable };
}

const wrapsIn = (store: FakeStore): unknown => store.rows.get(RECORD.path)?.[KEY_WRAPS_FIELD];

/**
 * The knife's arithmetic, written down rather than computed by the code under test.
 *
 * Landings, in order: 5 objects, then the first batch of 400 rows, then the last 100. So the
 * expected count of sealed things surviving a kill at `k` is `min(k, 505)` — and the kill points
 * below are chosen to straddle every boundary in that sentence.
 */
const EXPECTED_SEALED: Readonly<Record<number, number>> = {
  0: 0,       // the pure kill-between case: the wrap is durable, nothing else is
  1: 1,       // one object, landed out of band before any row
  5: 5,       // every object, and not one row
  6: 6,       // the first row of the first batch
  404: 404,   // one row short of the first flush completing
  405: 405,   // the first flush, exactly
  406: 406,   // one row into the tail the first flush did not carry
  450: 450,   // the owner's scenario
  800: TOTAL_SEALABLE, // past the end: everything landed, and the process died anyway
};
const KILL_POINTS = Object.keys(EXPECTED_SEALED).map(Number);

// ---------------------------------------------------------------------------
// The property
// ---------------------------------------------------------------------------

describe('kill-between: a crash between the wrap and the first seal leaves the record openable', () => {
  it.each(KILL_POINTS)('kill after %i durable writes', async (k) => {
    const store = new FakeStore();
    const first = makeCrypto({ store });

    const { session } = await first.createRecord({ record: RECORD, owner: OWNER, current: {} });
    await expect(runMigration(session, store, { killAfterDurableWrites: k }))
      .rejects.toThrow(Kill);
    session.close();                                    // the process is gone; the key with it
    store.disarm();                                     // …and so is the knife that killed it

    // ── the next run, in a new process ───────────────────────────────────────────────────────
    const next = makeCrypto({ store });                 // fresh everything

    // (1) The wrap is DURABLE. It was committed inside `createRecord`, before any object capable
    //     of sealing existed, and it did not travel through the writer that was abandoned.
    expect(wrapCount(parseKeyWraps(wrapsIn(store)))).toBeGreaterThan(0);

    // (2) It opens.
    const adopted = await next.openRecord(
      { record: RECORD, keyWraps: wrapsIn(store), ownerAccountId: OWNER }, { as: OWNER },
    );

    try {
      // (3) THE PROPERTY. Everything that survived in the store opens under the wraps that
      //     survived in the store. Nothing was destroyed by the crash.
      const audit = auditStore(store, adopted);
      expect(audit.unopenable).toBe(0);
      expect(audit.opened).toBe(audit.sealed);

      // (4) The knife bit where it was told to, so (3) is not a statement about an empty store.
      expect(audit.sealed).toBe(EXPECTED_SEALED[k]);

      // (5) A re-run must ADOPT rather than mint. A second key here is the same data loss
      //     arriving by the other door: everything above would become noise.
      await expect(next.createRecord({ record: RECORD, owner: OWNER, current: wrapsIn(store) }))
        .rejects.toThrow(/adopt it with openRecord/);

      // (6) And nothing leaked into the store on the way.
      expectNoKeyMaterial(Object.fromEntries(store.rows), 'store after kill');
    } finally {
      adopted.close();
    }
  });

  it('is not vacuous: a clean run seals everything, and every one of them opens', async () => {
    const store = new FakeStore();
    const crypto = makeCrypto({ store });
    const { session } = await crypto.createRecord({ record: RECORD, owner: OWNER, current: {} });
    await expect(runMigration(session, store, { killAfterDurableWrites: Number.MAX_SAFE_INTEGER }))
      .rejects.toThrow(Kill);
    session.close();
    store.disarm();

    const next = makeCrypto({ store });
    const adopted = await next.openRecord(
      { record: RECORD, keyWraps: wrapsIn(store), ownerAccountId: OWNER }, { as: OWNER },
    );
    try {
      // Liveness. Without this an implementation that wrote nothing at all would be green above.
      expect(auditStore(store, adopted)).toEqual({
        sealed: TOTAL_SEALABLE, opened: TOTAL_SEALABLE, unopenable: 0,
      });
    } finally {
      adopted.close();
    }
  });

  it('is not vacuous: the knife varies, and "openable" is not trivially true', () => {
    // If every kill point produced the same store, the property above would be one assertion
    // repeated nine times. And if the first interesting kill point sealed nothing, "everything
    // that survived opens" would be true of nothing.
    expect(new Set(Object.values(EXPECTED_SEALED)).size).toBeGreaterThan(3);
    expect(EXPECTED_SEALED[1]).toBeGreaterThan(0);
    expect(EXPECTED_SEALED[800]).toBe(TOTAL_SEALABLE);
  });

  it('reads the wrap back before returning, and that read costs no durable write', async () => {
    // R11 in the fixture's own terms. `land()` counts LANDINGS, so if the read-back were modelled
    // as a write every kill point in EXPECTED_SEALED would shift by one — and the fact that none
    // of them did is the statement that a read is a read. The wrap is in the store before a
    // session exists, and it got there through one durable write.
    const store = new FakeStore();
    const crypto = makeCrypto({ store });
    const created = await crypto.createRecord({ record: RECORD, owner: OWNER, current: {} });
    expect(store.durableWrites).toBe(1);
    expect(wrapCount(parseKeyWraps(wrapsIn(store)))).toBe(1);
    created.session.close();
  });

  it('is not vacuous: the audit reads the store, not the run\'s own bookkeeping', async () => {
    // `auditStore` must find things by scanning what is there. Feed it a store with one sealed row
    // whose ciphertext has been corrupted and it must report an unopenable, not silently skip it.
    const store = new FakeStore();
    const crypto = makeCrypto({ store });
    const { session } = await crypto.createRecord({ record: RECORD, owner: OWNER, current: {} });
    const sealed = session.encryptDoc('messages', 'm_0', { body: 'message 0' });
    store.rows.set(docPath(0), { ...sealed, id: 'm_0' });
    expect(auditStore(store, session)).toEqual({ sealed: 1, opened: 1, unopenable: 0 });

    const bytes = Buffer.from(String(sealed.body).split(':')[3], 'base64');
    bytes[0] ^= 0xff;
    store.rows.set(docPath(0), {
      ...sealed,
      body: String(sealed.body).split(':').map((p, i) => (i === 3 ? bytes.toString('base64') : p)).join(':'),
      id: 'm_0',
    });
    expect(auditStore(store, session)).toEqual({ sealed: 1, opened: 0, unopenable: 1 });
    session.close();
  });
});

// ---------------------------------------------------------------------------
// The second lie — what it now takes to get past the read-back
// ---------------------------------------------------------------------------

/**
 * A reader that answers with what its writer was HANDED rather than with what the store holds.
 *
 * This is the whole of R11's bound, as a fixture. The receipt could be faked by accident — an
 * enqueue-only committer has no write time and `new Date().toISOString()` is the natural thing to
 * put there, inside the ±24 h window. The read-back cannot: an honest reader over a store that was
 * never written finds nothing, so defeating it takes a SECOND, deliberate falsehood, written on
 * purpose, in a different method. Nobody writes this one by accident, and F1/F2/F3 below carry it
 * only so that the residue keeps executing rather than being asserted in a paragraph.
 */
function withInventedReader(inner: WrapCommitter): WrapCommitter {
  const invented = new Map<string, unknown>();
  return {
    async commitWraps(requests): Promise<readonly WrapReceipt[]> {
      for (const request of requests) invented.set(request.record.path, request.keyWraps);
      return inner.commitWraps(requests);
    },
    async readWraps(records): Promise<readonly unknown[]> {
      return records.map((record) => invented.get(record.path));
    },
    isPreconditionFailure: (err): boolean => inner.isPreconditionFailure(err),
  };
}

// ---------------------------------------------------------------------------
// F1 — the defect, reproduced and executing
// ---------------------------------------------------------------------------

/**
 * collab's `Writer.update`, adapted verbatim into a `WrapCommitter`: push into the shared FIFO,
 * resolve immediately, and — because the signature demands a receipt and a batch that has not
 * flushed has no write time — **invent one**. That invention is the whole difference between this
 * and a conforming committer, and it is visible in review in a way `return Promise.resolve()`
 * would not have been.
 *
 * Its READER is honest: the same read the store's own committer performs. That pairing —
 * an enqueue-only writer and an honest reader — is the one R11 refuses, and it is the pairing a
 * product actually writes, because the reader is a one-line `doc.get()` and there is nothing to
 * gain by making it lie.
 */
function enqueueOnlyCommitter(
  writer: { update(path: string, data: Record<string, unknown>): Promise<void> },
  store: FakeStore,
): WrapCommitter {
  return {
    async commitWraps(requests): Promise<readonly WrapReceipt[]> {
      for (const request of requests) await writer.update(request.record.path, request.update);
      return requests.map(() => ({ committedAt: new Date().toISOString() }));
    },
    readWraps: async (records): Promise<readonly unknown[]> =>
      records.map((record) => store.rows.get(record.path)?.[KEY_WRAPS_FIELD]),
    isPreconditionFailure: (): boolean => false,
  };
}

describe('F1 — a committer that only ENQUEUES is now refused, and was not before', () => {
  it('REFUSES the create: the receipt was perfect and the store was empty', async () => {
    const store = new FakeStore();
    const writer = store.writer();
    const crypto = makeCrypto({ store, committer: enqueueOnlyCommitter(writer, store) });

    // THE DEFECT, CAUGHT. Before R11 this line resolved, handed back a session capable of sealing,
    // and left the wrap in a pending array — see the two tests below, which is what it did next.
    await expect(crypto.createRecord({ record: RECORD, owner: OWNER, current: {} }))
      .rejects.toThrow(/still sees no wrap for the owner/);
    expect(wrapsIn(store)).toBeUndefined();
  });

  it('refuses before any object capable of sealing exists, so nothing can be sealed', async () => {
    const store = new FakeStore();
    const writer = store.writer();
    const crypto = makeCrypto({ store, committer: enqueueOnlyCommitter(writer, store) });

    // The refusal shape matters as much as the refusal: it throws instead of returning a
    // `CreatedRecord`, so there is no session, no key in the caller's hand, and no window.
    let session: RecordSession<Collection> | null = null;
    await expect(
      crypto.createRecord({ record: RECORD, owner: OWNER, current: {} })
        .then((created) => { session = created.session; }),
    ).rejects.toMatchObject({ code: 'KEY_STORE_CONFLICT' });
    expect(session).toBeNull();
    expect(store.objects.size).toBe(0);
  });

  it('with a reader that lies in step, it still destroys content — the residue, priced at two lies', async () => {
    const store = new FakeStore();
    const writer = store.writer();
    const crypto = makeCrypto({
      store, committer: withInventedReader(enqueueOnlyCommitter(writer, store)),
    });

    const { session } = await crypto.createRecord({ record: RECORD, owner: OWNER, current: {} });
    // `createRecord` has resolved, a session capable of sealing is in hand, and the wrap exists
    // nowhere but in a pending array — exactly as it did before R11, and now only because the
    // fixture tells a second deliberate falsehood to get here.
    expect(wrapsIn(store)).toBeUndefined();

    // The object save is out of band from the FIFO, so it lands while the wrap is still pending.
    // (A ROW would have been protected by accident, because the wrap sits ahead of it in the same
    // FIFO — which is exactly the trap: the shape is safe against the failure that happens to be
    // safe already, and unsafe against the two the code actually exhibits.)
    store.arm(1);
    const ref = objectRef(0);
    await store.saveObject(ref, session.sealObject(ref, Buffer.from('object 0', 'utf8')));
    session.close();

    const next = makeCrypto({ store });
    expect(wrapsIn(store)).toBeUndefined();               // no wrap ever landed
    expect(store.objects.size).toBe(1);                   // and a sealed object certainly did
    await expect(
      next.openRecord({ record: RECORD, keyWraps: wrapsIn(store) }, { as: OWNER }),
    ).rejects.toMatchObject({ code: 'NO_WRAP_FOR_ACCOUNT' });
  });
});

// ---------------------------------------------------------------------------
// F2 — the swallow, which is live in collab today
// ---------------------------------------------------------------------------

/**
 * The wrap routed through a batch that, on a lost precondition, retries row by row and counts the
 * loss as done — collab's actual `Writer.flush()` and `RotationWriter.flush()`. It resolves
 * having written nothing, and `isPreconditionFailure` is never consulted because nothing threw.
 * Its reader, again, is the honest one a product would actually write.
 */
function swallowingCommitter(store: FakeStore): WrapCommitter {
  return {
    async commitWraps(requests): Promise<readonly WrapReceipt[]> {
      const writer = store.writer();
      for (const request of requests) await writer.update(request.record.path, request.update);
      await writer.flush();
      return requests.map(() => ({ committedAt: new Date().toISOString() }));
    },
    readWraps: async (records): Promise<readonly unknown[]> =>
      records.map((record) => store.rows.get(record.path)?.[KEY_WRAPS_FIELD]),
    isPreconditionFailure: (): boolean => false,
  };
}

describe('F2 — a committer built on a swallow-on-conflict batch writer is refused too', () => {
  it('REFUSES the create: the swallow left nothing in the store, and the read says so', async () => {
    const store = new FakeStore();
    // The live app edited the project row during a migration explicitly designed to run while the
    // app is live. For a CONTENT row that is correct to skip; for the wrap row it is a shred.
    store.loseprecondition.add(RECORD.path);
    const crypto = makeCrypto({ store, committer: swallowingCommitter(store) });

    await expect(crypto.createRecord({ record: RECORD, owner: OWNER, current: {} }))
      .rejects.toThrow(/still sees no wrap for the owner/);
    expect(wrapsIn(store)).toBeUndefined();
  });

  it('with a reader that lies in step, it resolves, writes nothing, and every value is dead', async () => {
    const store = new FakeStore();
    store.loseprecondition.add(RECORD.path);
    const crypto = makeCrypto({
      store, committer: withInventedReader(swallowingCommitter(store)),
    });

    const { session } = await crypto.createRecord({ record: RECORD, owner: OWNER, current: {} });
    const sealed = session.encryptDoc('messages', 'm_0', { body: 'message 0' });
    store.rows.set(docPath(0), { ...sealed, id: 'm_0' });
    session.close();

    const next = makeCrypto({ store });
    expect(wrapsIn(store)).toBeUndefined();
    await expect(
      next.openRecord({ record: RECORD, keyWraps: wrapsIn(store) }, { as: OWNER }),
    ).rejects.toMatchObject({ code: 'NO_WRAP_FOR_ACCOUNT' });

    // `checkWrapCommit` assertion (3) is what fails this committer in a product's own repo — and
    // R12 makes running it a required step of adoption rather than a suggestion, because
    // create-only-ness is precisely what the read-back cannot see.
    expect(isEncrypted(store.rows.get(docPath(0))?.body)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// F3 — the residue the package cannot close
// ---------------------------------------------------------------------------

/** Writes nothing. Returns a receipt that passes every check a receipt can carry, and — paired
 *  with an honest reader — is now caught by the one check that is not a receipt. */
function noopCommitter(store: FakeStore): WrapCommitter {
  return {
    async commitWraps(requests): Promise<readonly WrapReceipt[]> {
      return requests.map(() => ({ committedAt: new Date().toISOString() }));
    },
    readWraps: async (records): Promise<readonly unknown[]> =>
      records.map((record) => store.rows.get(record.path)?.[KEY_WRAPS_FIELD]),
    isPreconditionFailure: (): boolean => false,
  };
}

describe('F3 — the residue, narrowed by R11 and still executing rather than asserted in prose', () => {
  it('a committer that writes nothing no longer passes, because the STORE is asked', async () => {
    const store = new FakeStore();
    const crypto = makeCrypto({ store, committer: noopCommitter(store) });

    await expect(crypto.createRecord({ record: RECORD, owner: OWNER, current: {} }))
      .rejects.toThrow(/still sees no wrap for the owner/);
    expect(wrapsIn(store)).toBeUndefined();
  });

  it('a committer that lies TWICE still passes — this is the door that cannot be closed', async () => {
    const store = new FakeStore();
    const crypto = makeCrypto({ store, committer: withInventedReader(noopCommitter(store)) });

    // The package does not own the writer OR the reader, so a pair that agrees with each other and
    // not with the store passes everything available here. It is documented by executing rather
    // than in prose, so nobody has to take the docblock's word for it. What R11 changed is the
    // PRICE: one accidental falsehood is no longer enough, and the second one has to be written on
    // purpose. What still closes it is `checkWrapCommit` against the product's real committer, in
    // the product's own CI (R12), and nothing else.
    const { session } = await crypto.createRecord({ record: RECORD, owner: OWNER, current: {} });
    expect(wrapsIn(store)).toBeUndefined();
    session.close();
  });
});

// ---------------------------------------------------------------------------
// F4 — the old worked example, reassembled from the barrel, with the wrap LAST
// ---------------------------------------------------------------------------

/**
 * §14.4's superseded shape, rebuilt with no source edit and no mock: seal by hand, write the
 * content, write the wrap **last**. It is assembled from the package's own MODULES — and since R10
 * that is the only place it can be assembled from, because `mintRecordKey`, `wrapRecordKey`,
 * `unwrapRecordKey` and the free key-taking `planWraps` are no longer on the barrel: a consumer
 * cannot write this any more, and a test inside the package still can. The path itself survives
 * internally: it is the deliberate residue that keeps `--apply`-gated backfill scripts possible —
 * and it is here so the repo permanently contains a live demonstration that it destroys content.
 *
 * It also proves `auditStore` has TEETH, independently of the façade: the audit runs with a live
 * session in hand and still reports every row unopenable, which rules out the three ways a
 * durability test is usually vacuous (an audit that reads nothing, an audit that opens with a key
 * it still holds, and a store where the kill never changes what landed).
 */
describe('F4 — sealing first and writing the wrap last destroys content, every time', () => {
  it.each([1, 6, 405])('kill after %i durable writes: every sealed row is dead', async (k) => {
    const store = new FakeStore();

    // The by-hand path, assembled from barrel exports only. No façade, no mock, no source edit.
    const resolved = resolveScope(scope, registry);
    const planDoc = createDocPlanner(registry, resolved);
    const source = makeCrypto({ store });
    const dek = await source.dekSource.getCurrentDek(OWNER);
    const recordKey = mintRecordKey(RECORD);
    const patch = planWraps({
      current: {},
      desired: { [OWNER]: dek },
      recordKey,
      productId: PRODUCT,
      record: RECORD,
      granularity: resolved.granularityOf('project'),
      actorAccountId: OWNER,
      scope: 'this-record',
    });

    store.arm(k);
    const writer = store.writer();
    let died: unknown = null;
    try {
      for (let i = 0; i < DOCS; i += 1) {
        const data: Record<string, unknown> = { body: `message ${i}` };
        const plan = planDoc('messages', docId(i), data, (node: unknown, at: PlannedAt) =>
          (typeof node === 'string' ? encryptField(recordKey, at.aad, node) : node));
        await writer.update(docPath(i), { ...data, ...plan.update, id: docId(i) });
      }
      await writer.flush();
      // …and the wrap LAST, which is §14.4's old example and the bug in a published one.
      await writer.update(RECORD.path, {
        [KEY_WRAPS_FIELD]: patch.wraps, [WRAP_HOLDERS_FIELD]: patch.holdersAfter,
      });
      await writer.flush();
    } catch (err) {
      died = err;
    }
    expect(died).toBeInstanceOf(Kill);
    zeroise(recordKey);                                  // the process is gone; the key with it
    store.disarm();                                      // …and so is the knife that killed it

    // The next run does what a migration does on a record with no wraps: it MINTS. A second key,
    // and every row the first key sealed is now noise.
    const next = makeCrypto({ store });
    expect(parseKeyWraps(wrapsIn(store))).toEqual({});
    const remade = await next.createRecord({
      record: RECORD, owner: OWNER, current: wrapsIn(store),
    });
    try {
      const audit = auditStore(store, remade.session);
      expect(audit.sealed).toBeGreaterThan(0);
      expect(audit.opened).toBe(0);
      expect(audit.unopenable).toBe(audit.sealed);       // every one of them, permanently
    } finally {
      remade.session.close();
    }
  });
});

// ---------------------------------------------------------------------------
// F5 — the committer that MUTATES THE PAGE IT WAS HANDED
// ---------------------------------------------------------------------------

/**
 * **The mutating committer, and why it is worse than a lying one.**
 *
 * Every counter-example above tells a falsehood — invents a receipt, invents a read. This one
 * tells none. It writes every wrap, durably, and acknowledges nothing that did not happen. All it
 * does is REORDER THE ARRAY IT WAS GIVEN, which is a natural thing to write: sort a page by path
 * so the store is written in a deterministic order, splice off the entries already handled, reuse
 * the caller's array as a scratch buffer. `createRecords` then re-indexes that array positionally
 * — for the read-back, and for each session's `committedUpdate` — so a page written in a different
 * order hands every session ANOTHER RECORD'S wrap set.
 *
 * The read-back does not see it: it re-reads the reordered array and finds every wrap exactly
 * where that array says it should be, so it is self-consistent and passes. `checkWrapCommit` does
 * not see it either — it reads each record independently and both records genuinely hold a wrap.
 * The measured consequence of the unfixed code, on this page, was both records permanently
 * unreadable:
 *
 *     projects/z_last: RECORD_KEY_UNWRAP_FAILED | projects/a_first: RECORD_KEY_UNWRAP_FAILED
 *
 * because a record key's wrap AAD binds `scopePath` (`record-key.ts`), so record A's wrap sitting
 * on record Z's row is not a wrap at all.
 *
 * **The fix is two layers, and both are asserted below.** The array is `Object.freeze`d, so the
 * in-place mutation throws where it happens rather than silently succeeding; and a private
 * `ours = requests.slice()` is what every positional re-read indexes, so even a mutation that got
 * through could not reach a session. Removing either one turns this section red — see the
 * proven-red note in the header.
 */

/** Two records whose creation order is NOT their path order, which is what a sort disturbs. */
const Z_LAST: RecordRef = aggregateRecordRef('project', 'z_last', 'projects/z_last');
const A_FIRST: RecordRef = aggregateRecordRef('project', 'a_first', 'projects/a_first');
const PAGE: readonly RecordRef[] = [Z_LAST, A_FIRST];

const byPath = (a: WrapCommitRequest, b: WrapCommitRequest): number =>
  (a.record.path < b.record.path ? -1 : 1);

const wrapsAt = (store: FakeStore, record: RecordRef): unknown =>
  store.rows.get(record.path)?.[KEY_WRAPS_FIELD];

const createPage = async (
  crypto: ReturnType<typeof makeCrypto>,
): Promise<readonly CreatedRecord<Collection>[]> =>
  crypto.createRecords(PAGE.map((record) => ({ record, owner: OWNER, current: {} })));

/** The call rejected; hand back what it rejected with. A rejection that never came is a failure
 *  of the test, not a passing assertion about an error nobody saw. */
async function thrownBy(work: Promise<unknown>): Promise<unknown> {
  try {
    await work;
  } catch (err) {
    return err;
  }
  throw new Error('expected this call to reject, and it resolved');
}

/**
 * The real `mintRecordKey`, captured at import time.
 *
 * The probe below replaces the module's export, and EVERY call site — this file's included —
 * resolves through that export, so a pass-through that called the imported binding would recurse
 * for ever. This local is the only reference that does not.
 */
const REAL_MINT_RECORD_KEY = recordKeyModule.mintRecordKey;

/**
 * Watch the keys `createRecord`/`createRecords` mint, so "the minted key was destroyed" can be
 * ASSERTED rather than assumed.
 *
 * It is a pass-through probe and not a mock: the real function runs, the real key is returned, and
 * the only thing added is a reference the test can ask `destroyed` of afterwards. There is no other
 * route to that fact — the caller of a refused create never receives a handle, which is precisely
 * the property that makes the refusal safe and also makes it unobservable from outside.
 */
function captureMintedKeys(): { readonly keys: readonly RecordKey[]; restore(): void } {
  const keys: RecordKey[] = [];
  const spy = jest.spyOn(recordKeyModule, 'mintRecordKey')
    .mockImplementation((record: RecordRef): RecordKey => {
      const key = REAL_MINT_RECORD_KEY(record);
      keys.push(key);
      return key;
    });
  return { keys, restore: (): void => { spy.mockRestore(); } };
}

/**
 * Sorts the page by path **in place**, writes every wrap durably, and invents nothing.
 *
 * Handed a frozen array it cannot sort in place, and does what a real committer would then do:
 * sorts a copy and gets on with the write. Which branch it takes is recorded, because "the in-place
 * sort was REFUSED" is the freeze, observed, and it is the half of the fix a defensive copy alone
 * would leave unproven.
 */
function sortingCommitter(store: FakeStore): {
  readonly committer: WrapCommitter;
  readonly state: { sortedInPlace: boolean };
} {
  const inner = store.committer();
  const state = { sortedInPlace: false };
  return {
    state,
    committer: {
      async commitWraps(requests): Promise<readonly WrapReceipt[]> {
        let page: readonly WrapCommitRequest[] = requests;
        try {
          (requests as WrapCommitRequest[]).sort(byPath);
          state.sortedInPlace = true;
        } catch {
          page = [...requests].sort(byPath);
        }
        return inner.commitWraps(page);
      },
      readWraps: (records): Promise<readonly unknown[]> => inner.readWraps(records),
      isPreconditionFailure: (err): boolean => inner.isPreconditionFailure(err),
    },
  };
}

/** Drops the head of the page it was handed — "this one is already dealt with" — in place. */
function splicingCommitter(store: FakeStore): WrapCommitter {
  const inner = store.committer();
  return {
    async commitWraps(requests): Promise<readonly WrapReceipt[]> {
      (requests as WrapCommitRequest[]).splice(0, 1);
      return inner.commitWraps(requests);
    },
    readWraps: (records): Promise<readonly unknown[]> => inner.readWraps(records),
    isPreconditionFailure: (err): boolean => inner.isPreconditionFailure(err),
  };
}

/** The narrowest mutation there is: one slot of the page overwritten with another. */
function aliasingCommitter(store: FakeStore): WrapCommitter {
  const inner = store.committer();
  return {
    async commitWraps(requests): Promise<readonly WrapReceipt[]> {
      (requests as WrapCommitRequest[])[1] = requests[0];
      return inner.commitWraps(requests);
    },
    readWraps: (records): Promise<readonly unknown[]> => inner.readWraps(records),
    isPreconditionFailure: (err): boolean => inner.isPreconditionFailure(err),
  };
}

/**
 * What a product does with `committedUpdate`: carry it into its own write of the record's row —
 * the document-granular `set(…, { merge: true })` the type's docblock names, which is supposed to
 * be an idempotent no-op because the committer already wrote exactly this.
 *
 * If the update belongs to another record, that no-op is a shred: the row ends up holding a wrap
 * whose AAD names a different `scopePath`, and nothing will ever open it again.
 */
function applyCommittedUpdates(store: FakeStore, created: readonly CreatedRecord<Collection>[]): void {
  created.forEach((one, i) => {
    store.rows.set(PAGE[i].path, { ...(store.rows.get(PAGE[i].path) ?? {}), ...one.committedUpdate });
  });
}

/** Seal one value per record with the session that was handed back, then close both sessions. */
function sealAndClose(created: readonly CreatedRecord<Collection>[]): readonly Record<string, unknown>[] {
  const sealed = created.map((one, i) => one.session.encryptDoc('messages', docId(i), { body: `message ${i}` }));
  for (const one of created) one.session.close();
  return sealed;
}

/** The next run, in a new process: open each record FROM ITS DURABLE ROW and read the value back. */
async function reopenFromRows(
  store: FakeStore,
  sealed: readonly Record<string, unknown>[],
): Promise<readonly unknown[]> {
  const next = makeCrypto({ store });
  const out: unknown[] = [];
  for (let i = 0; i < PAGE.length; i += 1) {
    const adopted = await next.openRecord(
      { record: PAGE[i], keyWraps: wrapsAt(store, PAGE[i]), ownerAccountId: OWNER }, { as: OWNER },
    );
    try {
      out.push(adopted.decryptDoc('messages', docId(i), { ...sealed[i] }).body);
    } finally {
      adopted.close();
    }
  }
  return out;
}

describe('F5 — a committer that REORDERS the page cannot misroute a wrap', () => {
  it('sorting the page in place is REFUSED, and every session still gets its own committedUpdate', async () => {
    const store = new FakeStore();
    const { committer, state } = sortingCommitter(store);
    const created = await createPage(makeCrypto({ store, committer }));

    // Layer one: the page is frozen, so the in-place sort threw where it was written and the
    // committer fell back to sorting a copy. Nothing about the create was disturbed by that.
    expect(state.sortedInPlace).toBe(false);
    expect(created).toHaveLength(PAGE.length);

    // Layer two: each session's own record, its own wraps, its own update — checked positionally,
    // because positional is exactly what the mutation breaks.
    created.forEach((one, i) => {
      expect(one.session.record.path).toBe(PAGE[i].path);
      expect(one.committedUpdate[KEY_WRAPS_FIELD]).toEqual(one.keyWraps);
      expect(one.committedUpdate[WRAP_HOLDERS_FIELD]).toEqual(one.wrapHolders);
    });
    // …and the two records really did get DIFFERENT keys, so "its own" is not trivially true.
    expect(parseKeyWraps(created[0].keyWraps)[OWNER].wrapped)
      .not.toBe(parseKeyWraps(created[1].keyWraps)[OWNER].wrapped);

    // THE PROPERTY, at the level of the data: the product carries each `committedUpdate` into its
    // own row write, and every record still opens from the row that write left behind.
    applyCommittedUpdates(store, created);
    const sealed = sealAndClose(created);
    expect(await reopenFromRows(store, sealed)).toEqual(['message 0', 'message 1']);
  });

  it('splicing the page fails at the COMMIT, where the minted keys can still be destroyed', async () => {
    const store = new FakeStore();
    const probe = captureMintedKeys();
    try {
      const crypto = makeCrypto({ store, committer: splicingCommitter(store) });
      const err = await thrownBy(createPage(crypto));

      // STATED PLAINLY, because it is the part the fix does NOT close: this is still a bare
      // TypeError from the committer's own splice, not a ContentCryptoError. What the freeze
      // changed is WHERE it is thrown — inside `commitWraps`, which sits inside a `try` whose
      // catch zeroises — rather than out of the session assembly, which sits outside every one of
      // them and left two live record keys in a process that no longer had a handle on either.
      expect(err).toBeInstanceOf(TypeError);
      expect(err).not.toBeInstanceOf(ContentCryptoError);

      expect(probe.keys).toHaveLength(PAGE.length);
      for (const key of probe.keys) expect(key.destroyed).toBe(true);

      // It threw before it wrote, so there is not even a stranded wrap — and certainly no session.
      expect(store.rows.size).toBe(0);
      expect(store.objects.size).toBe(0);
    } finally {
      probe.restore();
    }
  });

  it('aliasing one slot of the page over another is refused the same way', async () => {
    const store = new FakeStore();
    const probe = captureMintedKeys();
    try {
      const crypto = makeCrypto({ store, committer: aliasingCommitter(store) });
      const err = await thrownBy(createPage(crypto));

      // Unfrozen, this one is the quietest of the three: it writes the first record's wrap twice,
      // reads back two answers that both exist, and hands the second session the first record's
      // update — while the second record's wrap was never written at all.
      expect(err).toBeInstanceOf(TypeError);
      expect(probe.keys).toHaveLength(PAGE.length);
      for (const key of probe.keys) expect(key.destroyed).toBe(true);
      expect(wrapsAt(store, A_FIRST)).toBeUndefined();
      expect(wrapsAt(store, Z_LAST)).toBeUndefined();
    } finally {
      probe.restore();
    }
  });

  it('is not vacuous: an honest committer creates the same page and both records reopen', async () => {
    // Without this, every assertion above would be satisfied by a package that refused every page
    // it was ever given. The honest committer is the store's own: it writes, all-or-nothing, and
    // only then acknowledges.
    const store = new FakeStore();
    const created = await createPage(makeCrypto({ store }));

    expect(created).toHaveLength(PAGE.length);
    created.forEach((one, i) => {
      expect(one.session.record.path).toBe(PAGE[i].path);
      expect(one.committedUpdate[KEY_WRAPS_FIELD]).toEqual(one.keyWraps);
    });
    applyCommittedUpdates(store, created);
    const sealed = sealAndClose(created);
    expect(await reopenFromRows(store, sealed)).toEqual(['message 0', 'message 1']);
    expectNoKeyMaterial(Object.fromEntries(store.rows), 'store after an honest page create');
  });

  it('is not vacuous: sorting a COPY of the page is a committer nothing here objects to', async () => {
    // The freeze refuses a MUTATION, not an ordering. A committer free to write a page in whatever
    // order it likes is the whole point of handing it the page, and this is what that looks like
    // written correctly — the same sort, one `[...]` earlier.
    const store = new FakeStore();
    const inner = store.committer();
    const created = await createPage(makeCrypto({
      store,
      committer: {
        commitWraps: (requests): Promise<readonly WrapReceipt[]> =>
          inner.commitWraps([...requests].sort(byPath)),
        readWraps: (records): Promise<readonly unknown[]> => inner.readWraps(records),
        isPreconditionFailure: (err): boolean => inner.isPreconditionFailure(err),
      },
    }));

    applyCommittedUpdates(store, created);
    const sealed = sealAndClose(created);
    expect(await reopenFromRows(store, sealed)).toEqual(['message 0', 'message 1']);
  });
});

// ---------------------------------------------------------------------------
// F6 — the wrap that is durable under the WRONG GENERATION
// ---------------------------------------------------------------------------

/**
 * **The read-back compares the whole wrap, not the ciphertext alone.**
 *
 * `gen` is not a label on the side: it chooses which account DEK a reader fetches, and it is bound
 * into the wrap's AAD (`record-key.ts`). A committer that persists the right `wrapped` string under
 * `gen + 1` — a row built by hand from two fields, a generation read from the wrong variable, a
 * store that "helpfully" stamps the account's current generation — therefore stores something that
 * is not the wrap this create committed. Compared on `wrapped` alone it passes:
 *
 *     P4 create: SEALED past read-back | reopen from the durable row: RECORD_KEY_UNWRAP_FAILED
 *
 * which is precisely the failure class the read-back exists to catch, arriving one field to the
 * left of where it was looking. `checkWrapCommit` did not compare generations either.
 */
interface WrongGenerationCommitter extends WrapCommitter {
  /** What `commitWraps` was HANDED, per record — so a test can prove the stored wrap differs from
   *  it in the generation and in nothing else. */
  readonly handed: Map<string, KeyWraps>;
}

function wrongGenerationCommitter(
  store: FakeStore,
  wrongFor: (path: string) => boolean,
): WrongGenerationCommitter {
  const handed = new Map<string, KeyWraps>();
  return {
    handed,
    async commitWraps(requests): Promise<readonly WrapReceipt[]> {
      const committedAt = new Date().toISOString();
      for (const request of requests) {
        handed.set(request.record.path, request.keyWraps);
        const wraps: Record<string, unknown> = {};
        for (const [holder, entry] of Object.entries(parseKeyWraps(request.keyWraps))) {
          // The ciphertext is carried through UNTOUCHED. Only the generation moves.
          wraps[holder] = wrongFor(request.record.path) ? { ...entry, gen: entry.gen + 1 } : entry;
        }
        // A durable write, straight to the row: this fixture is about what LANDS, and it lands.
        store.rows.set(request.record.path, {
          ...(store.rows.get(request.record.path) ?? {}),
          [KEY_WRAPS_FIELD]: wraps,
          [WRAP_HOLDERS_FIELD]: request.wrapHolders,
        });
      }
      return requests.map(() => ({ committedAt }));
    },
    readWraps: async (records): Promise<readonly unknown[]> =>
      records.map((record) => store.rows.get(record.path)?.[KEY_WRAPS_FIELD]),
    isPreconditionFailure: (): boolean => false,
  };
}

describe('F6 — a wrap persisted under another generation is not the wrap that was committed', () => {
  it('REFUSES the create with KEY_STORE_CONFLICT, though the ciphertext matches exactly', async () => {
    const store = new FakeStore();
    const committer = wrongGenerationCommitter(store, () => true);
    const probe = captureMintedKeys();
    try {
      const crypto = makeCrypto({ store, committer });
      const err = await thrownBy(crypto.createRecord({ record: RECORD, owner: OWNER, current: {} }));

      expect(err).toBeInstanceOf(ContentCryptoError);
      expect(err).toMatchObject({ code: 'KEY_STORE_CONFLICT' });
      expect((err as Error).message).toMatch(/holds a DIFFERENT wrap/);
      // Nothing was sealed and the key is gone, which is what makes the refusal safe to act on.
      expect(probe.keys).toHaveLength(1);
      expect(probe.keys[0].destroyed).toBe(true);

      // NON-VACUITY, and the whole of the point: the store holds a wrap, for the right holder,
      // whose ciphertext is byte-for-byte the one this create committed. The generation is the
      // only field that differs — so a comparison on `wrapped` alone passes this row.
      const stored = parseKeyWraps(wrapsAt(store, RECORD));
      const sent = parseKeyWraps(committer.handed.get(RECORD.path));
      expect(wrapCount(stored)).toBe(1);
      expect(stored[OWNER].wrapped).toBe(sent[OWNER].wrapped);
      expect(stored[OWNER].gen).toBe(sent[OWNER].gen + 1);
    } finally {
      probe.restore();
    }
  });

  it('and the durable row it left behind does not open, which is what was being prevented', async () => {
    const store = new FakeStore();
    const crypto = makeCrypto({ store, committer: wrongGenerationCommitter(store, () => true) });
    await expect(crypto.createRecord({ record: RECORD, owner: OWNER, current: {} })).rejects.toThrow();

    // Had the create been allowed to resolve, THIS is the row every later run would open the
    // record from. It refuses — so the refusal above is not pedantry about a field nobody reads.
    const next = makeCrypto({ store });
    await expect(
      next.openRecord({ record: RECORD, keyWraps: wrapsAt(store, RECORD), ownerAccountId: OWNER }, { as: OWNER }),
    ).rejects.toThrow(ContentCryptoError);
  });

  it('catches it on ANY record of a page, not merely the first', async () => {
    // The read-back walks every request in the page precisely because a page is where a partial
    // or garbled commit hides behind a full set of receipts.
    const store = new FakeStore();
    const crypto = makeCrypto({
      store, committer: wrongGenerationCommitter(store, (path) => path === A_FIRST.path),
    });
    const err = await thrownBy(createPage(crypto));
    expect(err).toMatchObject({ code: 'KEY_STORE_CONFLICT' });
    expect((err as Error).message).toContain(A_FIRST.path);
  });

  it('is not vacuous: the same committer, persisting the generation it was given, passes', async () => {
    // One character of difference between this committer and the one above, so the refusal cannot
    // be about the fixture writing its rows by hand, or about anything else in its shape.
    const store = new FakeStore();
    const created = await createPage(makeCrypto({
      store, committer: wrongGenerationCommitter(store, () => false),
    }));

    expect(created).toHaveLength(PAGE.length);
    applyCommittedUpdates(store, created);
    const sealed = sealAndClose(created);
    expect(await reopenFromRows(store, sealed)).toEqual(['message 0', 'message 1']);
  });
});

// ---------------------------------------------------------------------------
// F7 — the committer that TIDIES ITS OWN RECEIPTS after handing them over
// ---------------------------------------------------------------------------

/**
 * **The other half of F5, on the way back.**
 *
 * F5 is the array the package hands the committer. This is the array the committer hands the
 * package, and it is the same defect shape with the port turned round: `commitWraps` returns the
 * committer's OWN array, and the committer still holds a reference to it. `assertReceipts`
 * validates that array positionally, **two awaits then pass** — `readWraps`, and whatever the
 * store does inside it — and only afterwards does the assembly read `receipts[i]`. A committer
 * that tidies its bookkeeping in between (`mine.reverse()` before the next call, a sort by path, a
 * `splice` of the entries it has dealt with) says nothing false, writes every wrap durably, and
 * hands every session ANOTHER record's `WrapReceipt`.
 *
 * It matters because of what a receipt carries. `WrapReceipt.precondition` is *the precondition
 * token for the row as it now stands, so the content write that follows can carry one without a
 * re-read* — so a misrouted receipt puts record B's token on record A's content write. Measured on
 * the unfixed code, on this two-record page:
 *
 *     receipts misrouted: 2 of 2 | committedUpdate: correct (protected by `ours`)
 *
 * — which is the tell that the two layers are separate: the private `ours = requests.slice()`
 * protects everything derived from the REQUESTS, and nothing at all protects the receipts, because
 * that array was never the package's to freeze. The fix is the matching copy,
 * `(await committer.commitWraps(requests)).slice()`, and removing it turns this section red.
 *
 * **The plural path is where it bites**, so that is what every case below drives: a one-record page
 * cannot be reordered, and `createRecord` is `createRecords` of one.
 *
 * What the copy does NOT close, stated rather than implied: it is a copy of the ARRAY. A committer
 * that mutates the receipt OBJECTS themselves — one shared receipt reused across calls, a
 * `precondition` written onto it later — is not touched by it, because those objects are the
 * committer's own and the package never clones them. That residue is `checkWrapCommit`'s
 * assertion (8), in the product's own CI, where the far side of the port can be looked at.
 */

/** The token this store hands back with a committed write, and demands on the write after it. */
const tokenFor = (path: string): string => `updateTime@${path}`;

interface ReceiptTidyingCommitter extends WrapCommitter {
  /** The committer's OWN array, still in its hands after it was handed over. */
  readonly mine: WrapReceipt[];
}

/**
 * Honest in every respect that can be checked: it writes each wrap durably through the store's own
 * committer, reports the write time it was given, and invents nothing. All it does is keep the
 * array it returned and tidy it on the way past — which is what `tidy` is, and the only thing that
 * varies between the cases below.
 */
function receiptTidyingCommitter(
  store: FakeStore,
  tidy: (mine: WrapReceipt[]) => void,
): ReceiptTidyingCommitter {
  const inner = store.committer();
  const mine: WrapReceipt[] = [];
  return {
    mine,
    async commitWraps(requests): Promise<readonly WrapReceipt[]> {
      const acknowledged = await inner.commitWraps(requests);
      mine.length = 0;
      requests.forEach((request, i) => {
        mine.push({
          committedAt: acknowledged[i].committedAt,
          precondition: tokenFor(request.record.path),
        });
      });
      // The committer's own array, handed straight over — which is what a committer that keeps
      // any bookkeeping at all naturally does, and is not in itself a lie or a mistake.
      return mine;
    },
    async readWraps(records): Promise<readonly unknown[]> {
      // The tidy-up, on the way past. This is the SECOND of the two awaits that pass between
      // `commitWraps` resolving and `receipts[i]` being read, and nothing false is said here.
      tidy(mine);
      return inner.readWraps(records);
    },
    isPreconditionFailure: (err): boolean => inner.isPreconditionFailure(err),
  };
}

/**
 * The content write that follows a create, carrying the receipt's precondition — and a store that
 * CHECKS it, which is the only reason to carry one.
 *
 * A token belonging to another record is refused here. That is the CHEAP version of the failure:
 * the expensive one is a store that takes the token at its word, where the write lands and the
 * damage is found later by somebody reading a row that no longer says what it should.
 */
function writeContentUnder(
  store: FakeStore,
  record: RecordRef,
  precondition: unknown,
  sealed: Record<string, unknown>,
): void {
  if (precondition !== tokenFor(record.path)) {
    throw new Error(
      `precondition lost on ${record.path}: the content write carried ${String(precondition)}`,
    );
  }
  store.rows.set(`${record.path}/messages/m_0`, sealed);
}

describe('F7 — a committer that tidies its own receipts cannot misroute one', () => {
  it('reversing them between the commit and the read-back still routes each receipt to its own record', async () => {
    const store = new FakeStore();
    const committer = receiptTidyingCommitter(store, (mine) => { mine.reverse(); });
    const created = await createPage(makeCrypto({ store, committer }));

    expect(created).toHaveLength(PAGE.length);
    // The committer really did reverse the array it handed over — so what follows is an assertion
    // about the package's copy, and not about a mutation that never happened.
    expect(committer.mine.map((receipt) => receipt.precondition))
      .toEqual([tokenFor(A_FIRST.path), tokenFor(Z_LAST.path)]);
    // …and the two tokens differ, so "its own" is not trivially true.
    expect(tokenFor(PAGE[0].path)).not.toBe(tokenFor(PAGE[1].path));

    created.forEach((one, i) => {
      expect(one.session.record.path).toBe(PAGE[i].path);
      // THE FIELD THAT MAKES THE MISROUTE DANGEROUS.
      expect(one.receipt.precondition).toBe(tokenFor(PAGE[i].path));
      // The other layer, unaffected either way: `committedUpdate` is derived from `ours`, the
      // package's private copy of the REQUESTS, which is why the measured misroute was 2 of 2 on
      // the receipts and 0 of 2 here.
      expect(one.committedUpdate[KEY_WRAPS_FIELD]).toEqual(one.keyWraps);
    });
  });

  it('so the content write that follows carries ITS OWN record\'s token, and the store takes it', async () => {
    const store = new FakeStore();
    const committer = receiptTidyingCommitter(store, (mine) => { mine.reverse(); });
    const created = await createPage(makeCrypto({ store, committer }));

    applyCommittedUpdates(store, created);
    const sealed = sealAndClose(created);

    // THE PROPERTY, at the level of the data. Unfixed, this is where the misroute lands: record
    // z_last's first content write carrying record a_first's token. Written as an expectation
    // rather than left to throw, so a red run names the defect rather than a stray rejection.
    created.forEach((one, i) => {
      expect(() => writeContentUnder(store, PAGE[i], one.receipt.precondition, sealed[i])).not.toThrow();
    });
    expect(await reopenFromRows(store, sealed)).toEqual(['message 0', 'message 1']);
  });

  it('splicing them leaves no session holding an undefined receipt', async () => {
    // The quietest of the three: a committer dropping the entries it has dealt with. Unfixed,
    // `receipts[1]` is simply not there, and the second session is handed `undefined` where its
    // store acknowledgement belongs — a receipt nobody can carry and nobody was told about.
    const store = new FakeStore();
    const committer = receiptTidyingCommitter(store, (mine) => { mine.splice(0, 1); });
    const created = await createPage(makeCrypto({ store, committer }));

    expect(committer.mine).toHaveLength(PAGE.length - 1);
    created.forEach((one, i) => {
      expect(one.receipt).toBeDefined();
      expect(typeof one.receipt.committedAt).toBe('string');
      expect(one.receipt.precondition).toBe(tokenFor(PAGE[i].path));
    });
  });

  it('sorting them by path is the same defect written the way a committer would write it', async () => {
    const store = new FakeStore();
    const committer = receiptTidyingCommitter(store, (mine) => {
      mine.sort((a, b) => (String(a.precondition) < String(b.precondition) ? -1 : 1));
    });
    const created = await createPage(makeCrypto({ store, committer }));

    created.forEach((one, i) => {
      expect(one.receipt.precondition).toBe(tokenFor(PAGE[i].path));
    });
  });

  it('is not vacuous: the same committer, tidying nothing, routes them identically', async () => {
    // One argument of difference from the cases above, so nothing asserted there can be about the
    // fixture's shape: the tokens, the order and the assembly are all as they were.
    const store = new FakeStore();
    const committer = receiptTidyingCommitter(store, () => { /* tidies nothing */ });
    const created = await createPage(makeCrypto({ store, committer }));

    expect(committer.mine).toHaveLength(PAGE.length);
    created.forEach((one, i) => {
      expect(one.receipt.precondition).toBe(tokenFor(PAGE[i].path));
    });
    applyCommittedUpdates(store, created);
    const sealed = sealAndClose(created);
    created.forEach((one, i) => {
      expect(() => writeContentUnder(store, PAGE[i], one.receipt.precondition, sealed[i])).not.toThrow();
    });
    expect(await reopenFromRows(store, sealed)).toEqual(['message 0', 'message 1']);
  });

  it('is not vacuous: a committer that tidies a COPY is one nothing here objects to', async () => {
    // The copy the package takes refuses a MUTATION reaching the assembly, not a committer keeping
    // its own books. This is the same tidy-up written correctly, one `[...]` earlier.
    const store = new FakeStore();
    const inner = store.committer();
    const kept: WrapReceipt[][] = [];
    const created = await createPage(makeCrypto({
      store,
      committer: {
        async commitWraps(requests): Promise<readonly WrapReceipt[]> {
          const acknowledged = await inner.commitWraps(requests);
          const receipts = requests.map((request, i) => ({
            committedAt: acknowledged[i].committedAt,
            precondition: tokenFor(request.record.path),
          }));
          kept.push([...receipts].reverse());
          return receipts;
        },
        readWraps: (records): Promise<readonly unknown[]> => inner.readWraps(records),
        isPreconditionFailure: (err): boolean => inner.isPreconditionFailure(err),
      },
    }));

    expect(kept[0].map((receipt) => receipt.precondition))
      .toEqual([tokenFor(A_FIRST.path), tokenFor(Z_LAST.path)]);
    created.forEach((one, i) => {
      expect(one.receipt.precondition).toBe(tokenFor(PAGE[i].path));
    });
  });
});
