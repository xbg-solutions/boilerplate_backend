/**
 * `key-scope.test.ts` — the granularity dial (§16.6, §16.7).
 *
 * What this suite is for, in the order the spec asks for it:
 *
 * - `resolveScope`'s validations, including the one that fixes v1's broken Morph example —
 *   **every record type declared `'document'` is a key of the registry**;
 * - `assertScopePath` and the three ref constructors, which must produce refs it accepts;
 * - the ceiling table, table-driven over **all five** worked registries of §14, because the
 *   property is "derived ceilings fit the document budget", not any one instance;
 * - `assertHead`, table-driven over §16.7's eight rows, whose point is that depth is fine and
 *   **depth below the wrap holder is not**;
 * - and the type-level half of `equivalence.test.ts`: that ONE scope carries both granularities,
 *   so the cross-open test that suite is built around needs one `ContentCrypto` and not two.
 *
 * Mirrorable under §16.3: relative imports only, no manifest read, no `../../`, no wall clock, no
 * randomness. `resolveGraceMs` is exercised through its injected `env` parameter, which is why it
 * has one — the environment variable itself is named in `key-scope.ts` and nowhere else, and
 * assertion (12) is what keeps it that way.
 */

import { DEFAULT_MAX_SEALED_BYTES, maxPlaintextFor, type BlobAdapter } from '../blob-json';
import { ContentCryptoError, assertNoSecrets } from '../errors';
import type { RecordRef } from '../record-key';
import { EMPTY_REGISTRY, defineRegistry } from '../registry';
import type { FieldRegistry } from '../registry';
import {
  ACCOUNT_RECORD_TYPE,
  DEFAULT_GRACE_MS,
  DEFAULT_MAX_DOCUMENT_SEALED_BYTES,
  MIN_DERIVED_SEALED_BYTES,
  accountRecordRef,
  aggregateRecordRef,
  assertHead,
  assertScopePath,
  documentRecordRef,
  recordRefKey,
  resolveGraceMs,
  resolveScope,
} from '../key-scope';
import type { KeyScope, RecordGranularity, ResolvedScope } from '../key-scope';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Every refusal in this module is a `VALIDATION_ERROR`; the message is where the offender is. */
function expectRefusal(fn: () => unknown, ...contains: string[]): ContentCryptoError {
  let caught: unknown;
  try {
    fn();
  } catch (err) {
    caught = err;
  }
  if (!(caught instanceof ContentCryptoError)) {
    throw new Error(`expected a ContentCryptoError, got ${String(caught)}`);
  }
  expect(caught.code).toBe('VALIDATION_ERROR');
  expect(caught.status).toBe(400);
  for (const needle of contains) {
    expect(caught.message).toContain(needle);
  }
  // Anything this module throws has already been through `assertNoSecrets` in the constructor;
  // asserting it again here is what makes that a property of the suite rather than of errors.ts.
  assertNoSecrets(caught.details);
  return caught;
}

// ---------------------------------------------------------------------------
// The five worked registries of §14, value for value
// ---------------------------------------------------------------------------

const collabRegistry = defineRegistry({
  projects: { strings: ['name', 'description', 'lastActivitySummary'] },
  topics: { strings: ['title', 'authoringError', 'declinedProposals[]'] },
  artefacts: { strings: ['content', 'openQuestions[]', 'lastEditedBecause'] },
  versions: { strings: ['content', 'summary', 'label'], root: 'artefacts' },
  messages: {
    strings: [
      'body',
      'anchor.quote',
      'anchor.prefix',
      'anchor.suffix',
      'anchor.sectionTitle',
      'proposal.title',
      'proposal.rationale',
      'proposal.seedContent',
      'attachments[].filename',
    ],
  },
  notifications: { strings: ['title', 'body'] },
  accountSettings: { strings: ['theme.wordmark'] },
});

const morphRegistry = defineRegistry({
  materials: { strings: ['content'], blobs: ['proposal'] },
  objects: { strings: ['name'], blobs: ['files'] },
  results: { blobs: ['structuredOutput', 'citations', 'viewerPayload'] },
});

const buildRegistry = defineRegistry({
  deliverables: { blobs: ['structuredContent'] },
  specEntities: { blobs: ['fields'] },
  checkpoints: { blobs: ['payload'], root: 'phases' },
});

const fediRegistry = defineRegistry({
  opportunities: { strings: ['name'], blobs: ['terms', 'contract'] },
  engagements: { blobs: ['terms'] },
  notes: { blobs: ['body'] },
  activityEvents: { strings: ['summary'], blobs: ['payload'] },
});

/** A stand-in for a product's `Timestamp` adapter. The tag is all a scope reads. */
const stubAdapter = (t: string): BlobAdapter => ({
  t,
  match: () => false,
  encode: (v) => v,
  decode: (v) => v,
});

const collabScope: KeyScope<'project'> = {
  productId: 'collab',
  records: { project: 'aggregate' },
  accountRecordPath: (accountId) => `accountSettings/${accountId}`,
  reads: 'lenient',
  legacy: {
    readFieldVersions: ['v1', 'v2'],
    // collab's real prefix is declared in legacy-readers.ts and stays there: assertion (6) keeps
    // that literal out of every other file, this suite included. A scope only carries a string.
    objectMetaPrefix: 'x-legacy-',
    dekWrapAad: (a) => `accountKeys/${a}`,
  },
};

const morphScope: KeyScope<'source' | 'objects' | 'results'> = {
  productId: 'morph',
  records: { source: 'aggregate', objects: 'document', results: 'document' },
  blobAdapters: [stubAdapter('ts')],
};

const buildScope: KeyScope<'project'> = {
  productId: 'build',
  records: { project: 'aggregate' },
  blobAdapters: [stubAdapter('ts')],
};

const fediScope: KeyScope<'opportunity' | 'engagement'> = {
  productId: 'fedicrm',
  records: { opportunity: 'aggregate', engagement: 'aggregate' },
  blobAdapters: [stubAdapter('ts')],
};

const sfmapperScope: KeyScope<'scan'> = {
  productId: 'sfmapper',
  records: { scan: 'aggregate' },
};

const WORKED: readonly {
  name: string;
  scope: KeyScope<string>;
  registry: FieldRegistry<string>;
}[] = [
  { name: 'collab', scope: collabScope, registry: collabRegistry },
  { name: 'Morph', scope: morphScope, registry: morphRegistry },
  { name: 'build', scope: buildScope, registry: buildRegistry },
  { name: 'fedi-CRM', scope: fediScope, registry: fediRegistry },
  { name: 'sf-mapper', scope: sfmapperScope, registry: EMPTY_REGISTRY },
];

/** The scope used by most of the assertion tests: collab's, which is the aggregate + account one. */
const collabResolved = resolveScope(collabScope, collabRegistry);
const morphResolved = resolveScope(morphScope, morphRegistry);

// ---------------------------------------------------------------------------
// assertScopePath
// ---------------------------------------------------------------------------

describe('assertScopePath', () => {
  const accepted = [
    ['a two-segment top-level document', 'projects/p_1'],
    ["collab's account row", 'accountSettings/atIqNkIXK380Mm4n'],
    ["Morph's lake source", 'tenants/t_1/connectorAuth/auth_9'],
    ["sf-mapper's six-segment scan", 'accounts/acc-1/sfmapper/org-9/scans/scan-3'],
    ['a path whose id contains a dot', 'projects/p.1'],
  ] as const;

  it.each(accepted)('accepts %s', (_why, path) => {
    expect(() => assertScopePath(path)).not.toThrow();
  });

  it('refuses a COLLECTION path, which is the most likely wrong value', () => {
    // The whole reason for the even-segment rule: a wrap bound to `projects` would be a wrap
    // bound to every project in it.
    const err = expectRefusal(() => assertScopePath('projects'), 'projects', 'odd', 'COLLECTION');
    expect(err.details).toEqual({ scopePath: 'projects' });
  });

  it('refuses any odd segment count, not just one', () => {
    expectRefusal(() => assertScopePath('a/b/c'), 'has 3 segments');
    expectRefusal(() => assertScopePath('a/b/c/d/e'), 'has 5 segments');
  });

  it('refuses a leading or trailing separator', () => {
    expectRefusal(() => assertScopePath('/projects/p_1'), 'must not start or end');
    expectRefusal(() => assertScopePath('projects/p_1/'), 'must not start or end');
  });

  it('refuses an empty segment', () => {
    expectRefusal(() => assertScopePath('projects//p_1'), 'empty segment');
  });

  it('refuses the empty string, naming what a scopePath is for', () => {
    expectRefusal(() => assertScopePath(''), 'must not be empty', 'full path of its holder');
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a number', 42],
    ['an object', { path: 'projects/p_1' }],
    ['an array', ['projects', 'p_1']],
  ])('refuses %s without printing it', (_label, value) => {
    const err = expectRefusal(() => assertScopePath(value), 'must be a string');
    expect(err.message).not.toContain('p_1');
  });
});

// ---------------------------------------------------------------------------
// The three ref constructors
// ---------------------------------------------------------------------------

describe('the three ref constructors — the dial, spelled three ways', () => {
  it('documentRecordRef keeps the collection as the record type', () => {
    const ref = documentRecordRef('objects', 'o_1', 'tenants/t_1/objects/o_1');
    expect(ref).toEqual({ type: 'objects', id: 'o_1', path: 'tenants/t_1/objects/o_1' });
    expect(Object.isFrozen(ref)).toBe(true);
  });

  it('aggregateRecordRef takes the AGGREGATE ROOT path, not a child of it', () => {
    const ref = aggregateRecordRef('scan', 'scan-3', 'accounts/acc-1/sfmapper/org-9/scans/scan-3');
    expect(ref.type).toBe('scan');
    expect(ref.id).toBe('scan-3');
    expect(ref.path).toBe('accounts/acc-1/sfmapper/org-9/scans/scan-3');
  });

  it('accountRecordRef stamps the RESERVED record type, so no product declares one', () => {
    const ref = accountRecordRef('A', 'accountSettings/A');
    expect(ref.type).toBe(ACCOUNT_RECORD_TYPE);
    expect(ACCOUNT_RECORD_TYPE).toBe('account');
    expect(ref.id).toBe('A');
  });

  it('every constructor runs assertScopePath, so a ref can never carry a collection path', () => {
    expectRefusal(() => documentRecordRef('objects', 'o_1', 'objects'), 'odd');
    expectRefusal(() => aggregateRecordRef('project', 'p_1', 'projects'), 'odd');
    expectRefusal(() => accountRecordRef('A', 'accountSettings'), 'odd');
  });

  it('every constructor refuses an empty type or id', () => {
    expectRefusal(() => documentRecordRef('', 'o_1', 'a/b'), 'type must not be empty');
    expectRefusal(() => documentRecordRef('objects', '', 'a/b'), 'id must not be empty');
    expectRefusal(() => aggregateRecordRef('', 'p_1', 'a/b'), 'type must not be empty');
    expectRefusal(() => aggregateRecordRef('project', '', 'a/b'), 'id must not be empty');
    expectRefusal(() => accountRecordRef('', 'a/b'), 'id must not be empty');
  });

  it('a ref whose path does not match its id still CONSTRUCTS — assertRecord is the one assertion', () => {
    // §16.7's table hands `('project','p_1','projects/p_2')` and
    // `('project','p_1','projects/p_1/messages/m_1')` to assertHead and expects IT to refuse them.
    // That is only writable if the constructor lets them through: shape here, agreement there.
    expect(() => aggregateRecordRef('project', 'p_1', 'projects/p_2')).not.toThrow();
    expect(() => aggregateRecordRef('project', 'p_1', 'projects/p_1/messages/m_1')).not.toThrow();
  });

  it('recordRefKey is the PATH, so two aggregates sharing an id do not collide', () => {
    const a = aggregateRecordRef('scan', 'scan-3', 'accounts/acc-1/sfmapper/org-9/scans/scan-3');
    const b = aggregateRecordRef('scan', 'scan-3', 'accounts/acc-2/sfmapper/org-4/scans/scan-3');
    expect(recordRefKey(a)).toBe(a.path);
    expect(recordRefKey(b)).toBe(b.path);
    expect(recordRefKey(a)).not.toBe(recordRefKey(b));
    // The failure this prevents: a Map keyed `${type}/${id}` would have one entry for two scans.
    expect(`${a.type}/${a.id}`).toBe(`${b.type}/${b.id}`);
  });
});

// ---------------------------------------------------------------------------
// resolveScope — the five validations
// ---------------------------------------------------------------------------

describe('resolveScope validations', () => {
  it('1. refuses a productId that is empty or contains a slash', () => {
    expectRefusal(
      () => resolveScope({ productId: '', records: {} }, EMPTY_REGISTRY),
      'productId must not be empty',
    );
    expectRefusal(
      () => resolveScope({ productId: 'a/b', records: {} }, EMPTY_REGISTRY),
      "must not contain '/'",
    );
  });

  it('2. refuses a document-granular record type the registry does not know', () => {
    // v1's broken Morph example, as a construction-time refusal. `documentRecordRef(collection,…)`
    // produces `type === collection`, so this scope would have thrown on every write.
    const err = expectRefusal(
      () =>
        resolveScope(
          { productId: 'morph', records: { morphObjects: 'document' } },
          morphRegistry,
        ),
      'morphObjects',
      'not a registry collection',
    );
    expect(err.message).toContain('materials, objects, results');
    expect(err.details).toEqual({ recordType: 'morphObjects' });
  });

  it('2. an AGGREGATE record type need not be a registry key — Morph’s `source` is not one', () => {
    expect(() => resolveScope(morphScope, morphRegistry)).not.toThrow();
    expect(morphRegistry.has('source')).toBe(false);
    // sf-mapper's whole adoption: a record type, no registry at all.
    expect(() => resolveScope(sfmapperScope, EMPTY_REGISTRY)).not.toThrow();
  });

  it('3. refuses a declared `account` record type — the fake record type, as an error', () => {
    const err = expectRefusal(
      () =>
        resolveScope(
          { productId: 'collab', records: { account: 'account' } },
          EMPTY_REGISTRY,
        ),
      'reserved record type',
      'resolveScope injects it',
    );
    expect(err.details).toEqual({ recordType: 'account' });
  });

  it('3. and injects it instead, so ONE scope carries both granularities', () => {
    expect(collabResolved.records).toEqual({ project: 'aggregate', account: 'account' });
    expect(collabResolved.granularityOf(ACCOUNT_RECORD_TYPE)).toBe('account');
  });

  it('4. refuses an aad tightness other than tight, and defaults to tight', () => {
    expect(collabResolved.aad).toBe('tight');
    expectRefusal(
      () =>
        resolveScope(
          { productId: 'collab', records: {}, aad: 'loose' as unknown as 'tight' },
          EMPTY_REGISTRY,
        ),
      "must be 'tight'",
    );
  });

  it('5. refuses maxSealedBytes above the document budget', () => {
    expectRefusal(
      () =>
        resolveScope(
          { productId: 'p', records: {}, maxSealedBytes: 2_000_000 },
          EMPTY_REGISTRY,
        ),
      'exceeds',
      'maxDocumentSealedBytes',
    );
  });

  it('5. refuses a DECLARED ceiling whose sum exceeds the document budget', () => {
    // The addendum's fixture: three blobs at 900 kB each on one document.
    const registry = defineRegistry({
      results: { blobs: ['a', 'b', 'c'], maxSealedBytes: 900_000 },
    });
    const err = expectRefusal(
      () => resolveScope({ productId: 'morph', records: {} }, registry),
      'results',
      '900000',
      '3 registered paths',
      '2700000',
      '1000000',
    );
    // The affordable ceiling is named, so the fix does not need arithmetic at the call site.
    expect(err.message).toContain('333333');
    expect(err.details).toEqual({
      collection: 'results',
      sealedBytes: 2_700_000,
      limitBytes: 1_000_000,
    });
  });

  it('5. an UNDECLARED collection can never reach that error — the derivation makes it fit', () => {
    // The same three blobs, without a declared ceiling: Morph's own §14.2 example, as a PASSING
    // fixture. It is what it should always have been; the symptom was the default.
    expect(() => resolveScope(morphScope, morphRegistry)).not.toThrow();
    expect(morphResolved.ceilingsFor('results')).toEqual({
      maxSealedBytes: 333_333,
      maxPlaintextBytes: 249_962,
    });
  });

  it('5. refuses a derived ceiling below MIN_DERIVED_SEALED_BYTES, naming the collection', () => {
    const paths = Array.from({ length: 245 }, (_v, i) => `f${i}`);
    const registry = defineRegistry({ wide: { strings: paths } });
    expectRefusal(
      () => resolveScope({ productId: 'p', records: {} }, registry),
      'wide',
      '245',
      String(MIN_DERIVED_SEALED_BYTES),
    );
    // 244 is the last count that fits, which is what "~244" in the constant's docblock means.
    const ok = defineRegistry({ wide: { strings: paths.slice(0, 244) } });
    expect(() => resolveScope({ productId: 'p', records: {} }, ok)).not.toThrow();
  });

  it('refuses a registry that is not one', () => {
    expectRefusal(
      () => resolveScope({ productId: 'p', records: {} }, undefined as unknown as FieldRegistry<string>),
      'needs a registry',
    );
    expectRefusal(
      () => resolveScope({ productId: 'p', records: {} }, {} as unknown as FieldRegistry<string>),
      'defineRegistry',
    );
  });

  it('refuses a granularity that is not one of the three', () => {
    expectRefusal(
      () =>
        resolveScope(
          { productId: 'p', records: { thing: 'per-row' as unknown as RecordGranularity } },
          EMPTY_REGISTRY,
        ),
      'document, aggregate, account',
    );
  });
});

// ---------------------------------------------------------------------------
// resolveScope — defaults and shape
// ---------------------------------------------------------------------------

describe('resolveScope defaults', () => {
  const bare = resolveScope({ productId: 'p', records: {} }, EMPTY_REGISTRY);

  it('fills every optional with the settled default', () => {
    expect(bare.aad).toBe('tight');
    expect(bare.reads).toBe('strict');
    expect(bare.maxSealedBytes).toBe(DEFAULT_MAX_SEALED_BYTES);
    expect(bare.maxSealedBytes).toBe(900_000);
    expect(bare.maxDocumentSealedBytes).toBe(DEFAULT_MAX_DOCUMENT_SEALED_BYTES);
    expect(bare.maxDocumentSealedBytes).toBe(1_000_000);
    expect(bare.deflateOver).toBe(0);
    expect(bare.blobAdapters).toEqual([]);
    expect(bare.legacy).toBeNull();
  });

  it('carries a product’s own values through unchanged', () => {
    expect(collabResolved.productId).toBe('collab');
    expect(collabResolved.reads).toBe('lenient');
    expect(morphResolved.blobAdapters).toHaveLength(1);
    expect(morphResolved.blobAdapters[0].t).toBe('ts');
  });

  it('freezes the resolved scope, its records and its adapter list', () => {
    expect(Object.isFrozen(morphResolved)).toBe(true);
    expect(Object.isFrozen(morphResolved.records)).toBe(true);
    expect(Object.isFrozen(morphResolved.blobAdapters)).toBe(true);
  });

  it('copies `records`, so a later mutation of the product’s literal changes nothing', () => {
    const mutable: Record<string, RecordGranularity> = { project: 'aggregate' };
    const resolved = resolveScope({ productId: 'p', records: mutable }, EMPTY_REGISTRY);
    mutable.project = 'document';
    expect(resolved.granularityOf('project')).toBe('aggregate');
  });

  it('refuses a non-integer or non-positive ceiling', () => {
    expectRefusal(
      () => resolveScope({ productId: 'p', records: {}, maxSealedBytes: 0 }, EMPTY_REGISTRY),
      'positive safe integer',
    );
    expectRefusal(
      () => resolveScope({ productId: 'p', records: {}, maxSealedBytes: 1.5 }, EMPTY_REGISTRY),
      'positive safe integer',
    );
  });

  it('refuses a negative deflateOver, and takes 0 as OFF', () => {
    expect(resolveScope({ productId: 'p', records: {}, deflateOver: 0 }, EMPTY_REGISTRY).deflateOver).toBe(0);
    expectRefusal(
      () => resolveScope({ productId: 'p', records: {}, deflateOver: -1 }, EMPTY_REGISTRY),
      'non-negative',
    );
  });
});

describe('resolveScope blobAdapters', () => {
  const withAdapters = (adapters: readonly BlobAdapter[]): ResolvedScope<string> =>
    resolveScope({ productId: 'p', records: {}, blobAdapters: adapters }, EMPTY_REGISTRY);

  it('refuses two adapters at one tag — the scope is where the whole set exists', () => {
    expectRefusal(() => withAdapters([stubAdapter('ts'), stubAdapter('ts')]), 'twice');
  });

  it("refuses a tag containing '$', which is the serialiser's own space", () => {
    expectRefusal(() => withAdapters([stubAdapter('$d')]), "'$'");
  });

  it('refuses an adapter missing a method, or with no usable tag', () => {
    expectRefusal(
      () => withAdapters([{ t: 'x', match: () => false } as unknown as BlobAdapter]),
      'match(), encode() and decode()',
    );
    expectRefusal(() => withAdapters([{ t: '' } as unknown as BlobAdapter]), '1–32 characters');
  });

  it('copies the list, so a later push does not reach the scope', () => {
    const list: BlobAdapter[] = [stubAdapter('ts')];
    const resolved = withAdapters(list);
    list.push(stubAdapter('other'));
    expect(resolved.blobAdapters).toHaveLength(1);
  });
});

describe('resolveScope legacy', () => {
  it("resolves collab's legacy block and nobody else's", () => {
    expect(collabResolved.legacy).not.toBeNull();
    expect(collabResolved.legacy?.readFieldVersions).toEqual(['v1', 'v2']);
    expect(collabResolved.legacy?.objectMetaPrefix).toBe('x-legacy-');
    expect(collabResolved.legacy?.dekWrapAad?.('A')).toBe('accountKeys/A');
    expect(morphResolved.legacy).toBeNull();
  });

  it('an omitted block means no legacy path is reachable at all', () => {
    const resolved = resolveScope({ productId: 'p', records: {} }, EMPTY_REGISTRY);
    expect(resolved.legacy).toBeNull();
  });

  it('an omitted dekWrapAad resolves to null rather than undefined', () => {
    const resolved = resolveScope(
      { productId: 'p', records: {}, legacy: { readFieldVersions: ['v1'] } },
      EMPTY_REGISTRY,
    );
    expect(resolved.legacy?.dekWrapAad).toBeNull();
    expect(resolved.legacy?.objectMetaPrefix).toBe('');
  });

  it("refuses an EMPTY objectMetaPrefix, because startsWith('') is true of everything", () => {
    expectRefusal(
      () =>
        resolveScope(
          { productId: 'p', records: {}, legacy: { objectMetaPrefix: '' } },
          EMPTY_REGISTRY,
        ),
      'omit the key instead',
    );
  });

  it('refuses a field version that is not v1 or v2, and a duplicate', () => {
    expectRefusal(
      () =>
        resolveScope(
          {
            productId: 'p',
            records: {},
            legacy: { readFieldVersions: ['v3'] as unknown as readonly ('v1' | 'v2')[] },
          },
          EMPTY_REGISTRY,
        ),
      "only contain 'v1' and 'v2'",
    );
    expectRefusal(
      () =>
        resolveScope(
          { productId: 'p', records: {}, legacy: { readFieldVersions: ['v1', 'v1'] } },
          EMPTY_REGISTRY,
        ),
      "lists 'v1' twice",
    );
  });
});

// ---------------------------------------------------------------------------
// ceilingsFor — the addendum's own table
// ---------------------------------------------------------------------------

describe('ceilingsFor', () => {
  const rows: readonly [string, ResolvedScope<string>, string, number, number][] = [
    ['Morph results (3 paths)', morphResolved, 'results', 333_333, 249_962],
    ['Morph materials (2 paths)', morphResolved, 'materials', 500_000, 374_960],
    ['Morph objects (2 paths)', morphResolved, 'objects', 500_000, 374_960],
    ['collab messages (9 paths)', collabResolved, 'messages', 111_111, 83_294],
    ['collab projects (3 paths)', collabResolved, 'projects', 333_333, 249_962],
    ['collab accountSettings (1 path)', collabResolved, 'accountSettings', 900_000, 674_960],
  ];

  it.each(rows)('derives %s', (_name, scope, collection, sealed, plaintext) => {
    expect(scope.ceilingsFor(collection)).toEqual({
      maxSealedBytes: sealed,
      maxPlaintextBytes: plaintext,
    });
  });

  it('the single-path case is unchanged: 900 000 sealed, 674 960 of plaintext', () => {
    const scope = resolveScope(buildScope, buildRegistry);
    expect(scope.ceilingsFor('deliverables')).toEqual({
      maxSealedBytes: 900_000,
      maxPlaintextBytes: 674_960,
    });
    expect(maxPlaintextFor(900_000)).toBe(674_960);
  });

  it('fedi-CRM’s opportunities take a third each, its engagements the cap', () => {
    const scope = resolveScope(fediScope, fediRegistry);
    expect(scope.ceilingsFor('opportunities').maxSealedBytes).toBe(333_333);
    expect(scope.ceilingsFor('activityEvents').maxSealedBytes).toBe(500_000);
    expect(scope.ceilingsFor('engagements').maxSealedBytes).toBe(900_000);
  });

  it('counts EVERY registered path, string and blob alike', () => {
    // A registered string sits in the same document as the blobs beside it. Counting only blobs
    // would leave collab's nine-string `messages` summing to 8.1 MB with nothing to say about it.
    const registry = defineRegistry({ mixed: { strings: ['a'], blobs: ['b'] } });
    const scope = resolveScope({ productId: 'p', records: {} }, registry);
    expect(scope.ceilingsFor('mixed').maxSealedBytes).toBe(500_000);
  });

  it('a DECLARED ceiling wins, and drags its plaintext ceiling with it', () => {
    const registry = defineRegistry({ small: { blobs: ['a', 'b'], maxSealedBytes: 100_000 } });
    const scope = resolveScope({ productId: 'p', records: {} }, registry);
    expect(scope.ceilingsFor('small')).toEqual({
      maxSealedBytes: 100_000,
      maxPlaintextBytes: maxPlaintextFor(100_000),
    });
  });

  it('a declared plaintext ceiling wins over the inversion', () => {
    const registry = defineRegistry({ s: { blobs: ['a'], maxPlaintextBytes: 1_000 } });
    const scope = resolveScope({ productId: 'p', records: {} }, registry);
    expect(scope.ceilingsFor('s')).toEqual({ maxSealedBytes: 900_000, maxPlaintextBytes: 1_000 });
  });

  it('the scope’s own per-value cap still binds when the share is bigger', () => {
    const registry = defineRegistry({ one: { blobs: ['a'] } });
    const scope = resolveScope(
      { productId: 'p', records: {}, maxSealedBytes: 10_000 },
      registry,
    );
    expect(scope.ceilingsFor('one').maxSealedBytes).toBe(10_000);
  });

  it('refuses a collection the registry does not have, naming what it does', () => {
    expectRefusal(() => morphResolved.ceilingsFor('nope'), 'nope', 'materials, objects, results');
  });

  it('answers the same object every time — the ceiling is decided once', () => {
    expect(morphResolved.ceilingsFor('results')).toBe(morphResolved.ceilingsFor('results'));
  });

  it.each(WORKED)(
    "$name's derived ceilings sum within the document budget, for every collection",
    ({ scope, registry }) => {
      const resolved = resolveScope(scope, registry);
      for (const collection of registry.collections) {
        const n = registry.entry(collection).paths.length;
        const { maxSealedBytes } = resolved.ceilingsFor(collection);
        expect(n * maxSealedBytes).toBeLessThanOrEqual(resolved.maxDocumentSealedBytes);
      }
    },
  );

  it.each(WORKED)('$name’s registry and scope construct at all', ({ scope, registry }) => {
    expect(() => resolveScope(scope, registry)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// granularityOf / isAccountGranular
// ---------------------------------------------------------------------------

describe('granularityOf and isAccountGranular', () => {
  it('answers for a declared type and for the injected one', () => {
    expect(morphResolved.granularityOf('source')).toBe('aggregate');
    expect(morphResolved.granularityOf('objects')).toBe('document');
    expect(morphResolved.granularityOf(ACCOUNT_RECORD_TYPE)).toBe('account');
  });

  it('refuses an undeclared type, listing the declared ones', () => {
    expectRefusal(
      () => (morphResolved as ResolvedScope<string>).granularityOf('nope'),
      'nope',
      'source, objects, results, account',
    );
  });

  it('isAccountGranular is total: it answers false rather than throwing', () => {
    // A predicate that throws is a predicate every call site wraps in try/catch. An undeclared
    // record type is not "not account-granular", it is a mistake `assertRecord` refuses on the
    // same path two lines later.
    const acct = accountRecordRef('A', 'accountSettings/A');
    const agg = aggregateRecordRef('project', 'p_1', 'projects/p_1');
    expect(collabResolved.isAccountGranular(acct)).toBe(true);
    expect(collabResolved.isAccountGranular(agg)).toBe(false);
    expect(collabResolved.isAccountGranular({ type: 'nope', id: 'x', path: 'a/b' })).toBe(false);
    expect(collabResolved.isAccountGranular(undefined as unknown as RecordRef)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// assertRecord
// ---------------------------------------------------------------------------

describe('assertRecord — the ONE record assertion', () => {
  it('accepts a well-formed record at each granularity', () => {
    expect(() =>
      collabResolved.assertRecord(aggregateRecordRef('project', 'p_1', 'projects/p_1')),
    ).not.toThrow();
    expect(() =>
      morphResolved.assertRecord(documentRecordRef('objects', 'o_1', 'tenants/t/objects/o_1')),
    ).not.toThrow();
    expect(() =>
      collabResolved.assertRecord(accountRecordRef('A', 'accountSettings/A'), 'A'),
    ).not.toThrow();
  });

  it('refuses an undeclared record type', () => {
    expectRefusal(
      () => collabResolved.assertRecord(aggregateRecordRef('topic', 't_1', 'topics/t_1')),
      'topic',
      'not declared in KeyScope.records',
    );
  });

  it('refuses a path that names a DIFFERENT row', () => {
    const err = expectRefusal(
      () => collabResolved.assertRecord(aggregateRecordRef('project', 'p_1', 'projects/p_2')),
      'does not end with',
      '/p_1',
    );
    expect(err.details).toEqual({
      recordType: 'project',
      recordId: 'p_1',
      scopePath: 'projects/p_2',
    });
  });

  it('refuses a path BELOW the wrap holder, and says so in those words', () => {
    expectRefusal(
      () =>
        collabResolved.assertRecord(
          aggregateRecordRef('project', 'p_1', 'projects/p_1/messages/m_1'),
        ),
      'BELOW the wrap holder',
      'walked-children bug',
    );
  });

  it('refuses an account-granular record whose id is not the owner', () => {
    expectRefusal(
      () => collabResolved.assertRecord(accountRecordRef('A', 'accountSettings/A'), 'B'),
      'account-granular',
      '"B"',
    );
  });

  it('does not compare an owner it was not given', () => {
    expect(() =>
      collabResolved.assertRecord(accountRecordRef('A', 'accountSettings/A')),
    ).not.toThrow();
  });

  it('refuses a malformed ref before anything else', () => {
    expectRefusal(
      () => collabResolved.assertRecord(undefined as unknown as RecordRef),
      'a RecordRef is required',
    );
    expectRefusal(
      () => collabResolved.assertRecord({ type: 'project', id: '', path: 'projects/p' } as RecordRef),
      'id must not be empty',
    );
  });
});

// ---------------------------------------------------------------------------
// accountRecord — the degenerate case, without a fake record type
// ---------------------------------------------------------------------------

describe('accountRecord', () => {
  it('builds the ref from the scope’s own path function', () => {
    const ref = collabResolved.accountRecord('atIqNkIXK380Mm4n');
    expect(ref).toEqual({
      type: ACCOUNT_RECORD_TYPE,
      id: 'atIqNkIXK380Mm4n',
      path: 'accountSettings/atIqNkIXK380Mm4n',
    });
  });

  it('refuses when the scope configured none, naming the config key', () => {
    expectRefusal(() => morphResolved.accountRecord('t_1'), 'accountRecordPath');
  });

  it('runs the one record assertion, so a bad path fails where the config is named', () => {
    const resolved = resolveScope(
      {
        productId: 'p',
        records: {},
        // A row that does not end with the account id: legal-looking, and every wrap on it would
        // be bound to a path the reader cannot rebuild.
        accountRecordPath: (a) => `accounts/${a}/contentKeys/p`,
      },
      EMPTY_REGISTRY,
    );
    expectRefusal(() => resolved.accountRecord('A'), 'does not end with', '/A');
  });

  it('refuses a path function that does not return a string, and an empty accountId', () => {
    const resolved = resolveScope(
      { productId: 'p', records: {}, accountRecordPath: (() => 7) as unknown as (a: string) => string },
      EMPTY_REGISTRY,
    );
    expectRefusal(() => resolved.accountRecord('A'), 'must return the full document path');
    expectRefusal(() => collabResolved.accountRecord(''), 'non-empty accountId');
  });

  it('refuses a non-function accountRecordPath at construction', () => {
    expectRefusal(
      () =>
        resolveScope(
          { productId: 'p', records: {}, accountRecordPath: 'accountSettings' as unknown as (a: string) => string },
          EMPTY_REGISTRY,
        ),
      'must be a function',
    );
  });
});

// ---------------------------------------------------------------------------
// assertHead — §16.7's table, verbatim
// ---------------------------------------------------------------------------

describe('assertHead', () => {
  // The scope the table needs: an aggregate type, a document type that IS a registry collection,
  // and the injected account type. One scope, three granularities.
  const registry = defineRegistry({ messages: { strings: ['body'] } });
  const scope = resolveScope(
    {
      productId: 'collab',
      records: { project: 'aggregate', messages: 'document' },
      accountRecordPath: (a) => `accountContentKeys/${a}`,
    },
    registry,
  );

  const head = (record: RecordRef, ownerAccountId: string) => ({
    record,
    ownerAccountId,
    // The rest of a real RecordHead. It reaches `assertHead` structurally, with no cast.
    keyWraps: {},
    ref: { opaque: true },
    precondition: 'updateTime',
    cursor: 'p_1',
  });

  const ref = (type: string, id: string, path: string): RecordRef =>
    type === ACCOUNT_RECORD_TYPE ? accountRecordRef(id, path) : aggregateRecordRef(type, id, path);

  it('aggregate: the aggregate root passes', () => {
    expect(() => assertHead(scope, head(ref('project', 'p_1', 'projects/p_1'), 'A'))).not.toThrow();
  });

  it('aggregate: a path BELOW the root throws — the walked-children bug', () => {
    expectRefusal(
      () => assertHead(scope, head(ref('project', 'p_1', 'projects/p_1/messages/m_1'), 'A')),
      'BELOW the wrap holder',
    );
  });

  it('aggregate: a path that does not end with the id throws', () => {
    expectRefusal(
      () => assertHead(scope, head(ref('project', 'p_1', 'projects/p_2'), 'A')),
      'does not end with',
    );
  });

  it('document: passes when the type is the registry collection', () => {
    const doc = documentRecordRef('messages', 'm_1', 'projects/p_1/messages/m_1');
    expect(() => assertHead(scope, head(doc, 'A'))).not.toThrow();
  });

  it('document: a type that is not the registry collection throws', () => {
    // Morph's `objectRecord` mistake: a record type that reads like a collection and is not one.
    expectRefusal(
      () => assertHead(scope, head(ref('morphObject', 'o_1', 'objects/o_1'), 'A')),
      'morphObject',
      'not declared in KeyScope.records',
    );
  });

  it('account: passes when the record id is the owner', () => {
    expect(() =>
      assertHead(scope, head(ref(ACCOUNT_RECORD_TYPE, 'A', 'accountContentKeys/A'), 'A')),
    ).not.toThrow();
  });

  it('account: throws when the record id is NOT the owner', () => {
    expectRefusal(
      () => assertHead(scope, head(ref(ACCOUNT_RECORD_TYPE, 'A', 'accountContentKeys/A'), 'B')),
      'account-granular',
    );
  });

  it('depth is fine; depth BELOW the root is not — sf-mapper is six segments deep and correct', () => {
    const sfmapper = resolveScope(sfmapperScope, EMPTY_REGISTRY);
    const scan = aggregateRecordRef('scan', 'scan-3', 'accounts/acc-1/sfmapper/org-9/scans/scan-3');
    expect(() => assertHead(sfmapper, head(scan, 'acc-1'))).not.toThrow();
    expectRefusal(
      () =>
        assertHead(
          sfmapper,
          head(
            aggregateRecordRef('scan', 'scan-3', 'accounts/acc-1/sfmapper/org-9/scans/scan-3/rows/r_1'),
            'acc-1',
          ),
        ),
      'BELOW the wrap holder',
    );
  });

  it('refuses a head with no owner, because the account case is checked against it', () => {
    expectRefusal(
      () =>
        assertHead(scope, { record: ref('project', 'p_1', 'projects/p_1') } as unknown as {
          record: RecordRef;
          ownerAccountId: string;
        }),
      'ownerAccountId',
    );
    expectRefusal(
      () => assertHead(scope, undefined as unknown as { record: RecordRef; ownerAccountId: string }),
      'needs a RecordHead',
    );
  });
});

// ---------------------------------------------------------------------------
// resolveGraceMs
// ---------------------------------------------------------------------------

describe('resolveGraceMs', () => {
  it('is 15 minutes when unset, empty or blank', () => {
    expect(DEFAULT_GRACE_MS).toBe(900_000);
    expect(resolveGraceMs({})).toBe(DEFAULT_GRACE_MS);
    expect(resolveGraceMs({ CONTENT_KEY_GRACE_MS: undefined })).toBe(DEFAULT_GRACE_MS);
    expect(resolveGraceMs({ CONTENT_KEY_GRACE_MS: '   ' })).toBe(DEFAULT_GRACE_MS);
  });

  it('reads the duration, and 0 turns grace off', () => {
    expect(resolveGraceMs({ CONTENT_KEY_GRACE_MS: '60000' })).toBe(60_000);
    expect(resolveGraceMs({ CONTENT_KEY_GRACE_MS: ' 60000 ' })).toBe(60_000);
    expect(resolveGraceMs({ CONTENT_KEY_GRACE_MS: '0' })).toBe(0);
  });

  it('THROWS on a malformed value rather than silently reverting to the default', () => {
    // A grace window is how long a revoked key keeps serving. A typo that quietly becomes 15
    // minutes is discovered while reading an incident timeline.
    expectRefusal(() => resolveGraceMs({ CONTENT_KEY_GRACE_MS: 'fifteen' }), 'fifteen');
    expectRefusal(() => resolveGraceMs({ CONTENT_KEY_GRACE_MS: '-1' }), 'non-negative');
    expectRefusal(() => resolveGraceMs({ CONTENT_KEY_GRACE_MS: '1.5' }), 'whole number');
  });

  it('accepts exponent notation, because Number() does — documented, not intended', () => {
    expect(resolveGraceMs({ CONTENT_KEY_GRACE_MS: '1e3' })).toBe(1_000);
  });

  it('defaults its argument to the process environment', () => {
    // Named without writing the variable, which lives in key-scope.ts and nowhere else (assertion
    // 12). This pins the default parameter without the suite acquiring a second home for it.
    expect(resolveGraceMs()).toBe(resolveGraceMs(process.env));
  });
});

// ---------------------------------------------------------------------------
// The degenerate-case equivalence — the type-level half of equivalence.test.ts
// ---------------------------------------------------------------------------

describe('account granularity is aggregate granularity with the dial turned down', () => {
  // §16.6's fixture, verbatim. The four things that had to be true are asserted one by one.
  const registry = defineRegistry({ projects: { strings: ['name', 'description'] } });
  const scope: KeyScope<'project'> = {
    productId: 'collab',
    records: { project: 'aggregate' },
    accountRecordPath: (a) => `accountContentKeys/${a}`,
  };
  const resolved = resolveScope(scope, registry);

  const aggRef = aggregateRecordRef('project', 'p_1', 'projects/p_1');
  const acctRef = resolved.accountRecord('A');

  it('1. ONE scope carries both granularities, so the suite needs ONE instance', () => {
    expect(resolved.records).toEqual({ project: 'aggregate', account: 'account' });
    expect(resolved.granularityOf('project')).toBe('aggregate');
    expect(resolved.granularityOf(ACCOUNT_RECORD_TYPE)).toBe('account');
    // And the types say so: both arms of the union are callable on the ONE resolved scope.
    const g: RecordGranularity = resolved.granularityOf('account');
    expect(g).toBe('account');
    // @ts-expect-error 'topic' is not a declared record type of this scope
    expect(() => resolved.granularityOf('topic')).toThrow();
  });

  it('2. the two refs differ in exactly two fields, and in nothing the content layer sees', () => {
    expect(Object.keys(aggRef).sort()).toEqual(Object.keys(acctRef).sort());
    expect(aggRef.id).toBe('p_1');
    expect(acctRef.id).toBe('A');
    expect(acctRef.type).toBe(ACCOUNT_RECORD_TYPE);
    expect(acctRef.path).toBe('accountContentKeys/A');
    // The content AAD is built from (collection, docId, fieldPath) and never from the ref, which
    // is why one ciphertext opens under either session. Nothing here can reach that call.
    expect(Object.keys(aggRef)).not.toContain('collection');
  });

  it('3. assertScopePath accepts both paths — the fourth thing that had to be true', () => {
    expect(() => assertScopePath(aggRef.path)).not.toThrow();
    expect(() => assertScopePath(acctRef.path)).not.toThrow();
  });

  it('4. the one assertion accepts both, with the account case checked against its owner', () => {
    expect(() => resolved.assertRecord(aggRef, 'A')).not.toThrow();
    expect(() => resolved.assertRecord(acctRef, 'A')).not.toThrow();
    expectRefusal(() => resolved.assertRecord(acctRef, 'B'), 'account-granular');
  });

  it('5. and the same traversal guard passes for both — no branch, same helper', () => {
    const asHead = (record: RecordRef, owner: string) => ({ record, ownerAccountId: owner });
    expect(() => assertHead(resolved, asHead(aggRef, 'A'))).not.toThrow();
    expect(() => assertHead(resolved, asHead(acctRef, 'A'))).not.toThrow();
  });

  it('6. the ONE predicate that separates them, so no other module compares a granularity', () => {
    expect(resolved.isAccountGranular(acctRef)).toBe(true);
    expect(resolved.isAccountGranular(aggRef)).toBe(false);
    // What `content-crypto.ts` does with it: at account granularity the owner IS the record id.
    const owner = resolved.isAccountGranular(acctRef) ? acctRef.id : null;
    expect(owner).toBe('A');
  });
});
