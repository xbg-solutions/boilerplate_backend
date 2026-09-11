/**
 * **The DEK cache — which is to say the revocation window and the grace window.**
 *
 * `cachingDekSource(inner, opts)` is the only thing in this package that constructs a
 * `DekSource`, and it is mandatory: `createContentCrypto` accepts a `CachedDekSource` and
 * nothing else. The brand is not ceremony. The TTL *is* the revocation window — plan §6
 * settles that a revoke bites at the next cold load — and the grace window lives in the same
 * decorator. A façade handed a bare `DekSource` would silently opt out of both, and the
 * failure is invisible: everything works, revocations just never arrive.
 *
 * ── THE ONE RULE THIS FILE EXISTS TO KEEP ────────────────────────────────────────────────
 *
 * **A `GraceReason` is a CLOSED union of our own labels. It is never an upstream string.**
 *
 * From Phase C the `DekSource` is an HTTP client for `GET /content-keys/{productId}/
 * {accountId}`, and that route's 200 body **is the plaintext DEK**. Every ordinary HTTP
 * client puts a response body into an error: `Response.json()` on a body a proxy truncated
 * throws a `SyntaxError` quoting the first ten characters of it — sixty bits of a
 * two-hundred-and-fifty-six-bit key — and a 5xx page that echoes the request, a retry
 * wrapper that concatenates attempts, or a library with response-body debug logging are all
 * worse. The platform's own defence does not reach it either: `@xbg.solutions/utils-logger`
 * redacts by field *name*, so a payload arriving under `reason`, `error` or `message` is
 * logged in full.
 *
 * So the classifier below reads an error and **never copies anything out of it**. It reads
 * exactly `name`, `code`, `cause.code`, and for one of our own errors its `code` and
 * `status`. The word this file must never contain outside a comment is the property name for
 * an error's human-readable text — `scripts/check-mirror.js` assertion (11) greps for it over
 * a comment-stripped view of this file, fails CI and names the line. It has been in place
 * since before the first line below was written, which is the only way a rule like this ever
 * holds: it cannot be retrofitted after the leak has shipped.
 *
 * `GraceInfo` is checked with `assertNoKeyMaterial` — the recursive, value-level guard — and
 * NOT with `assertNoSecrets`. The two answer different questions: `assertNoSecrets` polices a
 * closed 18-key error-*details* allowlist, and `GraceInfo` is a structured payload with
 * fields (`ageMs`, `reason`) that are deliberately not detail keys. Running the allowlist
 * check over a payload it was not written for would mean widening the allowlist, which
 * defeats the thing it exists to do.
 *
 * ── GRACE COVERS THE DEK, AND NOT THE GENERATION POINTER ─────────────────────────────────
 *
 * This is the part a reader should not skim, because it is a real operational behaviour and
 * Morph is where it will be noticed.
 *
 * - **Reads** (`getDek(accountId, n)`) take `n` off a stored wrap, so the pointer is not
 *   involved and grace is unconditional. Morph's lake keeps reading through an outage.
 * - **Writes** (`getCurrentDek`) need to know the CURRENT generation. A stale pointer means a
 *   new wrap written at a generation the rotation walk has already passed: the walk reports
 *   the generation drained, `planDrain` erases its wrap, and that holder's access to that
 *   record is gone — silently and permanently.
 *
 * So `getCurrentDek` serves — from a fresh entry or from grace — **only while the pointer
 * entry is still within `pointerTtlMs`**. Past that it throws `KEY_SOURCE_UNAVAILABLE`.
 * During an Accounts outage a product therefore goes **read-only for new records after
 * `pointerTtlMs`**, rather than staying fully writable for the full fifteen minutes:
 *
 *     0 ................ pointerTtlMs   everything normal
 *     pointerTtlMs ..................   NEW WRAPS REFUSED; reads still served
 *     dekTtlMs ......... + graceMs      reads graced, every serve logged at warn
 *     beyond ........................   reads refused
 *
 * Read-only rather than dark is what the settled trade was actually buying. A dial to relax
 * it is deliberately **not** offered: the failure it would permit is invisible and
 * irreversible, and the same outage already blocks anything needing a cold key. (§11.5, and
 * Q-G in §18 — flagged to the owner as a behavioural change the plan did not consider,
 * because when grace was settled the generation still labelled the value rather than the
 * wrap.)
 *
 * ── WHAT IS PORTED RATHER THAN DESIGNED ──────────────────────────────────────────────────
 *
 * collab has run this cache in production; each of these was learned the hard way and is
 * reproduced deliberately: the in-flight dedupe with the identity guard on **both** the
 * populate and the cleanup; an expired entry dropped on read rather than left until the next
 * load; `evict` dropping the pointer, every generation and every in-flight load; and the
 * pointer as a separate, shorter-lived cache, because a stale DEK costs freshness and a
 * stale pointer costs correctness. Added here: the LRU bound, and the grace callback.
 *
 * **Not added, and this overrides an obvious-looking improvement: a cached `AccountDek` is
 * never zeroised.** Not on eviction, not on purge, not on `clear`. The cache hands ONE handle
 * to concurrent callers; a request is mid-decrypt with that buffer, and wiping it corrupts
 * that request. That is a data-loss bug traded for a heap-hygiene gesture V8 does not honour
 * anyway. `zeroise` is for exclusively-owned material — a `RecordKey` at `session.close()` —
 * and this file does not import it.
 */

import type { CacheStats, CachedDekSource, DekHandle, DekSource } from './custodian';
import {
  ContentCryptoError,
  assertNoKeyMaterial,
  compact,
  isContentCryptoError,
} from './errors';
import type { ContentCryptoCode } from './errors';
import { resolveGraceMs } from './key-scope';

// ---------------------------------------------------------------------------
// The closed vocabulary
// ---------------------------------------------------------------------------

/**
 * **CLOSED.** Never an upstream message, never a response body, never a string this package
 * did not write itself.
 *
 * Six labels, each answering "why could the source not be reached", and every one of them
 * safe to log, to count, to alert on and to put on a dashboard. `unknown` is the honest
 * bottom of the set: an unrecognised failure is still graced (an outage that presents in a
 * shape we have not seen is still an outage), it is simply not described.
 */
export type GraceReason =
  | 'network'
  | 'timeout'
  | 'http-5xx'
  | 'http-4xx'
  | 'malformed-response'
  | 'unknown';

/**
 * What `onGraceServe` receives. Every field is a scalar from a closed vocabulary or a number
 * this package computed, and the whole object goes through `assertNoKeyMaterial` before the
 * callback sees it.
 *
 * The optional two are **omitted** when they are not known, never set to `undefined` — a
 * detail bag with an explicit `undefined` is refused elsewhere in this package, and `compact`
 * exists so that omission is the easy path rather than the careful one.
 *
 * The consumer's wiring is then one line, and it is pinned verbatim so that one grep answers
 * *is anything anywhere serving stale keys* across five products:
 *
 *     onGraceServe: (info) => logger.warn('Content key served from an expired cache entry', info)
 */
export interface GraceInfo {
  readonly accountId: string;
  readonly productId: string;
  /** The generation of the entry being served, which is the generation the caller gets. */
  readonly generation: number;
  /** How far PAST expiry the served entry is, in milliseconds. Always greater than zero. */
  readonly ageMs: number;
  readonly reason: GraceReason;
  /** The numeric HTTP status, when the upstream reported one. Omitted otherwise. */
  readonly status?: number;
  /** Present only when the upstream threw one of ours. Omitted otherwise. */
  readonly code?: ContentCryptoCode;
}

/**
 * Grace covers **unavailability**, never **refusal**.
 *
 * An error carrying one of these codes is the custodian saying *no*: this key is revoked,
 * destroyed, absent, held by its cause, or the caller asked something malformed. Serving a
 * cached DEK past one of those would turn the settled bounded delay (TTL, plus fifteen
 * minutes) into an exemption, and plan §6 accepts a bounded delay rather than an exemption.
 *
 * Two things happen on one of these, and the second is the half a re-derivation drops:
 * the error **propagates**, and the account's entries are **purged on the spot** — pointer,
 * every generation, every in-flight load. Propagating without purging leaves the stale rows
 * live, so the very next request is served from cache and the refusal is never seen again
 * until the TTL runs out.
 */
export const GRACE_INELIGIBLE_CODES: ReadonlySet<ContentCryptoCode> = new Set<ContentCryptoCode>([
  'ACCOUNT_KEY_REVOKED',
  'ACCOUNT_KEY_DESTROYED',
  'ACCOUNT_KEY_NOT_FOUND',
  'ACCOUNT_KEY_CAUSE_HOLDS',
  'VALIDATION_ERROR',
]);

// ---------------------------------------------------------------------------
// Options and the settled durations
// ---------------------------------------------------------------------------

export interface CacheOptions {
  /** Bound once, here, and absent from every method signature — which is what makes a call
   *  site identical before and after the Phase-C swap, and what stops anybody passing the
   *  wrong one. */
  readonly productId: string;
  /** Default `DEFAULT_DEK_TTL_MS`. **THIS IS THE REVOCATION WINDOW.** */
  readonly dekTtlMs?: number;
  /** Default `DEFAULT_POINTER_TTL_MS`. A stale DEK costs freshness; a stale POINTER costs
   *  correctness, which is why it is a minute and not ten. */
  readonly pointerTtlMs?: number;
  /** Default `resolveGraceMs()` — `CONTENT_KEY_GRACE_MS`, or fifteen minutes. `0` turns
   *  grace off entirely, which is the behaviour collab shipped before grace existed. */
  readonly graceMs?: number;
  /** **REQUIRED.** "Every grace serve logged at warn" is settled policy, so forgetting it is
   *  a type error rather than a silence nobody notices. It is a callback and not a log line
   *  because this package has no logger dependency and is not acquiring one. */
  readonly onGraceServe: (info: GraceInfo) => void;
  /** Default 512 rows of key material. collab has no bound because collab's tenancy is small;
   *  Morph's lake needs one. */
  readonly maxEntries?: number;
  /** Injectable clock. The whole file is written against it so the suite can prove a
   *  fifteen-minute window without waiting fifteen minutes. */
  readonly now?: () => number;
}

/** Ten minutes, collab's live value. The window inside which a revoke has not yet bitten. */
export const DEFAULT_DEK_TTL_MS = 600_000;

/** One minute. Shorter than the DEK TTL on purpose — see `CacheOptions.pointerTtlMs`. */
export const DEFAULT_POINTER_TTL_MS = 60_000;

/**
 * `DEFAULT_POINTER_TTL_MS * 2` — how long a rotation must wait after publishing generation
 * N+1 before its first write, so that no warm instance is still minting at N. collab's
 * `ROTATION_QUIESCE_MS`. It lives in this file because the pointer TTL does, and a quiesce
 * derived from anything other than the pointer TTL is a number that drifts out of agreement
 * with the thing it is protecting against.
 */
export const DEFAULT_QUIESCE_MS = 120_000;

/** The quiesce for a given pointer TTL. Exported because a rotation runner outside this
 *  package must be able to compute it from the same rule rather than copy the constant. */
export function quiesceMsFor(pointerTtlMs: number = DEFAULT_POINTER_TTL_MS): number {
  assertDuration(pointerTtlMs, 'pointerTtlMs');
  return pointerTtlMs * 2;
}

const DEFAULT_MAX_ENTRIES = 512;

/** U+001F UNIT SEPARATOR. A colon would be ambiguous, because a document id may contain one
 *  and an ambiguous cache key is a cross-account read. */
const UNIT_SEPARATOR = '\u001F';

// ---------------------------------------------------------------------------
// Internal rows
// ---------------------------------------------------------------------------

interface DekRow {
  readonly handle: DekHandle;
  readonly expiresAt: number;
}

interface PointerRow {
  readonly generation: number;
  readonly expiresAt: number;
}

/**
 * `fresh` — inside its TTL, served without asking anybody.
 * `stale` — past its TTL but inside `graceMs`, and therefore a grace CANDIDATE. It is not
 *           deleted on read: spending the whole grace window on the first request after
 *           expiry is exactly the outage behaviour grace was bought to avoid.
 * `absent` — nothing usable. A row past `graceMs` is deleted at the moment it is looked at,
 *           which is the collab behaviour ("an expired entry is deleted on read") in the only
 *           form that survives having a grace window at all.
 */
type Lookup =
  | { readonly state: 'fresh'; readonly handle: DekHandle }
  | { readonly state: 'stale'; readonly handle: DekHandle; readonly ageMs: number }
  | { readonly state: 'absent' };

// ---------------------------------------------------------------------------
// The classifier — reads an error, copies nothing out of it
// ---------------------------------------------------------------------------

type Classification =
  | { readonly kind: 'refusal'; readonly code: ContentCryptoCode }
  | {
      readonly kind: 'unavailable';
      readonly reason: GraceReason;
      readonly status?: number;
      readonly code?: ContentCryptoCode;
    };

/** `cause.code` values that mean the request never got an answer in time. */
const TIMEOUT_CAUSE_CODES: ReadonlySet<string> = new Set([
  'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
]);

/** `cause.code` values that mean the connection itself failed. */
const NETWORK_CAUSE_CODES: ReadonlySet<string> = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EPIPE',
  'EHOSTUNREACH',
  'UND_ERR_SOCKET',
]);

function stringProp(value: unknown, prop: 'name' | 'code'): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const found: unknown = (value as Record<string, unknown>)[prop];
  return typeof found === 'string' ? found : undefined;
}

function causeOf(err: unknown): unknown {
  if (typeof err !== 'object' || err === null) return undefined;
  return (err as { cause?: unknown }).cause;
}

/**
 * The whole leak boundary, in one function.
 *
 * It reads four things and copies none of them into anything a caller will see: the error's
 * `name`, its `code`, its `cause`'s `code`, and — for one of our own errors — its `code` and
 * `status`, both of which are ours. Everything it returns is a label declared in this file.
 *
 * Module-private, never exported, and tested through `cachingDekSource` rather than directly:
 * an exported classifier is an invitation to call it on an error and log what comes back
 * alongside the error it came from, which puts the two back in the same log line.
 */
function classify(err: unknown): Classification {
  if (isContentCryptoError(err)) {
    if (GRACE_INELIGIBLE_CODES.has(err.code)) return { kind: 'refusal', code: err.code };
    const status = err.status;
    const reason: GraceReason =
      status >= 500 ? 'http-5xx' : status >= 400 ? 'http-4xx' : 'unknown';
    return { kind: 'unavailable', reason, status, code: err.code };
  }

  const name = stringProp(err, 'name');
  if (name === 'AbortError' || name === 'TimeoutError') {
    return { kind: 'unavailable', reason: 'timeout' };
  }

  const codes = [stringProp(err, 'code'), stringProp(causeOf(err), 'code')];
  for (const code of codes) {
    if (code !== undefined && TIMEOUT_CAUSE_CODES.has(code)) {
      return { kind: 'unavailable', reason: 'timeout' };
    }
  }
  for (const code of codes) {
    if (code !== undefined && NETWORK_CAUSE_CODES.has(code)) {
      return { kind: 'unavailable', reason: 'network' };
    }
  }

  // The `name` check is not redundant with `instanceof`: a parse failure raised in another
  // realm — a worker, a vm context, a second copy of a library — is a `SyntaxError` that
  // fails `instanceof`, and it is the case that carries a fragment of the response body.
  if (err instanceof SyntaxError || name === 'SyntaxError') {
    return { kind: 'unavailable', reason: 'malformed-response' };
  }

  return { kind: 'unavailable', reason: 'unknown' };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function invalid(message: string, details?: { readonly accountId?: string }): never {
  throw new ContentCryptoError('VALIDATION_ERROR', message, details === undefined ? undefined : compact(details));
}

function assertDuration(value: unknown, what: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    invalid(`${what} must be a non-negative whole number of milliseconds`);
  }
}

/**
 * A cache-key component is non-empty and free of U+001F, both checked at EVERY entry point.
 * An id carrying the separator could be split two ways, and two readings of one cache key is
 * a cross-account read — the single worst outcome available to this file.
 */
function assertKeyComponent(value: unknown, what: string): asserts value is string {
  if (typeof value !== 'string') invalid(`${what} must be a non-empty string`);
  if (value.length === 0) invalid(`${what} must be a non-empty string`);
  if (value.includes(UNIT_SEPARATOR)) {
    invalid(`${what} must not contain U+001F, which separates the parts of a cache key`);
  }
}

function assertGenerationNumber(value: unknown, accountId: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    invalid('generation must be a whole number of at least 1', { accountId });
  }
}

// ---------------------------------------------------------------------------
// The factory
// ---------------------------------------------------------------------------

/**
 * Wrap a `DekSource` in the cache every product must use.
 *
 * The returned object is the ONLY `CachedDekSource` there is: the brand is a `unique symbol`
 * declared in `custodian.ts` and never exported, so no other file can produce one and the
 * assertion below is the single privileged place in the package. That is what turns "you
 * must cache" from a paragraph in an upgrade note into a compile error.
 */
export function cachingDekSource(inner: DekSource, opts: CacheOptions): CachedDekSource {
  if (inner === null || typeof inner !== 'object') {
    invalid('cachingDekSource needs a DekSource to wrap');
  }
  if (opts === null || typeof opts !== 'object') {
    invalid('cachingDekSource needs its options; onGraceServe alone has no default');
  }
  assertKeyComponent(opts.productId, 'productId');
  if (typeof opts.onGraceServe !== 'function') {
    invalid('onGraceServe is required: every grace serve is logged, so forgetting it is not a default');
  }
  if (opts.now !== undefined && typeof opts.now !== 'function') {
    invalid('now must be a function returning milliseconds');
  }

  const productId = opts.productId;
  const dekTtlMs = opts.dekTtlMs ?? DEFAULT_DEK_TTL_MS;
  const pointerTtlMs = opts.pointerTtlMs ?? DEFAULT_POINTER_TTL_MS;
  const graceMs = opts.graceMs ?? resolveGraceMs();
  const maxEntries = opts.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const onGraceServe = opts.onGraceServe;
  const now = opts.now ?? Date.now;

  assertDuration(dekTtlMs, 'dekTtlMs');
  assertDuration(pointerTtlMs, 'pointerTtlMs');
  assertDuration(graceMs, 'graceMs');
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) {
    invalid('maxEntries must be a whole number of at least 1');
  }

  // Insertion-ordered Maps, used as LRU lists: a hit deletes and re-sets its key, so the
  // oldest key is always the least recently USED rather than the least recently written.
  const deks = new Map<string, DekRow>();
  const pointers = new Map<string, PointerRow>();
  const inflightDeks = new Map<string, Promise<DekHandle>>();
  const inflightPointers = new Map<string, Promise<number>>();

  let hits = 0;
  let misses = 0;
  let graceServes = 0;
  let evictions = 0;

  const pointerKey = (accountId: string): string => `${productId}${UNIT_SEPARATOR}${accountId}`;
  const dekKey = (accountId: string, generation: number): string =>
    `${productId}${UNIT_SEPARATOR}${accountId}${UNIT_SEPARATOR}${generation}`;

  // ── The maps ─────────────────────────────────────────────────────────────────────────

  function bound<T>(map: Map<string, T>): void {
    while (map.size > maxEntries) {
      const oldest = map.keys().next();
      if (oldest.done === true) return;
      // No zeroise here, and nowhere else either. The evicted handle may be the very object
      // a concurrent request is decrypting with.
      map.delete(oldest.value);
      evictions += 1;
    }
  }

  function putDek(key: string, handle: DekHandle, at: number): void {
    deks.delete(key);
    deks.set(key, { handle, expiresAt: at + dekTtlMs });
    bound(deks);
  }

  function putPointer(accountId: string, generation: number, at: number): void {
    const key = pointerKey(accountId);
    pointers.delete(key);
    pointers.set(key, { generation, expiresAt: at + pointerTtlMs });
    bound(pointers);
  }

  /**
   * Freshness is inclusive of the expiry instant — a row created at `t` with a TTL of `n` is
   * fresh through `t + n` and expired from `t + n + 1`. One millisecond, deliberate: it is
   * what makes `GraceInfo.ageMs` strictly greater than zero for every row that is ever
   * graced, which is a documented invariant of the payload.
   */
  function lookupDek(key: string, at: number): Lookup {
    const row = deks.get(key);
    if (row === undefined) return { state: 'absent' };
    if (at <= row.expiresAt) {
      deks.delete(key);
      deks.set(key, row);
      return { state: 'fresh', handle: row.handle };
    }
    const ageMs = at - row.expiresAt;
    if (ageMs > graceMs) {
      deks.delete(key);
      return { state: 'absent' };
    }
    return { state: 'stale', handle: row.handle, ageMs };
  }

  function livePointer(accountId: string, at: number): PointerRow | undefined {
    const key = pointerKey(accountId);
    const row = pointers.get(key);
    if (row === undefined) return undefined;
    if (at > row.expiresAt) {
      // Never graced, at any age. §11.5: a stale pointer costs correctness.
      pointers.delete(key);
      return undefined;
    }
    pointers.delete(key);
    pointers.set(key, row);
    return row;
  }

  /**
   * Drop everything this instance holds for one account: the pointer, every generation, and
   * every in-flight load. Deleting the in-flight entry is what disarms the populate guard
   * below, so a load already on the wire cannot put back what this just removed.
   *
   * LRU pressure is counted in `stats().evictions`; a purge is not. An operator reading that
   * counter is asking whether the cache is too small, and folding a revoke or a caller's own
   * `evict` into the same number answers a different question with the same digits.
   */
  function purge(accountId: string): void {
    const prefix = `${pointerKey(accountId)}${UNIT_SEPARATOR}`;
    pointers.delete(pointerKey(accountId));
    inflightPointers.delete(pointerKey(accountId));
    inflightDeks.delete(pointerKey(accountId));
    for (const key of [...deks.keys()]) if (key.startsWith(prefix)) deks.delete(key);
    for (const key of [...inflightDeks.keys()]) if (key.startsWith(prefix)) inflightDeks.delete(key);
  }

  // ── In-flight dedupe ─────────────────────────────────────────────────────────────────

  async function invoke<T>(fn: () => Promise<T>): Promise<T> {
    return fn();
  }

  /**
   * One upstream call per key, however many callers arrive.
   *
   * **The `inflight.get(key) === p` guard is on BOTH sides, and the populate side is the
   * subtle one.** An `evict` (or a purge on a refusal) landing while a load is in flight
   * removes the entry from `inflightDeks`. Without the guard, the load then resolves and
   * repopulates the cache with the very key the evict was there to drop — and the revoke
   * does not bite until the *next* TTL, which is exactly the bug the whole file exists to
   * avoid. This is the part a reimplementation drops.
   */
  function dedupeDek(
    key: string,
    fetch: () => Promise<DekHandle>,
    populate: (handle: DekHandle) => void,
  ): Promise<DekHandle> {
    const existing = inflightDeks.get(key);
    if (existing !== undefined) return existing;

    const p = invoke(fetch);
    inflightDeks.set(key, p);
    p.then(
      (handle) => {
        if (inflightDeks.get(key) !== p) return;
        inflightDeks.delete(key);
        populate(handle);
      },
      () => {
        if (inflightDeks.get(key) === p) inflightDeks.delete(key);
      },
    );
    return p;
  }

  function dedupePointer(
    accountId: string,
    fetch: () => Promise<number>,
  ): Promise<number> {
    const key = pointerKey(accountId);
    const existing = inflightPointers.get(key);
    if (existing !== undefined) return existing;

    const p = invoke(fetch);
    inflightPointers.set(key, p);
    p.then(
      (generation) => {
        if (inflightPointers.get(key) !== p) return;
        inflightPointers.delete(key);
        putPointer(accountId, generation, now());
      },
      () => {
        if (inflightPointers.get(key) === p) inflightPointers.delete(key);
      },
    );
    return p;
  }

  // ── Grace ────────────────────────────────────────────────────────────────────────────

  function serveGraced(
    accountId: string,
    handle: DekHandle,
    ageMs: number,
    failure: Extract<Classification, { kind: 'unavailable' }>,
  ): DekHandle {
    graceServes += 1;
    const info: GraceInfo = {
      accountId,
      productId,
      generation: handle.generation,
      ageMs,
      reason: failure.reason,
      ...compact({ status: failure.status, code: failure.code }),
    };
    // The recursive, value-level guard — not the error-details allowlist, which is a
    // different check with a different threat model (see this file's header). If it ever
    // throws, something has put key material on the path to a log and the right outcome is a
    // loud failure rather than a warn line nobody reads.
    assertNoKeyMaterial(info, 'graceInfo');
    onGraceServe(info);
    return handle;
  }

  function unavailable(
    accountId: string,
    reason: GraceReason,
    generation?: number,
  ): never {
    const at = generation === undefined ? '' : ` at generation ${generation}`;
    throw new ContentCryptoError(
      'KEY_SOURCE_UNAVAILABLE',
      `the content key source could not be reached for ${accountId}${at} (${reason}), ` +
        'and no cached key remains within the grace window',
      compact({ accountId, generation }),
    );
  }

  function readOnly(accountId: string, reason: GraceReason): never {
    throw new ContentCryptoError(
      'KEY_SOURCE_UNAVAILABLE',
      `the content key source could not be reached for ${accountId} (${reason}) and the ` +
        'generation pointer has expired; existing records can still be read, but a new wrap ' +
        'must not be written at a generation that may already have been drained',
      compact({ accountId }),
    );
  }

  // ── The four methods ─────────────────────────────────────────────────────────────────

  async function getDek(accountId: string, generation: number): Promise<DekHandle> {
    assertKeyComponent(accountId, 'accountId');
    assertGenerationNumber(generation, accountId);

    const key = dekKey(accountId, generation);
    const at = now();
    const found = lookupDek(key, at);
    if (found.state === 'fresh') {
      hits += 1;
      return found.handle;
    }
    misses += 1;

    try {
      return await dedupeDek(
        key,
        () => inner.getDek(accountId, generation),
        (handle) => putDek(key, handle, now()),
      );
    } catch (err) {
      const failure = classify(err);
      if (failure.kind === 'refusal') {
        purge(accountId);
        throw err;
      }
      // Unconditional on the read path: `generation` came off a stored wrap, so no pointer
      // is involved and nothing here can be labelled with a generation it was not sealed
      // under. This is the case the plan settled — Morph's lake keeps reading.
      const graced = lookupDek(key, now());
      if (graced.state === 'stale') {
        return serveGraced(accountId, graced.handle, graced.ageMs, failure);
      }
      return unavailable(accountId, failure.reason, generation);
    }
  }

  async function getCurrentDek(accountId: string): Promise<DekHandle> {
    assertKeyComponent(accountId, 'accountId');

    const at = now();
    const pointer = livePointer(accountId, at);
    if (pointer !== undefined) {
      const found = lookupDek(dekKey(accountId, pointer.generation), at);
      if (found.state === 'fresh') {
        hits += 1;
        return found.handle;
      }
    }
    misses += 1;

    try {
      // Deduped on the POINTER key: one upstream call answers both halves, and the handle
      // pairs the key with its generation so the two can never disagree.
      return await dedupeDek(
        pointerKey(accountId),
        () => inner.getCurrentDek(accountId),
        (handle) => {
          const landed = now();
          putDek(dekKey(accountId, handle.generation), handle, landed);
          putPointer(accountId, handle.generation, landed);
        },
      );
    } catch (err) {
      const failure = classify(err);
      if (failure.kind === 'refusal') {
        purge(accountId);
        throw err;
      }
      // The whole of §11.5 is these four lines. A graced DEK may be stamped onto a NEW wrap
      // only while we still know, within `pointerTtlMs`, which generation is current.
      const stillKnown = livePointer(accountId, now());
      if (stillKnown === undefined) return readOnly(accountId, failure.reason);
      const graced = lookupDek(dekKey(accountId, stillKnown.generation), now());
      if (graced.state === 'stale') {
        return serveGraced(accountId, graced.handle, graced.ageMs, failure);
      }
      return unavailable(accountId, failure.reason, stillKnown.generation);
    }
  }

  async function currentGeneration(accountId: string): Promise<number> {
    assertKeyComponent(accountId, 'accountId');

    const pointer = livePointer(accountId, now());
    if (pointer !== undefined) {
      hits += 1;
      return pointer.generation;
    }
    misses += 1;

    try {
      return await dedupePointer(accountId, () => inner.currentGeneration(accountId));
    } catch (err) {
      const failure = classify(err);
      if (failure.kind === 'refusal') {
        purge(accountId);
        throw err;
      }
      // No grace, at any age, ever. There is no such thing as an acceptably stale answer to
      // "which generation is current"; a wrong answer here is silent and permanent.
      return readOnly(accountId, failure.reason);
    }
  }

  /**
   * Forwarded to the inner source after the purge, because this is a DECORATOR: `evict` is a
   * method of the interface being decorated, and a decorator that swallows one of its own
   * interface's methods is a decorator that lies. For the Phase-C HTTP client the forward is
   * a no-op; for anything that memoises underneath it is the difference between the revoke
   * biting and not. The purge happens FIRST, so an inner that throws leaves this cache clean.
   */
  function evict(accountId: string): void {
    assertKeyComponent(accountId, 'accountId');
    purge(accountId);
    inner.evict(accountId);
  }

  function stats(): CacheStats {
    // `entries` counts rows of KEY MATERIAL, which is what an operator reading a health
    // response is asking about. Pointer rows are a separate, shorter-lived cache holding
    // nothing but an integer, and `CacheStats` has no field for them by design.
    return { entries: deks.size, hits, misses, graceServes, evictions };
  }

  function clear(): void {
    // Drops rows, keeps counters: the counters are lifetime totals for a health response,
    // and a `clear` that resets them erases the evidence of the pressure that prompted it.
    // No zeroise, for the reason in this file's header.
    deks.clear();
    pointers.clear();
    inflightDeks.clear();
    inflightPointers.clear();
  }

  // The one privileged assertion in the package: the brand is a `unique symbol` that
  // `custodian.ts` declares and does not export, so it cannot be written as a property and
  // no second file can produce this type by accident or on purpose.
  return { getCurrentDek, getDek, currentGeneration, evict, stats, clear } as CachedDekSource;
}
