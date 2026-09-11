/**
 * `custodian-cache.ts` — the TTL, the pointer, the dedupe, the LRU, and the grace window.
 *
 * Two kinds of test live here and it is worth knowing which is which.
 *
 * The first kind is PORTED. collab has run this cache in production and every behaviour in
 * the first four describes was learned there rather than designed here — the in-flight guard
 * on both sides most of all, which is the part a reimplementation drops and which no ordinary
 * test would notice the absence of, because everything still works until a revoke lands
 * during a load.
 *
 * The second kind guards the leak boundary, and it is the reason this file is long. From
 * Phase C the source under this cache is an HTTP client for a route whose 200 body IS the
 * plaintext DEK, so an upstream failure is an object that may quote key material. The tests
 * from 'the classifier' onwards assert that nothing from such an error reaches a payload we
 * hand to a logger: the reason is one of six labels we wrote ourselves, chosen by reading
 * `name`, `code` and `cause.code` and nothing else.
 *
 * Everything runs on an injected clock, so a fifteen-minute window is proved in microseconds.
 */

import type { CachedDekSource, DekHandle, DekSource } from '../custodian';
import {
  DEFAULT_DEK_TTL_MS,
  DEFAULT_POINTER_TTL_MS,
  DEFAULT_QUIESCE_MS,
  GRACE_INELIGIBLE_CODES,
  cachingDekSource,
  quiesceMsFor,
} from '../custodian-cache';
import type { GraceInfo, GraceReason } from '../custodian-cache';
import { ContentCryptoError, assertNoKeyMaterial, isContentCryptoError } from '../errors';
import type { ContentCryptoCode } from '../errors';
import { resolveGraceMs } from '../key-scope';
import { KEY_BYTES, dekFromBytes, isDestroyed } from '../secret';

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const PRODUCT = 'collab';
const ACCOUNT = 'acc_1';
const GRACE = 900_000;

/** U+001F, the character the cache key is built around. Written as an escape rather than as
 *  itself, because a raw control character in a source file is invisible to a reviewer. */
const SEPARATOR = '\u001F';

/** A whole-millisecond clock the tests drive by hand. */
function clockFrom(start = 1_700_000_000_000): {
  now: () => number;
  advance: (ms: number) => void;
} {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

interface Stub extends DekSource {
  /** Every upstream call, per method. The number that most tests turn on. */
  readonly calls: { current: number; byGeneration: number; pointer: number; evicted: number };
  /** From now on, every method rejects with this. */
  fail(err: unknown): void;
  heal(): void;
  /** Publish a new current generation, the way a rotation does. */
  publish(generation: number): void;
  /** Hold every in-flight call open until the returned function is called. */
  block(): () => void;
}

function stubSource(): Stub {
  let generation = 1;
  let failure: unknown;
  let barrier: { promise: Promise<void>; release: () => void } | null = null;
  const calls = { current: 0, byGeneration: 0, pointer: 0, evicted: 0 };

  const handleFor = (accountId: string, gen: number): DekHandle => ({
    generation: gen,
    // Distinct bytes per generation, so a test that gets the wrong generation's key sees it.
    key: dekFromBytes(Buffer.alloc(KEY_BYTES, gen), `${PRODUCT}/${accountId}@${gen}`),
  });

  const gate = async (): Promise<void> => {
    if (barrier !== null) await barrier.promise;
    if (failure !== undefined) throw failure;
  };

  return {
    calls,
    fail(err: unknown) {
      failure = err;
    },
    heal() {
      failure = undefined;
    },
    publish(next: number) {
      generation = next;
    },
    block() {
      let release: () => void = () => undefined;
      const promise = new Promise<void>((resolve) => {
        release = () => resolve();
      });
      barrier = { promise, release };
      return () => {
        const held = barrier;
        barrier = null;
        if (held !== null) held.release();
      };
    },
    async getCurrentDek(accountId: string): Promise<DekHandle> {
      calls.current += 1;
      await gate();
      return handleFor(accountId, generation);
    },
    async getDek(accountId: string, gen: number): Promise<DekHandle> {
      calls.byGeneration += 1;
      await gate();
      return handleFor(accountId, gen);
    },
    async currentGeneration(_accountId: string): Promise<number> {
      calls.pointer += 1;
      await gate();
      return generation;
    },
    evict(_accountId: string): void {
      calls.evicted += 1;
    },
  };
}

/**
 * Every `GraceInfo` any test in this file has seen, drained once at the end.
 *
 * The per-test assertions below are specific; this one is blunt and total, and it is the one
 * that would catch a field added to `GraceInfo` later by somebody who did not read the header
 * of the module. It is the same discipline `leak.test.ts` will apply across every suite.
 */
const EVERY_GRACE_INFO: GraceInfo[] = [];

function newCache(
  inner: DekSource,
  opts: Partial<{
    productId: string;
    dekTtlMs: number;
    pointerTtlMs: number;
    graceMs: number;
    maxEntries: number;
    now: () => number;
  }> = {},
  seen: GraceInfo[] = [],
): CachedDekSource {
  return cachingDekSource(inner, {
    productId: PRODUCT,
    graceMs: GRACE,
    ...opts,
    onGraceServe: (info) => {
      EVERY_GRACE_INFO.push(info);
      seen.push(info);
    },
  });
}

async function refusedWith(promise: Promise<unknown>): Promise<ContentCryptoError> {
  try {
    await promise;
  } catch (err) {
    if (isContentCryptoError(err)) return err;
    throw err;
  }
  throw new Error('expected a ContentCryptoError, and the call resolved');
}

afterAll(() => {
  expect(EVERY_GRACE_INFO.length).toBeGreaterThan(0);
  for (const info of EVERY_GRACE_INFO) assertNoKeyMaterial(info, 'graceInfo');
});

// ---------------------------------------------------------------------------

describe('the settled durations', () => {
  it('are collab’s live values, and the quiesce is derived from the pointer TTL', () => {
    expect(DEFAULT_DEK_TTL_MS).toBe(600_000);
    expect(DEFAULT_POINTER_TTL_MS).toBe(60_000);
    // Not written down twice: the quiesce is how long a rotation waits before its first
    // write, and the thing it waits out is a warm instance's pointer.
    expect(DEFAULT_QUIESCE_MS).toBe(DEFAULT_POINTER_TTL_MS * 2);
    expect(quiesceMsFor()).toBe(DEFAULT_QUIESCE_MS);
    expect(quiesceMsFor(30_000)).toBe(60_000);
    expect(quiesceMsFor(0)).toBe(0);
  });

  it('refuses a pointer TTL that is not a duration', () => {
    expect(() => quiesceMsFor(-1)).toThrow(ContentCryptoError);
    expect(() => quiesceMsFor(1.5)).toThrow(ContentCryptoError);
  });

  it('makes the DEK TTL the longer of the two, because the two costs differ', () => {
    // A stale DEK costs freshness. A stale pointer costs correctness.
    expect(DEFAULT_POINTER_TTL_MS).toBeLessThan(DEFAULT_DEK_TTL_MS);
  });
});

describe('construction', () => {
  it('requires onGraceServe — every grace serve is logged, so it has no default', () => {
    const inner = stubSource();
    expect(() =>
      // @ts-expect-error — onGraceServe is REQUIRED. Forgetting it is a type error, not a
      // silence nobody notices.
      cachingDekSource(inner, { productId: PRODUCT }),
    ).toThrow(ContentCryptoError);
  });

  it('is the only producer of a CachedDekSource', () => {
    const bare: DekSource = stubSource();
    // @ts-expect-error — the brand is a `unique symbol` custodian.ts never exports, so no
    // other file can produce this type. This is what makes caching mandatory rather than
    // advisory: the façade accepts nothing else.
    const branded: CachedDekSource = bare;
    expect(typeof branded.getDek).toBe('function');

    const real = newCache(stubSource());
    const accepted: CachedDekSource = real;
    expect(typeof accepted.stats).toBe('function');
    expect(typeof accepted.clear).toBe('function');
  });

  it('refuses a productId that is empty or carries the cache-key separator', () => {
    const inner = stubSource();
    expect(() => newCache(inner, { productId: '' })).toThrow(ContentCryptoError);
    expect(() => newCache(inner, { productId: `col${SEPARATOR}lab` })).toThrow(ContentCryptoError);
  });

  it('refuses durations that are not durations, and a maxEntries below one', () => {
    const inner = stubSource();
    expect(() => newCache(inner, { dekTtlMs: -1 })).toThrow(ContentCryptoError);
    expect(() => newCache(inner, { pointerTtlMs: 1.5 })).toThrow(ContentCryptoError);
    expect(() => newCache(inner, { graceMs: Number.NaN })).toThrow(ContentCryptoError);
    expect(() => newCache(inner, { maxEntries: 0 })).toThrow(ContentCryptoError);
  });
});

describe('the cache key', () => {
  it('rejects an accountId carrying U+001F at every entry point', async () => {
    // An id containing the separator could be split two ways, and two readings of one cache
    // key is a cross-account read — the worst outcome available to this file.
    const cache = newCache(stubSource());
    const bad = `acc${SEPARATOR}1`;
    await expect(cache.getCurrentDek(bad)).rejects.toThrow(ContentCryptoError);
    await expect(cache.getDek(bad, 1)).rejects.toThrow(ContentCryptoError);
    await expect(cache.currentGeneration(bad)).rejects.toThrow(ContentCryptoError);
    expect(() => cache.evict(bad)).toThrow(ContentCryptoError);

    const empty = await refusedWith(cache.getDek('', 1));
    expect(empty.code).toBe<ContentCryptoCode>('VALIDATION_ERROR');
  });

  it('rejects a generation that is not a whole number of at least one', async () => {
    const cache = newCache(stubSource());
    await expect(cache.getDek(ACCOUNT, 0)).rejects.toThrow(ContentCryptoError);
    await expect(cache.getDek(ACCOUNT, -1)).rejects.toThrow(ContentCryptoError);
    await expect(cache.getDek(ACCOUNT, 1.5)).rejects.toThrow(ContentCryptoError);
  });

  it('carries the productId, so two products over one account do not share an entry', async () => {
    // The productId is in the key even though an instance serves exactly one product, which
    // is what makes this a property of the DESIGN rather than an accident of instantiation:
    // it would still hold under a module-level map.
    const inner = stubSource();
    const collab = newCache(inner, { productId: PRODUCT });
    const morph = newCache(inner, { productId: 'morph' });

    await collab.getCurrentDek(ACCOUNT);
    await morph.getCurrentDek(ACCOUNT);

    expect(inner.calls.current).toBe(2);
    expect(collab.stats().entries).toBe(1);
    expect(morph.stats().entries).toBe(1);
  });

  it('caches per generation, not per account', async () => {
    const inner = stubSource();
    const cache = newCache(inner);

    await cache.getDek(ACCOUNT, 1);
    await cache.getDek(ACCOUNT, 2);
    expect(inner.calls.byGeneration).toBe(2);
    expect(cache.stats().entries).toBe(2);

    await cache.getDek(ACCOUNT, 1);
    await cache.getDek(ACCOUNT, 2);
    expect(inner.calls.byGeneration).toBe(2);
    expect(cache.stats().hits).toBe(2);
  });
});

describe('the TTL, which IS the revocation window', () => {
  it('serves from cache inside the window and reloads one millisecond past it', async () => {
    const clock = clockFrom();
    const inner = stubSource();
    const cache = newCache(inner, { now: clock.now });

    await cache.getDek(ACCOUNT, 1);
    clock.advance(DEFAULT_DEK_TTL_MS);
    await cache.getDek(ACCOUNT, 1);
    // Inclusive of the expiry instant, deliberately: it is what keeps `GraceInfo.ageMs`
    // strictly positive for every row that is ever graced.
    expect(inner.calls.byGeneration).toBe(1);

    clock.advance(1);
    await cache.getDek(ACCOUNT, 1);
    expect(inner.calls.byGeneration).toBe(2);
  });

  it('deletes an entry that is past the grace window at the moment it is read', async () => {
    const clock = clockFrom();
    const inner = stubSource();
    const cache = newCache(inner, { now: clock.now });

    await cache.getDek(ACCOUNT, 1);
    expect(cache.stats().entries).toBe(1);

    clock.advance(DEFAULT_DEK_TTL_MS + GRACE + 1);
    inner.fail(new Error('upstream down'));
    await expect(cache.getDek(ACCOUNT, 1)).rejects.toThrow(ContentCryptoError);
    // Not left until the next successful load: the row is gone, and with it any chance of it
    // being served by something that forgot to check the clock.
    expect(cache.stats().entries).toBe(0);
  });

  it('counts a hit only when nobody was asked', async () => {
    const clock = clockFrom();
    const inner = stubSource();
    const cache = newCache(inner, { now: clock.now });

    await cache.getDek(ACCOUNT, 1);
    await cache.getDek(ACCOUNT, 1);
    const stats = cache.stats();
    expect(stats).toEqual({ entries: 1, hits: 1, misses: 1, graceServes: 0, evictions: 0 });
    // Counts only. No key, no label, no accountId — this is the kind of object that ends up
    // on a health response.
    expect(Object.keys(stats).sort()).toEqual([
      'entries',
      'evictions',
      'graceServes',
      'hits',
      'misses',
    ]);
  });
});

describe('the pointer is a separate, shorter-lived cache', () => {
  it('expires on its own clock', async () => {
    const clock = clockFrom();
    const inner = stubSource();
    const cache = newCache(inner, { now: clock.now });

    expect(await cache.currentGeneration(ACCOUNT)).toBe(1);
    clock.advance(DEFAULT_POINTER_TTL_MS);
    expect(await cache.currentGeneration(ACCOUNT)).toBe(1);
    expect(inner.calls.pointer).toBe(1);

    clock.advance(1);
    inner.publish(2);
    expect(await cache.currentGeneration(ACCOUNT)).toBe(2);
    expect(inner.calls.pointer).toBe(2);
  });

  it('makes getCurrentDek ask again once the pointer has expired, DEK or no DEK', async () => {
    const clock = clockFrom();
    const inner = stubSource();
    const cache = newCache(inner, { now: clock.now });

    const first = await cache.getCurrentDek(ACCOUNT);
    expect(first.generation).toBe(1);

    clock.advance(DEFAULT_POINTER_TTL_MS + 1); // the DEK is still fresh; the pointer is not
    inner.publish(2);
    const second = await cache.getCurrentDek(ACCOUNT);

    // The whole point: a warm DEK is not licence to keep stamping generation 1.
    expect(second.generation).toBe(2);
    expect(inner.calls.current).toBe(2);
    expect(cache.stats().entries).toBe(2);
  });

  it('populates the pointer and the DEK from one upstream call', async () => {
    const clock = clockFrom();
    const inner = stubSource();
    const cache = newCache(inner, { now: clock.now });

    await cache.getCurrentDek(ACCOUNT);
    expect(await cache.currentGeneration(ACCOUNT)).toBe(1);
    // A DekHandle pairs the key with its generation, so one answer settles both and the two
    // can never disagree.
    expect(inner.calls.pointer).toBe(0);
  });
});

describe('in-flight dedupe', () => {
  it('makes one upstream call however many callers arrive', async () => {
    const inner = stubSource();
    const cache = newCache(inner);
    const release = inner.block();

    const all = Promise.all([
      cache.getDek(ACCOUNT, 1),
      cache.getDek(ACCOUNT, 1),
      cache.getDek(ACCOUNT, 1),
    ]);
    release();
    const handles = await all;

    expect(inner.calls.byGeneration).toBe(1);
    expect(handles[0]).toBe(handles[1]);
    expect(handles[1]).toBe(handles[2]);
  });

  it('does NOT repopulate when an evict lands mid-load — the guard a rewrite drops', async () => {
    // This is the whole reason the guard is on the POPULATE side as well as the cleanup side.
    // Without it the load resolves after the evict and puts back the very key the evict was
    // there to drop, and the revoke does not bite until the next TTL.
    const inner = stubSource();
    const cache = newCache(inner);
    const release = inner.block();

    const pending = cache.getDek(ACCOUNT, 1);
    cache.evict(ACCOUNT);
    release();
    await pending;

    expect(cache.stats().entries).toBe(0);
    await cache.getDek(ACCOUNT, 1);
    expect(inner.calls.byGeneration).toBe(2);
  });

  it('does not repopulate when a refusal purges mid-load either', async () => {
    const inner = stubSource();
    const cache = newCache(inner);
    const release = inner.block();

    const pendingOne = cache.getDek(ACCOUNT, 1);
    // A second account entry, refused while the first is still on the wire.
    const pendingTwo = cache.getDek(ACCOUNT, 2);
    inner.fail(new ContentCryptoError('ACCOUNT_KEY_REVOKED', 'revoked'));
    release();

    await expect(pendingOne).rejects.toThrow(ContentCryptoError);
    await expect(pendingTwo).rejects.toThrow(ContentCryptoError);
    expect(cache.stats().entries).toBe(0);
  });

  it('clears the in-flight entry when a load fails, so the next call is not stuck on it', async () => {
    const inner = stubSource();
    const cache = newCache(inner);

    inner.fail(new Error('transient'));
    await expect(cache.getDek(ACCOUNT, 1)).rejects.toThrow(ContentCryptoError);
    inner.heal();
    const handle = await cache.getDek(ACCOUNT, 1);

    expect(handle.generation).toBe(1);
    expect(inner.calls.byGeneration).toBe(2);
  });
});

describe('evict', () => {
  it('drops the pointer, every generation and every in-flight load', async () => {
    const inner = stubSource();
    const cache = newCache(inner);

    await cache.getCurrentDek(ACCOUNT);
    await cache.getDek(ACCOUNT, 1);
    await cache.getDek(ACCOUNT, 2);
    await cache.getDek('acc_2', 1);
    expect(cache.stats().entries).toBe(3);

    cache.evict(ACCOUNT);
    expect(cache.stats().entries).toBe(1); // acc_2 untouched

    inner.publish(5);
    expect(await cache.currentGeneration(ACCOUNT)).toBe(5); // the pointer went too
  });

  it('reaches the source underneath as well, because this is a decorator', async () => {
    // `evict` is a method of the interface being decorated. Swallowing it would be a
    // decorator that lies — a no-op for the Phase-C HTTP client, and the difference between
    // a revoke biting and not for anything that memoises underneath.
    const inner = stubSource();
    const cache = newCache(inner);
    await cache.getDek(ACCOUNT, 1);

    cache.evict(ACCOUNT);
    expect(inner.calls.evicted).toBe(1);
  });

  it('never zeroises a cached DEK, because a concurrent request holds the same handle', async () => {
    // The obvious-looking improvement, refused deliberately. The cache hands ONE handle to
    // concurrent callers; wiping the buffer on eviction corrupts whatever request is
    // mid-decrypt with it. That is data loss traded for a heap-hygiene gesture V8 does not
    // honour anyway.
    const cache = newCache(stubSource());
    const held = await cache.getDek(ACCOUNT, 1);

    cache.evict(ACCOUNT);
    expect(isDestroyed(held.key)).toBe(false);

    cache.clear();
    expect(isDestroyed(held.key)).toBe(false);
  });

  it('leaves the lifetime counters alone when the rows are cleared', async () => {
    const cache = newCache(stubSource());
    await cache.getDek(ACCOUNT, 1);
    await cache.getDek(ACCOUNT, 1);

    cache.clear();
    const stats = cache.stats();
    // A clear that reset the counters would erase the evidence of the pressure that prompted
    // it. Rows go; totals stay.
    expect(stats.entries).toBe(0);
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(1);
  });
});

describe('the LRU bound', () => {
  it('evicts the least recently USED entry and counts it', async () => {
    const inner = stubSource();
    const cache = newCache(inner, { maxEntries: 2 });

    await cache.getDek(ACCOUNT, 1);
    await cache.getDek(ACCOUNT, 2);
    await cache.getDek(ACCOUNT, 1); // makes 1 the most recently used
    await cache.getDek(ACCOUNT, 3);

    expect(cache.stats().entries).toBe(2);
    expect(cache.stats().evictions).toBe(1);

    // Least recently used was 2, not the oldest-written 1 — this is an LRU, not a queue.
    await cache.getDek(ACCOUNT, 1);
    expect(inner.calls.byGeneration).toBe(3);
    await cache.getDek(ACCOUNT, 2);
    expect(inner.calls.byGeneration).toBe(4);
  });

  it('counts only cache pressure, never a purge or a caller’s evict', async () => {
    // An operator reading `evictions` is asking whether the cache is too small. Folding a
    // revoke into the same number answers a different question with the same digits.
    const cache = newCache(stubSource());
    await cache.getDek(ACCOUNT, 1);
    cache.evict(ACCOUNT);
    expect(cache.stats().evictions).toBe(0);
  });
});

describe('grace covers unavailability', () => {
  async function warmed(opts: { graceMs?: number } = {}): Promise<{
    clock: ReturnType<typeof clockFrom>;
    inner: Stub;
    cache: CachedDekSource;
    seen: GraceInfo[];
  }> {
    const clock = clockFrom();
    const inner = stubSource();
    const seen: GraceInfo[] = [];
    const cache = newCache(inner, { now: clock.now, ...opts }, seen);
    await cache.getDek(ACCOUNT, 1);
    return { clock, inner, cache, seen };
  }

  it('serves an expired entry, reports how stale it is, and calls back EVERY time', async () => {
    const { clock, inner, cache, seen } = await warmed();
    clock.advance(DEFAULT_DEK_TTL_MS + 5_000);
    inner.fail(new Error('upstream down'));

    const first = await cache.getDek(ACCOUNT, 1);
    const second = await cache.getDek(ACCOUNT, 1);
    clock.advance(1_000);
    const third = await cache.getDek(ACCOUNT, 1);

    expect(first.generation).toBe(1);
    expect(second).toBe(first);
    expect(third).toBe(first);

    // The COUNT, not merely that it fired: a callback that fires once and then goes quiet is
    // an outage nobody can see the length of.
    expect(seen).toHaveLength(3);
    expect(cache.stats().graceServes).toBe(3);
    expect(inner.calls.byGeneration).toBe(4); // the upstream is asked every time as well

    expect(seen[0].ageMs).toBe(5_000);
    expect(seen[2].ageMs).toBe(6_000);
    for (const info of seen) {
      expect(info.ageMs).toBeGreaterThan(0);
      expect(info.accountId).toBe(ACCOUNT);
      expect(info.productId).toBe(PRODUCT);
      expect(info.generation).toBe(1);
    }
  });

  it('does not delete the entry it graced — the window is not spent on the first request', async () => {
    const { clock, inner, cache } = await warmed();
    clock.advance(DEFAULT_DEK_TTL_MS + 1);
    inner.fail(new Error('upstream down'));

    await cache.getDek(ACCOUNT, 1);
    expect(cache.stats().entries).toBe(1);
  });

  it('serves at exactly graceMs past expiry and refuses one millisecond later', async () => {
    const { clock, inner, cache } = await warmed();
    inner.fail(new Error('upstream down'));

    clock.advance(DEFAULT_DEK_TTL_MS + GRACE);
    await expect(cache.getDek(ACCOUNT, 1)).resolves.toBeDefined();

    clock.advance(1);
    const refused = await refusedWith(cache.getDek(ACCOUNT, 1));
    expect(refused.code).toBe<ContentCryptoCode>('KEY_SOURCE_UNAVAILABLE');
    expect(refused.status).toBe(503);
    expect(refused.details).toEqual({ accountId: ACCOUNT, generation: 1 });
  });

  it('defaults graceMs to resolveGraceMs(), asserted as behaviour rather than as a number', async () => {
    // Not compared against a literal: `CONTENT_KEY_GRACE_MS` may be set wherever this runs,
    // and a test that reads the environment is a test that does not mirror. Two caches, one
    // with the default and one with the value spelled out, must behave identically.
    const configured = resolveGraceMs();
    const outcomes: boolean[] = [];

    for (const graceMs of [undefined, configured]) {
      const clock = clockFrom();
      const inner = stubSource();
      const cache = newCache(inner, graceMs === undefined ? { now: clock.now } : { now: clock.now, graceMs });
      await cache.getDek(ACCOUNT, 1);
      inner.fail(new Error('upstream down'));
      clock.advance(DEFAULT_DEK_TTL_MS + configured);
      outcomes.push(await cache.getDek(ACCOUNT, 1).then(() => true, () => false));
      clock.advance(1);
      await expect(cache.getDek(ACCOUNT, 1)).rejects.toThrow(ContentCryptoError);
    }

    expect(outcomes[0]).toBe(outcomes[1]);
  });

  it('is off entirely at graceMs 0, which is what collab shipped before grace existed', async () => {
    const { clock, inner, cache, seen } = await warmed({ graceMs: 0 });
    clock.advance(DEFAULT_DEK_TTL_MS + 1);
    inner.fail(new Error('upstream down'));

    await expect(cache.getDek(ACCOUNT, 1)).rejects.toThrow(ContentCryptoError);
    expect(seen).toHaveLength(0);
  });

  it('refuses rather than grace-serving when there is nothing cached at all', async () => {
    const inner = stubSource();
    const seen: GraceInfo[] = [];
    const cache = newCache(inner, {}, seen);
    inner.fail(new Error('upstream down'));

    const refused = await refusedWith(cache.getDek(ACCOUNT, 7));
    expect(refused.code).toBe<ContentCryptoCode>('KEY_SOURCE_UNAVAILABLE');
    expect(seen).toHaveLength(0);
  });
});

describe('grace never covers refusal', () => {
  it.each([...GRACE_INELIGIBLE_CODES])('propagates %s and purges the account on the spot', async (code) => {
    // Asserted PER CODE rather than over the set as a whole: a set that silently lost a
    // member is the failure mode, and a single-case test would not see it.
    const clock = clockFrom();
    const inner = stubSource();
    const seen: GraceInfo[] = [];
    const cache = newCache(inner, { now: clock.now }, seen);

    await cache.getDek(ACCOUNT, 1);
    clock.advance(DEFAULT_DEK_TTL_MS + 1);

    const refusal = new ContentCryptoError(code, 'the custodian said no');
    inner.fail(refusal);

    await expect(cache.getDek(ACCOUNT, 1)).rejects.toBe(refusal);
    expect(seen).toHaveLength(0);
    expect(cache.stats().graceServes).toBe(0);
    expect(cache.stats().entries).toBe(0);
  });

  it('is exactly the five codes that mean the custodian said no', () => {
    expect([...GRACE_INELIGIBLE_CODES].sort()).toEqual(
      [
        'ACCOUNT_KEY_CAUSE_HOLDS',
        'ACCOUNT_KEY_DESTROYED',
        'ACCOUNT_KEY_NOT_FOUND',
        'ACCOUNT_KEY_REVOKED',
        'VALIDATION_ERROR',
      ].sort(),
    );
  });

  it('purges the entries a re-derivation would leave live — the half that is easy to miss', async () => {
    // Propagating WITHOUT purging leaves every other row for that account in place, so the
    // very next request is served from cache and the refusal is never seen again until the
    // TTL runs out. The rows that prove it are a still-FRESH sibling generation and the
    // pointer: neither is involved in the call that was refused.
    const clock = clockFrom();
    const inner = stubSource();
    const cache = newCache(inner, { now: clock.now });

    await cache.getDek(ACCOUNT, 1); // expires at +600_000
    clock.advance(300_000);
    inner.publish(2);
    await cache.getCurrentDek(ACCOUNT); // generation 2's row and the pointer, at +900_000
    const before = inner.calls.byGeneration;

    clock.advance(300_001); // generation 1 is now expired; generation 2 is not
    inner.fail(new ContentCryptoError('ACCOUNT_KEY_REVOKED', 'revoked'));
    await expect(cache.getDek(ACCOUNT, 1)).rejects.toThrow(ContentCryptoError);

    expect(cache.stats().entries).toBe(0);

    // Generation 2 would have been a HIT a moment ago. It now goes to the upstream and is
    // refused there too, which is the revoke biting on this instance rather than at the next
    // cold load.
    //
    // The spec words this test as "the second call also throws without touching the
    // upstream". Taken literally that cannot hold once the entries are purged — there is
    // nothing left to answer from, so the second call MUST ask. The property it was reaching
    // for is the inverse, and it is what is asserted here: the second call is not served from
    // a cache the refusal should have emptied.
    await expect(cache.getDek(ACCOUNT, 2)).rejects.toThrow(ContentCryptoError);
    expect(inner.calls.byGeneration).toBe(before + 2);
  });

  it('purges from currentGeneration and getCurrentDek as well', async () => {
    const clock = clockFrom();
    const inner = stubSource();
    const cache = newCache(inner, { now: clock.now });
    await cache.getCurrentDek(ACCOUNT);
    expect(cache.stats().entries).toBe(1);

    clock.advance(DEFAULT_POINTER_TTL_MS + 1); // the pointer must be cold for anyone to ask
    inner.fail(new ContentCryptoError('ACCOUNT_KEY_DESTROYED', 'destroyed'));
    await expect(cache.currentGeneration(ACCOUNT)).rejects.toThrow(ContentCryptoError);
    expect(cache.stats().entries).toBe(0);
  });
});

describe('grace applies to the DEK and NOT to the generation pointer', () => {
  /**
   * §11.5 and Q-G, and the reason the module says so in its header: under record keys the
   * generation labels the WRAP. A stale pointer on the write path means a new wrap written at
   * a generation the rotation walk has already passed — the walk reports it drained,
   * `planDrain` erases the wrap, and that holder's access to that record is gone, silently
   * and permanently. So a product degrades to READ-ONLY, not to dark.
   */
  async function outage(): Promise<{
    clock: ReturnType<typeof clockFrom>;
    inner: Stub;
    cache: CachedDekSource;
    seen: GraceInfo[];
  }> {
    const clock = clockFrom();
    const inner = stubSource();
    const seen: GraceInfo[] = [];
    const cache = newCache(inner, { now: clock.now }, seen);

    await cache.getCurrentDek(ACCOUNT); // pointer and DEK, both fresh
    clock.advance(DEFAULT_DEK_TTL_MS - 5_000);
    await cache.currentGeneration(ACCOUNT); // pointer refreshed on its own, shorter clock
    clock.advance(5_001); // the DEK is now 1ms expired; the pointer has ~55s to live

    inner.fail(new Error('Accounts is unreachable'));
    return { clock, inner, cache, seen };
  }

  it('lets a write take a graced DEK while the pointer is still within its TTL', async () => {
    const { cache, seen } = await outage();
    const handle = await cache.getCurrentDek(ACCOUNT);
    expect(handle.generation).toBe(1);
    expect(seen).toHaveLength(1);
    expect(seen[0].ageMs).toBe(1);
  });

  it('refuses the write once the pointer has expired, while the read is still served', async () => {
    const { clock, cache, seen } = await outage();
    clock.advance(DEFAULT_POINTER_TTL_MS); // past the pointer, well inside the DEK's grace

    const refused = await refusedWith(cache.getCurrentDek(ACCOUNT));
    expect(refused.code).toBe<ContentCryptoCode>('KEY_SOURCE_UNAVAILABLE');
    expect(refused.details).toEqual({ accountId: ACCOUNT });
    expect(seen).toHaveLength(0); // nothing was served, so nothing was logged as served

    // READ-ONLY, not dark. This is the half of the trade that survives the outage.
    const read = await cache.getDek(ACCOUNT, 1);
    expect(read.generation).toBe(1);
    expect(seen).toHaveLength(1);
  });

  it('never graces the pointer itself, at any age', async () => {
    const { clock, cache, seen } = await outage();
    clock.advance(DEFAULT_POINTER_TTL_MS);

    const refused = await refusedWith(cache.currentGeneration(ACCOUNT));
    expect(refused.code).toBe<ContentCryptoCode>('KEY_SOURCE_UNAVAILABLE');
    expect(seen).toHaveLength(0);
    // There is no dial to relax this, deliberately: the failure it would permit is invisible
    // and irreversible.
  });

  it('says in the refusal that reads still work and a new wrap must not be written', async () => {
    const { clock, cache } = await outage();
    clock.advance(DEFAULT_POINTER_TTL_MS);
    const refused = await refusedWith(cache.getCurrentDek(ACCOUNT));
    expect(refused.message).toContain('generation pointer has expired');
    expect(refused.message).toContain('read');
  });
});

describe('the classifier', () => {
  async function graceInfoFor(err: unknown): Promise<GraceInfo> {
    const clock = clockFrom();
    const inner = stubSource();
    const seen: GraceInfo[] = [];
    const cache = newCache(inner, { now: clock.now }, seen);
    await cache.getDek(ACCOUNT, 1);
    clock.advance(DEFAULT_DEK_TTL_MS + 1);
    inner.fail(err);
    await cache.getDek(ACCOUNT, 1);
    expect(seen).toHaveLength(1);
    return seen[0];
  }

  const withName = (name: string): Error => Object.assign(new Error('redacted'), { name });
  const withCause = (code: string): Error =>
    Object.assign(new TypeError('fetch failed'), { cause: { code } });

  it('maps one of ours with a 5xx status to http-5xx, carrying the status and the code', async () => {
    const info = await graceInfoFor(new ContentCryptoError('KEY_SOURCE_UNAVAILABLE', 'down'));
    expect(info.reason).toBe<GraceReason>('http-5xx');
    expect(info.status).toBe(503);
    expect(info.code).toBe<ContentCryptoCode>('KEY_SOURCE_UNAVAILABLE');
  });

  it('maps one of ours with a 4xx status to http-4xx', async () => {
    const info = await graceInfoFor(new ContentCryptoError('NO_WRAP_FOR_ACCOUNT', 'no wrap'));
    expect(info.reason).toBe<GraceReason>('http-4xx');
    expect(info.status).toBe(403);
  });

  it.each(['AbortError', 'TimeoutError'])('maps %s to timeout', async (name) => {
    const info = await graceInfoFor(withName(name));
    expect(info.reason).toBe<GraceReason>('timeout');
  });

  it.each(['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT'])(
    'maps a cause of %s to timeout',
    async (code) => {
      const info = await graceInfoFor(withCause(code));
      expect(info.reason).toBe<GraceReason>('timeout');
    },
  );

  it.each([
    'ECONNREFUSED',
    'ECONNRESET',
    'ENOTFOUND',
    'EAI_AGAIN',
    'EPIPE',
    'EHOSTUNREACH',
    'UND_ERR_SOCKET',
  ])('maps a cause of %s to network', async (code) => {
    const info = await graceInfoFor(withCause(code));
    expect(info.reason).toBe<GraceReason>('network');
  });

  it('reads a code off the error itself as well as off its cause', async () => {
    const info = await graceInfoFor(Object.assign(new Error('redacted'), { code: 'ENOTFOUND' }));
    expect(info.reason).toBe<GraceReason>('network');
  });

  it('maps a SyntaxError to malformed-response — THE case, classified so it can be discarded', async () => {
    // `Response.json()` on a body a proxy truncated throws a SyntaxError quoting the first
    // ten characters of the body, and on this route the body is the key. Classifying it
    // precisely is what lets the text be thrown away rather than forwarded.
    const info = await graceInfoFor(new SyntaxError('Unexpected token, "wqVzwJSsrU"... is not valid JSON'));
    expect(info.reason).toBe<GraceReason>('malformed-response');
  });

  it('maps a SyntaxError from another realm too, which instanceof would miss', async () => {
    const foreign = Object.assign(new Error('Unexpected token'), { name: 'SyntaxError' });
    const info = await graceInfoFor(foreign);
    expect(info.reason).toBe<GraceReason>('malformed-response');
  });

  it('maps anything else to unknown, and still serves — an outage in an unseen shape is an outage', async () => {
    const info = await graceInfoFor(new Error('something nobody has seen before'));
    expect(info.reason).toBe<GraceReason>('unknown');
  });

  it('OMITS status and code rather than setting them to undefined', async () => {
    const info = await graceInfoFor(new Error('plain'));
    // Rule 3 of `assertNoSecrets` rejects an explicit `undefined` deliberately, and `compact`
    // is what makes omission the easy path. `toEqual` treats the two as the same, so this
    // asks the object which keys it actually has.
    expect(Object.prototype.hasOwnProperty.call(info, 'status')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(info, 'code')).toBe(false);
    expect(Object.keys(info).sort()).toEqual(['accountId', 'ageMs', 'generation', 'productId', 'reason']);
  });
});

describe('the leak boundary', () => {
  it('never copies an upstream message into GraceInfo — the 200 body of the key route IS the DEK', async () => {
    // The test this file exists for. Three ordinary steps: the route returns the plaintext
    // DEK, a gateway wraps or truncates it, the client puts the body in the error. If
    // `GraceReason` were the upstream's text, that key would be in Cloud Logging for ever.
    const dekOffTheWire = Buffer.alloc(KEY_BYTES, 0x5a).toString('base64');
    const clock = clockFrom();
    const inner = stubSource();
    const seen: GraceInfo[] = [];
    const cache = newCache(inner, { now: clock.now }, seen);

    await cache.getDek(ACCOUNT, 1);
    clock.advance(DEFAULT_DEK_TTL_MS + 1);
    inner.fail(new Error(`502 Bad Gateway: {"dek":"${dekOffTheWire}"}`));

    await cache.getDek(ACCOUNT, 1);

    expect(seen[0].reason).toBe<GraceReason>('unknown'); // classified, not copied
    expect(JSON.stringify(seen[0])).not.toContain(dekOffTheWire);
    assertNoKeyMaterial(seen[0], 'graceInfo');
  });

  it('keeps the key out of the refusal it raises, too', async () => {
    const dekOffTheWire = Buffer.alloc(KEY_BYTES, 0x5a).toString('base64');
    const inner = stubSource();
    const cache = newCache(inner);
    inner.fail(new SyntaxError(`Unexpected token 'w', "${dekOffTheWire.slice(0, 10)}"... is not valid JSON`));

    const refused = await refusedWith(cache.getDek(ACCOUNT, 1));
    expect(refused.message).not.toContain(dekOffTheWire.slice(0, 10));
    // The message interpolates nothing but the accountId, the generation and our own label.
    expect(refused.message).toContain('malformed-response');
    assertNoKeyMaterial(refused.toJSON(), 'refusal');
  });

  it('raises an error with no cause, because a cause chain is how a body reaches a log', async () => {
    // Every structured logger and every error serialiser walks `cause`. `ContentCryptoError`
    // has none, and the cache is the one place in the package with an upstream error in hand
    // and an obvious-looking reason to keep it.
    const inner = stubSource();
    const cache = newCache(inner);
    inner.fail(Object.assign(new Error('secretive'), { cause: { code: 'ECONNREFUSED' } }));

    const refused = await refusedWith(cache.getDek(ACCOUNT, 1));
    expect('cause' in refused).toBe(false);
    expect(Object.keys(refused.toJSON()).sort()).toEqual(['code', 'details', 'message']);
  });

  it('will not let an upstream message be typed as a GraceReason', () => {
    const upstream = new Error('502 Bad Gateway: {"dek":"…"}');
    // @ts-expect-error — a GraceReason is a CLOSED union of six labels this package wrote.
    // v1 typed it `string`, documented as "the upstream failure's message", and wired it
    // straight into logger.warn in three consumer snippets. This line is the regression test
    // for that, and it fails at compile time rather than in production.
    const reason: GraceReason = upstream.message;
    expect(typeof reason).toBe('string');
  });

  it('describes an outage with six labels and no more', () => {
    const every: readonly GraceReason[] = [
      'network',
      'timeout',
      'http-5xx',
      'http-4xx',
      'malformed-response',
      'unknown',
    ];
    expect(new Set(every).size).toBe(6);
    // @ts-expect-error — nothing outside the union, however plausible it looks.
    const invented: GraceReason = 'upstream-said';
    expect(invented).toBe('upstream-said');
  });
});
