/**
 * `aad.test.ts` — the three fixed forms, the object form this package chose, and the validation
 * list that carries injectivity (§16.5).
 *
 * Two things about the shape of this suite are deliberate.
 *
 * **The validation list gets one named test per rule, naming the collision it prevents**, rather
 * than a loop over a table of bad inputs. A loop that silently skipped a row would still be
 * green, and each of these rules exists because of one specific pair of tuples that would
 * otherwise produce one string — so the test says which pair.
 *
 * **Injectivity is asserted as a property over an adversarial cross-product**, claimed into one
 * `Map` that throws on any collision between different tuples. Two claims are made, and they are
 * not equally load-bearing: (a) *within* a form, distinct tuples produce distinct strings, which
 * is what the validation list exists to guarantee and is the real defence; (b) *across* forms, no
 * two builders collide, which is a third defence over a hazard already closed twice — the forms
 * sit at three different key layers, and within the one layer where several ciphertext kinds
 * share a key the authenticated payload-kind byte is the unforgeable discriminator. A reader who
 * believes (b) is the defence will resist the day somebody proposes removing a prefix.
 *
 * No crypto exists at this point in the build order, so every assertion here is a pure string
 * comparison — which is what makes it cheap enough to be exhaustive.
 */

import {
  AAD_OBJECT_DOMAIN,
  aadForContent,
  aadForDek,
  aadForObject,
  aadForRecordKeyWrap,
  assertAad,
} from '../aad';

/**
 * Runs a call that must be refused, asserts the refusal is a `VALIDATION_ERROR`, and returns its
 * message so a test can also assert what it named.
 *
 * The code is read structurally rather than through `instanceof`, so this suite states its
 * dependency on `errors.ts` as "the thrown object carries the taxonomy's code" and not as "the
 * thrown object is this exact class" — the property every caller actually relies on.
 */
function expectRefused(run: () => unknown): string {
  let caught: unknown;
  let returned: unknown;
  let didReturn = false;
  try {
    returned = run();
    didReturn = true;
  } catch (err) {
    caught = err;
  }
  if (didReturn) {
    throw new Error(`expected a VALIDATION_ERROR, but the call returned ${JSON.stringify(returned)}`);
  }
  expect((caught as { code?: unknown }).code).toBe('VALIDATION_ERROR');
  return String((caught as Error).message);
}

// ── The three fixed forms ─────────────────────────────────────────────────────────────────────

describe('the content AAD — {root}/{docId}.{fieldPath}, fixed by plan §5a', () => {
  it('is byte-identical to collab’s live v1/v2 content AAD, so the v1→v3 hop moves the key layer only', () => {
    // Taken from collab's `contentAad` docblock (`lib/content-fields.ts:76-88`) and its live
    // registry, not invented. If this test ever goes red, collab's Phase-C migration has become
    // a two-variable change and the plan's cost estimate is wrong.
    expect(aadForContent('messages', 'abc', 'anchor.quote')).toBe('messages/abc.anchor.quote');
    expect(aadForContent('topics', 't1', 'declinedProposals[]')).toBe('topics/t1.declinedProposals[]');
    expect(aadForContent('artefacts', 't1/versions/v3', 'content')).toBe('artefacts/t1/versions/v3.content');
    expect(aadForContent('accountSettings', 'acc', 'theme.wordmark')).toBe('accountSettings/acc.theme.wordmark');
  });

  it('serves a blob path and a string path identically — `aadForBlob` is not an alias, it does not exist', () => {
    // build's `structuredContent` is a blob; collab's `anchor.quote` is a string. One builder,
    // one form: the registry is what guarantees a path is one or the other, never both.
    expect(aadForContent('deliverables', 'd_12', 'structuredContent')).toBe(
      'deliverables/d_12.structuredContent',
    );
  });

  it('carries no domain prefix of any kind', () => {
    const aad = aadForContent('messages', 'abc', 'anchor.quote');
    expect(aad.startsWith('content/')).toBe(false);
    expect(aad.startsWith(`${AAD_OBJECT_DOMAIN}/`)).toBe(false);
    expect(aad.startsWith('record-key/')).toBe(false);
    expect(aad.startsWith('content-key/')).toBe(false);
    expect(aad).toBe('messages/abc.anchor.quote');
  });

  it('parses back to exactly one tuple: root at the first "/", docId at the first "." after it', () => {
    const root = 'artefacts';
    const docId = 't1/versions/v3';
    const fieldPath = 'content';
    const aad = aadForContent(root, docId, fieldPath);

    const slash = aad.indexOf('/');
    const dot = aad.indexOf('.', slash);
    expect(aad.slice(0, slash)).toBe(root);
    expect(aad.slice(slash + 1, dot)).toBe(docId);
    expect(aad.slice(dot + 1)).toBe(fieldPath);
  });
});

describe('the record-key wrap AAD — record-key/{productId}/{accountId}/{generation}/{scopePath}, fixed by plan §5a', () => {
  it('reproduces the two worked examples', () => {
    expect(aadForRecordKeyWrap('collab', 'atIqNkIXK380Mm4n', 2, 'projects/plTfBLFHrIdQSNEH')).toBe(
      'record-key/collab/atIqNkIXK380Mm4n/2/projects/plTfBLFHrIdQSNEH',
    );
    expect(
      aadForRecordKeyWrap('sfmapper', 'acc-1', 1, 'accounts/acc-1/sfmapper/org-9/scans/scan-3'),
    ).toBe('record-key/sfmapper/acc-1/1/accounts/acc-1/sfmapper/org-9/scans/scan-3');
  });

  it('binds the RECIPIENT’s account, so a record shared from A to B has two wraps with two AADs', () => {
    const scopePath = 'projects/plTfBLFHrIdQSNEH';
    const owner = aadForRecordKeyWrap('collab', 'accA', 3, scopePath);
    const partner = aadForRecordKeyWrap('collab', 'accB', 1, scopePath);

    expect(owner).not.toBe(partner);
    expect(owner).toBe('record-key/collab/accA/3/projects/plTfBLFHrIdQSNEH');
    expect(partner).toBe('record-key/collab/accB/1/projects/plTfBLFHrIdQSNEH');
  });

  it('binds the FULL document path of the wrap holder, never a bare id', () => {
    // Two aggregates whose ids collide across two accounts — sf-mapper's `limit(5)`
    // collection-group ambiguity, which is exactly what a bare id would not survive.
    const a = aadForRecordKeyWrap('sfmapper', 'acc-1', 1, 'accounts/acc-1/sfmapper/org-9/scans/s1');
    const b = aadForRecordKeyWrap('sfmapper', 'acc-1', 1, 'accounts/acc-1/sfmapper/org-8/scans/s1');
    expect(a).not.toBe(b);
  });

  it('is fixed-arity for four components and free-form after them: scopePath rejoins from index 4', () => {
    // This is the mechanical statement of why `productId` and `accountId` may not contain '/'
    // and why `generation` must be an integer: everything up to index 3 is one component each,
    // and everything from index 4 onward is the path.
    const scopePath = 'accounts/acc-1/sfmapper/org-9/scans/scan-3';
    const parts = aadForRecordKeyWrap('sfmapper', 'acc-1', 12, scopePath).split('/');

    expect(parts[0]).toBe('record-key');
    expect(parts[1]).toBe('sfmapper');
    expect(parts[2]).toBe('acc-1');
    expect(parts[3]).toBe('12');
    expect(parts.slice(4).join('/')).toBe(scopePath);
  });

  it('renders the generation canonically, so one generation is one string', () => {
    const at = (g: number): string => aadForRecordKeyWrap('collab', 'a', g, 'projects/p1');
    expect(at(1)).toBe(at(1.0));
    expect(at(2)).toContain('/2/');
    expect(at(Number.MAX_SAFE_INTEGER)).toContain(`/${String(Number.MAX_SAFE_INTEGER)}/`);
  });
});

describe('the account DEK wrap AAD — content-key/{productId}/{accountId}/{generation}, fixed by plan §6', () => {
  it('is the OUTER AAD only, and has exactly four components', () => {
    const aad = aadForDek('collab', 'atIqNkIXK380Mm4n', 3);
    expect(aad).toBe('content-key/collab/atIqNkIXK380Mm4n/3');
    expect(aad.split('/')).toHaveLength(4);
  });

  it('never collides with the record-key form that shares its first three components', () => {
    // The two forms are distinguished by their domain token alone at this point, which is
    // sufficient because they also sit at two different key layers: this one is wrapped under
    // the KMS KEK, the other under an account DEK.
    expect(aadForDek('collab', 'a', 1)).not.toBe(aadForRecordKeyWrap('collab', 'a', 1, 'x/y'));
  });
});

describe('the object AAD — obj/{bucket}/{objectPath}, this package’s choice and NOT the plan’s', () => {
  it('is the one form that still carries a domain prefix', () => {
    expect(AAD_OBJECT_DOMAIN).toBe('obj');
    expect(aadForObject({ bucket: 'acme-morph', path: 'objects/ab/cd/ef.bin' })).toBe(
      'obj/acme-morph/objects/ab/cd/ef.bin',
    );
  });

  it('binds the bucket, so a body cannot move between one product’s bucket and another’s', () => {
    const path = 'objects/ab/cd/ef.bin';
    expect(aadForObject({ bucket: 'acme-morph', path })).not.toBe(
      aadForObject({ bucket: 'acme-build', path }),
    );
  });

  it('accepts any structurally compatible ref, which is how a real `ObjectRef` reaches it', () => {
    // `ObjectRef` is declared in `object-envelope.ts` (§10) and this module restates its shape
    // rather than importing upward through the layering. TypeScript is structural: a value
    // carrying more than the two fields is accepted, with no cast at the call site.
    const ref: { readonly bucket: string; readonly path: string; readonly generation: number } = {
      bucket: 'acme-sfmapper',
      path: 'exports/2026/scan-3.json',
      generation: 7,
    };
    expect(aadForObject(ref)).toBe('obj/acme-sfmapper/exports/2026/scan-3.json');
  });
});

// ── The validation list, each rule named for the collision it prevents (§6.2) ──────────────────

describe('the validation list — what carries injectivity now that the domain prefixes are gone', () => {
  it('refuses a docId containing "." — else a/b.c.d parses as two different rows', () => {
    // (root a, docId b, field c.d) and (root a, docId b.c, field d) are one string.
    expect(aadForContent('a', 'b', 'c.d')).toBe('a/b.c.d');
    const message = expectRefused(() => aadForContent('a', 'b.c', 'd'));
    expect(message).toContain('b.c');
  });

  it('refuses a root containing "/" — else root a/b + docId c equals root a + docId b/c', () => {
    expect(aadForContent('a', 'b/c', 'd')).toBe('a/b/c.d');
    const message = expectRefused(() => aadForContent('a/b', 'c', 'd'));
    expect(message).toContain('a/b');
  });

  it('refuses a root containing "." — new in v2; root a.b breaks the first-dot split', () => {
    // v1 forbade only '/'. With root 'a.b' the docId can no longer be recovered: 'a.b/c.d'
    // splits at the first '.' into a root that is not a root.
    const message = expectRefused(() => aadForContent('a.b', 'c', 'd'));
    expect(message).toContain('a.b');
  });

  it('PERMITS a docId containing "/", which collab’s `versions` requires', () => {
    expect(aadForContent('artefacts', 't1/versions/v3', 'content')).toBe(
      'artefacts/t1/versions/v3.content',
    );
  });

  it('refuses an empty fieldPath — there is no dotless whole-record content AAD form', () => {
    expectRefused(() => aadForContent('messages', 'abc', ''));
  });

  it('refuses an empty root and an empty docId', () => {
    expectRefused(() => aadForContent('', 'abc', 'body'));
    expectRefused(() => aadForContent('messages', '', 'body'));
  });

  it('refuses a productId containing "/", in both wrap forms', () => {
    expectRefused(() => aadForRecordKeyWrap('col/lab', 'a', 1, 'projects/p1'));
    expectRefused(() => aadForDek('col/lab', 'a', 1));
    // What it prevents: ('col', 'lab/a', 1) and ('col/lab', 'a', 1) would be one string.
    expect(aadForDek('col', 'lab', 1)).toBe('content-key/col/lab/1');
  });

  it('refuses an accountId containing "/", in both wrap forms', () => {
    expectRefused(() => aadForRecordKeyWrap('collab', 'a/b', 1, 'projects/p1'));
    expectRefused(() => aadForDek('collab', 'a/b', 1));
  });

  it('refuses a generation that is not a positive integer', () => {
    for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1, 1e21]) {
      expectRefused(() => aadForDek('collab', 'a', bad));
      expectRefused(() => aadForRecordKeyWrap('collab', 'a', bad, 'projects/p1'));
    }
    expect(aadForDek('collab', 'a', 1)).toBe('content-key/collab/a/1');
  });

  it('refuses a generation that is a numeric string, which would otherwise interpolate identically', () => {
    expectRefused(() => aadForDek('collab', 'a', '1' as unknown as number));
  });

  it('refuses an empty scopePath — a wrap AAD binds the full path of its holder', () => {
    expectRefused(() => aadForRecordKeyWrap('collab', 'a', 1, ''));
  });

  it('refuses an empty or slash-bearing bucket, and an empty object path', () => {
    expectRefused(() => aadForObject({ bucket: '', path: 'objects/a' }));
    expectRefused(() => aadForObject({ bucket: 'acme/morph', path: 'objects/a' }));
    expectRefused(() => aadForObject({ bucket: 'acme-morph', path: '' }));
    // What the bucket rule prevents: ('acme', 'morph/objects/a') and ('acme/morph', 'objects/a').
    expect(aadForObject({ bucket: 'acme', path: 'morph/objects/a' })).toBe('obj/acme/morph/objects/a');
  });

  it('refuses a non-string component rather than interpolating it', () => {
    const notAString = { toString: () => 'coerced' } as unknown as string;
    expectRefused(() => aadForContent(notAString, 'b', 'c'));
    expectRefused(() => aadForContent('a', notAString, 'c'));
    expectRefused(() => aadForContent('a', 'b', notAString));
    expectRefused(() => aadForDek(notAString, 'a', 1));
    expectRefused(() => aadForDek('collab', notAString, 1));
    expectRefused(() => aadForRecordKeyWrap('collab', 'a', 1, notAString));
    expectRefused(() => aadForObject({ bucket: notAString, path: 'objects/a' }));
    expectRefused(() => aadForObject({ bucket: 'acme-morph', path: notAString }));
    expectRefused(() => aadForObject(null as unknown as { bucket: string; path: string }));
    expectRefused(() => aadForObject(undefined as unknown as { bucket: string; path: string }));
  });

  it('refuses undefined, which is the failure that actually occurs — an optional field reaching a builder', () => {
    const missing = undefined as unknown as string;
    expectRefused(() => aadForContent('messages', missing, 'body'));
    expectRefused(() => aadForRecordKeyWrap('collab', missing, 1, 'projects/p1'));
  });

  // The one validation in this list that is NOT enforced here: a `root` in RESERVED_ROOTS
  // ('record-key', 'content-key', 'obj') is refused by `defineRegistry` (registry.ts,
  // validation 8), because it is a construction-time property of a registry table and a
  // construction-time rule is strictly stronger than a per-write check. Its test lives with the
  // registry, and `aad-injectivity.test.ts` asserts the cross-layer consequence.
});

// ── Injectivity ───────────────────────────────────────────────────────────────────────────────

/**
 * Claims `aad` for `description`, throwing on any collision with a *different* tuple. Claiming
 * the same tuple twice is not a collision — the builders are pure and repeat freely.
 */
function claim(seen: Map<string, string>, aad: string, description: string): void {
  const existing = seen.get(aad);
  if (existing !== undefined && existing !== description) {
    throw new Error(`AAD collision: ${JSON.stringify(aad)} is both ${existing} and ${description}`);
  }
  seen.set(aad, description);
}

const ROOTS = ['a', 'ab', 'a-b', 'messages', 'message', 'messages2', 'topics', 'artefacts'];
const DOC_IDS = ['b', 'bc', 'b/c', 'b/c/d', 't1', 't1/versions/v3', 't1/versions/v30', 'acc'];
const FIELD_PATHS = ['c', 'cd', 'c.d', 'c.d.e', 'c[]', 'c[].d', 'content', 'theme.wordmark'];

const PRODUCT_IDS = ['collab', 'collab2', 'colla', 'sfmapper', 'morph'];
const ACCOUNT_IDS = ['a', 'ab', 'a-b', 'acc-1', 'atIqNkIXK380Mm4n'];
const GENERATIONS = [1, 2, 3, 12, 21];
const SCOPE_PATHS = [
  'projects/p1',
  'projects/p10',
  'projects/p1/topics/t1',
  'accounts/acc-1/sfmapper/org-9/scans/scan-3',
  'accountSettings/acc-1',
];

const BUCKETS = ['acme-morph', 'acme-morph2', 'acme-build', 'acme', 'acme-input'];
const OBJECT_PATHS = ['objects/a', 'objects/ab', 'objects/a/b', 'morph/objects/a', 'uploads/r/1.bin'];

describe('injectivity (a) — within a form, distinct tuples produce distinct strings', () => {
  // The load-bearing claim, and what the validation list above exists to guarantee.

  it('holds over an adversarial cross-product of content tuples', () => {
    const seen = new Map<string, string>();
    let count = 0;
    for (const root of ROOTS) {
      for (const docId of DOC_IDS) {
        for (const fieldPath of FIELD_PATHS) {
          claim(seen, aadForContent(root, docId, fieldPath), `content(${root}, ${docId}, ${fieldPath})`);
          count += 1;
        }
      }
    }
    expect(seen.size).toBe(count);
    expect(count).toBe(ROOTS.length * DOC_IDS.length * FIELD_PATHS.length);
  });

  it('holds over an adversarial cross-product of record-key wrap tuples', () => {
    const seen = new Map<string, string>();
    let count = 0;
    for (const productId of PRODUCT_IDS) {
      for (const accountId of ACCOUNT_IDS) {
        for (const generation of GENERATIONS) {
          for (const scopePath of SCOPE_PATHS) {
            claim(
              seen,
              aadForRecordKeyWrap(productId, accountId, generation, scopePath),
              `wrap(${productId}, ${accountId}, ${generation}, ${scopePath})`,
            );
            count += 1;
          }
        }
      }
    }
    expect(seen.size).toBe(count);
  });

  it('holds over an adversarial cross-product of DEK wrap tuples', () => {
    const seen = new Map<string, string>();
    let count = 0;
    for (const productId of PRODUCT_IDS) {
      for (const accountId of ACCOUNT_IDS) {
        for (const generation of GENERATIONS) {
          claim(seen, aadForDek(productId, accountId, generation), `dek(${productId}, ${accountId}, ${generation})`);
          count += 1;
        }
      }
    }
    expect(seen.size).toBe(count);
  });

  it('holds over an adversarial cross-product of object refs', () => {
    const seen = new Map<string, string>();
    let count = 0;
    for (const bucket of BUCKETS) {
      for (const path of OBJECT_PATHS) {
        claim(seen, aadForObject({ bucket, path }), `object(${bucket}, ${path})`);
        count += 1;
      }
    }
    expect(seen.size).toBe(count);
  });
});

describe('injectivity (b) — across forms, no two builders collide', () => {
  /**
   * Defence in depth, and the file says so plainly: this is the THIRD defence, not the first.
   * The four forms sit at three key layers — `content-key/…` under the KMS KEK, `record-key/…`
   * under an account DEK, content and object bodies under a record key — and a ciphertext from
   * one layer cannot be presented to another whatever its AAD. Within the one layer where
   * several ciphertext kinds share a key, the authenticated payload-kind byte (§7.2) is the
   * unforgeable discriminator and registry disjointness means a field AAD and a blob AAD are
   * never equal in the first place.
   */
  it('holds over every tuple in (a), claimed into one map', () => {
    const seen = new Map<string, string>();
    let count = 0;

    for (const root of ROOTS) {
      for (const docId of DOC_IDS) {
        for (const fieldPath of FIELD_PATHS) {
          claim(seen, aadForContent(root, docId, fieldPath), `content(${root}, ${docId}, ${fieldPath})`);
          count += 1;
        }
      }
    }
    for (const productId of PRODUCT_IDS) {
      for (const accountId of ACCOUNT_IDS) {
        for (const generation of GENERATIONS) {
          claim(seen, aadForDek(productId, accountId, generation), `dek(${productId}, ${accountId}, ${generation})`);
          count += 1;
          for (const scopePath of SCOPE_PATHS) {
            claim(
              seen,
              aadForRecordKeyWrap(productId, accountId, generation, scopePath),
              `wrap(${productId}, ${accountId}, ${generation}, ${scopePath})`,
            );
            count += 1;
          }
        }
      }
    }
    for (const bucket of BUCKETS) {
      for (const path of OBJECT_PATHS) {
        claim(seen, aadForObject({ bucket, path }), `object(${bucket}, ${path})`);
        count += 1;
      }
    }

    expect(seen.size).toBe(count);
    expect(count).toBeGreaterThan(400);
  });

  it('detects a collision when one is planted, so the map is proving something', () => {
    const seen = new Map<string, string>();
    claim(seen, 'a/b.c', 'content(a, b, c)');
    expect(() => claim(seen, 'a/b.c', 'content(a, b.c) — an illegal tuple')).toThrow(/AAD collision/);
  });
});

// ── assertAad ─────────────────────────────────────────────────────────────────────────────────

describe('assertAad', () => {
  it('accepts any non-empty string, including every form this module builds', () => {
    for (const aad of [
      aadForContent('messages', 'abc', 'anchor.quote'),
      aadForRecordKeyWrap('collab', 'a', 1, 'projects/p1'),
      aadForDek('collab', 'a', 1),
      aadForObject({ bucket: 'acme-morph', path: 'objects/a' }),
    ]) {
      expect(() => assertAad(aad)).not.toThrow();
    }
  });

  it('refuses undefined — the failure AES-GCM would otherwise accept as "no AAD at all"', () => {
    expectRefused(() => {
      assertAad(undefined);
    });
  });

  it('refuses an empty string — a value sealed under it is bound to nothing', () => {
    expectRefused(() => {
      assertAad('');
    });
  });

  it('refuses a non-string, including a Buffer', () => {
    expectRefused(() => {
      assertAad(Buffer.from('messages/abc.body'));
    });
    expectRefused(() => {
      assertAad(null);
    });
    expectRefused(() => {
      assertAad(42);
    });
  });

  it('narrows to string for the caller', () => {
    const value: unknown = 'messages/abc.body';
    assertAad(value);
    // If the assertion signature were `boolean` rather than `asserts value is string`, the next
    // line would not compile — which is the whole point of the declaration.
    expect(value.length).toBe(17);
  });
});
