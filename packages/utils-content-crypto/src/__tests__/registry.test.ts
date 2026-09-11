/**
 * `registry.test.ts` — the nine construction-time validations, the literal-union collection
 * type, and the derived ceilings (§16.8, plus finding 4 of the corrections addendum).
 *
 * Three things about the shape of this suite are deliberate.
 *
 * **Each validation gets its own named test, naming the failure it prevents.** A registry is
 * validated once, at construction, in a product's own unit tests, and every rule here exists
 * because of one specific way a table gets a product's live data wrong months later — an AAD
 * that parses two ways, a document that cannot be written, an update key that cannot address
 * the key it names. A loop over a table of bad inputs would be green if a row went missing.
 *
 * **The derived ceilings are asserted as the addendum's own arithmetic, and then as a
 * property.** The table in finding 4 gives six computed rows; all six are pinned here as
 * fixtures, and the property they are instances of — *no undeclared collection can over-commit
 * the document budget* — is asserted separately over every path count the floor permits. The
 * instances catch an arithmetic slip; the property catches a rule change.
 *
 * **All five worked registries of §14 are fixtures here.** Morph's three-blob `results` was the
 * example the v1 spec asserted *throws*; it is a passing fixture now, which is what it should
 * always have been — and since owner ruling R8 it is the fixture that declares ONE LARGE BLOB
 * BESIDE TWO SMALL ONES, a shape no per-collection declaration could express. The addendum's
 * finding-4 arithmetic keeps its own undeclared fixture so the derivation stays pinned
 * independently of what any one product chose to declare.
 *
 * Pure string and integer work — no crypto exists at this point in the build order, and none of
 * it is needed. No clock, no randomness, no environment, relative imports only.
 */

import {
  defineRegistry,
  deriveCeilings,
  derivePathCeilings,
  assertDocumentBudget,
  EMPTY_REGISTRY,
  MIN_DERIVED_SEALED_BYTES,
  RESERVED_ROOTS,
  type DocumentBudget,
  type FieldRegistry,
  type RegistrySpec,
} from '../registry';
import { DEFAULT_MAX_DEPTH, DEFAULT_MAX_SEALED_BYTES, maxPlaintextFor } from '../blob-json';
import { parseFieldPath } from '../field-path';

// ───────────────────────────────────── helpers ─────────────────────────────────────

/**
 * Runs a call that must be refused, asserts the refusal carries `VALIDATION_ERROR`, and hands
 * back the message so a test can also assert what it named.
 *
 * The code is read structurally rather than through `instanceof`: this package ships twice in
 * one process — as a package and as a byte-identical mirror — so the property every caller
 * relies on is "the thrown object carries the taxonomy's code", not "it is this exact class".
 */
function refusalFrom(run: () => unknown): string {
  let thrown: unknown;
  try {
    run();
  } catch (err) {
    thrown = err;
  }
  expect(thrown).toBeInstanceOf(Error);
  const err = thrown as { code?: unknown; status?: unknown; message?: unknown; details?: unknown };
  expect(err.code).toBe('VALIDATION_ERROR');
  expect(err.status).toBe(400);
  return String(err.message);
}

/** The scope defaults, spelled out rather than imported, because they are what §14 assumes. */
const DEFAULT_BUDGET: DocumentBudget = {
  maxSealedBytes: DEFAULT_MAX_SEALED_BYTES,        // 900_000
  maxDocumentSealedBytes: 1_000_000,
};

/**
 * §14.2 — Morph. Blob-heavy; `results` is the three-blob collection v1 could not construct,
 * and it is now the collection that declares ONE LARGE BLOB BESIDE TWO SMALL ONES — the shape
 * owner ruling R8 exists to make expressible, and the one that a per-collection declaration
 * could not say at all.
 */
const morphRegistry = defineRegistry({
  materials: { strings: ['content'], blobs: ['proposal'] },
  objects: { strings: ['name'], blobs: ['files'] },
  results: {
    blobs: [
      { path: 'structuredOutput', maxSealedBytes: 700_000 },
      { path: 'citations', maxSealedBytes: 100_000 },
      { path: 'viewerPayload', maxSealedBytes: 100_000 },
    ],
  },
});

/**
 * The same three blobs with nothing declared, which is the registry the corrections addendum's
 * finding-4 table computes (`results`: N=3 → 333 333 / 249 962). Kept as its own fixture so
 * that arithmetic stays pinned now that §14.2 declares its own numbers: the derivation is what
 * every product still gets by default, and it must not drift because one product opted out.
 */
const morphUndeclaredRegistry = defineRegistry({
  results: { blobs: ['structuredOutput', 'citations', 'viewerPayload'] },
});

/** §14.3 — build. One blob each, and the `checkpoints` root override. */
const buildRegistry = defineRegistry({
  deliverables: { blobs: ['structuredContent'] },
  specEntities: { blobs: ['fields'] },
  checkpoints: { blobs: ['payload'], root: 'phases' },
});

/** §14.4 — collab. The only field-level consumer; `messages` carries nine registered strings. */
const collabRegistry = defineRegistry({
  projects: { strings: ['name', 'description', 'lastActivitySummary'] },
  topics: { strings: ['title', 'authoringError', 'declinedProposals[]'] },
  artefacts: { strings: ['content', 'openQuestions[]', 'lastEditedBecause'] },
  versions: { strings: ['content', 'summary', 'label'], root: 'artefacts' },
  messages: {
    strings: [
      'body', 'anchor.quote', 'anchor.prefix', 'anchor.suffix', 'anchor.sectionTitle',
      'proposal.title', 'proposal.rationale', 'proposal.seedContent', 'attachments[].filename',
    ],
  },
  notifications: { strings: ['title', 'body'] },
  accountSettings: { strings: ['theme.wordmark'] },
});

/** §14.5 — fedi-CRM. Mixed strings and blobs, three registered paths on `opportunities`. */
const fediCrmRegistry = defineRegistry({
  opportunities: { strings: ['name'], blobs: ['terms', 'contract'] },
  engagements: { blobs: ['terms'] },
  notes: { blobs: ['body'] },
  activityEvents: { strings: ['summary'], blobs: ['payload'] },
});

/** All five of §14, sf-mapper included — it adopts the object envelope only, and registers nothing. */
const WORKED_REGISTRIES: ReadonlyArray<readonly [string, FieldRegistry<string>]> = [
  ['morph', morphRegistry],
  ['build', buildRegistry],
  ['collab', collabRegistry],
  ['fedi-CRM', fediCrmRegistry],
  ['sf-mapper', EMPTY_REGISTRY],
];

// ───────────────────────────────── the resolved table ─────────────────────────────────

describe('the resolved table', () => {
  const registry = defineRegistry({
    topics: { strings: ['title', 'declinedProposals[]'], blobs: ['draft'] },
    versions: { strings: ['content'], root: 'artefacts', reads: 'lenient' },
  });

  it('keeps the collection keys in declared order', () => {
    expect(registry.collections).toEqual(['topics', 'versions']);
  });

  it('answers `has` for a registered key only, and never for an inherited one', () => {
    expect(registry.has('topics')).toBe(true);
    expect(registry.has('nope')).toBe(false);
    expect(registry.has('__proto__')).toBe(false);
    expect(registry.has('toString')).toBe(false);
    expect(registry.has(undefined)).toBe(false);
    expect(registry.has(7)).toBe(false);
  });

  it('lists the strings in declared order and then the blobs, which is what `visited` counts', () => {
    expect(registry.pathsFor('topics').map((p) => `${p.mode}:${p.fieldPath}`)).toEqual([
      'string:title', 'string:declinedProposals[]', 'blob:draft',
    ]);
  });

  it("retains a path's `[]` exactly as registered, because that string is what the AAD binds", () => {
    const path = registry.pathsFor('topics')[1];
    expect(path.fieldPath).toBe('declinedProposals[]');
    expect(path.segments).toEqual(parseFieldPath('declinedProposals[]'));
  });

  it('carries no EFFECTIVE ceiling on a ResolvedPath — that needs the scope (finding 4)', () => {
    for (const path of registry.pathsFor('topics')) {
      expect(Object.keys(path).sort()).toEqual([
        'declaredMaxPlaintextBytes', 'declaredMaxSealedBytes', 'fieldPath', 'mode', 'segments',
      ]);
      // What a path carries is what the product DECLARED, and these declared nothing. The
      // effective number is `derivePathCeilings`', and it is not on this object.
      expect(path.declaredMaxSealedBytes).toBeNull();
      expect(path.declaredMaxPlaintextBytes).toBeNull();
      expect(path).not.toHaveProperty('maxSealedBytes');
    }
  });

  it('resolves `root` to the collection key, or to the override, and says which', () => {
    expect(registry.entry('topics').root).toBe('topics');
    expect(registry.entry('topics').hasRootOverride).toBe(false);
    expect(registry.entry('versions').root).toBe('artefacts');
    expect(registry.entry('versions').hasRootOverride).toBe(true);
  });

  it('publishes the collection-wide shorthand as declared, and `null` when nothing was declared', () => {
    const declared = defineRegistry({ a: { blobs: ['x'], maxSealedBytes: 4_000, maxPlaintextBytes: 2_000 } });
    expect(declared.entry('a').declaredMaxSealedBytes).toBe(4_000);
    expect(declared.entry('a').declaredMaxPlaintextBytes).toBe(2_000);
    expect(registry.entry('topics').declaredMaxSealedBytes).toBeNull();
    expect(registry.entry('topics').declaredMaxPlaintextBytes).toBeNull();
  });

  it('publishes a PATH’s own declaration on the path, and never on the entry (R8)', () => {
    const declared = defineRegistry({
      a: { blobs: [{ path: 'x', maxSealedBytes: 4_000, maxPlaintextBytes: 2_000 }, 'y'] },
    });
    const [x, y] = declared.pathsFor('a');
    expect(x.fieldPath).toBe('x');
    expect(x.declaredMaxSealedBytes).toBe(4_000);
    expect(x.declaredMaxPlaintextBytes).toBe(2_000);
    expect(y.declaredMaxSealedBytes).toBeNull();
    // The entry declared nothing: a path's number is the path's, and the sum has to be able to
    // tell the two apart to say where the bytes came from.
    expect(declared.entry('a').declaredMaxSealedBytes).toBeNull();
  });

  it('takes a PathSpec anywhere a bare string goes, in either list, keeping declared order', () => {
    const mixed = defineRegistry({
      a: {
        strings: ['title', { path: 'summary', maxSealedBytes: 1_000 }],
        blobs: [{ path: 'payload', maxSealedBytes: 2_000 }, 'notes'],
      },
    });
    expect(mixed.pathsFor('a').map((p) => `${p.mode}:${p.fieldPath}`)).toEqual([
      'string:title', 'string:summary', 'blob:payload', 'blob:notes',
    ]);
    expect(mixed.pathsFor('a').map((p) => p.declaredMaxSealedBytes)).toEqual([null, 1_000, 2_000, null]);
  });

  it('applies every path rule to a PathSpec’s `path`, which is the same string by another route', () => {
    // Validation 2 (no `[]` in a blob), 1 (disjoint) and 9 (segment keys) reach the long form.
    refusalFrom(() => defineRegistry({ a: { blobs: [{ path: 'files[]' }] } }));
    refusalFrom(() => defineRegistry({ a: { blobs: [{ path: 'payload' }, 'payload'] } }));
    refusalFrom(() => defineRegistry({ a: { strings: [{ path: 'we`ird' }] } }));
    refusalFrom(() => defineRegistry({ a: { strings: [{ path: 7 as unknown as string }] } }));
  });

  it('refuses an unregistered collection by name, listing what is registered', () => {
    const message = refusalFrom(() => (registry as FieldRegistry<string>).entry('missing'));
    expect(message).toContain('"missing"');
    expect(message).toContain('"topics"');
  });

  it('registers a collection with no paths at all, which a document-granular record may need', () => {
    const empty = defineRegistry({ scans: {} });
    expect(empty.has('scans')).toBe(true);
    expect(empty.pathsFor('scans')).toEqual([]);
  });

  it('copies the declared arrays, so mutating the spec afterwards cannot widen the table', () => {
    const strings = ['title'];
    const built = defineRegistry({ topics: { strings } });
    strings.push('secretlyAdded');
    expect(built.pathsFor('topics').map((p) => p.fieldPath)).toEqual(['title']);
  });

  it('freezes what it hands back, so a consumer cannot mutate the shared table', () => {
    expect(Object.isFrozen(registry)).toBe(true);
    expect(Object.isFrozen(registry.collections)).toBe(true);
    expect(Object.isFrozen(registry.entry('topics'))).toBe(true);
    expect(Object.isFrozen(registry.entry('topics').paths)).toBe(true);
    expect(Object.isFrozen(registry.pathsFor('topics')[0])).toBe(true);
  });
});

// ─────────────────────────── validation 1 — pairwise disjoint ───────────────────────────

describe('validation 1 — within a collection, registered paths are pairwise disjoint', () => {
  it('refuses the same path registered twice in the same mode', () => {
    const message = refusalFrom(() => defineRegistry({ a: { strings: ['title', 'title'] } }));
    expect(message).toContain('"title"');
    expect(message).toContain('twice');
  });

  it('refuses the same path registered once as a string and once as a blob', () => {
    const message = refusalFrom(() => defineRegistry({ a: { strings: ['payload'], blobs: ['payload'] } }));
    expect(message).toContain('"payload"');
    expect(message).toContain('twice');
  });

  it('refuses a path nested inside another, because the outer value is sealed ciphertext', () => {
    const message = refusalFrom(() => defineRegistry({ a: { blobs: ['payload'], strings: ['payload.title'] } }));
    expect(message).toContain('"payload.title"');
    expect(message).toContain('"payload"');
    expect(message).toContain('ciphertext');
  });

  it('refuses the nesting in either declaration order', () => {
    refusalFrom(() => defineRegistry({ a: { strings: ['payload.title'], blobs: ['payload'] } }));
    refusalFrom(() => defineRegistry({ a: { strings: ['payload.title', 'payload'] } }));
  });

  it('refuses `attachments` beside `attachments[].filename`, which a string compare would miss', () => {
    const message = refusalFrom(
      () => defineRegistry({ messages: { strings: ['attachments', 'attachments[].filename'] } }),
    );
    expect(message).toContain('"attachments"');
  });

  it("refuses `a` beside `a[]`, which differ only in a marker and address the same node", () => {
    const message = refusalFrom(() => defineRegistry({ a: { strings: ['tags', 'tags[]'] } }));
    expect(message).toContain("'[]'");
    expect(message).toContain('same node');
  });

  it('ACCEPTS `attach` beside `attachments`: disjointness is over segments, never over characters', () => {
    const registry = defineRegistry({ a: { strings: ['attach', 'attachments'] } });
    expect(registry.pathsFor('a').map((p) => p.fieldPath)).toEqual(['attach', 'attachments']);
  });

  it('ACCEPTS siblings under one parent — collab registers five of them under `anchor`', () => {
    expect(collabRegistry.pathsFor('messages').map((p) => p.fieldPath)).toContain('anchor.quote');
    expect(collabRegistry.pathsFor('messages').map((p) => p.fieldPath)).toContain('anchor.prefix');
  });

  it('scopes disjointness to one collection, so two collections may register the same path', () => {
    const registry = defineRegistry({ a: { blobs: ['payload'] }, b: { blobs: ['payload'] } });
    expect(registry.pathsFor('a')[0].fieldPath).toBe('payload');
    expect(registry.pathsFor('b')[0].fieldPath).toBe('payload');
  });
});

// ──────────────────────── validation 2 — no `[]` in a blob path ────────────────────────

describe('validation 2 — a blob path contains no `[]` segment', () => {
  it("refuses a blob registered as `files[]`", () => {
    const message = refusalFrom(() => defineRegistry({ a: { blobs: ['files[]'] } }));
    expect(message).toContain('"files[]"');
    expect(message).toContain('one subtree');
  });

  it('refuses a `[]` anywhere in a blob path, not only at its end', () => {
    refusalFrom(() => defineRegistry({ a: { blobs: ['items[].payload'] } }));
  });

  it('ACCEPTS the same shape as a string path, which is what the string mode is for', () => {
    const registry = defineRegistry({ a: { strings: ['items[].payload'] } });
    expect(registry.pathsFor('a')[0].mode).toBe('string');
  });
});

// ──────────────────────── validation 3 — the field-path grammar ────────────────────────

describe('validation 3 — every path parses under the field-path grammar', () => {
  it.each([
    ['the empty string', ''],
    ['a bare dot', '.'],
    ['a trailing dot', 'a.'],
    ['a leading dot', '.a'],
    ['a doubled dot', 'a..b'],
  ])('refuses %s', (_why, path) => {
    refusalFrom(() => defineRegistry({ a: { strings: [path] } }));
  });

  it.each([
    ['an indexed segment', 'a[0]'],
    ['a marker in the middle of a segment', 'a[]b'],
    ['an unclosed bracket', 'a['],
    ['a stray closing bracket', 'a]'],
  ])('refuses %s, which would otherwise parse as a key that addresses nothing', (_why, path) => {
    refusalFrom(() => defineRegistry({ a: { strings: [path] } }));
  });

  it('refuses a path that is not a string at all', () => {
    const message = refusalFrom(() => defineRegistry({ a: { strings: [7 as unknown as string] } }));
    expect(message).toContain('a number');
  });

  it('refuses a path list that is not an array', () => {
    refusalFrom(() => defineRegistry({ a: { strings: 'title' as unknown as string[] } }));
  });

  it('ACCEPTS every shape collab has deployed', () => {
    const paths = collabRegistry.pathsFor('messages').map((p) => p.fieldPath);
    expect(paths).toContain('body');
    expect(paths).toContain('anchor.quote');
    expect(paths).toContain('attachments[].filename');
    expect(collabRegistry.pathsFor('topics').map((p) => p.fieldPath)).toContain('declinedProposals[]');
  });
});

// ─────────────────── validation 4 — a declared ceiling is a positive integer ───────────────────

describe('validation 4 — declared ceilings are positive integers', () => {
  it.each([
    ['zero', 0],
    ['a negative', -1],
    ['a fraction', 1.5],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['a value past MAX_SAFE_INTEGER', Number.MAX_SAFE_INTEGER + 1],
  ])('refuses maxSealedBytes of %s', (_why, value) => {
    const message = refusalFrom(() => defineRegistry({ a: { blobs: ['x'], maxSealedBytes: value } }));
    expect(message).toContain('maxSealedBytes');
    expect(message).toContain('"a"');
  });

  it('refuses a numeric string, which is what a config file hands over', () => {
    refusalFrom(() => defineRegistry({ a: { blobs: ['x'], maxSealedBytes: '900000' as unknown as number } }));
  });

  it('applies the same rule to maxPlaintextBytes', () => {
    const message = refusalFrom(() => defineRegistry({ a: { blobs: ['x'], maxPlaintextBytes: 0 } }));
    expect(message).toContain('maxPlaintextBytes');
  });

  it('ACCEPTS an absent ceiling, which is the intended setting', () => {
    expect(defineRegistry({ a: { blobs: ['x'] } }).entry('a').declaredMaxSealedBytes).toBeNull();
  });

  it.each([
    ['zero', 0],
    ['a negative', -1],
    ['a fraction', 1.5],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
  ])('applies the same rule to a PATH’s own maxSealedBytes of %s, and names the path', (_why, value) => {
    const message = refusalFrom(
      () => defineRegistry({ a: { blobs: ['ok', { path: 'x', maxSealedBytes: value }] } }),
    );
    expect(message).toContain('maxSealedBytes');
    expect(message).toContain('"a"');
    expect(message).toContain('"x"');            // which of the collection's paths carries it
  });

  it('names the path for a bad per-path maxPlaintextBytes too', () => {
    const message = refusalFrom(
      () => defineRegistry({ a: { blobs: [{ path: 'x', maxPlaintextBytes: 0 }] } }),
    );
    expect(message).toContain('maxPlaintextBytes');
    expect(message).toContain('"x"');
  });
});

// ──────────────── validations 5 and 7 — no `/` and no `.` in a key or a root ────────────────

describe('validations 5 and 7 — a collection key or root contains no `/` and no `.`', () => {
  it("refuses `/` in a collection key: root `a/b` + docId `c` is the string root `a` + docId `b/c`", () => {
    const message = refusalFrom(() => defineRegistry({ 'a/b': { strings: ['title'] } }));
    expect(message).toContain('"a/b"');
    expect(message).toContain('one AAD');
  });

  it('refuses `/` in a root override', () => {
    refusalFrom(() => defineRegistry({ versions: { strings: ['content'], root: 'artefacts/x' } }));
  });

  it("refuses `.` in a collection key: root `a.b` breaks the first-dot split that recovers the docId", () => {
    const message = refusalFrom(() => defineRegistry({ 'a.b': { strings: ['title'] } }));
    expect(message).toContain('"a.b"');
    expect(message).toContain('first-dot split');
  });

  it('refuses `.` in a root override — new in v2; v1 forbade only `/`', () => {
    refusalFrom(() => defineRegistry({ versions: { strings: ['content'], root: 'arte.facts' } }));
  });

  it('refuses an empty collection key and an empty root', () => {
    refusalFrom(() => defineRegistry({ '': { strings: ['title'] } }));
    refusalFrom(() => defineRegistry({ versions: { strings: ['content'], root: '' } }));
  });

  it('checks the collection key even when a root override means the key never reaches an AAD', () => {
    refusalFrom(() => defineRegistry({ 'a/b': { strings: ['content'], root: 'artefacts' } }));
  });
});

// ────────────────────────── validation 6 — depth ──────────────────────────

describe('validation 6 — path depth is within DEFAULT_MAX_DEPTH', () => {
  const deep = (n: number) => Array.from({ length: n }, (_v, i) => `s${i}`).join('.');

  it('ACCEPTS a path exactly at the limit', () => {
    const registry = defineRegistry({ a: { strings: [deep(DEFAULT_MAX_DEPTH)] } });
    expect(registry.pathsFor('a')[0].segments).toHaveLength(DEFAULT_MAX_DEPTH);
  });

  it('refuses a path one segment past it, naming the depth and the limit', () => {
    const message = refusalFrom(() => defineRegistry({ a: { strings: [deep(DEFAULT_MAX_DEPTH + 1)] } }));
    expect(message).toContain(String(DEFAULT_MAX_DEPTH + 1));
    expect(message).toContain(String(DEFAULT_MAX_DEPTH));
  });
});

// ────────────────────────── validation 8 — reserved roots ──────────────────────────

describe('validation 8 — a collection key or root is not in RESERVED_ROOTS', () => {
  it('reserves exactly `record-key`, `content-key` and `obj`', () => {
    expect([...RESERVED_ROOTS].sort()).toEqual(['content-key', 'obj', 'record-key']);
  });

  it.each(['record-key', 'content-key', 'obj'])('refuses %s as a collection key', (name) => {
    const message = refusalFrom(() => defineRegistry({ [name]: { strings: ['title'] } }));
    expect(message).toContain(`"${name}"`);
    expect(message).toContain('reserved');
  });

  it.each(['record-key', 'content-key', 'obj'])('refuses %s as a root override', (name) => {
    refusalFrom(() => defineRegistry({ versions: { strings: ['content'], root: name } }));
  });

  it('validates against a private copy, so deleting from the exported set cannot weaken it', () => {
    (RESERVED_ROOTS as Set<string>).delete('record-key');
    try {
      refusalFrom(() => defineRegistry({ 'record-key': { strings: ['title'] } }));
    } finally {
      (RESERVED_ROOTS as Set<string>).add('record-key');
    }
    expect(RESERVED_ROOTS.has('record-key')).toBe(true);
  });
});

// ────────────────────── validation 9 — a segment key is a plain identifier ──────────────────────

describe('validation 9 — every registered path segment key is a plain identifier', () => {
  it('refuses a backtick, which is the blob subPath grammar’s escape character', () => {
    const message = refusalFrom(() => defineRegistry({ a: { strings: ['we`ird'] } }));
    expect(message).toContain('backtick');
  });

  it('refuses `/` in a segment, which would let a key forge the shape of a document path', () => {
    refusalFrom(() => defineRegistry({ a: { strings: ['a/b'] } }));
  });

  it('refuses an empty segment, which `update()` could not address', () => {
    refusalFrom(() => defineRegistry({ a: { strings: ['a..b'] } }));
  });

  it('accepts every segment key collab has deployed, which satisfies this rule by accident', () => {
    for (const [, registry] of WORKED_REGISTRIES) {
      for (const collection of registry.collections) {
        for (const path of registry.pathsFor(collection)) {
          for (const segment of path.segments) {
            expect(segment.key).not.toBe('');
            expect(segment.key).not.toMatch(/[./`[\]]/);
          }
        }
      }
    }
  });
});

// ─────────────────────────────── aadFor and readsFor ───────────────────────────────

describe('aadFor — the only content-AAD builder outside aad.ts, and it delegates', () => {
  it('is byte-identical to collab’s live AAD strings, through the registry', () => {
    expect(collabRegistry.aadFor('messages', 'abc', 'anchor.quote')).toBe('messages/abc.anchor.quote');
    expect(collabRegistry.aadFor('topics', 't1', 'declinedProposals[]')).toBe('topics/t1.declinedProposals[]');
    expect(collabRegistry.aadFor('accountSettings', 'acc', 'theme.wordmark'))
      .toBe('accountSettings/acc.theme.wordmark');
  });

  it('uses the root override, so a version row’s AAD is its real store path', () => {
    expect(collabRegistry.aadFor('versions', 't1/versions/v3', 'content'))
      .toBe('artefacts/t1/versions/v3.content');
  });

  it('builds build’s nested checkpoint AAD, where the AAD id is not the row id', () => {
    expect(buildRegistry.aadFor('checkpoints', 'build/checkpoints/epic-4', 'payload'))
      .toBe('phases/build/checkpoints/epic-4.payload');
    expect(buildRegistry.aadFor('deliverables', 'd_12', 'structuredContent'))
      .toBe('deliverables/d_12.structuredContent');
  });

  it('inherits aad.ts’s component rules rather than restating them', () => {
    refusalFrom(() => collabRegistry.aadFor('messages', '', 'body'));
    refusalFrom(() => collabRegistry.aadFor('messages', 'a.b', 'body'));
    refusalFrom(() => collabRegistry.aadFor('messages', 'abc', ''));
  });

  it('refuses an unregistered collection before it builds anything', () => {
    refusalFrom(() => (collabRegistry as FieldRegistry<string>).aadFor('nope', 'abc', 'body'));
  });
});

describe('readsFor — entry ?? scope ?? strict', () => {
  const registry = defineRegistry({
    lenient: { strings: ['a'], reads: 'lenient' },
    strict: { strings: ['a'], reads: 'strict' },
    silent: { strings: ['a'] },
  });

  it('prefers the entry’s own override over the scope default, in both directions', () => {
    expect(registry.readsFor('lenient', 'strict')).toBe('lenient');
    expect(registry.readsFor('strict', 'lenient')).toBe('strict');
  });

  it('falls back to the scope default when the entry declares nothing', () => {
    expect(registry.readsFor('silent', 'lenient')).toBe('lenient');
    expect(registry.readsFor('silent', 'strict')).toBe('strict');
  });

  it('falls back to strict when a JavaScript caller omits the argument, never to leniency', () => {
    const untyped = registry as unknown as { readsFor(c: string): string };
    expect(untyped.readsFor('silent')).toBe('strict');
  });

  it('refuses a reads value outside the two', () => {
    const message = refusalFrom(
      () => defineRegistry({ a: { strings: ['x'], reads: 'loose' as unknown as 'strict' } }),
    );
    expect(message).toContain('strict');
    expect(message).toContain('lenient');
  });
});

// ─────────────────────────── the literal-union collection type ───────────────────────────

describe('the literal-union collection type survives the factory', () => {
  const registry = defineRegistry({ topics: { strings: ['title'] } });

  it('accepts a registered key and refuses an unregistered one at compile time', () => {
    expect(registry.entry('topics').root).toBe('topics');
    // @ts-expect-error 'projects' is not a key of this registry — R10's whole point.
    expect(() => registry.entry('projects')).toThrow();
  });

  it('makes EMPTY_REGISTRY’s document methods uncallable, which IS sf-mapper’s adoption', () => {
    expect(EMPTY_REGISTRY.collections).toEqual([]);
    expect(EMPTY_REGISTRY.has('anything')).toBe(false);
    // @ts-expect-error C is `never`: there is no collection to pass, so no document method
    // can be written at all. That is the enforcement, not a convention.
    expect(() => EMPTY_REGISTRY.entry('anything')).toThrow();
  });
});

// ─────────────────────────── the derived ceilings (finding 4) ───────────────────────────

describe('the derived ceilings — the addendum’s arithmetic, row by row', () => {
  const ceilingsFor = (registry: FieldRegistry<string>, collection: string, budget = DEFAULT_BUDGET) =>
    deriveCeilings(registry.entry(collection), budget);

  /** One path's effective ceiling — what a write is actually measured against (R8). */
  const pathCeilings = (
    registry: FieldRegistry<string>, collection: string, fieldPath: string, budget = DEFAULT_BUDGET,
  ) => {
    const entry = registry.entry(collection);
    const path = entry.paths.find((p) => p.fieldPath === fieldPath);
    if (path === undefined) throw new Error(`no such path ${fieldPath}`);
    return derivePathCeilings(entry, path, budget);
  };

  it.each([
    { name: 'Morph results (nothing declared)', registry: morphUndeclaredRegistry as FieldRegistry<string>, collection: 'results', n: 3, sealed: 333_333, plaintext: 249_962 },
    { name: 'Morph materials', registry: morphRegistry as FieldRegistry<string>, collection: 'materials', n: 2, sealed: 500_000, plaintext: 374_960 },
    { name: 'Morph objects', registry: morphRegistry as FieldRegistry<string>, collection: 'objects', n: 2, sealed: 500_000, plaintext: 374_960 },
    { name: 'fedi-CRM opportunities', registry: fediCrmRegistry as FieldRegistry<string>, collection: 'opportunities', n: 3, sealed: 333_333, plaintext: 249_962 },
    { name: 'fedi-CRM activityEvents', registry: fediCrmRegistry as FieldRegistry<string>, collection: 'activityEvents', n: 2, sealed: 500_000, plaintext: 374_960 },
    { name: 'build deliverables', registry: buildRegistry as FieldRegistry<string>, collection: 'deliverables', n: 1, sealed: 900_000, plaintext: 674_960 },
    { name: 'collab messages', registry: collabRegistry as FieldRegistry<string>, collection: 'messages', n: 9, sealed: 111_111, plaintext: 83_294 },
  ])('$name: N=$n → $sealed sealed, $plaintext plaintext', ({ registry, collection, n, sealed, plaintext }) => {
    expect(registry.pathsFor(collection)).toHaveLength(n);
    expect(ceilingsFor(registry, collection)).toEqual({
      maxSealedBytes: sealed, maxPlaintextBytes: plaintext,
    });
  });

  it('counts every registered path, string and blob alike, because they share one document', () => {
    // `opportunities` is one string and two blobs. A rule that counted only blobs would give it
    // 500 000 each and let the document reach 1.5 MB.
    expect(fediCrmRegistry.pathsFor('opportunities').filter((p) => p.mode === 'blob')).toHaveLength(2);
    expect(ceilingsFor(fediCrmRegistry, 'opportunities').maxSealedBytes).toBe(333_333);
  });

  it('leaves the single-path case exactly where it was, so 674 960 stays the pinned number', () => {
    expect(ceilingsFor(buildRegistry, 'specEntities')).toEqual({
      maxSealedBytes: DEFAULT_MAX_SEALED_BYTES, maxPlaintextBytes: maxPlaintextFor(DEFAULT_MAX_SEALED_BYTES),
    });
    expect(maxPlaintextFor(DEFAULT_MAX_SEALED_BYTES)).toBe(674_960);
  });

  it('lets a declared ceiling win outright, in both directions', () => {
    const registry = defineRegistry({
      small: { blobs: ['a', 'b'], maxSealedBytes: 10_000 },
      large: { blobs: ['a'], maxSealedBytes: 999_999 },
    });
    expect(ceilingsFor(registry, 'small').maxSealedBytes).toBe(10_000);
    expect(ceilingsFor(registry, 'large').maxSealedBytes).toBe(999_999);
  });

  it('derives the plaintext ceiling from the effective sealed one unless it too was declared', () => {
    const derived = defineRegistry({ a: { blobs: ['x'], maxSealedBytes: 10_000 } });
    expect(ceilingsFor(derived, 'a').maxPlaintextBytes).toBe(maxPlaintextFor(10_000));
    const declared = defineRegistry({ a: { blobs: ['x'], maxSealedBytes: 10_000, maxPlaintextBytes: 99 } });
    expect(ceilingsFor(declared, 'a').maxPlaintextBytes).toBe(99);
  });

  it('gives a collection with no registered paths the scope’s per-value ceiling, not Infinity', () => {
    const registry = defineRegistry({ scans: {} });
    expect(ceilingsFor(registry, 'scans').maxSealedBytes).toBe(DEFAULT_MAX_SEALED_BYTES);
  });

  it('follows a raised document budget, so the escape hatch is one declared number', () => {
    const budget = { maxSealedBytes: 900_000, maxDocumentSealedBytes: 3_000_000 };
    expect(ceilingsFor(morphUndeclaredRegistry, 'results', budget).maxSealedBytes).toBe(900_000);
  });

  it('freezes what it returns', () => {
    expect(Object.isFrozen(ceilingsFor(morphUndeclaredRegistry, 'results'))).toBe(true);
    expect(Object.isFrozen(pathCeilings(morphRegistry, 'results', 'citations'))).toBe(true);
  });

  // ── per-path, which is the whole of R8 ──────────────────────────────────────────────────

  it('gives Morph’s §14.2 `results` ONE LARGE BLOB AND TWO SMALL ONES — the shape R8 exists for', () => {
    expect(pathCeilings(morphRegistry, 'results', 'structuredOutput')).toEqual({
      maxSealedBytes: 700_000, maxPlaintextBytes: 524_960,
    });
    expect(pathCeilings(morphRegistry, 'results', 'citations')).toEqual({
      maxSealedBytes: 100_000, maxPlaintextBytes: 74_960,
    });
    expect(pathCeilings(morphRegistry, 'results', 'viewerPayload').maxSealedBytes).toBe(100_000);
    // Undeclared collections in the same registry are untouched: the declaration is the path's.
    expect(pathCeilings(morphRegistry, 'materials', 'content').maxSealedBytes).toBe(500_000);
  });

  it('resolves a path’s ceiling as path, then collection shorthand, then derived share', () => {
    const registry = defineRegistry({
      c: { blobs: [{ path: 'own', maxSealedBytes: 40_000 }, 'shorthand'], maxSealedBytes: 20_000 },
      d: { blobs: [{ path: 'own', maxSealedBytes: 40_000 }, 'derived'] },
    });
    expect(pathCeilings(registry, 'c', 'own').maxSealedBytes).toBe(40_000);          // the path's
    expect(pathCeilings(registry, 'c', 'shorthand').maxSealedBytes).toBe(20_000);    // the entry's
    expect(pathCeilings(registry, 'd', 'own').maxSealedBytes).toBe(40_000);          // the path's
    expect(pathCeilings(registry, 'd', 'derived').maxSealedBytes).toBe(500_000);     // 1 000 000 / 2
  });

  it('lets a path’s plaintext ceiling follow ITS sealed one, not the collection’s', () => {
    const registry = defineRegistry({
      c: { blobs: [{ path: 'big', maxSealedBytes: 700_000 }, { path: 'small', maxSealedBytes: 100_000 }] },
    });
    expect(pathCeilings(registry, 'c', 'big').maxPlaintextBytes).toBe(maxPlaintextFor(700_000));
    expect(pathCeilings(registry, 'c', 'small').maxPlaintextBytes).toBe(maxPlaintextFor(100_000));
  });

  it('takes a path’s own declared plaintext ceiling over the derivation, on that path alone', () => {
    const registry = defineRegistry({
      c: { blobs: [{ path: 'x', maxSealedBytes: 10_000, maxPlaintextBytes: 99 }, 'y'] },
    });
    expect(pathCeilings(registry, 'c', 'x').maxPlaintextBytes).toBe(99);
    expect(pathCeilings(registry, 'c', 'y').maxPlaintextBytes).toBe(maxPlaintextFor(500_000));
  });

  it('makes the collection-wide answer the WIDEST of its paths, which is a bound, not a ceiling', () => {
    // `ceilingsFor(collection)` still answers "the largest a single value here may be". With
    // paths of different sizes it is an upper bound: enforcement is per path, and a check
    // against this number would let `citations` carry a value sized for `structuredOutput`.
    expect(ceilingsFor(morphRegistry, 'results')).toEqual({
      maxSealedBytes: 700_000, maxPlaintextBytes: 524_960,
    });
    // Where every path is the same size — every §14 registry but Morph's `results` — the bound
    // IS the ceiling, which is why the six pinned rows above are unchanged.
    expect(ceilingsFor(fediCrmRegistry, 'opportunities').maxSealedBytes)
      .toBe(pathCeilings(fediCrmRegistry, 'opportunities', 'terms').maxSealedBytes);
  });
});

// ─────────────────────── the per-document budget, genuinely enforced ───────────────────────

describe('assertDocumentBudget — resolveScope’s validation 5', () => {
  /** The sum the check takes: every path's own effective ceiling, added up (R8). */
  const committedBytes = (registry: FieldRegistry<string>, collection: string) => {
    const entry = registry.entry(collection);
    return entry.paths.reduce(
      (total, path) => total + derivePathCeilings(entry, path, DEFAULT_BUDGET).maxSealedBytes,
      0,
    );
  };

  it('refuses a collection whose declared ceilings SUM past the budget, and says by how much', () => {
    const registry = defineRegistry({ results: { blobs: ['a', 'b', 'c'], maxSealedBytes: 900_000 } });
    const message = refusalFrom(() => assertDocumentBudget(registry, DEFAULT_BUDGET));
    expect(message).toContain('"results"');
    expect(message).toContain('900000');          // the largest declared ceiling
    expect(message).toContain('3 registered paths');
    expect(message).toContain('2700000');         // the sum
    expect(message).toContain('1000000');         // the budget
    expect(message).toContain('333333');          // what dropping a declaration would give
    expect(message).toContain('by 1700000');      // BY HOW MUCH the arithmetic disagrees
  });

  it('sums a MIXED collection path by path, and reports both halves of where the bytes went', () => {
    // One declared big blob beside two undeclared paths: 700 000 + 2 × 333 333 = 1 366 666.
    // A per-collection rule could not even express this, let alone add it up correctly.
    const registry = defineRegistry({
      results: { blobs: [{ path: 'big', maxSealedBytes: 700_000 }, 'a', 'b'] },
    });
    const message = refusalFrom(() => assertDocumentBudget(registry, DEFAULT_BUDGET));
    expect(message).toContain('1366666');                     // the sum
    expect(message).toContain('1 declared, summing to 700000');
    expect(message).toContain('"big"');                       // which path to lower
    expect(message).toContain('2 taking the derived share of 333333 each');
    expect(message).toContain('by 366666');
  });

  it('ACCEPTS a mixed collection whose paths add up, which is the point of declaring per path', () => {
    const registry = defineRegistry({
      results: { blobs: [{ path: 'big', maxSealedBytes: 300_000 }, 'a', 'b'] },
    });
    expect(() => assertDocumentBudget(registry, DEFAULT_BUDGET)).not.toThrow();
    expect(committedBytes(registry, 'results')).toBe(966_666);
  });

  it('constructs Morph’s §14.2 registry — ONE BIG BLOB AND TWO SMALL ONES, previously impossible', () => {
    // Under a per-collection declaration this shape had three settings and none of them said
    // it: declare nothing and all three take 333 333; declare 700 000 and the entry commits
    // 2 100 000 and is refused; there was no third option. This is that third option.
    expect(() => assertDocumentBudget(morphRegistry, DEFAULT_BUDGET)).not.toThrow();
    expect(morphRegistry.pathsFor('results').map((p) => p.declaredMaxSealedBytes))
      .toEqual([700_000, 100_000, 100_000]);
    expect(committedBytes(morphRegistry, 'results')).toBe(900_000);
    expect(committedBytes(morphRegistry, 'results'))
      .toBeLessThanOrEqual(DEFAULT_BUDGET.maxDocumentSealedBytes);
  });

  it('still refuses the same three blobs at 700 000 EACH, which is a real over-commitment', () => {
    const registry = defineRegistry({
      results: {
        blobs: [
          { path: 'structuredOutput', maxSealedBytes: 700_000 },
          { path: 'citations', maxSealedBytes: 700_000 },
          { path: 'viewerPayload', maxSealedBytes: 700_000 },
        ],
      },
    });
    const message = refusalFrom(() => assertDocumentBudget(registry, DEFAULT_BUDGET));
    expect(message).toContain('2100000');
    expect(message).toContain('by 1100000');
  });

  it.each(WORKED_REGISTRIES)('keeps every worked registry within the budget: %s', (_name, registry) => {
    expect(() => assertDocumentBudget(registry, DEFAULT_BUDGET)).not.toThrow();
    for (const collection of registry.collections) {
      // Summed over PATHS, each with its own effective ceiling — the property the static check
      // asserts, and the one a collection-wide multiplication got wrong for Morph.
      expect(committedBytes(registry, collection))
        .toBeLessThanOrEqual(DEFAULT_BUDGET.maxDocumentSealedBytes);
    }
  });

  it('an undeclared collection can NEVER fail the sum — the property, not the instances', () => {
    for (let n = 1; n <= 244; n++) {
      const registry = defineRegistry({
        c: { blobs: Array.from({ length: n }, (_v, i) => `p${i}`) },
      });
      expect(() => assertDocumentBudget(registry, DEFAULT_BUDGET)).not.toThrow();
      expect(committedBytes(registry, 'c')).toBeLessThanOrEqual(DEFAULT_BUDGET.maxDocumentSealedBytes);
    }
  });

  it('refuses at the point a derived share stops being a budget and becomes a bug report', () => {
    const at = (n: number) => defineRegistry({ c: { blobs: Array.from({ length: n }, (_v, i) => `p${i}`) } });
    expect(() => assertDocumentBudget(at(244), DEFAULT_BUDGET)).not.toThrow();
    const message = refusalFrom(() => assertDocumentBudget(at(245), DEFAULT_BUDGET));
    expect(message).toContain('"c"');
    expect(message).toContain('245 paths');
    expect(message).toContain(String(MIN_DERIVED_SEALED_BYTES));
  });

  it('applies the floor whenever ANY path still takes the derived share, declarations beside it', () => {
    // Before R8 a declaration on the collection skipped this check entirely. Now the floor is
    // about the paths that take the share, so one path declaring its own number cannot hide
    // 244 others being handed 4 081 bytes each.
    const paths: Array<string | { path: string; maxSealedBytes: number }> =
      Array.from({ length: 244 }, (_v, i) => `p${i}`);
    paths.push({ path: 'declared', maxSealedBytes: 10_000 });
    const message = refusalFrom(() => assertDocumentBudget(defineRegistry({ c: { blobs: paths } }), DEFAULT_BUDGET));
    expect(message).toContain('245 paths');
    expect(message).toContain(String(MIN_DERIVED_SEALED_BYTES));
  });

  it('holds MIN_DERIVED_SEALED_BYTES at 4 096, which is what puts that boundary at 244', () => {
    expect(MIN_DERIVED_SEALED_BYTES).toBe(4_096);
    expect(Math.floor(DEFAULT_BUDGET.maxDocumentSealedBytes / 244)).toBeGreaterThanOrEqual(4_096);
    expect(Math.floor(DEFAULT_BUDGET.maxDocumentSealedBytes / 245)).toBeLessThan(4_096);
  });

  it('refuses a per-value ceiling larger than the document that would hold it', () => {
    const message = refusalFrom(
      () => assertDocumentBudget(EMPTY_REGISTRY, { maxSealedBytes: 2_000_000, maxDocumentSealedBytes: 1_000_000 }),
    );
    expect(message).toContain('maxSealedBytes');
    expect(message).toContain('maxDocumentSealedBytes');
  });

  it('passes a registry that declares a ceiling it can afford', () => {
    const registry = defineRegistry({ results: { blobs: ['a', 'b', 'c'], maxSealedBytes: 333_333 } });
    expect(() => assertDocumentBudget(registry, DEFAULT_BUDGET)).not.toThrow();
  });

  it('ignores a collection with no registered paths, which commits no bytes', () => {
    const registry = defineRegistry({ scans: { maxSealedBytes: 900_000 } });
    expect(() => assertDocumentBudget(registry, DEFAULT_BUDGET)).not.toThrow();
  });
});

// ─────────────────────────────── the spec object itself ───────────────────────────────

describe('the spec object', () => {
  it.each([
    ['null', null],
    ['an array', []],
    ['a string', 'topics'],
    ['a number', 7],
  ])('refuses a spec that is %s', (_why, value) => {
    refusalFrom(() => defineRegistry(value as unknown as Record<string, RegistrySpec>));
  });

  it('refuses a collection that does not map to an object', () => {
    const message = refusalFrom(
      () => defineRegistry({ a: ['title'] as unknown as RegistrySpec }),
    );
    expect(message).toContain('"a"');
    expect(message).toContain('an array');
  });

  it('ACCEPTS an empty spec, which is exactly EMPTY_REGISTRY', () => {
    expect(defineRegistry({}).collections).toEqual([]);
  });

  it("registers `strings:`, not collab's deployed `fields:` — the rename is deliberate (R24)", () => {
    // `fields` is not a declared key of RegistrySpec, so a table copied across unchanged is a
    // compile error at the product; at runtime it registers nothing, which this pins so the
    // rename can never be mistaken for a silent no-op that half-works.
    const wrong = defineRegistry({ a: { fields: ['title'] } as unknown as RegistrySpec });
    expect(wrong.pathsFor('a')).toEqual([]);
    expect(defineRegistry({ a: { strings: ['title'] } }).pathsFor('a')).toHaveLength(1);
  });
});
