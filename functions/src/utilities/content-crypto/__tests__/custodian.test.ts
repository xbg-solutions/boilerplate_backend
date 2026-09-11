/**
 * `custodian.ts` — types only, and that is the thing worth asserting.
 *
 * There is no implementation of a `DekSource` in this package and there is not meant to be one.
 * The tests below are therefore mostly type-level: they run at compile time, and the runtime
 * assertions exist so the file is executed at all and so the *absence* of a value export is
 * observed rather than assumed.
 */

import * as custodian from '../custodian';
import type {
  CachedDekSource,
  CacheStats,
  ContentKeyStatus,
  DekHandle,
  DekSource,
  ContentKeyState,
  OpenRotation,
  RevokedCause,
  RotationProgress,
} from '../custodian';
import { KEY_BYTES, dekFromBytes } from '../secret';
import type { AccountDek } from '../secret';

/** `true` only when X and Y are the same type, invariantly — not merely assignable. */
type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2
  ? true
  : false;

describe('the custodian module ships no implementation', () => {
  it('exports no runtime value at all — decision 1, observed rather than claimed', () => {
    // A local custodian is throwaway code, and the Phase-C swap to Accounts' HTTP client is a
    // change to one construction site. If this list is ever non-empty, something grew an
    // implementation in the file that was meant to hold only the shape of the conversation.
    expect(Object.keys(custodian)).toEqual([]);
  });
});

describe('DekHandle pairs the key with its generation', () => {
  it('carries both, so the two cannot be fetched separately and disagree', () => {
    // Asking for the DEK and asking for the generation as two calls is exactly how a value gets
    // labelled with a generation it was not encrypted under. One object, one answer.
    const key: AccountDek = dekFromBytes(Buffer.alloc(KEY_BYTES, 7), 'collab/acc_1@3');
    const handle: DekHandle = { generation: 3, key };
    expect(handle.generation).toBe(3);
    expect(handle.key.kind).toBe('dek');

    const keysAreTwo: Equal<keyof DekHandle, 'generation' | 'key'> = true;
    expect(keysAreTwo).toBe(true);
  });

  it('will not take a record key where an account DEK belongs', () => {
    const recordKeyShaped = { kind: 'record-key' } as const;
    // @ts-expect-error — a record key cannot wrap a record key, and the brand says so
    const bad: DekHandle = { generation: 1, key: recordKeyShaped };
    expect(bad.generation).toBe(1);
  });
});

describe('CachedDekSource is the only thing the façade accepts', () => {
  it('cannot be produced by hand: the brand is a unique symbol only the factory can supply', () => {
    const bare: DekSource = {
      getCurrentDek: () => Promise.reject(new Error('not implemented')),
      getDek: () => Promise.reject(new Error('not implemented')),
      currentGeneration: () => Promise.reject(new Error('not implemented')),
      evict: () => undefined,
    };
    const stats: CacheStats = {
      entries: 0,
      hits: 0,
      misses: 0,
      graceServes: 0,
      evictions: 0,
    };
    // The TTL is the revocation window and the grace window. A façade handed a bare `DekSource`
    // would silently opt out of both, and the failure is invisible: everything works, revocations
    // just never arrive.
    // @ts-expect-error — the phantom brand is missing, and nothing outside the factory can add it
    const forged: CachedDekSource = { ...bare, stats: () => stats, clear: () => undefined };
    expect(typeof forged.stats).toBe('function');
    expect(Object.keys(stats).sort()).toEqual([
      'entries',
      'evictions',
      'graceServes',
      'hits',
      'misses',
    ]);
  });
});

describe('the wire status types Accounts serialises in Phase B', () => {
  it('derives ContentKeyState at the boundary and stores none of it', () => {
    const statuses: readonly ContentKeyState[] = ['active', 'revoked', 'destroyed'];
    expect(statuses).toHaveLength(3);
    const causes: readonly RevokedCause[] = [
      'sysadmin',
      'account-deactivated',
      'client-request',
      'incident',
    ];
    expect(causes).toHaveLength(4);
  });

  it('gives RotationProgress exactly three counters', () => {
    // `valuesRewritten` and `objectsRewritten` are DELETED. A rotation rewraps and touches no
    // content and lists no bucket, so both were zero for ever — and a status field that is always
    // zero teaches an operator to distrust the whole page. Asserted because a deletion nobody
    // asserts comes back.
    const threeCounters: Equal<
      keyof RotationProgress,
      'recordsRewrapped' | 'recordsTotal' | 'conflicted'
    > = true;
    expect(threeCounters).toBe(true);

    const progress: RotationProgress = { recordsRewrapped: 0, recordsTotal: 0, conflicted: 0 };
    // @ts-expect-error — a rotation rewrites no values, so there is no such counter
    const withDeleted: RotationProgress = { ...progress, valuesRewritten: 1 };
    expect(Object.keys(withDeleted)).toContain('recordsRewrapped');
  });

  it('lets an open rotation carry a partial progress, because a job reports as it goes', () => {
    const open: OpenRotation = {
      generation: 4,
      startedAt: '2026-09-10T04:05:06.007Z',
      finishedAt: null,
      error: null,
      progress: { recordsRewrapped: 12 },
    };
    expect(open.progress.recordsTotal).toBeUndefined();
    expect(open.finishedAt).toBeNull();
  });

  it('types every timestamp on the wire as an ISO string or null, never a store timestamp', () => {
    const status: ContentKeyStatus = {
      accountId: 'acc_1',
      productId: 'collab',
      status: 'active',
      currentGeneration: 3,
      createdAt: '2026-09-10T04:05:06.007Z',
      revokedAt: null,
      revokedCause: null,
      destroyedAt: null,
      destroyedThrough: null,
      rotation: null,
    };
    // Serialised timestamps cross as ISO-8601 strings. A store's own timestamp becomes
    // `{_seconds,…}` over JSON, which `new Date()` cannot parse, and every date renders as an
    // em-dash without a single error being raised anywhere.
    expect(new Date(status.createdAt as string).toISOString()).toBe(status.createdAt);
    const isoOrNull: Equal<ContentKeyStatus['revokedAt'], string | null> = true;
    expect(isoOrNull).toBe(true);
  });
});
