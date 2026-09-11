/**
 * `key-store.ts` — the port. Small and structural, because the port has almost no behaviour:
 * two sentinels, a refusal pair, and one assertion that holds every invariant a consumer is
 * allowed to rely on without reading a planner.
 *
 * The in-memory `KeyStore` lives here rather than in a helper file, because
 * `scripts/check-mirror.js` assertion (2) closes `src/` to the 23-module manifest and
 * `src/__tests__/` to one suite per module plus the cross-cutting ones — a helper file is
 * not a thing this tree can hold. When `testing.ts` lands (§12.6), `memoryKeyStore` moves there
 * whole and both suites import it; nothing about it is written for this file in particular.
 *
 * It exists at all because it is **the executable statement of what a consumer's `apply` must
 * do** (§12.2), and a consumer's own adapter test can diff against it. It records the wrap
 * side-effect, which `KeyStore` deliberately cannot express — `GenerationRow` says `hasWrap`
 * and never `wrappedDek`, and that is the checkable form of "this package never sees wrapped
 * key material".
 */

import { ContentCryptoError, isContentCryptoError } from '../errors';
import {
  assertKeyPatch,
  isRefusal,
  KEY_PATCH_DELETE,
  KEY_PATCH_SERVER_TIME,
  refusal,
} from '../key-store';
import type {
  GenerationRow,
  KeyAudit,
  KeyPatch,
  KeyPatchValue,
  KeyRow,
  KeyStore,
} from '../key-store';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const AT = '2026-09-11T00:00:00.000Z';

const AUDIT: KeyAudit = {
  action: 'revoke',
  accountId: 'acc_1',
  productId: 'collab',
  generation: 1,
  statusBefore: 'active',
  statusAfter: 'revoked',
  cause: 'sysadmin',
  at: AT,
};

function patch(over: Partial<KeyPatch> = {}): KeyPatch {
  const key = over.key ?? { revokedAt: AT, revokedCause: 'sysadmin' };
  const generations = over.generations ?? [];
  const changed = Object.keys(key).length + generations.length;
  const mint = over.mint ?? null;
  return {
    key,
    generations,
    mint,
    createIfMissing: false,
    evict: changed > 0 || mint !== null,
    audit: AUDIT,
    changed,
    ...over,
  };
}

function keyRow(over: Partial<KeyRow> = {}): KeyRow {
  return {
    accountId: 'acc_1',
    productId: 'collab',
    currentGeneration: 1,
    createdAt: AT,
    revokedAt: null,
    revokedCause: null,
    destroyedAt: null,
    destroyedThrough: null,
    rotation: null,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// The in-memory store — §12.2, in order
// ---------------------------------------------------------------------------

/** What this store uses for its own server timestamp, so a translation is observable. */
const STORE_SERVER_TIME = '<server-time>';

interface MemoryKeyStore extends KeyStore {
  seed(accountId: string, row: Partial<KeyRow>, generations?: readonly Partial<GenerationRow>[]): void;
  readonly applied: readonly { accountId: string; patch: KeyPatch }[];
  /** The order `apply` did its work in, flattened: `['mint', 'generations', 'key']`. */
  readonly steps: readonly string[];
  wraps(accountId: string): readonly number[];
  raw(accountId: string): Record<string, unknown> | null;
  rawGeneration(accountId: string, n: number): Record<string, unknown> | null;
}

function memoryKeyStore(productId: string): MemoryKeyStore {
  const rows = new Map<string, Record<string, unknown>>();
  const gens = new Map<string, Record<string, unknown>>();
  const wrapped = new Map<string, Set<number>>();
  const applied: { accountId: string; patch: KeyPatch }[] = [];
  const steps: string[] = [];

  const gk = (accountId: string, n: number) => `${accountId}/${n}`;
  const wrapsOf = (accountId: string) => {
    let set = wrapped.get(accountId);
    if (!set) {
      set = new Set<number>();
      wrapped.set(accountId, set);
    }
    return set;
  };

  /** Step 4: the sentinels, translated. `undefined` means "delete this field". */
  const translate = (v: KeyPatchValue): unknown => {
    if (v !== null && typeof v === 'object' && 'op' in v) {
      return v.op === 'delete' ? undefined : STORE_SERVER_TIME;
    }
    return v;
  };

  /** Dotted keys are FIELD PATHS here, which is the half of the trap `createIfMissing` exists
   *  to let `apply` choose about: under a create they would be literal field names. */
  const setPath = (doc: Record<string, unknown>, path: string, value: KeyPatchValue): void => {
    const segments = path.split('.');
    let node = doc;
    for (let i = 0; i < segments.length - 1; i += 1) {
      const seg = segments[i];
      const next = node[seg];
      if (next === null || typeof next !== 'object') node[seg] = {};
      node = node[seg] as Record<string, unknown>;
    }
    const last = segments[segments.length - 1];
    const translated = translate(value);
    if (translated === undefined) delete node[last];
    else node[last] = translated;
  };

  return {
    seed(accountId, row, generations = []) {
      rows.set(accountId, { ...keyRow({ accountId, productId, ...row }) });
      for (const g of generations) {
        const n = g.n ?? 1;
        gens.set(gk(accountId, n), {
          n,
          kmsKeyVersion: null,
          createdAt: AT,
          retiredAt: null,
          drainedAt: null,
          destroyedAt: null,
          ...g,
        });
        if (g.hasWrap !== false) wrapsOf(accountId).add(n);
        else wrapsOf(accountId).delete(n);
      }
    },

    async readKey(accountId) {
      const row = rows.get(accountId);
      return row ? ({ ...row } as unknown as KeyRow) : null;
    },

    async readGeneration(accountId, n) {
      const g = gens.get(gk(accountId, n));
      return g ? ({ ...g, hasWrap: wrapsOf(accountId).has(n) } as unknown as GenerationRow) : null;
    },

    async listGenerations(accountId) {
      const out: GenerationRow[] = [];
      for (const [k, g] of gens) {
        if (!k.startsWith(`${accountId}/`)) continue;
        out.push({ ...g, hasWrap: wrapsOf(accountId).has(g.n as number) } as unknown as GenerationRow);
      }
      return out.sort((a, b) => a.n - b.n);
    },

    async apply(accountId, p) {
      // A consumer may re-check a patch that arrived over a queue, where the planner's
      // guarantee no longer travels with the value.
      assertKeyPatch(p);
      applied.push({ accountId, patch: p });

      // (1) MINT FIRST, always. The mint is the consumer's because the KEK is; here it is a
      // set entry, which is exactly as much as `hasWrap` can observe.
      if (p.mint !== null) {
        steps.push('mint');
        const n = p.mint.generation;
        if (!gens.has(gk(accountId, n))) {
          gens.set(gk(accountId, n), {
            n,
            kmsKeyVersion: 'v1',
            createdAt: STORE_SERVER_TIME,
            retiredAt: null,
            drainedAt: null,
            destroyedAt: null,
          });
        }
        wrapsOf(accountId).add(n);
      }

      // (5) This store is not atomic, so the generation patches go FIRST: a partial failure
      // must leave the row saying LESS has happened than has. A generation erased under a row
      // not yet tombstoned is recoverable by re-running; a row tombstoned over live wraps is a
      // destroy that lies.
      if (p.generations.length > 0) {
        steps.push('generations');
        for (const g of p.generations) {
          const doc = gens.get(gk(accountId, g.n)) ?? { n: g.n };
          for (const [path, value] of Object.entries(g.set)) setPath(doc, path, value);
          gens.set(gk(accountId, g.n), doc);
          // (3) …then erase the wrap. Explicit, never inferred from `destroyedAt`.
          if (g.eraseWrap) wrapsOf(accountId).delete(g.n);
        }
      }

      // (2) The key row.
      if (Object.keys(p.key).length > 0) {
        steps.push('key');
        let doc = rows.get(accountId);
        if (doc === undefined) {
          if (!p.createIfMissing) {
            throw new ContentCryptoError(
              'KEY_STORE_CONFLICT',
              'the key row does not exist and this patch does not create it',
            );
          }
          doc = {};
          rows.set(accountId, doc);
        }
        for (const [path, value] of Object.entries(p.key)) setPath(doc, path, value);
      }
    },

    applied,
    steps,
    wraps: (accountId) => [...wrapsOf(accountId)].sort((a, b) => a - b),
    raw: (accountId) => rows.get(accountId) ?? null,
    rawGeneration: (accountId, n) => gens.get(gk(accountId, n)) ?? null,
  };
}

// ---------------------------------------------------------------------------

describe('the sentinels', () => {
  it('are frozen plain objects, so a mutated one cannot stop comparing equal', () => {
    expect(Object.isFrozen(KEY_PATCH_DELETE)).toBe(true);
    expect(Object.isFrozen(KEY_PATCH_SERVER_TIME)).toBe(true);
    expect(KEY_PATCH_DELETE).toEqual({ op: 'delete' });
    expect(KEY_PATCH_SERVER_TIME).toEqual({ op: 'serverTime' });
  });

  it('survive JSON unchanged, which is what "plain data" has to mean', () => {
    // v1 injected a `deleteField: () => FieldValue.delete()` closure. A patch containing one
    // is neither assertable nor loggable, and the thing a consumer wrote to its store was
    // then something no test ever saw.
    for (const sentinel of [KEY_PATCH_DELETE, KEY_PATCH_SERVER_TIME]) {
      expect(JSON.parse(JSON.stringify(sentinel))).toEqual(sentinel);
    }
  });

  it('are recognised by shape rather than by identity, so a patch may cross a queue', () => {
    const shipped = JSON.parse(JSON.stringify(patch({ key: { rotation: KEY_PATCH_DELETE } })));
    expect(shipped.key.rotation).not.toBe(KEY_PATCH_DELETE);
    expect(() => assertKeyPatch(shipped)).not.toThrow();
  });
});

describe('refusal / isRefusal', () => {
  it('round-trips a code and a message', () => {
    const r = refusal('ACCOUNT_KEY_NOT_REVOKED', 'revoke it first');
    expect(isRefusal(r)).toBe(true);
    expect(r.code).toBe('ACCOUNT_KEY_NOT_REVOKED');
    expect(r.message).toBe('revoke it first');
    expect(Object.isFrozen(r)).toBe(true);
  });

  it('is structural, so a refusal that has been through JSON is still one', () => {
    expect(isRefusal(JSON.parse(JSON.stringify(refusal('ROTATION_IN_PROGRESS', 'busy'))))).toBe(true);
  });

  it('says no to everything that is not a refusal, a KeyPatch included', () => {
    for (const v of [null, undefined, 0, '', 'refused', {}, { refused: false }, [], patch()]) {
      expect(isRefusal(v)).toBe(false);
    }
  });

  it('demands a message, because an operator page renders it and "409" is not an answer', () => {
    expect(() => refusal('ACCOUNT_KEY_REVOKED', '')).toThrow(/needs a message/);
  });
});

describe('assertKeyPatch', () => {
  it('accepts a well-formed patch', () => {
    expect(() => assertKeyPatch(patch())).not.toThrow();
  });

  describe('the dotted-key / createIfMissing invariant', () => {
    it('refuses a create that writes a dotted field path', () => {
      // Under a create the store writes a literal map, and `{ 'rotation.error': x }` then
      // becomes a TOP-LEVEL field whose name contains a dot. It half-works for ever.
      expect(() =>
        assertKeyPatch(
          patch({ key: { accountId: 'acc_1', 'rotation.error': 'X' }, createIfMissing: true }),
        ),
      ).toThrow(/createIfMissing is true and the patch writes the dotted field path/);
    });

    it('accepts a dotted field path on a patch that does not create', () => {
      expect(() => assertKeyPatch(patch({ key: { 'rotation.error': 'X' } }))).not.toThrow();
    });

    it('is a one-way implication: an undotted patch need not create', () => {
      // `planRestore` writes `revokedAt`/`revokedCause`, neither dotted, onto a row that must
      // already exist. Asserting the biconditional would refuse it — which is why the spec's
      // "TRUE exactly when no key is a dotted field path" is not what this asserts.
      expect(() =>
        assertKeyPatch(patch({ key: { revokedAt: null, revokedCause: null }, createIfMissing: false })),
      ).not.toThrow();
    });
  });

  it('refuses a `changed` that disagrees with what the patch carries', () => {
    expect(() => assertKeyPatch(patch({ changed: 7 }))).toThrow(/KeyPatch.changed is 7/);
  });

  it('refuses `changed: 0` with something to write', () => {
    expect(() => assertKeyPatch({ ...patch(), changed: 0, evict: false })).toThrow(/KeyPatch.changed is 0/);
  });

  it('holds footgun 14 as arithmetic: evict === (changed > 0 || mint !== null)', () => {
    expect(() => assertKeyPatch(patch({ evict: false }))).toThrow(/must evict the account's cached DEKs/);
    // A pure mint writes nothing to the key row but still evicts.
    expect(() =>
      assertKeyPatch(patch({ key: {}, mint: { generation: 2 }, changed: 0, evict: true })),
    ).not.toThrow();
    expect(() =>
      assertKeyPatch(patch({ key: {}, mint: { generation: 2 }, changed: 0, evict: false })),
    ).toThrow(/must evict/);
  });

  it('refuses a value that is not plain JSON — which is what a closure creeping back in fails', () => {
    const withClosure = patch({ key: { revokedAt: (() => AT) as unknown as KeyPatchValue } });
    expect(() => assertKeyPatch(withClosure)).toThrow(/is not a KeyPatchValue/);
  });

  it('refuses a look-alike sentinel carrying an extra property', () => {
    const sneaky = { op: 'delete', apply: () => undefined } as unknown as KeyPatchValue;
    expect(() => assertKeyPatch(patch({ key: { rotation: sneaky } }))).toThrow(/is not a KeyPatchValue/);
  });

  it('refuses a number that does not survive JSON', () => {
    expect(() => assertKeyPatch(patch({ key: { currentGeneration: NaN } }))).toThrow(/does not survive JSON/);
  });

  it('refuses an empty or whitespace-padded field path', () => {
    expect(() => assertKeyPatch(patch({ key: { '': AT } }))).toThrow(/empty field path/);
    expect(() => assertKeyPatch(patch({ key: { 'rotation..error': AT } }))).toThrow(/empty segment/);
    expect(() => assertKeyPatch(patch({ key: { ' revokedAt': AT } }))).toThrow(/whitespace/);
  });

  it('refuses the same generation patched twice in one patch', () => {
    expect(() =>
      assertKeyPatch(
        patch({
          key: {},
          generations: [
            { n: 1, set: { drainedAt: AT }, eraseWrap: true },
            { n: 1, set: { retiredAt: AT }, eraseWrap: false },
          ],
        }),
      ),
    ).toThrow(/generation 1 is patched twice/);
  });

  it('refuses an audit that is not one of the ten lifecycle actions', () => {
    const bad = patch({ audit: { ...AUDIT, action: 'shred' as KeyAudit['action'] } });
    expect(() => assertKeyPatch(bad)).toThrow(/is not one of the ten lifecycle actions/);
  });

  it('refuses key material anywhere in the patch, including in the audit', () => {
    // The standing guard, and it is `assertNoKeyMaterial` rather than `assertNoSecrets`: a
    // patch's keys are FIELD PATHS, so the closed detail-key set is the wrong question here.
    const dek = 'a'.repeat(43);
    expect(() => assertKeyPatch(patch({ key: { revokedAt: dek } }))).toThrow(/assertNoKeyMaterial/);
    expect(() =>
      assertKeyPatch(patch({ audit: { ...AUDIT, accountId: 'ab'.repeat(32) } })),
    ).toThrow(/assertNoKeyMaterial/);
  });

  it('reports every refusal as VALIDATION_ERROR, which is a caller mistake and not a 409', () => {
    try {
      assertKeyPatch(patch({ changed: 99 }));
      throw new Error('unreachable');
    } catch (err) {
      expect(isContentCryptoError(err, 'VALIDATION_ERROR')).toBe(true);
    }
  });
});

describe('KeyRow at the boundary', () => {
  it('carries ISO-8601 strings, never a Timestamp class', () => {
    const row = keyRow({ revokedAt: AT });
    expect(typeof row.revokedAt).toBe('string');
    expect(new Date(row.revokedAt as string).toISOString()).toBe(AT);
  });

  it('does not accept a Date where a timestamp goes', () => {
    // @ts-expect-error — timestamps cross this port as ISO strings; a Date here is the
    // `StoreAdapters.toDate` pair coming back, and with it two Timestamp classes in one process.
    keyRow({ createdAt: new Date() });
  });

  it('has no `status` field to drift from the timestamps', () => {
    expect(Object.keys(keyRow())).not.toContain('status');
  });
});

describe('the in-memory store applies a patch in the §12.2 order', () => {
  it('mints first, then the generations, then the key row', async () => {
    const store = memoryKeyStore('collab');
    store.seed('acc_1', { currentGeneration: 1 }, [{ n: 1, hasWrap: true }]);

    await store.apply('acc_1', {
      key: { currentGeneration: 2 },
      generations: [{ n: 1, set: { retiredAt: AT }, eraseWrap: false }],
      mint: { generation: 2 },
      createIfMissing: false,
      evict: true,
      audit: { ...AUDIT, action: 'beginRotation', generation: 2 },
      changed: 2,
    });

    expect(store.steps).toEqual(['mint', 'generations', 'key']);
  });

  it('writes nothing at all for a `changed: 0` patch', async () => {
    const store = memoryKeyStore('collab');
    store.seed('acc_1', {}, [{ n: 1, hasWrap: true }]);
    const before = JSON.stringify(store.raw('acc_1'));

    await store.apply('acc_1', patch({ key: {}, changed: 0, evict: false }));

    expect(store.steps).toEqual([]);
    expect(JSON.stringify(store.raw('acc_1'))).toBe(before);
    expect(store.applied).toHaveLength(1);
  });

  it('translates both sentinels', async () => {
    const store = memoryKeyStore('collab');
    store.seed('acc_1', { rotation: null });

    await store.apply(
      'acc_1',
      patch({ key: { createdAt: KEY_PATCH_SERVER_TIME, revokedCause: KEY_PATCH_DELETE } }),
    );

    const row = store.raw('acc_1') as Record<string, unknown>;
    expect(row.createdAt).toBe('<server-time>');
    expect('revokedCause' in row).toBe(false);
  });

  it('applies a dotted key as a field path, merging rather than clobbering', async () => {
    const store = memoryKeyStore('collab');
    store.seed('acc_1', { rotation: { generation: 2, startedAt: AT, finishedAt: null, error: null, progress: {} } });

    await store.apply('acc_1', patch({ key: { 'rotation.error': 'ROTATION_TIMEOUT' } }));

    const row = store.raw('acc_1') as { rotation: Record<string, unknown> };
    expect(row.rotation.error).toBe('ROTATION_TIMEOUT');
    // The one the merge exists for: a whole-map write would have lost it.
    expect(row.rotation.startedAt).toBe(AT);
  });

  it('erases a wrap only where `eraseWrap` says so, so a re-applied destroy is a no-op', async () => {
    const store = memoryKeyStore('collab');
    store.seed('acc_1', {}, [
      { n: 1, hasWrap: true },
      { n: 2, hasWrap: false },
    ]);
    expect(store.wraps('acc_1')).toEqual([1]);

    await store.apply(
      'acc_1',
      patch({
        key: {},
        generations: [
          { n: 1, set: { drainedAt: AT }, eraseWrap: true },
          { n: 2, set: { drainedAt: AT }, eraseWrap: false },
        ],
      }),
    );

    expect(store.wraps('acc_1')).toEqual([]);
    // Re-applying the same shape against the new state erases nothing, because a planner
    // reading these rows would now emit `eraseWrap: false` for both.
    const rows = await store.listGenerations('acc_1');
    expect(rows.map((g) => g.hasWrap)).toEqual([false, false]);
  });

  it('refuses to write a key row that does not exist unless the patch creates it', async () => {
    const store = memoryKeyStore('collab');
    await expect(store.apply('acc_missing', patch())).rejects.toThrow(/does not exist/);

    await store.apply(
      'acc_missing',
      patch({ key: { accountId: 'acc_missing', productId: 'collab' }, createIfMissing: true }),
    );
    expect(await store.readKey('acc_missing')).not.toBeNull();
  });

  it('never hands back wrapped key material — only whether a wrap is present', async () => {
    const store = memoryKeyStore('collab');
    store.seed('acc_1', {}, [{ n: 1, hasWrap: true }]);

    const g = (await store.readGeneration('acc_1', 1)) as GenerationRow;
    expect(g.hasWrap).toBe(true);
    expect(Object.keys(g)).not.toContain('wrappedDek');
    expect(JSON.stringify(g)).not.toMatch(/wrap(ped)?Dek/i);
  });
});
