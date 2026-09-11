#!/usr/bin/env node
/**
 * The mirror gate for `@xbg.solutions/utils-content-crypto`, and the generator that
 * repairs it. Two modes, one tool:
 *
 *   node scripts/check-mirror.js            # --check (the default): twelve assertions
 *   node scripts/check-mirror.js --check
 *   node scripts/check-mirror.js --write    # regenerate the mirror; see scripts/sync-mirror.js
 *
 * WHY ONE TOOL. The checker and the generator share the file list, the two tree roots and
 * the definition of "identical". Two programs holding two copies of that is the drift this
 * script exists to catch, arriving in the tooling. `scripts/sync-mirror.js` stays as a
 * separate entry point because the *npm wiring* must stay separate: `mirror:check` runs
 * inside `npm test`, `mirror:sync` runs when a human asks for it and is hooked to no build
 * and no test. A sync that ran automatically would repair the drift before the check could
 * report it — the failure mode of every "format on commit" arrangement, where the signal
 * disappears along with the symptom.
 *
 * WHY THIS PACKAGE AND NO OTHER. Measured on 2026-09-10: of twenty-three mirrors under
 * `functions/src/utilities/`, three hold and twenty have drifted, and the drift is not
 * import paths — `utils-hashing`'s mirror is a feature behind and its test still asserts a
 * shape the package stopped using. A mirror maintained by a rule in a docblock does not
 * hold. So for THIS package only, `functions/src/utilities/content-crypto/` is a generated,
 * byte-identical copy of `packages/utils-content-crypto/src/`: the package tree is the
 * source, the mirror is an artefact that happens to be committed, and editing the mirror by
 * hand is a CI failure. The rule is not retrofitted to the other twenty-two.
 *
 * EVERY failure is printed, never just the first — the lesson `scripts/build.js` records in
 * its own docblock. Exit status is 1 if any assertion failed.
 *
 * The twelve assertions are the CORRECTED wording of the Phase A corrections addendum §5,
 * not the earlier draft: three of the earlier twelve were red against the source they were
 * meant to guard, and a gate that is red on the commit introducing the code it guards gets
 * weakened rather than fixed. Each assertion below names the view of the source it uses.
 */
'use strict';

const {
  readdirSync, readFileSync, existsSync, statSync, rmSync, mkdirSync, copyFileSync,
} = require('node:fs');
const { join, relative, resolve, dirname } = require('node:path');

const ROOT = join(__dirname, '..');
const PKG_DIR = join(ROOT, 'packages', 'utils-content-crypto');
const PKG_SRC = join(PKG_DIR, 'src');
const FUNCTIONS_SRC = join(ROOT, 'functions', 'src');
const MIRROR_DIR = join(FUNCTIONS_SRC, 'utilities', 'content-crypto');

const rel = (p) => relative(ROOT, p);

// ---------------------------------------------------------------------------
// The manifest. Listed, never globbed: a glob would happily accept a deletion.
// ---------------------------------------------------------------------------

/** The 23 modules of §3, in the spec's order. Nothing else may exist in `src/`. */
const MODULES = [
  'errors.ts',
  'secret.ts',
  'aad.ts',
  'field-path.ts',
  'registry.ts',
  'key-scope.ts',
  'cipher.ts',
  'field-codec.ts',
  'blob-json.ts',
  'blob-codec.ts',
  'record-key.ts',
  'wrap-patch.ts',
  'object-envelope.ts',
  'custodian.ts',
  'custodian-cache.ts',
  'key-store.ts',
  'key-lifecycle.ts',
  'doc-codec.ts',
  'content-crypto.ts',
  'walk.ts',
  'legacy-readers.ts',
  'testing.ts',
  'index.ts',
];

/**
 * The seven cross-cutting suites of §16.2. They are nobody's module, by design.
 *
 * A CLOSED SET OF NAMES, not a count: nothing anywhere hard-codes seven, and adding one is a
 * deliberate edit to this list — which is the review the manifest exists to force. `durability.ts`
 * is the newest (R10a) and is genuinely cross-cutting: the kill-between property exercises
 * `content-crypto` + `record-key` + `doc-codec` + `object-envelope` together, over a store, and
 * belongs to none of them.
 */
const CROSS_CUTTING_SUITES = [
  'aad-injectivity.test.ts',
  'tamper.test.ts',
  'shred.test.ts',
  'equivalence.test.ts',
  'aggregate-root.test.ts',
  'leak.test.ts',
  'durability.test.ts',
];

/** The only non-relative specifiers permitted anywhere in the tree (§3, R3). */
const PERMITTED_BUILTINS = ['node:crypto', 'node:zlib', 'node:util', 'node:stream'];

/** The only `exports` conditions the manifest may resolve (§15.5). */
const PERMITTED_EXPORTS = ['.', './testing', './package.json'];

/**
 * Assertion (3)'s identifier list. Matched as whole identifier tokens, so
 * `firestoreTimestampAdapter` is not `firestore` and the adapter needs no special case —
 * the exemption below is written down anyway, because the assertion names it and a reader
 * should not have to re-derive that word boundaries already cover it.
 */
const FORBIDDEN_IDENTIFIERS = new Set([
  'firebase', 'FieldValue', 'Firestore', 'firestore', 'kms', 'Kms', 'KMS', 'admin',
]);
const IDENTIFIER_EXEMPTIONS = {
  // The one Firestore-shaped thing the package is allowed to name: the adapter a product
  // passes in so a `Timestamp` is REFUSED rather than coerced, and the adapter's parameter.
  'blob-json.ts': new Set(['firestoreTimestampAdapter', 'Timestamp']),
};

/** Assertion (12): the whole configuration surface of the package, and where each is read. */
const PERMITTED_ENV = {
  CONTENT_KEY_GRACE_MS: 'key-scope.ts',
  K_SERVICE: 'testing.ts',
  FUNCTIONS_EMULATOR: 'testing.ts',
  BLOB_FUZZ_SEEDS: 'blob-json.test.ts',
};

const ASSERTION_TITLES = {
  1: 'byte identity between the package tree and its mirror',
  2: 'the 23-module manifest and its 30 suites',
  3: 'no Firestore, KMS or firebase identifier anywhere',
  4: 'nothing outside the mirror deep-imports the mirror',
  5: 'zero dependencies, node: builtins only, three exports',
  6: 'the legacy quarantine is a leaf',
  7: 'the production barrel exports no key accessor, v1/v2 writer or test helper',
  8: 'testing.ts does not import the lifecycle',
  9: 'every test is mirrorable',
  10: 'one code path — granularity is compared in one file',
  11: 'the cache never touches an error message',
  12: 'the package reads four environment variables and no others',
};

// ---------------------------------------------------------------------------
// The scanning vocabulary, defined once. An assertion that cannot say whether it is
// looking at code or at prose is an assertion that gets switched off.
//
//   CODE(f)     comments removed, every string/template literal replaced by an empty one,
//               EXCEPT an import/export/require module specifier, which is kept.
//   TEXT(f)     comments removed, string literals retained.
//   IMPORTS(f)  (specifier, names, typeOnly) parsed from import / export-from declarations.
//
// Both views preserve byte offsets — a stripped region becomes spaces, never nothing — so a
// match's line number is the line number in the file a human will open.
// ---------------------------------------------------------------------------

const REGEX_PRECEDING_KEYWORDS = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'do', 'else',
  'case', 'yield', 'await',
]);

/**
 * One pass over the source. Returns the comment-stripped text (same length) and the ranges
 * of every string and template-literal chunk. Template expressions (`${…}`) are NOT part of
 * a chunk: they are code, and code hidden inside an interpolation is exactly what assertion
 * (3) must still see. Regular-expression literals are code too, and are stepped over so a
 * quote inside a character class cannot desynchronise the scanner.
 */
function lex(src) {
  const out = src.split('');
  const strings = [];
  const n = src.length;
  let i = 0;
  let prev = '';           // last significant character of code seen
  let prevWord = '';       // last identifier of code seen, for regex-vs-division
  // Template state: a stack, because `${`…`}` can nest templates inside expressions.
  const templates = [];    // { chunkStart, braceDepth }
  const blank = (from, to) => {
    for (let j = from; j < to && j < n; j++) if (out[j] !== '\n') out[j] = ' ';
  };

  while (i < n) {
    const inTemplate = templates.length > 0 && templates[templates.length - 1].braceDepth === 0;

    if (inTemplate) {
      const top = templates[templates.length - 1];
      const c = src[i];
      if (c === '\\') { i += 2; continue; }
      if (c === '`') {
        strings.push({ start: top.chunkStart, end: i });
        templates.pop();
        prev = '`'; prevWord = '';
        i += 1; continue;
      }
      if (c === '$' && src[i + 1] === '{') {
        strings.push({ start: top.chunkStart, end: i - 1 });
        top.braceDepth = 1;
        i += 2; prev = '{'; prevWord = '';
        continue;
      }
      i += 1; continue;
    }

    const c = src[i];
    const c2 = src[i + 1];

    if (c === '/' && c2 === '/') {
      let j = i; while (j < n && src[j] !== '\n') j++;
      blank(i, j); i = j; continue;
    }
    if (c === '/' && c2 === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      blank(i, stop); i = stop; continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === c) break;
        if (src[j] === '\n') break;   // unterminated; stop at the line end rather than run away
        j += 1;
      }
      strings.push({ start: i, end: j });
      i = j + 1; prev = c; prevWord = '';
      continue;
    }
    if (c === '`') {
      templates.push({ chunkStart: i, braceDepth: 0 });
      i += 1; continue;
    }
    if (c === '/' && regexAllowed(prev, prevWord)) {
      let j = i + 1; let inClass = false;
      while (j < n) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === '[') inClass = true;
        else if (src[j] === ']') inClass = false;
        else if (src[j] === '/' && !inClass) break;
        else if (src[j] === '\n') break;
        j += 1;
      }
      i = j + 1; prev = '/'; prevWord = '';
      continue;
    }

    if (templates.length > 0) {
      const top = templates[templates.length - 1];
      if (c === '{') top.braceDepth += 1;
      else if (c === '}') {
        top.braceDepth -= 1;
        if (top.braceDepth === 0) { top.chunkStart = i; i += 1; continue; }
      }
    }

    if (/[A-Za-z0-9_$]/.test(c)) {
      let j = i; while (j < n && /[A-Za-z0-9_$]/.test(src[j])) j++;
      prevWord = src.slice(i, j); prev = src[j - 1];
      i = j; continue;
    }
    if (!/\s/.test(c)) { prev = c; prevWord = ''; }
    i += 1;
  }

  return { stripped: out.join(''), strings };
}

function regexAllowed(prev, prevWord) {
  if (prevWord) return REGEX_PRECEDING_KEYWORDS.has(prevWord);
  if (prev === '') return true;
  return '(,=:[!&|?{};+-*%~^<>'.includes(prev);
}

/** True when the literal starting at `start` is an import/export/require module specifier. */
function isSpecifier(stripped, start) {
  const before = stripped.slice(Math.max(0, start - 200), start);
  return /(?:\bfrom|\bimport|\brequire\s*\()\s*$/.test(before);
}

function views(src) {
  const { stripped, strings } = lex(src);
  const code = stripped.split('');
  for (const { start, end } of strings) {
    if (isSpecifier(stripped, start)) continue;
    for (let j = start + 1; j < end; j++) if (code[j] !== '\n') code[j] = ' ';
  }
  return { CODE: code.join(''), TEXT: stripped };
}

/**
 * IMPORTS(f). The tree has no dynamic `import()` and no `require`, so a regex over the
 * comment-stripped source is exact rather than approximate — and the moment either appears,
 * assertion (5) fails on the specifier anyway.
 */
function imports(text) {
  const found = [];
  const withFrom = /(?:^|[\n;])\s*(?:import|export)\b([\s\S]*?)\bfrom\s*['"]([^'"]+)['"]/g;
  let m;
  while ((m = withFrom.exec(text)) !== null) {
    const clause = m[1];
    found.push({
      specifier: m[2],
      names: namesIn(clause),
      typeOnly: /^\s*type\b/.test(clause),
      index: m.index,
    });
  }
  const bare = /(?:^|[\n;])\s*import\s*['"]([^'"]+)['"]/g;
  while ((m = bare.exec(text)) !== null) {
    found.push({ specifier: m[1], names: [], typeOnly: false, index: m.index });
  }
  return found;
}

function namesIn(clause) {
  const names = [];
  const braced = clause.match(/\{([\s\S]*)\}/);
  const body = braced ? braced[1] : clause;
  for (const part of body.split(',')) {
    const cleaned = part.replace(/\btype\b/g, '').replace(/\*\s*as\s+/, '').trim();
    if (!cleaned) continue;
    const asMatch = cleaned.match(/^(\S+)\s+as\s+(\S+)$/);
    // Both sides matter: the local name is what a consumer writes, the source name is what
    // the module declares, and an assertion about "does the barrel export X" wants both.
    if (asMatch) { names.push(asMatch[1], asMatch[2]); } else { names.push(cleaned); }
  }
  return names.filter((x) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(x));
}

const lineOf = (text, index) => text.slice(0, index).split('\n').length;

// ---------------------------------------------------------------------------
// File listing
// ---------------------------------------------------------------------------

function listFiles(dir, base = dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listFiles(full, base));
    else out.push(relative(base, full));
  }
  return out.sort();
}

// ---------------------------------------------------------------------------
// --write: the repair. Deliberately dumb — remove, copy, print what it wrote.
// ---------------------------------------------------------------------------

function syncMirror() {
  if (!existsSync(PKG_SRC)) {
    console.error(`nothing to mirror: ${rel(PKG_SRC)} does not exist`);
    return 1;
  }
  rmSync(MIRROR_DIR, { recursive: true, force: true });
  const files = listFiles(PKG_SRC);
  for (const f of files) {
    const dest = join(MIRROR_DIR, f);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(join(PKG_SRC, f), dest);
    console.log(`  ${rel(dest)}`);
  }
  console.log(`\n${files.length} file${files.length === 1 ? '' : 's'} written to ${rel(MIRROR_DIR)}`);
  console.log('The mirror is generated. Never edit it by hand; edit the package and re-run this.');
  return 0;
}

// ---------------------------------------------------------------------------
// --check: the twelve
// ---------------------------------------------------------------------------

const failures = [];
const fail = (n, file, detail, line) => {
  failures.push({ n, file, detail, line });
};

/** Read every package source once, in both views, keyed by its path relative to `src/`. */
function readPackageTree() {
  const tree = new Map();
  for (const f of listFiles(PKG_SRC)) {
    if (!f.endsWith('.ts')) continue;
    const src = readFileSync(join(PKG_SRC, f), 'utf8');
    const v = views(src);
    tree.set(f, { ...v, IMPORTS: imports(v.TEXT), src });
  }
  return tree;
}

const isTest = (f) => /(^|[\\/])__tests__[\\/]/.test(f);
const baseName = (f) => f.split(/[\\/]/).pop();

// (1) --------------------------------------------------------------------
function assertByteIdentity() {
  if (!existsSync(PKG_SRC)) {
    fail(1, rel(PKG_SRC), 'the package source tree does not exist');
    return;
  }
  if (!existsSync(MIRROR_DIR)) {
    fail(1, rel(MIRROR_DIR), 'the mirror does not exist — run `npm run mirror:sync`');
    return;
  }
  const pkgFiles = listFiles(PKG_SRC);
  const mirrorFiles = listFiles(MIRROR_DIR);
  for (const f of pkgFiles) {
    if (!mirrorFiles.includes(f)) {
      fail(1, rel(join(MIRROR_DIR, f)), 'present in the package, absent from the mirror — run `npm run mirror:sync`');
    }
  }
  for (const f of mirrorFiles) {
    if (!pkgFiles.includes(f)) {
      fail(1, rel(join(MIRROR_DIR, f)), 'present in the mirror, absent from the package. The package tree is the source: if this file is wanted, add it there and re-run `npm run mirror:sync`');
    }
  }
  for (const f of pkgFiles) {
    if (!mirrorFiles.includes(f)) continue;
    const a = readFileSync(join(PKG_SRC, f));
    const b = readFileSync(join(MIRROR_DIR, f));
    if (!a.equals(b)) {
      fail(1, rel(join(MIRROR_DIR, f)), `differs from ${rel(join(PKG_SRC, f))}. The mirror is GENERATED and byte-identical — hand edits do not survive; make the change in the package and run \`npm run mirror:sync\``);
    }
  }
}

// (2) --------------------------------------------------------------------
function assertManifest() {
  if (!existsSync(PKG_SRC)) return;   // already reported by (1)
  const permittedTests = new Set([
    ...MODULES.map((m) => m.replace(/\.ts$/, '.test.ts')),
    ...CROSS_CUTTING_SUITES,
  ]);
  const modules = new Set(MODULES);
  const present = new Set();

  for (const f of listFiles(PKG_SRC)) {
    const parts = f.split(/[\\/]/);
    if (parts.length === 1) {
      if (!modules.has(parts[0])) {
        fail(2, rel(join(PKG_SRC, f)), 'source file outside the declared 23-module manifest. Add it to MODULES in this script — which is the review the manifest exists to force — or delete it');
      } else {
        present.add(parts[0]);
      }
      continue;
    }
    if (parts.length === 2 && parts[0] === '__tests__') {
      if (!permittedTests.has(parts[1])) {
        fail(2, rel(join(PKG_SRC, f)), 'test file matching no module and none of the seven cross-cutting suites');
      }
      continue;
    }
    fail(2, rel(join(PKG_SRC, f)), 'unexpected path: `src/` holds the 23 modules and `src/__tests__/`, and nothing else');
  }

  // A module that exists must have its test. The converse — all 23 present — is NOT
  // asserted, because §17 lands them across sixteen steps and every step must be green;
  // the manifest is the closed set of names permitted to exist, and this is the clause
  // that catches a deleted test, which is the deletion a glob would have accepted.
  for (const m of present) {
    const test = m.replace(/\.ts$/, '.test.ts');
    if (!existsSync(join(PKG_SRC, '__tests__', test))) {
      fail(2, rel(join(PKG_SRC, m)), `module has no test: ${rel(join(PKG_SRC, '__tests__', test))} is missing`);
    }
  }
}

// (3) --------------------------------------------------------------------
function assertNoStoreIdentifiers(tree) {
  // Module specifiers survive into CODE by definition, so `import … from 'firebase-admin'`
  // trips the identifier scan as well as the import clause below, and reports twice with
  // two different explanations. That is left as it is: an import of firebase-admin should
  // be loud, and suppressing the identifier inside specifiers would mean the scan could no
  // longer see the one place a forbidden name is most likely to arrive.
  for (const [f, v] of tree) {
    const exempt = IDENTIFIER_EXEMPTIONS[baseName(f)] || new Set();
    const token = /[A-Za-z_$][A-Za-z0-9_$]*/g;
    let m;
    while ((m = token.exec(v.CODE)) !== null) {
      if (!FORBIDDEN_IDENTIFIERS.has(m[0])) continue;
      if (exempt.has(m[0])) continue;
      fail(3, rel(join(PKG_SRC, f)), `identifier \`${m[0]}\` — the package knows nothing about Firestore, KMS or firebase, and must not learn. (Prose may say the word: this view has comments and string literals removed.)`, lineOf(v.CODE, m.index));
    }
    for (const imp of v.IMPORTS) {
      if (/^(firebase-admin|firebase-functions|@google-cloud)/.test(imp.specifier)) {
        fail(3, rel(join(PKG_SRC, f)), `imports \`${imp.specifier}\``, lineOf(v.TEXT, imp.index));
      }
    }
  }
}

// (4) --------------------------------------------------------------------
function assertNoDeepImportsOfTheMirror() {
  if (!existsSync(FUNCTIONS_SRC)) return;
  const mirrorEntry = new Set([MIRROR_DIR, join(MIRROR_DIR, 'index'), join(MIRROR_DIR, 'index.ts')]);
  for (const f of listFiles(FUNCTIONS_SRC)) {
    if (!f.endsWith('.ts')) continue;
    const full = join(FUNCTIONS_SRC, f);
    if (full.startsWith(MIRROR_DIR)) continue;      // the mirror's own modules import each other
    const v = views(readFileSync(full, 'utf8'));
    for (const imp of imports(v.TEXT)) {
      let target = null;
      if (imp.specifier.startsWith('.')) target = resolve(dirname(full), imp.specifier);
      else if (imp.specifier.startsWith('@utilities/')) target = join(FUNCTIONS_SRC, 'utilities', imp.specifier.slice('@utilities/'.length));
      if (!target || !target.startsWith(MIRROR_DIR)) continue;
      if (mirrorEntry.has(target)) continue;
      fail(4, rel(full), `deep-imports the mirror: \`${imp.specifier}\`. The mirror has no \`exports\` map — that is the residual hole in the opacity claim, and this scan is what closes it. Import the module's index, or add what you need to the barrel`, lineOf(v.TEXT, imp.index));
    }
  }
}

// (5) --------------------------------------------------------------------
function assertZeroDependencies(tree) {
  const manifestPath = join(PKG_DIR, 'package.json');
  if (!existsSync(manifestPath)) {
    fail(5, rel(manifestPath), 'the package manifest does not exist');
  } else {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    for (const field of ['dependencies', 'peerDependencies']) {
      const declared = Object.keys(manifest[field] || {});
      if (declared.length) {
        fail(5, rel(manifestPath), `${field} declares ${declared.join(', ')} — this package declares none of either, which is a property of the design and not a packaging preference. If one is genuinely needed, that is a conversation, not an edit`);
      }
    }
    const conditions = Object.keys(manifest.exports || {});
    if (conditions.length !== PERMITTED_EXPORTS.length || conditions.some((c) => !PERMITTED_EXPORTS.includes(c))) {
      fail(5, rel(manifestPath), `exports resolves ${conditions.join(', ') || '(nothing)'}; it must resolve exactly ${PERMITTED_EXPORTS.join(', ')}`);
    }
  }
  for (const [f, v] of tree) {
    for (const imp of v.IMPORTS) {
      if (imp.specifier.startsWith('.')) continue;
      if (PERMITTED_BUILTINS.includes(imp.specifier)) continue;
      fail(5, rel(join(PKG_SRC, f)), `imports \`${imp.specifier}\` — the only non-relative specifiers permitted anywhere in this tree are ${PERMITTED_BUILTINS.join(', ')}`, lineOf(v.TEXT, imp.index));
    }
  }
}

// (6) --------------------------------------------------------------------
function assertLegacyQuarantine(tree) {
  const owners = {
    'enc:v1:': ['field-codec.ts', 'field-codec.test.ts', 'legacy-readers.test.ts'],
    'enc:v2:': ['field-codec.ts', 'field-codec.test.ts', 'legacy-readers.test.ts'],
    'x-collab-': ['legacy-readers.ts', 'legacy-readers.test.ts'],
  };
  for (const [literal, permitted] of Object.entries(owners)) {
    for (const [f, v] of tree) {
      if (permitted.includes(baseName(f))) continue;
      const at = v.TEXT.indexOf(literal);
      if (at !== -1) {
        fail(6, rel(join(PKG_SRC, f)), `the literal \`${literal}\` belongs only in ${permitted.join(', ')}. Every wire prefix is declared in field-codec.ts; legacy-readers.ts re-exports the v1/v2 pair, because a v1 reader is not a v1 prefix`, lineOf(v.TEXT, at));
      }
    }
  }
  const mayImportLegacy = ['content-crypto.ts', 'object-envelope.ts', 'index.ts'];
  for (const [f, v] of tree) {
    if (isTest(f)) continue;
    if (mayImportLegacy.includes(baseName(f)) || baseName(f) === 'legacy-readers.ts') continue;
    for (const imp of v.IMPORTS) {
      if (/(^|\/)legacy-readers$/.test(imp.specifier)) {
        fail(6, rel(join(PKG_SRC, f)), `imports ./legacy-readers, which only ${mayImportLegacy.join(', ')} may. Phase G deletes that module, and the deletion must be provably a leaf`, lineOf(v.TEXT, imp.index));
      }
    }
  }
}

// (7) --------------------------------------------------------------------
function assertBarrelSurface(tree) {
  const barrel = tree.get('index.ts');
  if (!barrel) return;
  // The middle four are R10: `mintRecordKey` + `planWraps` + `openRecord` seals content under a key
  // whose wrap was never written, with nothing false said and the `WrapCommitter` never invoked —
  // the one unsafe path that requires no lie of the caller, and therefore the one most likely to
  // be taken by accident. `session.planWraps` is the same capability with the key held by the
  // session; the free, key-taking function is what may not come back.
  //
  // The last is R13. `materialiseWrapPatch` was kept on the barrel to let a consumer outside
  // `runWrapJob` translate the `{ op: 'delete' }` sentinel, and that did not work: the caller who
  // writes it raw is the caller who does not know a materialiser exists, so the export served only
  // whoever already knew to look for it — four of the five worked examples wrote `patch.update`
  // raw with it available. The single-record apply now has `applyWrapPatch`, which materialises
  // internally through the sink's own `deleteField`, leaving the translator exactly one call site
  // in the package. Re-exporting it would put the untranslated raw write back within reach of
  // somebody who read only the barrel, so it fails here.
  const FORBIDDEN_NAMES = new Set([
    'secretBytes', 'checkTraversal', 'documentByteCost', 'decodeBlobBody',
    'mintRecordKey', 'wrapRecordKey', 'unwrapRecordKey', 'planWraps',
    'materialiseWrapPatch',
  ]);
  const FORBIDDEN_PATTERNS = [
    { re: /encryptValueV1|encryptV2|sealV1/, why: 'a v1/v2 WRITER. The legacy modules read; nothing writes an old wire format' },
    { re: /[Ff]romBytes|[Bb]ytesTo/, why: 'a bytes-to-key constructor. Key material enters the package through the custodian and nowhere else' },
  ];
  for (const imp of barrel.IMPORTS) {
    const line = lineOf(barrel.TEXT, imp.index);
    if (/(^|\/)cipher$/.test(imp.specifier)) {
      fail(7, rel(join(PKG_SRC, 'index.ts')), 're-exports from ./cipher, which is internal: it is the one AES call site and has no consumer outside this package', line);
    }
    for (const name of imp.names) {
      if (FORBIDDEN_NAMES.has(name)) {
        fail(7, rel(join(PKG_SRC, 'index.ts')), `exports \`${name}\`, which the production barrel must not carry (a key accessor, an internal, or a test helper — \`./testing\` is where a test helper lives)`, line);
      }
      for (const { re, why } of FORBIDDEN_PATTERNS) {
        if (re.test(name)) fail(7, rel(join(PKG_SRC, 'index.ts')), `exports \`${name}\`, which looks like ${why}`, line);
      }
    }
  }
}

// (8) --------------------------------------------------------------------
function assertTestingDoesNotImportLifecycle(tree) {
  const testing = tree.get('testing.ts');
  if (!testing) return;
  for (const imp of testing.IMPORTS) {
    if (/(^|\/)key-lifecycle$/.test(imp.specifier)) {
      fail(8, rel(join(PKG_SRC, 'testing.ts')), 'imports ./key-lifecycle. The in-memory store is a test double, not a local custodian, and the moment it knows the lifecycle rules it starts becoming one', lineOf(testing.TEXT, imp.index));
    }
  }
}

// (9) --------------------------------------------------------------------
function assertTestsAreMirrorable(tree) {
  // The addendum names CODE here. This runs over TEXT, deliberately and for one reason:
  // over CODE a `readFileSync('package.json')` is blanked to `readFileSync('')` and
  // becomes invisible — and that call is precisely the mirrorability rule being enforced
  // (§16.3 rule 2: the relative path differs by one level between the two trees, and in the
  // mirror it resolves to `functions/src/package.json`, which does not exist). TEXT still
  // strips comments, so a docblock may explain any of this. `__dirname` is permitted:
  // `__dirname/..` is the mirrored root in both trees, which the import-graph test needs.
  const banned = [
    { needle: '@xbg.solutions/', why: 'a package specifier. The mirror is not a package; only relative imports resolve in both trees' },
    { needle: 'package.json', why: 'a manifest read. It sits one level away in one tree and does not exist at all in the other' },
    { needle: '../../', why: 'a path reaching above the mirrored root, which is a different directory in each tree' },
  ];
  for (const [f, v] of tree) {
    if (!isTest(f)) continue;
    for (const { needle, why } of banned) {
      const at = v.TEXT.indexOf(needle);
      if (at !== -1) {
        fail(9, rel(join(PKG_SRC, f)), `contains \`${needle}\` — ${why}. Every suite runs byte-identically in both trees`, lineOf(v.TEXT, at));
      }
    }
  }
}

// (10) -------------------------------------------------------------------
function assertOneCodePath(tree) {
  // Production modules only. A test must be able to construct a scope at each granularity —
  // `equivalence.test.ts` exists to compare them, and asserting a granularity is not a code
  // path branching on one. The property is "one code path", and code paths live in modules.
  const permitted = ['key-scope.ts', 'walk.ts'];
  const literal = /(['"])(document|aggregate|account)\1/g;
  for (const [f, v] of tree) {
    if (isTest(f)) continue;
    if (permitted.includes(baseName(f))) continue;
    let m;
    while ((m = literal.exec(v.TEXT)) !== null) {
      fail(10, rel(join(PKG_SRC, f)), `the granularity literal ${m[0]}. Granularity is decided in key-scope.ts (\`granularityOf\`, \`isAccountGranular\`, \`assertRecord\`) and switched on in walk.ts (\`assertHead\`) — everywhere else, account granularity is aggregate granularity with the dial turned down, and a third module comparing a granularity is a second code path arriving`, lineOf(v.TEXT, m.index));
    }
  }
}

// (11) -------------------------------------------------------------------
function assertCacheNeverReadsAMessage(tree) {
  const cache = tree.get('custodian-cache.ts');
  if (!cache) return;
  const at = cache.CODE.indexOf('.message');
  if (at !== -1) {
    fail(11, rel(join(PKG_SRC, 'custodian-cache.ts')), 'reads `.message`. A GraceReason is a closed union of our own labels; the moment an upstream error message reaches it, an unbounded string from someone else\'s library is on a path that ends in a log. A docblock may say the word — this view has comments removed', lineOf(cache.CODE, at));
  }
}

// (12) -------------------------------------------------------------------
function assertEnvSurface(tree) {
  const reads = /process\s*\.\s*env\s*(?:\.\s*([A-Za-z_][A-Za-z0-9_]*)|\[\s*['"]([^'"]+)['"]\s*\])/g;
  for (const [f, v] of tree) {
    let m;
    while ((m = reads.exec(v.TEXT)) !== null) {
      const name = m[1] || m[2];
      const owner = PERMITTED_ENV[name];
      const line = lineOf(v.TEXT, m.index);
      if (!owner) {
        fail(12, rel(join(PKG_SRC, f)), `reads process.env.${name}. The package holds four environment variables and no others: ${Object.keys(PERMITTED_ENV).join(', ')}. Configuration this package acquires is configuration five products then have to set`, line);
      } else if (baseName(f) !== owner) {
        fail(12, rel(join(PKG_SRC, f)), `reads process.env.${name}, which is read in ${owner} and nowhere else`, line);
      }
    }
  }
}

// ---------------------------------------------------------------------------

function check() {
  const tree = existsSync(PKG_SRC) ? readPackageTree() : new Map();
  assertByteIdentity();
  assertManifest();
  assertNoStoreIdentifiers(tree);
  assertNoDeepImportsOfTheMirror();
  assertZeroDependencies(tree);
  assertLegacyQuarantine(tree);
  assertBarrelSurface(tree);
  assertTestingDoesNotImportLifecycle(tree);
  assertTestsAreMirrorable(tree);
  assertOneCodePath(tree);
  assertCacheNeverReadsAMessage(tree);
  assertEnvSurface(tree);

  if (failures.length === 0) {
    console.log(`mirror check: 12 assertions, ${tree.size} source file${tree.size === 1 ? '' : 's'}, 0 failures`);
    return 0;
  }
  failures.sort((a, b) => a.n - b.n || a.file.localeCompare(b.file) || (a.line || 0) - (b.line || 0));
  console.error(`\nmirror check FAILED — ${failures.length} problem${failures.length === 1 ? '' : 's'}\n`);
  let current = null;
  for (const { n, file, detail, line } of failures) {
    if (n !== current) {
      current = n;
      console.error(`assertion (${n}) — ${ASSERTION_TITLES[n]}`);
    }
    console.error(`  ${file}${line ? `:${line}` : ''}\n      ${detail}`);
  }
  console.error('');
  return 1;
}

function main(argv) {
  const mode = argv.includes('--write') ? 'write' : 'check';
  if (argv.some((a) => a.startsWith('--') && a !== '--write' && a !== '--check')) {
    console.error(`usage: node scripts/check-mirror.js [--check | --write]`);
    return 2;
  }
  return mode === 'write' ? syncMirror() : check();
}

if (require.main === module) process.exit(main(process.argv.slice(2)));

module.exports = { main, syncMirror, MODULES, CROSS_CUTTING_SUITES };
