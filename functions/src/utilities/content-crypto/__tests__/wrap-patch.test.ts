/**
 * `wrap-patch.ts` — the ONE reconcile.
 *
 * The table below runs all five upstream operations through `planWraps` and asserts the whole
 * patch for each. What is worth more than the table are the four invariants after it, because each
 * catches a class of bug that a per-transition test cannot see:
 *
 *   - applying the update produces the wraps the patch claims  → a reconcile that under-revokes
 *   - the audit IS the diff, by identity                       → an audit that disagrees with the write
 *   - a transfer is one object                                 → a window where both parties hold wraps
 *   - the sentinel is translated exactly once                  → a revocation that half-works for ever
 */

import { aadForContent } from '../aad';
import { isContentCryptoError } from '../errors';
import { decryptField, encryptField } from '../field-codec';
import {
  KEY_WRAPS_FIELD,
  WRAP_HOLDERS_FIELD,
  holdersOf,
  mintRecordKey,
  parseKeyWraps,
  unwrapRecordKey,
  wrapRecordKey,
} from '../record-key';
import type { KeyWraps, RecordRef, WrapEntry } from '../record-key';
import { KEY_BYTES, dekFromBytes, secretBytes } from '../secret';
import type { RecordKey } from '../secret';
import type { DekHandle } from '../custodian';
import {
  conflictPolicyFor,
  materialiseWrapPatch,
  planWraps,
} from '../wrap-patch';
import type { DesiredWraps, GrantScope, WrapPatch, WrapPatchValue } from '../wrap-patch';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const KEY_BYTES_FIXTURE = Buffer.alloc(KEY_BYTES, 0xa1);
const PRODUCT = 'collab';
const A = 'acc_a';
const B = 'acc_b';
const C = 'acc_c';

const project: RecordRef = { type: 'project', id: 'p_1', path: 'projects/p_1' };
const GRANULARITY = 'aggregate' as const;

function dek(accountId: string, generation: number): DekHandle {
  return {
    generation,
    key: dekFromBytes(KEY_BYTES_FIXTURE, `${PRODUCT}/${accountId}@${generation}`),
  };
}

const AT = '2026-09-10T04:05:06.007Z';
const NOW = () => new Date(AT);

const recordKey: RecordKey = mintRecordKey(project);

function wrapFor(accountId: string, generation: number): WrapEntry {
  return wrapRecordKey({
    productId: PRODUCT,
    dek: dek(accountId, generation),
    accountId,
    record: project,
    recordKey,
    now: NOW,
  });
}

function plan(
  current: KeyWraps,
  desired: DesiredWraps,
  opts: { scope?: GrantScope; actorAccountId?: string } = {},
): WrapPatch {
  return planWraps({
    current,
    desired,
    recordKey,
    productId: PRODUCT,
    record: project,
    granularity: GRANULARITY,
    actorAccountId: opts.actorAccountId ?? A,
    scope: opts.scope,
    now: NOW,
  });
}

/** The applier §16.6 asks for: honour `{ op: 'delete' }` over `current` and see what you get. */
const DELETE = Symbol('delete');

function applyPatch(current: KeyWraps, patch: WrapPatch): Record<string, unknown> {
  const materialised = materialiseWrapPatch(patch, { deleteField: DELETE });
  const out: Record<string, unknown> = { ...current };
  for (const key of Object.keys(materialised)) {
    if (key === WRAP_HOLDERS_FIELD) continue;
    const accountId = key.slice(`${KEY_WRAPS_FIELD}.`.length);
    if (materialised[key] === DELETE) delete out[accountId];
    else out[accountId] = materialised[key];
  }
  return out;
}

function stringsIn(value: unknown, seen = new Set<unknown>(), out: string[] = []): string[] {
  if (typeof value === 'string') {
    out.push(value);
    return out;
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    out.push(String(value));
    return out;
  }
  if (value === null || typeof value !== 'object') return out;
  if (seen.has(value)) return out;
  seen.add(value);
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    out.push(Buffer.from(value).toString('base64'), Buffer.from(value).toString('hex'));
    return out;
  }
  if (Array.isArray(value)) {
    for (const v of value) stringsIn(v, seen, out);
    return out;
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') continue;
    out.push(key);
    let read: unknown;
    try {
      read = (value as Record<string, unknown>)[key];
    } catch {
      continue;
    }
    stringsIn(read, seen, out);
  }
  return out;
}

function expectNoKeyMaterial(value: unknown): void {
  const haystack = stringsIn(value).join(' ');
  for (const bytes of [KEY_BYTES_FIXTURE, Buffer.from(secretBytes(recordKey))]) {
    expect(haystack).not.toContain(bytes.toString('base64'));
    expect(haystack).not.toContain(bytes.toString('base64').replace(/=+$/, ''));
    expect(haystack).not.toContain(bytes.toString('hex'));
  }
}

function codeOf(run: () => unknown): string {
  try {
    run();
  } catch (err) {
    if (isContentCryptoError(err)) return err.code;
    return `not a ContentCryptoError: ${String(err)}`;
  }
  return 'did not throw';
}

function wrapKey(accountId: string): string {
  return `${KEY_WRAPS_FIELD}.${accountId}`;
}

// The starting states the table works from.
const held = (...ids: string[]): KeyWraps => {
  const out: Record<string, WrapEntry> = {};
  for (const id of ids) out[id] = wrapFor(id, 1);
  return out;
};

// ---------------------------------------------------------------------------
// All five transitions, from one table
// ---------------------------------------------------------------------------

describe('the five transitions are five shapes of one call', () => {
  interface Row {
    readonly name: string;
    readonly current: KeyWraps;
    readonly desired: DesiredWraps;
    readonly scope?: GrantScope;
    readonly added: readonly string[];
    readonly removed: readonly string[];
    readonly rewrapped: readonly string[];
    readonly unchanged: readonly string[];
    readonly holdersAfter: readonly string[];
    readonly cutOff: null | 'wrap-only';
    readonly deleteRecord: boolean;
    readonly changed: number;
  }

  const rows: readonly Row[] = [
    {
      name: 'grant — the set plus B',
      current: held(A),
      desired: { [A]: dek(A, 1), [B]: dek(B, 1) },
      scope: 'this-record',
      added: [B],
      removed: [],
      rewrapped: [],
      unchanged: [A],
      holdersAfter: [A, B],
      cutOff: null,
      deleteRecord: false,
      changed: 1,
    },
    {
      name: 'un-share — the set minus B',
      current: held(A, B),
      desired: { [A]: dek(A, 1) },
      added: [],
      removed: [B],
      rewrapped: [],
      unchanged: [A],
      holdersAfter: [A],
      cutOff: 'wrap-only',
      deleteRecord: false,
      changed: 1,
    },
    {
      name: 'transfer — the set minus A plus B, in ONE patch',
      current: held(A),
      desired: { [B]: dek(B, 1) },
      scope: 'this-record',
      added: [B],
      removed: [A],
      rewrapped: [],
      unchanged: [],
      holdersAfter: [B],
      cutOff: 'wrap-only',
      deleteRecord: false,
      changed: 2,
    },
    {
      name: 'rotate — the same set at generation N+1',
      current: held(A, B),
      desired: { [A]: dek(A, 2), [B]: dek(B, 2) },
      added: [],
      removed: [],
      rewrapped: [A, B],
      unchanged: [],
      holdersAfter: [A, B],
      cutOff: null,
      deleteRecord: false,
      changed: 2,
    },
    {
      name: 'erase — the empty set',
      current: held(A, B),
      desired: {},
      added: [],
      removed: [A, B],
      rewrapped: [],
      unchanged: [],
      holdersAfter: [],
      cutOff: 'wrap-only',
      deleteRecord: true,
      changed: 2,
    },
  ];

  for (const row of rows) {
    describe(row.name, () => {
      const patch = plan(row.current, row.desired, { scope: row.scope });

      it('reports the diff the upstream name describes', () => {
        expect(patch.diff.added).toEqual(row.added);
        expect(patch.diff.removed).toEqual(row.removed);
        expect(patch.diff.rewrapped).toEqual(row.rewrapped);
        expect(patch.diff.unchanged).toEqual(row.unchanged);
        expect(patch.changed).toBe(row.changed);
        expect(patch.cutOff).toBe(row.cutOff);
        expect(patch.deleteRecord).toBe(row.deleteRecord);
      });

      it('reports the holder lists, before and after', () => {
        expect(patch.holdersBefore).toEqual(holdersOf(row.current));
        expect(patch.holdersAfter).toEqual(row.holdersAfter);
        expect(patch.holdersAfter).toEqual(Object.keys(row.desired).sort());
        expect(patch.deleteRecord).toBe(patch.holdersAfter.length === 0);
      });

      it('writes exactly the dotted keys for added, removed and rewrapped, plus wrapHolders', () => {
        const expected = [...row.added, ...row.removed, ...row.rewrapped].map(wrapKey).sort();
        expect(Object.keys(patch.update).sort()).toEqual([...expected, WRAP_HOLDERS_FIELD].sort());
        expect(patch.update[WRAP_HOLDERS_FIELD]).toEqual(row.holdersAfter);
      });

      it('leaves an unchanged holder out of the update entirely — the idempotency contract', () => {
        for (const accountId of row.unchanged) {
          expect(Object.prototype.hasOwnProperty.call(patch.update, wrapKey(accountId))).toBe(false);
        }
      });

      it('applying the update produces the wraps the patch claims', () => {
        // THE test that catches a reconcile whose `update` and whose `wraps` disagree — the class
        // of bug that silently under-revokes, and the only one that survives every other check.
        expect(applyPatch(row.current, patch)).toEqual(patch.wraps);
      });

      it('publishes the diff as the audit payload, by identity rather than by recomputation', () => {
        expect(patch.audit.diff).toBe(patch.diff);
        expect(patch.audit.holdersBefore).toBe(patch.holdersBefore);
        expect(patch.audit.holdersAfter).toBe(patch.holdersAfter);
        expect(patch.audit.cutOff).toBe(patch.cutOff);
        expect(patch.audit.productId).toBe(PRODUCT);
        expect(patch.audit.record).toBe(project);
        expect(patch.audit.granularity).toBe(GRANULARITY);
        expect(patch.audit.actorAccountId).toBe(A);
        expect(patch.audit.at).toBe(AT);
      });

      it('records a scope exactly when something was added', () => {
        expect(patch.audit.scope).toBe(row.added.length > 0 ? (row.scope as GrantScope) : null);
      });

      it('carries no key material, anywhere in the patch', () => {
        expectNoKeyMaterial(patch);
      });

      it('is planned again against its own result as a no-op', () => {
        const applied = parseKeyWraps(applyPatch(row.current, patch));
        const again = plan(applied, row.desired, { scope: row.scope });
        expect(again.changed).toBe(0);
        expect(again.update).toEqual({});
        expect(again.diff.unchanged).toEqual(row.holdersAfter);
      });
    });
  }
});

// ---------------------------------------------------------------------------
// The invariants worth more than the table
// ---------------------------------------------------------------------------

describe('a transfer is ONE patch', () => {
  it('emits the addition and the removal as one object, with no way to obtain either half', () => {
    // Stated negatively on purpose. Composed as grant-then-remove there is a window in which both
    // accounts hold wraps, and a failure between the halves leaves the record silently shared with
    // both halves having succeeded as far as either could see. There is no `planGrant`, no
    // `planRemoveWrap` and no `move` to compose, and this asserts the consequence: one update, one
    // commit, and both keys inside it.
    const patch = plan(held(A), { [B]: dek(B, 1) }, { scope: 'this-record' });
    expect(Object.keys(patch.update).sort()).toEqual(
      [wrapKey(A), wrapKey(B), WRAP_HOLDERS_FIELD].sort(),
    );
    expect(patch.update[wrapKey(A)]).toEqual({ op: 'delete' });
    expect(patch.update[wrapKey(B)]).toHaveProperty('wrapped');
    // One object: there is no partially-committable state in which A is gone and B is not.
    expect(patch.diff.added).toEqual([B]);
    expect(patch.diff.removed).toEqual([A]);
    expect(patch.wraps).toEqual({ [B]: patch.update[wrapKey(B)] });
  });
});

describe('idempotence, twice over', () => {
  it('a desired set equal to current gives { changed: 0, update: {} }', () => {
    const current = held(A, B);
    const patch = plan(current, { [A]: dek(A, 1), [B]: dek(B, 1) });
    expect(patch.changed).toBe(0);
    expect(patch.update).toEqual({});
    expect(patch.diff).toEqual({ added: [], removed: [], rewrapped: [], unchanged: [A, B] });
    expect(patch.wraps).toEqual(current);
    expect(patch.cutOff).toBeNull();
    expect(patch.deleteRecord).toBe(false);
  });

  it('a rotate that has already happened is a comparison and no write', () => {
    const current = held(A);
    const rotated = parseKeyWraps(applyPatch(current, plan(current, { [A]: dek(A, 2) })));
    const again = plan(rotated, { [A]: dek(A, 2) });
    expect(again.changed).toBe(0);
    expect(again.update).toEqual({});
    expect(again.diff.rewrapped).toEqual([]);
    expect(again.diff.unchanged).toEqual([A]);
  });

  it('an erase re-run over an already-empty record writes nothing and still says deleteRecord', () => {
    const patch = plan({}, {});
    expect(patch.changed).toBe(0);
    expect(patch.update).toEqual({});
    expect(patch.deleteRecord).toBe(true);
    expect(patch.cutOff).toBeNull();
  });
});

describe('the wraps the patch produces really are the record key', () => {
  it('a granted partner can open content sealed before the grant existed', () => {
    const aad = aadForContent('projects', project.id, 'name');
    const sealed = encryptField(recordKey, aad, 'Alpha');
    const patch = plan(held(A), { [A]: dek(A, 1), [B]: dek(B, 1) }, { scope: 'this-record' });
    const granted = patch.wraps[B];
    const opened = unwrapRecordKey({
      productId: PRODUCT,
      dek: dek(B, 1),
      accountId: B,
      record: project,
      wrap: granted,
    });
    expect(decryptField(opened, aad, sealed)).toBe('Alpha');
  });

  it('a rotated wrap opens under the new generation and no content moved', () => {
    const aad = aadForContent('projects', project.id, 'name');
    const sealed = encryptField(recordKey, aad, 'Alpha');
    const patch = plan(held(A), { [A]: dek(A, 5) });
    expect(patch.wraps[A].gen).toBe(5);
    const opened = unwrapRecordKey({
      productId: PRODUCT,
      dek: dek(A, 5),
      accountId: A,
      record: project,
      wrap: patch.wraps[A],
    });
    expect(decryptField(opened, aad, sealed)).toBe('Alpha');
  });

  it('stamps every new wrap with the same instant as the audit entry', () => {
    const patch = plan(held(A), { [A]: dek(A, 2), [B]: dek(B, 1) }, { scope: 'this-record' });
    expect(patch.wraps[A].at).toBe(AT);
    expect(patch.wraps[B].at).toBe(AT);
    expect(patch.audit.at).toBe(AT);
  });
});

// ---------------------------------------------------------------------------
// The sentinel and its translation
// ---------------------------------------------------------------------------

describe('materialiseWrapPatch — the translation contract, as a function', () => {
  const patch = plan(held(A, B), { [A]: dek(A, 1) });

  it('leaves the sentinel in patch.update, where it is assertable and loggable', () => {
    expect(patch.update[wrapKey(B)]).toEqual({ op: 'delete' });
  });

  it('replaces every sentinel with the store’s own, and nothing else survives sentinel-shaped', () => {
    const materialised = materialiseWrapPatch(patch, { deleteField: DELETE });
    expect(materialised[wrapKey(B)]).toBe(DELETE);
    for (const value of Object.values(materialised)) {
      const looksLikeSentinel =
        typeof value === 'object' && value !== null && (value as { op?: unknown }).op === 'delete';
      expect(looksLikeSentinel).toBe(false);
    }
  });

  it('passes every other value through BY REFERENCE, so no wrap is re-serialised on the way out', () => {
    const grant = plan(held(A), { [A]: dek(A, 1), [B]: dek(B, 1) }, { scope: 'this-record' });
    const materialised = materialiseWrapPatch(grant, { deleteField: DELETE });
    expect(materialised[wrapKey(B)]).toBe(grant.update[wrapKey(B)]);
    expect(materialised[WRAP_HOLDERS_FIELD]).toBe(grant.update[WRAP_HOLDERS_FIELD]);
  });

  it('keys the output exactly as the patch keyed it', () => {
    expect(Object.keys(materialiseWrapPatch(patch, { deleteField: DELETE })).sort()).toEqual(
      Object.keys(patch.update).sort(),
    );
  });

  it('translates a sentinel that has been round-tripped through JSON, as a queued job’s would be', () => {
    const revived = JSON.parse(JSON.stringify(patch)) as WrapPatch;
    const materialised = materialiseWrapPatch(revived, { deleteField: DELETE });
    expect(materialised[wrapKey(B)]).toBe(DELETE);
  });

  it('refuses to run without a delete sentinel, because a revocation that half-works is worse', () => {
    // Writing `patch.update` raw stores the literal map at `keyWraps.{accountId}`, which the
    // tolerant parser then drops — so the revocation half-works, invisibly, for ever, while
    // anything reading the raw map's keys still counts the revoked partner as a holder.
    expect(codeOf(() => materialiseWrapPatch(patch, { deleteField: undefined }))).toBe(
      'VALIDATION_ERROR',
    );
    expect(
      codeOf(() => materialiseWrapPatch(patch, undefined as unknown as { deleteField: unknown })),
    ).toBe('VALIDATION_ERROR');
  });

  it('refuses anything that is not a patch', () => {
    for (const bad of [undefined, null, 'x', 42, [], {}]) {
      expect(codeOf(() => materialiseWrapPatch(bad as unknown as WrapPatch, { deleteField: DELETE }))).toBe(
        'VALIDATION_ERROR',
      );
    }
  });

  it('returns a plain, writable object a caller can spread beside its own fields', () => {
    const materialised = materialiseWrapPatch(patch, { deleteField: DELETE });
    const combined: Record<string, unknown> = { scopeChangedAt: 'now', ...materialised };
    expect(Object.keys(combined)).toContain('scopeChangedAt');
    expect(combined[wrapKey(B)]).toBe(DELETE);
  });

  it('does not let a `__proto__` holder id reshape the object it builds', () => {
    // Built with `defineProperty`, because `{ __proto__: … }` in a literal sets the prototype
    // rather than creating the key — which is the whole hazard being tested.
    const desired: Record<string, DekHandle> = {};
    Object.defineProperty(desired, '__proto__', {
      value: dek('__proto__', 1),
      enumerable: true,
      writable: true,
      configurable: true,
    });
    const hostile = plan({}, desired, { scope: 'this-record' });
    const materialised = materialiseWrapPatch(hostile, { deleteField: DELETE });
    expect(Object.getPrototypeOf(materialised)).toBe(Object.prototype);
    expect(Object.keys(materialised).sort()).toEqual(
      [`${KEY_WRAPS_FIELD}.__proto__`, WRAP_HOLDERS_FIELD].sort(),
    );
  });
});

// ---------------------------------------------------------------------------
// Refusals
// ---------------------------------------------------------------------------

describe('a grant needs a scope, because a boolean cannot carry the decision into the audit', () => {
  it('throws VALIDATION_ERROR when anything is added and no scope was chosen', () => {
    expect(codeOf(() => plan(held(A), { [A]: dek(A, 1), [B]: dek(B, 1) }))).toBe('VALIDATION_ERROR');
    expect(codeOf(() => plan({}, { [A]: dek(A, 1) }))).toBe('VALIDATION_ERROR');
  });

  it('does not require one for a revoke, a rotate or an erase', () => {
    expect(() => plan(held(A, B), { [A]: dek(A, 1) })).not.toThrow();
    expect(() => plan(held(A), { [A]: dek(A, 2) })).not.toThrow();
    expect(() => plan(held(A), {})).not.toThrow();
  });

  it('records null rather than the scope it was handed when nothing was added', () => {
    const patch = plan(held(A, B), { [A]: dek(A, 1) }, { scope: 'this-record' });
    expect(patch.diff.added).toEqual([]);
    expect(patch.audit.scope).toBeNull();
  });

  it('refuses a scope outside the closed set', () => {
    expect(
      // @ts-expect-error — 'everything' is not a GrantScope, and the union exists to say so
      codeOf(() => plan(held(A), { [A]: dek(A, 1), [B]: dek(B, 1) }, { scope: 'everything' })),
    ).toBe('VALIDATION_ERROR');
  });
});

describe('planWraps refuses what it cannot faithfully express', () => {
  it('needs the open record key, not a DEK and not a handle-shaped object', () => {
    expect(
      codeOf(() =>
        planWraps({
          current: {},
          desired: {},
          recordKey: dek(A, 1).key as unknown as RecordKey,
          productId: PRODUCT,
          record: project,
          granularity: GRANULARITY,
          actorAccountId: A,
        }),
      ),
    ).toBe('VALIDATION_ERROR');
    expect(
      codeOf(() =>
        planWraps({
          current: {},
          desired: {},
          recordKey: undefined as unknown as RecordKey,
          productId: PRODUCT,
          record: project,
          granularity: GRANULARITY,
          actorAccountId: A,
        }),
      ),
    ).toBe('VALIDATION_ERROR');
  });

  it('needs an actorAccountId: an audit entry that cannot say who acted is not one', () => {
    expect(codeOf(() => plan(held(A), { [A]: dek(A, 1) }, { actorAccountId: '' }))).toBe(
      'VALIDATION_ERROR',
    );
  });

  it('needs a record ref with a path, even for an erase that plans no wraps at all', () => {
    expect(
      codeOf(() =>
        planWraps({
          current: {},
          desired: {},
          recordKey,
          productId: PRODUCT,
          record: { type: 'project', id: 'p_1', path: '' },
          granularity: GRANULARITY,
          actorAccountId: A,
        }),
      ),
    ).toBe('VALIDATION_ERROR');
  });

  it('needs a real DekHandle for every desired holder, INCLUDING one that turns out unchanged', () => {
    // Comparing a stored `gen` against a missing `generation` would quietly answer "unchanged" and
    // skip the rewrap the caller asked for — a rotation that reports success having done nothing.
    expect(
      codeOf(() => plan(held(A), { [A]: { generation: 1 } as unknown as DekHandle })),
    ).toBe('VALIDATION_ERROR');
    expect(codeOf(() => plan(held(A), { [A]: undefined as unknown as DekHandle }))).toBe(
      'VALIDATION_ERROR',
    );
    expect(
      codeOf(() =>
        plan(held(A), { [A]: { generation: 1, key: recordKey } as unknown as DekHandle }),
      ),
    ).toBe('VALIDATION_ERROR');
  });

  it('refuses a holder id it could not address as one dotted key', () => {
    expect(codeOf(() => plan({}, { 'a.b': dek('a.b', 1) }, { scope: 'this-record' }))).toBe(
      'VALIDATION_ERROR',
    );
    expect(codeOf(() => plan({}, { 'a/b': dek('a/b', 1) }, { scope: 'this-record' }))).toBe(
      'VALIDATION_ERROR',
    );
    expect(codeOf(() => plan({}, { '': dek('x', 1) }, { scope: 'this-record' }))).toBe(
      'VALIDATION_ERROR',
    );
    // And on the way out too: a holder it cannot address is one it cannot remove, and leaving it
    // behind would break the apply invariant.
    const hostile = { 'a.b': wrapFor(A, 1) } as unknown as KeyWraps;
    expect(codeOf(() => plan(hostile, {}))).toBe('VALIDATION_ERROR');
  });

  it('carries no key material out through any of those refusals', () => {
    let thrown: unknown;
    try {
      plan(held(A), { [A]: dek(A, 1), [B]: dek(B, 1) });
    } catch (err) {
      thrown = err;
    }
    expect(isContentCryptoError(thrown, 'VALIDATION_ERROR')).toBe(true);
    expectNoKeyMaterial(thrown);
  });
});

// ---------------------------------------------------------------------------
// Reading a store that is not tidy
// ---------------------------------------------------------------------------

describe('a `current` that the store did not keep tidy', () => {
  it('does not count a malformed entry as a holder', () => {
    const current = { [A]: wrapFor(A, 1), [B]: { op: 'delete' } } as unknown as KeyWraps;
    const patch = plan(current, { [A]: dek(A, 1), [B]: dek(B, 1) }, { scope: 'this-record' });
    expect(patch.holdersBefore).toEqual([A]);
    expect(patch.diff.added).toEqual([B]);
    expect(patch.diff.unchanged).toEqual([A]);
  });

  it('REMOVES a malformed entry when it is not wanted, which is the only way one ever leaves', () => {
    // An untranslated `{ op: 'delete' }` in the store is the exact residue of writing a patch raw.
    // It is not a holder, but it IS a key in the map, so a later reconcile has to delete it or it
    // survives every reconcile for ever.
    const current = { [A]: wrapFor(A, 1), [B]: { op: 'delete' } } as unknown as KeyWraps;
    const patch = plan(current, { [A]: dek(A, 1) });
    expect(patch.diff.removed).toEqual([B]);
    expect(patch.update[wrapKey(B)]).toEqual({ op: 'delete' });
    expect(applyPatch(parseKeyWraps(current), patch)).toEqual(patch.wraps);
  });

  it('keeps the parsed entry for an unchanged holder, so patch.wraps is the shape it claims', () => {
    const current = {
      [A]: { ...wrapFor(A, 1), aad: 'record-key/collab/acc_a/1/projects/p_1' },
    } as unknown as KeyWraps;
    const patch = plan(current, { [A]: dek(A, 1) });
    expect(Object.keys(patch.wraps[A]).sort()).toEqual(['at', 'gen', 'wrapped']);
  });

  it('treats a `current` that is not a map at all as an empty one', () => {
    for (const current of [undefined, null, 'x', 42, []]) {
      const patch = plan(current as unknown as KeyWraps, {});
      expect(patch.holdersBefore).toEqual([]);
      expect(patch.changed).toBe(0);
      expect(patch.deleteRecord).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// conflictPolicyFor
// ---------------------------------------------------------------------------

describe('conflictPolicyFor', () => {
  it('skips only a pure rewrap; everything else retries, because dropping a conflicted revoke silently drops the revocation', () => {
    const table: readonly [string, WrapPatch, 'skip' | 'retry'][] = [
      ['grant', plan(held(A), { [A]: dek(A, 1), [B]: dek(B, 1) }, { scope: 'this-record' }), 'retry'],
      ['un-share', plan(held(A, B), { [A]: dek(A, 1) }), 'retry'],
      ['transfer', plan(held(A), { [B]: dek(B, 1) }, { scope: 'this-record' }), 'retry'],
      ['rotate', plan(held(A, B), { [A]: dek(A, 2), [B]: dek(B, 2) }), 'skip'],
      ['erase', plan(held(A, B), {}), 'retry'],
    ];
    for (const [name, patch, expected] of table) {
      expect([name, conflictPolicyFor(patch)]).toEqual([name, expected]);
    }
  });

  it('skips a no-op, which has nothing to write in the first place', () => {
    expect(conflictPolicyFor(plan(held(A), { [A]: dek(A, 1) }))).toBe('skip');
  });

  it('refuses anything that is not a patch, rather than defaulting to the dangerous answer', () => {
    for (const bad of [undefined, null, 'x', {}, { diff: {} }]) {
      expect(codeOf(() => conflictPolicyFor(bad as unknown as WrapPatch))).toBe('VALIDATION_ERROR');
    }
  });
});

// ---------------------------------------------------------------------------
// Immutability of what is handed back
// ---------------------------------------------------------------------------

describe('the patch is frozen, so an audit entry cannot be edited after the fact', () => {
  // Captured once: `held()` mints a fresh IV on every call, so re-deriving `current` for the
  // apply-invariant below would compare a patch against wraps it never saw.
  const current = held(A, B);
  const patch = plan(current, { [B]: dek(B, 1), [C]: dek(C, 1) }, { scope: 'this-engagement' });

  it('freezes the patch, its update, its diff, its holder lists and its audit', () => {
    expect(Object.isFrozen(patch)).toBe(true);
    expect(Object.isFrozen(patch.update)).toBe(true);
    expect(Object.isFrozen(patch.wraps)).toBe(true);
    expect(Object.isFrozen(patch.diff)).toBe(true);
    expect(Object.isFrozen(patch.diff.added)).toBe(true);
    expect(Object.isFrozen(patch.holdersAfter)).toBe(true);
    expect(Object.isFrozen(patch.audit)).toBe(true);
  });

  it('is a three-way change in one object: C added, A removed, B untouched', () => {
    expect(patch.diff.added).toEqual([C]);
    expect(patch.diff.removed).toEqual([A]);
    expect(patch.diff.unchanged).toEqual([B]);
    expect(patch.changed).toBe(2);
    expect(patch.holdersAfter).toEqual([B, C]);
    expect(applyPatch(current, patch)).toEqual(patch.wraps);
  });

  it('types the update as WrapPatchValue and nothing wider', () => {
    const values: readonly WrapPatchValue[] = Object.values(patch.update);
    expect(values.length).toBe(3);
  });
});
