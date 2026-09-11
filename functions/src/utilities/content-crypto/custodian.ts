/**
 * The custodian conversation — **the read path, and types only.**
 *
 * ── TWO THINGS, TWO NAMES (R16) ──
 *
 * `KeyCustodian` is **Accounts' service**, built in Phase B, and it is not in this repo. The
 * package's read-side port is **`DekSource`**, with **`CachedDekSource`** the branded decorator
 * `cachingDekSource` produces and the only thing `createContentCrypto` accepts. An early draft of
 * the plan used the one name for both and the plan now says so explicitly (`01` Phase A); nothing
 * in this package should ever call the port a custodian. **The façade's option and its property
 * are therefore `dekSource`** — R17 (rename), which corrected the last field name that still said
 * otherwise, in the most visible place there was: a public options object whose type already read
 * `CachedDekSource`. The file is named for the conversation, not for the port. `KeyCustodian.ts` cited in `key-lifecycle.ts` is collab's production service,
 * from which Accounts' is shaped.
 *
 * There is no implementation of a `DekSource` in this package and there never will be. Accounts is
 * the platform's key custodian; a product asks it for a plaintext DEK over TLS, holds it in memory
 * for the length of a request, and does its own crypto. What lives here is the shape of that
 * conversation, so the Phase-C swap from a local test double to the Accounts HTTP client changes
 * one construction site and no call site.
 *
 * `productId` is bound when the cache is constructed and appears in **no signature below**, which
 * is what makes a call site identical before and after that swap and what stops anyone passing the
 * wrong one.
 *
 * This file is types only. The one thing that constructs anything — `cachingDekSource` — lives in
 * `custodian-cache.ts`, because the TTL *is* the revocation window and the grace window, and both
 * belong in one file rather than wherever a caller happens to build a source.
 */

import type { AccountDek } from './secret';

/**
 * A DEK and the generation to stamp, **together**, so the two can never disagree.
 *
 * collab found this one the hard way: asking for the DEK and asking for the generation were two
 * calls, and two calls is exactly how a value gets labelled with a generation it was not encrypted
 * under. One object, one answer, no window.
 */
export interface DekHandle {
  readonly generation: number;
  readonly key: AccountDek;
}

export interface DekSource {
  /** The write path. MAY mint generation 1 on first use. */
  getCurrentDek(accountId: string): Promise<DekHandle>;
  /** One named generation. **NEVER mints** — an absent wrap is `ACCOUNT_KEY_DESTROYED`, never a
   *  fresh key. A custodian that mints on a read is a custodian that silently makes every value
   *  under the missing generation permanently unreadable while reporting success. */
  getDek(accountId: string, generation: number): Promise<DekHandle>;
  currentGeneration(accountId: string): Promise<number>;
  /** In-process only, synchronous. */
  evict(accountId: string): void;
}

/** Counts only, and deliberately no key, label or accountId — this is the kind of object that ends
 *  up on a `/healthz` response. */
export interface CacheStats {
  readonly entries: number;
  readonly hits: number;
  readonly misses: number;
  readonly graceServes: number;
  readonly evictions: number;
}

declare const CACHED: unique symbol;

/**
 * Only `cachingDekSource()` produces one, and the façade accepts nothing else.
 *
 * The brand is not ceremony. The TTL is the revocation window — a revoke bites at the next cold
 * load — and the grace window lives in the same decorator. A façade handed a bare `DekSource`
 * would silently opt out of both, and the failure is invisible: everything works, revocations just
 * never arrive. A phantom brand only the factory can produce turns that into a compile error.
 */
export interface CachedDekSource extends DekSource {
  readonly [CACHED]: true;
  stats(): CacheStats;
  clear(): void;
}

export type RevokedCause = 'sysadmin' | 'account-deactivated' | 'client-request' | 'incident';

/** DERIVED at the wire boundary, never stored. A stored status is a second copy of the truth that
 *  drifts from the timestamps the moment one write lands and the other does not. */
export type ContentKeyState = 'active' | 'revoked' | 'destroyed';

export interface ContentKeyStatus {
  readonly accountId: string;
  readonly productId: string;
  readonly status: ContentKeyState;
  readonly currentGeneration: number;
  readonly createdAt: string | null;
  readonly revokedAt: string | null;
  readonly revokedCause: RevokedCause | null;
  readonly destroyedAt: string | null;
  readonly destroyedThrough: number | null;
  readonly rotation: OpenRotation | null;
}

export interface GenerationStatus {
  readonly n: number;
  readonly kmsKeyVersion: string | null;
  readonly hasWrap: boolean;
  readonly createdAt: string | null;
  readonly retiredAt: string | null;
  readonly drainedAt: string | null;
  readonly destroyedAt: string | null;
}

export interface RotationProgress {
  readonly recordsRewrapped: number;
  readonly recordsTotal: number;
  readonly conflicted: number;
  // `valuesRewritten` and `objectsRewritten` are DELETED. A rotation rewraps and touches no
  // content and lists no bucket, so both would be zero for ever — and a status field that is
  // always zero teaches an operator to distrust the whole page. A re-key is a different operation
  // (three steps, not a function) and will bring its own progress shape when it arrives.
}

export interface OpenRotation {
  readonly generation: number;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly error: string | null;
  readonly progress: Partial<RotationProgress>;
}
