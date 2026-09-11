/**
 * `content-crypto.ts` — the façade five products call, and the record session.
 *
 * Everything below composes modules that already exist: the registry says WHICH fields, the
 * document layer says HOW to visit them, the record-key layer says who may open them, and the
 * DEK source relays whether an account may have its DEK at all. This module adds no crypto. What
 * it adds is the one place a `RecordKey` is held, and the one place it is destroyed.
 *
 * ── THE INVARIANT THIS MODULE EXISTS TO CARRY ───────────────────────────────────────────────
 *
 * **A record's wrap is durable before the first value is sealed under it.**
 *
 * The failure that rule prevents is not hypothetical and it is not recoverable. A migration that
 * seals five hundred documents and writes the record-key wrap at the end, then times out at
 * document three hundred, has produced three hundred rows of ciphertext under a key that was
 * never persisted and has just been zeroised by `close()`. The rows were readable before the run
 * and are unreadable after it, with no error anywhere. Re-running mints a *second* key and the
 * migration's own "already converted" test skips every dead row, so the damage is invisible and
 * permanent, on real client content.
 *
 * An object nobody can open is a bug we can find. An object whose wrap we never wrote is data we
 * have destroyed.
 *
 * ── HOW IT IS CARRIED, AND WHY IT IS NOT A TYPE (R10a) ──────────────────────────────────────
 *
 * It used to be a typestate: `createRecord` returned a `PendingRecordSession` and the seal methods
 * were reachable only through `wrapCommitted()`. **A typestate enforces call ORDER; the invariant
 * is about DURABILITY**, and the two are not the same thing. A wrap sitting unflushed in a
 * four-hundred-row batch satisfies the type perfectly and loses the data anyway, and enqueue-then-
 * hope is not a corner case — it is what a batching caller reaches for naturally, because the
 * writer it already has resolves on the enqueue.
 *
 * So the package makes the wrap durable ITSELF, through an injected port, **before any object
 * capable of sealing exists**. The window closes because it never opens:
 *
 *   mint → planWraps → `await committer.commitWraps([…])` → validate the receipts →
 *   **`await committer.readWraps([…])` and refuse unless every wrap is in the store** → THEN a
 *   session
 *
 * `WrapCommitter` is required at construction, so a product that has not decided how a wrap becomes
 * durable cannot build a façade and therefore cannot reach `createRecord` at all. The store's
 * acknowledgement comes back as a `WrapReceipt` — a thing only a committed write can produce — so
 * the natural "put it in my batch" has nothing to return and must *invent* a write time, which is a
 * falsification rather than an omission and shows up in review. **And the receipt is no longer
 * asked to carry that weight alone (R11):** the package reads the wraps back through the same port
 * and refuses if they are not there, which is a property of the run rather than of a review.
 *
 * **The wrap must NOT go into the caller's content batch.** The batch writers that exist resolve on
 * the enqueue, swallow a lost precondition row by row, and are bypassed entirely by the object
 * path — so "the same batch as the content" is the shape of the bug at the first consumer, not a
 * permitted alternative. `commitWraps` is plural precisely so a migration pays one round trip per
 * PAGE rather than per record, which is what removes the temptation to route it back through the
 * content batch to save writes.
 *
 * ── WHAT THE READ-BACK CLOSES, AND WHAT IT DOES NOT (R11) ───────────────────────────────────
 *
 * **Closed: the durability lie.** A committer that resolves without a durable write — enqueue-only,
 * built on a swallow-on-conflict batch writer, or writing part of a page and returning a full
 * receipt array — is now refused at runtime, because an honest reader does not find the wrap and
 * no session is built. The receipt could never catch any of those: **the natural lie passes it.**
 * `new Date().toISOString()` sits inside the receipt's ±24 h window and is exactly what an
 * enqueue-only committer would write, so the receipt buys detectability in review — a false value
 * is legible in a diff — and not a runtime property. Read-back is the runtime property, and the
 * read is checked for EVERY request in the page, which is what makes the plural path no wider than
 * the singular one: a partial commit with a full receipt array fails on the request that did not
 * land.
 *
 * ── WHAT REMAINS OPEN — THE LIST, WHICH IS A LIST AND NOT A COUNT ───────────────────────────
 *
 * **Enumerate, don't number.** What follows carries no arithmetic, deliberately. A number in prose
 * is a claim that has to be maintained in sync with a list, this one was wrong TWICE before it was
 * taken out, and a further residue should be able to join by being written down here — not by
 * somebody also finding a word in a docblock and decrementing it. Each entry is NAMED so it can be
 * cited. **Do not reintroduce a count** ("the count is …", "two of these", "both of them").
 *
 * - **The create-only lie.** A committer that OVERWRITES an existing wrap still finds a wrap on
 *   read-back — the one it just wrote — and passes, while the key it displaced leaves every value
 *   sealed under it permanently unreadable. Nothing observable from here separates "created" from
 *   "overwrote". That is `checkWrapCommit`'s assertion (3) in `./testing`, run against the
 *   product's OWN committer in its own repo, and R12 makes it a REQUIRED step of adoption rather
 *   than an optional one.
 *
 * - **The colluding reader.** A `readWraps` that lies in step with its writer — answering from the
 *   batch the committer just enqueued, or from its memo of what it meant to write — passes
 *   read-back exactly as an honest one would. Read-back never claimed to close this: it raises the
 *   price from one accidental falsehood to two deliberate ones, and that is the whole of the
 *   claim. Its own entry, rather than a clause hung on the one above, because it is a different
 *   mistake in different code and a reader skimming for the create-only lie would not see it.
 *
 * - **Content under an un-committed record key.** `mintRecordKey` + `planWraps` + `openRecord`
 *   will seal content under a record key whose wrap was never written, with no lie told and
 *   `commitWraps` never invoked — as will `encryptField`, `encryptBlob`, `sealObject` or
 *   `createObjectEncryptStream` handed a **minted record key** directly. Being the one path that
 *   requires nothing false of the caller, it is the likeliest to be taken by accident, so **R10
 *   removed `mintRecordKey`, `wrapRecordKey`, `unwrapRecordKey` and the free key-taking
 *   `planWraps` from the public barrel**: they stay internal, and `session.planWraps` keeps the
 *   capability without the loose key. No kind check can see this one, because the codecs do not
 *   read the store: the kind is right and only the wrap is missing. Inside the package the path
 *   still exists — `openRecord` cannot tell a wrap the product read from the store from one it
 *   minted a microsecond ago, and that is deliberate: it is what keeps `--apply`-gated backfill
 *   scripts possible (see "what this module may not do", and `durability.test.ts` F4).
 *
 * `durability.test.ts` carries the enqueue-only, swallow-on-conflict and no-op committers as
 * executing counter-examples — now refused with an honest reader, and still destroying content
 * when paired with a lying one.
 *
 * **What LEFT this list, and how.** Content sealed under an ACCOUNT DEK was an entry of its own:
 * a content codec handed a DEK wrote well-formed `enc:v3:` that opened perfectly under the key
 * that wrote it and was unreachable through every route this package offers, because a DEK is
 * never a `keyWraps` entry and `unwrapRecordKey` yields record keys and nothing else. R14 closed
 * it — `assertKind` in `secret.ts`, called by all four doors above, throws `VALIDATION_ERROR`
 * before a byte is sealed. Recorded because an entry leaving is worth knowing about; what it is
 * not is a decrement of anything.
 *
 * The RE-RUN is that last entry's data loss arriving by another door, and the guard against it is a
 * rule rather than a shape: **adopt an existing record key with `openRecord` whenever `keyWraps` is
 * non-empty; `createRecord` is for a record that has none.** A backfill that mints unconditionally
 * on a re-run strands everything the previous run converted. `createRecord` takes an optional
 * `current` so that rule can be a refusal rather than a paragraph, and every migration should pass
 * it.
 *
 * The asymmetry the whole design rests on: **a wrap without content is a row; content without a
 * wrap is a shred.** A wrap that commits and is then abandoned leaves ninety-four characters per
 * holder on one row, the content untouched, and a record the next run MUST adopt. That is why the
 * port may chunk, and why a partial commit followed by a rejection is the safe direction.
 *
 * ── WHAT THIS MODULE MAY NOT DO ─────────────────────────────────────────────────────────────
 *
 * It reads nothing, and it writes nothing ITSELF: the one write it depends on is delegated to the
 * product through `WrapCommitter`, whose ref, precondition token and receipt are all opaque.
 * `openRecord` is handed the wraps the product already read. The package never learns what a store
 * is, which is why `RecordInput.keyWraps` is `unknown` and `parseKeyWraps` runs over it.
 */

import type { Transform } from 'node:stream';

import {
  ContentCryptoError, isContentCryptoError, UNREADABLE_CODES, compact, assertNoKeyMaterial,
} from './errors';
import type { ErrorDetails } from './errors';
import { zeroise } from './secret';
import type { RecordKey } from './secret';
import {
  mintRecordKey, unwrapRecordKey, parseKeyWraps, wrapCount, hasWrap,
  KEY_WRAPS_FIELD, WRAP_HOLDERS_FIELD,
} from './record-key';
import type { RecordRef, KeyWraps, WrapEntry } from './record-key';
import { planWraps as planWrapsWithKey } from './wrap-patch';
import type { WrapPatch, WrapAudit, DesiredWraps, GrantScope } from './wrap-patch';
import { resolveScope, recordRefKey } from './key-scope';
import type { KeyScope, ResolvedScope } from './key-scope';
import type { FieldRegistry } from './registry';
import { createDocCodec } from './doc-codec';
import type { DocCodec, DocPlanner, SealedUpdate, PlannedAt } from './doc-codec';
import type { BlobPatchOp, BlobResealRequest, EncryptedBlob } from './blob-codec';
import type { CachedDekSource, DekHandle } from './custodian';
import { encryptField } from './field-codec';
import type { EncryptedField } from './field-codec';
import { parseFieldPath, mapPathNode } from './field-path';
import {
  sealObject as sealObjectWithKey,
  openObject as openObjectWithKey,
  createObjectEncryptStream as createObjectEncryptStreamWithKey,
  createObjectDecryptStream as createObjectDecryptStreamWithKey,
} from './object-envelope';
import type { ObjectRef, ObjectMetadata, UnverifiedStreamAck } from './object-envelope';
import {
  isLegacyValue, legacyGenerationOf, legacyGenerationsIn, decryptLegacyField,
} from './legacy-readers';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ContentCryptoOptions<C extends string, RT extends string> {
  /** The product's own scope, unresolved. `createContentCrypto` resolves it against the registry,
   *  which is what runs the two cross-table validations at construction rather than on a write. */
  readonly scope: KeyScope<RT>;
  readonly registry: FieldRegistry<C>;
  /**
   * The package's READ PORT, and named for what it is.
   *
   * **It is not called `custodian`, and it must not be renamed back.** `KeyCustodian` is
   * **Accounts' service**, built in Phase B and living in that repo: it decides whether an account
   * may have a DEK at all, and it is where revocation and destruction are DECIDED.
   * `DekSource`/`CachedDekSource` is this package's read port: it asks, caches the answer for a
   * TTL, and relays it. Calling the option a custodian put the conflation the plan corrected in
   * the single most visible place there is — a public options object whose own type already said
   * `CachedDekSource` — so anyone reading it learnt the wrong model on first contact.
   *
   * Only a `CachedDekSource` is accepted: the TTL is the revocation window AND the grace window,
   * so a bare source would silently opt out of both — everything would work and revocations would
   * simply never arrive. `cachingDekSource` is the only producer of one.
   */
  readonly dekSource: CachedDekSource;
  /**
   * **REQUIRED**, for the same reason `onGraceServe` is: a product that has not decided how a wrap
   * becomes durable cannot construct a façade, and therefore cannot reach `createRecord` at all.
   * Omitting it is TS2741 rather than a runtime surprise on the one path where getting it wrong
   * destroys content.
   */
  readonly wrapCommitter: WrapCommitter;
}

// ---------------------------------------------------------------------------
// The wrap-commit port — the whole mechanism of the durability invariant
// ---------------------------------------------------------------------------

/**
 * What the port is asked to make durable, for ONE record.
 *
 * Every store-shaped thing on it is opaque: the ref is a `RecordRef` the product maps to its own
 * reference, and the precondition token is `unknown` and passes straight through.
 */
export interface WrapCommitRequest {
  readonly record: RecordRef;
  readonly ownerAccountId: string;
  readonly keyWraps: KeyWraps;
  readonly wrapHolders: readonly string[];
  /**
   * Nested and ready to write — `{ keyWraps, wrapHolders }`.
   *
   * A create removes nothing, so there is no `{ op: 'delete' }` in it and nothing for
   * `materialiseWrapPatch` to translate. **Nested, not dotted**, and that is deliberate: a
   * `WrapPatch.update` is dotted because it must preserve the sibling wraps it is not touching, a
   * create has no siblings, and a dotted key inside a whole-document write would store a field
   * literally named `keyWraps.acc_1`.
   */
  readonly update: Readonly<Record<string, unknown>>;
  /**
   * Does the wrap-holder row already exist?
   *
   * Resolved by the package as `args.holderExists ?? args.precondition !== undefined`. `false`
   * means the committer must use the store's CREATE primitive, which gives create-only-ness for
   * free; `true` means it must express create-only-ness some other way — with `precondition`, or
   * with a transaction that refuses a row already holding `keyWraps`. One committer per product
   * then serves both shapes without guessing which it is in.
   */
  readonly holderExists: boolean;
  /** The caller's read-time precondition token, opaque, straight through from
   *  `createRecord({ precondition })`. collab holds a project snapshot's update time. */
  readonly precondition?: unknown;
  /** The grant audit, so the product may write it in the same commit as the wrap. */
  readonly audit: WrapAudit;
}

/**
 * The store's own acknowledgement — **a thing only a COMMITTED write can produce.**
 *
 * This is the falsification the design rests on. A committer that merely enqueues into a batch has
 * no write time to report and must invent one; inventing one is visible in review in a way that
 * `return Promise.resolve()` is not.
 */
export interface WrapReceipt {
  /**
   * ISO-8601. A Firestore committer returns `writeResult.writeTime.toDate().toISOString()`.
   * **An enqueue into a batch has none**, which is the point.
   */
  readonly committedAt: string;
  /** Opaque and optional: the precondition token for the row as it now stands, so the content
   *  write that follows can carry one without a re-read. Firestore returns the same write time. */
  readonly precondition?: unknown;
}

/**
 * **THE PORT.** The product owns the writer; this is the one write the package depends on.
 */
export interface WrapCommitter {
  /**
   * Make these wraps durable, and resolve ONLY after the store has acknowledged the commit.
   *
   * - **Committed, not enqueued.** Resolving on an enqueue into a caller-held batch is the exact
   *   shape of the defect this port exists to remove. It must also not enlist in a caller
   *   transaction whose commit is still pending: the seal happens inside that transaction, so its
   *   commit is too late, and a transaction retry would call this twice and mint twice.
   * - **Create-only.** If the record already holds a wrap the write must FAIL rather than
   *   overwrite — a second key leaves everything under the first permanently unreadable.
   * - **A precondition loss must REJECT, never be swallowed.** A batch writer that retries rows
   *   individually and counts a lost precondition as "already done" is right for a content row and
   *   destroys a record here. **Do not build this on your `BatchWriter`.**
   * - **Positional.** One receipt per request, in the same order, the same length.
   * - **All-or-nothing where the store can be, free to chunk where it cannot** — a partial commit
   *   followed by a rejection is the SAFE direction, because it strands wraps and not content.
   */
  commitWraps(requests: readonly WrapCommitRequest[]): Promise<readonly WrapReceipt[]>;

  /**
   * Read these records' wraps back, **as another process would see them** (R11).
   *
   * The package calls this straight after `commitWraps` resolves and refuses to hand out anything
   * capable of sealing unless every wrap it asked for is there. That is what turns the receipt —
   * which buys detectability in review and nothing more, because the natural lie
   * (`new Date().toISOString()`) passes it — into a RUNTIME property: an enqueue-only committer
   * paired with an honest reader fails here, every time, and getting past it takes a SECOND
   * deliberate falsehood rather than the first accidental one.
   *
   * - **Read-your-writes consistent, and UNCACHED.** A fresh client, a strong read, whatever
   *   "another process" means in this store — and never the committer's own pending batch, its
   *   memo of what it just wrote, or a cache in front of the store. A read served from the
   *   writer's own memory would pass exactly the committer this read exists to fail, which is why
   *   this contract sits on the port rather than in a test harness. (Firestore: a plain
   *   `doc.get()` is already strongly consistent; do not answer from the `WriteBatch`.)
   * - **Positional.** One answer per record, in the same order, the same length.
   * - **The `keyWraps` MAP, not the row that carries it** — `snap.get('keyWraps')`, not `snap.data()`.
   *   `undefined`, `null` or `{}` when the record holds none; the package runs `parseKeyWraps`
   *   over whatever comes back, so a shape it does not recognise reads as "no wrap" and refuses.
   * - **A read of a record that does not exist is not an error**; it is `undefined`.
   *
   * A throw here is treated as a refusal, not as a commit failure: the commit already resolved, so
   * the wrap may well be durable and the next run must re-read and ADOPT rather than mint.
   */
  readWraps(records: readonly RecordRef[]): Promise<readonly unknown[]>;

  /**
   * gRPC 9, an `ifGenerationMatch` mismatch — whatever this store calls it. Usually literally the
   * same function `WriteSink` already carries, so no product learns a new concept. It is what turns
   * "somebody minted a key here first" into `KEY_STORE_CONFLICT` rather than an opaque store error.
   */
  isPreconditionFailure(err: unknown): boolean;
}

/**
 * Who is reading.
 *
 * Under federation the answer is "the caller's own account, and either they hold a wrap or they
 * do not", which is what replaces collab's `resolveAccountId(projectId)`: a read now needs the
 * record, its wraps and the reader, and the key it gets is the record's, never the reader's.
 */
export interface OpenAs {
  readonly as: string;
}

/**
 * One record's worth of what a product read from its own store.
 *
 * `keyWraps` came off the wrap HOLDER — at aggregate granularity the aggregate root, and never
 * off the row being decrypted. A child row has no wrap field and no product may give it one.
 */
export interface RecordInput {
  readonly record: RecordRef;
  /** Tolerant by design: `parseKeyWraps` runs over whatever the store returned. */
  readonly keyWraps: unknown;
  /**
   * Optional. Supplied where the product knows it — build's traversal reads it off the document.
   * At the degenerate granularity it is `record.id` and need not be passed.
   */
  readonly ownerAccountId?: string;
}

/**
 * A value holder over an ALREADY-UNWRAPPED record key.
 *
 * Every seal and open on it is SYNCHRONOUS, which is what removes the
 * half-a-document-at-each-generation hazard: a rotation or a document walk can never stall
 * mid-document on a key fetch.
 *
 * Open the session BEFORE a transaction, use it inside, close it AFTER. A session is safe across
 * transaction retries precisely because it does no I/O; calling `close()` inside the callback
 * breaks the second attempt.
 */
export interface RecordSession<C extends string> {
  readonly record: RecordRef;
  /**
   * The owning account where it is known: from `createRecord`'s `owner`, from
   * `RecordInput.ownerAccountId`, or `record.id` at the degenerate granularity. `null` otherwise
   * — a read does not need it, and typing it `string` would have left it `undefined` at runtime.
   */
  readonly ownerAccountId: string | null;
  /** The reader — the account whose DEK unwrapped this record key. Always known. */
  readonly as: string;
  readonly closed: boolean;

  // ── documents ─────────────────────────────────────────────────────────────────────────────

  /** Seal every registered path. A write ALWAYS encrypts. Returns `data` BY REFERENCE when
   *  nothing was registered or nothing was present. */
  encryptDoc<T extends object>(collection: C, aadDocId: string, data: T): T;

  /** Open every registered path, per the strictness table. */
  decryptDoc<T extends object>(collection: C, aadDocId: string, data: T): T;

  /**
   * `decryptDoc` for a batch of rows. `docIdOf` defaults to `.id` and is REQUIRED for any
   * collection whose registry entry carries a `root` override — a `root` override is exactly the
   * signal that the AAD id is not the row id. Throws `VALIDATION_ERROR` naming the collection
   * when it is missing, which generalises collab's hand-written `versionDocId` guard instead of
   * making every product re-learn it.
   *
   * **SURVIVES** from collab's `ContentCrypto.ts`: five live callers, and the guard generalises.
   */
  decryptDocs<T extends { id: string }>(
    collection: C, docs: readonly T[], docIdOf?: (doc: T) => string,
  ): T[];

  // ── updates ───────────────────────────────────────────────────────────────────────────────

  /** Classify AND seal a store-shaped update. `reseals` is non-empty when a dotted key reached
   *  INSIDE a sealed blob; the caller must read-modify-write, in a transaction. */
  planUpdate(
    collection: C, aadDocId: string, update: Readonly<Record<string, unknown>>,
  ): SealedUpdate;

  /** The convenience form. Throws `BLOB_PARTIAL_UPDATE` when a key reached inside a blob, naming
   *  the whole-blob write path, so a caller who has not thought about it cannot ship a lost
   *  update. */
  encryptUpdate(
    collection: C, aadDocId: string, update: Readonly<Record<string, unknown>>,
  ): Record<string, unknown>;

  /** Seal one element for an array union on a registered array path. `fieldPath` is the array's
   *  path with or without `[]`; the AAD is always the registered `[]` form, which is what makes an
   *  append possible at all. */
  encryptArrayValue(
    collection: C, aadDocId: string, fieldPath: string, value: string,
  ): EncryptedField;

  /**
   * The symmetric read, for an element pulled out of an array without its document.
   *
   * **SURVIVES**: collab has a live caller, and dropping it would force callers to hand-build the
   * `[]` AAD — which is the thing `PlannedAt` exists to prevent.
   */
  decryptArrayValue(collection: C, aadDocId: string, fieldPath: string, value: string): string;

  // ── blobs ─────────────────────────────────────────────────────────────────────────────────

  /** Open one sealed blob and assert its shape. The payload is free-form by definition, so the
   *  product asserts exactly as it does today reading the plaintext map. */
  openBlobAt<T>(collection: C, aadDocId: string, fieldPath: string, value: unknown): T;

  /**
   * Open, patch, reseal at the same AAD. ON THE SESSION, not free-standing, because a
   * free-standing form taking the key was the only reason v1 exposed `session.key` — and with
   * that gone, `close()` means what it says.
   *
   * The free-standing `applyBlobPatch(key, req, current)` still exists in `blob-codec.ts` and is
   * still exported, because an `--apply`-gated backfill script legitimately holds a key outside a
   * session. No façade path uses it.
   */
  applyBlobPatch(req: BlobResealRequest, current: unknown): EncryptedBlob;

  /** Build a reseal request for a registered blob path — the registry-blessed way to express an
   *  `unset` or an `append`, neither of which an update key can say. */
  resealRequest(
    collection: C, aadDocId: string, fieldPath: string, patches: readonly BlobPatchOp[],
  ): BlobResealRequest;

  // ── objects ───────────────────────────────────────────────────────────────────────────────

  /** Write body and metadata in ONE save, so no reader ever sees the marker without the tag. */
  sealObject(
    ref: ObjectRef, plaintext: Buffer,
  ): { readonly body: Buffer; readonly metadata: ObjectMetadata };

  openObject(ref: ObjectRef, body: Buffer, custom: ObjectMetadata | undefined): Buffer;

  createObjectEncryptStream(
    ref: ObjectRef,
  ): { readonly stream: Transform; readonly metadata: Promise<ObjectMetadata> };

  /** A GCM decrypt stream emits plaintext BEFORE the tag verifies. `unverifiedChunks: 'accepted'`
   *  is required so the property is acknowledged at the call site. */
  createObjectDecryptStream(
    ref: ObjectRef,
    custom: ObjectMetadata | undefined,
    opts: { readonly unverifiedChunks: UnverifiedStreamAck },
  ): Transform;

  // ── wraps ─────────────────────────────────────────────────────────────────────────────────

  /**
   * The ONE reconcile, bound to this record and this open key.
   *
   * `current` defaults to the wrap set this session was opened from; `actorAccountId` defaults to
   * `session.as`, which is the account whose DEK opened it. Pass the actor explicitly only when it
   * is not the reader — a sysadmin acting on an account's behalf, which Accounts logs.
   */
  planWraps(desired: DesiredWraps, opts?: {
    scope?: GrantScope;
    current?: KeyWraps;
    actorAccountId?: string;
    now?: () => Date;
  }): WrapPatch;

  /** Zeroises the record key, which the session exclusively owns. Any later use throws
   *  `KEY_MATERIAL_DESTROYED`. `withRecord` always closes. Idempotent. */
  close(): void;
}

/**
 * What `createRecord` hands back, once the wrap is durable.
 */
export interface CreatedRecord<C extends string> {
  /** **USABLE.** `createRecord` did not resolve until the store acknowledged the wrap AND an
   *  independent read found it there (R11), so there is no pending half and nothing to assert: the
   *  window this used to be split across is closed. */
  readonly session: RecordSession<C>;
  readonly keyWraps: KeyWraps;
  readonly wrapHolders: readonly string[];
  /**
   * What WAS written — past tense, hence the name.
   *
   * Retained because a product logs it, and because a document-granular `set(…, { merge: true })`
   * may carry it forward as an idempotent no-op. It is no longer a to-do, which is exactly the
   * point: the affordance that used to be load-bearing is now inert, so batching it is harmless.
   * It is nested rather than dotted, for the reason `WrapCommitRequest.update` gives.
   */
  readonly committedUpdate: Readonly<Record<string, unknown>>;
  /**
   * The audit entry for the record's first grant. Present because a create IS a grant — it goes
   * through the one reconcile like every other wrap change — and a product that logs grants should
   * log this one in the same vocabulary rather than inventing a second.
   */
  readonly audit: WrapAudit;
  /** The store's acknowledgement. `receipt.precondition` is the token for the content write that
   *  follows, so it need not be obtained by a re-read. */
  readonly receipt: WrapReceipt;
}

/** What `migrateDoc` produces. `changed === 0` ⟹ the row is not written. */
export interface MigratedDoc {
  /** The document with every converted value in place. Returned BY REFERENCE when nothing
   *  changed, so an idempotent re-run costs one identity comparison and no write. */
  readonly data: unknown;
  /**
   * The same conversion as a minimal store update — dotted keys, whole arrays — for a caller that
   * would rather not write back the fields it did not touch. `{}` exactly when `changed` is 0.
   */
  readonly update: Readonly<Record<string, unknown>>;
  readonly changed: number;
}

export interface ContentCrypto<C extends string, RT extends string> {
  readonly scope: ResolvedScope<RT>;
  readonly registry: FieldRegistry<C>;
  /**
   * The same `CachedDekSource` the product constructed this with. Exposed because every
   * `planWraps` needs `DekHandle`s for the desired holders, and the alternative is every product
   * keeping a parallel module-level reference, which is how two sources get wired.
   *
   * Named `dekSource` for the reason `ContentCryptoOptions.dekSource` gives: the custodian is
   * Accounts' service, this is the port that reads from it, and the two are not interchangeable
   * words.
   */
  readonly dekSource: CachedDekSource;

  /**
   * Mint a record key, wrap it for the owner, **make that wrap durable**, and only then hand back
   * a session that can seal.
   *
   * The write goes through `wrapCommitter`, which resolves only on a committed write, and the
   * package then READS THE WRAP BACK through the same port and refuses unless the store holds it
   * (R11) — so by the time this promise resolves the invariant at the top of this file already
   * holds, and there is nothing left for the caller to remember. On a rejection the minted key is
   * zeroised and no session is returned: nothing was sealed, so nothing is lost.
   *
   * `current` is optional and every migration or backfill should pass it: a record that already
   * has wraps must be ADOPTED with `openRecord`, never minted a second key. Supplying a non-empty
   * set here is refused rather than obeyed.
   */
  createRecord(args: {
    record: RecordRef;
    owner: string;
    scope?: GrantScope;
    current?: unknown;
    /** The caller's read-time precondition token, opaque, passed through to the committer. */
    precondition?: unknown;
    /** Overrides the package's inference (`precondition !== undefined`). See
     *  `WrapCommitRequest.holderExists`. */
    holderExists?: boolean;
    now?: () => Date;
    /** Per-call override, for a call site holding its own write context. */
    wrapCommitter?: WrapCommitter;
  }): Promise<CreatedRecord<C>>;

  /**
   * N records, ONE call to the port, one commit.
   *
   * The extra round trip is therefore paid per PAGE and not per record, which is what keeps a
   * migration's batching discipline intact instead of tempting it to route the wrap back through
   * the content batch to save writes.
   *
   * **All-or-nothing from the caller's side**: on any rejection, or any malformed receipt, EVERY
   * minted key is zeroised and no session is returned. The port itself may chunk — a partial commit
   * strands wraps, which is the harmless direction.
   */
  createRecords(
    args: readonly {
      record: RecordRef;
      owner: string;
      scope?: GrantScope;
      current?: unknown;
      precondition?: unknown;
      holderExists?: boolean;
    }[],
    opts?: { now?: () => Date; wrapCommitter?: WrapCommitter },
  ): Promise<readonly CreatedRecord<C>[]>;

  /**
   * create → run → close, closing on the throw path too. The twin of `withRecord`, and the reason
   * it is new: `createRecord` now hands back a LIVE session, so one left unclosed on a throw path
   * is a live record key nobody holds — the leak the old pending handle's `close()` covered
   * structurally.
   */
  withNewRecord<T>(
    args: Parameters<ContentCrypto<C, RT>['createRecord']>[0],
    fn: (session: RecordSession<C>, created: CreatedRecord<C>) => Promise<T>,
  ): Promise<T>;

  /** Unwrap this record's key with `as`'s DEK. Throws `NO_WRAP_FOR_ACCOUNT` when `as` holds
   *  none. */
  openRecord(input: RecordInput, opts: OpenAs): Promise<RecordSession<C>>;

  /**
   * `null` instead of a throw for exactly `UNREADABLE_CODES` — `ACCOUNT_KEY_REVOKED`,
   * `ACCOUNT_KEY_DESTROYED`, `NO_WRAP_FOR_ACCOUNT`. NEVER for `RECORD_KEY_UNWRAP_FAILED` or
   * `CONTENT_DECRYPT_FAILED`, which mean something is broken rather than withheld.
   *
   * "I hold no wrap" is ORDINARY under federation, so this is the list path. There is deliberately
   * no `decryptDocSafe`: once the session is open the key is in hand, so the only remaining
   * failure is a decrypt failure, which must never be swallowed. **Safety belongs at the key
   * boundary, not the value boundary.**
   */
  openRecordSafe(input: RecordInput, opts: OpenAs): Promise<RecordSession<C> | null>;

  /**
   * One unwrap per DISTINCT record for a page of rows. Keyed by `recordRefKey` (= `ref.path`).
   * Pass ONE input per distinct wrap holder, with that holder's wraps — at aggregate granularity a
   * hundred rows over three sources is three inputs, not a hundred.
   *
   * It applies `openRecordSafe` semantics per input and NOTHING WIDER: a record failing one of
   * `UNREADABLE_CODES` is ABSENT from the map, never null-valued — "I hold no wrap" is ordinary
   * under federation. Every other error PROPAGATES and fails the whole call,
   * `RECORD_KEY_UNWRAP_FAILED` included: a wrap that exists and will not open is broken, not
   * withheld, and swallowing it turns a corrupted access list into a quietly shorter list page.
   *
   * On that propagation every session it had already opened is closed, because those sessions own
   * live record keys and the caller never received a handle on them.
   */
  openRecords(inputs: readonly RecordInput[], opts: OpenAs): Promise<Map<string, RecordSession<C>>>;

  /** open → run → close, closing on the throw path too. The recommended read shape. */
  withRecord<T>(
    input: RecordInput, opts: OpenAs, fn: (s: RecordSession<C>) => Promise<T>,
  ): Promise<T>;

  /**
   * The v1/v2 → v3 hop, and the ONLY place the two worlds meet. Async because it fetches the
   * legacy generations' DEKs, up front and before any transform, so no document is ever left half
   * at each generation. **DELETED AT PHASE G.**
   */
  migrateDoc(
    session: RecordSession<C>, collection: C, aadDocId: string, data: unknown,
  ): Promise<MigratedDoc>;

  /** The bound doc planner — collab's exact four-argument signature. Registry-driven, pure,
   *  synchronous, key-free. Used by migrations, re-keys and dry runs. */
  readonly planDoc: DocPlanner<C>;

  /** The degenerate-case record ref, from `scope.accountRecordPath`. The dial turned down needs no
   *  declared record type and no fake one. */
  accountRecord(accountId: string): RecordRef;

  /** Drop this account's cached DEKs. Delegates to the cache. */
  evict(accountId: string): void;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function invalid(message: string, details?: ErrorDetails): never {
  throw new ContentCryptoError('VALIDATION_ERROR', message, details);
}

function typeName(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  return `a ${typeof value}`;
}

function assertAccountId(value: unknown, what: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) {
    invalid(`${what} must be a non-empty account id, received ${typeName(value)}`);
  }
}

/**
 * The runtime half of the `CachedDekSource` brand.
 *
 * The brand itself is a phantom symbol, so it is a compile-time guard only — and the caller most
 * likely to defeat it is a plain-JavaScript job wiring a bare source. `stats` and `clear` are the
 * two members a bare `DekSource` does not have, which makes them the check.
 */
function assertCachedSource(value: unknown): asserts value is CachedDekSource {
  const source = value as Partial<CachedDekSource> | null;
  const ok =
    source !== null &&
    typeof source === 'object' &&
    typeof source.getCurrentDek === 'function' &&
    typeof source.getDek === 'function' &&
    typeof source.currentGeneration === 'function' &&
    typeof source.evict === 'function' &&
    typeof source.stats === 'function' &&
    typeof source.clear === 'function';
  if (!ok) {
    invalid(
      'createContentCrypto needs the source `cachingDekSource` returns. The cache TTL is the ' +
        'revocation window and the grace window both, so a bare DekSource here would opt out of ' +
        'each of them silently — everything would work and a revocation would simply never arrive',
    );
  }
}

/**
 * The internal shape of one create. The public signatures inline the same fields — a non-exported
 * type in an exported signature does not survive declaration emit — and TypeScript matches them
 * structurally, so there is one shape and two spellings rather than two shapes.
 */
interface CreateArgs {
  readonly record: RecordRef;
  readonly owner: string;
  readonly scope?: GrantScope;
  readonly current?: unknown;
  readonly precondition?: unknown;
  readonly holderExists?: boolean;
}

/**
 * The runtime half of `WrapCommitter`.
 *
 * A plain-JavaScript job — a migration script, exactly the caller this whole change is about — has
 * no compiler to stop it passing something else, and the failure it would otherwise produce is a
 * `TypeError` three steps after a key was minted rather than a refusal before one was.
 */
function assertCommitter(value: unknown, what: string): asserts value is WrapCommitter {
  const committer = value as Partial<WrapCommitter> | null;
  const ok =
    committer !== null &&
    typeof committer === 'object' &&
    typeof committer.commitWraps === 'function' &&
    typeof committer.readWraps === 'function' &&
    typeof committer.isPreconditionFailure === 'function';
  if (!ok) {
    invalid(
      `${what} needs a WrapCommitter — an object with commitWraps(), readWraps() and ` +
        'isPreconditionFailure(). It is the one write this package depends on: it must resolve ' +
        'only after the store has ACKNOWLEDGED the commit, never on an enqueue into a batch, ' +
        'because a wrap sitting unflushed while content is sealed under its key is content we ' +
        'have destroyed — and readWraps is how that is checked at runtime rather than taken on ' +
        'trust, so it must be an INDEPENDENT, uncached read',
    );
  }
}

/**
 * `isPreconditionFailure` is the product's code and may itself throw. A throw here must not
 * replace the store's error with a classifier's — the caller needs to see what the store said.
 */
function safeIsPreconditionFailure(committer: WrapCommitter, err: unknown): boolean {
  try {
    return committer.isPreconditionFailure(err) === true;
  } catch {
    return false;
  }
}

/**
 * Anything `Date.parse` will take that also LOOKS like an instant. Deliberately wider than
 * `toISOString()`'s own output — an offset form and a non-millisecond fraction are both real
 * answers from a real store, and this check is not the place to be clever about them.
 */
const ISO_INSTANT = /^[+-]?\d{4,6}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

/** ±24 h. Generous on purpose: see `assertReceipts`. */
const RECEIPT_SKEW_MS = 24 * 60 * 60 * 1000;

/**
 * **A STUB-CATCHER, NOT A DURABILITY CHECK.** Say so out loud, because the temptation to read it
 * as one is the whole residue of this design: nothing here can tell a committed write from a
 * convincing lie, and no assertion in this package ever will.
 *
 * What it does catch is the committer that returns something because a `Promise<WrapReceipt[]>`
 * demanded something: the empty string, a zero, a fixed literal, a copy-pasted example. The ±24 h
 * window is wide so that clock skew between the store and this process is never the failure —
 * a real `writeTime` from any store on earth passes, and `new Date(0).toISOString()` does not.
 */
function assertReceipts(
  receipts: unknown,
  requests: readonly WrapCommitRequest[],
  mintedAt: number,
  what: string,
): asserts receipts is readonly WrapReceipt[] {
  // Explicitly typed rather than inferred: TypeScript only treats a call as never-returning when
  // the VARIABLE carries the annotation, and without that every `refuse(...)` below would need a
  // `return` after it (TS18047).
  const refuse: (why: string) => never = (why: string) => {
    throw new ContentCryptoError(
      'KEY_STORE_CONFLICT',
      `${what}: the wrap committer ${why}. A receipt is the store's acknowledgement, and it is ` +
        'the only evidence this package can ask for that the wrap is DURABLE — so a committer ' +
        'that cannot produce one has not committed, and nothing may be sealed under this key',
      compact({ scopePath: requests[0]?.record.path }),
    );
  };

  if (!Array.isArray(receipts)) {
    refuse(`returned ${typeName(receipts)} where an array of receipts belongs`);
  }
  const list = receipts as readonly unknown[];
  if (list.length !== requests.length) {
    // Positional, so a short array is not "some succeeded": it is a committer whose receipts
    // cannot be matched to the records they are meant to acknowledge.
    refuse(`returned ${list.length} receipt(s) for ${requests.length} request(s)`);
  }

  for (let i = 0; i < list.length; i += 1) {
    const receipt = list[i] as Partial<WrapReceipt> | null;
    const at = `receipt ${i} (record '${requests[i].record.path}')`;
    if (receipt === null || typeof receipt !== 'object' || Array.isArray(receipt)) {
      refuse(`returned ${typeName(receipt)} as ${at}`);
    }
    const committedAt = receipt.committedAt;
    if (typeof committedAt !== 'string' || !ISO_INSTANT.test(committedAt)) {
      refuse(`gave ${at} a committedAt that is not an ISO-8601 instant`);
    }
    const parsed = Date.parse(committedAt as string);
    if (Number.isNaN(parsed)) {
      refuse(`gave ${at} a committedAt that names no representable instant`);
    }
    if (Math.abs(parsed - mintedAt) > RECEIPT_SKEW_MS) {
      refuse(
        `gave ${at} a committedAt more than 24 hours from this write ('${committedAt}'), which is ` +
          'a fixed or invented value rather than a store\'s own write time',
      );
    }
    // The receipt reaches the audit trail like any other structured payload, so it is asserted
    // like one. A store that echoed the row back would otherwise put wrapped key material into a
    // log by way of a field nobody thought of as carrying any.
    assertNoKeyMaterial(receipt, `${what} ${at}`);
  }
}

/**
 * **THE READ-BACK (R11), and exactly what it is worth.**
 *
 * After `commitWraps` resolves the package reads the wraps back through the port and refuses to
 * build anything capable of sealing unless every wrap it asked for is in the store. It is the one
 * durability check here that is a RUNTIME property rather than a review aid.
 *
 * **What it closes:** the durability LIE — the committer that resolves without a durable write and
 * reports a plausible receipt. An enqueue-only committer, a committer built on a swallow-on-
 * conflict batch writer, and a committer that writes some of a page and returns a full receipt
 * array are all caught here, because an honest reader sees nothing (or sees only what landed) and
 * the refusal happens before a session exists. The receipt could not catch any of them: the
 * natural invention, `new Date().toISOString()`, sits inside its ±24 h window.
 *
 * **What it does NOT close, stated in terms:** the CREATE-ONLY lie. A committer that OVERWRITES an
 * existing wrap still finds a wrap on read-back — ours, the one it just wrote — and passes every
 * check below, while the key it displaced leaves every value sealed under it permanently
 * unreadable. Nothing readable from here distinguishes "created" from "overwrote", because both
 * end with our wrap in the store. That is `checkWrapCommit`'s assertion (3), it runs against the
 * product's OWN committer in the product's own repo, and it is REQUIRED rather than advisory
 * (R12). Nor does read-back close a reader that lies in step with its writer: it raises the price
 * from one accidental falsehood to two deliberate ones, which is the whole of the claim.
 *
 * The mismatch clause catches the OTHER direction of a race — the store already holding a
 * different key than the one we asked it to write — which is a conflict in the ordinary sense and
 * is reported as one.
 *
 * `KEY_STORE_CONFLICT` (409), deliberately, and for three reasons: it is the code `assertReceipts`
 * already refuses with at the same point on the same path, so a caller's handler needs no second
 * branch for "the wrap is not, so far as we can establish, durable"; the action it implies —
 * re-read the record's wraps and ADOPT — is the correct one in every case here, including the
 * mismatch, where somebody else's key genuinely won; and `VALIDATION_ERROR` (400) would send a
 * debugger to inspect the arguments of the call, when the thing to inspect is the committer. A new
 * code was considered and rejected: R5 extends the taxonomy for a failure mode it has no category
 * for, and "the store does not hold the wrap this write required" is what `KEY_STORE_CONFLICT`
 * already names on the create path.
 */
function assertWrapsDurable(
  seen: unknown,
  requests: readonly WrapCommitRequest[],
  what: string,
): void {
  const refuse: (why: string, scopePath?: string) => never = (why, scopePath) => {
    throw new ContentCryptoError(
      'KEY_STORE_CONFLICT',
      `${what}: ${why}. The wrap must be COMMITTED, not merely enqueued — content is sealed under ` +
        'this key the moment the create resolves, and a wrap sitting unflushed in a batch, or ' +
        'waiting on a caller transaction that has not committed, is content we have destroyed. ' +
        'Nothing was sealed and the minted key has been destroyed; if the wrap did land, re-read ' +
        'it and ADOPT the record with openRecord rather than minting a second key',
      compact({ scopePath: scopePath ?? requests[0]?.record.path }),
    );
  };

  if (!Array.isArray(seen)) {
    refuse(`the committer's readWraps returned ${typeName(seen)} where an array of wrap sets belongs`);
  }
  const list = seen as readonly unknown[];
  if (list.length !== requests.length) {
    // Positional, exactly as the receipts are: a short array cannot be matched to the records it
    // is meant to be evidence about, and a page is where a partial commit hides (A7).
    refuse(`the committer's readWraps returned ${list.length} answer(s) for ${requests.length} record(s)`);
  }

  // EVERY request in the page, never a sample. A partial commit with a full receipt array is the
  // attack this loop exists for, and it strands a whole page rather than one record.
  for (let i = 0; i < list.length; i += 1) {
    const request = requests[i];
    const stored = parseKeyWraps(list[i]);
    for (const holder of request.wrapHolders) {
      if (!hasWrap(stored, holder)) {
        refuse(
          `commitWraps RESOLVED and an independent read of '${request.record.path}' still sees no ` +
            'wrap for the owner',
          request.record.path,
        );
      }
      // Never the wrap STRING in a message: it is wrapped key material and this text reaches a log.
      // `gen` chooses the DEK and is bound into the wrap AAD (`record-key.ts`), so a wrap
      // persisted under a DIFFERENT generation is not the wrap this create committed: it
      // passes a string comparison and then fails `RECORD_KEY_UNWRAP_FAILED` on reopen,
      // which is exactly the failure class the read-back exists to catch.
      if (
        stored[holder].wrapped !== request.keyWraps[holder]?.wrapped ||
        stored[holder].gen !== request.keyWraps[holder]?.gen
      ) {
        refuse(
          `an independent read of '${request.record.path}' holds a DIFFERENT wrap than the one this ` +
            'create committed, which means another key won the record',
          request.record.path,
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// The session
// ---------------------------------------------------------------------------

/**
 * The record key a session holds, reachable only from inside this module.
 *
 * `migrateDoc` reads v1/v2 with an account DEK and writes v3 with the record key, so it is the one
 * caller that needs a session's key from outside the session's own methods. A `WeakMap` keyed by
 * the session is how it gets it without `RecordSession` growing a `key` member — which is exactly
 * the member whose absence makes `close()` mean what it says, and the member v1 had.
 */
const KEY_OF = new WeakMap<object, RecordKey>();

interface SessionDeps<C extends string, RT extends string> {
  readonly scope: ResolvedScope<RT>;
  readonly codec: DocCodec<C>;
}

function makeSession<C extends string, RT extends string>(
  deps: SessionDeps<C, RT>,
  args: {
    readonly record: RecordRef;
    readonly ownerAccountId: string | null;
    readonly as: string;
    readonly recordKey: RecordKey;
    readonly openedFrom: KeyWraps;
  },
): RecordSession<C> {
  const { scope, codec } = deps;
  const { record, ownerAccountId, as, recordKey, openedFrom } = args;
  let closed = false;

  /**
   * Every method's first line.
   *
   * `zeroise` already makes the handle unusable and the cipher already refuses a destroyed one, so
   * this is not the safety mechanism — it is the error message. A caller who used a closed session
   * should be told that, at the call they made, rather than being handed a refusal from three
   * layers down naming a key handle they never saw.
   */
  const open = (method: string): void => {
    if (closed) {
      throw new ContentCryptoError(
        'KEY_MATERIAL_DESTROYED',
        `session.${method} was called after close(). A session exclusively owns its record key ` +
          'and close() zeroises it; open a new session rather than deferring the close, and note ' +
          'that a close() inside a transaction callback breaks the retry',
        compact({ scopePath: record.path, accountId: as }),
      );
    }
  };

  const session: RecordSession<C> = {
    record,
    ownerAccountId,
    as,
    get closed(): boolean {
      return closed;
    },

    encryptDoc<T extends object>(collection: C, aadDocId: string, data: T): T {
      open('encryptDoc');
      return codec.encryptDoc(recordKey, collection, aadDocId, data);
    },

    decryptDoc<T extends object>(collection: C, aadDocId: string, data: T): T {
      open('decryptDoc');
      return codec.decryptDoc(recordKey, collection, aadDocId, data);
    },

    decryptDocs<T extends { id: string }>(
      collection: C, docs: readonly T[], docIdOf?: (doc: T) => string,
    ): T[] {
      open('decryptDocs');
      return codec.decryptDocs(recordKey, collection, docs, docIdOf);
    },

    planUpdate(
      collection: C, aadDocId: string, update: Readonly<Record<string, unknown>>,
    ): SealedUpdate {
      open('planUpdate');
      return codec.planUpdate(recordKey, collection, aadDocId, update);
    },

    encryptUpdate(
      collection: C, aadDocId: string, update: Readonly<Record<string, unknown>>,
    ): Record<string, unknown> {
      open('encryptUpdate');
      return codec.encryptUpdate(recordKey, collection, aadDocId, update);
    },

    encryptArrayValue(
      collection: C, aadDocId: string, fieldPath: string, value: string,
    ): EncryptedField {
      open('encryptArrayValue');
      return codec.encryptArrayValue(recordKey, collection, aadDocId, fieldPath, value);
    },

    decryptArrayValue(
      collection: C, aadDocId: string, fieldPath: string, value: string,
    ): string {
      open('decryptArrayValue');
      return codec.decryptArrayValue(recordKey, collection, aadDocId, fieldPath, value);
    },

    openBlobAt<T>(collection: C, aadDocId: string, fieldPath: string, value: unknown): T {
      open('openBlobAt');
      return codec.openBlobAt<T>(recordKey, collection, aadDocId, fieldPath, value);
    },

    applyBlobPatch(req: BlobResealRequest, current: unknown): EncryptedBlob {
      open('applyBlobPatch');
      return codec.applyBlobPatch(recordKey, req, current);
    },

    resealRequest(
      collection: C, aadDocId: string, fieldPath: string, patches: readonly BlobPatchOp[],
    ): BlobResealRequest {
      open('resealRequest');
      return codec.resealRequest(collection, aadDocId, fieldPath, patches);
    },

    sealObject(
      ref: ObjectRef, plaintext: Buffer,
    ): { readonly body: Buffer; readonly metadata: ObjectMetadata } {
      open('sealObject');
      // The two-argument form the four-argument free function exists to support: a session already
      // knows its scopePath, and a caller passing a different one would be labelling an object
      // with a record it is not under.
      return sealObjectWithKey(recordKey, ref, record.path, plaintext);
    },

    openObject(ref: ObjectRef, body: Buffer, custom: ObjectMetadata | undefined): Buffer {
      open('openObject');
      return openObjectWithKey(recordKey, ref, body, custom);
    },

    createObjectEncryptStream(
      ref: ObjectRef,
    ): { readonly stream: Transform; readonly metadata: Promise<ObjectMetadata> } {
      open('createObjectEncryptStream');
      return createObjectEncryptStreamWithKey(recordKey, ref, record.path);
    },

    createObjectDecryptStream(
      ref: ObjectRef,
      custom: ObjectMetadata | undefined,
      opts: { readonly unverifiedChunks: UnverifiedStreamAck },
    ): Transform {
      open('createObjectDecryptStream');
      return createObjectDecryptStreamWithKey(recordKey, ref, custom, opts);
    },

    planWraps(desired, opts): WrapPatch {
      open('planWraps');
      return planWrapsWithKey({
        current: opts?.current ?? openedFrom,
        desired,
        recordKey,
        productId: scope.productId,
        record,
        granularity: scope.granularityOf(record.type as RT),
        // The session knows who is acting: `as` is the account whose DEK opened this key. The free
        // function has no such context and requires it, which is the whole difference between the
        // two — and an audit that cannot say who acted is not an audit.
        actorAccountId: opts?.actorAccountId ?? as,
        scope: opts?.scope,
        now: opts?.now,
      });
    },

    close(): void {
      if (closed) return;
      closed = true;
      KEY_OF.delete(session);
      zeroise(recordKey);
    },
  };

  KEY_OF.set(session, recordKey);
  return session;
}

// ---------------------------------------------------------------------------
// The façade
// ---------------------------------------------------------------------------

export function createContentCrypto<C extends string, RT extends string>(
  opts: ContentCryptoOptions<C, RT>,
): ContentCrypto<C, RT> {
  if (opts === null || typeof opts !== 'object') {
    invalid(`createContentCrypto needs its options object, received ${typeName(opts)}`);
  }
  const { registry, dekSource, wrapCommitter } = opts;
  assertCachedSource(dekSource);
  // Checked HERE, at construction, for the same reason the scope's cross-table validations are:
  // in the product's own unit tests and at deploy, before any data exists — rather than on the one
  // path where getting it wrong destroys content.
  assertCommitter(wrapCommitter, 'createContentCrypto');

  // `resolveScope` runs the cross-table validations — every record type declared at document
  // granularity is a registry collection, and the derived ceilings fit the document budget. They
  // run HERE, at construction, in the product's own unit tests and at deploy, before any data
  // exists, which is strictly stronger than the same check on a write path.
  const scope = resolveScope(opts.scope, registry as FieldRegistry<string>);
  const codec = createDocCodec(registry, scope);
  const deps: SessionDeps<C, RT> = { scope, codec };

  const readerOf = (as: OpenAs | undefined): string => {
    if (as === null || typeof as !== 'object') {
      invalid(`this call needs { as: accountId }, received ${typeName(as)}`);
    }
    assertAccountId(as.as, 'OpenAs.as');
    return as.as;
  };

  const ownerOf = (input: RecordInput): string | null => {
    if (typeof input.ownerAccountId === 'string' && input.ownerAccountId.length > 0) {
      return input.ownerAccountId;
    }
    // At the degenerate granularity the record IS the account, so the owner is on the ref. This is
    // the one place the façade needs to know, and it asks the predicate rather than comparing a
    // granularity — which is decided in one file and switched on in one other.
    return scope.isAccountGranular(input.record) ? input.record.id : null;
  };

  const openOne = async (input: RecordInput, as: string): Promise<RecordSession<C>> => {
    if (input === null || typeof input !== 'object') {
      invalid(`a RecordInput is required, received ${typeName(input)}`);
    }
    const owner = ownerOf(input);
    scope.assertRecord(input.record, owner ?? undefined);

    const wraps = parseKeyWraps(input.keyWraps);
    const entry: WrapEntry | undefined = Object.prototype.hasOwnProperty.call(wraps, as)
      ? wraps[as]
      : undefined;
    if (entry === undefined) {
      throw new ContentCryptoError(
        'NO_WRAP_FOR_ACCOUNT',
        `account '${as}' holds no wrap on record '${input.record.path}'. Under federation that is ` +
          'ordinary rather than exceptional — it is what a list page skips over — so use ' +
          'openRecordSafe wherever a missing wrap is an expected answer',
        compact({ accountId: as, scopePath: input.record.path }),
      );
    }

    // The revocation and destruction boundary — the custodian's answer, reaching us through the
    // DEK source — is asked BEFORE the unwrap: a revoked account must not learn whether its wrap
    // would have opened.
    const dek = await dekSource.getDek(as, entry.gen);
    const recordKey = unwrapRecordKey({
      productId: scope.productId,
      dek,
      accountId: as,
      record: input.record,
      wrap: entry,
    });

    return makeSession(deps, {
      record: input.record,
      ownerAccountId: owner,
      as,
      recordKey,
      openedFrom: wraps,
    });
  };

  /**
   * Mint, plan, **commit**, verify, and only then build sessions. The one path where a key exists
   * before its wrap does, and therefore the only place in the package where the ordering matters.
   *
   * Written once and used by both `createRecord` and `createRecords`, because the singular form
   * being a special case of the plural is what keeps "one round trip per page" and "one round trip
   * per record" from drifting into two different orderings.
   */
  const mintAndCommit = async (
    args: readonly CreateArgs[],
    opts: { readonly now?: () => Date; readonly wrapCommitter?: WrapCommitter; readonly what: string },
  ): Promise<readonly CreatedRecord<C>[]> => {
    const committer = opts.wrapCommitter ?? wrapCommitter;
    if (opts.wrapCommitter !== undefined) assertCommitter(opts.wrapCommitter, opts.what);

    // 1–5, for every record, BEFORE anything is committed. A refusal here has minted keys to
    // destroy and nothing written, which is the cheap direction to fail in.
    const planned: {
      readonly args: CreateArgs;
      readonly recordKey: RecordKey;
      readonly patch: WrapPatch;
    }[] = [];
    // Separate from `planned`, because a key is minted BEFORE its patch exists and a throw in
    // between must still find it. This list is what `zeroiseAll` walks.
    const minted: RecordKey[] = [];
    const zeroiseAll = (): void => {
      for (const key of minted) zeroise(key);
    };

    try {
      const seen = new Set<string>();
      for (const one of args) {
        if (one === null || typeof one !== 'object') {
          invalid(`${opts.what} was given ${typeName(one)} where create arguments belong`);
        }
        const { record, owner } = one;
        assertAccountId(owner, `${opts.what} owner`);
        scope.assertRecord(record, owner);

        // Two entries for one record would mint two keys, and whichever wrap lands second leaves
        // everything sealed under the first permanently unreadable. That is the same failure the
        // re-run guard below prevents, arriving inside a single call.
        const key = recordRefKey(record);
        if (seen.has(key)) {
          invalid(
            `${opts.what} was given record '${record.path}' twice. Two creates are two keys, and ` +
              'the second wrap would leave everything sealed under the first unreadable',
            compact({ scopePath: record.path }),
          );
        }
        seen.add(key);

        // The re-run guard, and the reason it is a parameter rather than a paragraph: minting a
        // second key on a re-run strands everything the previous run converted, which is the same
        // data loss as the ordering bug arriving by the other door.
        if (one.current !== undefined) {
          const existing = wrapCount(parseKeyWraps(one.current));
          if (existing > 0) {
            invalid(
              `record '${record.path}' already holds ${existing} wrap(s), so it already has a ` +
                'key: adopt it with openRecord. createRecord MINTS, and a second key would leave ' +
                'every value sealed under the first one permanently unreadable',
              compact({ scopePath: record.path }),
            );
          }
        }

        const dek: DekHandle = await dekSource.getCurrentDek(owner);
        const recordKey = mintRecordKey(record);
        minted.push(recordKey);

        // A create IS the first grant, so it goes through the one reconcile rather than around it:
        // grant, revoke, transfer, rotate, erase and create are one call over a desired set.
        // `this-record` is the narrowest scope there is and is the right default for the owner's
        // own wrap; a product wanting a broader one passes it.
        const patch = planWrapsWithKey({
          current: {},
          desired: { [owner]: dek },
          recordKey,
          productId: scope.productId,
          record,
          granularity: scope.granularityOf(record.type as RT),
          actorAccountId: owner,
          scope: one.scope ?? 'this-record',
          now: opts.now,
        });
        planned.push({ args: one, recordKey, patch });
      }
    } catch (err) {
      // Nothing was written and nothing can be: destroy every key rather than leaving one live in
      // a process that now has no handle on it.
      zeroiseAll();
      throw err;
    }

    if (planned.length === 0) return Object.freeze([]);

    // FROZEN AS AN ARRAY, not merely element-wise. The committer is handed this and we then
    // re-index it positionally for the read-back and for `committedUpdate`. A committer that
    // reorders it in place — sorting a page before writing it, which says nothing false and
    // is a natural thing to do — would otherwise hand every session another record's
    // `committedUpdate`, and both records become permanently unreadable while the read-back
    // passes self-consistently. `readonly T[]` stops that in TypeScript; a plain-JS
    // committer, which `assertCommitter` exists for, is not stopped by a type.
    const requests: readonly WrapCommitRequest[] = Object.freeze(planned.map(({ args: one, patch }) =>
      Object.freeze({
        record: one.record,
        ownerAccountId: one.owner,
        keyWraps: patch.wraps,
        wrapHolders: patch.holdersAfter,
        update: Object.freeze({
          [KEY_WRAPS_FIELD]: patch.wraps,
          [WRAP_HOLDERS_FIELD]: patch.holdersAfter,
        }),
        // A caller holding a read-time token is a caller whose row already exists; a caller with
        // none is creating the holder. The product may say so explicitly, and one that does is
        // taken at its word.
        holderExists: one.holderExists ?? one.precondition !== undefined,
        // Present only when the caller supplied one, so `'precondition' in request` is a question
        // a committer may ask.
        ...(one.precondition === undefined ? {} : { precondition: one.precondition }),
        audit: patch.audit,
      }),
    ));
    // Our own copy. Every positional re-read below indexes THIS, never the array the committer
    // was handed, so in-place mutation of that array cannot reach the read-back or the sessions.
    const ours: readonly WrapCommitRequest[] = requests.slice();

    // ── THE COMMIT. Nothing above this line can seal, and nothing below it can be un-sealed. ──
    const mintedAt = Date.now();
    let receipts: readonly WrapReceipt[];
    try {
      // OUR OWN COPY. The committer keeps a reference to the array it returned, and we
      // re-index it at the assembly below — after two awaits. A committer that tidies its
      // own bookkeeping in between (`mine.reverse()`, nothing false said) would otherwise
      // hand every session another record's `WrapReceipt`, and a receipt carries the
      // precondition token for the content write that follows.
      receipts = (await committer.commitWraps(requests)).slice();
    } catch (err) {
      zeroiseAll();
      // A lost precondition means somebody minted a key on this record first — a 409 the caller can
      // act on (re-read and ADOPT), not an opaque store error they have to classify themselves.
      if (safeIsPreconditionFailure(committer, err)) {
        throw new ContentCryptoError(
          'KEY_STORE_CONFLICT',
          `the wrap write for '${requests[0].record.path}' lost its precondition, which means the ` +
            'record already holds a key: re-read its wraps and ADOPT it with openRecord. Nothing ' +
            'was sealed and the minted key has been destroyed',
          compact({ scopePath: requests[0].record.path }),
        );
      }
      throw err;
    }

    try {
      assertReceipts(receipts, requests, mintedAt, opts.what);
    } catch (err) {
      zeroiseAll();
      throw err;
    }

    // ── THE READ-BACK (R11). The receipt is what the committer SAYS; this is what the store HOLDS.
    //    It runs before any sealing-capable object exists, so the refusal shape is the one
    //    `assertReceipts` already uses and the window still never opens.
    let seen: readonly unknown[];
    try {
      seen = await committer.readWraps(ours.map((request) => request.record));
    } catch {
      zeroiseAll();
      // The commit ALREADY RESOLVED, so this is not a commit failure and must not be reported as
      // one: the wrap may well be durable. The store's own error is classified rather than carried
      // (§11.3 — no `cause`, ever), and the message names the only safe next move.
      throw new ContentCryptoError(
        'KEY_STORE_CONFLICT',
        `${opts.what}: the wrap commit resolved but the read-back of '${requests[0].record.path}' ` +
          'failed, so this package cannot establish that the wrap is durable and will not seal ' +
          'under a key it cannot prove is recoverable. Nothing was sealed and the minted key has ' +
          'been destroyed. The wrap MAY have landed: re-read the record and ADOPT it with ' +
          'openRecord rather than minting a second key',
        compact({ scopePath: requests[0].record.path }),
      );
    }

    try {
      assertWrapsDurable(seen, ours, opts.what);
    } catch (err) {
      zeroiseAll();
      throw err;
    }

    // 8. ONLY NOW does an object capable of sealing exist.
    return Object.freeze(
      planned.map(({ args: one, recordKey, patch }, i) =>
        Object.freeze({
          session: makeSession(deps, {
            record: one.record,
            ownerAccountId: one.owner,
            as: one.owner,
            recordKey,
            openedFrom: patch.wraps,
          }),
          keyWraps: patch.wraps,
          wrapHolders: patch.holdersAfter,
          committedUpdate: ours[i].update,
          audit: patch.audit,
          receipt: receipts[i],
        }),
      ),
    );
  };

  const facade: ContentCrypto<C, RT> = {
    scope,
    registry,
    dekSource,
    planDoc: codec.planDoc,

    async createRecord(args): Promise<CreatedRecord<C>> {
      if (args === null || typeof args !== 'object') {
        invalid(`createRecord needs its arguments object, received ${typeName(args)}`);
      }
      const [created] = await mintAndCommit([args], {
        now: args.now,
        wrapCommitter: args.wrapCommitter,
        what: 'createRecord',
      });
      return created;
    },

    async createRecords(args, opts): Promise<readonly CreatedRecord<C>[]> {
      if (!Array.isArray(args)) {
        invalid(`createRecords needs an array of create arguments, received ${typeName(args)}`);
      }
      if (opts !== undefined && (opts === null || typeof opts !== 'object')) {
        invalid(`createRecords options must be an object, received ${typeName(opts)}`);
      }
      return mintAndCommit(args, {
        now: opts?.now,
        wrapCommitter: opts?.wrapCommitter,
        what: 'createRecords',
      });
    },

    async withNewRecord<T>(
      args: Parameters<ContentCrypto<C, RT>['createRecord']>[0],
      fn: (session: RecordSession<C>, created: CreatedRecord<C>) => Promise<T>,
    ): Promise<T> {
      if (typeof fn !== 'function') {
        invalid(`withNewRecord needs a function to run, received ${typeName(fn)}`);
      }
      const created = await facade.createRecord(args);
      try {
        return await fn(created.session, created);
      } finally {
        // The wrap is already durable, so a throw here strands a row and never content — and the
        // key goes with the throw rather than staying live in a process holding no handle on it.
        created.session.close();
      }
    },

    async openRecord(input, as): Promise<RecordSession<C>> {
      return openOne(input, readerOf(as));
    },

    async openRecordSafe(input, as): Promise<RecordSession<C> | null> {
      const reader = readerOf(as);
      try {
        return await openOne(input, reader);
      } catch (err) {
        if (isContentCryptoError(err) && UNREADABLE_CODES.has(err.code)) return null;
        throw err;
      }
    },

    async openRecords(inputs, as): Promise<Map<string, RecordSession<C>>> {
      const reader = readerOf(as);
      if (!Array.isArray(inputs)) {
        invalid(`openRecords needs an array of RecordInputs, received ${typeName(inputs)}`);
      }
      const out = new Map<string, RecordSession<C>>();
      try {
        for (const input of inputs) {
          if (input === null || typeof input !== 'object') {
            invalid(`openRecords was given ${typeName(input)} where a RecordInput belongs`);
          }
          const key = recordRefKey(input.record);
          // ONE unwrap per DISTINCT record. A page of a hundred rows over three aggregate roots is
          // three unwraps, and a caller who did pass a hundred inputs still pays for three.
          if (out.has(key)) continue;
          try {
            out.set(key, await openOne(input, reader));
          } catch (err) {
            // `openRecordSafe` semantics and NOTHING wider. A record whose wrap exists and will
            // not open is broken, not withheld; swallowing that turns a corrupted access list into
            // a quietly shorter list page, which is the failure nobody reports.
            if (isContentCryptoError(err) && UNREADABLE_CODES.has(err.code)) continue;
            throw err;
          }
        }
      } catch (err) {
        // The sessions already opened own live record keys and the caller never got a handle on
        // them, so this is the only place they can be closed.
        for (const session of out.values()) session.close();
        throw err;
      }
      return out;
    },

    async withRecord<T>(
      input: RecordInput, as: OpenAs, fn: (s: RecordSession<C>) => Promise<T>,
    ): Promise<T> {
      if (typeof fn !== 'function') {
        invalid(`withRecord needs a function to run, received ${typeName(fn)}`);
      }
      const session = await facade.openRecord(input, as);
      try {
        return await fn(session);
      } finally {
        session.close();
      }
    },

    async migrateDoc(session, collection, aadDocId, data): Promise<MigratedDoc> {
      const recordKey = KEY_OF.get(session as unknown as object);
      if (recordKey === undefined) {
        if (session !== null && typeof session === 'object' && session.closed === true) {
          throw new ContentCryptoError(
            'KEY_MATERIAL_DESTROYED',
            'migrateDoc was given a closed session; its record key has been zeroised, and a ' +
              'migration that continued past a close would seal under a key nobody holds',
          );
        }
        invalid(
          `migrateDoc needs a RecordSession this façade opened, received ${typeName(session)}`,
        );
      }

      // The legacy content was sealed under the OWNING account's DEK, because before record keys
      // there was no record key and the account that owned the row is the account whose DEK the
      // value is under. A read-only partner therefore cannot run a migration, which is correct
      // rather than an oversight.
      const legacyAccount = session.ownerAccountId ?? session.as;

      // One pass over the registered paths, then every DEK fetched UP FRONT — keys before the
      // transform, always, so no document is ever left half at each generation. A document written
      // across a rotation legitimately names two, which is why this is a set.
      const generations = legacyGenerationsIn(registry, collection, data);
      const deks = new Map<number, DekHandle>();
      for (const generation of [...generations].sort((a, b) => a - b)) {
        // A generation whose wrap has been DRAINED throws here, and throwing is the point:
        // skipping it strands the value permanently the moment the wrap is erased, which is the
        // failure the whole drain protocol exists to prevent.
        deks.set(generation, await dekSource.getDek(legacyAccount, generation));
      }

      const convert = (node: unknown, at: PlannedAt): unknown => {
        // v3 and plaintext are both "return what you were given", which is the planner's only skip
        // mechanism and the reason `changed` stays 0 on a re-run. Encrypting the plaintext here
        // would hide that the migration script never ran.
        if (typeof node !== 'string' || !isLegacyValue(node)) return node;

        if (at.mode !== 'string') {
          // A legacy string at a registered BLOB path is collab's hand-serialised-map case, and
          // this package will not guess whether its plaintext is JSON. Refusing is the only honest
          // answer: guessing wrong writes a payload that opens once and then fails, unopenably.
          throw new ContentCryptoError(
            'WRONG_KEY_LAYER',
            `${collection}/${aadDocId}.${at.fieldPath} is registered as a blob and holds a legacy ` +
              'field ciphertext. Nothing here can know whether its plaintext is a serialised map, ' +
              'and a wrong guess writes a payload that opens once and then fails: convert this ' +
              'path with a product-specific script, not with migrateDoc',
            compact({ collection, docId: aadDocId, fieldPath: at.fieldPath }),
          );
        }

        const generation = legacyGenerationOf(node);
        const dek = generation === null ? undefined : deks.get(generation);
        if (dek === undefined) {
          // `legacyGenerationsIn` walks the same registered paths with the same walker, so a
          // generation reached here was reached there. A miss is the two disagreeing, which is
          // worth a refusal rather than an optional chain that seals nothing and reports success.
          throw new ContentCryptoError(
            'WRONG_KEY_LAYER',
            `${collection}/${aadDocId}.${at.fieldPath} names a legacy generation whose key was ` +
              'not prefetched, which means the value scan and the transform walk disagree about ' +
              'which values are registered',
            compact({ collection, docId: aadDocId, fieldPath: at.fieldPath }),
          );
        }

        // THE SAME AAD ON BOTH SIDES, which is what makes the v1→v3 hop AAD-preserving: `at.aad`
        // is the registry's one builder and the legacy value bound the same string.
        return encryptField(recordKey, at.aad, decryptLegacyField(dek.key, at.aad, node));
      };

      const plan = codec.planDoc(collection, aadDocId, data, convert);

      let next = data;
      for (const key of Object.keys(plan.update)) {
        // An update key is the registered path truncated at its first array segment, so it carries
        // no `[]` and `mapPathNode` writes exactly the node the plan named. Nothing is created: a
        // key is only in the plan because the walk reached a value there.
        const value = plan.update[key];
        next = mapPathNode(next, parseFieldPath(key), () => value);
      }

      return Object.freeze({ data: next, update: plan.update, changed: plan.changed });
    },

    accountRecord(accountId): RecordRef {
      return scope.accountRecord(accountId);
    },

    evict(accountId): void {
      dekSource.evict(accountId);
    },
  };

  return Object.freeze(facade);
}
