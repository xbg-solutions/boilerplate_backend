/**
 * `non-plain-document.test.ts` — the silent-plaintext regression of 2026-09-16.
 *
 * Reported by a consumer, who found it through a test double and had guarded
 * against it on their own side:
 *
 *   > The package only encrypts inside objects whose `constructor === Object`.
 *   > A class instance, or an object from another JavaScript realm (e.g.
 *   > `structuredClone` under Jest), is skipped with no error, even in strict
 *   > mode, so a write would store plaintext.
 *
 * It is exactly right, and the shape of the failure is the worst one this
 * package can have: `encryptDoc` returned the document UNCHANGED and reported
 * success, so the caller stored the value it was holding. No error, no
 * `WRONG_KEY_LAYER`, nothing in strict mode — the seam did nothing and said it
 * had worked.
 *
 * Three objects failed `constructor === Object`, and they are not one problem:
 *
 *   - **another realm's plain object** — plain data, different `Object`;
 *   - **a null-prototype object** — plain data, no constructor at all;
 *   - **a class instance** — NOT plain data, and the reason the original rule
 *     was written: a Firestore `FieldValue` is a class instance, and walking
 *     one would mangle a sentinel.
 *
 * So the fix is not "widen it". The first two are now walked, because they are
 * documents; the third is now REFUSED, because it cannot be walked and must not
 * be mistaken for one. Silence was never a third option.
 *
 * Mirrorable under §16.3: relative imports only, no `../../`, no wall clock.
 */

import { ContentCryptoError } from '../errors';
import { isEncrypted } from '../field-codec';
import { resolveScope } from '../key-scope';
import type { ContentKeyScope } from '../key-scope';
import { defineRegistry } from '../registry';
import { KEY_BYTES, recordKeyFromBytes } from '../secret';
import type { RecordKey } from '../secret';
import { createDocCodec } from '../doc-codec';

const key: RecordKey = recordKeyFromBytes(Buffer.alloc(KEY_BYTES, 0xc3), 'projects/p_1');

const registry = defineRegistry({
  projects: { strings: ['name'] },
  /** A blob, because the same realm-sensitive test sat at a blob root and inside one. */
  payloads: { blobs: ['body'] },
});

const scope: ContentKeyScope<'project'> = { productId: 'collab', records: { project: 'aggregate' } };
const codec = createDocCodec(registry, resolveScope(scope, registry));
const lenient = createDocCodec(registry, resolveScope({ ...scope, reads: 'lenient' }, registry));

/** The payload every case below carries, so a failure names itself in the diff. */
const SECRET = 'SECRET PAYLOAD';

/**
 * An object shaped as another realm's plain object: a prototype that is not OUR
 * `Object.prototype`, carrying a `constructor` that is a different function named
 * `Object`. Built by hand rather than with `vm`, so the witness is the same on every
 * runtime and cannot quietly stop being cross-realm. `structuredClone` is the real-world
 * case and is tested beside it, with its precondition asserted.
 */
function fromAnotherRealm(): Record<string, unknown> {
  const foreignObject = function Object(): void { /* another realm's constructor */ };
  const proto = globalThis.Object.create(null) as object;
  globalThis.Object.defineProperty(proto, 'constructor', { value: foreignObject });
  const out = globalThis.Object.create(proto) as Record<string, unknown>;
  out.name = SECRET;
  return out;
}

describe('a document that is not a `constructor === Object` object', () => {
  it('SEALS an object from another realm — it was stored as plaintext', () => {
    const doc = fromAnotherRealm();
    expect(doc.constructor).not.toBe(Object); // the precondition, stated
    const out = codec.encryptDoc(key, 'projects', 'p_1', doc);
    expect(isEncrypted(out.name)).toBe(true);
    expect(out.name).not.toBe(SECRET);
    expect(codec.decryptDoc(key, 'projects', 'p_1', out).name).toBe(SECRET);
  });

  it('SEALS `structuredClone` output, which is how the consumer hit it', () => {
    const doc = structuredClone({ name: SECRET }) as Record<string, unknown>;
    expect(doc.constructor).not.toBe(Object); // the precondition, stated
    const out = codec.encryptDoc(key, 'projects', 'p_1', doc);
    expect(isEncrypted(out.name)).toBe(true);
    expect(codec.decryptDoc(key, 'projects', 'p_1', out).name).toBe(SECRET);
  });

  it('SEALS a null-prototype object', () => {
    const doc = Object.create(null) as Record<string, unknown>;
    doc.name = SECRET;
    const out = codec.encryptDoc(key, 'projects', 'p_1', doc);
    expect(isEncrypted(out.name)).toBe(true);
    expect(codec.decryptDoc(key, 'projects', 'p_1', out).name).toBe(SECRET);
  });

  it('REFUSES a class instance rather than skipping it', () => {
    class ProjectRow {
      name = SECRET;
    }
    let caught: unknown;
    try {
      codec.encryptDoc(key, 'projects', 'p_1', new ProjectRow());
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ContentCryptoError);
    expect((caught as ContentCryptoError).code).toBe('VALIDATION_ERROR');
    expect((caught as ContentCryptoError).message).toContain('ProjectRow');
    // The message must not carry the value it refused to seal.
    expect((caught as ContentCryptoError).message).not.toContain(SECRET);
  });

  it('refuses a class instance in LENIENT mode too — leniency forgives plaintext, not an unwalkable document', () => {
    class ProjectRow {
      name = SECRET;
    }
    expect(() => lenient.encryptDoc(key, 'projects', 'p_1', new ProjectRow())).toThrow(ContentCryptoError);
    expect(() => lenient.decryptDoc(key, 'projects', 'p_1', new ProjectRow())).toThrow(ContentCryptoError);
  });

  it('refuses a Date and a Buffer, which reach the walk only by mistake', () => {
    expect(() => codec.encryptDoc(key, 'projects', 'p_1', new Date(0))).toThrow(/only a plain object/);
    expect(() => codec.encryptDoc(key, 'projects', 'p_1', Buffer.from('x'))).toThrow(/only a plain object/);
  });

  it('refuses an object whose `constructor` getter throws, without throwing from the error path', () => {
    const hostile = Object.create(
      Object.defineProperty({}, 'constructor', {
        get() {
          throw new Error('no');
        },
      }),
    ) as Record<string, unknown>;
    hostile.name = SECRET;
    // Prototype depth is 2, so it is not plain; the message falls back rather than rethrowing.
    const run = (): unknown => codec.encryptDoc(key, 'projects', 'p_1', hostile);
    expect(run).toThrow(ContentCryptoError);
    expect(run).toThrow(/non-plain object/);
  });

  it('SEALS a blob whose payload came from another realm — it was REFUSED as unencodable', () => {
    // Loud, not silent: `BLOB_ENCODE_FAILED` rather than stored plaintext, so this half
    // was never a leak. It was still a refusal on ordinary data, from the same cause.
    const doc = { body: structuredClone({ note: SECRET, nested: { deep: [1, 2] } }) };
    const out = codec.encryptDoc(key, 'payloads', 'b_1', doc);
    expect(typeof out.body).toBe('string');
    expect(out.body).not.toContain(SECRET);
    expect(codec.decryptDoc(key, 'payloads', 'b_1', out).body).toEqual({
      note: SECRET, nested: { deep: [1, 2] },
    });
  });

  it('still refuses a class instance INSIDE a blob, where it has no encoding', () => {
    class Row {
      note = SECRET;
    }
    expect(() => codec.encryptDoc(key, 'payloads', 'b_1', { body: { row: new Row() } }))
      .toThrow(/Row/);
  });

  it('still yields an empty plan for a deleted row — absence was never the bug', () => {
    expect(() => codec.encryptDoc(key, 'projects', 'p_1', undefined as unknown as object)).not.toThrow();
    expect(() => codec.decryptDoc(key, 'projects', 'p_1', null as unknown as object)).not.toThrow();
  });
});
