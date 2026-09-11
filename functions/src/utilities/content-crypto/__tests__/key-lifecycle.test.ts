/**
 * `key-lifecycle.ts` — **the fourteen footguns, fourteen named tests.**
 *
 * Every test is *seed a row, call a planner, assert on the returned patch*, because the
 * planners are pure: no store, no clock beyond an injected `now`, no I/O. collab's custodian
 * suite ports almost entirely this way. Its transaction-race test does **not** port and should
 * not — it tests the store, and the store is the consumer's.
 *
 * Each test name is the rule, so a failure names the footgun. §12.5's numbering is the index,
 * and the line references in `key-lifecycle.ts` point at the collab source each was learned
 * from.
 *
 * Four cross-cutting assertions run over the whole planner table rather than per rule, and one
 * of them departs from the spec deliberately: §16.9 asks for `assertNoSecrets(p.audit)`, and
 * `assertNoSecrets` is an ERROR-DETAILS assertion over a closed 18-key scalar allowlist —
 * applying it to a structured audit payload is a category error, and widening the allowlist
 * would defeat the thing it exists to do. `assertNoKeyMaterial` is the check for this threat
 * model: recursive, value-level, no opinion about which keys a payload may carry.
 */

import { assertNoKeyMaterial, isContentCryptoError } from '../errors';
import {
  assertContentKeyPatch,
  isRefusal,
  KEY_PATCH_DELETE,
  KEY_PATCH_SERVER_TIME,
} from '../key-store';
import type { GenerationRow, ContentKeyPatch, ContentKeyPatchValue, ContentKeyRow, Refusal } from '../key-store';
import {
  deriveStatus,
  MAX_ROTATION_ERROR_CHARS,
  planBeginRotation,
  planDestroy,
  planDrain,
  planFailRotation,
  planFinishRotation,
  planMint,
  planRecordProgress,
  planRegenerate,
  planRestore,
  planRevoke,
  toContentKeyStatus,
  toGenerationStatus,
} from '../key-lifecycle';
import type { OpenRotation } from '../custodian';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const AT = '2026-09-11T09:00:00.000Z';
const EARLIER = '2026-09-01T09:00:00.000Z';
const now = () => new Date(AT);

/** What the store's own server timestamp resolves to, for the row applier below. */
const SERVER_TIME_RESOLVES_TO = '2026-09-11T09:00:00.500Z';

function row(over: Partial<ContentKeyRow> = {}): ContentKeyRow {
  return {
    accountId: 'acc_1',
    productId: 'collab',
    currentGeneration: 1,
    createdAt: EARLIER,
    revokedAt: null,
    revokedCause: null,
    destroyedAt: null,
    destroyedThrough: null,
    rotation: null,
    ...over,
  };
}

function gen(over: Partial<GenerationRow> = {}): GenerationRow {
  return {
    n: 1,
    hasWrap: true,
    kmsKeyVersion: 'v1',
    createdAt: EARLIER,
    retiredAt: null,
    drainedAt: null,
    destroyedAt: null,
    ...over,
  };
}

function openRotation(over: Partial<OpenRotation> = {}): OpenRotation {
  return { generation: 2, startedAt: EARLIER, finishedAt: null, error: null, progress: {}, ...over };
}

/** Narrow, and say which planner disagreed when it does not. */
function asPatch(result: ContentKeyPatch | Refusal, what = 'the planner'): ContentKeyPatch {
  if (isRefusal(result)) throw new Error(`${what} refused unexpectedly: ${result.code} — ${result.message}`);
  return result;
}

function asRefusal(result: ContentKeyPatch | Refusal, what = 'the planner'): Refusal {
  if (!isRefusal(result)) throw new Error(`${what} returned a patch where a refusal was expected`);
  return result;
}

/**
 * Apply a patch's `key` to a row, the way a store would: dotted keys as field paths, sentinels
 * translated. Only what the cross-cutting status assertion needs — the full §12.2 applier lives
 * in `key-store.test.ts`, where it is the subject rather than a tool.
 */
function applyKey(before: ContentKeyRow | null, patch: ContentKeyPatch): ContentKeyRow {
  const doc: Record<string, unknown> = before === null ? {} : JSON.parse(JSON.stringify(before));
  for (const [path, value] of Object.entries(patch.key)) {
    const segments = path.split('.');
    let node = doc;
    for (let i = 0; i < segments.length - 1; i += 1) {
      const seg = segments[i];
      if (node[seg] === null || typeof node[seg] !== 'object') node[seg] = {};
      node = node[seg] as Record<string, unknown>;
    }
    const last = segments[segments.length - 1];
    const v: ContentKeyPatchValue = value;
    if (v !== null && typeof v === 'object' && 'op' in v) {
      if (v.op === 'delete') delete node[last];
      else node[last] = SERVER_TIME_RESOLVES_TO;
    } else {
      node[last] = v;
    }
  }
  return doc as unknown as ContentKeyRow;
}

// ---------------------------------------------------------------------------
// THE FOURTEEN RULES
// ---------------------------------------------------------------------------

describe('rule 1 — destroy refuses unless the row is already REVOKED', () => {
  it('refuses ACCOUNT_KEY_NOT_REVOKED on a healthy account', () => {
    // Prevents irreversible erasure one click away from a healthy account. Revoked is the
    // cooling-off: content is already unreadable and nothing has been erased yet.
    const r = asRefusal(planDestroy({ row: row(), generations: [gen()], now }));
    expect(r.code).toBe('ACCOUNT_KEY_NOT_REVOKED');
    expect(r.message).toMatch(/revoke this account key before destroying it/i);
  });

  it('proceeds once the key is revoked', () => {
    const p = asPatch(planDestroy({ row: row({ revokedAt: EARLIER, revokedCause: 'incident' }), generations: [gen()], now }));
    expect(p.key.destroyedAt).toBe(AT);
  });

  it('refuses ACCOUNT_KEY_DESTROYED on a second destroy', () => {
    const r = asRefusal(
      planDestroy({ row: row({ revokedAt: EARLIER, destroyedAt: EARLIER }), generations: [], now }),
    );
    expect(r.code).toBe('ACCOUNT_KEY_DESTROYED');
  });
});

describe('rule 2 — regenerate mints N+1 BEFORE clearing the tombstone, and destroyedThrough SURVIVES', () => {
  const destroyed = row({
    currentGeneration: 3,
    revokedAt: EARLIER,
    revokedCause: 'client-request',
    destroyedAt: EARLIER,
    destroyedThrough: 3,
  });

  it('names the mint in the patch, which is what carries the ordering', () => {
    // Prevents a window in which the account looks healthy but every read serves a key that is
    // gone. The ordering is a property of the patch's shape, not of a comment.
    const p = asPatch(planRegenerate({ row: destroyed, now }));
    expect(p.mint).toEqual({ generation: 4 });
    expect(p.key.currentGeneration).toBe(4);
  });

  it('clears the tombstone and the revocation, and leaves destroyedThrough alone', () => {
    const p = asPatch(planRegenerate({ row: destroyed, now }));
    expect(p.key.destroyedAt).toBeNull();
    expect(p.key.revokedAt).toBeNull();
    expect(p.key.revokedCause).toBeNull();
    expect(p.key.rotation).toBeNull();
    // THE STRUCTURAL ASSERTION: the key is not merely `destroyedThrough: 3`, it is ABSENT.
    // A patch that omits it cannot get it wrong; one that writes it can.
    expect(Object.keys(p.key)).not.toContain('destroyedThrough');
    expect(applyKey(destroyed, p).destroyedThrough).toBe(3);
  });

  it('refuses ACCOUNT_KEY_NOT_DESTROYED on an account that is merely revoked', () => {
    const r = asRefusal(planRegenerate({ row: row({ revokedAt: EARLIER, revokedCause: 'sysadmin' }), now }));
    expect(r.code).toBe('ACCOUNT_KEY_NOT_DESTROYED');
    expect(r.message).toMatch(/use restore/i);
  });
});

describe('rule 3 — a generation row that EXISTS WITHOUT A WRAP is never minted into', () => {
  it('refuses ACCOUNT_KEY_DESTROYED rather than minting a replacement', () => {
    // Prevents the account looking healthy while everything under that generation became
    // noise. Only a row that has NEVER existed may be minted.
    const r = asRefusal(
      planMint({
        row: row({ currentGeneration: 2 }),
        generationRow: gen({ n: 2, hasWrap: false, drainedAt: EARLIER }),
        accountId: 'acc_1',
        productId: 'collab',
        now,
      }),
    );
    expect(r.code).toBe('ACCOUNT_KEY_DESTROYED');
    expect(r.message).toMatch(/drained or destroyed/);
  });

  it('loads the winner rather than minting a second key when the row already has a wrap', () => {
    const p = asPatch(
      planMint({ row: row(), generationRow: gen({ n: 1, hasWrap: true }), accountId: 'acc_1', productId: 'collab', now }),
    );
    expect(p.changed).toBe(0);
    expect(p.mint).toBeNull();
    expect(p.evict).toBe(false);
  });

  it('has no parameter through which a caller can ask for an arbitrary generation', () => {
    // Footgun 3's teeth: the target is DERIVED as `row?.currentGeneration ?? 1`.
    const p = asPatch(planMint({ row: row({ currentGeneration: 7 }), generationRow: null, accountId: 'acc_1', productId: 'collab', now }));
    expect(p.mint).toEqual({ generation: 7 });

    const first = asPatch(planMint({ row: null, generationRow: null, accountId: 'acc_1', productId: 'collab', now }));
    expect(first.mint).toEqual({ generation: 1 });
    expect(first.createIfMissing).toBe(true);
  });
});

describe('rule 4 — a mint NEVER writes revokedAt, revokedCause, destroyedAt or destroyedThrough', () => {
  it('writes exactly four keys, and none of them is a tombstone', () => {
    // Prevents a mint silently resurrecting a destroyed account as a side effect of its merge.
    // collab carries the four forward explicitly because its merge writes a literal map; a
    // patch that omits them cannot be got wrong, so the rule is structural rather than a
    // vigilance requirement.
    const p = asPatch(planMint({ row: null, generationRow: null, accountId: 'acc_1', productId: 'collab', now }));
    expect(Object.keys(p.key).sort()).toEqual(['accountId', 'createdAt', 'currentGeneration', 'productId']);
    for (const forbidden of ['revokedAt', 'revokedCause', 'destroyedAt', 'destroyedThrough']) {
      expect(Object.keys(p.key)).not.toContain(forbidden);
    }
    expect(p.key.createdAt).toEqual(KEY_PATCH_SERVER_TIME);
  });

  it('refuses to mint at all under a revoked or destroyed row, which is the other half', () => {
    expect(asRefusal(planMint({ row: row({ revokedAt: EARLIER }), generationRow: null, accountId: 'acc_1', productId: 'collab', now })).code)
      .toBe('ACCOUNT_KEY_REVOKED');
    expect(asRefusal(planMint({ row: row({ revokedAt: EARLIER, destroyedAt: EARLIER }), generationRow: null, accountId: 'acc_1', productId: 'collab', now })).code)
      .toBe('ACCOUNT_KEY_DESTROYED');
  });
});

describe('rule 5 — revokedCause is STORED, never derived', () => {
  it('writes the cause on every revoke', () => {
    // Prevents restore clearing the flag, the next cold load re-deriving it, and the button
    // appearing to do nothing.
    const p = asPatch(planRevoke({ row: row(), cause: 'account-deactivated', now }));
    expect(p.key.revokedCause).toBe('account-deactivated');
    expect(p.audit.cause).toBe('account-deactivated');
  });

  it('refuses a revoke with no cause', () => {
    // @ts-expect-error — a revoke without a cause is a restore that cannot be reasoned about.
    expect(() => planRevoke({ row: row(), cause: '', now })).toThrow(/needs a RevokedCause/);
  });

  it('clears it on restore, so the stored value is the only source', () => {
    const p = asPatch(planRestore({ row: row({ revokedAt: EARLIER, revokedCause: 'incident' }), causeStillHolds: false, now }));
    expect(p.key.revokedCause).toBeNull();
    expect(p.key.revokedAt).toBeNull();
    expect(p.audit.cause).toBe('incident');
  });
});

describe('rule 6 — failRotation records the error and leaves the rotation OPEN', () => {
  const rotating = row({ currentGeneration: 2, rotation: openRotation() });

  it('writes rotation.error and no finishedAt', () => {
    // Prevents stacking a second rotation on a failed one, which is how a generation gets
    // stranded: N+1 becomes current, N is never drained, and nothing says so.
    const p = asPatch(planFailRotation({ row: rotating, error: 'KEY_SOURCE_UNAVAILABLE', now }));
    expect(p.key).toEqual({ 'rotation.error': 'KEY_SOURCE_UNAVAILABLE' });
    expect(Object.keys(p.key)).not.toContain('rotation.finishedAt');
  });

  it('leaves the rotation open, so a second beginRotation still refuses', () => {
    const failed = row({ currentGeneration: 2, rotation: openRotation({ error: 'KEY_SOURCE_UNAVAILABLE' }) });
    expect(asRefusal(planBeginRotation({ row: failed, now })).code).toBe('ROTATION_IN_PROGRESS');
    // …and the refusal says the rotation has recorded an error, which is what an operator page
    // needs in order to offer the right next action.
    expect(asRefusal(planBeginRotation({ row: failed, now })).message).toMatch(/recorded an error/);
  });

  it('refuses when there is no open rotation to fail', () => {
    expect(asRefusal(planFailRotation({ row: row(), error: 'X', now })).code).toBe('VALIDATION_ERROR');
    const finished = row({ rotation: openRotation({ finishedAt: EARLIER }) });
    expect(asRefusal(planFailRotation({ row: finished, error: 'X', now })).code).toBe('VALIDATION_ERROR');
  });

  describe('§11.6.1 — the third leak path: hand it a CODE, never a caught error message', () => {
    it('caps at MAX_ROTATION_ERROR_CHARS, ellipsis included', () => {
      expect(MAX_ROTATION_ERROR_CHARS).toBe(500);
      const long = 'x'.repeat(5000);
      const p = asPatch(planFailRotation({ row: rotating, error: long, now }));
      const stored = p.key['rotation.error'] as string;
      expect(stored).toHaveLength(MAX_ROTATION_ERROR_CHARS);
      expect(stored.endsWith('…')).toBe(true);
    });

    it('leaves a code alone — a code is never near the cap', () => {
      const p = asPatch(planFailRotation({ row: rotating, error: 'ROTATION_TIMEOUT', now }));
      expect(p.key['rotation.error']).toBe('ROTATION_TIMEOUT');
    });

    it('refuses key material in every spelling, because this string is stored and rendered', () => {
      for (const dek of [
        'A'.repeat(43), // unpadded base64
        `${'A'.repeat(43)}=`, // padded base64
        'ab'.repeat(32), // hex
        `${'-'.repeat(21)}_${'A'.repeat(21)}`, // base64url
      ]) {
        expect(() => planFailRotation({ row: rotating, error: dek, now })).toThrow(/assertNoKeyMaterial/);
      }
    });

    it('refuses sealed material under all three envelope grammars', () => {
      // `assertNoKeyMaterial` deliberately does not flag ciphertext — it is meant to be stored
      // and logged — but a status field an operator reads is not where it belongs. This is the
      // test that catches the list here drifting from `assertNoSecrets` rule 5.
      for (const prefix of ['enc:', 'wrap:', 'dev:']) {
        expect(() => planFailRotation({ row: rotating, error: `${prefix}v3:AAAA`, now })).toThrow(
          /will not store sealed material/,
        );
      }
    });

    it('refuses an empty error, and says what to hand it instead', () => {
      expect(() => planFailRotation({ row: rotating, error: '   ', now })).toThrow(
        /Hand it a code .* never the message of a caught error/,
      );
    });

    it('caps BEFORE it scans, so a huge body is refused rather than walked', () => {
      // A 32-byte key hidden past the cap is truncated away rather than stored; the cap is the
      // first line and the scan is the second.
      const hidden = `${'x'.repeat(600)}${'A'.repeat(43)}`;
      const p = asPatch(planFailRotation({ row: rotating, error: hidden, now }));
      expect(p.key['rotation.error']).not.toMatch(/A{43}/);
    });
  });
});

describe('rule 7 — status is DERIVED at the wire boundary: destroyed ?? revoked ?? active', () => {
  it('derives all three, in that order', () => {
    // Prevents a stored status drifting from the timestamps.
    expect(deriveStatus({ revokedAt: null, destroyedAt: null })).toBe('active');
    expect(deriveStatus({ revokedAt: EARLIER, destroyedAt: null })).toBe('revoked');
    expect(deriveStatus({ revokedAt: EARLIER, destroyedAt: EARLIER })).toBe('destroyed');
    // Destroyed wins even in the shape rule 1 makes impossible, because the arithmetic must
    // not depend on rule 1 holding somewhere else.
    expect(deriveStatus({ revokedAt: null, destroyedAt: EARLIER })).toBe('destroyed');
  });

  it('puts the derived status on the wire beside the STORED cause', () => {
    // The deliberate tension with rule 5 — the cause is stored, the status is derived — is the
    // point, not an inconsistency.
    const wire = toContentKeyStatus(row({ revokedAt: EARLIER, revokedCause: 'sysadmin', destroyedThrough: 2 }));
    expect(wire.status).toBe('revoked');
    expect(wire.revokedCause).toBe('sysadmin');
    expect(wire.destroyedThrough).toBe(2);
  });

  it('has no status to store on the row in the first place', () => {
    expect(Object.keys(row())).not.toContain('status');
  });

  it('renders a generation field for field', () => {
    const g = gen({ n: 2, retiredAt: EARLIER });
    expect(toGenerationStatus(g)).toEqual({
      n: 2,
      kmsKeyVersion: 'v1',
      hasWrap: true,
      createdAt: EARLIER,
      retiredAt: EARLIER,
      drainedAt: null,
      destroyedAt: null,
    });
  });
});

describe('rule 8 — restore refuses ACCOUNT_KEY_CAUSE_HOLDS while the cause still holds', () => {
  it('refuses while the account is still deactivated', () => {
    // Prevents a button that lies: restore, and the next sweep takes it away again.
    const r = asRefusal(
      planRestore({ row: row({ revokedAt: EARLIER, revokedCause: 'account-deactivated' }), causeStillHolds: true, now }),
    );
    expect(r.code).toBe('ACCOUNT_KEY_CAUSE_HOLDS');
  });

  it('consults causeStillHolds ONLY for account-deactivated', () => {
    // A sysadmin revoke on a deactivated account still restores, because the sysadmin is the
    // one asking. This is the exact condition, and getting it wrong is a control that cannot
    // be used at the moment it is most needed.
    for (const cause of ['sysadmin', 'client-request', 'incident'] as const) {
      const p = asPatch(planRestore({ row: row({ revokedAt: EARLIER, revokedCause: cause }), causeStillHolds: true, now }));
      expect(p.key.revokedAt).toBeNull();
    }
  });

  it('does no I/O to answer it — the caller supplies the boolean', () => {
    const p = asPatch(
      planRestore({ row: row({ revokedAt: EARLIER, revokedCause: 'account-deactivated' }), causeStillHolds: false, now }),
    );
    expect(p.key).toEqual({ revokedAt: null, revokedCause: null });
  });

  it('refuses a restore on a destroyed key, which no boolean can rescue', () => {
    expect(asRefusal(planRestore({ row: row({ revokedAt: EARLIER, destroyedAt: EARLIER }), causeStillHolds: false, now })).code)
      .toBe('ACCOUNT_KEY_DESTROYED');
  });

  it('is a no-op on a key that is not revoked', () => {
    const p = asPatch(planRestore({ row: row(), causeStillHolds: false, now }));
    expect(p.changed).toBe(0);
    expect(p.key).toEqual({});
    expect(p.generations).toEqual([]);
    expect(p.evict).toBe(false);
  });
});

describe('rule 9 — beginRotation mints N+1, points the account at it, retires N, and DELETES NOTHING', () => {
  const healthy = row({ currentGeneration: 2 });

  it('does the three things and erases nothing', () => {
    // Prevents erasing a wrap before the product reports the generation drained: a value
    // sealed under N that the walk has not reached still needs N's key.
    const p = asPatch(planBeginRotation({ row: healthy, now }));
    expect(p.mint).toEqual({ generation: 3 });
    expect(p.key.currentGeneration).toBe(3);
    expect(p.generations).toEqual([{ n: 2, set: { retiredAt: AT }, eraseWrap: false }]);
    expect(p.generations.every((g) => g.eraseWrap === false)).toBe(true);
  });

  it('opens the rotation with three zeroed progress counters and no error', () => {
    const p = asPatch(planBeginRotation({ row: healthy, now }));
    expect(p.key['rotation.generation']).toBe(3);
    expect(p.key['rotation.startedAt']).toBe(AT);
    expect(p.key['rotation.finishedAt']).toBeNull();
    expect(p.key['rotation.error']).toBeNull();
    expect(p.key['rotation.progress.recordsRewrapped']).toBe(0);
    expect(p.key['rotation.progress.recordsTotal']).toBe(0);
    expect(p.key['rotation.progress.conflicted']).toBe(0);
  });

  it('emits no delete sentinel anywhere — "erases nothing" as a structural assertion', () => {
    const p = asPatch(planBeginRotation({ row: healthy, now }));
    for (const value of Object.values(p.key)) expect(value).not.toEqual(KEY_PATCH_DELETE);
  });

  it('refuses ROTATION_IN_PROGRESS while one is open', () => {
    const r = asRefusal(planBeginRotation({ row: row({ currentGeneration: 2, rotation: openRotation() }), now }));
    expect(r.code).toBe('ROTATION_IN_PROGRESS');
    expect(r.message).toMatch(/generation 2 is already open/);
  });

  it('allows a new rotation once the previous one has finished', () => {
    const finished = row({ currentGeneration: 2, rotation: openRotation({ finishedAt: EARLIER }) });
    expect(asPatch(planBeginRotation({ row: finished, now })).mint).toEqual({ generation: 3 });
  });

  it('refuses on a revoked or destroyed key', () => {
    expect(asRefusal(planBeginRotation({ row: row({ revokedAt: EARLIER }), now })).code).toBe('ACCOUNT_KEY_REVOKED');
    expect(asRefusal(planBeginRotation({ row: row({ destroyedAt: EARLIER }), now })).code).toBe('ACCOUNT_KEY_DESTROYED');
  });
});

describe('rule 10 — drain erases the wrap on every generation <= through, and never rewrites history', () => {
  const rotated = row({ currentGeneration: 3 });
  const generations = [
    gen({ n: 1, hasWrap: true }),
    gen({ n: 2, hasWrap: true }),
    gen({ n: 3, hasWrap: true }),
  ];

  it('erases up to and INCLUDING through, and leaves everything above it', () => {
    const p = asPatch(planDrain({ row: rotated, generations, through: 2, now }));
    expect(p.generations.map((g) => g.n)).toEqual([1, 2]);
    expect(p.generations.every((g) => g.eraseWrap)).toBe(true);
    expect(p.key).toEqual({});
  });

  it('sets drainedAt and retiredAt only if absent, so a re-report does not rewrite history', () => {
    const partly = [gen({ n: 1, hasWrap: true, retiredAt: EARLIER })];
    const p = asPatch(planDrain({ row: rotated, generations: partly, through: 1, now }));
    expect(p.generations[0].set).toEqual({ drainedAt: AT, retiredAt: EARLIER });
  });

  it('is idempotent: a re-report over drained, wrapless generations is changed: 0', () => {
    const drained = [gen({ n: 1, hasWrap: false, drainedAt: EARLIER, retiredAt: EARLIER })];
    const p = asPatch(planDrain({ row: rotated, generations: drained, through: 1, now }));
    expect(p.changed).toBe(0);
    expect(p.generations).toEqual([]);
    expect(p.key).toEqual({});
    expect(p.evict).toBe(false);
  });

  it('MAY NEVER DRAIN THE CURRENT GENERATION', () => {
    // collab's `drainGenerationsBelow` drains everything BELOW its argument; this drains
    // everything up to and INCLUDING `through`. An off-by-one in an operation that erases
    // wraps is unrecoverable, so the boundary is a refusal and not a docblock.
    const r = asRefusal(planDrain({ row: rotated, generations, through: 3, now }));
    expect(r.code).toBe('VALIDATION_ERROR');
    expect(r.message).toMatch(/INCLUSIVE and must be below it/);
    expect(asRefusal(planDrain({ row: rotated, generations, through: 4, now })).code).toBe('VALIDATION_ERROR');
  });

  it('refuses a `through` that is not a positive integer', () => {
    for (const through of [0, -1, 1.5, Number.NaN]) {
      expect(asRefusal(planDrain({ row: rotated, generations, through, now })).code).toBe('VALIDATION_ERROR');
    }
  });
});

describe('rule 11 — revoke PRESERVES revokedAt, OVERWRITES revokedCause, and may create a keyless row', () => {
  it('keeps the original revokedAt on a second revoke and takes the new cause', () => {
    const p = asPatch(planRevoke({ row: row({ revokedAt: EARLIER, revokedCause: 'client-request' }), cause: 'incident', now }));
    // The date is when access actually stopped; re-stamping it would erase that fact.
    expect(p.key.revokedAt).toBe(EARLIER);
    expect(p.key.revokedCause).toBe('incident');
  });

  it('creates a keyless, revoked row when there is none', () => {
    // Prevents a later first write minting under a revoked account: `planMint` refuses on the
    // next attempt rather than finding nothing and helpfully starting a fresh key.
    const p = asPatch(planRevoke({ row: null, cause: 'account-deactivated', accountId: 'acc_9', productId: 'morph', now }));
    expect(p.createIfMissing).toBe(true);
    expect(p.key).toEqual({
      accountId: 'acc_9',
      productId: 'morph',
      currentGeneration: 1,
      createdAt: KEY_PATCH_SERVER_TIME,
      revokedAt: AT,
      revokedCause: 'account-deactivated',
    });
    expect(p.mint).toBeNull();

    const after = applyKey(null, p);
    expect(asRefusal(planMint({ row: after, generationRow: null, accountId: 'acc_9', productId: 'morph', now })).code)
      .toBe('ACCOUNT_KEY_REVOKED');
  });

  it('needs the ids only when the row is absent, and refuses ids that disagree with it', () => {
    expect(() => planRevoke({ row: null, cause: 'sysadmin', now })).toThrow(/needs accountId/);
    expect(() => planRevoke({ row: row(), cause: 'sysadmin', accountId: 'acc_other', now })).toThrow(/disagrees with the row/);
  });

  it('NEVER refuses — revoking a destroyed key is a no-op, not an error (R6)', () => {
    // A deliberate departure from collab, which throws ACCOUNT_KEY_DESTROYED here. The key is
    // already maximally unreadable. Accounts' route turns the equal status pair into its 409,
    // and this is the one place the port pushes a decision up to its consumer.
    const p = planRevoke({ row: row({ revokedAt: EARLIER, destroyedAt: EARLIER }), cause: 'sysadmin', now });
    expect(isRefusal(p)).toBe(false);
    expect(p.changed).toBe(0);
    expect(p.key).toEqual({});
    expect(p.audit.statusBefore).toBe('destroyed');
    expect(p.audit.statusAfter).toBe('destroyed');
  });
});

describe('rule 12 — destroy CLOSES an open rotation', () => {
  it('writes rotation.finishedAt when one is open', () => {
    // Prevents a rotation left open over a destroyed key, with nothing left to drain and a
    // progress bar that will never move again.
    const p = asPatch(
      planDestroy({
        row: row({ currentGeneration: 2, revokedAt: EARLIER, rotation: openRotation() }),
        generations: [gen({ n: 1 }), gen({ n: 2 })],
        now,
      }),
    );
    expect(p.key['rotation.finishedAt']).toBe(AT);
    expect(p.createIfMissing).toBe(false);
  });

  it('writes no rotation key when there is no open rotation', () => {
    const p = asPatch(planDestroy({ row: row({ revokedAt: EARLIER }), generations: [gen()], now }));
    expect(Object.keys(p.key)).toEqual(['destroyedAt', 'destroyedThrough']);
  });

  it('writes no rotation key when the rotation has already finished', () => {
    const p = asPatch(
      planDestroy({ row: row({ revokedAt: EARLIER, rotation: openRotation({ finishedAt: EARLIER }) }), generations: [], now }),
    );
    expect(Object.keys(p.key)).not.toContain('rotation.finishedAt');
  });
});

describe('rule 13 — destroy records destroyedThrough = currentGeneration and erases every wrap', () => {
  it('records the generation the destroy covered', () => {
    // Prevents the page being unable to say which material is gone after a later regenerate.
    const p = asPatch(
      planDestroy({
        row: row({ currentGeneration: 4, revokedAt: EARLIER }),
        generations: [gen({ n: 3, hasWrap: false, drainedAt: EARLIER, retiredAt: EARLIER }), gen({ n: 4, hasWrap: true })],
        now,
      }),
    );
    expect(p.key.destroyedThrough).toBe(4);
    expect(p.key.destroyedAt).toBe(AT);
  });

  it('erases a wrap exactly where one is present, and tombstones every generation', () => {
    const p = asPatch(
      planDestroy({
        row: row({ currentGeneration: 2, revokedAt: EARLIER }),
        generations: [gen({ n: 1, hasWrap: false, drainedAt: EARLIER, retiredAt: EARLIER }), gen({ n: 2, hasWrap: true })],
        now,
      }),
    );
    expect(p.generations.map((g) => ({ n: g.n, eraseWrap: g.eraseWrap }))).toEqual([
      { n: 1, eraseWrap: false },
      { n: 2, eraseWrap: true },
    ]);
    // `?? now` on both dates: a generation already retired keeps the date it was retired on.
    expect(p.generations[0].set).toEqual({ destroyedAt: AT, retiredAt: EARLIER });
    expect(p.generations[1].set).toEqual({ destroyedAt: AT, retiredAt: AT });
  });
});

describe('rule 14 — EVERY mutating operation evicts that account’s cache', () => {
  it('sets evict exactly when there is something to write or something to mint', () => {
    // The flag is on the patch, not in a docblock: a consumer that wires `apply` and forgets
    // fails invisibly, because everything works and revocations simply never arrive.
    for (const { name, patch } of everyPatch()) {
      expect({ name, evict: patch.evict }).toEqual({
        name,
        evict: patch.changed > 0 || patch.mint !== null,
      });
    }
  });

  it('does not evict for a no-op, because nothing changed', () => {
    expect(asPatch(planRestore({ row: row(), causeStillHolds: false, now })).evict).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// planRecordProgress — the deletion of two progress fields, asserted
// ---------------------------------------------------------------------------

describe('planRecordProgress', () => {
  const rotating = row({ currentGeneration: 2, rotation: openRotation() });

  it('writes the three keys as DOTTED paths, so a merge does not clobber startedAt', () => {
    const p = asPatch(planRecordProgress({ row: rotating, progress: { recordsRewrapped: 40, recordsTotal: 100 }, now }));
    expect(p.key).toEqual({
      'rotation.progress.recordsRewrapped': 40,
      'rotation.progress.recordsTotal': 100,
    });
    expect(p.createIfMissing).toBe(false);
    expect(applyKey(rotating, p).rotation?.startedAt).toBe(EARLIER);
  });

  it('refuses an unknown progress key — and valuesRewritten is now one of those', () => {
    // The deletion asserted rather than assumed: a rotation rewraps and touches no content, so
    // `valuesRewritten` and `objectsRewritten` would be zero for ever, and a status field that
    // is always zero teaches an operator to distrust the whole page.
    for (const field of ['valuesRewritten', 'objectsRewritten', 'nonsense']) {
      const r = asRefusal(planRecordProgress({ row: rotating, progress: { [field]: 1 }, now }));
      expect(r.code).toBe('VALIDATION_ERROR');
      expect(r.message).toMatch(new RegExp(`\`${field}\` is not a RotationProgress field`));
    }
  });

  it('refuses a value that is not a non-negative integer', () => {
    for (const bad of [-1, 1.5, '4' as unknown as number]) {
      expect(asRefusal(planRecordProgress({ row: rotating, progress: { conflicted: bad }, now })).code)
        .toBe('VALIDATION_ERROR');
    }
  });

  it('refuses when there is no open rotation', () => {
    expect(asRefusal(planRecordProgress({ row: row(), progress: { conflicted: 1 }, now })).code).toBe('VALIDATION_ERROR');
  });

  it('is a no-op for an empty report', () => {
    const p = asPatch(planRecordProgress({ row: rotating, progress: {}, now }));
    expect(p.changed).toBe(0);
  });
});

describe('planFinishRotation', () => {
  it('closes the rotation and clears the error', () => {
    const p = asPatch(planFinishRotation({ row: row({ currentGeneration: 2, rotation: openRotation({ error: 'X' }) }), now }));
    expect(p.key).toEqual({ 'rotation.finishedAt': AT, 'rotation.error': null });
  });

  it('refuses when there is nothing open to finish', () => {
    expect(asRefusal(planFinishRotation({ row: row(), now })).code).toBe('VALIDATION_ERROR');
  });
});

// ---------------------------------------------------------------------------
// The four cross-cutting assertions, over the whole planner table
// ---------------------------------------------------------------------------

/** One happy-path patch per planner, with the row it was planned against. */
function everyPatch(): readonly { name: string; before: ContentKeyRow | null; patch: ContentKeyPatch }[] {
  const revoked = row({ revokedAt: EARLIER, revokedCause: 'account-deactivated' });
  const destroyed = row({ currentGeneration: 2, revokedAt: EARLIER, revokedCause: 'incident', destroyedAt: EARLIER, destroyedThrough: 2 });
  const rotating = row({ currentGeneration: 3, rotation: openRotation({ generation: 3 }) });
  const rotated = row({ currentGeneration: 3 });

  return [
    { name: 'planMint', before: null, patch: asPatch(planMint({ row: null, generationRow: null, accountId: 'acc_1', productId: 'collab', now }), 'planMint') },
    { name: 'planMint (race)', before: row(), patch: asPatch(planMint({ row: row(), generationRow: gen(), accountId: 'acc_1', productId: 'collab', now }), 'planMint') },
    { name: 'planRevoke', before: row(), patch: planRevoke({ row: row(), cause: 'sysadmin', now }) },
    { name: 'planRevoke (no row)', before: null, patch: planRevoke({ row: null, cause: 'sysadmin', accountId: 'acc_1', productId: 'collab', now }) },
    { name: 'planRevoke (destroyed)', before: destroyed, patch: planRevoke({ row: destroyed, cause: 'sysadmin', now }) },
    { name: 'planRestore', before: revoked, patch: asPatch(planRestore({ row: revoked, causeStillHolds: false, now }), 'planRestore') },
    { name: 'planRestore (no-op)', before: row(), patch: asPatch(planRestore({ row: row(), causeStillHolds: false, now }), 'planRestore') },
    { name: 'planDestroy', before: revoked, patch: asPatch(planDestroy({ row: revoked, generations: [gen()], now }), 'planDestroy') },
    { name: 'planRegenerate', before: destroyed, patch: asPatch(planRegenerate({ row: destroyed, now }), 'planRegenerate') },
    { name: 'planBeginRotation', before: rotated, patch: asPatch(planBeginRotation({ row: rotated, now }), 'planBeginRotation') },
    { name: 'planRecordProgress', before: rotating, patch: asPatch(planRecordProgress({ row: rotating, progress: { conflicted: 2 }, now }), 'planRecordProgress') },
    { name: 'planFailRotation', before: rotating, patch: asPatch(planFailRotation({ row: rotating, error: 'ROTATION_TIMEOUT', now }), 'planFailRotation') },
    { name: 'planFinishRotation', before: rotating, patch: asPatch(planFinishRotation({ row: rotating, now }), 'planFinishRotation') },
    { name: 'planDrain', before: rotated, patch: asPatch(planDrain({ row: rotated, generations: [gen({ n: 1 }), gen({ n: 2 })], through: 2, now }), 'planDrain') },
    { name: 'planDrain (idempotent)', before: rotated, patch: asPatch(planDrain({ row: rotated, generations: [gen({ n: 1, hasWrap: false, drainedAt: EARLIER, retiredAt: EARLIER })], through: 1, now }), 'planDrain') },
  ];
}

describe('every planner, over the whole table', () => {
  it('covers all ten planners', () => {
    const covered = new Set(everyPatch().map(({ patch }) => patch.audit.action));
    expect([...covered].sort()).toEqual([
      'beginRotation', 'destroy', 'drain', 'failRotation', 'finishRotation',
      'mint', 'recordProgress', 'regenerate', 'restore', 'revoke',
    ]);
  });

  it('changed === 0 implies key and generations are both empty', () => {
    // The same contract as `WrapPatch.changed`, so a consumer's "don't write" branch is
    // uniform across the patch types.
    for (const { name, patch } of everyPatch()) {
      if (patch.changed !== 0) continue;
      expect({ name, key: patch.key, generations: patch.generations }).toEqual({ name, key: {}, generations: [] });
    }
  });

  it('audit.statusBefore and statusAfter agree with deriveStatus, before and after the patch', () => {
    // The one assertion that would catch an audit entry disagreeing with what was written.
    for (const { name, before, patch } of everyPatch()) {
      const beforeStatus = deriveStatus(before ?? { revokedAt: null, destroyedAt: null });
      const afterStatus = deriveStatus(applyKey(before, patch));
      expect({ name, before: patch.audit.statusBefore, after: patch.audit.statusAfter }).toEqual({
        name,
        before: beforeStatus,
        after: afterStatus,
      });
    }
  });

  it('carries no key material anywhere in the patch', () => {
    // §16.9 asks for `assertNoSecrets(p.audit)`; that is an error-details assertion over a
    // closed 18-key scalar allowlist and an audit is not one. This is the check for this
    // threat model — recursive, value-level, no opinion about which keys a payload may carry.
    for (const { name, patch } of everyPatch()) {
      expect(() => assertNoKeyMaterial(patch, `${name} patch`)).not.toThrow();
    }
  });

  it('is plain JSON through and through — no closure ever crept back in', () => {
    for (const { name, patch } of everyPatch()) {
      expect({ name, patch }).toEqual({ name, patch: JSON.parse(JSON.stringify(patch)) });
    }
  });

  it('satisfies assertContentKeyPatch, which every planner already ran on the way out', () => {
    for (const { name, patch } of everyPatch()) {
      try {
        assertContentKeyPatch(patch);
      } catch (err) {
        throw new Error(`${name}: ${(err as Error).message}`);
      }
    }
  });

  it('is frozen, so a caller cannot edit a patch after the assertion passed', () => {
    for (const { name, patch } of everyPatch()) {
      expect({ name, frozen: Object.isFrozen(patch) && Object.isFrozen(patch.key) && Object.isFrozen(patch.audit) })
        .toEqual({ name, frozen: true });
    }
  });

  it('stamps every audit with the injected clock and never with the wall clock', () => {
    for (const { name, patch } of everyPatch()) {
      expect({ name, at: patch.audit.at }).toEqual({ name, at: AT });
    }
  });

  it('returns a Refusal, never a thrown 409, for every state refusal', () => {
    const refusals = [
      planDestroy({ row: row(), generations: [], now }),
      planRegenerate({ row: row(), now }),
      planRestore({ row: row({ revokedAt: EARLIER, revokedCause: 'account-deactivated' }), causeStillHolds: true, now }),
      planBeginRotation({ row: row({ rotation: openRotation() }), now }),
      planMint({ row: row({ revokedAt: EARLIER }), generationRow: null, accountId: 'acc_1', productId: 'collab', now }),
    ];
    for (const r of refusals) {
      expect(isRefusal(r)).toBe(true);
      expect(isContentCryptoError(r)).toBe(false);
    }
  });

  it('throws VALIDATION_ERROR for a caller mistake, which is a different channel', () => {
    // A refusal is a fact about the world an operator page renders; a missing row where the
    // signature promises one is a programming error, and putting both on one channel is how a
    // route ends up switching on codes to tell them apart.
    for (const call of [
      () => planRestore({ row: null as unknown as ContentKeyRow, causeStillHolds: false, now }),
      () => planDestroy({ row: null as unknown as ContentKeyRow, generations: [], now }),
      () => planBeginRotation({ row: null as unknown as ContentKeyRow, now }),
    ]) {
      try {
        call();
        throw new Error('unreachable');
      } catch (err) {
        expect(isContentCryptoError(err, 'VALIDATION_ERROR')).toBe(true);
      }
    }
  });

  it('takes its clock only through `now`, and refuses a broken one', () => {
    expect(() => planRevoke({ row: row(), cause: 'sysadmin', now: () => new Date('nope') })).toThrow(/valid Date/);
  });
});
