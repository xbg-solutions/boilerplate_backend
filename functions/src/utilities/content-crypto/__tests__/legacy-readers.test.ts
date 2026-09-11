/**
 * The quarantine — spec §16.12's `legacy-readers.test.ts` row: the v1 and v2 field readers against
 * fixtures taken from collab's live shapes, the legacy object envelope, `legacyObjectAad`,
 * `legacyGenerationsIn` and `assertGeneration`; the §7.5 import-graph test; and the containment
 * asserted by importing the barrel — **no v1/v2 writer ships from any entrypoint.**
 *
 * The last two are the reason this file is not an ordinary module suite. Phase G deletes
 * `legacy-readers.ts`, and a deletion is only cheap if it is provably a LEAF: nothing above it may
 * import it, and it may import nothing that imports it back. That is a structural property, so it
 * is asserted structurally, from the first commit, before there is anything to violate it — a
 * structural test added later only ever encodes the drift it found.
 *
 * `scripts/check-mirror.js` assertion (6) asserts the same containment over the whole tree and is
 * the authority; this file asserts it again from inside the suite, because the two run at
 * different times and the one that runs on every `npm test` is this one.
 *
 * Mirrorable (§16.3): relative imports only; the tree is read from `__dirname/..`, which is the
 * mirrored root in BOTH trees, so no path literal reaches above it; no manifest is read; no clock,
 * no environment, no real randomness.
 */

import { openParts, sealParts } from '../cipher';
import { isContentCryptoError } from '../errors';
import { ENC_PREFIX_V1, ENC_PREFIX_V2, ENC_PREFIX_V3, encryptField } from '../field-codec';
import {
  LEGACY_GENERATION,
  assertGeneration,
  decryptLegacyField,
  isLegacyValue,
  legacyGenerationOf,
  legacyGenerationsIn,
  legacyObjectAad,
  legacyVersionOf,
  openLegacyObject,
  readLegacyObjectEnvelope,
} from '../legacy-readers';
import type { LegacyObjectEnvelope } from '../legacy-readers';
import { defineRegistry } from '../registry';
import { KEY_BYTES, dekFromBytes, recordKeyFromBytes } from '../secret';
import type { AccountDek } from '../secret';

// `node:fs` reaches this file through `require` rather than an import, and deliberately: the only
// non-relative specifiers permitted anywhere in this tree are four `node:` builtins
// (`check-mirror.js` assertion (5)), and `node:fs` is not one of them. The import-graph test below
// is the single reader of the source tree in the whole package, it runs identically in both trees,
// and confining it to one `require` is what keeps the permitted-import rule strict everywhere else.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { readdirSync, readFileSync, statSync } = require('node:fs') as typeof import('node:fs');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { join } = require('node:path') as typeof import('node:path');

const GEN_1 = Buffer.alloc(KEY_BYTES, 0x11);
const GEN_2 = Buffer.alloc(KEY_BYTES, 0x22);

const AAD = 'messages/abc.anchor.quote';
const OBJECT_PATH = 'projects/p1/topics/t1/attachments/m_4/9f2-brief.pdf';
const PREFIX = 'x-collab-';

const dekAt = (bytes: Buffer, generation: number): AccountDek =>
  dekFromBytes(bytes, `collab/acc_1@${generation}`);

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    if (isContentCryptoError(err)) return err.code;
    return `not a ContentCryptoError: ${String(err)}`;
  }
  return 'did not throw';
}

/**
 * THE FIXTURE WRITER. Five lines, inside `__tests__/`, and it cannot escape: `legacy-readers.ts`
 * exports no writer, the barrel exports no writer, and the test at the end of this file asserts
 * both. It builds what collab's store actually holds — an account DEK, no kind byte, the field
 * path as AAD.
 */
function legacyFixture(dek: AccountDek, aad: string, plaintext: string, generation?: number): string {
  const { iv, tag, ciphertext } = sealParts(dek, aad, Buffer.from(plaintext, 'utf8'));
  const parts = [iv.toString('base64'), ciphertext.toString('base64'), tag.toString('base64')].join(':');
  return generation === undefined ? `${ENC_PREFIX_V1}${parts}` : `${ENC_PREFIX_V2}${generation}:${parts}`;
}

/** The legacy object fixture: a body sealed under the BARE path, with its envelope metadata. */
function legacyObjectFixture(
  dek: AccountDek,
  path: string,
  body: string,
  version: 'v1' | 'v2',
  generation?: number,
): { custom: Record<string, string>; body: Buffer } {
  const { iv, tag, ciphertext } = sealParts(dek, legacyObjectAad(path), Buffer.from(body, 'utf8'));
  const custom: Record<string, string> = {
    [`${PREFIX}enc`]: version,
    [`${PREFIX}iv`]: iv.toString('base64'),
    [`${PREFIX}tag`]: tag.toString('base64'),
  };
  if (generation !== undefined) custom[`${PREFIX}keygen`] = String(generation);
  return { custom, body: ciphertext };
}

// ---------------------------------------------------------------------------
// The field readers
// ---------------------------------------------------------------------------

describe('the v1 and v2 field readers', () => {
  it('open a v1 value under generation 1, which is what the ABSENCE of a generation means', () => {
    const dek = dekAt(GEN_1, 1);
    const value = legacyFixture(dek, AAD, 'the original message');
    expect(legacyGenerationOf(value)).toBe(LEGACY_GENERATION);
    expect(LEGACY_GENERATION).toBe(1);
    expect(decryptLegacyField(dek, AAD, value)).toBe('the original message');
  });

  it('open a v2 value under the generation it names, which is why the generation is on the wire', () => {
    const value = legacyFixture(dekAt(GEN_2, 2), AAD, 'a later message', 2);
    expect(legacyGenerationOf(value)).toBe(2);
    expect(decryptLegacyField(dekAt(GEN_2, 2), AAD, value)).toBe('a later message');
  });

  it('fail the tag under the WRONG generation rather than returning something plausible', () => {
    const value = legacyFixture(dekAt(GEN_2, 2), AAD, 'a later message', 2);
    expect(codeOf(() => decryptLegacyField(dekAt(GEN_1, 1), AAD, value))).toBe('CONTENT_DECRYPT_FAILED');
  });

  it('bind the field path: a legacy value moved to another field fails, exactly as v3 does', () => {
    const dek = dekAt(GEN_1, 1);
    const value = legacyFixture(dek, AAD, 'secret');
    expect(codeOf(() => decryptLegacyField(dek, 'messages/abc.anchor.note', value))).toBe('CONTENT_DECRYPT_FAILED');
  });

  it('refuse a v3 value with WRONG_KEY_LAYER — a DEK must never be tried against record-key content', () => {
    const dek = dekAt(GEN_1, 1);
    const v3 = encryptField(recordKeyFromBytes(GEN_2, 'projects/p_1'), AAD, 'current');
    expect(codeOf(() => decryptLegacyField(dek, AAD, v3))).toBe('WRONG_KEY_LAYER');
  });

  it('refuse a plaintext or a malformed value with WRONG_KEY_LAYER, never by passing it through', () => {
    const dek = dekAt(GEN_1, 1);
    for (const value of ['a plain title', '', `${ENC_PREFIX_V1}not:really:legacy`, `${ENC_PREFIX_V3}x`]) {
      expect(codeOf(() => decryptLegacyField(dek, AAD, value))).toBe('WRONG_KEY_LAYER');
    }
  });

  it('classify: isLegacyValue and legacyVersionOf are false and null for v3, which is what the migration branches on', () => {
    const dek = dekAt(GEN_1, 1);
    const v1 = legacyFixture(dek, AAD, 'x');
    const v2 = legacyFixture(dek, AAD, 'x', 4);
    const v3 = encryptField(recordKeyFromBytes(GEN_2, 'projects/p_1'), AAD, 'x');

    expect([isLegacyValue(v1), isLegacyValue(v2), isLegacyValue(v3)]).toEqual([true, true, false]);
    expect([legacyVersionOf(v1), legacyVersionOf(v2), legacyVersionOf(v3)]).toEqual(['v1', 'v2', null]);
    expect([legacyGenerationOf(v1), legacyGenerationOf(v2), legacyGenerationOf(v3)]).toEqual([1, 4, null]);

    for (const junk of ['a title', '', null, undefined, 42, {}]) {
      expect(isLegacyValue(junk)).toBe(false);
      expect(legacyVersionOf(junk)).toBeNull();
      expect(legacyGenerationOf(junk)).toBeNull();
    }
  });

  it('are AAD-preserving: the SAME string opens the legacy value and seals the v3 one (§6.4)', () => {
    const dek = dekAt(GEN_1, 1);
    const recordKey = recordKeyFromBytes(GEN_2, 'projects/p_1');
    const aad = 'artefacts/t1/versions/v3.content';
    const plain = decryptLegacyField(dek, aad, legacyFixture(dek, aad, 'the artefact body', 1));
    expect(plain).toBe('the artefact body');
    // One AAD, two key layers. The migration moves the key layer and nothing else, which is why
    // collab's Phase C is a one-variable change.
    expect(encryptField(recordKey, aad, plain).startsWith(ENC_PREFIX_V3)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// legacyGenerationsIn — the prefetch
// ---------------------------------------------------------------------------

describe('legacyGenerationsIn', () => {
  const registry = defineRegistry({
    messages: { strings: ['anchor.quote', 'body', 'replies[].text'], blobs: ['payload'] },
  });
  const dek1 = dekAt(GEN_1, 1);
  const dek2 = dekAt(GEN_2, 2);

  it('names every generation a document holds, in one walk, including across an `[]` segment', () => {
    const data = {
      anchor: { quote: legacyFixture(dek1, 'messages/m1.anchor.quote', 'a') },
      body: legacyFixture(dek2, 'messages/m1.body', 'b', 2),
      replies: [
        { text: legacyFixture(dek2, 'messages/m1.replies[].text', 'c', 2) },
        { text: legacyFixture(dek1, 'messages/m1.replies[].text', 'd') },
      ],
    };
    expect([...legacyGenerationsIn(registry, 'messages', data)].sort()).toEqual([1, 2]);
  });

  it('returns two generations for a document written ACROSS a rotation, which is why it is a set', () => {
    const data = {
      body: legacyFixture(dek1, 'messages/m1.body', 'before', 1),
      anchor: { quote: legacyFixture(dek2, 'messages/m1.anchor.quote', 'after', 2) },
    };
    expect(legacyGenerationsIn(registry, 'messages', data).size).toBe(2);
  });

  it('is empty for a document that holds only v3 values, plaintext, or nothing at all', () => {
    const recordKey = recordKeyFromBytes(GEN_2, 'projects/p_1');
    expect(legacyGenerationsIn(registry, 'messages', {
      body: encryptField(recordKey, 'messages/m1.body', 'already migrated'),
      anchor: { quote: 'never encrypted' },
      replies: [],
    }).size).toBe(0);
    expect(legacyGenerationsIn(registry, 'messages', {}).size).toBe(0);
    expect(legacyGenerationsIn(registry, 'messages', undefined).size).toBe(0);
    expect(legacyGenerationsIn(registry, 'messages', null).size).toBe(0);
  });

  it('walks a registered BLOB path too, because a pre-serialised map there is a case migrateDoc must refuse WITH a key', () => {
    const data = { payload: legacyFixture(dek1, 'messages/m1.payload', '{"a":1}') };
    expect([...legacyGenerationsIn(registry, 'messages', data)]).toEqual([1]);
  });

  it('ignores unregistered paths entirely — a legacy-looking string elsewhere is not this walk’s business', () => {
    const data = { somethingElse: legacyFixture(dek1, 'messages/m1.body', 'x') };
    expect(legacyGenerationsIn(registry, 'messages', data).size).toBe(0);
  });

  it('does not mutate or rebuild the document it walks', () => {
    const replies = [{ text: legacyFixture(dek1, 'messages/m1.replies[].text', 'x') }];
    const data = { replies };
    legacyGenerationsIn(registry, 'messages', data);
    expect(data.replies).toBe(replies);
    expect(data.replies[0].text).toBe(replies[0].text);
  });
});

// ---------------------------------------------------------------------------
// The legacy object envelope
// ---------------------------------------------------------------------------

describe('the legacy object envelope', () => {
  const dek = dekAt(GEN_1, 1);

  it('is the BARE object path as AAD, which is the one AAD that genuinely changes across the hop', () => {
    expect(legacyObjectAad(OBJECT_PATH)).toBe(OBJECT_PATH);
    expect(codeOf(() => legacyObjectAad(''))).toBe('VALIDATION_ERROR');
    expect(codeOf(() => legacyObjectAad(undefined as unknown as string))).toBe('VALIDATION_ERROR');
  });

  it('round-trips a v2 object body under the generation its metadata names', () => {
    const { custom, body } = legacyObjectFixture(dek, OBJECT_PATH, 'a small pdf', 'v2', 1);
    const env = readLegacyObjectEnvelope(PREFIX, custom);
    expect(env).not.toBeNull();
    expect(env?.enc).toBe('v2');
    expect(env?.generation).toBe(1);
    expect(env?.prefix).toBe(PREFIX);
    expect(openLegacyObject(dek, legacyObjectAad(OBJECT_PATH), env as LegacyObjectEnvelope, body).toString('utf8')).toBe('a small pdf');
  });

  it('reads a v1 object with NO keygen key as generation 1 — the absence IS generation 1', () => {
    const { custom, body } = legacyObjectFixture(dek, OBJECT_PATH, 'an older pdf', 'v1');
    const env = readLegacyObjectEnvelope(PREFIX, custom);
    expect(env?.generation).toBe(LEGACY_GENERATION);
    expect(openLegacyObject(dek, legacyObjectAad(OBJECT_PATH), env as LegacyObjectEnvelope, body).toString('utf8')).toBe('an older pdf');
  });

  it('returns null when the marker is absent, because what a PLAINTEXT object means is the product’s decision', () => {
    expect(readLegacyObjectEnvelope(PREFIX, {})).toBeNull();
    expect(readLegacyObjectEnvelope(PREFIX, { [`${PREFIX}enc`]: '' })).toBeNull();
    expect(readLegacyObjectEnvelope(PREFIX, { 'content-type': 'application/pdf' })).toBeNull();
    expect(readLegacyObjectEnvelope(PREFIX, undefined as unknown as Record<string, string>)).toBeNull();
  });

  it('never returns bytes for a marked-but-broken object — the three refusals collab found the hard way', () => {
    const { custom } = legacyObjectFixture(dek, OBJECT_PATH, 'x', 'v2', 1);

    const unknownVersion = { ...custom, [`${PREFIX}enc`]: 'v9' };
    expect(codeOf(() => readLegacyObjectEnvelope(PREFIX, unknownVersion))).toBe('CONTENT_DECRYPT_FAILED');

    const v3Marker = { ...custom, [`${PREFIX}enc`]: 'v3' };
    expect(codeOf(() => readLegacyObjectEnvelope(PREFIX, v3Marker))).toBe('CONTENT_DECRYPT_FAILED');

    const noGeneration = { ...custom };
    delete noGeneration[`${PREFIX}keygen`];
    expect(codeOf(() => readLegacyObjectEnvelope(PREFIX, noGeneration))).toBe('CONTENT_DECRYPT_FAILED');

    const noIv = { ...custom };
    delete noIv[`${PREFIX}iv`];
    expect(codeOf(() => readLegacyObjectEnvelope(PREFIX, noIv))).toBe('CONTENT_DECRYPT_FAILED');

    const noTag = { ...custom };
    delete noTag[`${PREFIX}tag`];
    expect(codeOf(() => readLegacyObjectEnvelope(PREFIX, noTag))).toBe('CONTENT_DECRYPT_FAILED');
  });

  it('refuses an IV or tag that is not base64 at all, which Buffer.from would otherwise decode to nothing', () => {
    const { custom } = legacyObjectFixture(dek, OBJECT_PATH, 'x', 'v2', 1);
    expect(codeOf(() => readLegacyObjectEnvelope(PREFIX, { ...custom, [`${PREFIX}iv`]: '!!!' }))).toBe('CONTENT_DECRYPT_FAILED');
    expect(codeOf(() => readLegacyObjectEnvelope(PREFIX, { ...custom, [`${PREFIX}tag`]: '!!!' }))).toBe('CONTENT_DECRYPT_FAILED');
  });

  it('refuses an invalid generation rather than defaulting to the current one', () => {
    const { custom } = legacyObjectFixture(dek, OBJECT_PATH, 'x', 'v2', 1);
    for (const keygen of ['0', '-1', 'abc', '1.5']) {
      expect(codeOf(() => readLegacyObjectEnvelope(PREFIX, { ...custom, [`${PREFIX}keygen`]: keygen }))).toBe('CONTENT_DECRYPT_FAILED');
    }
  });

  it('needs the product’s metadata prefix: a product with no legacy block has no legacy objects to read', () => {
    const { custom } = legacyObjectFixture(dek, OBJECT_PATH, 'x', 'v2', 1);
    expect(codeOf(() => readLegacyObjectEnvelope('', custom))).toBe('VALIDATION_ERROR');
    // Another product's prefix simply does not find a marker, which is the one-bucket-per-product
    // boundary expressed in the crypto rather than in the rules.
    expect(readLegacyObjectEnvelope('x-other-', custom)).toBeNull();
  });

  it('binds the object path: the same body at another path fails, and so does a tampered body', () => {
    const { custom, body } = legacyObjectFixture(dek, OBJECT_PATH, 'a small pdf', 'v2', 1);
    const env = readLegacyObjectEnvelope(PREFIX, custom) as LegacyObjectEnvelope;
    expect(codeOf(() => openLegacyObject(dek, legacyObjectAad('projects/p1/other.pdf'), env, body))).toBe('CONTENT_DECRYPT_FAILED');

    const tampered = Buffer.from(body);
    tampered[0] ^= 0xff;
    expect(codeOf(() => openLegacyObject(dek, legacyObjectAad(OBJECT_PATH), env, tampered))).toBe('CONTENT_DECRYPT_FAILED');
  });

  it('refuses an absent envelope rather than reaching into undefined', () => {
    expect(codeOf(() => openLegacyObject(dek, legacyObjectAad(OBJECT_PATH), null as unknown as LegacyObjectEnvelope, Buffer.alloc(4)))).toBe('VALIDATION_ERROR');
  });
});

// ---------------------------------------------------------------------------
// assertGeneration
// ---------------------------------------------------------------------------

describe('assertGeneration', () => {
  it('accepts a positive integer of at most nine digits', () => {
    for (const generation of [1, 2, 42, 999999999]) {
      expect(() => assertGeneration(generation)).not.toThrow();
    }
  });

  it('refuses everything else, naming the offender in the message and never in a widened detail key', () => {
    for (const generation of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 1_000_000_000, '1', null, undefined, {}]) {
      expect(codeOf(() => assertGeneration(generation))).toBe('VALIDATION_ERROR');
    }
  });
});

// ---------------------------------------------------------------------------
// The containment: no writer, anywhere
// ---------------------------------------------------------------------------

describe('no v1 or v2 WRITER ships from any entrypoint', () => {
  const WRITER = /encryptValueV1|encryptV2|sealV1|encryptLegacy|sealLegacy|writeLegacy/;

  it('the module exports readers only', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const legacy = require('../legacy-readers') as Record<string, unknown>;
    expect(Object.keys(legacy).filter((name) => WRITER.test(name))).toEqual([]);
  });

  it('the barrel exports none either, which is the surface a product can actually reach', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const barrel = require('../index') as Record<string, unknown>;
    expect(Object.keys(barrel).filter((name) => WRITER.test(name))).toEqual([]);
  });

  it('and the fixture writer in this file is the only one, which is why it lives here', () => {
    const fixture = legacyFixture(dekAt(GEN_1, 1), AAD, 'x');
    expect(fixture.startsWith(ENC_PREFIX_V1)).toBe(true);
    // It is a composition of `sealParts` and string concatenation: nothing in the package knows
    // how to produce this shape, and nothing outside `__tests__/` can reach this function.
    const parts = fixture.slice(ENC_PREFIX_V1.length).split(':');
    expect(openParts(dekAt(GEN_1, 1), AAD, Buffer.from(parts[0], 'base64'), Buffer.from(parts[2], 'base64'), Buffer.from(parts[1], 'base64')).toString('utf8')).toBe('x');
  });
});

// ---------------------------------------------------------------------------
// The import-graph test — §7.5, with clause 3 as the addendum corrects it
// ---------------------------------------------------------------------------

describe('the Phase-G deletion is provably a leaf', () => {
  /** The mirrored root, in both trees. `__dirname` is `<root>/__tests__`. */
  const SRC = join(__dirname, '..');

  /** Every `.ts` file under the mirrored root, as a path relative to it. */
  function sourceFiles(dir: string = SRC, base = ''): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir).sort()) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) out.push(...sourceFiles(full, base ? `${base}/${entry}` : entry));
      else if (entry.endsWith('.ts')) out.push(base ? `${base}/${entry}` : entry);
    }
    return out;
  }

  /**
   * Comments removed, string literals retained — `check-mirror.js` calls this view TEXT and its
   * lexer is the authority. This is the modest version: block comments and whole-line `//`
   * comments, which is what a docblock is. It may leave a trailing comment behind, so a file that
   * mentions a legacy prefix in a trailing comment fails here and passes there; the answer to that
   * is to write the docblock above the line, which every file in this tree already does.
   */
  function text(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  }

  /** (specifier, names) of every import/export-from declaration. */
  function importsOf(source: string): { specifier: string; names: string[] }[] {
    const found: { specifier: string; names: string[] }[] = [];
    const re = /(?:^|[\n;])\s*(?:import|export)\b([\s\S]*?)\bfrom\s*['"]([^'"]+)['"]/g;
    let match: RegExpExecArray | null = re.exec(source);
    while (match !== null) {
      const braced = match[1].match(/\{([\s\S]*)\}/);
      const names = (braced ? braced[1] : match[1])
        .split(',')
        .map((part) => part.replace(/\btype\b/g, '').trim())
        .filter((name) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name));
      found.push({ specifier: match[2], names });
      match = re.exec(source);
    }
    return found;
  }

  const tree = new Map<string, string>(sourceFiles().map((f) => [f, text(readFileSync(join(SRC, f), 'utf8'))]));

  it('reads the whole tree from the mirrored root, so this test is not accidentally vacuous', () => {
    expect(tree.size).toBeGreaterThan(6);
    expect([...tree.keys()]).toContain('legacy-readers.ts');
    expect([...tree.keys()]).toContain('__tests__/legacy-readers.test.ts');
  });

  it('clause 1 — only content-crypto.ts, object-envelope.ts and index.ts may import ./legacy-readers', () => {
    const permitted = new Set(['content-crypto.ts', 'object-envelope.ts', 'index.ts', 'legacy-readers.ts']);
    const offenders: string[] = [];
    for (const [file, source] of tree) {
      if (file.startsWith('__tests__/')) continue;
      if (permitted.has(file)) continue;
      for (const imp of importsOf(source)) {
        if (/(^|\/)legacy-readers$/.test(imp.specifier)) offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('clause 2 — the legacy wire literals live in field-codec.ts and its test, and the object prefix in this module and its test', () => {
    const owners: Record<string, readonly string[]> = {
      [ENC_PREFIX_V1]: ['field-codec.ts', '__tests__/field-codec.test.ts', '__tests__/legacy-readers.test.ts'],
      [ENC_PREFIX_V2]: ['field-codec.ts', '__tests__/field-codec.test.ts', '__tests__/legacy-readers.test.ts'],
      [PREFIX]: ['legacy-readers.ts', '__tests__/legacy-readers.test.ts'],
    };
    const offenders: string[] = [];
    for (const [literal, permitted] of Object.entries(owners)) {
      for (const [file, source] of tree) {
        // PRODUCTION modules only, here. `check-mirror.js` assertion (6) runs the same scan over
        // the whole tree including test files and is the authority; this copy exists so that a
        // module putting a legacy prefix back where it does not belong fails on `npm test`,
        // where a crypto author will see it, and it deliberately does not duplicate the gate's
        // jurisdiction over other suites' fixtures.
        if (file.startsWith('__tests__/')) continue;
        if (permitted.includes(file)) continue;
        if (source.includes(literal)) offenders.push(`${file} contains ${literal}`);
      }
    }
    // Note what this says about THIS module: the literals are NOT here. `legacy-readers.ts`
    // re-exports them from `field-codec.ts`, because a v1 reader is not a v1 prefix, and every
    // wire prefix lives in one file.
    expect(offenders).toEqual([]);
  });

  it('clause 3 — legacy-readers.ts imports downward only, from the seven modules the addendum permits', () => {
    const permitted = new Set(['./cipher', './aad', './errors', './field-path', './field-codec', './registry', './secret']);
    const source = tree.get('legacy-readers.ts');
    expect(source).toBeDefined();
    const specifiers = importsOf(source as string).map((imp) => imp.specifier);
    expect(specifiers.filter((s) => !permitted.has(s))).toEqual([]);
  });

  it('clause 3, the other half — no module legacy-readers.ts imports imports it back', () => {
    const source = tree.get('legacy-readers.ts') as string;
    const imported = importsOf(source).map((imp) => imp.specifier.replace(/^\.\//, ''));
    const cycles: string[] = [];
    for (const name of imported) {
      const file = `${name}.ts`;
      const dependency = tree.get(file);
      if (dependency === undefined) continue;
      for (const imp of importsOf(dependency)) {
        if (/(^|\/)legacy-readers$/.test(imp.specifier)) cycles.push(file);
      }
    }
    expect(cycles).toEqual([]);
  });

  it('so the deletion is a `git rm` plus three known edits, and this test is what says so', () => {
    // The four assertions above are the whole of §7.5's containment claim. If one of them ever
    // goes red, the deletion condition in `legacy-readers.ts`'s own docblock has stopped being
    // true, and the right response is to restore the containment rather than to widen the list.
    // Read RAW rather than through `text()`: the deletion condition is a comment, which is the
    // whole point — it is written where somebody deleting the file will read it.
    expect(readFileSync(join(SRC, 'legacy-readers.ts'), 'utf8')).toContain('DELETE THIS FILE AT PHASE G');
  });
});
