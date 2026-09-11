/**
 * `walk.ts` — the traversal injection contract, the batch writer, and the one wrap job.
 *
 * **This is the seam five products implement.** Getting a type wrong here means five repos change,
 * so every name below is either something a product supplies (`ForEachRecord`, `WriteSink`) or
 * something the package does with it (`createBatchWriter`, `runWrapJob`). Nothing here reads or
 * writes anything itself: write targets and preconditions are opaque, the store's own vocabulary
 * stays in the store's adapter, and the package may not import a store client even as a type.
 *
 * ── THERE ARE TWO TRAVERSALS, THEY NEST, AND ONLY THE OUTER ONE IS ROUTINE ───────────────────
 *
 * `forEachRecord` walks RECORDS — one head per wrap holder, no content — and that is the whole of
 * rotate, grant, revoke, transfer and erase. `forEachContentDoc` walks the CONTENT inside one
 * record and is needed only for migration, re-key and export. Under record keys collab's rotation
 * stops being five hundred reads, N thousand AES operations and five hundred writes, and becomes
 * one read and one write. `runWrapJob` never calls the inner one, and `aggregate-root.test.ts`
 * asserts that as a call count rather than as a claim.
 *
 * ── THE TRAP THIS FILE EXISTS TO CATCH ───────────────────────────────────────────────────────
 *
 * collab's rotation enumerates by OWNERSHIP. Under federation that is wrong and silently
 * destructive: a record owned by A and shared to B carries a wrap under B's DEK, and rotating B's
 * DEK must rewrap it. An ownership query misses that record, the job reports the generation
 * drained, the old wrap is erased, and **B's access is gone with no error anywhere**.
 *
 * So `forEachRecord(accountId)` means *the records on which this account HOLDS A WRAP* — a
 * different query, which is what `wrapHolders` exists to make possible. `assertHead` is the
 * production guard on every head; `checkTraversal`, in `./testing`, is the in-memory conformance
 * suite a product runs against its own traversal in its own repo, and it is the thing that
 * actually catches an ownership query.
 *
 * ── WHERE `assertHead` LIVES ─────────────────────────────────────────────────────────────────
 *
 * It is DECLARED in `key-scope.ts`, because granularity is compared in exactly one file, and
 * PUBLISHED from here, because a head is this module's noun. The barrel re-exports it from
 * `./walk` and from nowhere else, which is why it was deliberately left off the barrel until this
 * module existed: exporting it from `./key-scope` first would have been a name that then had to
 * move.
 *
 * At aggregate granularity the wrap lives on the aggregate root and NOWHERE else. `WalkedDoc` has
 * no wrap field and no product may give one to a child row; `assertHead` refuses a head whose path
 * is below the aggregate root. Anything that walks children to find a wrap has the design wrong,
 * and both halves of that are refusals rather than advice.
 *
 * ── TWO ENTRY POINTS, ONE JOB (R13) ──────────────────────────────────────────────────────────
 *
 * `runWrapJob` walks a SET of records for one holder — that is a rotation, an account-wide grant,
 * an account-wide revoke, a drain. `applyWrapPatch` applies ONE already-planned patch to ONE
 * record: the single-record grant, un-share, transfer and erase, which is what four of the five
 * §14 worked examples actually do.
 *
 * **`applyWrapPatch` is not a second implementation — it IS `runWrapJob`, over a traversal of one
 * record.** That is the point of it rather than a shortcut in writing it. `materialiseWrapPatch`
 * has exactly ONE call site in this package, so "a path that writes a wrap without translating the
 * sentinel" is not a thing a reviewer has to look for: it does not exist to be written. The
 * single-record case had no first-class route before, which is precisely why four worked examples
 * wrote `patch.update` raw with a materialiser sitting on the barrel beside them — an export a
 * caller has to already know about does nothing for the caller who does not, which is the whole of
 * the case for taking it off the barrel and giving the route it was excusing a proper door.
 */

import { conflictPolicyFor, materialiseWrapPatch } from './wrap-patch';
import type { ConflictPolicy, DesiredWraps, WrapAudit, WrapPatch } from './wrap-patch';
import { ContentCryptoError, compact } from './errors';
import { KEY_WRAPS_FIELD, WRAP_HOLDERS_FIELD, holdersOf } from './record-key';
import type { KeyWraps, RecordRef } from './record-key';
import type { ObjectRef } from './object-envelope';
import { assertHead } from './key-scope';
import type { ResolvedScope } from './key-scope';

/**
 * The production guard on every head, declared in `key-scope.ts` and published here.
 *
 * `runWrapJob` calls it on every head before anything is planned against that head, which is what
 * makes it a production guard rather than a test helper — and is why it stays on the barrel while
 * `checkTraversal` moved to `./testing`. Imported as well as re-exported, because the caller that
 * earns it that place is in this file.
 */
export { assertHead };

// ---------------------------------------------------------------------------
// Preconditions — ONE token type, and one WORD for declining to use one
// ---------------------------------------------------------------------------

/**
 * The store's own read-time token: an update time, a generation number, an `ifGenerationMatch`,
 * whatever this store has. **Opaque** — the package never inspects one, and may not import a store
 * client even as a type.
 *
 * One type, used by `RecordHead`, `WalkedDoc`, `WriteRow` and `WrapApplyArgs`, rather than a
 * parallel type per site: a token is one concept and every one of those carries the same one.
 *
 * `NonNullable<unknown>` rather than `unknown`, and that narrowing IS the content of the type: a
 * token is whatever the store handed back, and `null`/`undefined` are not things a store hands
 * back. Absence is said by the FIELD being absent — the precedent `assertNoSecrets` rule 3 already
 * sets in this package, where an optional field is OMITTED rather than set to `undefined`.
 */
export type PreconditionToken = NonNullable<unknown>;

/**
 * A token, **or the word** — what a required `precondition` takes (R18, precondition).
 *
 * The word is the opt-out, and it is a word on purpose. See `WrapApplyArgs.precondition` for why
 * `null` and `undefined` are not accepted in its place; the short form is that **`null` is
 * JavaScript's accidental value and a word cannot be.**
 */
export type Precondition = PreconditionToken | 'unconditional';

// ---------------------------------------------------------------------------
// What the product yields
// ---------------------------------------------------------------------------

/**
 * One record the account holds a wrap on.
 *
 * Produced by the PRODUCT, consumed by the package, and it is exactly what one read of the
 * wrap-bearing document yields — the package never reads.
 */
export interface RecordHead {
  /** Granularity-checked by `assertHead`. */
  readonly record: RecordRef;
  readonly ownerAccountId: string;
  /**
   * The current wrap set, read from the document at `record.path`. THE input to `planWraps`.
   *
   * It arrives with the precondition token from the SAME read, which is what makes the
   * compare-and-set meaningful and makes the two impossible to disagree. A head that carried a
   * wrap set from one read and a token from another would compare-and-set against a state nobody
   * ever observed.
   */
  readonly keyWraps: KeyWraps;
  /** Opaque write target. Handed back to the `WriteSink` untouched; the package never inspects
   *  it — the package may not import a store client even as a type. */
  readonly ref: unknown;
  /**
   * Opaque read-time token — an update time, a generation number, whatever the store has.
   *
   * **Optional HERE, and that is the considered answer rather than an oversight.** R18
   * (precondition) makes the token required on the single-record apply, which assembles a head out
   * of loose arguments where an omitted one is invisible at the call site. A head is not assembled:
   * it comes back from the ONE read that produced the wrap set beside it, so a traversal either has
   * a token or its store has none to give — a fact about the product's read, stated once in its
   * `forEachRecord`, rather than a decision taken per call. Requiring the word here would put it in
   * five repos' traversals to restate what the read already says, and `applyWrapPatch` could not
   * then build its own head without writing the accidental value the ruling exists to exclude.
   */
  readonly precondition?: PreconditionToken;
  /** Optional resume token: passing it back as `from` resumes strictly AFTER this head. */
  readonly cursor?: string;
}

/**
 * The product's record traversal.
 *
 * **The contract, in full, because five repos implement it:**
 *
 * - **Holder-scoped, not ownership-scoped.** `accountId` names the account that HOLDS A WRAP, not
 *   the account that owns the record. See the trap at the top of this file; this is the clause
 *   that matters most and the one that has no error at the point of damage.
 * - **Deterministic total order, each record yielded exactly ONCE.** Document-id order under a
 *   single equality filter is the recommended shape (`orderBy(__name__).limit(400)` plus a
 *   start-after), because it needs no composite index.
 * - **Sequential and awaited**: `for (const row of page) await visit(head)`. Sequential is a
 *   CONTRACT and not an implementation detail — concurrency would require the product to know the
 *   package's batch bounds, and the structural backpressure is what lets the visitor own an
 *   accumulator safely.
 * - **The visitor may throw**, and a throw must abort the traversal rather than be swallowed.
 * - **Resume is optional and opaque.** `from` resumes strictly AFTER the head whose `cursor` it
 *   was; the product stores nothing on the package's behalf and the package stores nothing at all.
 *   collab is restartable-not-resumable and gets away with it because every plan is idempotent,
 *   but Morph's object records are per-record, so its record walk is the size collab's document
 *   walk was — which is what one optional field and one optional parameter buy.
 * - **Paging is the product's.** So is the page size; `WALK_PAGE_SIZE` is the package's own batch
 *   bound and the recommended page size, not a requirement on this function.
 */
export type ForEachRecord = (
  accountId: string,
  visit: (head: RecordHead) => Promise<void>,
  from?: string,
) => Promise<void>;

/**
 * The product's content traversal, NESTED INSIDE one record.
 *
 * Needed only for migration, re-key and export — **never** for rotation, grant, revoke or erase.
 * Unlike the record-walk visitor, this one may do anything async, subject to a single rule: it
 * must not write the wrap-bearing document outside the sink, or the preconditions the job is
 * holding are stale.
 */
export type ForEachContentDoc<C extends string> = (
  head: RecordHead,
  visit: (doc: WalkedDoc<C>) => Promise<void>,
) => Promise<void>;

/** Optional, and no product needs it until a re-key happens: under record keys an object sits
 *  under its record's key and its envelope names no generation, so a rotation touches no bytes and
 *  lists no bucket. */
export type ForEachContentObject = (
  head: RecordHead,
  visit: (ref: ObjectRef) => Promise<void>,
) => Promise<void>;

/**
 * collab's `WalkedDoc`, with the snapshot replaced by the three things it was ever used for.
 *
 * **There is NO wrap field here and no product may register one.** A child document is content
 * only. This is "anything that walks children to find a wrap has the design wrong", expressed as a
 * type with nowhere to put one — and `aggregate-root.test.ts` asserts that `doc.keyWraps` does not
 * compile.
 */
export interface WalkedDoc<C extends string> {
  readonly collection: C;
  /**
   * The AAD id — the row id, UNLESS the row is a subcollection member, in which case it is the
   * path relative to its registered `root`, exactly as collab's `versionDocId` already does
   * (`{topicId}/versions/{versionId}` gives the AAD `artefacts/t1/versions/v3.content`). MAY
   * contain `/`, must NOT contain `.`.
   *
   * The AAD id is not always the row id, and missing that costs a rotation.
   */
  readonly aadDocId: string;
  readonly data: unknown;
  readonly ref: unknown;
  readonly precondition?: PreconditionToken;
}

// ---------------------------------------------------------------------------
// The write side
// ---------------------------------------------------------------------------

/** One row to write. `update` is already materialised — every sentinel translated. */
export interface WriteRow {
  readonly ref: unknown;
  readonly update: Readonly<Record<string, unknown>>;
  /** Absent means this row carries no precondition — a blind write, which on the single-record
   *  route the caller had to say in words. See `PreconditionToken`. */
  readonly precondition?: PreconditionToken;
}

/**
 * The product's writer. The package batches and decides conflict policy; the product commits.
 *
 * What is NOT generic — and is why these three members are the product's — is a batch itself and
 * its ceiling. What IS generic is the policy: batch, on failure retry row by row so one conflicted
 * row costs only itself, and count a precondition loss as "already done" *only where that is
 * true*. That last clause is `conflictPolicyFor`, and it is dangerous to re-derive: skipping a
 * precondition loss is right for a rewrap and **wrong for a revoke, where it silently drops the
 * revocation.**
 */
export interface WriteSink {
  /** Firestore's is 500; collab uses 400. */
  readonly maxBatchSize: number;
  /**
   * The store's own "delete this field" sentinel — required, not optional.
   *
   * Every patch this module writes is translated through it, and a path that skipped the
   * translation would store a literal `{ op: 'delete' }` map where a revocation should be. Stated
   * accurately, because the overstated version of this was load-bearing for a while: the tolerant
   * parser drops that map on read, so the account is **not** a holder and `wrapHolders` — a plain
   * array, which writes correctly raw — is right as well. What is wrong is the raw key set:
   * anything reading `Object.keys(keyWraps)` rather than `holdersOf()` sees a ghost holder. And it
   * is NOT permanent — `planWraps` diffs on RAW keys, so the next reconcile on that record removes
   * it. The exposure is a ghost holder until the next reconcile, which is narrow and real; it is
   * not a revocation that half-works for ever.
   *
   * Making the sentinel required is what stops a sink being written without one; making
   * `materialiseWrapPatch` internal (R13) is what stops the translation being skipped at all.
   */
  readonly deleteField: unknown;
  /** All-or-nothing; may throw. */
  writeBatch(rows: readonly WriteRow[]): Promise<void>;
  /** The row-by-row retry after a failed batch. */
  writeOne(row: WriteRow): Promise<void>;
  /** gRPC 9, an `ifGenerationMatch` mismatch, whatever this store calls it. The package must not
   *  know, which is exactly why this is here rather than a regex in the package. */
  isPreconditionFailure(err: unknown): boolean;
}

export interface BatchWriterOptions {
  readonly sink: WriteSink;
  /** From `conflictPolicyFor(patch)`. Never chosen by hand: `'skip'` is the dangerous one and it
   *  is derived, never the other way round. */
  readonly policy: ConflictPolicy;
  /** Defaults to `min(sink.maxBatchSize, WALK_PAGE_SIZE)`. A larger request is still bounded by
   *  the sink's own ceiling, which is a store limit rather than a preference. */
  readonly maxBatchSize?: number;
}

export interface BatchWriter {
  enqueue(row: WriteRow): Promise<void>;
  flush(): Promise<void>;
  readonly written: number;
  /** Precondition lost under policy `'skip'` — i.e. the live writer already did this exact work.
   *  Under `'retry'` a precondition loss is never counted here, because it is never dropped. */
  readonly skipped: number;
}

/**
 * Also the write batch size, so a page in memory and a batch in flight are the same 400 rows —
 * collab's `const BATCH_SIZE = WALK_PAGE_SIZE`, kept as ONE constant rather than two that agree
 * today.
 */
export const WALK_PAGE_SIZE = 400;

function invalid(message: string): never {
  throw new ContentCryptoError('VALIDATION_ERROR', message);
}

function assertSink(sink: unknown): asserts sink is WriteSink {
  const s = sink as Partial<WriteSink> | null;
  if (
    s === null ||
    typeof s !== 'object' ||
    typeof s.writeBatch !== 'function' ||
    typeof s.writeOne !== 'function' ||
    typeof s.isPreconditionFailure !== 'function'
  ) {
    invalid('a WriteSink with writeBatch, writeOne and isPreconditionFailure is required');
  }
  if (!Number.isSafeInteger(s.maxBatchSize) || (s.maxBatchSize as number) <= 0) {
    invalid(`WriteSink.maxBatchSize must be a positive safe integer, received ${String(s.maxBatchSize)}`);
  }
  if (!('deleteField' in s)) {
    invalid(
      "WriteSink.deleteField is required: every WrapPatch is materialised through it, and a sink " +
        'without one would store a literal delete sentinel where a revocation belongs — which the ' +
        'tolerant parser then drops on read, leaving a ghost holder in the raw key map until the ' +
        'next reconcile diffs it away',
    );
  }
}

/**
 * The product's own fields, on their way into the SAME row as the wrap change.
 *
 * The wrap fields are the patch's, and a product writing one itself is the raw write this module
 * exists to make unnecessary — so the three keys a `WrapPatch.update` can address are refused here
 * rather than merged over.
 */
function assertAlso(also: unknown): asserts also is Readonly<Record<string, unknown>> {
  if (also === null || typeof also !== 'object' || Array.isArray(also)) {
    invalid(
      "`also` must be a plain object of the product's OWN fields, to be written in the same row " +
        `as the wrap change, received ${also === null ? 'null' : typeof also}`,
    );
  }
  for (const key of Object.keys(also as Record<string, unknown>)) {
    if (
      key === KEY_WRAPS_FIELD ||
      key === WRAP_HOLDERS_FIELD ||
      key.startsWith(`${KEY_WRAPS_FIELD}.`)
    ) {
      invalid(
        `\`also\` may not write '${key}'. The wrap fields belong to the WrapPatch, and a product ` +
          'setting one by hand is the untranslated raw write these entry points exist to replace',
      );
    }
  }
}

/**
 * Batch, and on failure retry row by row so one conflicted row costs only itself.
 *
 * The retry is not a nicety. A batch is all-or-nothing, so one row whose precondition moved would
 * otherwise cost the whole batch — and under `'retry'` that would mean re-planning four hundred
 * records to redo one.
 *
 * **What a precondition loss means depends on the patch, which is why the policy is a
 * parameter.** Under `'skip'` — a pure rewrap — it means the live writer already wrapped at the
 * current generation, so there is nothing to redo and the row is counted as `skipped`. Under
 * `'retry'` — anything that added or removed a wrap — the row-by-row write IS the retry, and if
 * the row still loses its own precondition the error PROPAGATES: the change is genuinely contested,
 * the remedy is a re-read and a re-plan, and only the caller can do that. Swallowing it there is
 * how a revocation gets dropped in silence.
 */
export function createBatchWriter(opts: BatchWriterOptions): BatchWriter {
  if (opts === null || typeof opts !== 'object') {
    invalid('createBatchWriter needs its options object');
  }
  const { sink, policy } = opts;
  assertSink(sink);
  if (policy !== 'skip' && policy !== 'retry') {
    invalid(
      `BatchWriterOptions.policy must come from conflictPolicyFor(patch), received ${String(policy)}`,
    );
  }
  const requested = opts.maxBatchSize ?? WALK_PAGE_SIZE;
  if (!Number.isSafeInteger(requested) || requested <= 0) {
    invalid(`BatchWriterOptions.maxBatchSize must be a positive safe integer, received ${String(requested)}`);
  }
  const maxBatchSize = Math.min(requested, sink.maxBatchSize);

  const pending: WriteRow[] = [];
  let written = 0;
  let skipped = 0;

  const writeRowByRow = async (rows: readonly WriteRow[]): Promise<void> => {
    for (const row of rows) {
      try {
        await sink.writeOne(row);
        written += 1;
      } catch (err) {
        if (policy === 'skip' && sink.isPreconditionFailure(err)) {
          skipped += 1;
          continue;
        }
        throw err;
      }
    }
  };

  const drain = async (): Promise<void> => {
    while (pending.length > 0) {
      // FROZEN before the handover. `writeRowByRow` below re-reads this same array, so a sink
      // that shrinks it and then throws would make the retry skip rows — and under
      // `policy: 'retry'` those rows are grants and REVOCATIONS. A silently dropped revocation
      // is the failure `conflictPolicyFor` exists to prevent. The array is ours (it came from
      // `splice`), so freezing it costs nothing.
      const rows = Object.freeze(pending.splice(0, maxBatchSize));
      try {
        await sink.writeBatch(rows);
        written += rows.length;
      } catch {
        // The batch failed — possibly for one row out of four hundred. Which one, and whether it
        // was a precondition at all, is knowable only one row at a time.
        await writeRowByRow(rows);
      }
    }
  };

  return {
    async enqueue(row: WriteRow): Promise<void> {
      if (row === null || typeof row !== 'object') {
        invalid('BatchWriter.enqueue needs a WriteRow');
      }
      pending.push(row);
      if (pending.length >= maxBatchSize) await drain();
    },
    flush: drain,
    get written(): number {
      return written;
    },
    get skipped(): number {
      return skipped;
    },
  };
}

// ---------------------------------------------------------------------------
// The one job
// ---------------------------------------------------------------------------

export interface WrapJobArgs<RT extends string = string> {
  /**
   * The product's resolved scope.
   *
   * Required, and NOT in §13.3's declaration — which says `assertHead` is used by `runWrapJob` on
   * every head and then gives the job nothing to call it with. A job that could not check its
   * heads would leave the walked-children mistake to be caught by a conformance suite the product
   * might not run.
   */
  readonly scope: ResolvedScope<RT>;
  /** The account whose wraps this job is reconciling — **the holder**, not the owner. */
  readonly accountId: string;
  readonly forEachRecord: ForEachRecord;
  readonly sink: WriteSink;
  /** What the wrap set should be after this job, for this head. `desired` is what makes ONE job
   *  express rotate, grant, revoke, transfer and erase. */
  readonly desired: (head: RecordHead) => DesiredWraps;
  /**
   * The reconcile, bound to an open session or to a hand-unwrapped record key.
   *
   * Synchronous by contract: **no I/O and no key fetch inside the walk.** The product fetches its
   * two `DekHandle`s up front and the closure calls `unwrapRecordKey` and `planWraps` directly,
   * both of which are synchronous. That is collab's `loadAllDeks` rule — keys up front, transform
   * synchronous, no document left half at each generation.
   */
  readonly wrap: (head: RecordHead, desired: DesiredWraps) => WrapPatch;
  /**
   * The product's own fields for this record, written in the SAME row as the wrap change.
   *
   * This exists because two of the five worked examples need it and neither can be split: Morph's
   * `setArtifactScope` moves the audience and the `scope` policy field together, and collab's
   * transfer moves the wraps and `accountId`/`ownerId` together. Split into two writes there is an
   * observable state in which the wraps say one thing and the product's own row says another,
   * which is the window `planWraps` is a single patch to avoid.
   *
   * Two consequences, both deliberate:
   *
   * - **It forces the write.** A patch that changed nothing writes nothing — unless `also`
   *   returned fields, which must land whether or not the wrap set moved. Morph re-saving the same
   *   audience with a different `visibility` is exactly that case, and dropping the row there
   *   would lose the product's change silently.
   * - **It forces `'retry'`.** `'skip'` means "the live writer already did this exact work", and
   *   nothing the live writer did wrote these fields.
   *
   * Returning `undefined` is the same as not supplying it. The wrap fields are refused.
   */
  readonly also?: (head: RecordHead) => Readonly<Record<string, unknown>> | undefined;
  /** Resume strictly after the head whose `cursor` this was. */
  readonly from?: string;
  /**
   * How long to wait before the first write, so that no warm instance is still minting at the old
   * generation. **Defaults to 0**: a rotation passes `quiesceMsFor()`, and a grant, revoke,
   * transfer or erase publishes no new generation and has nothing to wait for. Defaulting to a
   * two-minute sleep would put one in front of every revocation.
   */
  readonly quiesceMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
}

export interface WrapJobResult {
  readonly recordsVisited: number;
  readonly recordsWritten: number;
  /** Precondition lost under a `'skip'` policy: the live writer already did it. */
  readonly recordsSkipped: number;
  /** The **scopePaths** whose wrap set is now empty — the erase sweep's input. The package
   *  deletes nothing: `WriteRow` has nowhere to express a delete, and at aggregate granularity
   *  what the product deletes is the whole aggregate rather than one document. */
  readonly recordsToDelete: readonly string[];
  readonly lastCursor?: string;
  /** One entry per record this job CHANGED. A no-op re-run of an idempotent job manufactures
   *  nothing: an audit of five hundred entries saying nothing happened is an audit nobody reads,
   *  and `recordsVisited` is where "we looked at all of them" is reported. */
  readonly audit: readonly WrapAudit[];
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Quiesce → walk records → `planWraps` each → batch-write → report. **NO CONTENT IS READ.**
 *
 * One job expresses rotate, grant, revoke, transfer and erase, because `desired` does. There is no
 * verb per transition here for the same reason there is none on `planWraps`: five transitions
 * behind five functions is five code paths, and the one that gets the conflict policy wrong is the
 * one that drops a revocation.
 *
 * **Two writers, one per conflict policy, and that is deliberate.** `conflictPolicyFor` is a
 * property of each patch, so a walk can legitimately produce both — a pure rewrap beside a
 * revocation. One writer would have to pick, and picking `'skip'` for the batch containing the
 * revocation is precisely the silent drop `conflictPolicyFor` exists to prevent.
 */
export async function runWrapJob<RT extends string>(
  args: WrapJobArgs<RT>,
): Promise<WrapJobResult> {
  if (args === null || typeof args !== 'object') {
    invalid('runWrapJob needs its arguments object');
  }
  const { scope, accountId, forEachRecord, sink, desired, wrap } = args;
  if (typeof accountId !== 'string' || accountId.length === 0) {
    invalid('runWrapJob needs the accountId whose wraps it is reconciling');
  }
  if (typeof forEachRecord !== 'function') {
    invalid('runWrapJob needs a ForEachRecord: the product owns its own traversal');
  }
  if (typeof desired !== 'function' || typeof wrap !== 'function') {
    invalid('runWrapJob needs both `desired` and `wrap`');
  }
  assertSink(sink);
  if (scope === null || typeof scope !== 'object' || typeof scope.granularityOf !== 'function') {
    invalid('runWrapJob needs the product\'s ResolvedScope, so it can assertHead on every head');
  }

  const quiesceMs = args.quiesceMs ?? 0;
  if (!Number.isSafeInteger(quiesceMs) || quiesceMs < 0) {
    invalid(`runWrapJob quiesceMs must be a non-negative safe integer, received ${String(quiesceMs)}`);
  }
  if (quiesceMs > 0) await (args.sleep ?? defaultSleep)(quiesceMs);

  const writers: Partial<Record<ConflictPolicy, BatchWriter>> = {};
  const writerFor = (policy: ConflictPolicy): BatchWriter => {
    const found = writers[policy];
    if (found !== undefined) return found;
    const made = createBatchWriter({ sink, policy });
    writers[policy] = made;
    return made;
  };

  let recordsVisited = 0;
  const recordsToDelete: string[] = [];
  const audit: WrapAudit[] = [];
  let lastCursor: string | undefined;

  await forEachRecord(
    accountId,
    async (head) => {
      // Every head, before anything is planned against it. This is where the walked-children
      // mistake becomes a refusal instead of a second wrap.
      assertHead(scope, head);
      recordsVisited += 1;
      if (typeof head.cursor === 'string') lastCursor = head.cursor;

      const want = desired(head);
      const patch = wrap(head, want);
      if (patch === null || typeof patch !== 'object' || typeof patch.changed !== 'number') {
        throw new ContentCryptoError(
          'VALIDATION_ERROR',
          `runWrapJob's wrap() must return the WrapPatch that planWraps produced, for record ` +
            `'${String(head.record?.path)}'`,
          compact({ scopePath: typeof head.record?.path === 'string' ? head.record.path : undefined }),
        );
      }

      // `deleteRecord` is reported whether or not anything was written: a record whose wrap set
      // was ALREADY empty needs no write and still belongs in the sweep.
      if (patch.deleteRecord) recordsToDelete.push(head.record.path);

      const extra = args.also === undefined ? undefined : args.also(head);
      if (extra !== undefined) assertAlso(extra);

      // Nothing to write only when the patch changed nothing AND the product added nothing.
      if (patch.changed === 0 && extra === undefined) return;
      // One entry per record this job CHANGED — a row written only to carry `also` changed no
      // wrap, and manufacturing a wrap audit entry for it would put a diff of nothing into an
      // audit trail somebody reads for grants and revocations.
      if (patch.changed > 0) audit.push(patch.audit);

      // Materialised HERE and NOWHERE ELSE in this package, which is what makes the untranslated
      // raw write unwritable rather than merely discouraged.
      const update = materialiseWrapPatch(patch, { deleteField: sink.deleteField });
      await writerFor(extra === undefined ? conflictPolicyFor(patch) : 'retry').enqueue({
        ref: head.ref,
        // The product's fields FIRST: the wrap fields are the patch's and win any tie.
        // `assertAlso` has already refused a tie, so this is the second lock on the same door.
        update: extra === undefined ? update : { ...extra, ...update },
        // OMITTED when the head carries none, rather than present and `undefined`. A sink asking
        // `'precondition' in row` — which is how a store adapter decides between its create and
        // its compare-and-set primitive, exactly as `WrapCommitRequest.precondition` is asked —
        // would otherwise be told "yes, and it is undefined", which is the accidental value R18
        // (precondition) exists to keep out of this concept altogether.
        ...(head.precondition === undefined ? {} : { precondition: head.precondition }),
      });
    },
    args.from,
  );

  let recordsWritten = 0;
  let recordsSkipped = 0;
  for (const writer of Object.values(writers)) {
    if (writer === undefined) continue;
    await writer.flush();
    recordsWritten += writer.written;
    recordsSkipped += writer.skipped;
  }

  return Object.freeze({
    recordsVisited,
    recordsWritten,
    recordsSkipped,
    recordsToDelete: Object.freeze(recordsToDelete),
    lastCursor,
    audit: Object.freeze(audit),
  });
}

// ---------------------------------------------------------------------------
// The same job, over one record
// ---------------------------------------------------------------------------

/** `applyWrapPatch` hands `runWrapJob` a patch that is already planned, so `desired` is never
 *  read. Frozen and shared rather than built per call, so it cannot be mutated into meaning
 *  something. */
const EMPTY_DESIRED: DesiredWraps = Object.freeze({});

/**
 * One record, one already-planned `WrapPatch`, one `WriteSink`.
 *
 * The patch carries its own record and its own actor — both off `patch.audit`, which `planWraps`
 * filled in and validated — so there is no second place for either to be stated and disagree.
 */
export interface WrapApplyArgs<RT extends string = string> {
  /** The product's resolved scope, so the head is `assertHead`-checked exactly as a walked one is. */
  readonly scope: ResolvedScope<RT>;
  /** From `session.planWraps(…)`. Its `audit.record` names the record and its `audit.actorAccountId`
   *  names who acted; nothing here restates either. */
  readonly patch: WrapPatch;
  /**
   * The wrap set the patch was planned against — the SAME read that produced `precondition`.
   *
   * Required, and checked against `patch.holdersBefore`. On the walking path a head's wrap set and
   * its precondition come from one visit and cannot disagree; a single-record apply assembles the
   * head from separate arguments, so what the walk gets structurally has to be asserted here. A
   * patch planned against one read and applied against another compare-and-sets a state nobody
   * observed.
   */
  readonly current: KeyWraps;
  readonly ownerAccountId: string;
  readonly sink: WriteSink;
  /** Opaque write target, handed to the sink untouched. */
  readonly ref: unknown;
  /**
   * The read-time token from the SAME read as `current` — **or the word `'unconditional'`.**
   *
   * **Required, and its opt-out is a WORD (R18, precondition).** `current` is required and
   * cross-checked against `patch.holdersBefore`, so half of one read was being asserted while its
   * companion token could simply be left off; and a missing token is not a smaller write, it is a
   * BLIND one — the compare-and-set this patch was planned for becomes last-writer-wins, silently,
   * at the one call where the wraps and the row move together.
   *
   * Required-with-an-explicit-`null` was considered and REJECTED, and this is the reasoning rather
   * than a note about it: **`null` is JavaScript's accidental value.** It arrives from an unset
   * variable, a failed lookup, a JSON round trip, a store client that returns it for "no such
   * row". **A word cannot.** `precondition: 'unconditional'` is a sentence somebody had to mean;
   * `null` is one the program can write by itself. `undefined` is the same accidental value in its
   * purest form and is refused for the same reason — and the field cannot be omitted at all, which
   * is why `assertNoSecrets` rule 3's "omit, don't pass undefined" does not apply here: there is
   * nothing to omit.
   *
   * The type is slightly uglier for it, deliberately. That is the purchase and not the cost: the
   * standard everywhere else in this package is that the wrong thing be **unwritable rather than
   * merely visible**, and this is what that standard costs at this door. **Do not relax it back to
   * optional** because a call site finds it inconvenient — a call site that finds it inconvenient
   * is one that has not yet decided whether it is compare-and-setting, and that decision is the
   * entire point of asking.
   *
   * The word never reaches the sink: `'unconditional'` means the row is written with NO
   * precondition, so the field is omitted from the `WriteRow` rather than set to anything.
   */
  readonly precondition: Precondition;
  /** The product's own fields, in the same row. See `WrapJobArgs.also`: it forces the write and
   *  forces `'retry'`, and the wrap fields are refused. */
  readonly also?: Readonly<Record<string, unknown>>;
}

/**
 * Apply ONE `WrapPatch` to ONE record — the single-record grant, un-share, transfer and erase.
 *
 * **This is `runWrapJob` over a traversal of one record, and that is the design rather than an
 * implementation shortcut.** Beside it — a second function doing its own `assertHead`, its own
 * `materialiseWrapPatch`, its own `conflictPolicyFor`, its own writer — would be a second copy of
 * the logic, and the step a second copy skips is the materialisation: the defect being closed,
 * rebuilt. Underneath, there is exactly ONE call site of `materialiseWrapPatch` in this package,
 * and a wrap write that has not been translated stops being something a caller can express.
 *
 * Everything `runWrapJob` does, this does, because it is the same code: the head is
 * `assertHead`-checked, the policy comes from `conflictPolicyFor`, the precondition is carried into
 * the row, `deleteRecord` is reported, and the sentinel is translated through `sink.deleteField` —
 * the store's own, which is the thing the caller used to be asked to supply.
 *
 * It returns `WrapJobResult` rather than a shape of its own, so there is nothing to drift:
 * `recordsWritten` is 0 or 1, `recordsSkipped` is the lost-precondition-under-`'skip'` count, and
 * `recordsToDelete` carries the erase signal in the vocabulary the product's sweep already reads.
 *
 * `precondition` is REQUIRED and takes the token or the word — see `WrapApplyArgs.precondition`.
 *
 * @example
 * const patch = session.planWraps({}, { actorAccountId });        // the empty set — an erase
 * const result = await applyWrapPatch({
 *   scope, patch, current: scan.keyWraps, ownerAccountId: accountId,
 *   sink, ref: scanRef, precondition: scanSnap.updateTime,  // or 'unconditional', said out loud
 * });
 * if (result.recordsToDelete.length > 0) await deleteScanSubtree(accountId, orgId, scanId);
 */
export async function applyWrapPatch<RT extends string>(
  args: WrapApplyArgs<RT>,
): Promise<WrapJobResult> {
  if (args === null || typeof args !== 'object') {
    invalid('applyWrapPatch needs its arguments object');
  }
  const { scope, patch, current, ownerAccountId, sink, ref, precondition, also } = args;

  // The compiler already refuses all three of these, and the compiler is not who this is for: a
  // plain-JavaScript migration script is exactly the caller the required field exists for, and the
  // failure it would otherwise get is a blind write that reports success. The message says what to
  // TYPE, because "precondition is required" sends somebody looking for a token they may not have.
  if (
    !Object.prototype.hasOwnProperty.call(args, 'precondition') ||
    precondition === undefined ||
    precondition === null
  ) {
    invalid(
      'applyWrapPatch needs `precondition`, and there is no third answer: either the store\'s ' +
        'read-time token from the SAME read as `current`, or the literal word \'unconditional\' to ' +
        'say in writing that this write is not compare-and-set. A missing token is not a smaller ' +
        'write, it is a BLIND one. null and undefined are refused because a program produces them ' +
        'by accident — an unset variable, a failed lookup, a JSON round trip — and a word it ' +
        'cannot: type \'unconditional\' if that is what you mean',
    );
  }

  if (
    patch === null ||
    typeof patch !== 'object' ||
    typeof patch.changed !== 'number' ||
    patch.update === null ||
    typeof patch.update !== 'object' ||
    patch.audit === null ||
    typeof patch.audit !== 'object'
  ) {
    invalid(
      'applyWrapPatch needs the WrapPatch that planWraps produced: the record, the actor and the ' +
        'audit entry all come off it, and a patch assembled by hand carries none of the three',
    );
  }

  const record = patch.audit.record as RecordRef | undefined;
  if (
    record === null ||
    record === undefined ||
    typeof record !== 'object' ||
    typeof record.path !== 'string' ||
    record.path.length === 0
  ) {
    invalid('applyWrapPatch needs a WrapPatch whose audit names the record it was planned for');
  }
  const actorAccountId = patch.audit.actorAccountId;
  if (typeof actorAccountId !== 'string' || actorAccountId.length === 0) {
    invalid(
      'applyWrapPatch needs a WrapPatch whose audit names the actor: it is what the one-record ' +
        'traversal runs as, and an audit that cannot say who acted is not an audit entry',
    );
  }
  if (!Array.isArray(patch.holdersBefore)) {
    invalid('applyWrapPatch needs a WrapPatch carrying its holdersBefore');
  }
  assertSink(sink);

  // What the walk gets for free. PARSED holders on both sides, so an untranslated `{ op: 'delete' }`
  // sitting in `current` counts as a holder for neither — that is not a disagreement, it is the
  // residue the reconcile this very patch came from has already planned away.
  const held = holdersOf(current);
  const planned = patch.holdersBefore.slice().sort();
  if (held.join(' ') !== planned.join(' ')) {
    throw new ContentCryptoError(
      'VALIDATION_ERROR',
      `applyWrapPatch was given a \`current\` holding [${held.join(', ')}], which is not what this ` +
        `patch was planned against [${planned.join(', ')}]. The wrap set and the precondition must ` +
        'come from ONE read, or the compare-and-set is against a state nobody ever observed',
      compact({ scopePath: record.path }),
    );
  }

  const head: RecordHead = Object.freeze({
    record,
    ownerAccountId,
    keyWraps: current,
    ref,
    // The word is a statement to THIS function and never a token: `'unconditional'` means the row
    // carries no precondition, so the field is left off rather than set to `undefined` — the rule
    // its own type states. A sink must never receive the word, or a store would compare-and-set
    // against the string.
    ...(precondition === 'unconditional' ? {} : { precondition }),
  });

  return runWrapJob<RT>({
    scope,
    // `runWrapJob`'s accountId SELECTS a traversal, and this traversal is the one record it was
    // handed — nothing queries on it. The actor off the patch's own audit is the truthful value
    // to put here, and it cannot disagree with the audit entry the product writes beside the call.
    accountId: actorAccountId,
    forEachRecord: async (_accountId, visit): Promise<void> => {
      await visit(head);
    },
    sink,
    // Ignored by `wrap` below: the patch is already planned, which is the whole difference between
    // this entry point and the walking one.
    desired: () => EMPTY_DESIRED,
    wrap: () => patch,
    also: also === undefined ? undefined : () => also,
  });
}
