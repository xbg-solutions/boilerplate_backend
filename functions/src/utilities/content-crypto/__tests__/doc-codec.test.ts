/**
 * `doc-codec.test.ts` — the document layer (§16.8).
 *
 * The order below is the order the spec asks for, and the first section is first for a reason:
 *
 *   - **the accumulator**, which is the one load-bearing behaviour collab's own suite does not
 *     exercise, because collab's registry has exactly one array-of-objects path. Two registered
 *     paths under one array segment both write the update key `attachments`, and a planner that
 *     ran each path against the ORIGINAL document would drop the first path's ciphertext with no
 *     other test failing. Four lines, and it is the only guard on a silent data-loss path;
 *   - **collab's eight planner tests, ported**, which are the floor and not the ceiling —
 *     `functions/src/__tests__/content-walk.test.ts` in `collab.xbg.solutions`, value for value;
 *   - the four additions of §13.1, each with the reason it exists in the test name;
 *   - the registered-path enforcement this module owns, because `registry.aadFor` deliberately
 *     does not check;
 *   - `encryptDoc` / `decryptDoc` over both modes, the §7.4 strictness table, and the write-time
 *     document budget;
 *   - `planUpdate`: the four relations, the update-key accumulator one layer up, the sentinel
 *     rows, **each of the eight real build call sites as a fixture**, and the test that documents
 *     why a transaction is mandatory;
 *   - `subPathForInsideKey`, the §8.10 converter and its inherited ambiguity.
 *
 * Mirrorable under §16.3: relative imports only, no manifest read, no `../../`, no wall clock and
 * no randomness of this suite's own. The IV inside every seal is random, which is why nothing here
 * asserts on ciphertext bytes — only on what comes back out of them.
 */

import { applyBlobPatch, decryptBlob } from '../blob-codec';
import { ContentCryptoError, assertNoSecrets } from '../errors';
import { decryptField, encryptField, isEncrypted, isSealedBlobCandidate } from '../field-codec';
import { parseFieldPath } from '../field-path';
import { resolveScope } from '../key-scope';
import { ENC_PREFIX_V1 } from '../legacy-readers';
import type { ContentKeyScope } from '../key-scope';
import { defineRegistry } from '../registry';
import { KEY_BYTES, recordKeyFromBytes } from '../secret';
import type { RecordKey } from '../secret';
import { asNodeTransform, createDocCodec, createDocPlanner, subPathForInsideKey } from '../doc-codec';
import type { DocPlan, PlannedAt } from '../doc-codec';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A deterministic record key: this suite asserts on round trips, never on bytes. */
const key: RecordKey = recordKeyFromBytes(Buffer.alloc(KEY_BYTES, 0xa1), 'projects/p_1');
const otherKey: RecordKey = recordKeyFromBytes(Buffer.alloc(KEY_BYTES, 0xb2), 'projects/p_2');

/**
 * collab's live table (the string half) plus the three blob products' collections, so the same
 * registry serves the ported tests and the blob ones. `versions` and `checkpoints` carry the two
 * real `root` overrides, which is what makes `decryptDocs`' guard testable.
 *
 * `results` declares ONE BIG AND TWO SMALL, which is §14.2 as R8 corrected it: ceilings are per
 * PATH, so Morph's actual shape — one large structured output beside two small companions — is
 * expressible, and the static sum is 900 000 against a 1 000 000 budget rather than 3 × 700 000.
 */
const registry = defineRegistry({
  projects: { strings: ['name', 'description', 'lastActivitySummary'] },
  topics: { strings: ['title', 'authoringError', 'declinedProposals[]'] },
  messages: {
    strings: [
      'body',
      'anchor.quote', 'anchor.prefix', 'anchor.suffix', 'anchor.sectionTitle',
      'proposal.title', 'proposal.rationale', 'proposal.seedContent',
      'attachments[].filename',
    ],
  },
  versions: { strings: ['content', 'summary', 'label'], root: 'artefacts' },
  results: {
    blobs: [
      { path: 'structuredOutput', maxSealedBytes: 700_000 },
      { path: 'citations', maxSealedBytes: 100_000 },
      { path: 'viewerPayload', maxSealedBytes: 100_000 },
    ],
  },
  deliverables: { blobs: ['structuredContent'] },
  specEntities: { blobs: ['fields'] },
  checkpoints: { blobs: ['payload'], root: 'phases' },
  activityEvents: { strings: ['summary'], blobs: ['payload'] },
  /** The one collection that reads leniently, so `readsFor`'s resolution order is exercised. */
  legacyNotes: { strings: ['body'], reads: 'lenient' },
});

const baseScope: ContentKeyScope<'project'> = {
  productId: 'collab',
  records: { project: 'aggregate' },
};

const scope = resolveScope(baseScope, registry);
const lenientScope = resolveScope({ ...baseScope, reads: 'lenient' }, registry);

const codec = createDocCodec(registry, scope);
const lenientCodec = createDocCodec(registry, lenientScope);
const planDoc = createDocPlanner(registry, scope);

/** collab's `versionDocId`: its registry knowledge, kept in its own repo and restated here. */
const versionDocId = (artefactId: string, versionId: string): string =>
  `${artefactId}/versions/${versionId}`;

/** Upper-case every string, so a change is obvious and the AAD is observable. collab's `shout`. */
function shout(seen: string[] = []) {
  return asNodeTransform((value: string, aad: string) => {
    seen.push(aad);
    return value.toUpperCase();
  });
}

/** The `ContentCryptoError` a thunk throws. Never returns; never swallows a foreign error. */
function thrown(fn: () => unknown): ContentCryptoError {
  try {
    fn();
  } catch (err) {
    if (err instanceof ContentCryptoError) {
      // Everything this package throws has been through `assertNoSecrets` in the constructor;
      // asserting it here makes that a property of the suite rather than of `errors.ts` alone.
      assertNoSecrets(err.details);
      return err;
    }
    throw err;
  }
  throw new Error('expected a ContentCryptoError, nothing was thrown');
}

// ---------------------------------------------------------------------------
// THE ACCUMULATOR — written first, and the only guard on a silent data-loss path
// ---------------------------------------------------------------------------

describe('the accumulator', () => {
  it('accumulates across paths, so two registered paths under one array segment both survive', () => {
    const twoPaths = defineRegistry({
      messages: { strings: ['attachments[].filename', 'attachments[].caption'] },
    });
    const plan = createDocPlanner(twoPaths, resolveScope(baseScope, twoPaths))(
      'messages', 'm1',
      { attachments: [{ filename: 'a.txt', caption: 'c', path: 'projects/p/x' }] },
      asNodeTransform((v) => v.toUpperCase()),
    );
    expect(plan.update).toEqual({
      attachments: [{ filename: 'A.TXT', caption: 'C', path: 'projects/p/x' }],
    });
    expect(plan.changed).toBe(2);
  });

  it('reads the update value back from the ACCUMULATED document, never from the input', () => {
    // The failing shape stated as an assertion: if the second path were planned against `data`,
    // the written array would carry `A.TXT` OR `C` but never both, and `changed` would still be 2.
    const twoPaths = defineRegistry({
      messages: { strings: ['attachments[].filename', 'attachments[].caption'] },
    });
    const data = { attachments: [{ filename: 'a.txt', caption: 'c' }] };
    const plan = createDocPlanner(twoPaths, resolveScope(baseScope, twoPaths))(
      'messages', 'm1', data, asNodeTransform((v) => v.toUpperCase()),
    );
    const written = plan.update.attachments as { filename: string; caption: string }[];
    expect(written[0].filename).toBe('A.TXT');
    expect(written[0].caption).toBe('C');
    // And the input is untouched: copies are made only along the path that changed.
    expect(data.attachments[0]).toEqual({ filename: 'a.txt', caption: 'c' });
  });

  it('seals both paths under one array segment — the same property with the real transform', () => {
    const twoPaths = defineRegistry({
      messages: { strings: ['attachments[].filename', 'attachments[].caption'] },
    });
    const twoCodec = createDocCodec(twoPaths, resolveScope(baseScope, twoPaths));
    const sealed = twoCodec.encryptDoc(key, 'messages', 'm1', {
      attachments: [{ filename: 'a.txt', caption: 'c' }],
    });
    const opened = twoCodec.decryptDoc(key, 'messages', 'm1', sealed);
    expect(opened).toEqual({ attachments: [{ filename: 'a.txt', caption: 'c' }] });
  });
});

// ---------------------------------------------------------------------------
// collab's eight planner tests, ported
// ---------------------------------------------------------------------------

describe('planDoc — collab’s suite, ported', () => {
  it('writes a dotted key per nested string and leaves siblings alone', () => {
    const data = {
      body: 'hello',
      anchor: { quote: 'q', sectionId: 'sec-1' },
      proposal: { title: 't', rationale: 'r', seedContent: 's' },
      kind: 'comment',
    };
    const { update, changed } = planDoc('messages', 'm1', data, shout());
    expect(changed).toBe(5);
    expect(update).toEqual({
      body: 'HELLO',
      'anchor.quote': 'Q',
      'proposal.title': 'T',
      'proposal.rationale': 'R',
      'proposal.seedContent': 'S',
    });
    // The unregistered sibling is never NAMED in the update — asserted on the key set and not
    // by equality, because writing `anchor` whole is equally correct in a vacuum and clobbers a
    // concurrent writer.
    expect(Object.keys(update)).not.toContain('anchor.sectionId');
    expect(Object.keys(update)).not.toContain('kind');
  });

  it('writes an array whole from its array segment, because Firestore cannot address an element by path', () => {
    const { update, changed } = planDoc(
      'topics', 't1', { title: 'topic', declinedProposals: ['a', 'b'] }, shout(),
    );
    expect(changed).toBe(3);
    expect(update).toEqual({ title: 'TOPIC', declinedProposals: ['A', 'B'] });
  });

  it('writes the whole array from an array of objects, keeping each element’s other fields', () => {
    const data = { body: '', attachments: [{ filename: 'a.txt', path: 'projects/p/x' }] };
    const { update } = planDoc(
      'messages', 'm1', data, asNodeTransform((v) => (v ? v.toUpperCase() : v)),
    );
    expect(update).toEqual({ attachments: [{ filename: 'A.TXT', path: 'projects/p/x' }] });
  });

  it('builds the AAD from the registered path, so array elements share one', () => {
    const seen: string[] = [];
    planDoc('topics', 't1', { title: 'topic', declinedProposals: ['a', 'b'] }, shout(seen));
    expect(seen).toEqual([
      'topics/t1.title',
      'topics/t1.declinedProposals[]',
      'topics/t1.declinedProposals[]',
    ]);
  });

  it('uses the version’s real Firestore path as its AAD id', () => {
    const seen: string[] = [];
    planDoc('versions', versionDocId('t1', 'v3'), { content: 'c' }, shout(seen));
    expect(seen[0]).toBe('artefacts/t1/versions/v3.content');
  });

  it('changes nothing and produces no update when the transform returns what it was given', () => {
    const { update, changed } = planDoc(
      'projects', 'p1', { name: 'Alpha', description: 'd' }, asNodeTransform((v) => v),
    );
    expect(changed).toBe(0);
    expect(update).toEqual({});
  });

  it('names only the paths the transform actually touched', () => {
    const { update, changed } = planDoc(
      'projects', 'p1',
      { name: 'Alpha', description: 'd', lastActivitySummary: 'x' },
      asNodeTransform((v) => (v === 'd' ? 'D' : v)),
    );
    expect(changed).toBe(1);
    expect(update).toEqual({ description: 'D' });
  });

  it('leaves nulls, missing paths and non-strings exactly as they are', () => {
    const data = { title: 'topic', authoringError: null, declinedProposals: undefined };
    const { update, changed } = planDoc('topics', 't1', data, shout());
    expect(changed).toBe(1);
    expect(update).toEqual({ title: 'TOPIC' });
  });
});

// ---------------------------------------------------------------------------
// The four additions of §13.1
// ---------------------------------------------------------------------------

describe('planDoc — the four additions', () => {
  it('counts every registered value REACHED in `visited`, so a dry run reports what it saw', () => {
    // collab's migration script had to wrap the planner in its own counter for exactly this: a
    // dry run reports `changed: 0` and has no other way to say whether it reached anything.
    const data = {
      body: 'hello',
      anchor: { quote: 'q' },
      proposal: { title: 't', rationale: 'r', seedContent: 's' },
    };
    const plan = planDoc('messages', 'm1', data, asNodeTransform((v) => v));
    expect(plan.visited).toBe(5);
    expect(plan.changed).toBe(0);
    expect(plan.update).toEqual({});
  });

  it('yields an empty plan for `data === undefined` — a deleted row', () => {
    // In collab this works by luck of `mapPath`'s type guards. Here it is pinned.
    const plan = planDoc('messages', 'm1', undefined, shout());
    expect(plan).toEqual({ update: {}, changed: 0, visited: 0 });
  });

  it('returns `PlannedAt` carrying exactly aad, mode and fieldPath — anything more is an AAD a transform could build', () => {
    const seen: PlannedAt[] = [];
    planDoc('messages', 'm1', { body: 'b', attachments: [{ filename: 'f' }] }, (node, at) => {
      seen.push(at);
      return node;
    });
    for (const at of seen) {
      expect(Object.keys(at).sort()).toEqual(['aad', 'fieldPath', 'mode']);
    }
    expect(seen[0]).toEqual({ aad: 'messages/m1.body', mode: 'string', fieldPath: 'body' });
    expect(seen[1].fieldPath).toBe('attachments[].filename');
  });

  it('reports mode `blob` for a blob path and hands the transform the whole subtree', () => {
    const payload = { checkins: [{ at: 1 }] };
    const seen: PlannedAt[] = [];
    const nodes: unknown[] = [];
    planDoc('checkpoints', 'build/epic-4', { payload, status: 'open' }, (node, at) => {
      seen.push(at);
      nodes.push(node);
      return node;
    });
    expect(seen).toEqual([
      { aad: 'phases/build/epic-4.payload', mode: 'blob', fieldPath: 'payload' },
    ]);
    // The SAME REFERENCE, which is what "return the value you were given" means for a blob.
    expect(nodes[0]).toBe(payload);
  });

  it('wraps collab’s two-argument transform with `asNodeTransform`, which behaves identically', () => {
    const data = { name: 'Alpha', description: 'd' };
    const viaValue = planDoc('projects', 'p1', data, asNodeTransform((v) => v.toUpperCase()));
    const viaNode: DocPlan = planDoc(
      'projects', 'p1', data,
      (node) => (typeof node === 'string' ? node.toUpperCase() : node),
    );
    expect(viaValue).toEqual(viaNode);
  });

  it('never hands a non-string to a `ValueTransform` — the wrapper filters, so a blob cannot reach one', () => {
    const seen: unknown[] = [];
    planDoc('activityEvents', 'e1', { summary: 's', payload: { a: 1 } }, asNodeTransform((v) => {
      seen.push(v);
      return v;
    }));
    expect(seen).toEqual(['s']);
  });

  it('a blob path is never a wildcard, so its update key is the full dotted path', () => {
    const plan = planDoc('checkpoints', 'build/epic-4', { payload: { a: 1 } }, () => 'sealed');
    expect(Object.keys(plan.update)).toEqual(['payload']);
  });
});

describe('planDoc — identity and sentinels', () => {
  it('returns untouched subtrees by reference, so an unchanged document costs nothing', () => {
    const anchor = { quote: 'q', sectionId: 's' };
    const data = { body: 'b', anchor };
    const plan = planDoc('messages', 'm1', data, asNodeTransform((v) => (v === 'b' ? 'B' : v)));
    expect(plan.changed).toBe(1);
    // `anchor` was visited and returned unchanged: the walker's `next === inner` short-circuit
    // means the object is not rebuilt, so a caller diffing references sees no change.
    expect(plan.update.anchor).toBeUndefined();
  });

  it('leaves an object with a foreign constructor untouched — what `isPlainObject`’s strict check buys', () => {
    // The Firestore sentinel case, without importing Firestore: a class instance is not a plain
    // object, so the walk steps OVER it and returns it by reference rather than rebuilding it as
    // bare data. Widening `isPlainObject` is how a sentinel silently becomes `{}` on its way to
    // a write.
    class Sentinel {
      readonly kind = 'delete';
    }
    const sentinel = new Sentinel();
    const data = { body: 'b', anchor: sentinel, extra: sentinel };
    const plan = planDoc('messages', 'm1', data, shout());
    expect(plan.changed).toBe(1);
    expect(plan.update).toEqual({ body: 'B' });
    expect(data.anchor).toBe(sentinel);
  });
});

// ---------------------------------------------------------------------------
// "Is this path registered" — the enforcement this module owns
// ---------------------------------------------------------------------------

describe('the registered set is enforced here, because `aadFor` deliberately does not', () => {
  it('refuses an unregistered collection, naming the registered ones', () => {
    const err = thrown(() => planDoc('nope' as 'projects', 'p1', {}, shout()));
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.message).toContain('no content is registered for collection "nope"');
  });

  it('refuses `openBlobAt` at a path that is not a registered blob path', () => {
    const err = thrown(() => codec.openBlobAt(key, 'results', 'r_1', 'notARealPath', 'x'));
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.message).toContain('"notARealPath" is not one');
    expect(err.message).toContain('"structuredOutput", "citations", "viewerPayload"');
    expect(err.details).toEqual({ collection: 'results', fieldPath: 'notARealPath' });
  });

  it('refuses `openBlobAt` at a registered STRING path — the mode is part of "registered"', () => {
    expect(thrown(() => codec.openBlobAt(key, 'activityEvents', 'e1', 'summary', 'x')).code)
      .toBe('VALIDATION_ERROR');
  });

  it('refuses `encryptArrayValue` at a path with no array segment', () => {
    const err = thrown(() => codec.encryptArrayValue(key, 'topics', 't1', 'title', 'x'));
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.message).toContain('"declinedProposals[]"');
  });

  it('says WHY the registry does not check it, so nobody moves the guard back there', () => {
    const err = thrown(() => codec.openBlobAt(key, 'results', 'r_1', 'nope', 'x'));
    expect(err.message).toContain('a legacy read at a renamed path and a blob reseal both need one');
  });
});

// ---------------------------------------------------------------------------
// encryptDoc / decryptDoc
// ---------------------------------------------------------------------------

describe('encryptDoc / decryptDoc', () => {
  it('round-trips every registered string, leaving unregistered fields alone', () => {
    const data = {
      body: 'hello',
      anchor: { quote: 'q', sectionId: 'sec-1' },
      attachments: [{ filename: 'a.txt', path: 'projects/p/x' }],
      kind: 'comment',
    };
    const sealed = codec.encryptDoc(key, 'messages', 'm1', data);
    expect(isEncrypted(sealed.body)).toBe(true);
    expect(sealed.anchor.sectionId).toBe('sec-1');
    expect(sealed.kind).toBe('comment');
    expect(isEncrypted(sealed.attachments[0].filename)).toBe(true);
    expect(sealed.attachments[0].path).toBe('projects/p/x');
    expect(codec.decryptDoc(key, 'messages', 'm1', sealed)).toEqual(data);
  });

  it('round-trips a blob path as one sealed string', () => {
    const data = { payload: { checkins: [{ at: 1, note: 'x' }], gitContext: null } };
    const sealed = codec.encryptDoc(key, 'checkpoints', 'build/epic-4', data);
    expect(isSealedBlobCandidate(sealed.payload)).toBe(true);
    expect(codec.decryptDoc(key, 'checkpoints', 'build/epic-4', sealed)).toEqual(data);
  });

  it('returns `data` BY REFERENCE when nothing registered was present', () => {
    const data = { kind: 'comment', anchor: { sectionId: 's' } };
    expect(codec.encryptDoc(key, 'messages', 'm1', data)).toBe(data);
    expect(codec.decryptDoc(key, 'messages', 'm1', data)).toBe(data);
  });

  it('binds each value to its own path: a ciphertext moved between paths does not open', () => {
    const sealed = codec.encryptDoc(key, 'messages', 'm1', { body: 'b', anchor: { quote: 'q' } });
    const moved = { body: sealed.anchor.quote, anchor: { quote: sealed.body } };
    expect(thrown(() => codec.decryptDoc(key, 'messages', 'm1', moved)).code)
      .toBe('CONTENT_DECRYPT_FAILED');
  });

  it('binds each value to its own document id', () => {
    const sealed = codec.encryptDoc(key, 'messages', 'm1', { body: 'b' });
    expect(thrown(() => codec.decryptDoc(key, 'messages', 'm2', sealed)).code)
      .toBe('CONTENT_DECRYPT_FAILED');
  });

  it('a write ALWAYS encrypts, including a plaintext that looks like a ciphertext', () => {
    const looksSealed = codec.encryptDoc(key, 'messages', 'm1', { body: 'b' }).body;
    const doubled = codec.encryptDoc(key, 'messages', 'm1', { body: looksSealed });
    expect(doubled.body).not.toBe(looksSealed);
    expect(codec.decryptDoc(key, 'messages', 'm1', doubled).body).toBe(looksSealed);
  });

  it('refuses a re-seal at a BLOB path, where a double envelope would be unopenable', () => {
    const sealed = codec.encryptDoc(key, 'checkpoints', 'c1', { payload: { a: 1 } });
    expect(thrown(() => codec.encryptDoc(key, 'checkpoints', 'c1', sealed)).code)
      .toBe('BLOB_ALREADY_SEALED');
  });

  it('opens nothing under the wrong record key', () => {
    const sealed = codec.encryptDoc(key, 'messages', 'm1', { body: 'b' });
    expect(thrown(() => codec.decryptDoc(otherKey, 'messages', 'm1', sealed)).code)
      .toBe('CONTENT_DECRYPT_FAILED');
  });
});

describe('read strictness — §7.4’s table, at the document layer', () => {
  it('strict: plaintext at a registered STRING path is CONTENT_PLAINTEXT_AT_REGISTERED_PATH', () => {
    const err = thrown(() => codec.decryptDoc(key, 'messages', 'm1', { body: 'plain' }));
    expect(err.code).toBe('CONTENT_PLAINTEXT_AT_REGISTERED_PATH');
    expect(err.details).toEqual({ collection: 'messages', docId: 'm1', fieldPath: 'body' });
  });

  it('strict: plaintext at a registered BLOB path is the same code', () => {
    expect(thrown(() => codec.decryptDoc(key, 'checkpoints', 'c1', { payload: { a: 1 } })).code)
      .toBe('CONTENT_PLAINTEXT_AT_REGISTERED_PATH');
  });

  it('lenient: plaintext at either mode passes through untouched', () => {
    const data = { body: 'plain' };
    expect(lenientCodec.decryptDoc(key, 'messages', 'm1', data)).toBe(data);
    const blob = { payload: { a: 1 } };
    expect(lenientCodec.decryptDoc(key, 'checkpoints', 'c1', blob)).toBe(blob);
  });

  it('a per-collection `reads` override beats the scope default, which is the resolution order', () => {
    // `legacyNotes` declares `reads: 'lenient'` on the entry; the scope is strict.
    const data = { body: 'plain' };
    expect(codec.decryptDoc(key, 'legacyNotes', 'n1', data)).toBe(data);
    expect(thrown(() => codec.decryptDoc(key, 'messages', 'm1', data)).code)
      .toBe('CONTENT_PLAINTEXT_AT_REGISTERED_PATH');
  });

  it('a bad tag is CONTENT_DECRYPT_FAILED in BOTH modes — leniency is about plaintext, never bytes', () => {
    const sealed = codec.encryptDoc(key, 'messages', 'm1', { body: 'b' });
    // Flip one character of the CIPHERTEXT part, which keeps the envelope well formed — a
    // truncation would decode to `null` and be read as an ordinary string instead, which is the
    // §7.4 row above this one and not the one under test.
    const parts = sealed.body.split(':');
    parts[3] = parts[3][0] === 'A' ? `B${parts[3].slice(1)}` : `A${parts[3].slice(1)}`;
    const tampered = { body: parts.join(':') };
    for (const c of [codec, lenientCodec]) {
      expect(thrown(() => c.decryptDoc(key, 'messages', 'm1', tampered)).code)
        .toBe('CONTENT_DECRYPT_FAILED');
    }
  });

  it('a v1 value at a registered path is WRONG_KEY_LAYER in BOTH modes', () => {
    // The prefix comes from `legacy-readers.ts`, which re-exports it: assertion (6) reserves the
    // literal to the three files that own the wire, and a suite typing it out by hand is how a
    // quarantine stops being one.
    const v1 = { body: `${ENC_PREFIX_V1}${'A'.repeat(16)}:AAAA:${'A'.repeat(22)}==` };
    for (const c of [codec, lenientCodec]) {
      expect(thrown(() => c.decryptDoc(key, 'messages', 'm1', v1)).code).toBe('WRONG_KEY_LAYER');
    }
  });

  it('a non-string at a registered string path is untouched in both modes, and never counted', () => {
    const data = { body: 42, anchor: { quote: null } };
    expect(codec.decryptDoc(key, 'messages', 'm1', data)).toBe(data);
    expect(codec.encryptDoc(key, 'messages', 'm1', data)).toBe(data);
  });
});

describe('decryptDocs', () => {
  it('defaults `docIdOf` to `.id`', () => {
    const rows = ['a', 'b'].map((id) => ({
      id, ...codec.encryptDoc(key, 'projects', id, { name: `n-${id}` }),
    }));
    expect(codec.decryptDocs(key, 'projects', rows).map((r) => r.name)).toEqual(['n-a', 'n-b']);
  });

  it('REQUIRES `docIdOf` for a collection whose entry carries a root override', () => {
    const err = thrown(() => codec.decryptDocs(key, 'checkpoints', [{ id: 'epic-4' }]));
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.message).toContain('root override "phases"');
    expect(err.details).toEqual({ collection: 'checkpoints' });
  });

  it('accepts `docIdOf`, and the AAD it builds is the one the write used', () => {
    const aadDocId = 'build/epic-4';
    const row = { id: 'epic-4', phaseKey: 'build', ...codec.encryptDoc(key, 'checkpoints', aadDocId, { payload: { a: 1 } }) };
    const [opened] = codec.decryptDocs(key, 'checkpoints', [row], (d) => `${d.phaseKey}/${d.id}`);
    expect(opened.payload).toEqual({ a: 1 });
  });
});

// ---------------------------------------------------------------------------
// The write-time document budget (§8.6 mechanism 3)
// ---------------------------------------------------------------------------

describe('the per-document budget, on the real bytes', () => {
  /**
   * One array path and a small budget: the construction-time sum counts that path ONCE, and the
   * document holds fifty sealed elements. That gap is exactly what mechanism 3 exists to close,
   * and it is why the static check is necessary and not sufficient.
   */
  const tinyRegistry = defineRegistry({ logs: { strings: ['lines[]'] } });
  const tinyScope = resolveScope(
    { productId: 'tiny', records: { doc: 'aggregate' }, maxSealedBytes: 4_096, maxDocumentSealedBytes: 5_000 },
    tinyRegistry,
  );
  const tinyCodec = createDocCodec(tinyRegistry, tinyScope);

  it('throws DOCUMENT_TOO_LARGE naming the contributors when the sealed bytes do not fit', () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line ${i} of the run log`);
    const err = thrown(() => tinyCodec.encryptDoc(key, 'logs', 'l_1', { lines }));
    expect(err.code).toBe('DOCUMENT_TOO_LARGE');
    expect(err.status).toBe(400);
    expect(err.message).toContain('the document logs/l_1 seals to');
    expect(err.message).toContain('sealed values (lines[]');
    expect(err.message).toContain('bytes of unsealed fields; the document budget is 5000.');
    expect(err.details).toEqual({
      collection: 'logs',
      docId: 'l_1',
      sealedBytes: expect.any(Number),
      limitBytes: 5_000,
    });
    expect(Number(err.details.sealedBytes)).toBeGreaterThan(5_000);
  });

  it('accepts the same document one array element shorter, so the ceiling is a ceiling and not a mood', () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line ${i}`);
    expect(() => tinyCodec.encryptDoc(key, 'logs', 'l_1', { lines })).not.toThrow();
  });

  it('does not measure a document it sealed nothing in — the package contributed no bytes', () => {
    const big = { note: 'x'.repeat(200_000) };
    expect(tinyCodec.encryptDoc(key, 'logs', 'l_1', big)).toBe(big);
  });

  it('a per-PATH ceiling refuses before the document budget does, and names the path (R8)', () => {
    const err = thrown(() => codec.encryptDoc(key, 'results', 'r_88', {
      citations: { rows: Array.from({ length: 4_000 }, (_, i) => `citation number ${i}`) },
    }));
    expect(err.code).toBe('BLOB_TOO_LARGE');
    expect(err.message).toContain('results/r_88.citations');
    // The path declared 100 000 while its neighbour declared 700 000: one big and two small is
    // the configuration R8 made expressible, and enforcement must use the PATH's number.
    expect(codec.encryptDoc(key, 'results', 'r_88', {
      structuredOutput: { rows: Array.from({ length: 4_000 }, (_, i) => `citation number ${i}`) },
    })).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// planUpdate — the four relations
// ---------------------------------------------------------------------------

describe('planUpdate — the four relations of §8.10', () => {
  it('unrelated: a key on no registered path passes through untouched', () => {
    const value = { deep: 'not registered' };
    const plan = codec.planUpdate(key, 'messages', 'm1', { status: 'open', meta: value });
    expect(plan.update.status).toBe('open');
    expect(plan.update.meta).toBe(value);
    expect(plan.reseals).toEqual([]);
  });

  it('exact: a blob key seals the new value whole', () => {
    const plan = codec.planUpdate(key, 'checkpoints', 'build/epic-4', { payload: { a: 1 } });
    expect(plan.reseals).toEqual([]);
    expect(isSealedBlobCandidate(plan.update.payload)).toBe(true);
    expect(decryptBlob(key, 'phases/build/epic-4.payload', plan.update.payload as string))
      .toEqual({ a: 1 });
  });

  it('contains: a key ABOVE the blob seals the blob in place, inside the update value', () => {
    const nested = defineRegistry({ rows: { blobs: ['a.b'] } });
    const nestedCodec = createDocCodec(nested, resolveScope(baseScope, nested));
    const plan = nestedCodec.planUpdate(key, 'rows', 'r1', { a: { b: { deep: 1 }, c: 'plain' } });
    const written = plan.update.a as { b: string; c: string };
    expect(written.c).toBe('plain');
    expect(isSealedBlobCandidate(written.b)).toBe(true);
    expect(decryptBlob(key, 'rows/r1.a.b', written.b)).toEqual({ deep: 1 });
  });

  it('inside: a key reaching into a blob emits a reseal request and writes NOTHING at that key', () => {
    const plan = codec.planUpdate(key, 'checkpoints', 'build/epic-4', {
      'payload.checkins': [{ at: 1 }],
    });
    expect(Object.keys(plan.update)).toEqual([]);
    expect(plan.reseals).toEqual([{
      collection: 'checkpoints',
      docId: 'build/epic-4',
      fieldPath: 'payload',
      aad: 'phases/build/epic-4.payload',
      patches: [{ op: 'set', subPath: 'checkins', value: [{ at: 1 }] }],
    }]);
  });

  it('seals a registered string named by its own key, and one named by its parent', () => {
    const direct = codec.planUpdate(key, 'messages', 'm1', { 'anchor.quote': 'q' });
    expect(decryptField(key, 'messages/m1.anchor.quote', direct.update['anchor.quote'] as string))
      .toBe('q');

    const whole = codec.planUpdate(key, 'messages', 'm1', { anchor: { quote: 'q', sectionId: 's' } });
    const written = whole.update.anchor as { quote: string; sectionId: string };
    expect(written.sectionId).toBe('s');
    expect(decryptField(key, 'messages/m1.anchor.quote', written.quote)).toBe('q');
  });

  it('seals every element when the key IS an array path, at the array’s single AAD', () => {
    const plan = codec.planUpdate(key, 'topics', 't1', { declinedProposals: ['a', 'b'] });
    const written = plan.update.declinedProposals as string[];
    expect(written.map((v) => decryptField(key, 'topics/t1.declinedProposals[]', v)))
      .toEqual(['a', 'b']);
  });

  it('seals one element addressed by index, at the SAME AAD as the whole array', () => {
    const plan = codec.planUpdate(key, 'messages', 'm1', { 'attachments.0.filename': 'a.txt' });
    expect(decryptField(
      key, 'messages/m1.attachments[].filename', plan.update['attachments.0.filename'] as string,
    )).toBe('a.txt');
  });

  it('applies EVERY registered path a single key matches, to the accumulator and never the input', () => {
    // `anchor` matches four registered paths. Re-reading `update.anchor` for each match would
    // keep only the last one's ciphertext — collab's live code folds correctly and no isolated
    // test would catch the regression, which is why this one exists one layer up from the
    // planner's own accumulator test.
    const plan = codec.planUpdate(key, 'messages', 'm1', {
      anchor: { quote: 'q', prefix: 'p', suffix: 's', sectionTitle: 't', sectionId: 'keep' },
    });
    const written = plan.update.anchor as Record<string, string>;
    expect(written.sectionId).toBe('keep');
    for (const [field, plaintext] of [['quote', 'q'], ['prefix', 'p'], ['suffix', 's'], ['sectionTitle', 't']]) {
      expect(decryptField(key, `messages/m1.anchor.${field}`, written[field])).toBe(plaintext);
    }
  });

  it('passes a sentinel at an EXACT blob key through untouched — deleting a blob is legitimate', () => {
    class Sentinel {
      readonly kind = 'delete';
    }
    const sentinel = new Sentinel();
    const plan = codec.planUpdate(key, 'checkpoints', 'c1', { payload: sentinel });
    expect(plan.update.payload).toBe(sentinel);
    expect(plan.reseals).toEqual([]);
  });

  it('refuses a sentinel at an INSIDE key with BLOB_PARTIAL_UPDATE', () => {
    class Increment {
      readonly by = 1;
    }
    const err = thrown(() => codec.planUpdate(key, 'checkpoints', 'c1', {
      'payload.count': new Increment(),
    }));
    expect(err.code).toBe('BLOB_PARTIAL_UPDATE');
    expect(err.status).toBe(400);
    expect(err.message).toContain('none of them can be applied to a position inside a ciphertext');
    expect(err.details).toEqual({ collection: 'checkpoints', docId: 'c1', fieldPath: 'payload' });
  });

  it('refuses an update that is not an object', () => {
    expect(thrown(() => codec.planUpdate(key, 'messages', 'm1', null as unknown as Record<string, unknown>)).code)
      .toBe('VALIDATION_ERROR');
  });
});

describe('encryptUpdate — the convenience form', () => {
  it('returns the sealed update when no key reached inside a blob', () => {
    const out = codec.encryptUpdate(key, 'messages', 'm1', { body: 'b', status: 'open' });
    expect(out.status).toBe('open');
    expect(decryptField(key, 'messages/m1.body', out.body as string)).toBe('b');
  });

  it('throws BLOB_PARTIAL_UPDATE naming the whole-blob write path, so a lost update cannot ship', () => {
    const err = thrown(() => codec.encryptUpdate(key, 'checkpoints', 'build/epic-4', {
      'payload.checkins': [],
    }));
    expect(err.code).toBe('BLOB_PARTIAL_UPDATE');
    expect(err.message).toContain('"payload"');
    expect(err.message).toContain('planUpdate');
    expect(err.message).toContain('transaction');
  });

  it('planUpdate returns a request for exactly the key encryptUpdate refuses', () => {
    const update = { 'payload.checkins': [{ at: 1 }] };
    expect(thrown(() => codec.encryptUpdate(key, 'checkpoints', 'c1', update)).code)
      .toBe('BLOB_PARTIAL_UPDATE');
    expect(codec.planUpdate(key, 'checkpoints', 'c1', update).reseals).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// The eight real build call sites, as fixtures
// ---------------------------------------------------------------------------

describe('the eight live build update keys (§8.9), as fixtures', () => {
  const SITES: readonly {
    at: string; collection: 'deliverables' | 'checkpoints' | 'specEntities';
    docId: string; updateKey: string; fieldPath: string; subPath: string;
  }[] = [
    { at: 'CodeAnalysisService.ts:972', collection: 'deliverables', docId: 'd_12', updateKey: 'structuredContent.loopbackItems', fieldPath: 'structuredContent', subPath: 'loopbackItems' },
    { at: 'CodeAnalysisService.ts:995', collection: 'deliverables', docId: 'd_12', updateKey: 'structuredContent.loopbackItems', fieldPath: 'structuredContent', subPath: 'loopbackItems' },
    { at: 'CheckpointManagementService.ts:431', collection: 'checkpoints', docId: 'build/epic-4', updateKey: 'payload.checkins', fieldPath: 'payload', subPath: 'checkins' },
    { at: 'CheckpointManagementService.ts:432', collection: 'checkpoints', docId: 'build/epic-4', updateKey: 'payload.gitContext', fieldPath: 'payload', subPath: 'gitContext' },
    { at: 'CheckpointManagementService.ts:733', collection: 'checkpoints', docId: 'build/epic-4', updateKey: 'payload.checkins', fieldPath: 'payload', subPath: 'checkins' },
    { at: 'backfill-list-slots-to-group.ts:111', collection: 'specEntities', docId: 'blk_hero', updateKey: 'fields.contentSlots', fieldPath: 'fields', subPath: 'contentSlots' },
    { at: 'backfill-list-slots-to-group.ts:160', collection: 'specEntities', docId: 'blk_hero', updateKey: 'fields.composition', fieldPath: 'fields', subPath: 'composition' },
    { at: 'backfill-content-fill-v9.ts:100', collection: 'specEntities', docId: 'blk_hero', updateKey: 'fields.composition', fieldPath: 'fields', subPath: 'composition' },
  ];

  it.each(SITES)('$at — $updateKey becomes a set at $subPath', (site) => {
    const value = [{ id: 'x' }];
    const plan = codec.planUpdate(key, site.collection, site.docId, { [site.updateKey]: value });
    expect(plan.update).toEqual({});
    expect(plan.reseals).toHaveLength(1);
    expect(plan.reseals[0]).toEqual({
      collection: site.collection,
      docId: site.docId,
      fieldPath: site.fieldPath,
      aad: registry.aadFor(site.collection, site.docId, site.fieldPath),
      patches: [{ op: 'set', subPath: site.subPath, value }],
    });
  });

  it.each(SITES)('$at — the request patches the payload and reseals at the same AAD', (site) => {
    // `encryptDoc` is declared `<T extends object>(…): T` (§5.7), so the compiler still believes
    // a blob path holds its plaintext shape. It holds a ciphertext string, and the double cast
    // is that declared-vs-actual gap made visible rather than hidden behind a loose return type.
    const current = codec.encryptDoc(
      key, site.collection, site.docId, { [site.fieldPath]: { existing: true } },
    )[site.fieldPath] as unknown as string;
    const value = [{ id: 'x' }];
    const [req] = codec.planUpdate(key, site.collection, site.docId, { [site.updateKey]: value }).reseals;
    const resealed = applyBlobPatch(key, req, current);
    expect(decryptBlob(key, req.aad, resealed)).toEqual({ existing: true, [site.subPath]: value });
  });
});

describe('why the transaction is mandatory', () => {
  it('two keys into one blob produce two requests, and FOLDING keeps both where mapping loses one', () => {
    // §14.7's worked example, as an assertion. `for (const req of plan.reseals) out[fieldPath] =
    // applyBlobPatch(req, out[fieldPath] ?? snap.get(fieldPath))` — the accumulating read is what
    // makes the second reseal see the first's output.
    const aadDocId = 'build/epic-4';
    const stored = codec.encryptDoc(key, 'checkpoints', aadDocId, { payload: { checkins: [] } }).payload as unknown as string;
    const plan = codec.planUpdate(key, 'checkpoints', aadDocId, {
      'payload.checkins': [{ at: 1 }],
      'payload.gitContext': { sha: 'abc' },
    });
    expect(plan.reseals).toHaveLength(2);
    expect(new Set(plan.reseals.map((r) => r.fieldPath))).toEqual(new Set(['payload']));

    const out: Record<string, unknown> = { ...plan.update };
    for (const req of plan.reseals) {
      out[req.fieldPath] = applyBlobPatch(key, req, out[req.fieldPath] ?? stored);
    }
    expect(decryptBlob(key, 'phases/build/epic-4.payload', out.payload as string))
      .toEqual({ checkins: [{ at: 1 }], gitContext: { sha: 'abc' } });

    // The obvious mistake, and what it costs: each request applied to the STORED value keeps
    // only the last one's change.
    const mapped = plan.reseals.map((req) => applyBlobPatch(key, req, stored));
    expect(decryptBlob(key, 'phases/build/epic-4.payload', mapped[mapped.length - 1]))
      .toEqual({ checkins: [], gitContext: { sha: 'abc' } });
  });

  it('an append against a stale read differs from one against a fresh read — the reason reseals exist', () => {
    const aad = 'phases/build/epic-4.payload';
    const stale = codec.encryptDoc(key, 'checkpoints', 'build/epic-4', { payload: { checkins: ['a'] } }).payload as unknown as string;
    const req = codec.resealRequest('checkpoints', 'build/epic-4', 'payload', [
      { op: 'append', subPath: 'checkins', values: ['c'] },
    ]);
    const fresh = applyBlobPatch(key, req, stale); // somebody else's write landed first
    const afterFresh = applyBlobPatch(key, codec.resealRequest(
      'checkpoints', 'build/epic-4', 'payload', [{ op: 'append', subPath: 'checkins', values: ['d'] }],
    ), fresh);
    const afterStale = applyBlobPatch(key, codec.resealRequest(
      'checkpoints', 'build/epic-4', 'payload', [{ op: 'append', subPath: 'checkins', values: ['d'] }],
    ), stale);
    expect(decryptBlob(key, aad, afterFresh)).toEqual({ checkins: ['a', 'c', 'd'] });
    expect(decryptBlob(key, aad, afterStale)).toEqual({ checkins: ['a', 'd'] });
  });

  it('`resealRequest` refuses a path that is not a registered blob path, and builds the registry’s AAD', () => {
    expect(codec.resealRequest('checkpoints', 'build/epic-4', 'payload', []).aad)
      .toBe('phases/build/epic-4.payload');
    expect(thrown(() => codec.resealRequest('checkpoints', 'c1', 'nope', [])).code)
      .toBe('VALIDATION_ERROR');
  });
});

// ---------------------------------------------------------------------------
// §8.10 — the inside-key-to-subPath converter
// ---------------------------------------------------------------------------

describe('subPathForInsideKey', () => {
  const structuredContent = parseFieldPath('structuredContent');
  const payload = parseFieldPath('payload');

  it.each([
    ['structuredContent.loopbackItems.0.acknowledgedAt', 'loopbackItems[0].acknowledgedAt', structuredContent],
    ['payload.checkins.2.status', 'checkins[2].status', payload],
    ['payload.checkins', 'checkins', payload],
    ['payload.0', '[0]', payload],
  ] as const)('%s → %s', (updateKey, expected, segments) => {
    expect(subPathForInsideKey(updateKey, segments)).toBe(expected);
  });

  it('turns a numeric part into an INDEX, which is `matchUpdateKey`’s own rule applied to free-form data', () => {
    expect(subPathForInsideKey('payload.rows.10.name', payload)).toBe('rows[10].name');
  });

  it('leaves a non-canonical number as a KEY, because it is not a Firestore array index either', () => {
    // `01` and `1e3` are not indices in the subPath grammar, so treating them as one would emit
    // a subPath that will not parse — loud beats lossy.
    expect(subPathForInsideKey('payload.rows.01', payload)).toBe('rows.01');
    expect(subPathForInsideKey('payload.rows.1e3', payload)).toBe('rows.1e3');
  });

  it('quotes a segment the bare production cannot carry', () => {
    expect(subPathForInsideKey('payload.a`b', payload)).toBe('`a``b`');
  });

  it('refuses a key that does not reach inside the blob path', () => {
    expect(thrown(() => subPathForInsideKey('payload', payload)).code).toBe('VALIDATION_ERROR');
    expect(thrown(() => subPathForInsideKey('other.thing', payload)).code).toBe('VALIDATION_ERROR');
  });

  it('cannot address a numeric-looking OBJECT key — the ambiguity is Firestore’s, and inherited', () => {
    // `{"0": …}` and `[…]` produce the same dotted key, so this resolves to an index. A product
    // needing the object key writes the whole blob or builds the patch itself with a
    // backtick-quoted segment.
    expect(subPathForInsideKey('payload.0.name', payload)).toBe('[0].name');
  });
});

// ---------------------------------------------------------------------------
// Array elements, without their document
// ---------------------------------------------------------------------------

describe('encryptArrayValue / decryptArrayValue', () => {
  it('seals one element at the registered `[]` AAD, spelled with or without the brackets', () => {
    const withoutBrackets = codec.encryptArrayValue(key, 'topics', 't1', 'declinedProposals', 'x');
    const withBrackets = codec.encryptArrayValue(key, 'topics', 't1', 'declinedProposals[]', 'x');
    expect(decryptField(key, 'topics/t1.declinedProposals[]', withoutBrackets)).toBe('x');
    expect(decryptField(key, 'topics/t1.declinedProposals[]', withBrackets)).toBe('x');
  });

  it('opens an element pulled out of an array without its document', () => {
    const el = codec.encryptArrayValue(key, 'topics', 't1', 'declinedProposals', 'x');
    expect(codec.decryptArrayValue(key, 'topics', 't1', 'declinedProposals', el)).toBe('x');
  });

  it('is the same AAD the document walk uses, which is what makes arrayUnion possible', () => {
    const el = codec.encryptArrayValue(key, 'topics', 't1', 'declinedProposals', 'x');
    const doc = codec.decryptDoc(key, 'topics', 't1', { declinedProposals: [el] });
    expect(doc.declinedProposals).toEqual(['x']);
  });

  it('applies the strictness table to a bare element too', () => {
    expect(thrown(() => codec.decryptArrayValue(key, 'topics', 't1', 'declinedProposals', 'plain')).code)
      .toBe('CONTENT_PLAINTEXT_AT_REGISTERED_PATH');
    expect(lenientCodec.decryptArrayValue(key, 'topics', 't1', 'declinedProposals', 'plain'))
      .toBe('plain');
  });

  it('refuses a non-string plaintext at the boundary, where the "we passed the object" bug is', () => {
    expect(thrown(() => codec.encryptArrayValue(
      key, 'topics', 't1', 'declinedProposals', { a: 1 } as unknown as string,
    )).code).toBe('VALIDATION_ERROR');
  });
});

// ---------------------------------------------------------------------------
// openBlobAt
// ---------------------------------------------------------------------------

describe('openBlobAt', () => {
  it('opens one sealed blob by its registered path', () => {
    const sealed = codec.encryptDoc(key, 'checkpoints', 'build/epic-4', { payload: { checkins: ['a'] } });
    expect(codec.openBlobAt(key, 'checkpoints', 'build/epic-4', 'payload', sealed.payload))
      .toEqual({ checkins: ['a'] });
  });

  it('returns absence as absence: `undefined` and `null` are not payloads', () => {
    expect(codec.openBlobAt(key, 'checkpoints', 'c1', 'payload', undefined)).toBeUndefined();
    expect(codec.openBlobAt(key, 'checkpoints', 'c1', 'payload', null)).toBeNull();
  });

  it('is the same AAD `encryptDoc` sealed under, per document', () => {
    const sealed = codec.encryptDoc(key, 'checkpoints', 'build/epic-4', { payload: { a: 1 } });
    expect(thrown(() => codec.openBlobAt(key, 'checkpoints', 'build/epic-5', 'payload', sealed.payload)).code)
      .toBe('CONTENT_DECRYPT_FAILED');
  });
});

// ---------------------------------------------------------------------------
// The seam between the planner and the codec
// ---------------------------------------------------------------------------

describe('createDocPlanner and createDocCodec are one object', () => {
  it('the planner from the narrow factory is the codec’s own', () => {
    const one = createDocCodec(registry, scope);
    const plan = one.planDoc('projects', 'p1', { name: 'n' }, asNodeTransform((v) => v.toUpperCase()));
    expect(plan).toEqual(planDoc('projects', 'p1', { name: 'n' }, asNodeTransform((v) => v.toUpperCase())));
  });

  it('a plan is frozen, so a caller cannot edit the update it was handed', () => {
    const plan = planDoc('projects', 'p1', { name: 'n' }, shout());
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.update)).toBe(true);
  });

  it('the planner holds no key and does no crypto — the transform is the only thing that seals', () => {
    // Stated as an executable claim: a transform that returns what it was given produces no
    // ciphertext anywhere, whatever the mode of the path.
    const data = { body: 'b', attachments: [{ filename: 'f' }] };
    const plan = planDoc('messages', 'm1', data, (node) => node);
    expect(plan.update).toEqual({});
    expect(isEncrypted(data.body)).toBe(false);
  });

  it('a migration is re-runnable because skip is "return what you were given"', () => {
    // collab's migration transform, ported: seal what is not sealed, leave what is.
    const migrate = asNodeTransform((v, aad) => (isEncrypted(v) ? v : encryptField(key, aad, v)));
    const first = planDoc('projects', 'p1', { name: 'Alpha', description: 'd' }, migrate);
    expect(first.changed).toBe(2);
    const second = planDoc('projects', 'p1', { ...first.update }, migrate);
    expect(second.changed).toBe(0);
    expect(second.update).toEqual({});
    expect(second.visited).toBe(2);
  });
});
