/**
 * **Account granularity is aggregate granularity with the dial turned down.**
 *
 * This is the executable form of plan §5a's central claim — ONE encryption model, not two — and it
 * is the most important test in the package, because every other suite tests a mechanism whereas
 * this one tests the thing the mechanisms are for. v1 wanted it and could not write it: account
 * granularity required a product to declare a fake record type, which made the degenerate case
 * *look* like a second configuration, so the test would have compared two `ContentCrypto` instances
 * and proved nothing about either. `resolveScope` now INJECTS `ACCOUNT_RECORD_TYPE`, so one scope
 * carries both granularities and this suite needs ONE instance.
 *
 * ## Why cross-open, and not a byte comparison
 *
 * AES-GCM draws a fresh random IV per seal, so two seals of one plaintext are never byte-equal and
 * a byte comparison would be a test of the random number generator. The sharp form needs no seam
 * into the cipher at all: **seal under one granularity and open under the other.** That can only
 * succeed if the key and the AAD are identical on both sides, which is the whole claim.
 *
 * A cross-open that passes is worth nothing unless the same machinery can be made to FAIL, so every
 * cross-open below is paired with a negative control that changes exactly one AAD component — the
 * collection, the document id, the field path, the array marker, the bucket — and asserts the
 * refusal. Without those the suite would pass just as happily against a codec that ignored its AAD.
 *
 * ## What is meant to differ, asserted as a difference
 *
 * The claim is that the model is one model, **not** that the bytes at every layer are equal. Two
 * things must differ and both are asserted rather than glossed:
 *
 *   - `audit.granularity` — `'aggregate'` on one side, `'account'` on the other;
 *   - the WRAP ciphertexts, because the wrap AAD binds `scopePath` and the two refs sit at
 *     different paths. That one is asserted twice: the strings differ, AND a wrap lifted from one
 *     ref refuses to open under the other. A difference nobody can exploit is the point.
 *
 * ## The one construction here that no product performs
 *
 * `mintRecordKey` / `wrapRecordKey` / `unwrapRecordKey` are all exported, which is what lets ONE
 * minted record key be wrapped under TWO refs. Nothing else on the surface allows it, and that is
 * correct: this is a test of the model's identity, not an operation anybody runs. A product mints
 * through `createRecord` and reaches exactly one ref.
 */

import { createHash } from 'node:crypto';

import { createContentCrypto } from '../content-crypto';
import type { WrapCommitter, WrapReceipt } from '../content-crypto';
import type { RecordSession } from '../content-crypto';
import { cachingDekSource } from '../custodian-cache';
import type { DekHandle, DekSource } from '../custodian';
import { assertNoKeyMaterial, isContentCryptoError } from '../errors';
import { decodeValue, isEncrypted } from '../field-codec';
import {
  ACCOUNT_RECORD_TYPE, aggregateRecordRef, assertScopePath, assertHead, resolveScope,
} from '../key-scope';
import type { KeyScope } from '../key-scope';
import { defineRegistry } from '../registry';
import { mintRecordKey, unwrapRecordKey, wrapRecordKey } from '../record-key';
import { planWraps } from '../wrap-patch';
import type { RecordRef, WrapEntry } from '../record-key';
import { dekFromBytes, zeroise } from '../secret';
import type { AccountDek, RecordKey } from '../secret';
import { runWrapJob } from '../walk';
import type { RecordHead, WriteRow } from '../walk';

// ---------------------------------------------------------------------------
// Fixtures — §16.6's, with a blob path added so the second seal shape is covered too
// ---------------------------------------------------------------------------

const PRODUCT = 'collab';

const registry = defineRegistry({
  projects: { strings: ['name', 'description', 'tags[]'], blobs: ['settings'] },
});

type Collection = 'projects';

const scope: KeyScope<'project'> = {
  productId: PRODUCT,
  records: { project: 'aggregate' },
  accountRecordPath: (accountId) => `accountContentKeys/${accountId}`,
};

/** Deterministic, so a suite failure is a suite failure and never a flake. */
const dekBytes = (accountId: string, generation: number): AccountDek =>
  dekFromBytes(
    createHash('sha256').update(`${PRODUCT}#${accountId}#${generation}`).digest(),
    `${PRODUCT}/${accountId}@${generation}`,
  );

const source: DekSource = {
  async getCurrentDek(accountId): Promise<DekHandle> {
    return { generation: 1, key: dekBytes(accountId, 1) };
  },
  async getDek(accountId, generation): Promise<DekHandle> {
    return { generation, key: dekBytes(accountId, generation) };
  },
  async currentGeneration(): Promise<number> {
    return 1;
  },
  evict(): void {
    /* the cache in front of this holds everything there is to hold */
  },
};

/**
 * The wrap committer these fixtures wire.
 *
 * It WRITES — into a Map, a store being the thing this package is not allowed to know about — and
 * only then acknowledges, which is the conforming shape. Its refusals (create-only, a lost
 * precondition, a stub receipt) are asserted in `content-crypto.test.ts`, and the durability
 * property itself in `durability.test.ts`. Here the port is wiring rather than the subject, so it
 * is deliberately permissive about writing the same record twice.
 */
function recordingCommitter(): WrapCommitter & {
  readonly rows: Map<string, Readonly<Record<string, unknown>>>;
} {
  const rows = new Map<string, Readonly<Record<string, unknown>>>();
  return {
    rows,
    async commitWraps(requests): Promise<readonly WrapReceipt[]> {
      const committedAt = new Date().toISOString();
      for (const request of requests) rows.set(request.record.path, request.update);
      return requests.map(() => ({ committedAt }));
    },
    // The read-back R11 puts on the port: an independent look at the same rows, positional, and
    // the `keyWraps` map rather than the row that carries it. Answering from anything but the
    // store would be the second deliberate falsehood, which is the price read-back sets.
    async readWraps(records): Promise<readonly unknown[]> {
      return records.map((record) => rows.get(record.path)?.keyWraps);
    },
    isPreconditionFailure: (): boolean => false,
  };
}

function makeCrypto() {
  const dekSource = cachingDekSource(source, {
    productId: PRODUCT,
    onGraceServe: () => {
      throw new Error('no grace serve is expected in this suite');
    },
  });
  return createContentCrypto<Collection, 'project'>({
    scope, registry, dekSource, wrapCommitter: recordingCommitter(),
  });
}

/** JSON, because a store round-trips JSON and a clone must not carry a live reference. */
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    return isContentCryptoError(err) ? err.code : `not a ContentCryptoError: ${String(err)}`;
  }
  return 'did not throw';
}

/**
 * The two sessions, over ONE record key.
 *
 * This is the construction §16.6 specifies. Note what it does NOT do: it never calls
 * `createRecord` twice, because two creates would be two keys and the suite would then be
 * comparing two records rather than one model.
 */
async function twoSessions(): Promise<{
  readonly asAggregate: RecordSession<Collection>;
  readonly asAccount: RecordSession<Collection>;
  readonly aggRef: RecordRef;
  readonly acctRef: RecordRef;
  readonly wrapAgg: WrapEntry;
  readonly wrapAcct: WrapEntry;
  readonly recordKey: RecordKey;
  readonly dek: DekHandle;
  close(): void;
}> {
  const crypto = makeCrypto();
  const aggRef = aggregateRecordRef('project', 'p_1', 'projects/p_1');
  const acctRef = crypto.accountRecord('A');

  const recordKey = mintRecordKey(aggRef);
  const dek = await crypto.dekSource.getCurrentDek('A');
  const common = { productId: PRODUCT, dek, accountId: 'A', recordKey };
  const wrapAgg = wrapRecordKey({ ...common, record: aggRef });
  const wrapAcct = wrapRecordKey({ ...common, record: acctRef });

  const asAggregate = await crypto.openRecord(
    { record: aggRef, keyWraps: { A: wrapAgg } }, { as: 'A' },
  );
  const asAccount = await crypto.openRecord(
    { record: acctRef, keyWraps: { A: wrapAcct } }, { as: 'A' },
  );

  return {
    asAggregate, asAccount, aggRef, acctRef, wrapAgg, wrapAcct, recordKey, dek,
    close: () => {
      asAggregate.close();
      asAccount.close();
    },
  };
}

// ---------------------------------------------------------------------------
// Part 0 — ONE instance, which is what v1 could not have
// ---------------------------------------------------------------------------

describe('one scope carries both granularities, so this suite needs ONE ContentCrypto', () => {
  it('resolves the product\'s type and the injected account type side by side', () => {
    const crypto = makeCrypto();
    expect(crypto.scope.records).toEqual({ project: 'aggregate', account: 'account' });
    expect(crypto.scope.granularityOf('project')).toBe('aggregate');
    expect(crypto.scope.granularityOf(ACCOUNT_RECORD_TYPE)).toBe('account');
  });

  it('refuses a product that declares the reserved type — the fake record type, as an error', () => {
    // The v1 shape. It is not merely discouraged: declaring it is how the degenerate case became
    // a second configuration, and the refusal is what keeps this suite honest about needing one
    // instance rather than two.
    expect(
      codeOf(() =>
        resolveScope(
          { productId: PRODUCT, records: { account: 'account' } } as unknown as KeyScope<'account'>,
          registry,
        ),
      ),
    ).toBe('VALIDATION_ERROR');
  });

  it('accepts both scopePaths under one grammar, and both refs under the one assertion', () => {
    const crypto = makeCrypto();
    const aggRef = aggregateRecordRef('project', 'p_1', 'projects/p_1');
    const acctRef = crypto.accountRecord('A');

    expect(() => assertScopePath(aggRef.path)).not.toThrow();
    expect(() => assertScopePath(acctRef.path)).not.toThrow();
    expect(() => crypto.scope.assertRecord(aggRef, 'A')).not.toThrow();
    expect(() => crypto.scope.assertRecord(acctRef, 'A')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Part 1 — ciphertext identity, by CROSS-OPEN
// ---------------------------------------------------------------------------

describe('ciphertext identity, proved by cross-open rather than by comparing bytes', () => {
  it('a document sealed at aggregate granularity opens at account granularity, and back', async () => {
    const t = await twoSessions();
    try {
      const plaintext = { name: 'Alpha', description: 'a description' };

      const sealedByAggregate = t.asAggregate.encryptDoc('projects', 'p_1', clone(plaintext));
      expect(t.asAccount.decryptDoc('projects', 'p_1', clone(sealedByAggregate)))
        .toEqual(plaintext);

      const sealedByAccount = t.asAccount.encryptDoc('projects', 'p_1', clone(plaintext));
      expect(t.asAggregate.decryptDoc('projects', 'p_1', clone(sealedByAccount)))
        .toEqual(plaintext);
    } finally {
      t.close();
    }
  });

  it('the two ciphertexts are NOT byte-equal, which is why this suite cross-opens', async () => {
    // Stated as a positive assertion rather than left implicit: a reader who reached for
    // `expect(a).toEqual(b)` here would have written a test that fails on correct code, then
    // "fixed" it by deleting the assertion. The IV is fresh per seal, by design.
    const t = await twoSessions();
    try {
      const a = t.asAggregate.encryptDoc('projects', 'p_1', { name: 'Alpha' });
      const b = t.asAccount.encryptDoc('projects', 'p_1', { name: 'Alpha' });
      expect(a.name).not.toBe(b.name);

      // What IS equal is everything the wire format decides. Same version, same key source, same
      // IV and tag lengths, and the same ciphertext length for the same plaintext — the two seals
      // differ in exactly the random material and in nothing else.
      const da = decodeValue(a.name);
      const db = decodeValue(b.name);
      expect(da).not.toBeNull();
      expect(db).not.toBeNull();
      expect(da?.version).toBe('v3');
      expect(db?.version).toBe(da?.version);
      expect(db?.keySource).toBe(da?.keySource);
      expect(db?.generation).toBe(da?.generation);
      expect(db?.iv.length).toBe(da?.iv.length);
      expect(db?.tag.length).toBe(da?.tag.length);
      expect(db?.ciphertext.length).toBe(da?.ciphertext.length);
      expect(da?.iv.equals(db?.iv as Buffer)).toBe(false);
    } finally {
      t.close();
    }
  });

  it('a blob sealed under one granularity opens under the other', async () => {
    const t = await twoSessions();
    try {
      const payload = { theme: 'dark', limits: { seats: 4 }, flags: ['beta'] };
      const sealed = t.asAggregate.encryptDoc('projects', 'p_1', { settings: clone(payload) });
      expect(isEncrypted(sealed.settings)).toBe(true);
      expect(t.asAccount.openBlobAt('projects', 'p_1', 'settings', sealed.settings))
        .toEqual(payload);

      // And a reseal built on one side applies on the other, which is the patch path rather than
      // the whole-value path.
      const req = t.asAccount.resealRequest('projects', 'p_1', 'settings', [
        { op: 'set', subPath: 'theme', value: 'light' },
      ]);
      const next = t.asAggregate.applyBlobPatch(req, sealed.settings);
      expect(t.asAggregate.openBlobAt('projects', 'p_1', 'settings', next))
        .toEqual({ ...payload, theme: 'light' });
    } finally {
      t.close();
    }
  });

  it('an ARRAY element sealed under one granularity opens under the other', async () => {
    // The `[]`-retained AAD is what makes an array append possible at all, and it is built from
    // the registered path — not from the ref — on both sides.
    const t = await twoSessions();
    try {
      const element = t.asAggregate.encryptArrayValue('projects', 'p_1', 'tags', 'urgent');
      expect(t.asAccount.decryptArrayValue('projects', 'p_1', 'tags', element)).toBe('urgent');
    } finally {
      t.close();
    }
  });

  it('an OBJECT body sealed under one granularity opens under the other', async () => {
    const t = await twoSessions();
    try {
      const ref = { bucket: 'xbgsolutions-collab', path: 'objects/ab/cd.bin' };
      const body = Buffer.from('an attachment', 'utf8');
      const sealed = t.asAggregate.sealObject(ref, body);

      expect(t.asAccount.openObject(ref, sealed.body, sealed.metadata).equals(body)).toBe(true);

      // The object AAD is `obj/{bucket}/{path}` and carries no scopePath, so the ONLY thing the
      // granularity changes is the `x-xbg-rec` HINT — which is metadata, is never trusted, and is
      // asserted here as a difference so nobody later mistakes it for part of the binding.
      const sealedByAccount = t.asAccount.sealObject(ref, body);
      expect(sealedByAccount.metadata['x-xbg-rec']).not.toBe(sealed.metadata['x-xbg-rec']);
      expect(sealed.metadata['x-xbg-rec']).toBe('projects/p_1');
      expect(sealedByAccount.metadata['x-xbg-rec']).toBe('accountContentKeys/A');
      // Opened with the OTHER side's hint attached, and it still opens: the hint is not the AAD.
      // Only `x-xbg-rec` is swapped — the iv and tag belong to the body being opened, because
      // those really are the envelope, and swapping THEM is what the tamper suite covers.
      const withForeignHint = { ...sealedByAccount.metadata, 'x-xbg-rec': sealed.metadata['x-xbg-rec'] };
      expect(
        t.asAggregate.openObject(ref, sealedByAccount.body, withForeignHint).equals(body),
      ).toBe(true);
    } finally {
      t.close();
    }
  });

  it('a planned UPDATE sealed under one granularity applies under the other', async () => {
    const t = await twoSessions();
    try {
      const update = t.asAccount.encryptUpdate('projects', 'p_1', { name: 'Renamed' });
      expect(t.asAggregate.decryptDoc('projects', 'p_1', clone(update)))
        .toEqual({ name: 'Renamed' });
    } finally {
      t.close();
    }
  });
});

// ---------------------------------------------------------------------------
// Part 1b — THE NEGATIVE CONTROLS. Every cross-open above would pass against a codec
// that ignored its AAD entirely; these are what rule that out.
// ---------------------------------------------------------------------------

describe('the cross-opens above can fail — one AAD component changed at a time', () => {
  it('a different DOCUMENT ID does not open, under EITHER session', async () => {
    const t = await twoSessions();
    try {
      const sealed = t.asAggregate.encryptDoc('projects', 'p_1', { name: 'Alpha' });
      expect(codeOf(() => t.asAccount.decryptDoc('projects', 'p_2', clone(sealed))))
        .toBe('CONTENT_DECRYPT_FAILED');
      expect(codeOf(() => t.asAggregate.decryptDoc('projects', 'p_2', clone(sealed))))
        .toBe('CONTENT_DECRYPT_FAILED');
    } finally {
      t.close();
    }
  });

  it('a different FIELD PATH does not open — the values cannot be swapped in the row', async () => {
    const t = await twoSessions();
    try {
      const sealed = t.asAggregate.encryptDoc('projects', 'p_1', {
        name: 'Alpha', description: 'a description',
      });
      const swapped = { name: sealed.description, description: sealed.name };
      expect(codeOf(() => t.asAccount.decryptDoc('projects', 'p_1', swapped)))
        .toBe('CONTENT_DECRYPT_FAILED');
    } finally {
      t.close();
    }
  });

  it('the ARRAY marker is part of the binding: a scalar seal is not an element seal', async () => {
    const t = await twoSessions();
    try {
      const scalar = t.asAggregate.encryptDoc('projects', 'p_1', { name: 'urgent' }).name;
      expect(codeOf(() => t.asAccount.decryptArrayValue('projects', 'p_1', 'tags', scalar)))
        .toBe('CONTENT_DECRYPT_FAILED');
    } finally {
      t.close();
    }
  });

  it('a different BUCKET does not open an object body', async () => {
    const t = await twoSessions();
    try {
      const ref = { bucket: 'xbgsolutions-collab', path: 'objects/ab/cd.bin' };
      const sealed = t.asAggregate.sealObject(ref, Buffer.from('an attachment', 'utf8'));
      expect(
        codeOf(() =>
          t.asAccount.openObject(
            { bucket: 'xbgsolutions-morph', path: ref.path }, sealed.body, sealed.metadata,
          ),
        ),
      ).toBe('CONTENT_DECRYPT_FAILED');
    } finally {
      t.close();
    }
  });

  it('a DIFFERENT RECORD KEY does not open, however the granularity is spelled', async () => {
    // The cross-open proves the AAD is equal. This proves the KEY was equal too, rather than the
    // codec having quietly stopped using one: a second minted key at the same ref, wrapped and
    // opened the same way, refuses the same ciphertext.
    const crypto = makeCrypto();
    const aggRef = aggregateRecordRef('project', 'p_1', 'projects/p_1');
    const dek = await crypto.dekSource.getCurrentDek('A');

    const openWithOwnKey = async (): Promise<RecordSession<Collection>> => {
      const key = mintRecordKey(aggRef);
      const wrap = wrapRecordKey({
        productId: PRODUCT, dek, accountId: 'A', record: aggRef, recordKey: key,
      });
      return crypto.openRecord({ record: aggRef, keyWraps: { A: wrap } }, { as: 'A' });
    };

    const first = await openWithOwnKey();
    const second = await openWithOwnKey();
    try {
      const sealed = first.encryptDoc('projects', 'p_1', { name: 'Alpha' });
      expect(codeOf(() => second.decryptDoc('projects', 'p_1', clone(sealed))))
        .toBe('CONTENT_DECRYPT_FAILED');
    } finally {
      first.close();
      second.close();
    }
  });
});

// ---------------------------------------------------------------------------
// Part 2 — plan identity, modulo the two things that are MEANT to differ
// ---------------------------------------------------------------------------

describe('planWraps is one reconcile over both refs', () => {
  it('gives equal update key sets, diff, holders, changed, deleteRecord and cutOff', async () => {
    const t = await twoSessions();
    try {
      const dekB = await makeCrypto().dekSource.getCurrentDek('B');
      const desired = { A: t.dek, B: dekB };
      const opts = { scope: 'this-record' as const, now: () => new Date('2026-09-11T00:00:00.000Z') };

      const a = t.asAggregate.planWraps(desired, opts);
      const b = t.asAccount.planWraps(desired, opts);

      expect(Object.keys(b.update).sort()).toEqual(Object.keys(a.update).sort());
      // `keyWraps.A` is deliberately ABSENT from both: each session was opened from A's wrap at
      // this generation, so A is `unchanged` and an unchanged holder is never rewritten. That is
      // the idempotency contract, and it holds identically at both granularities — which is a
      // sharper statement than "the key sets are equal" would have been on its own.
      expect(Object.keys(a.update).sort()).toEqual(['keyWraps.B', 'wrapHolders']);
      expect(a.diff.unchanged).toEqual(['A']);
      expect(b.diff.unchanged).toEqual(['A']);
      expect(b.diff).toEqual(a.diff);
      expect(b.changed).toBe(a.changed);
      expect(b.holdersBefore).toEqual(a.holdersBefore);
      expect(b.holdersAfter).toEqual(a.holdersAfter);
      expect(b.deleteRecord).toBe(a.deleteRecord);
      expect(b.cutOff).toBe(a.cutOff);
    } finally {
      t.close();
    }
  });

  it('gives equal audits MODULO `record` and `granularity`, which are asserted as differences', async () => {
    const t = await twoSessions();
    try {
      const opts = { scope: 'this-record' as const, now: () => new Date('2026-09-11T00:00:00.000Z') };
      const a = t.asAggregate.planWraps({ A: t.dek }, opts);
      const b = t.asAccount.planWraps({ A: t.dek }, opts);

      // Everything BUT the two that are meant to differ, so the comparison is exhaustive over the
      // rest rather than a hand-picked subset that could quietly stop covering a new field.
      const modulo = (audit: typeof a.audit): Record<string, unknown> => {
        const rest: Record<string, unknown> = { ...audit };
        delete rest.record;
        delete rest.granularity;
        return rest;
      };
      expect(modulo(b.audit)).toEqual(modulo(a.audit));

      // The two that MUST differ. The claim is that the model is one model, not that the bytes at
      // every layer are equal, and stating that precisely is what makes this test mean something.
      expect(a.audit.granularity).toBe('aggregate');
      expect(b.audit.granularity).toBe('account');
      expect(a.audit.record.path).toBe('projects/p_1');
      expect(b.audit.record.path).toBe('accountContentKeys/A');
    } finally {
      t.close();
    }
  });

  it('produces DIFFERENT wrap ciphertexts, because the wrap AAD binds scopePath', async () => {
    const t = await twoSessions();
    try {
      expect(t.wrapAcct.wrapped).not.toBe(t.wrapAgg.wrapped);
      expect(t.wrapAcct.gen).toBe(t.wrapAgg.gen);
    } finally {
      t.close();
    }
  });

  it('and that difference is ENFORCED: a wrap lifted between the refs will not open', async () => {
    // The assertion above would still pass if the two wraps merely differed by their random IV.
    // This is the one that says the scopePath is bound: the aggregate wrap presented at the
    // account ref refuses, and the reverse refuses too.
    const t = await twoSessions();
    try {
      const attempt = (record: RecordRef, wrap: WrapEntry): string =>
        codeOf(() =>
          unwrapRecordKey({ productId: PRODUCT, dek: t.dek, accountId: 'A', record, wrap }),
        );
      expect(attempt(t.acctRef, t.wrapAgg)).toBe('RECORD_KEY_UNWRAP_FAILED');
      expect(attempt(t.aggRef, t.wrapAcct)).toBe('RECORD_KEY_UNWRAP_FAILED');
      // The positive control, so the two above are not passing because everything refuses.
      expect(attempt(t.aggRef, t.wrapAgg)).toBe('did not throw');
      expect(attempt(t.acctRef, t.wrapAcct)).toBe('did not throw');
    } finally {
      t.close();
    }
  });

  it('carries no key material out of either plan', async () => {
    const t = await twoSessions();
    try {
      const opts = { scope: 'this-record' as const };
      expect(() => assertNoKeyMaterial(t.asAggregate.planWraps({ A: t.dek }, opts), 'patch'))
        .not.toThrow();
      expect(() => assertNoKeyMaterial(t.asAccount.planWraps({ A: t.dek }, opts), 'patch'))
        .not.toThrow();
    } finally {
      t.close();
    }
  });
});

// ---------------------------------------------------------------------------
// Part 3 — the granularity is invisible from the session
// ---------------------------------------------------------------------------

describe('nothing downstream of the ref can see which granularity it is', () => {
  it('the two sessions expose the same members, and differ only in `record`', async () => {
    const t = await twoSessions();
    try {
      expect(Object.keys(t.asAccount).sort()).toEqual(Object.keys(t.asAggregate).sort());
      expect(t.asAggregate.as).toBe(t.asAccount.as);
      // `ownerAccountId` is known on both — on the account side because the record IS the account,
      // which is the one place the façade asks `isAccountGranular` rather than naming a literal.
      expect(t.asAggregate.ownerAccountId).toBeNull();
      expect(t.asAccount.ownerAccountId).toBe('A');
      expect(t.asAccount.record).not.toEqual(t.asAggregate.record);
    } finally {
      t.close();
    }
  });

  it('the record ref carries nothing the content layer reads', async () => {
    // The content AAD is built from (collection, docId, fieldPath). If a ref field ever reached
    // that builder, the cross-opens above would break — so this is the structural statement of the
    // same fact, and the two fail together.
    const t = await twoSessions();
    try {
      expect(Object.keys(t.aggRef).sort()).toEqual(['id', 'path', 'type']);
      expect(Object.keys(t.acctRef).sort()).toEqual(['id', 'path', 'type']);
    } finally {
      t.close();
    }
  });

  it('the ONE predicate that separates them is the only thing that answers the question', () => {
    const crypto = makeCrypto();
    const aggRef = aggregateRecordRef('project', 'p_1', 'projects/p_1');
    const acctRef = crypto.accountRecord('A');
    expect(crypto.scope.isAccountGranular(acctRef)).toBe(true);
    expect(crypto.scope.isAccountGranular(aggRef)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Part 4 — the account case is not a special case in the traversal either
// ---------------------------------------------------------------------------

describe('the traversal treats the two identically — same helper, no branch', () => {
  it('assertHead accepts both heads with no argument distinguishing them', () => {
    const crypto = makeCrypto();
    const asHead = (record: RecordRef, ownerAccountId: string) => ({ record, ownerAccountId });
    expect(() => assertHead(crypto.scope, asHead(
      aggregateRecordRef('project', 'p_1', 'projects/p_1'), 'A',
    ))).not.toThrow();
    expect(() => assertHead(crypto.scope, asHead(crypto.accountRecord('A'), 'A'))).not.toThrow();
  });

  it('runWrapJob over each ref produces the same result modulo the scopePath it reports', async () => {
    // §16.6 Part 4 asks for `checkTraversal` here. That helper ships from `./testing`, which does
    // not exist yet; what IS available is the production job, run over the same traversal shape at
    // each granularity — and the assertion is the same one: no branch, same counts, same update
    // keys, the path being the only thing that moves.
    const crypto = makeCrypto();
    const dek = await crypto.dekSource.getCurrentDek('A');

    const run = async (record: RecordRef): Promise<{
      readonly rows: WriteRow[]; readonly visited: number; readonly updateKeys: string[];
    }> => {
      const recordKey = mintRecordKey(record);
      const wrap = wrapRecordKey({
        productId: PRODUCT, dek, accountId: 'A', record, recordKey,
      });
      const head: RecordHead = {
        record,
        ownerAccountId: 'A',
        keyWraps: { A: wrap },
        ref: { row: record.path },
        precondition: 'read-time',
      };
      const rows: WriteRow[] = [];
      const result = await runWrapJob({
        scope: crypto.scope,
        accountId: 'A',
        forEachRecord: async (_accountId, visit) => {
          await visit(head);
        },
        sink: {
          maxBatchSize: 400,
          deleteField: '<<delete>>',
          async writeBatch(batch): Promise<void> {
            rows.push(...batch);
          },
          async writeOne(row): Promise<void> {
            rows.push(row);
          },
          isPreconditionFailure: () => false,
        },
        desired: () => ({ A: dek, B: dek }),
        // ONE closure, shared by both runs. It names no granularity: it asks the scope, which is
        // the whole of "the traversal has no branch for the account case".
        wrap: (h, desired) => {
          const key = unwrapRecordKey({
            productId: PRODUCT, dek, accountId: 'A', record: h.record, wrap: h.keyWraps.A,
          });
          try {
            return planWraps({
              current: h.keyWraps,
              desired,
              recordKey: key,
              productId: PRODUCT,
              record: h.record,
              granularity: crypto.scope.granularityOf(h.record.type as 'project'),
              actorAccountId: 'A',
              scope: 'this-record',
            });
          } finally {
            zeroise(key);
          }
        },
      });
      return { rows, visited: result.recordsVisited, updateKeys: Object.keys(rows[0].update).sort() };
    };

    const aggregate = await run(aggregateRecordRef('project', 'p_1', 'projects/p_1'));
    const account = await run(crypto.accountRecord('A'));

    expect(account.visited).toBe(aggregate.visited);
    expect(account.rows).toHaveLength(aggregate.rows.length);
    expect(account.updateKeys).toEqual(aggregate.updateKeys);
    expect(aggregate.updateKeys).toEqual(['keyWraps.B', 'wrapHolders']);
  });
});
