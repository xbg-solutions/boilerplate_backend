/**
 * `testing.ts` — the fixtures, and the guard that keeps them out of a deployed function.
 *
 * The rule this suite lives under, and the reason it is shaped the way it is: **it may not read or
 * write `process.env`.** `check-mirror.js` assertion (12) reserves `K_SERVICE` and
 * `FUNCTIONS_EMULATOR` to `testing.ts` itself, and §16.3 rule 5 forbids a test that depends on
 * ambient state, because a suite that mutates a global is a suite that fails differently under
 * `--runInBand`. So the guard is proved through `isDeployedFunction(env)` and
 * `assertNotDeployedFunction(env)` against plain bags — which is exactly the shape
 * `resolveGraceMs(env)` already has, and the reason the predicate was split out at all.
 *
 * Every claim about a fixture is proved with a NEGATIVE CONTROL beside it. A leak check that
 * cannot be shown to fire proves only that it is broken.
 */

import { inspect } from 'node:util';

import {
  assertNotDeployedFunction, checkTraversal, checkWrapCommit, expectNoKeyMaterial, fixedDekSource,
  isDeployedFunction, memoryContentKeyStore, registerKeyMaterialFixture,
} from '../testing';
import type { WrapCommitHarness } from '../testing';
import type { WrapCommitRequest, WrapCommitter, WrapReceipt } from '../content-crypto';
import { ContentCryptoError, isContentCryptoError } from '../errors';
import type { ContentKeyPatch } from '../key-store';
import { KEY_PATCH_DELETE, KEY_PATCH_SERVER_TIME } from '../key-store';
import { defineRegistry } from '../registry';
import { aggregateRecordRef, resolveScope } from '../key-scope';
import type { ContentKeyScope } from '../key-scope';
import { mintRecordKey, parseKeyWraps, unwrapRecordKey, wrapRecordKey } from '../record-key';
import type { KeyWraps, RecordRef, WrapEntry } from '../record-key';
import type { ForEachRecord, RecordHead } from '../walk';

const PRODUCT = 'collab';

/** Distinct fixed bytes. `0x11…` and `0x22…` so a failure message says which one leaked. */
const KEY_A = Buffer.alloc(32, 0x11);
const KEY_B = Buffer.alloc(32, 0x22);

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    return isContentCryptoError(err) ? err.code : `not a ContentCryptoError: ${String(err)}`;
  }
  return 'did not throw';
}

async function asyncCodeOf(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (err) {
    return isContentCryptoError(err) ? err.code : `not a ContentCryptoError: ${String(err)}`;
  }
  return 'did not throw';
}

// ---------------------------------------------------------------------------
// The deployed-function guard
// ---------------------------------------------------------------------------

describe('the deployed-function guard', () => {
  const rows: ReadonlyArray<[string, Record<string, string | undefined>, boolean]> = [
    ['a plain local run', {}, false],
    ['K_SERVICE absent, emulator flag set', { FUNCTIONS_EMULATOR: 'true' }, false],
    ['K_SERVICE empty', { K_SERVICE: '' }, false],
    ['a deployed function', { K_SERVICE: 'api' }, true],
    ['a deployed function with the flag off', { K_SERVICE: 'api', FUNCTIONS_EMULATOR: 'false' }, true],
    ['the emulator', { K_SERVICE: 'api', FUNCTIONS_EMULATOR: 'true' }, false],
  ];

  it.each(rows)('%s is deployed=%j', (_label, env, expected) => {
    expect(isDeployedFunction(env)).toBe(expected);
  });

  it('assertNotDeployedFunction passes on a local bag', () => {
    expect(() => assertNotDeployedFunction({})).not.toThrow();
  });

  it('THE NEGATIVE CONTROL: it really refuses a deployed bag, so the module-load call is not decorative', () => {
    expect(codeOf(() => assertNotDeployedFunction({ K_SERVICE: 'api' }))).toBe('VALIDATION_ERROR');
    expect(() => assertNotDeployedFunction({ K_SERVICE: 'api' }))
      .toThrow(/deployed function/);
  });

  it('the emulator is exempt, which is what stops the guard breaking every local emulator session', () => {
    expect(() => assertNotDeployedFunction({ K_SERVICE: 'api', FUNCTIONS_EMULATOR: 'true' })).not.toThrow();
  });

  it('this suite imported the module, so the ambient environment is not a deployed function', () => {
    // The import at the top of the file is itself the assertion: a throw at load would have taken
    // the whole suite with it. Stated as a test so the property is visible in the report.
    expect(typeof expectNoKeyMaterial).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// expectNoKeyMaterial
// ---------------------------------------------------------------------------

describe('expectNoKeyMaterial', () => {
  it('passes over an ordinary payload', () => {
    expect(() => expectNoKeyMaterial({ accountId: 'acc_1', holders: ['a', 'b'], at: '2026-01-01T00:00:00.000Z' }))
      .not.toThrow();
  });

  it('runs the PRODUCTION matcher: a whole base64 DEK is caught', () => {
    expect(codeOf(() => expectNoKeyMaterial({ note: Buffer.alloc(32, 0x5a).toString('base64') })))
      .toBe('VALIDATION_ERROR');
  });

  it('runs the PRODUCTION matcher: a Buffer anywhere in the tree is caught', () => {
    expect(codeOf(() => expectNoKeyMaterial({ deep: { deeper: [Buffer.alloc(4)] } })))
      .toBe('VALIDATION_ERROR');
  });

  it('catches a base64 DEK hiding in a message-shaped string, which is exactly how it would arrive', () => {
    const fixture = Buffer.alloc(32, 0x5b);
    registerKeyMaterialFixture(fixture);
    const dekOffTheWire = fixture.toString('base64');
    expect(() => expectNoKeyMaterial({ note: `upstream said: ${dekOffTheWire}` })).toThrow();
  });

  it('catches a FRAGMENT, which is the whole reason the fixture register exists', () => {
    const fixture = Buffer.alloc(32, 0x5c);
    registerKeyMaterialFixture(fixture);
    // Ten characters, quoted inside a longer sentence — §11.3's leak, and the shape no runtime
    // guard could ever see because production holds no fixture to compare against.
    const fragment = fixture.toString('base64').slice(4, 14);
    const message = `Unexpected token in JSON at position 0: "${fragment}..."`;
    expect(codeOf(() => expectNoKeyMaterial({ note: message }))).toBe('VALIDATION_ERROR');
    // And the refusal names the run it found, never more of the key than that.
    expect(() => expectNoKeyMaterial({ note: message })).toThrow(/characters of a registered fixture key/);
  });

  it('finds a fragment inside an Error message and inside a cause, which are non-enumerable and nested', () => {
    const fixture = Buffer.alloc(32, 0x5d);
    registerKeyMaterialFixture(fixture);
    const fragment = fixture.toString('hex').slice(0, 12);
    expect(codeOf(() => expectNoKeyMaterial(new Error(`upstream: ${fragment}`)))).toBe('VALIDATION_ERROR');
    // `cause` attached by hand rather than through the ES2022 constructor option: the tree
    // targets es2017, and what matters is that the walk reads an own property called `cause`.
    const wrapper = Object.assign(new Error('outer'), { cause: new Error(`upstream: ${fragment}`) });
    expect(codeOf(() => expectNoKeyMaterial(wrapper))).toBe('VALIDATION_ERROR');
  });

  it('finds a fragment in a Map value, a Set member and an array element', () => {
    const fixture = Buffer.alloc(32, 0x5e);
    registerKeyMaterialFixture(fixture);
    const fragment = fixture.toString('base64').slice(0, 10);
    expect(codeOf(() => expectNoKeyMaterial(new Map([['k', fragment]])))).toBe('VALIDATION_ERROR');
    expect(codeOf(() => expectNoKeyMaterial(new Set([fragment])))).toBe('VALIDATION_ERROR');
    expect(codeOf(() => expectNoKeyMaterial([{ deep: [fragment] }]))).toBe('VALIDATION_ERROR');
  });

  it('EXEMPTS a well-formed sealed value, so a WrapPatch assertion does not fail on its own ciphertext', async () => {
    const source = fixedDekSource({ productId: PRODUCT, keys: { A: { 1: KEY_A } } });
    const record = aggregateRecordRef('project', 'p_1', 'projects/p_1');
    const recordKey = mintRecordKey(record);
    const dek = await source.getCurrentDek('A');
    const entry = wrapRecordKey({ productId: PRODUCT, dek, accountId: 'A', record, recordKey });
    expect(entry.wrapped.startsWith('wrap:v1:')).toBe(true);
    expect(() => expectNoKeyMaterial({ keyWraps: { A: entry } })).not.toThrow();
  });

  it('does NOT exempt a hand-built value that merely starts with the prefix — the exemption is not a hole', () => {
    const fixture = Buffer.alloc(32, 0x5f);
    registerKeyMaterialFixture(fixture);
    const forged = `enc:v3:${fixture.toString('base64')}`;
    // `decodeValue` refuses it (one part, not three), so the fragment scan still runs on it.
    expect(codeOf(() => expectNoKeyMaterial({ value: forged }))).toBe('VALIDATION_ERROR');
  });

  it('a cycle is not a leak and does not hang the walk', () => {
    const node: Record<string, unknown> = { name: 'root' };
    node.self = node;
    expect(() => expectNoKeyMaterial(node)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// memoryContentKeyStore
// ---------------------------------------------------------------------------

/** The minimum a `ContentKeyPatch` must carry to be legal; every test below overlays what it cares about. */
function patchOf(overrides: Partial<ContentKeyPatch>): ContentKeyPatch {
  const key = overrides.key ?? {};
  const generations = overrides.generations ?? [];
  const mint = overrides.mint ?? null;
  const changed = Object.keys(key).length + generations.length;
  return {
    key,
    generations,
    mint,
    createIfMissing: overrides.createIfMissing ?? false,
    evict: overrides.evict ?? (changed > 0 || mint !== null),
    changed: overrides.changed ?? changed,
    audit: overrides.audit ?? {
      action: 'mint',
      accountId: 'A',
      productId: PRODUCT,
      generation: null,
      statusBefore: 'active',
      statusAfter: 'active',
      cause: null,
      at: '2026-01-01T00:00:00.000Z',
    },
  };
}

describe('memoryContentKeyStore', () => {
  const at = (): Date => new Date('2026-02-02T02:02:02.000Z');

  it('seeds a row and its generations, so a test states its precondition', async () => {
    const store = memoryContentKeyStore(PRODUCT, { now: at });
    store.seed('A', { currentGeneration: 2, createdAt: '2026-01-01T00:00:00.000Z' }, [
      { n: 1, hasWrap: false, drainedAt: '2026-01-05T00:00:00.000Z' },
      { n: 2, hasWrap: true },
    ]);
    const row = await store.readKey('A');
    expect(row?.currentGeneration).toBe(2);
    expect(row?.productId).toBe(PRODUCT);
    expect(row?.revokedAt).toBeNull();
    expect((await store.listGenerations('A')).map((g) => g.n)).toEqual([1, 2]);
    expect(store.wraps('A')).toEqual([2]);
  });

  it('an unseeded account reads back null rather than an empty row', async () => {
    const store = memoryContentKeyStore(PRODUCT);
    expect(await store.readKey('nobody')).toBeNull();
    expect(await store.readGeneration('nobody', 1)).toBeNull();
    expect(await store.listGenerations('nobody')).toEqual([]);
  });

  it('applies MINT FIRST: the wrap exists before anything else in the patch is written', async () => {
    const store = memoryContentKeyStore(PRODUCT, { now: at });
    await store.apply('A', patchOf({
      key: { currentGeneration: 1, createdAt: KEY_PATCH_SERVER_TIME },
      mint: { generation: 1 },
      createIfMissing: true,
    }));
    expect(store.wraps('A')).toEqual([1]);
    expect((await store.readKey('A'))?.currentGeneration).toBe(1);
  });

  it('translates KEY_PATCH_SERVER_TIME through the injected clock, and KEY_PATCH_DELETE as a removal', async () => {
    const store = memoryContentKeyStore(PRODUCT, { now: at });
    store.seed('A', { currentGeneration: 1, revokedAt: '2026-01-01T00:00:00.000Z', revokedCause: 'incident' });
    await store.apply('A', patchOf({ key: { destroyedAt: KEY_PATCH_SERVER_TIME } }));
    expect((await store.readKey('A'))?.destroyedAt).toBe('2026-02-02T02:02:02.000Z');

    await store.apply('A', patchOf({ key: { revokedAt: KEY_PATCH_DELETE, revokedCause: KEY_PATCH_DELETE } }));
    const row = await store.readKey('A');
    expect(row?.revokedAt).toBeNull();
    expect(row?.revokedCause).toBeNull();
  });

  it('recognises a sentinel that has been through JSON, because a patch may have crossed a queue', async () => {
    const store = memoryContentKeyStore(PRODUCT, { now: at });
    store.seed('A', { revokedAt: '2026-01-01T00:00:00.000Z' });
    const posted = JSON.parse(JSON.stringify(patchOf({ key: { revokedAt: KEY_PATCH_DELETE } }))) as ContentKeyPatch;
    await store.apply('A', posted);
    expect((await store.readKey('A'))?.revokedAt).toBeNull();
  });

  it('applies a dotted key as a FIELD PATH, creating the intermediate map', async () => {
    const store = memoryContentKeyStore(PRODUCT, { now: at });
    store.seed('A', { currentGeneration: 1 });
    await store.apply('A', patchOf({
      key: { 'rotation.generation': 2, 'rotation.startedAt': '2026-01-02T00:00:00.000Z' },
    }));
    await store.apply('A', patchOf({ key: { 'rotation.error': 'timed out' } }));
    const rotation = (await store.readKey('A'))?.rotation as Record<string, unknown> | null;
    // The second patch MERGED. A store that treated a dotted key as a literal field name would
    // have clobbered `startedAt`, which is the whole reason `planRecordProgress` emits dotted keys.
    expect(rotation).toEqual({ generation: 2, startedAt: '2026-01-02T00:00:00.000Z', error: 'timed out' });
  });

  it('writes the GENERATIONS BEFORE THE KEY ROW, so a partial failure says LESS has happened than has', async () => {
    // The ordering is observable exactly where it matters: at a partial failure. The key row is
    // absent and the patch does not create one, so step 3 refuses — and the generation patch has
    // already landed. That direction is recoverable by re-running; a row tombstoned over a live
    // wrap is a destroy that lies, and nothing repairs it.
    const store = memoryContentKeyStore(PRODUCT, { now: at });
    expect(await asyncCodeOf(() => store.apply('A', patchOf({
      key: { destroyedAt: KEY_PATCH_SERVER_TIME },
      generations: [{ n: 1, set: { destroyedAt: KEY_PATCH_SERVER_TIME }, eraseWrap: true }],
    })))).toBe('KEY_STORE_CONFLICT');
    // The generation write survived the refusal — that is the ordering, seen from outside.
    expect((await store.readGeneration('A', 1))?.destroyedAt).toBe('2026-02-02T02:02:02.000Z');
    expect(await store.readKey('A')).toBeNull();
  });

  it('MINT comes first, so the wrap exists even when the rest of the patch cannot be applied', async () => {
    const store = memoryContentKeyStore(PRODUCT, { now: at });
    expect(await asyncCodeOf(() => store.apply('A', patchOf({
      key: { currentGeneration: 2 },
      mint: { generation: 2 },
    })))).toBe('KEY_STORE_CONFLICT');
    expect(store.wraps('A')).toEqual([2]);
  });

  it('a destroy erases the wrap and tombstones the row in one legal patch', async () => {
    const store = memoryContentKeyStore(PRODUCT, { now: at });
    store.seed('A', { currentGeneration: 1 }, [{ n: 1, hasWrap: true }]);
    await store.apply('A', patchOf({
      key: { destroyedAt: KEY_PATCH_SERVER_TIME, destroyedThrough: 1 },
      generations: [{ n: 1, set: { destroyedAt: KEY_PATCH_SERVER_TIME }, eraseWrap: true }],
    }));
    expect(store.wraps('A')).toEqual([]);
    expect((await store.readGeneration('A', 1))?.destroyedAt).toBe('2026-02-02T02:02:02.000Z');
    expect((await store.readKey('A'))?.destroyedThrough).toBe(1);
  });

  it('creates the row when createIfMissing, and REFUSES a patch against a row that is not there', async () => {
    const store = memoryContentKeyStore(PRODUCT, { now: at });
    expect(await asyncCodeOf(() => store.apply('A', patchOf({ key: { currentGeneration: 1 } }))))
      .toBe('KEY_STORE_CONFLICT');
    await store.apply('A', patchOf({ key: { currentGeneration: 1 }, createIfMissing: true }));
    expect((await store.readKey('A'))?.currentGeneration).toBe(1);
  });

  it('runs assertContentKeyPatch, so an illegal patch never reaches the store', async () => {
    const store = memoryContentKeyStore(PRODUCT, { now: at });
    // `changed` disagreeing with the patch's own contents — the invariant a consumer's `apply`
    // gets to rely on, re-asserted where the planner's guarantee no longer travels with the value.
    expect(await asyncCodeOf(() => store.apply('A', patchOf({ key: { currentGeneration: 1 }, changed: 7 }))))
      .toBe('VALIDATION_ERROR');
    expect(store.applied).toHaveLength(0);
  });

  it('records every patch in order, which is the assertion surface for the fourteen rules', async () => {
    const store = memoryContentKeyStore(PRODUCT, { now: at });
    await store.apply('A', patchOf({ key: { currentGeneration: 1 }, mint: { generation: 1 }, createIfMissing: true }));
    await store.apply('A', patchOf({ key: { revokedAt: KEY_PATCH_SERVER_TIME } }));
    expect(store.applied.map((e) => e.accountId)).toEqual(['A', 'A']);
    expect(store.applied[0].patch.mint).toEqual({ generation: 1 });
    expect(Object.keys(store.applied[1].patch.key)).toEqual(['revokedAt']);
  });

  it('honours patch.evict, which is footgun 14 and the step a consumer forgets invisibly', async () => {
    const evicted: string[] = [];
    const store = memoryContentKeyStore(PRODUCT, { now: at, onEvict: (a) => evicted.push(a) });
    await store.apply('A', patchOf({ key: { currentGeneration: 1 }, createIfMissing: true }));
    expect(evicted).toEqual(['A']);

    // And a patch with nothing to write evicts nothing — `evict === (changed > 0 || mint !== null)`.
    await store.apply('A', patchOf({ key: {}, changed: 0, evict: false }));
    expect(evicted).toEqual(['A']);
  });

  it('holds no key material at all: a GenerationRow carries hasWrap and never a wrap', async () => {
    const store = memoryContentKeyStore(PRODUCT, { now: at });
    await store.apply('A', patchOf({ key: { currentGeneration: 1 }, mint: { generation: 1 }, createIfMissing: true }));
    const keyRow = await store.readKey('A');
    expect(() => expectNoKeyMaterial({
      row: keyRow, generations: store.wraps('A'), applied: store.applied,
    })).not.toThrow();
    const row = await store.readGeneration('A', 1);
    expect(Object.keys(row as object).sort()).toEqual(
      ['createdAt', 'destroyedAt', 'drainedAt', 'hasWrap', 'kmsKeyVersion', 'n', 'retiredAt'],
    );
  });
});

// ---------------------------------------------------------------------------
// fixedDekSource
// ---------------------------------------------------------------------------

describe('fixedDekSource', () => {
  it('serves the SAME BYTES under two accounts and two generations, which is the tamper discipline', async () => {
    const source = fixedDekSource({ productId: PRODUCT, keys: { A: { 1: KEY_A, 2: KEY_A }, B: { 1: KEY_A } } });
    const a1 = await source.getDek('A', 1);
    const a2 = await source.getDek('A', 2);
    const b1 = await source.getDek('B', 1);
    expect([a1.generation, a2.generation, b1.generation]).toEqual([1, 2, 1]);
    // Three different LABELS over one set of bytes: the labels are what a tamper test varies.
    expect([`${a1.key}`, `${a2.key}`, `${b1.key}`]).toEqual([
      '[redacted dek collab/A@1]', '[redacted dek collab/A@2]', '[redacted dek collab/B@1]',
    ]);
  });

  it('currentGeneration defaults to the highest configured, and getCurrentDek follows it', async () => {
    const source = fixedDekSource({ productId: PRODUCT, keys: { A: { 1: KEY_A, 3: KEY_B } } });
    expect(await source.currentGeneration('A')).toBe(3);
    expect((await source.getCurrentDek('A')).generation).toBe(3);
  });

  it('an explicit currentGeneration wins, so a test can point the write path at any generation', async () => {
    const source = fixedDekSource({
      productId: PRODUCT, keys: { A: { 1: KEY_A, 2: KEY_A } }, currentGeneration: () => 1,
    });
    expect((await source.getCurrentDek('A')).generation).toBe(1);
  });

  it('NEVER MINTS on a read: an unconfigured generation is ACCOUNT_KEY_DESTROYED', async () => {
    const source = fixedDekSource({ productId: PRODUCT, keys: { A: { 1: KEY_A } } });
    expect(await asyncCodeOf(() => source.getDek('A', 9))).toBe('ACCOUNT_KEY_DESTROYED');
  });

  it('an unknown account is ACCOUNT_KEY_NOT_FOUND, which is a different fact from a drained generation', async () => {
    const source = fixedDekSource({ productId: PRODUCT, keys: { A: { 1: KEY_A } } });
    expect(await asyncCodeOf(() => source.getDek('Z', 1))).toBe('ACCOUNT_KEY_NOT_FOUND');
    expect(await asyncCodeOf(() => source.currentGeneration('Z'))).toBe('ACCOUNT_KEY_NOT_FOUND');
  });

  it('the fail hook is consulted FIRST, so a test can express revoked and destroyed', async () => {
    const source = fixedDekSource({
      productId: PRODUCT,
      keys: { A: { 1: KEY_A } },
      fail: (accountId) => (accountId === 'A'
        ? new ContentCryptoError('ACCOUNT_KEY_REVOKED', `key for '${accountId}' is revoked`)
        : null),
    });
    expect(await asyncCodeOf(() => source.getDek('A', 1))).toBe('ACCOUNT_KEY_REVOKED');
  });

  it('retains NEITHER the input Buffer NOR a view into it', async () => {
    const caller = Buffer.alloc(32, 0x33);
    const source = fixedDekSource({ productId: PRODUCT, keys: { A: { 1: caller } } });
    const record = aggregateRecordRef('project', 'p_1', 'projects/p_1');
    const recordKey = mintRecordKey(record);
    const entry = wrapRecordKey({
      productId: PRODUCT, dek: await source.getDek('A', 1), accountId: 'A', record, recordKey,
    });

    // The caller reuses their own buffer, as a caller is entitled to.
    caller.fill(0);

    // The handle is unaffected, so the wrap still opens. Had the constructor kept the caller's
    // buffer, this would now be unwrapping under 32 zero bytes.
    const reopened = unwrapRecordKey({
      productId: PRODUCT, dek: await source.getDek('A', 1), accountId: 'A', record, wrap: entry,
    });
    expect(`${reopened}`).toBe('[redacted record-key projects/p_1]');
  });

  it('redacts under every serialiser, so a snapshot or a log dump of the source carries nothing', () => {
    const source = fixedDekSource({ productId: PRODUCT, keys: { A: { 1: KEY_A } } });
    expect(JSON.stringify(source)).toBe(`"[redacted fixedDekSource ${PRODUCT}]"`);
    expect(String(source)).toBe(`[redacted fixedDekSource ${PRODUCT}]`);
    expect(inspect(source, { depth: null, showHidden: true })).toBe(`[redacted fixedDekSource ${PRODUCT}]`);
    expect(() => expectNoKeyMaterial(source)).not.toThrow();
  });

  it('registers its keys as fixtures, which is what makes a FRAGMENT of one findable', () => {
    const bytes = Buffer.alloc(32, 0x44);
    fixedDekSource({ productId: PRODUCT, keys: { A: { 1: bytes } } });
    const fragment = bytes.toString('base64').slice(2, 12);
    expect(codeOf(() => expectNoKeyMaterial({ note: `oops: ${fragment}` }))).toBe('VALIDATION_ERROR');
  });

  it('refuses a key that is not 32 bytes, and a non-integer generation, at CONSTRUCTION', () => {
    expect(codeOf(() => fixedDekSource({ productId: PRODUCT, keys: { A: { 1: Buffer.alloc(16) } } })))
      .toBe('VALIDATION_ERROR');
    expect(codeOf(() => fixedDekSource({
      productId: PRODUCT, keys: { A: { 0: KEY_A } as Readonly<Record<number, Buffer>> },
    }))).toBe('VALIDATION_ERROR');
    expect(codeOf(() => fixedDekSource({ productId: '' }))).toBe('VALIDATION_ERROR');
  });
});

// ---------------------------------------------------------------------------
// checkTraversal
// ---------------------------------------------------------------------------

describe('checkTraversal', () => {
  const registry = defineRegistry({ messages: { strings: ['body'] } });
  const scopeSpec: ContentKeyScope<'project'> = {
    productId: PRODUCT,
    records: { project: 'aggregate' },
  };
  const scope = resolveScope(scopeSpec, registry);

  /** `checkTraversal` reads only whether a wrap is PRESENT, so a placeholder entry is honest here
   *  — nothing in this suite opens one, and building a real one would test the wrong module. */
  const wrapFor = (): WrapEntry => ({ gen: 1, wrapped: 'wrap:v1:placeholder', at: '2026-01-01T00:00:00.000Z' });

  function head(id: string, holders: readonly string[], cursor?: string): RecordHead {
    const keyWraps: Record<string, WrapEntry> = {};
    for (const holder of holders) keyWraps[holder] = wrapFor();
    return {
      record: aggregateRecordRef('project', id, `projects/${id}`),
      ownerAccountId: 'A',
      keyWraps: keyWraps as KeyWraps,
      ref: { path: `projects/${id}` },
      precondition: 1,
      cursor,
    };
  }

  /** A traversal over a fixed, ordered list. `from` resumes strictly after that cursor. */
  function traversalOver(heads: readonly RecordHead[]): ForEachRecord {
    return async (_accountId, visit, from): Promise<void> => {
      const start = from === undefined ? 0 : heads.findIndex((h) => h.cursor === from) + 1;
      for (let i = start; i < heads.length; i += 1) await visit(heads[i]);
    };
  }

  const good = [head('p_1', ['A', 'B'], 'c1'), head('p_2', ['B'], 'c2'), head('p_3', ['B'], 'c3')];

  it('passes a correct holder-scoped traversal', async () => {
    await expect(checkTraversal(scope, traversalOver(good), 'B')).resolves.toBeUndefined();
  });

  it('CATCHES THE OWNERSHIP QUERY: a head the account holds no wrap on', async () => {
    // `p_1` is shared to B; `p_9` is not. An ownership query for A would yield both, and the
    // rotation of B's DEK would then erase a wrap it never rewrapped.
    const walked = traversalOver([...good, head('p_9', ['A'], 'c9')]);
    await expect(checkTraversal(scope, walked, 'B')).rejects.toThrow(/holds\s+no wrap/);
    expect(await asyncCodeOf(() => checkTraversal(scope, walked, 'B'))).toBe('VALIDATION_ERROR');
  });

  it('catches a record yielded twice', async () => {
    const walked = traversalOver([...good, head('p_2', ['B'], 'c4')]);
    await expect(checkTraversal(scope, walked, 'B')).rejects.toThrow(/twice/);
  });

  it('catches a non-deterministic order', async () => {
    let run = 0;
    const walked: ForEachRecord = async (_accountId, visit): Promise<void> => {
      run += 1;
      const order = run === 1 ? good : [good[1], good[0], good[2]];
      for (const h of order) await visit(h);
    };
    await expect(checkTraversal(scope, walked, 'B')).rejects.toThrow(/disagreed at position/);
  });

  it('catches a resume that re-yields the head its cursor came from', async () => {
    const walked: ForEachRecord = async (_accountId, visit, from): Promise<void> => {
      const start = from === undefined ? 0 : good.findIndex((h) => h.cursor === from); // off by one
      for (let i = start; i < good.length; i += 1) await visit(good[i]);
    };
    await expect(checkTraversal(scope, walked, 'B')).rejects.toThrow(/STRICTLY AFTER/);
  });

  it('catches a traversal that swallows the visitor\'s throw', async () => {
    const walked: ForEachRecord = async (_accountId, visit, from): Promise<void> => {
      const start = from === undefined ? 0 : good.findIndex((h) => h.cursor === from) + 1;
      for (let i = start; i < good.length; i += 1) {
        try {
          await visit(good[i]);
        } catch {
          /* swallowed — the failure this clause exists to catch */
        }
      }
    };
    await expect(checkTraversal(scope, walked, 'B')).rejects.toThrow(/swallowed/);
  });

  it('runs assertHead on every head, so a path below the aggregate root fails here too', async () => {
    const below: RecordHead = {
      ...head('p_1', ['B'], 'c1'),
      record: { type: 'project', id: 'p_1', path: 'projects/p_1/messages/m_1' },
    };
    await expect(checkTraversal(scope, traversalOver([below]), 'B')).rejects.toThrow();
  });

  it('needs the accountId, because the holder-scoped check IS keyWraps[accountId]', async () => {
    expect(await asyncCodeOf(() => checkTraversal(scope, traversalOver(good), ''))).toBe('VALIDATION_ERROR');
  });
});

// ---------------------------------------------------------------------------
// checkWrapCommit — and every one of its refusals, proved by a committer that earns it
// ---------------------------------------------------------------------------

/**
 * The negative-control rule of this suite, applied to the one check standing where the mechanism
 * ends: **a conformance suite that cannot be shown to fail proves only that it is broken.** Each
 * `it` below builds a committer that is wrong in exactly one way and asserts the refusal that
 * names the consequence.
 */
describe('checkWrapCommit', () => {
  const registry = defineRegistry({ messages: { strings: ['body'] } });
  const scopeSpec: ContentKeyScope<'project'> = { productId: PRODUCT, records: { project: 'aggregate' } };
  const scope = resolveScope(scopeSpec, registry);
  const records = [
    aggregateRecordRef('project', 'p_1', 'projects/p_1'),
    aggregateRecordRef('project', 'p_2', 'projects/p_2'),
  ] as const;

  /**
   * The store, and the two-member harness R12 left behind: the independent read moved ONTO the
   * committer (R11), where production uses it, so what a conformance run still needs from the
   * product is two throwaway records and a way to put them back.
   */
  function makeWorld(): {
    readonly rows: Map<string, Record<string, unknown>>;
    readonly harness: WrapCommitHarness;
  } {
    const rows = new Map<string, Record<string, unknown>>();
    return {
      rows,
      harness: {
        records,
        async reset(): Promise<void> {
          rows.clear();
        },
      },
    };
  }

  /** The conforming committer: create-only, writes before it acknowledges, real write times, and
   *  a read that answers from the store rather than from its own memory of what it wrote. */
  function goodCommitter(rows: Map<string, Record<string, unknown>>): WrapCommitter {
    return {
      async commitWraps(requests): Promise<readonly WrapReceipt[]> {
        for (const request of requests) {
          if (rows.get(request.record.path)?.keyWraps !== undefined) {
            throw new Error(`precondition lost on ${request.record.path}`);
          }
        }
        const committedAt = new Date().toISOString();
        for (const request of requests) rows.set(request.record.path, { ...request.update });
        return requests.map(() => ({ committedAt }));
      },
      async readWraps(records_): Promise<readonly unknown[]> {
        return records_.map((record) => rows.get(record.path)?.keyWraps);
      },
      isPreconditionFailure: (err): boolean =>
        err instanceof Error && /precondition lost/.test(err.message),
    };
  }

  it('passes a committer that writes, refuses a second key, and reports real write times', async () => {
    const world = makeWorld();
    await expect(checkWrapCommit(scope, goodCommitter(world.rows), world.harness))
      .resolves.toBeUndefined();
    // …and it cleans up after itself, so a product may run it against a live emulator.
    expect(world.rows.size).toBe(0);
  });

  it('FAILS a committer that only enqueues — the defect this port exists to remove', async () => {
    const world = makeWorld();
    const pending: { path: string; data: Record<string, unknown> }[] = [];
    const enqueueOnly: WrapCommitter = {
      ...goodCommitter(world.rows),
      async commitWraps(requests): Promise<readonly WrapReceipt[]> {
        for (const request of requests) pending.push({ path: request.record.path, data: { ...request.update } });
        // No write time exists, so one is invented. That invention is the tell.
        return requests.map(() => ({ committedAt: new Date().toISOString() }));
      },
      isPreconditionFailure: (): boolean => false,
    };
    await expect(checkWrapCommit(scope, enqueueOnly, world.harness))
      .rejects.toThrow(/COMMITTED, not merely enqueued/);
    expect(pending).toHaveLength(2);
  });

  it('FAILS a committer built on a batch writer that SWALLOWS a lost precondition', async () => {
    const world = makeWorld();
    const swallowing: WrapCommitter = {
      ...goodCommitter(world.rows),
      async commitWraps(requests): Promise<readonly WrapReceipt[]> {
        // Overwrite rather than refuse, which is what "count a lost precondition as already done"
        // amounts to on a wrap row: right for a content row, and a shredder here.
        const committedAt = new Date().toISOString();
        for (const request of requests) world.rows.set(request.record.path, { ...request.update });
        return requests.map(() => ({ committedAt }));
      },
    };
    await expect(checkWrapCommit(scope, swallowing, world.harness))
      .rejects.toThrow(/second commitWraps on 'projects\/p_1' was accepted/);
  });

  it('FAILS a committer that rejects a second key but cannot classify its own rejection', async () => {
    const world = makeWorld();
    const unclassified: WrapCommitter = {
      ...goodCommitter(world.rows),
      isPreconditionFailure: (): boolean => false,
    };
    await expect(checkWrapCommit(scope, unclassified, world.harness))
      .rejects.toThrow(/isPreconditionFailure\(\) did not recognise/);
  });

  it('FAILS a committer whose receipts are the wrong length, or in the wrong shape', async () => {
    const world = makeWorld();
    const short: WrapCommitter = {
      ...goodCommitter(world.rows),
      async commitWraps(requests): Promise<readonly WrapReceipt[]> {
        await goodCommitter(world.rows).commitWraps(requests);
        return [{ committedAt: new Date().toISOString() }];
      },
    };
    await expect(checkWrapCommit(scope, short, world.harness))
      .rejects.toThrow(/One receipt per request, in the same order/);

    const world2 = makeWorld();
    const noTime: WrapCommitter = {
      ...goodCommitter(world2.rows),
      async commitWraps(requests): Promise<readonly WrapReceipt[]> {
        await goodCommitter(world2.rows).commitWraps(requests);
        return requests.map(() => ({ committedAt: 'soon' }));
      },
    };
    await expect(checkWrapCommit(scope, noTime, world2.harness))
      .rejects.toThrow(/a committer that has to INVENT one is a committer that has not committed/);
  });

  it('FAILS a committer whose write time is a constant rather than the store\'s own', async () => {
    const world = makeWorld();
    const frozen: WrapCommitter = {
      ...goodCommitter(world.rows),
      async commitWraps(requests): Promise<readonly WrapReceipt[]> {
        await goodCommitter(world.rows).commitWraps(requests);
        return requests.map(() => ({ committedAt: '2000-01-01T00:00:00.000Z' }));
      },
    };
    await expect(checkWrapCommit(scope, frozen, world.harness))
      .rejects.toThrow(/what it catches is a FIXED value/);
  });

  it('FAILS a receipt carrying key material, because a receipt reaches the audit trail', async () => {
    const world = makeWorld();
    const leaky: WrapCommitter = {
      ...goodCommitter(world.rows),
      async commitWraps(requests): Promise<readonly WrapReceipt[]> {
        const receipts = await goodCommitter(world.rows).commitWraps(requests);
        return receipts.map((r) => ({ ...r, precondition: { dek: KEY_A.toString('base64') } }));
      },
    };
    await expect(checkWrapCommit(scope, leaky, world.harness))
      .rejects.toThrow(/carries key material/);
  });

  it('refuses a harness whose reset does not reset, which is what makes (1) non-vacuous', async () => {
    const world = makeWorld();
    world.rows.set(records[0].path, { keyWraps: { A: { gen: 1, wrapped: 'wrap:v1:x', at: 'now' } } });
    const stubborn: WrapCommitHarness = { ...world.harness, async reset(): Promise<void> {} };
    // Without this clause, assertion (1) would pass for a committer that wrote nothing at all.
    await expect(checkWrapCommit(scope, goodCommitter(world.rows), stubborn))
      .rejects.toThrow(/would pass a committer that wrote nothing at all/);
  });

  it('refuses a committer with no readWraps at all — the read is the port\'s, not the harness\'s', async () => {
    // R11 moved it: a reader a product supplies only to its tests is a reader nobody runs in
    // production, and the package now reads the wraps back on EVERY create.
    const world = makeWorld();
    const good = goodCommitter(world.rows);
    const blind = {
      commitWraps: (requests: readonly WrapCommitRequest[]) => good.commitWraps(requests),
      isPreconditionFailure: (err: unknown) => good.isPreconditionFailure(err),
    };
    expect(await asyncCodeOf(() =>
      checkWrapCommit(scope, blind as unknown as WrapCommitter, world.harness)))
      .toBe('VALIDATION_ERROR');
    await expect(checkWrapCommit(scope, blind as unknown as WrapCommitter, world.harness))
      .rejects.toThrow(/INDEPENDENT, uncached read/);
  });

  it('FAILS a committer whose readWraps is not positional over the page it was asked about', async () => {
    const world = makeWorld();
    const short: WrapCommitter = {
      ...goodCommitter(world.rows),
      async readWraps(): Promise<readonly unknown[]> {
        return [];
      },
    };
    // A short answer to a page is exactly where a partial commit hides behind a full set of
    // receipts, so it is refused rather than padded.
    await expect(checkWrapCommit(scope, short, world.harness))
      .rejects.toThrow(/One answer per record, in the same order/);
  });

  it('FAILS a committer whose reader answers from its own memory rather than the store', async () => {
    // The second deliberate falsehood, and the price read-back sets: a writer that enqueues and a
    // reader that echoes what was enqueued defeat both this suite and the package's own read-back.
    // It is caught here only because create-only-ness is checked too — which is the complementarity
    // R12 rests on.
    const world = makeWorld();
    const invented = new Map<string, unknown>();
    const lying: WrapCommitter = {
      ...goodCommitter(world.rows),
      async commitWraps(requests): Promise<readonly WrapReceipt[]> {
        for (const request of requests) invented.set(request.record.path, request.keyWraps);
        return requests.map(() => ({ committedAt: new Date().toISOString() }));
      },
      async readWraps(records_): Promise<readonly unknown[]> {
        return records_.map((record) => invented.get(record.path));
      },
    };
    await expect(checkWrapCommit(scope, lying, world.harness))
      .rejects.toThrow(/second commitWraps on 'projects\/p_1' was accepted/);
  });

  // ── (7) the page is not the committer's to mutate ────────────────────────────────────────────
  //
  // The gap these close was measured against this very function: a committer that SORTED THE PAGE
  // IN PLACE passed `checkWrapCommit` outright, because every wrap it wrote genuinely landed and
  // every clause above reads the two records independently. The consequence in the package is a
  // record handed ANOTHER record's `committedUpdate` and both rows permanently unreadable, with
  // nobody having said anything false.

  it('FAILS a committer that SORTS THE PAGE IN PLACE, though it writes every wrap durably', async () => {
    const world = makeWorld();
    const inner = goodCommitter(world.rows);
    const sorting: WrapCommitter = {
      ...inner,
      async commitWraps(requests): Promise<readonly WrapReceipt[]> {
        // Sorting a page by path before writing it says nothing false and is a natural thing to
        // write. It is refused because the CALLER indexes this array positionally afterwards.
        (requests as WrapCommitRequest[]).sort((a, b) => (a.record.path < b.record.path ? -1 : 1));
        return inner.commitWraps(requests);
      },
    };
    await expect(checkWrapCommit(scope, sorting, world.harness))
      .rejects.toThrow(/sort, splice or reassign the array of requests IN PLACE/);
  });

  it('FAILS a committer that SPLICES the page it was handed', async () => {
    const world = makeWorld();
    const inner = goodCommitter(world.rows);
    const splicing: WrapCommitter = {
      ...inner,
      async commitWraps(requests): Promise<readonly WrapReceipt[]> {
        (requests as WrapCommitRequest[]).splice(0, 1);      // "this one is already dealt with"
        return inner.commitWraps(requests);
      },
    };
    // The refusal names the defect. Without the translation this is a bare TypeError from inside
    // the committer's own line, which tells an adopting product nothing about what it did wrong.
    expect(await asyncCodeOf(() => checkWrapCommit(scope, splicing, world.harness)))
      .toBe('VALIDATION_ERROR');
    await expect(checkWrapCommit(scope, splicing, world.harness))
      .rejects.toThrow(/Sort or filter a COPY/);
  });

  it('is not vacuous: a committer that sorts a COPY of the page passes', async () => {
    // The freeze refuses a MUTATION, not an ordering — a committer free to write a page in
    // whatever order it likes is the whole point of handing it the page. One `[...]` earlier.
    const world = makeWorld();
    const inner = goodCommitter(world.rows);
    await expect(checkWrapCommit(scope, {
      ...inner,
      commitWraps: (requests): Promise<readonly WrapReceipt[]> =>
        inner.commitWraps([...requests].sort((a, b) => (a.record.path < b.record.path ? -1 : 1))),
    }, world.harness)).resolves.toBeUndefined();
  });

  it('FAILS a committer that TIDIES ITS OWN RECEIPTS after handing them over', async () => {
    // (7) with the port turned round. The array is the committer's, so no caller can freeze it —
    // which is why this clause is a comparison rather than a refusal at the point of mutation.
    const world = makeWorld();
    const inner = goodCommitter(world.rows);
    let mine: WrapReceipt[] = [];
    let tidied = false;
    const tidying: WrapCommitter = {
      ...inner,
      async commitWraps(requests): Promise<readonly WrapReceipt[]> {
        const acknowledged = await inner.commitWraps(requests);
        mine = requests.map((request, i) => ({
          committedAt: acknowledged[i].committedAt,
          precondition: `updateTime@${request.record.path}`,
        }));
        return mine;                          // the committer's own array, handed straight over
      },
      async readWraps(records_): Promise<readonly unknown[]> {
        // Tidied on the way past, which is where a real committer would do it: the next call
        // through the port, with the caller's positional re-read still ahead of it.
        if (!tidied && mine.length > 0) {
          tidied = true;
          mine.reverse();
        }
        return inner.readWraps(records_);
      },
    };
    await expect(checkWrapCommit(scope, tidying, world.harness))
      .rejects.toThrow(/receipts commitWraps returned have CHANGED/);
    expect(tidied).toBe(true);
  });

  it('FAILS a committer that rewrites a receipt it already handed over, which no array copy stops', async () => {
    // The half the package's own defensive copy does NOT reach: the array was fresh, the receipt
    // OBJECTS were not, and a shallow copy carries the same objects.
    const world = makeWorld();
    const inner = goodCommitter(world.rows);
    const mine: WrapReceipt[] = [];
    const rewriting: WrapCommitter = {
      ...inner,
      async commitWraps(requests): Promise<readonly WrapReceipt[]> {
        const acknowledged = await inner.commitWraps(requests);
        const page = requests.map((request, i) => ({
          committedAt: acknowledged[i].committedAt,
          precondition: `updateTime@${request.record.path}`,
        }));
        mine.length = 0;
        mine.push(...page);
        return page;
      },
      async readWraps(records_): Promise<readonly unknown[]> {
        // "The real token arrived late, so finish the receipt off." The caller has already been
        // handed it, and reads it several awaits from here.
        for (const receipt of mine) {
          (receipt as { precondition?: unknown }).precondition = 'updateTime@somewhere-else';
        }
        return inner.readWraps(records_);
      },
    };
    await expect(checkWrapCommit(scope, rewriting, world.harness))
      .rejects.toThrow(/receipt objects are yours/);
  });

  it('is not vacuous: a committer that keeps a reversed COPY of its receipts passes', async () => {
    // The same bookkeeping written correctly, one `[...]` earlier — and the committer is free to
    // hold it in whatever order suits it, because what it kept is not what it handed over.
    const world = makeWorld();
    const inner = goodCommitter(world.rows);
    const kept: WrapReceipt[][] = [];
    await expect(checkWrapCommit(scope, {
      ...inner,
      async commitWraps(requests): Promise<readonly WrapReceipt[]> {
        const page = await inner.commitWraps(requests);
        kept.push([...page].reverse());
        return page;
      },
    }, world.harness)).resolves.toBeUndefined();
    expect(kept.length).toBeGreaterThan(0);
  });

  it('does NOT translate a store error into a mutation refusal', async () => {
    // A committer that genuinely cannot write is a different problem with a different fix, so its
    // own error arrives unchanged rather than wearing a diagnosis that does not fit.
    const world = makeWorld();
    const broken: WrapCommitter = {
      ...goodCommitter(world.rows),
      async commitWraps(): Promise<readonly WrapReceipt[]> {
        throw new Error('the store is unreachable');
      },
    };
    await expect(checkWrapCommit(scope, broken, world.harness))
      .rejects.toThrow(/the store is unreachable/);
  });

  // ── (1), second half: the SAME wrap, not merely A wrap ───────────────────────────────────────

  it('FAILS a committer that persists the right wrapped key under the WRONG GENERATION', async () => {
    const world = makeWorld();
    const inner = goodCommitter(world.rows);
    const wrongGeneration: WrapCommitter = {
      ...inner,
      async commitWraps(requests): Promise<readonly WrapReceipt[]> {
        const committedAt = new Date().toISOString();
        for (const request of requests) {
          if (world.rows.get(request.record.path)?.keyWraps !== undefined) {
            throw new Error(`precondition lost on ${request.record.path}`);
          }
          const wraps: Record<string, unknown> = {};
          for (const [holder, entry] of Object.entries(parseKeyWraps(request.keyWraps))) {
            // The ciphertext is carried through UNTOUCHED. Only the generation moves — a row built
            // by hand from two fields, or a store stamping the account's current generation.
            wraps[holder] = { ...entry, gen: entry.gen + 1 };
          }
          world.rows.set(request.record.path, { ...request.update, keyWraps: wraps });
        }
        return requests.map(() => ({ committedAt }));
      },
    };
    await expect(checkWrapCommit(scope, wrongGeneration, world.harness))
      .rejects.toThrow(/holds a DIFFERENT wrap than the one commitWraps was handed \(the generation differs\)/);
  });

  it('catches the wrong generation on the SECOND record, which nothing else here looks at', async () => {
    // Create-only (3) only ever re-commits the FIRST record, so a store that garbles the second
    // one passed this whole suite before (1) compared the entry it was handed.
    const world = makeWorld();
    const inner = goodCommitter(world.rows);
    const second: WrapCommitter = {
      ...inner,
      async commitWraps(requests): Promise<readonly WrapReceipt[]> {
        const receipts = await inner.commitWraps(requests);
        const row = world.rows.get(records[1].path);
        if (row !== undefined) {
          const wraps: Record<string, unknown> = {};
          for (const [holder, entry] of Object.entries(parseKeyWraps(row.keyWraps))) {
            wraps[holder] = { ...entry, gen: entry.gen + 1 };
          }
          world.rows.set(records[1].path, { ...row, keyWraps: wraps });
        }
        return receipts;
      },
    };
    await expect(checkWrapCommit(scope, second, world.harness))
      .rejects.toThrow(new RegExp(`read of '${records[1].path}' holds a DIFFERENT wrap`));
  });

  it('refuses its own arguments before it writes anything, including two identical records', async () => {
    const world = makeWorld();
    expect(await asyncCodeOf(() =>
      checkWrapCommit(scope, {} as unknown as WrapCommitter, world.harness))).toBe('VALIDATION_ERROR');
    expect(await asyncCodeOf(() =>
      checkWrapCommit(scope, goodCommitter(world.rows), { records: [records[0], records[0]] } as unknown as WrapCommitHarness)))
      .toBe('VALIDATION_ERROR');
    await expect(checkWrapCommit(scope, goodCommitter(world.rows), {
      ...world.harness, records: [records[0], records[0]] as unknown as readonly [RecordRef, RecordRef],
    })).rejects.toThrow(/two DISTINCT records/);
  });

  it('holds no granularity literal of its own: the scope is where a record type becomes one', async () => {
    // Assertion (10) again, at the level of behaviour rather than of a grep: a record the product's
    // scope does not recognise is refused here, which it could not be if this module guessed.
    const world = makeWorld();
    await expect(checkWrapCommit(scope, goodCommitter(world.rows), {
      ...world.harness,
      records: [
        { type: 'notARecordType', id: 'x', path: 'x/1' },
        records[1],
      ] as unknown as readonly [RecordRef, RecordRef],
    })).rejects.toThrow();
  });
});
