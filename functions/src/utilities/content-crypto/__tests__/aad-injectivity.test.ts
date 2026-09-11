/**
 * **AAD injectivity, across every layer that builds one.** Cross-cutting, because the property is
 * nobody's module: `aad.ts` builds the strings, `registry.ts` decides what a product may call a
 * root, `key-scope.ts` decides what a `scopePath` may look like, and the property only exists when
 * all three agree.
 *
 * ── TWO CLAIMS, AND THEY ARE NOT EQUALLY LOAD-BEARING ─────────────────────────────────────────
 *
 * **(a) Within a form, distinct tuples produce distinct strings.** This is the one that matters,
 * and §6.2's validation list exists to guarantee it. If it fails, one ciphertext can be moved
 * between two positions that authenticate identically, and the AAD has stopped doing its job.
 *
 * **(b) Across forms, no two builders collide.** Defence in depth over a hazard already closed
 * twice — the four forms sit at three different KEY LAYERS, and a ciphertext from one layer cannot
 * be presented to another whatever its AAD; within the one layer where several ciphertext kinds
 * share a key, the authenticated payload-kind byte is the unforgeable discriminator. It is
 * asserted anyway, and this file says plainly that it is the THIRD defence, because a reader who
 * believes it is the first will resist the day somebody proposes removing a prefix.
 *
 * ── WHAT THIS FILE ADDS THAT `aad.test.ts` CANNOT ─────────────────────────────────────────────
 *
 * `aad.test.ts` already runs the cross-product over the four builders and already refuses every
 * illegal component. Repeating that here would be volume, not evidence. What is here instead:
 *
 *  1. The **cross-layer** consequence `aad.test.ts` explicitly defers — `RESERVED_ROOTS` — with
 *     the two colliding strings CONSTRUCTED and shown to be byte-identical, so the rule is proved
 *     load-bearing rather than asserted to be.
 *  2. Injectivity **through the real call site**, `FieldRegistry.aadFor`, where a `root` override
 *     means the collection key is not the AAD root — which is a deliberate aliasing the builder
 *     alone cannot see.
 *  3. Every validation with a test that **shows the collision it prevents**: the two distinct
 *     tuples, the one string they would both produce, and the refusal that stops it.
 *  4. A **planted collision** against the same harness, so a passing sweep is evidence rather
 *     than a claim about an empty loop.
 */

import { aadForContent, aadForDek, aadForObject, aadForRecordKeyWrap } from '../aad';
import { isContentCryptoError } from '../errors';
import { RESERVED_ROOTS, defineRegistry } from '../registry';
import { assertScopePath } from '../key-scope';

// ---------------------------------------------------------------------------
// The harness
// ---------------------------------------------------------------------------

/** A (layer, inputs) tuple and the string it must be alone in producing. */
interface Claim {
  readonly aad: string;
  readonly description: string;
}

/**
 * Claim every AAD into one map, failing on any collision between DIFFERENT tuples. Claiming the
 * same tuple twice is not a collision: the builders are pure and repeat freely, and a harness that
 * called that a failure would be testing the loop rather than the property.
 */
function claimAll(claims: readonly Claim[]): Map<string, string> {
  const seen = new Map<string, string>();
  for (const { aad, description } of claims) {
    const existing = seen.get(aad);
    if (existing !== undefined && existing !== description) {
      throw new Error(`AAD collision: ${JSON.stringify(aad)} is both ${existing} and ${description}`);
    }
    seen.set(aad, description);
  }
  return seen;
}

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    return isContentCryptoError(err) ? err.code : `not a ContentCryptoError: ${String(err)}`;
  }
  return 'did not throw';
}

/**
 * Deliberately adversarial: neighbouring values that differ only in a separator, a prefix or a
 * length, because those are the pairs a concatenation gets wrong. `messages` beside `message` and
 * `messages2`; `p1` beside `p10`; `t1/versions/v3` beside `t1/versions/v30`.
 */
const ROOTS = ['a', 'ab', 'a-b', 'messages', 'message', 'messages2', 'artefacts'];
const DOC_IDS = ['b', 'bc', 'b/c', 'b/c/d', 't1', 't1/versions/v3', 't1/versions/v30'];
const FIELD_PATHS = ['c', 'cd', 'c.d', 'c[]', 'c[].d', 'content', 'theme.wordmark'];
const PRODUCT_IDS = ['collab', 'collab2', 'colla', 'morph'];
const ACCOUNT_IDS = ['a', 'ab', 'a-b', 'acc-1'];
const GENERATIONS = [1, 2, 12, 21];
const SCOPE_PATHS = [
  'projects/p1',
  'projects/p10',
  'projects/p1/topics/t1',
  'accounts/acc-1/sfmapper/org-9/scans/scan-3',
];
const BUCKETS = ['acme-morph', 'acme-morph2', 'acme-build', 'acme'];
const OBJECT_PATHS = ['objects/a', 'objects/ab', 'objects/a/b', 'uploads/r/1.bin'];

/** Every tuple this suite knows how to build, tagged by layer. Built once, used by both claims. */
function everyClaim(): readonly Claim[] {
  const out: Claim[] = [];
  for (const root of ROOTS) {
    for (const docId of DOC_IDS) {
      for (const fieldPath of FIELD_PATHS) {
        out.push({
          aad: aadForContent(root, docId, fieldPath),
          description: `content(${root}, ${docId}, ${fieldPath})`,
        });
      }
    }
  }
  for (const productId of PRODUCT_IDS) {
    for (const accountId of ACCOUNT_IDS) {
      for (const generation of GENERATIONS) {
        out.push({
          aad: aadForDek(productId, accountId, generation),
          description: `dek(${productId}, ${accountId}, ${generation})`,
        });
        for (const scopePath of SCOPE_PATHS) {
          out.push({
            aad: aadForRecordKeyWrap(productId, accountId, generation, scopePath),
            description: `wrap(${productId}, ${accountId}, ${generation}, ${scopePath})`,
          });
        }
      }
    }
  }
  for (const bucket of BUCKETS) {
    for (const path of OBJECT_PATHS) {
      out.push({ aad: aadForObject({ bucket, path }), description: `object(${bucket}, ${path})` });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// (a) and (b)
// ---------------------------------------------------------------------------

describe('injectivity over every layer that builds an AAD', () => {
  it('(a)+(b): no two distinct (layer, inputs) tuples produce one string', () => {
    const claims = everyClaim();
    const seen = claimAll(claims);
    expect(seen.size).toBe(claims.length);
    expect(claims.length).toBeGreaterThan(400);
  });

  it('THE NEGATIVE CONTROL: the same harness detects a planted collision', () => {
    // Two DIFFERENT tuples that produce one string. If the docId rule were dropped,
    // (root a, docId b, field c.d) and (root a, docId b.c, field d) would be exactly this.
    expect(() => claimAll([
      { aad: 'a/b.c.d', description: 'content(a, b, c.d)' },
      { aad: 'a/b.c.d', description: 'content(a, b.c, d)' },
    ])).toThrow(/AAD collision/);
    // And a repeat of the SAME tuple is not a collision, which is what stops the harness
    // reporting the property whenever anything is claimed twice.
    expect(() => claimAll([
      { aad: 'a/b.c', description: 'content(a, b, c)' },
      { aad: 'a/b.c', description: 'content(a, b, c)' },
    ])).not.toThrow();
  });

  it('each layer contributes, so a builder that silently stopped being exercised would show', () => {
    const claims = everyClaim();
    const byLayer = {
      content: claims.filter((c) => c.description.startsWith('content(')).length,
      dek: claims.filter((c) => c.description.startsWith('dek(')).length,
      wrap: claims.filter((c) => c.description.startsWith('wrap(')).length,
      object: claims.filter((c) => c.description.startsWith('object(')).length,
    };
    expect(byLayer).toEqual({
      content: ROOTS.length * DOC_IDS.length * FIELD_PATHS.length,
      dek: PRODUCT_IDS.length * ACCOUNT_IDS.length * GENERATIONS.length,
      wrap: PRODUCT_IDS.length * ACCOUNT_IDS.length * GENERATIONS.length * SCOPE_PATHS.length,
      object: BUCKETS.length * OBJECT_PATHS.length,
    });
  });
});

// ---------------------------------------------------------------------------
// The cross-layer case: RESERVED_ROOTS
// ---------------------------------------------------------------------------

/**
 * The one genuinely cross-layer collision, and the reason `RESERVED_ROOTS` is a rule rather than a
 * matter of taste.
 *
 * Both halves are needed and each is useless alone: the collision is CONSTRUCTED (so the rule is
 * shown to be load-bearing) and then `defineRegistry` is shown to refuse the root that makes it
 * reachable (so the rule is shown to be enforced). A test that only did the second would pass just
 * as happily if the list were protecting against nothing.
 */
describe('RESERVED_ROOTS — the cross-layer collision, constructed and then closed', () => {
  it('`record-key` as a root really does collide with a wrap AAD, byte for byte', () => {
    // The wrap: product `p`, account `A`, generation 1, on a record whose document id contains a
    // dot. A dot in a document id is legal — `assertScopePath` bans an empty segment and an odd
    // segment count, and nothing else.
    const scopePath = 'projects/p1.x';
    expect(() => assertScopePath(scopePath)).not.toThrow();
    const wrap = aadForRecordKeyWrap('p', 'A', 1, scopePath);

    // The content value: a collection whose AAD root is literally `record-key`, whose document id
    // happens to be the rest of the wrap's path, and whose field is the tail after the dot.
    const content = aadForContent('record-key', 'p/A/1/projects/p1', 'x');

    expect(content).toBe(wrap);
    expect(wrap).toBe('record-key/p/A/1/projects/p1.x');
  });

  it('`obj` as a root collides with an object AAD the same way', () => {
    const object = aadForObject({ bucket: 'b', path: 'c/d.e' });
    const content = aadForContent('obj', 'b/c/d', 'e');
    expect(content).toBe(object);
    expect(object).toBe('obj/b/c/d.e');
  });

  it('`content-key` cannot collide with a content AAD, and the reason is a DIFFERENT mechanism', () => {
    // A content AAD always contains a `.` — `fieldPath` may not be empty, which is why there is no
    // dotless whole-record content form. The DEK form has four components and no dot at all. So
    // this one is closed by the shape of the two forms and not by the reserved list, and it is
    // reserved anyway because relying on "no dot" would make a future dotless content form a
    // silent cross-layer break rather than a compile error.
    expect(aadForDek('p', 'A', 1)).toBe('content-key/p/A/1');
    expect(aadForDek('p', 'A', 1).includes('.')).toBe(false);
    expect(aadForContent('content-key', 'p/A', '1').includes('.')).toBe(true);
  });

  it('so `defineRegistry` refuses all three, as a collection key AND as a root override', () => {
    expect([...RESERVED_ROOTS].sort()).toEqual(['content-key', 'obj', 'record-key']);
    for (const reserved of RESERVED_ROOTS) {
      expect(codeOf(() => defineRegistry({ [reserved]: { strings: ['x'] } }))).toBe('VALIDATION_ERROR');
      expect(codeOf(() => defineRegistry({ safe: { strings: ['x'], root: reserved } })))
        .toBe('VALIDATION_ERROR');
    }
  });

  it('and it refuses them for the stated reason, which is what a reader needs at the failure', () => {
    expect(() => defineRegistry({ 'record-key': { strings: ['x'] } }))
      .toThrow(/reserved/);
  });
});

// ---------------------------------------------------------------------------
// Injectivity through the real call site
// ---------------------------------------------------------------------------

describe('through `FieldRegistry.aadFor`, which is where a product actually gets an AAD', () => {
  const registry = defineRegistry({
    messages: { strings: ['body', 'anchor.quote'] },
    versions: { strings: ['content'], root: 'artefacts' },
    artefacts: { strings: ['title'] },
    accountSettings: { strings: ['theme.wordmark'] },
  });

  it('is the ONLY builder of a content AAD outside `aad.ts`, and it delegates', () => {
    expect(registry.aadFor('messages', 'abc', 'anchor.quote'))
      .toBe(aadForContent('messages', 'abc', 'anchor.quote'));
  });

  it('a `root` override ALIASES the root deliberately: injectivity is over root, not collection', () => {
    // `versions` writes under `artefacts`, so the collection key is not the AAD root. This is not
    // a collision — it is the override doing its job — and the property that keeps it safe is that
    // the two collections' DOCUMENT ID spaces are disjoint: a version's AAD id is
    // `{artefactId}/versions/{versionId}`, which no artefact row id can equal.
    expect(registry.aadFor('versions', 't1/versions/v3', 'content'))
      .toBe(aadForContent('artefacts', 't1/versions/v3', 'content'));
    expect(registry.entry('versions').root).toBe('artefacts');
    expect(registry.entry('artefacts').root).toBe('artefacts');

    // Same root, different docId shape, so the strings differ.
    expect(registry.aadFor('artefacts', 't1', 'title'))
      .not.toBe(registry.aadFor('versions', 't1/versions/v3', 'content'));
  });

  it('holds over the whole table crossed with real document ids and every registered path', () => {
    const docIds = ['d1', 'd10', 'd1/versions/v1', 't1/versions/v3', 't1/versions/v30'];
    const claims: Claim[] = [];
    for (const collection of registry.collections) {
      for (const docId of docIds) {
        for (const path of registry.pathsFor(collection)) {
          claims.push({
            // The description is keyed on the ROOT rather than the collection, because two
            // collections sharing a root and one docId genuinely are one AAD — and if that ever
            // happened it would be a registry defect, which is the next test.
            aad: registry.aadFor(collection, docId, path.fieldPath),
            description: `${registry.entry(collection).root}/${docId}.${path.fieldPath}`,
          });
        }
      }
    }
    expect(claimAll(claims).size).toBe(new Set(claims.map((c) => c.aad)).size);
    expect(claims.length).toBeGreaterThan(20);
  });

  it('two collections sharing a root AND a docId would be one AAD — which is the registry\'s job to prevent', () => {
    // Not a defect in `aadFor`: `versions` and `artefacts` share a root, and if a product ever gave
    // them the same AAD id it would have given one value two homes. Constructed here so the
    // consequence is written down rather than discovered.
    expect(registry.aadFor('versions', 'shared-id', 'content'))
      .toBe(aadForContent('artefacts', 'shared-id', 'content'));
    // The registered PATHS differ, which is what keeps even that case separable in practice:
    // `versions` registers `content` and `artefacts` registers `title`.
    expect(registry.pathsFor('versions').map((p) => p.fieldPath)).toEqual(['content']);
    expect(registry.pathsFor('artefacts').map((p) => p.fieldPath)).toEqual(['title']);
  });
});

// ---------------------------------------------------------------------------
// Every validation, with the collision it prevents
// ---------------------------------------------------------------------------

/**
 * Each of these does the same three things: build the two DISTINCT tuples, show the one string
 * they would both produce if the rule were dropped, and assert the rule refuses one of them.
 *
 * A refusal test on its own says the rule exists. These say what it is for — which is the
 * difference between a rule somebody keeps and a rule somebody relaxes on a Friday.
 */
describe('every validation, and the collision each one prevents', () => {
  it('a `.` in a docId: (a, b, c.d) and (a, b.c, d) would both be "a/b.c.d"', () => {
    expect(aadForContent('a', 'b', 'c.d')).toBe('a/b.c.d');
    expect(codeOf(() => aadForContent('a', 'b.c', 'd'))).toBe('VALIDATION_ERROR');
  });

  it('a `/` in a root: (a/b, c, f) and (a, b/c, f) would both be "a/b/c.f"', () => {
    expect(aadForContent('a', 'b/c', 'f')).toBe('a/b/c.f');
    expect(codeOf(() => aadForContent('a/b', 'c', 'f'))).toBe('VALIDATION_ERROR');
  });

  it('a `.` in a root: (a.b, c, f) would break the first-dot split that recovers the docId', () => {
    // 'a.b/c.f' splits at the FIRST dot, which lands inside the root — so the string parses as
    // root 'a', docId 'b/c', field 'f', a tuple nobody wrote. This is the hole v1 left open: it
    // forbade only '/'.
    expect(aadForContent('a', 'b/c', 'f')).toBe('a/b/c.f');
    expect(codeOf(() => aadForContent('a.b', 'c', 'f'))).toBe('VALIDATION_ERROR');
  });

  it('a `/` in a docId is PERMITTED, and must be — collab\'s versions live three levels down', () => {
    expect(aadForContent('artefacts', 't1/versions/v3', 'content'))
      .toBe('artefacts/t1/versions/v3.content');
  });

  it('an empty fieldPath: there is no dotless whole-record content form, and adding one would collide with the DEK form', () => {
    expect(codeOf(() => aadForContent('a', 'b', ''))).toBe('VALIDATION_ERROR');
  });

  it('a `/` in a productId: (p/A, B, 1, s) and (p, A/B, 1, s) would both be "record-key/p/A/B/1/s"', () => {
    expect(codeOf(() => aadForRecordKeyWrap('p/A', 'B', 1, 'projects/p1'))).toBe('VALIDATION_ERROR');
    expect(codeOf(() => aadForRecordKeyWrap('p', 'A/B', 1, 'projects/p1'))).toBe('VALIDATION_ERROR');
    // With both refused, the four fixed-arity components are recoverable and `scopePath` is
    // whatever remains from index 4 onward — which is the parse the wrap form promises.
    const aad = aadForRecordKeyWrap('p', 'A', 1, 'projects/p1/topics/t1');
    const parts = aad.split('/');
    expect(parts.slice(0, 4)).toEqual(['record-key', 'p', 'A', '1']);
    expect(parts.slice(4).join('/')).toBe('projects/p1/topics/t1');
  });

  it('a non-canonical generation: 1, "1", 1.0 and 01 all render as "1" and would be one string', () => {
    expect(aadForRecordKeyWrap('p', 'A', 1, 'projects/p1')).toBe('record-key/p/A/1/projects/p1');
    expect(codeOf(() => aadForRecordKeyWrap('p', 'A', '1' as unknown as number, 'projects/p1')))
      .toBe('VALIDATION_ERROR');
    expect(codeOf(() => aadForRecordKeyWrap('p', 'A', 0, 'projects/p1'))).toBe('VALIDATION_ERROR');
    expect(codeOf(() => aadForRecordKeyWrap('p', 'A', -1, 'projects/p1'))).toBe('VALIDATION_ERROR');
    expect(codeOf(() => aadForRecordKeyWrap('p', 'A', 1.5, 'projects/p1'))).toBe('VALIDATION_ERROR');
    // `1.0` IS `1` in JavaScript, so it is accepted and renders canonically — which is the point
    // of demanding a number rather than a string.
    expect(aadForRecordKeyWrap('p', 'A', 1.0, 'projects/p1')).toBe('record-key/p/A/1/projects/p1');
  });

  it('an empty scopePath: a wrap bound to nothing would open on every record of the account', () => {
    expect(codeOf(() => aadForRecordKeyWrap('p', 'A', 1, ''))).toBe('VALIDATION_ERROR');
  });

  it('a `/` in a bucket: (b/c, d) and (b, c/d) would both be "obj/b/c/d"', () => {
    expect(aadForObject({ bucket: 'b', path: 'c/d' })).toBe('obj/b/c/d');
    expect(codeOf(() => aadForObject({ bucket: 'b/c', path: 'd' }))).toBe('VALIDATION_ERROR');
  });

  it('the record-key form binds the RECIPIENT, so one record key wrapped twice is two AADs', () => {
    const forA = aadForRecordKeyWrap('collab', 'A', 1, 'projects/p1');
    const forB = aadForRecordKeyWrap('collab', 'B', 1, 'projects/p1');
    expect(forA).not.toBe(forB);
    // Which is what makes moving A's wrap into B's slot a refusal rather than a read.
    expect(forA).toBe('record-key/collab/A/1/projects/p1');
    expect(forB).toBe('record-key/collab/B/1/projects/p1');
  });
});
