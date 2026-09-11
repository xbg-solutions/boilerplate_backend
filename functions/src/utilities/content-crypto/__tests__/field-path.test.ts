/**
 * `field-path.ts` — collab's walker, verbatim, plus `mapPathNode`, `nodeAt`,
 * `blobKeyRelation` and the blob subPath grammar (§16.8).
 *
 * The first four `describe` blocks are collab's deployed
 * `functions/src/__tests__/content-fields.test.ts` assertions carried across unchanged
 * except for the module's new `UpdateKeyMatch.segments` field: those tests guard behaviour
 * that live data already depends on, so they are the floor rather than the ceiling. The
 * blocks after them are the additions, each of which exists because something in §8 or §13
 * needs it.
 *
 * ONE DIVERGENCE, STATED HERE BECAUSE IT IS A TYPE CHANGE. §5.5 declares
 * `UpdateKeyMatch` as `{ segments, rest }`; collab's is `{ rest, elements }`. This module
 * carries all three, and the test named "`elements` is not derivable …" is the reason:
 * `attachments` and `attachments.0` both match `attachments[].filename` with the same
 * `segments` and the same `rest`, and only the first hands `mapUpdateValue` an array. A
 * consumer written against `{ segments, rest }` compiles against the wider type unchanged.
 *
 * Mirrorability (§16.3): relative imports only, no manifest read, no `../../`, no wall
 * clock, no `process.env`, and the one generative test is seeded from a literal list.
 */

import {
  blobKeyRelation,
  formatFieldPath,
  formatSubPath,
  isPlainObject,
  mapPath,
  mapPathNode,
  mapUpdateValue,
  matchUpdateKey,
  nodeAt,
  parseFieldPath,
  parseSubPath,
  type SubPathSegment,
  type UpdateKeyMatch,
} from '../field-path';

const up = (s: string) => s.toUpperCase();
const same = (s: string) => s;

/** `matchUpdateKey` returns `null` for "not on this path"; these call sites expect a match. */
function must(match: UpdateKeyMatch | null): UpdateKeyMatch {
  if (!match) throw new Error('expected the key to match the registered path');
  return match;
}

/** Assert that `fn` throws the grammar's one error. Written out rather than passed to
 *  `toThrow`, which compares an Error's message and not its code. */
function expectSubPathInvalid(fn: () => unknown): { code: unknown; status: unknown; details: unknown } {
  let thrown: { code?: unknown; status?: unknown; details?: unknown } | undefined;
  try {
    fn();
  } catch (e) {
    thrown = e as { code?: unknown; status?: unknown; details?: unknown };
  }
  expect(thrown).toBeInstanceOf(Error);
  expect(thrown?.code).toBe('BLOB_SUBPATH_INVALID');
  return { code: thrown?.code, status: thrown?.status, details: thrown?.details };
}

// ───────────────────────────── the registered path grammar ─────────────────────────────

describe('parseFieldPath / formatFieldPath', () => {
  it('parses and formats paths', () => {
    expect(parseFieldPath('attachments[].filename')).toEqual([
      { key: 'attachments', array: true },
      { key: 'filename', array: false },
    ]);
    expect(formatFieldPath(parseFieldPath('attachments[].filename'))).toBe('attachments[].filename');
    expect(formatFieldPath(parseFieldPath('a.b[].c'), 1)).toBe('b[].c');
  });

  it('round-trips every shape the registry can hold, `[]` retained', () => {
    for (const path of [
      'body',
      'anchor.quote',
      'declinedProposals[]',
      'attachments[].filename',
      'a.b.c.d',
      'rows[].cells[].text',
      'structuredContent',
    ]) {
      expect(formatFieldPath(parseFieldPath(path))).toBe(path);
    }
  });

  it('treats "/" as an ordinary character in a key, because a path is not a document path', () => {
    // collab's version rows have an AAD id containing slashes (`t1/versions/v3`), but that
    // is the docId, which this module never sees. A slash in a *field* segment is just a
    // character, and nothing here splits on it.
    expect(parseFieldPath('a/b.c')).toEqual([
      { key: 'a/b', array: false },
      { key: 'c', array: false },
    ]);
    expect(formatFieldPath(parseFieldPath('a/b.c'))).toBe('a/b.c');
  });

  it('marks only a trailing "[]" as an array segment', () => {
    expect(parseFieldPath('a[]b')).toEqual([{ key: 'a[]b', array: false }]);
    expect(parseFieldPath('[]')).toEqual([{ key: '', array: true }]);
  });
});

describe('isPlainObject', () => {
  it('is strict on purpose: only a `constructor === Object` object is plain', () => {
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject({ a: 1 })).toBe(true);
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject(null)).toBe(false);
    expect(isPlainObject(undefined)).toBe(false);
    expect(isPlainObject('s')).toBe(false);
    expect(isPlainObject(5)).toBe(false);
    expect(isPlainObject(new Date())).toBe(false);
    expect(isPlainObject(Object.create(null))).toBe(false);
    class Sentinel {
      readonly op = 'delete';
    }
    expect(isPlainObject(new Sentinel())).toBe(false);
  });
});

// ───────────────────────────── mapPath, collab's walker ─────────────────────────────

describe('mapPath', () => {
  it('leaves nulls, wrong types and missing keys alone and copies only along the path', () => {
    const untouched = { keep: { me: 1 } };
    const doc = { a: { b: 'x' }, n: null, num: 5, arr: ['p', 7, null], untouched };
    const out = mapPath(doc, parseFieldPath('a.b'), up) as typeof doc;
    expect(out.a.b).toBe('X');
    expect(out).not.toBe(doc);
    expect(out.untouched).toBe(untouched);
    expect(mapPath(doc, parseFieldPath('n.x'), up)).toBe(doc);
    expect(mapPath(doc, parseFieldPath('num'), up)).toBe(doc);
    expect(mapPath(doc, parseFieldPath('missing'), up)).toBe(doc);
    expect((mapPath(doc, parseFieldPath('arr[]'), up) as typeof doc).arr).toEqual(['P', 7, null]);
    expect(mapPath(doc, parseFieldPath('num[]'), up)).toBe(doc);
    expect(mapPath(null, parseFieldPath('a'), up)).toBeNull();
    expect(mapPath('s', [], up)).toBe('S');
  });

  it('returns the input BY REFERENCE when the transform changes nothing — through an array segment too', () => {
    // The array clause is the one place this module departs from collab's deployed walker.
    // `inner.map(...)` always allocates, so collab rebuilt the array and its parent even
    // when nothing changed. §13.1 says "returns the input identity when nothing under it
    // changed" and §8.8 says the document "comes back by reference"; neither holds through
    // a `[]` segment unless the untouched array is kept. Structurally the output is the
    // same either way, which is why collab's suite never caught it.
    const doc = { a: { b: 'x' }, arr: ['p', 'q'], objs: [{ f: 'x' }, { f: 'y' }] };
    expect(mapPath(doc, parseFieldPath('a.b'), same)).toBe(doc);
    expect(mapPath(doc, parseFieldPath('arr[]'), same)).toBe(doc);
    expect(mapPath(doc, parseFieldPath('objs[].f'), same)).toBe(doc);
    const mapped = mapPath(doc, parseFieldPath('arr[]'), same) as typeof doc;
    expect(mapped.arr).toBe(doc.arr);
  });

  it('still rebuilds the array — and only the array — when one element changes', () => {
    const doc = { objs: [{ f: 'x', keep: {} }, { f: 'y' }] };
    const out = mapPath(doc, parseFieldPath('objs[].f'), (s) => (s === 'x' ? 'X' : s)) as typeof doc;
    expect(out).not.toBe(doc);
    expect(out.objs).not.toBe(doc.objs);
    expect(out.objs[0]).not.toBe(doc.objs[0]);
    expect(out.objs[0].keep).toBe(doc.objs[0].keep);
    expect(out.objs[1]).toBe(doc.objs[1]); // untouched element: same reference
    expect(out.objs).toEqual([{ f: 'X', keep: {} }, { f: 'y' }]);
  });

  it('steps over a Firestore-shaped sentinel instead of reaching inside it', () => {
    // This is what `isPlainObject`'s strict `constructor === Object` check buys, and it is
    // the reason it must never be widened: a sentinel rebuilt as bare data is a delete
    // turning into `{}` on its way to a write.
    class FieldValueSentinel {
      readonly quote = 'not really a quote';
    }
    const sentinel = new FieldValueSentinel();
    const doc = { anchor: sentinel };
    expect(mapPath(doc, parseFieldPath('anchor.quote'), up)).toBe(doc);
    expect((doc.anchor as FieldValueSentinel).quote).toBe('not really a quote');
  });

  it('maps every element of an array-of-objects path and keeps the siblings', () => {
    const doc = { attachments: [{ filename: 'a.txt', size: 1 }, { filename: 'b.txt', size: 2 }, { size: 3 }] };
    const out = mapPath(doc, parseFieldPath('attachments[].filename'), up) as typeof doc;
    expect(out.attachments[0]).toEqual({ filename: 'A.TXT', size: 1 });
    expect(out.attachments[1]).toEqual({ filename: 'B.TXT', size: 2 });
    expect(out.attachments[2]).toBe(doc.attachments[2]); // no registered key: by reference
  });

  it('does not descend into a null-prototype object', () => {
    const inner = Object.create(null) as Record<string, unknown>;
    inner.b = 'x';
    const doc = { a: inner };
    expect(mapPath(doc, parseFieldPath('a.b'), up)).toBe(doc);
  });
});

// ───────────────────────────── matchUpdateKey / mapUpdateValue ─────────────────────────────

describe('matchUpdateKey', () => {
  it('places a Firestore update key on a registered path', () => {
    const anchorQuote = parseFieldPath('anchor.quote');
    expect(matchUpdateKey('anchor.quote', anchorQuote)).toEqual({ segments: anchorQuote, rest: [], elements: false });
    expect(matchUpdateKey('anchor', anchorQuote)).toEqual({
      segments: anchorQuote,
      rest: [{ key: 'quote', array: false }],
      elements: false,
    });
    expect(matchUpdateKey('anchor.prefix', anchorQuote)).toBeNull();
    expect(matchUpdateKey('anchor.quote.deeper', anchorQuote)).toBeNull();
    expect(matchUpdateKey('body', anchorQuote)).toBeNull();

    const attachments = parseFieldPath('attachments[].filename');
    expect(matchUpdateKey('attachments', attachments)).toEqual({
      segments: attachments,
      rest: [{ key: 'filename', array: false }],
      elements: true,
    });
    expect(matchUpdateKey('attachments.0', attachments)).toEqual({
      segments: attachments,
      rest: [{ key: 'filename', array: false }],
      elements: false,
    });
    expect(matchUpdateKey('attachments.0.filename', attachments)).toEqual({
      segments: attachments,
      rest: [],
      elements: false,
    });
    expect(matchUpdateKey('attachments.filename', attachments)).toBeNull();

    const declined = parseFieldPath('declinedProposals[]');
    expect(matchUpdateKey('declinedProposals', declined)).toEqual({ segments: declined, rest: [], elements: true });
    expect(matchUpdateKey('declinedProposals.2', declined)).toEqual({ segments: declined, rest: [], elements: false });
  });

  it('carries the whole registered path as `segments`, so a caller can label the AAD', () => {
    const path = parseFieldPath('attachments[].filename');
    const match = must(matchUpdateKey('attachments.3', path));
    expect(match.segments).toBe(path);
    expect(formatFieldPath(match.segments)).toBe('attachments[].filename');
  });

  it('`elements` is not derivable from { segments, rest }, which is why the field is kept', () => {
    const path = parseFieldPath('attachments[].filename');
    const whole = must(matchUpdateKey('attachments', path));
    const byIndex = must(matchUpdateKey('attachments.0', path));
    expect(whole.segments).toEqual(byIndex.segments);
    expect(whole.rest).toEqual(byIndex.rest);
    expect(whole.elements).toBe(true);
    expect(byIndex.elements).toBe(false);
  });

  it('accepts a many-digit index and rejects a non-numeric part under an array segment', () => {
    const path = parseFieldPath('attachments[].filename');
    expect(matchUpdateKey('attachments.417.filename', path)).toEqual({ segments: path, rest: [], elements: false });
    expect(matchUpdateKey('attachments.x.filename', path)).toBeNull();
    expect(matchUpdateKey('attachments.0.filename.deeper', path)).toBeNull();
  });

  it('matches nothing against an empty key', () => {
    expect(matchUpdateKey('', parseFieldPath('body'))).toBeNull();
  });
});

describe('mapUpdateValue', () => {
  it('walks the update value as the match says, array or element', () => {
    const path = parseFieldPath('attachments[].filename');
    const whole = must(matchUpdateKey('attachments', path));
    const byIndex = must(matchUpdateKey('attachments.0', path));
    const array = [{ filename: 'a.txt', size: 1 }, { filename: 'b.txt' }];

    expect(mapUpdateValue(array, whole, up)).toEqual([{ filename: 'A.TXT', size: 1 }, { filename: 'B.TXT' }]);
    expect(mapUpdateValue({ filename: 'a.txt' }, byIndex, up)).toEqual({ filename: 'A.TXT' });

    // The array arm returns a non-array untouched rather than guessing.
    const sentinel = { arrayUnion: true };
    expect(mapUpdateValue(sentinel, whole, up)).toBe(sentinel);
  });

  it('maps a bare string when the key reached the leaf', () => {
    const match = must(matchUpdateKey('anchor.quote', parseFieldPath('anchor.quote')));
    expect(mapUpdateValue('hello', match, up)).toBe('HELLO');
    expect(mapUpdateValue(42, match, up)).toBe(42);
  });
});

// ───────────────────────────── mapPathNode ─────────────────────────────

describe('mapPathNode', () => {
  it('hands the NODE to the callback, not a string', () => {
    const doc = { payload: { checkins: [1, 2], note: 'x' }, status: 'open' };
    const seen: unknown[] = [];
    const out = mapPathNode(doc, parseFieldPath('payload'), (node) => {
      seen.push(node);
      return 'enc:v3:sealed';
    }) as Record<string, unknown>;
    expect(seen).toEqual([{ checkins: [1, 2], note: 'x' }]);
    expect(out.payload).toBe('enc:v3:sealed');
    expect(out.status).toBe('open');
  });

  it('never visits an absent key, so nothing is invented at a blob path', () => {
    const calls: unknown[] = [];
    const doc = { other: 1 };
    const out = mapPathNode(doc, parseFieldPath('payload'), (node) => {
      calls.push(node);
      return 'sealed';
    });
    expect(out).toBe(doc);
    expect(calls).toEqual([]);
  });

  it('DOES visit a key present with null or undefined — placement is §8.8’s decision, not the walker’s', () => {
    const seen: unknown[] = [];
    const doc: Record<string, unknown> = { a: null, b: undefined };
    mapPathNode(doc, parseFieldPath('a'), (n) => {
      seen.push(n);
      return n;
    });
    mapPathNode(doc, parseFieldPath('b'), (n) => {
      seen.push(n);
      return n;
    });
    expect(seen).toEqual([null, undefined]);
  });

  it('returns the input BY REFERENCE when the callback returns what it was given', () => {
    const doc = { payload: { a: 1 }, rows: [{ p: { x: 1 } }, { p: { y: 2 } }] };
    expect(mapPathNode(doc, parseFieldPath('payload'), (n) => n)).toBe(doc);
    expect(mapPathNode(doc, parseFieldPath('rows[].p'), (n) => n)).toBe(doc);
  });

  it('copies only along the touched path', () => {
    const untouched = { keep: 1 };
    const doc = { a: { b: { deep: true }, sib: 's' }, untouched };
    const out = mapPathNode(doc, parseFieldPath('a.b'), () => 'sealed') as {
      a: { b: unknown; sib: string };
      untouched: unknown;
    };
    expect(out).not.toBe(doc);
    expect(out.untouched).toBe(untouched);
    expect(out.a.sib).toBe('s');
    expect(out.a.b).toBe('sealed');
    expect(doc.a.b).toEqual({ deep: true });
  });

  it('steps over the same non-plain values `mapPath` does', () => {
    class Sentinel {}
    const sentinel = new Sentinel();
    const doc = { a: sentinel, n: null, s: 'str' };
    expect(mapPathNode(doc, parseFieldPath('a.b'), () => 'sealed')).toBe(doc);
    expect(mapPathNode(doc, parseFieldPath('n.b'), () => 'sealed')).toBe(doc);
    expect(mapPathNode(doc, parseFieldPath('s.b'), () => 'sealed')).toBe(doc);
    expect(mapPathNode(null, parseFieldPath('a'), () => 'sealed')).toBeNull();
  });

  it('maps every element of an array segment, if a caller manufactures one', () => {
    // Registered blob paths may never carry `[]` (§8.8), but the walk is the same walk and
    // must not quietly do something different from `mapPath` at the same segment.
    const doc = { rows: [{ p: 1 }, { p: 2 }] };
    const out = mapPathNode(doc, parseFieldPath('rows[].p'), (n) => (n as number) * 10) as typeof doc;
    expect(out.rows).toEqual([{ p: 10 }, { p: 20 }]);
  });

  it('applies the callback to the whole value at an empty path', () => {
    expect(mapPathNode({ a: 1 }, [], () => 'sealed')).toBe('sealed');
  });
});

// ───────────────────────────── nodeAt ─────────────────────────────

describe('nodeAt', () => {
  const doc = {
    anchor: { quote: 'q', sectionId: 's1' },
    attachments: [{ filename: 'a.txt' }, { filename: 'b.txt' }],
    payload: { checkins: [{ status: 'done' }] },
    n: null,
    num: 5,
  };

  it('reads the node at a parsed path', () => {
    expect(nodeAt(doc, parseFieldPath('anchor.quote'))).toBe('q');
    expect(nodeAt(doc, parseFieldPath('payload'))).toBe(doc.payload);
    expect(nodeAt(doc, [])).toBe(doc);
  });

  it('returns the ARRAY for a trailing array segment — planDoc’s read-back, not a wildcard read', () => {
    expect(nodeAt(doc, parseFieldPath('attachments[]'))).toBe(doc.attachments);
    // Truncation at the first array segment is what `planDoc` does before reading back.
    const segments = parseFieldPath('attachments[].filename');
    const arrayAt = segments.findIndex((s) => s.array);
    expect(nodeAt(doc, segments.slice(0, arrayAt + 1))).toBe(doc.attachments);
  });

  it('is total: anything absent, or reached through a non-object, is undefined', () => {
    expect(nodeAt(doc, parseFieldPath('missing'))).toBeUndefined();
    expect(nodeAt(doc, parseFieldPath('anchor.missing.deeper'))).toBeUndefined();
    expect(nodeAt(doc, parseFieldPath('n.x'))).toBeUndefined();
    expect(nodeAt(doc, parseFieldPath('num.x'))).toBeUndefined();
    expect(nodeAt(undefined, parseFieldPath('a'))).toBeUndefined();
    expect(nodeAt(null, [])).toBeNull();
  });

  it('does not map: it never returns a list of leaves', () => {
    expect(nodeAt(doc, parseFieldPath('attachments[].filename'))).toBeUndefined();
  });
});

// ───────────────────────────── blobKeyRelation ─────────────────────────────

describe('blobKeyRelation', () => {
  const payload = parseFieldPath('payload');
  const nested = parseFieldPath('a.b');

  it.each([
    { key: 'status', blob: 'payload', segments: payload, expected: 'unrelated' },
    { key: 'pay', blob: 'payload', segments: payload, expected: 'unrelated' },
    { key: 'payloadx', blob: 'payload', segments: payload, expected: 'unrelated' },
    { key: 'payload', blob: 'payload', segments: payload, expected: 'exact' },
    { key: 'payload.checkins', blob: 'payload', segments: payload, expected: 'inside' },
    { key: 'payload.checkins.2.status', blob: 'payload', segments: payload, expected: 'inside' },
    { key: 'a.b', blob: 'a.b', segments: nested, expected: 'exact' },
    { key: 'a', blob: 'a.b', segments: nested, expected: 'contains' },
    { key: 'a.b.c', blob: 'a.b', segments: nested, expected: 'inside' },
    { key: 'a.c', blob: 'a.b', segments: nested, expected: 'unrelated' },
    { key: 'b', blob: 'a.b', segments: nested, expected: 'unrelated' },
    { key: '', blob: 'payload', segments: payload, expected: 'unrelated' },
  ])('update key "$key" against blob path "$blob" is $expected', ({ key, segments, expected }) => {
    expect(blobKeyRelation(key, segments)).toBe(expected);
  });

  it('compares segment by segment, never as a string prefix', () => {
    // The failure this rules out: `payload2` sharing a prefix with `payload` and being
    // treated as a write inside the blob.
    expect(blobKeyRelation('payload2', payload)).toBe('unrelated');
    expect(blobKeyRelation('payloa', payload)).toBe('unrelated');
  });

  it('classifies each of the eight live build call sites as `inside`', () => {
    // §8.9's acceptance table. These are the keys that make `applyBlobPatch` necessary.
    const structuredContent = parseFieldPath('structuredContent');
    const fields = parseFieldPath('fields');
    expect(blobKeyRelation('structuredContent.loopbackItems', structuredContent)).toBe('inside');
    expect(blobKeyRelation('payload.checkins', payload)).toBe('inside');
    expect(blobKeyRelation('payload.gitContext', payload)).toBe('inside');
    expect(blobKeyRelation('fields.contentSlots', fields)).toBe('inside');
    expect(blobKeyRelation('fields.composition', fields)).toBe('inside');
  });
});

// ───────────────────────────── the subPath grammar ─────────────────────────────

describe('parseSubPath', () => {
  it.each([
    ['loopbackItems', [{ key: 'loopbackItems' }]],
    ['checkins[3].status', [{ key: 'checkins' }, { index: 3 }, { key: 'status' }]],
    ['`a.b`.c', [{ key: 'a.b' }, { key: 'c' }]],
    ['[0].name', [{ index: 0 }, { key: 'name' }]],
    ['[0][1]', [{ index: 0 }, { index: 1 }]],
    ['a[0][1].b', [{ key: 'a' }, { index: 0 }, { index: 1 }, { key: 'b' }]],
    ['a[9999999]', [{ key: 'a' }, { index: 9_999_999 }]],
    ['`0`.name', [{ key: '0' }, { key: 'name' }]],
    ['`a``b`', [{ key: 'a`b' }]],
    ['``', [{ key: '' }]],
    ['a b', [{ key: 'a b' }]],
    ['a/b', [{ key: 'a/b' }]],
    ['0', [{ key: '0' }]],
  ] as const)('parses %s', (subPath, expected) => {
    expect(parseSubPath(subPath)).toEqual(expected);
  });

  it.each([
    '',
    'a..b',
    'a.',
    '.a',
    'a[]',
    'a[01]',
    'a[-1]',
    'a[1e3]',
    'a[10000000]',
    'a[',
    'a[0',
    'a]b',
    'a.[0]',
    '.',
    '`unterminated',
    '`a``',
    '[]',
  ])('refuses %p with BLOB_SUBPATH_INVALID', (subPath) => {
    expectSubPathInvalid(() => parseSubPath(subPath));
  });

  it('names the offending subPath in the details and nothing else, and is a 400', () => {
    const thrown = expectSubPathInvalid(() => parseSubPath('a..b'));
    expect(thrown.status).toBe(400);
    expect(thrown.details).toEqual({ subPath: 'a..b' });
  });

  it('parses the two §8.10 conversions of a Firestore update key', () => {
    expect(parseSubPath('loopbackItems[0].acknowledgedAt')).toEqual([
      { key: 'loopbackItems' },
      { index: 0 },
      { key: 'acknowledgedAt' },
    ]);
    expect(parseSubPath('checkins[2].status')).toEqual([{ key: 'checkins' }, { index: 2 }, { key: 'status' }]);
  });

  it('does not cap depth — `maxDepth` belongs to the scope, which this leaf cannot see', () => {
    const deep = Array.from({ length: 64 }, (_, i) => `k${i}`).join('.');
    expect(parseSubPath(deep)).toHaveLength(64);
  });
});

describe('formatSubPath', () => {
  it('emits bare segments where it can and quotes where it must', () => {
    expect(formatSubPath([{ key: 'loopbackItems' }])).toBe('loopbackItems');
    expect(formatSubPath([{ key: 'checkins' }, { index: 3 }, { key: 'status' }])).toBe('checkins[3].status');
    expect(formatSubPath([{ index: 0 }, { key: 'name' }])).toBe('[0].name');
    expect(formatSubPath([{ key: 'a.b' }, { key: 'c' }])).toBe('`a.b`.c');
    expect(formatSubPath([{ key: 'a`b' }])).toBe('`a``b`');
    expect(formatSubPath([{ key: '' }])).toBe('``');
    expect(formatSubPath([{ key: 'a[0]' }])).toBe('`a[0]`');
  });

  it('refuses to emit something that will not parse', () => {
    expectSubPathInvalid(() => formatSubPath([]));
    expectSubPathInvalid(() => formatSubPath([{ index: -1 }]));
    expectSubPathInvalid(() => formatSubPath([{ index: 1.5 }]));
    expectSubPathInvalid(() => formatSubPath([{ index: 10_000_000 }]));
    expectSubPathInvalid(() => formatSubPath([{ key: 7 } as unknown as SubPathSegment]));
  });

  it('is not the identity in the other direction, and is not meant to be', () => {
    // `a` and ``a`` are the same address; the parser is what decides equality, not the text.
    expect(formatSubPath(parseSubPath('`a`.b'))).toBe('a.b');
  });
});

describe('parseSubPath ∘ formatSubPath is the identity on segments', () => {
  /** Four lines of seeded PRNG rather than a dependency (§16.3 rule 4). */
  function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Every character the grammar has an opinion about, plus ordinary ones.
  const ALPHABET = ['a', 'Z', '0', '9', '.', '[', ']', '`', '-', '_', ' ', '/', 'é', '👍'];

  function randomSegments(rnd: () => number): SubPathSegment[] {
    const n = 1 + Math.floor(rnd() * 6);
    const out: SubPathSegment[] = [];
    for (let i = 0; i < n; i += 1) {
      if (rnd() < 0.3) {
        out.push({ index: Math.floor(rnd() * 9_999_999) });
        continue;
      }
      const len = Math.floor(rnd() * 7); // 0 is legal: `` is the empty key
      let key = '';
      for (let c = 0; c < len; c += 1) key += ALPHABET[Math.floor(rnd() * ALPHABET.length)];
      out.push({ key });
    }
    return out;
  }

  it.each([1, 2, 3, 7, 11, 13, 42, 1337, 99991, 2_147_483_647])('holds for seed %i', (seed) => {
    const rnd = mulberry32(seed);
    for (let i = 0; i < 200; i += 1) {
      const segments = randomSegments(rnd);
      const text = formatSubPath(segments);
      expect(parseSubPath(text)).toEqual(segments);
    }
  });

  it('holds for the hand-picked awkward cases', () => {
    const cases: SubPathSegment[][] = [
      [{ key: '' }],
      [{ key: '`' }],
      [{ key: '``' }],
      [{ key: '.' }],
      [{ key: '[]' }],
      [{ key: '[0]' }, { index: 0 }],
      [{ key: '0' }],
      [{ index: 0 }],
      [{ index: 9_999_999 }],
      [{ key: 'a' }, { index: 0 }, { key: '' }, { index: 1 }, { key: 'b.c' }],
    ];
    for (const segments of cases) {
      expect(parseSubPath(formatSubPath(segments))).toEqual(segments);
    }
  });
});
