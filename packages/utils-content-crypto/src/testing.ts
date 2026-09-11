/**
 * `testing.ts` — the in-memory fixtures, published at the **`./testing` subpath** (§12.6).
 *
 * These ship from here, and nothing else: `expectNoKeyMaterial` with its fixture register,
 * `memoryContentKeyStore`, `fixedDekSource`, `checkTraversal` and `checkWrapCommit`. Every one of them is
 * a thing a consumer runs in ITS OWN repo's tests, which is the whole reason they live behind a
 * second entrypoint rather than on the production barrel — a test helper that can be imported from
 * `@xbg.solutions/utils-content-crypto` is a test helper that will eventually be imported from a
 * deployed function.
 *
 * The two `check*` suites are the load-bearing pair, and they check the two things this package
 * hands to a product and cannot see afterwards: `checkTraversal` checks the walk, and
 * `checkWrapCommit` checks the ONE WRITE the durability invariant depends on. **Both are REQUIRED
 * steps of adoption, not optional extras: a product's adoption of this package is not complete
 * until `checkWrapCommit` passes in that product's own CI** (R12).
 *
 * ── THE DEPLOYED-FUNCTION GUARD ───────────────────────────────────────────────────────────────
 *
 * This module **throws on import** when `K_SERVICE` is set and `FUNCTIONS_EMULATOR` is not
 * `'true'` — the same test the deleted `kek.ts` applied to its development KEK, applied here to
 * the one remaining module that handles raw key bytes. The `exports` map already closes the
 * subpath to a published consumer, but the byte-identical mirror under `functions/` has no
 * `exports` map at all (§5.2), so the language cannot be the guarantee and a runtime refusal is.
 *
 * The predicate is a PURE FUNCTION OF AN ENVIRONMENT OBJECT (`isDeployedFunction`) and the module
 * calls it once, at load, against the ambient one. That is not indirection for its own sake: it is
 * what lets `testing.test.ts` prove the guard in both trees without mutating a global that
 * `check-mirror.js` assertion (12) reserves to this file — the same shape `resolveGraceMs(env)`
 * already uses in `key-scope.ts`.
 *
 * ── WHAT THIS MODULE MAY NOT BECOME ───────────────────────────────────────────────────────────
 *
 * **`testing.ts` must never import `key-lifecycle`** (assertion 8). A lifecycle-aware in-memory
 * store is the local custodian growing back under another name: it would know when a mint is
 * legal, and knowing that is the whole of being a custodian. `memoryContentKeyStore` therefore applies
 * patches and refuses nothing — the RULES are `key-lifecycle.ts`'s, are pure, and are asserted
 * against the patches they return rather than against a store that re-implements them. A suite
 * that needs both composes them itself, in the suite, where the composition is visible.
 *
 * It also holds **no granularity literal**: heads are checked through `assertHead`, which is the
 * one place a granularity is compared (assertion 10).
 */

import { randomBytes } from 'node:crypto';
import { inspect } from 'node:util';

import { ContentCryptoError, assertNoKeyMaterial } from './errors';
import { ENC_PREFIX_V3, WRAP_PREFIX, decodeValue } from './field-codec';
import { assertContentKeyPatch } from './key-store';
import type { GenerationRow, ContentKeyPatch, ContentKeyPatchValue, ContentKeyRow, ContentKeyStore } from './key-store';
import type { DekHandle, DekSource, RevokedCause, OpenRotation } from './custodian';
import { KEY_BYTES, dekFromBytes, zeroise } from './secret';
import type { AccountDek } from './secret';
import {
  KEY_WRAPS_FIELD, WRAP_HOLDERS_FIELD, hasWrap, mintRecordKey, parseKeyWraps, wrapCount,
} from './record-key';
import type { RecordRef } from './record-key';
import { planWraps } from './wrap-patch';
import type { WrapCommitRequest, WrapCommitter, WrapReceipt } from './content-crypto';
import { assertHead } from './walk';
import type { ForEachRecord, RecordHead } from './walk';
import type { ResolvedScope } from './key-scope';

// ---------------------------------------------------------------------------
// The deployed-function guard
// ---------------------------------------------------------------------------

/** The shape of an environment bag, without naming a global type this package has no business
 *  depending on. `process.env` is assignable to it. */
export type EnvLike = Readonly<Record<string, string | undefined>>;

/**
 * True when this looks like a DEPLOYED function rather than a local run or the emulator.
 *
 * `K_SERVICE` is set by the runtime and by the emulator alike, which is why the emulator flag is
 * the second half rather than a nicety: without it every local emulator session would refuse to
 * load a test helper it is entitled to load.
 */
export function isDeployedFunction(env: EnvLike): boolean {
  const service = env.K_SERVICE;
  if (typeof service !== 'string' || service.length === 0) return false;
  return env.FUNCTIONS_EMULATOR !== 'true';
}

/**
 * Throws when `env` describes a deployed function. Called once at module load against the ambient
 * environment, and callable with any bag, which is how it is tested.
 */
export function assertNotDeployedFunction(env: EnvLike = process.env): void {
  if (!isDeployedFunction(env)) return;
  throw new ContentCryptoError(
    'VALIDATION_ERROR',
    'the ./testing entrypoint of @xbg.solutions utils-content-crypto was imported inside a ' +
      'deployed function. It builds key handles from raw bytes and exists for tests only; a ' +
      'deployed function reaches key material through the custodian and through nothing else. ' +
      'Set FUNCTIONS_EMULATOR=true if this really is the emulator.',
  );
}

assertNotDeployedFunction();

// ---------------------------------------------------------------------------
// The fixture register, and the aggressive leak check
// ---------------------------------------------------------------------------

/**
 * The length of the shortest run of a fixture's spelling that counts as a hit.
 *
 * Eight characters of base64 is six bytes of a key, which is both far more than an accident and
 * far less than a whole one — and the ten-character fragment of §11.3 (a JSON body quoted into an
 * upstream `SyntaxError`) is exactly the shape this number exists to catch. It is what turns that
 * leak from a thought experiment into a test failure.
 */
const FRAGMENT_LENGTH = 8;

/** Every run of `FRAGMENT_LENGTH` characters of every registered fixture's spellings. */
const FIXTURE_RUNS = new Set<string>();

/** Depth bound for the fragment walk. The same 64 `errors.ts` and `blob-json.ts` use. */
const MAX_DEPTH = 64;

/**
 * Register a fixture key so `expectNoKeyMaterial` can find FRAGMENTS of it rather than only whole
 * copies.
 *
 * `fixedDekSource` registers everything it is given, so most tests never call this; a suite that
 * builds a `RecordKey` of its own — `mintRecordKey` mints one nobody can see — has nothing to
 * register and does not need to, because a key it cannot spell is a key that cannot appear in a
 * string it wrote.
 *
 * The register is process-wide and grows only. That is deliberate: a fixture registered by one
 * suite makes every later `expectNoKeyMaterial` in the same worker stricter, never looser.
 */
export function registerKeyMaterialFixture(bytes: Buffer | Uint8Array): void {
  if (!(bytes instanceof Uint8Array)) {
    throw new ContentCryptoError(
      'VALIDATION_ERROR',
      'registerKeyMaterialFixture takes the raw bytes of a fixture key',
    );
  }
  const buffer = Buffer.from(bytes);
  const spellings = [
    buffer.toString('base64'),
    buffer.toString('base64url'),
    buffer.toString('hex'),
    buffer.toString('hex').toUpperCase(),
  ];
  for (const spelling of spellings) {
    for (let i = 0; i + FRAGMENT_LENGTH <= spelling.length; i += 1) {
      FIXTURE_RUNS.add(spelling.slice(i, i + FRAGMENT_LENGTH));
    }
  }
}

/**
 * Walk `value` and fail on key material anywhere in it.
 *
 * Two checks, and they answer different questions:
 *
 *  1. **`assertNoKeyMaterial`, the PRODUCTION matcher** (`errors.ts`), which knows the seven
 *     spellings of 32 bytes and refuses a `Buffer`, a `TypedArray`, an `ArrayBuffer` or a key
 *     handle wherever it finds one. Running the shipped guard here rather than a private copy is
 *     the point: the thing the suites sweep with is the thing the package defends itself with, so
 *     a weakness in one is a failure in the other.
 *  2. **The fragment scan**, which production cannot do and a test can: a registered fixture's
 *     base64, base64url or hex spelling appearing as a run of `FRAGMENT_LENGTH` characters
 *     ANYWHERE inside a longer string. That is the §11.3 leak — ten characters of a DEK quoted
 *     inside somebody else's error message — and nothing that lacks the fixture bytes to compare
 *     against could ever see it.
 *
 * **The one exemption, and it is narrow.** A WELL-FORMED sealed value is skipped by the fragment
 * scan: `enc:v3:…` and `wrap:v1:…` are ciphertext, they are meant to be stored and logged, and a
 * `WrapPatch` assertion would otherwise be scanning its own legitimate `WrapEntry.wrapped`. It is
 * decided by `decodeValue` — the package's own strict decoder — and not by the prefix, so a
 * hand-built `'enc:v3:' + dekBase64` is still scanned and still fails. An exemption keyed on a
 * prefix would have been a hole shaped exactly like the leak.
 *
 * Deliberately more aggressive than `assertNoSecrets`: in a test a false positive costs a minute
 * and a miss costs a production leak.
 */
export function expectNoKeyMaterial(value: unknown, label = 'value'): void {
  assertNoKeyMaterial(value, label);
  scanForFragments(value, label, 0, new Set<object>());
}

function scanForFragments(node: unknown, path: string, depth: number, seen: Set<object>): void {
  if (typeof node === 'string') {
    const at = fragmentIndex(node);
    if (at !== -1) {
      throw leaked(
        `${path} contains "${node.slice(at, at + FRAGMENT_LENGTH)}", which is ` +
          `${FRAGMENT_LENGTH} characters of a registered fixture key`,
      );
    }
    return;
  }
  if (typeof node !== 'object' || node === null) return;
  if (seen.has(node)) return;
  seen.add(node);

  if (depth >= MAX_DEPTH) {
    throw leaked(`${path} nests deeper than ${MAX_DEPTH} levels, so this check proves nothing below it`);
  }

  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i += 1) scanForFragments(node[i], `${path}[${i}]`, depth + 1, seen);
    return;
  }

  const tag = Object.prototype.toString.call(node);
  if (tag === '[object Date]' || tag === '[object RegExp]') return;

  if (tag === '[object Map]') {
    let i = 0;
    for (const [mapKey, mapValue] of node as Map<unknown, unknown>) {
      scanForFragments(mapKey, `${path}.<key ${i}>`, depth + 1, seen);
      scanForFragments(mapValue, `${path}.<value ${i}>`, depth + 1, seen);
      i += 1;
    }
    return;
  }

  if (tag === '[object Set]') {
    let i = 0;
    for (const member of node as Set<unknown>) {
      scanForFragments(member, `${path}.<member ${i}>`, depth + 1, seen);
      i += 1;
    }
    return;
  }

  // `Reflect.ownKeys`, so a symbol key and a non-enumerable one are both walked — an `Error`'s
  // `message` and `stack` are non-enumerable own properties, and the message is the single most
  // likely place for a leaked fragment to arrive.
  for (const rawKey of Reflect.ownKeys(node)) {
    const keyText = typeof rawKey === 'symbol' ? String(rawKey) : rawKey;
    scanForFragments(keyText, `${path}.<key ${keyText}>`, depth + 1, seen);
    let child: unknown;
    try {
      child = (node as Record<string | symbol, unknown>)[rawKey as string];
    } catch {
      continue;
    }
    scanForFragments(child, `${path}.${keyText}`, depth + 1, seen);
  }
}

/** The index of the first fixture run in `text`, or `-1`. Sealed values are exempt; see above. */
function fragmentIndex(text: string): number {
  if (FIXTURE_RUNS.size === 0 || text.length < FRAGMENT_LENGTH) return -1;
  if (isWellFormedSealedValue(text)) return -1;
  for (let i = 0; i + FRAGMENT_LENGTH <= text.length; i += 1) {
    if (FIXTURE_RUNS.has(text.slice(i, i + FRAGMENT_LENGTH))) return i;
  }
  return -1;
}

/**
 * A value this package really did seal: `decodeValue` accepts it, or it is a wrap whose body
 * `decodeValue` accepts once the wrap prefix is swapped for the content one.
 *
 * The swap reuses the ONE strict decoder rather than writing a second grammar for the wrap wire —
 * the two are byte-identical after their prefixes, and a second copy of "twelve-byte IV, at least
 * one ciphertext byte, sixteen-byte tag" is a second thing to disagree about.
 */
function isWellFormedSealedValue(text: string): boolean {
  if (decodeValue(text) !== null) return true;
  if (!text.startsWith(WRAP_PREFIX)) return false;
  return decodeValue(`${ENC_PREFIX_V3}${text.slice(WRAP_PREFIX.length)}`) !== null;
}

function leaked(message: string): ContentCryptoError {
  const capped = message.length > 240 ? `…${message.slice(-200)}` : message;
  return new ContentCryptoError('VALIDATION_ERROR', `expectNoKeyMaterial: ${capped}`);
}

// ---------------------------------------------------------------------------
// The in-memory ContentKeyStore
// ---------------------------------------------------------------------------

export interface MemoryKeyStore extends ContentKeyStore {
  /**
   * Seed a row and its generations directly, so a test states its precondition rather than
   * arriving at it through ten operations. Merges: seeding twice overlays.
   */
  seed(accountId: string, row: Partial<ContentKeyRow>, generations?: readonly Partial<GenerationRow>[]): void;
  /** Every patch applied, in order — the assertion surface for the fourteen rules. */
  readonly applied: readonly { accountId: string; patch: ContentKeyPatch }[];
  /** Which generations currently have a wrap; the mint side-effect a `ContentKeyStore` cannot express. */
  wraps(accountId: string): readonly number[];
}

export interface MemoryKeyStoreOptions {
  /** Injectable clock, for `KEY_PATCH_SERVER_TIME`. Defaults to `new Date()`. */
  readonly now?: () => Date;
  /**
   * Step 6 of §12.2, which a store cannot do for itself: a consumer's `apply` honours
   * `patch.evict` by calling `DekSource.evict(accountId)`. Wiring it here is what lets a suite
   * assert that a revoke purges the cache on the spot rather than at the next TTL.
   */
  readonly onEvict?: (accountId: string) => void;
}

/**
 * An in-memory `ContentKeyStore` that implements `apply` **to the letter of §12.2** — mint first,
 * generations before the key row, sentinels translated, dotted keys applied as field paths — which
 * is what makes it the executable statement of what a consumer's own `apply` has to do, and the
 * thing a consumer's adapter test can diff against.
 *
 * It **enforces no lifecycle rule** and refuses nothing but an unwritable patch. The rules are
 * `key-lifecycle.ts`'s and are pure; a store that re-implemented them would be a second, weaker
 * copy of them, and assertion (8) exists to keep that from starting.
 *
 * It holds NO KEY MATERIAL, by construction rather than by care: `GenerationRow` carries
 * `hasWrap` and never a wrap, which is property 3 of the port. That is why it registers no fixture
 * — there is nothing here to spell.
 */
export function memoryContentKeyStore(productId: string, opts?: MemoryKeyStoreOptions): MemoryKeyStore {
  if (typeof productId !== 'string' || productId.length === 0) {
    throw new ContentCryptoError('VALIDATION_ERROR', 'memoryContentKeyStore needs a productId');
  }
  const now = opts?.now ?? ((): Date => new Date());
  const onEvict = opts?.onEvict;

  const rows = new Map<string, Record<string, unknown>>();
  const generations = new Map<string, Map<number, Record<string, unknown>>>();
  const applied: { accountId: string; patch: ContentKeyPatch }[] = [];

  const generationsOf = (accountId: string): Map<number, Record<string, unknown>> => {
    let table = generations.get(accountId);
    if (table === undefined) {
      table = new Map<number, Record<string, unknown>>();
      generations.set(accountId, table);
    }
    return table;
  };

  const generationRow = (accountId: string, n: number): Record<string, unknown> => {
    const table = generationsOf(accountId);
    let row = table.get(n);
    if (row === undefined) {
      row = { n, hasWrap: false, kmsKeyVersion: null, createdAt: null, retiredAt: null, drainedAt: null, destroyedAt: null };
      table.set(n, row);
    }
    return row;
  };

  return {
    seed(accountId, row, seeded): void {
      const stored = rows.get(accountId) ?? { accountId, productId };
      for (const key of Object.keys(row)) {
        (stored as Record<string, unknown>)[key] = (row as Record<string, unknown>)[key];
      }
      stored.accountId = accountId;
      stored.productId = productId;
      rows.set(accountId, stored);
      for (const g of seeded ?? []) {
        if (!Number.isInteger(g.n) || (g.n as number) < 1) {
          throw new ContentCryptoError('VALIDATION_ERROR', 'a seeded generation needs a positive integer n');
        }
        const target = generationRow(accountId, g.n as number);
        for (const key of Object.keys(g)) {
          target[key] = (g as Record<string, unknown>)[key];
        }
      }
    },

    get applied(): readonly { accountId: string; patch: ContentKeyPatch }[] {
      return applied;
    },

    wraps(accountId): readonly number[] {
      const table = generations.get(accountId);
      if (table === undefined) return [];
      const out: number[] = [];
      for (const [n, row] of table) if (row.hasWrap === true) out.push(n);
      return out.sort((a, b) => a - b);
    },

    async readKey(accountId): Promise<ContentKeyRow | null> {
      const stored = rows.get(accountId);
      return stored === undefined ? null : toKeyRow(accountId, productId, stored);
    },

    async readGeneration(accountId, n): Promise<GenerationRow | null> {
      const stored = generations.get(accountId)?.get(n);
      return stored === undefined ? null : toGenerationRow(n, stored);
    },

    async listGenerations(accountId): Promise<readonly GenerationRow[]> {
      const table = generations.get(accountId);
      if (table === undefined) return [];
      return [...table.keys()].sort((a, b) => a - b).map((n) => toGenerationRow(n, table.get(n) as Record<string, unknown>));
    },

    async apply(accountId, patch): Promise<void> {
      // The consumer's guarantee re-asserted at the store, which is exactly where a patch that
      // arrived over a queue has lost the planner's.
      assertContentKeyPatch(patch);

      // 1. MINT FIRST. The mint itself is the consumer's, because the KEK is; what a store can
      //    record is that the wrap now exists, which is the side effect `ContentKeyStore` cannot express.
      if (patch.mint !== null) {
        const row = generationRow(accountId, patch.mint.generation);
        row.hasWrap = true;
        if (row.createdAt === null) row.createdAt = now().toISOString();
      }

      // 2. GENERATIONS BEFORE THE KEY ROW (§12.2 step 5). A partial failure must leave the row
      //    saying LESS has happened than has: an erased generation under a row not yet tombstoned
      //    re-runs cleanly, and a row tombstoned over live wraps is a destroy that lies.
      for (const g of patch.generations) {
        const row = generationRow(accountId, g.n);
        for (const path of Object.keys(g.set)) applyFieldPath(row, path, g.set[path], now);
        if (g.eraseWrap) row.hasWrap = false;
      }

      // 3. The key row.
      const existing = rows.get(accountId);
      if (existing === undefined) {
        if (!patch.createIfMissing) {
          throw new ContentCryptoError(
            'KEY_STORE_CONFLICT',
            `there is no key row for '${accountId}' and the patch does not create one`,
            { accountId, productId },
          );
        }
        // A create writes a LITERAL map, which is why `assertContentKeyPatch` refuses a dotted key
        // alongside `createIfMissing`: under a merging create a dotted key becomes a top-level
        // field with a dot in its name.
        const created: Record<string, unknown> = { accountId, productId };
        for (const path of Object.keys(patch.key)) created[path] = materialise(patch.key[path], now);
        rows.set(accountId, created);
      } else {
        for (const path of Object.keys(patch.key)) applyFieldPath(existing, path, patch.key[path], now);
      }

      applied.push({ accountId, patch });

      // 4. Footgun 14. A consumer that skips this is invisible: everything works, and revocations
      //    simply never arrive until the TTL expires.
      if (patch.evict && onEvict !== undefined) onEvict(accountId);
    },
  };
}

/** `{ op: 'delete' }` by VALUE, not by identity: a patch may have crossed a JSON boundary. */
function isSentinel(value: unknown, op: 'delete' | 'serverTime'): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const own = Reflect.ownKeys(value as object);
  return own.length === 1 && own[0] === 'op' && (value as { op?: unknown }).op === op;
}

function materialise(value: ContentKeyPatchValue, now: () => Date): unknown {
  if (isSentinel(value, 'serverTime')) return now().toISOString();
  return value;
}

/** Apply one field path, creating intermediate maps, translating both sentinels. */
function applyFieldPath(
  target: Record<string, unknown>,
  path: string,
  value: ContentKeyPatchValue,
  now: () => Date,
): void {
  const segments = path.split('.');
  let node = target;
  for (let i = 0; i < segments.length - 1; i += 1) {
    const next: unknown = node[segments[i]];
    if (next === null || typeof next !== 'object' || Array.isArray(next)) {
      const created: Record<string, unknown> = {};
      node[segments[i]] = created;
      node = created;
    } else {
      node = next as Record<string, unknown>;
    }
  }
  const last = segments[segments.length - 1];
  if (isSentinel(value, 'delete')) {
    delete node[last];
    return;
  }
  node[last] = materialise(value, now);
}

function toKeyRow(accountId: string, productId: string, stored: Record<string, unknown>): ContentKeyRow {
  return {
    accountId,
    productId,
    currentGeneration: typeof stored.currentGeneration === 'number' ? stored.currentGeneration : 1,
    createdAt: asIso(stored.createdAt),
    revokedAt: asIso(stored.revokedAt),
    revokedCause: (stored.revokedCause as RevokedCause | null | undefined) ?? null,
    destroyedAt: asIso(stored.destroyedAt),
    destroyedThrough: typeof stored.destroyedThrough === 'number' ? stored.destroyedThrough : null,
    rotation: (stored.rotation as OpenRotation | null | undefined) ?? null,
  };
}

function toGenerationRow(n: number, stored: Record<string, unknown>): GenerationRow {
  return {
    n,
    hasWrap: stored.hasWrap === true,
    kmsKeyVersion: typeof stored.kmsKeyVersion === 'string' ? stored.kmsKeyVersion : null,
    createdAt: asIso(stored.createdAt),
    retiredAt: asIso(stored.retiredAt),
    drainedAt: asIso(stored.drainedAt),
    destroyedAt: asIso(stored.destroyedAt),
  };
}

function asIso(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

// ---------------------------------------------------------------------------
// The fixed DekSource
// ---------------------------------------------------------------------------

export interface FixedDekSourceOptions {
  readonly productId: string;
  /** accountId → generation → exactly 32 bytes. */
  readonly keys?: Readonly<Record<string, Readonly<Record<number, Buffer>>>>;
  /** Defaults to the highest generation configured for that account. */
  readonly currentGeneration?: (accountId: string) => number;
  /** Consulted BEFORE the key table, so a test can express revoked, destroyed or unreachable. */
  readonly fail?: (accountId: string, generation: number) => ContentCryptoError | null;
}

/**
 * A `DekSource` over FIXED bytes. **Not a custodian**: no lifecycle, no minting rules, and no
 * refusals beyond the ones a test asks for through `fail`. Wrap it in `cachingDekSource` like a
 * real one — the façade accepts nothing else, which is the point of that brand.
 *
 * ── WHY THE SAME BYTES UNDER TWO LABELS IS THE WHOLE POINT ────────────────────────────────────
 *
 * `{ A: { 1: K, 2: K }, B: { 1: K } }` gives two accounts and two generations ONE key. A tamper
 * test that varied the label and the bytes together would pass for the wrong reason and would keep
 * passing if the AAD were dropped from the wrap entirely. Holding the bytes constant is what makes
 * "same bytes, different label" an assertion about the AAD rather than about the cipher.
 *
 * ── IT IS CLOSED THE SAME WAY A PRODUCTION CONFIG WOULD HAVE BEEN ─────────────────────────────
 *
 * Not excused because it is a test helper: it is reachable only at the `./testing` subpath, which
 * throws on import in a deployed function; every `Buffer` becomes a `SecretHandle` **at
 * construction**, and `SecretHandle` copies into an allocation of its own, so neither the input
 * object nor a view into it is retained; and the returned source exposes no accessor and redacts
 * under `toJSON`, `toString` and `util.inspect`, so a snapshot assertion or a test-log dump of the
 * source carries nothing.
 *
 * It registers every key it is given with `registerKeyMaterialFixture`, which is what lets
 * `expectNoKeyMaterial` chase a ten-character FRAGMENT of one rather than only a whole copy.
 */
export function fixedDekSource(opts: FixedDekSourceOptions): DekSource {
  if (opts === null || typeof opts !== 'object') {
    throw new ContentCryptoError('VALIDATION_ERROR', 'fixedDekSource needs its options object');
  }
  const { productId } = opts;
  if (typeof productId !== 'string' || productId.length === 0) {
    throw new ContentCryptoError('VALIDATION_ERROR', 'fixedDekSource needs a productId');
  }

  const handles = new Map<string, AccountDek>();
  const highest = new Map<string, number>();
  const table = opts.keys ?? {};

  for (const accountId of Object.keys(table)) {
    const perGeneration = table[accountId];
    for (const raw of Object.keys(perGeneration)) {
      const generation = Number(raw);
      if (!Number.isSafeInteger(generation) || generation <= 0) {
        throw new ContentCryptoError(
          'VALIDATION_ERROR',
          `fixedDekSource key table for '${accountId}' has generation '${raw}', which is not a positive integer`,
        );
      }
      const bytes = perGeneration[generation];
      if (!(bytes instanceof Uint8Array) || bytes.byteLength !== KEY_BYTES) {
        throw new ContentCryptoError(
          'VALIDATION_ERROR',
          `fixedDekSource needs exactly ${KEY_BYTES} bytes for '${accountId}' generation ${generation}`,
        );
      }
      // Converted HERE, at construction. Nothing below this line holds a Buffer.
      handles.set(`${accountId}#${generation}`, dekFromBytes(bytes, `${productId}/${accountId}@${generation}`));
      registerKeyMaterialFixture(bytes);
      const top = highest.get(accountId);
      if (top === undefined || generation > top) highest.set(accountId, generation);
    }
  }

  const redaction = `[redacted fixedDekSource ${productId}]`;

  const currentGenerationOf = (accountId: string): number => {
    if (opts.currentGeneration !== undefined) return opts.currentGeneration(accountId);
    const top = highest.get(accountId);
    if (top === undefined) {
      throw new ContentCryptoError(
        'ACCOUNT_KEY_NOT_FOUND',
        `fixedDekSource holds no key for account '${accountId}'`,
        { accountId, productId },
      );
    }
    return top;
  };

  const dekFor = (accountId: string, generation: number): DekHandle => {
    const refusal = opts.fail?.(accountId, generation) ?? null;
    if (refusal !== null) throw refusal;

    const key = handles.get(`${accountId}#${generation}`);
    if (key === undefined) {
      // NEVER mints. A source that minted on a read would silently make every value under the
      // missing generation permanently unreadable while reporting success.
      throw new ContentCryptoError(
        highest.has(accountId) ? 'ACCOUNT_KEY_DESTROYED' : 'ACCOUNT_KEY_NOT_FOUND',
        `fixedDekSource holds no generation ${generation} for account '${accountId}'`,
        { accountId, productId, generation },
      );
    }
    return { generation, key };
  };

  const source = {
    async getCurrentDek(accountId: string): Promise<DekHandle> {
      return dekFor(accountId, currentGenerationOf(accountId));
    },
    async getDek(accountId: string, generation: number): Promise<DekHandle> {
      return dekFor(accountId, generation);
    },
    async currentGeneration(accountId: string): Promise<number> {
      return currentGenerationOf(accountId);
    },
    evict(): void {
      /* Nothing is cached here: `cachingDekSource` is what holds anything. */
    },
    toJSON(): string {
      return redaction;
    },
    toString(): string {
      return redaction;
    },
    [inspect.custom](): string {
      return redaction;
    },
  };

  return source;
}

// ---------------------------------------------------------------------------
// The traversal conformance suite
// ---------------------------------------------------------------------------

/**
 * The in-memory conformance suite a product runs against **its own traversal**, in its own repo's
 * tests. It ships as a helper rather than as a suite here because the thing it checks is a query
 * this package cannot see (§16.13).
 *
 * **`accountId` is a third parameter and §13.3's declaration does not have one.** That is a gap in
 * the declaration, not a decision: `ForEachRecord` takes the account whose wraps are being walked,
 * so a checker with no account has nothing to call and no `keyWraps[accountId]` to look for —
 * which is the ownership-query check itself.
 *
 * What it asserts, in order:
 *
 *  1. **Every head passes `assertHead`** — the wrap is where the granularity says it is, and a
 *     path below an aggregate root is the walked-children bug arriving as a test failure.
 *  2. **Every head really is HOLDER-scoped**: `head.keyWraps[accountId]` is present. This is the
 *     one that matters. collab's rotation enumerates by OWNERSHIP; under federation that misses a
 *     record owned by A and shared to B, the job reports the generation drained, the old wrap is
 *     erased, and **B's access is gone with no error anywhere**. There is no error at the point of
 *     damage, so this check is the only thing standing where one should be.
 *  3. **Uniqueness** — no record yielded twice. A record rewrapped twice in one job is a record
 *     whose second write raced its own first.
 *  4. **Determinism** — two runs, same order. A traversal without a total order cannot be resumed
 *     and cannot be reasoned about after a crash.
 *  5. **Resume**, when every head carries a `cursor`: resuming from a head's cursor yields records
 *     strictly AFTER it, and the paged run reunited with its prefix equals the unpaged run.
 *  6. **A visitor's throw aborts the traversal** rather than being swallowed — a swallowed throw
 *     turns a failed rewrap into a job that reports success.
 *
 * Every failure is a `VALIDATION_ERROR` naming the record path, because "which record" is the
 * first question anybody asks and the traversal is the product's code, not this package's.
 */
export async function checkTraversal<RT extends string>(
  scope: ResolvedScope<RT>,
  forEachRecord: ForEachRecord,
  accountId: string,
): Promise<void> {
  if (typeof forEachRecord !== 'function') {
    throw refuseTraversal('checkTraversal needs the product\'s forEachRecord');
  }
  if (typeof accountId !== 'string' || accountId.length === 0) {
    throw refuseTraversal(
      'checkTraversal needs the accountId whose wraps are being walked: the holder-scoped check ' +
        'IS "keyWraps[accountId] is present", and there is nothing to look for without one',
    );
  }

  const first = await collect(forEachRecord, accountId);

  const seen = new Set<string>();
  for (const head of first) {
    assertHead(scope, head);
    if (!hasWrap(head.keyWraps, accountId)) {
      throw refuseTraversal(
        `the traversal yielded record '${head.record.path}', on which account '${accountId}' holds ` +
          'no wrap. forEachRecord(accountId) means THE RECORDS THIS ACCOUNT HOLDS A WRAP ON, not ' +
          'the records it owns. An ownership query misses every record shared TO this account, and ' +
          'a rotation that misses one erases the old wrap and destroys that access silently',
        head.record.path,
      );
    }
    if (seen.has(head.record.path)) {
      throw refuseTraversal(
        `the traversal yielded record '${head.record.path}' twice; each record must be yielded ` +
          'exactly once, or its second write races its own first',
        head.record.path,
      );
    }
    seen.add(head.record.path);
  }

  const second = await collect(forEachRecord, accountId);
  const firstPaths = first.map((h) => h.record.path);
  const secondPaths = second.map((h) => h.record.path);
  if (firstPaths.length !== secondPaths.length) {
    throw refuseTraversal(
      `two runs of the traversal yielded ${firstPaths.length} and ${secondPaths.length} records; ` +
        'a traversal without a deterministic total order cannot be resumed after a crash',
    );
  }
  for (let i = 0; i < firstPaths.length; i += 1) {
    if (firstPaths[i] !== secondPaths[i]) {
      throw refuseTraversal(
        `two runs of the traversal disagreed at position ${i}: '${firstPaths[i]}' then ` +
          `'${secondPaths[i]}'. The order must be total and deterministic`,
        firstPaths[i],
      );
    }
  }

  // 5. Resume — only where the product opted into it by carrying a cursor on every head.
  if (first.length >= 2 && first.every((h) => typeof h.cursor === 'string' && h.cursor.length > 0)) {
    const resumed = await collect(forEachRecord, accountId, first[0].cursor);
    const resumedPaths = resumed.map((h) => h.record.path);
    const expected = firstPaths.slice(1);
    if (resumedPaths.length !== expected.length) {
      throw refuseTraversal(
        `resuming from the first head's cursor yielded ${resumedPaths.length} records where ` +
          `${expected.length} follow it. \`from\` resumes STRICTLY AFTER the head whose cursor it was`,
      );
    }
    for (let i = 0; i < expected.length; i += 1) {
      if (resumedPaths[i] !== expected[i]) {
        throw refuseTraversal(
          `resuming from the first head's cursor yielded '${resumedPaths[i]}' where '${expected[i]}' ` +
            'was expected. The union of a paged run must equal the unpaged run',
          expected[i],
        );
      }
    }
  }

  // 6. A throw aborts.
  if (first.length >= 1) {
    const marker = new Error('checkTraversal: the visitor throws here on purpose');
    let visited = 0;
    let thrown: unknown = null;
    try {
      await forEachRecord(accountId, async () => {
        visited += 1;
        throw marker;
      });
    } catch (err) {
      thrown = err;
    }
    if (thrown !== marker) {
      throw refuseTraversal(
        'the traversal swallowed the visitor\'s error. A visitor that throws must abort the walk: ' +
          'swallowing it turns a failed rewrap into a job that reports success',
      );
    }
    if (visited !== 1) {
      throw refuseTraversal(
        `the traversal visited ${visited} records after the first visitor threw; it must be ` +
          'sequential and awaited, so a throw stops it at the record that failed',
      );
    }
  }
}

async function collect(
  forEachRecord: ForEachRecord,
  accountId: string,
  from?: string,
): Promise<readonly RecordHead[]> {
  const heads: RecordHead[] = [];
  await forEachRecord(
    accountId,
    async (head: RecordHead): Promise<void> => {
      if (head === null || typeof head !== 'object') {
        throw refuseTraversal('the traversal yielded something that is not a RecordHead');
      }
      heads.push(head);
    },
    from,
  );
  return heads;
}

function refuseTraversal(message: string, scopePath?: string): ContentCryptoError {
  return new ContentCryptoError(
    'VALIDATION_ERROR',
    `checkTraversal: ${message}`,
    scopePath === undefined ? undefined : { scopePath },
  );
}

// ---------------------------------------------------------------------------
// The wrap-commit conformance suite
// ---------------------------------------------------------------------------

/** ±24 h. Generous on purpose, and for the reason `assertReceipts` gives in `content-crypto.ts`:
 *  clock skew between a store and this process must never be the failure this check reports. */
const COMMIT_SKEW_MS = 24 * 60 * 60 * 1000;

/**
 * What `checkWrapCommit` needs from the product, on top of the committer itself.
 *
 * **Two members, deliberately** (R12): the independent read used to live here and now lives on
 * `WrapCommitter.readWraps`, because the package itself reads the wraps back on every create and a
 * reader the product only supplies to its tests would be a reader nobody runs in production. What
 * is left is what a conformance run needs and a production run does not — two throwaway records,
 * and a way to put them back. That is what makes the whole call about three lines:
 *
 * ```ts
 * await checkWrapCommit(scope, myWrapCommitter, {
 *   records: [recordRefFor('p_conformance_1'), recordRefFor('p_conformance_2')],
 *   reset: async () => { await db.doc('projects/p_conformance_1').delete();
 *                        await db.doc('projects/p_conformance_2').delete(); },
 * });
 * ```
 */
export interface WrapCommitHarness {
  /** Two DISTINCT records this check may write to and then throw away. Two, because a one-record
   *  check cannot see a committer that returns receipts in the wrong order. */
  readonly records: readonly [RecordRef, RecordRef];
  /** Remove whatever the last run wrote, so a re-run starts from a record with no wraps. */
  reset(): Promise<void>;
}

/**
 * **The conformance suite a product runs against ITS OWN `WrapCommitter`, in its own repo, as a
 * REQUIRED step of adoption (R12).**
 *
 * *A product's adoption of this package is not complete until this function passes in that
 * product's own CI.* Not recommended — required, and for a reason that survives R11: the package's
 * own read-back (`content-crypto.ts`) makes DURABILITY structural and continuous, on every create,
 * for ever. It does not and cannot make **create-only semantics**, **precondition rejection** or
 * **the non-vacuity of the reader** structural, because all three are properties of a second call
 * or of the reader itself. Those are covered by this suite ALONE. The two are complementary and
 * neither is sufficient: read-back catches the committer that writes nothing; this catches the
 * committer that writes over somebody else's key, which read-back cannot see because it finds a
 * wrap either way.
 *
 * Running it is three lines — the committer is the product's own, and the harness is two records
 * and a `reset`; see `WrapCommitHarness` for the call, verbatim. Wire it as a test in the same
 * suite that wires the committer, and run it against an emulator or a real store: it cleans up
 * after itself.
 *
 * It takes the product's resolved `ContentKeyScope` for the same reason `checkTraversal` does — that is
 * where a record type becomes a granularity, and a granularity is compared in one file — and two
 * of the product's own records to write to.
 *
 * It ships as a helper rather than as a suite here for the same reason `checkTraversal` does: what
 * it checks is a write this package cannot see, in a store this package must not know about.
 *
 * What it asserts, in order, each refusal naming the consequence rather than the rule:
 *
 *  1. **Durability, and the SAME wrap** — after `commitWraps` RESOLVES, `readWraps` sees the wrap
 *     it was handed: the same ciphertext AND the same generation. *A committer that enqueues into
 *     a batch fails here*, which is the whole point. The package now makes the same check on every
 *     create; this one also proves the pair is honest about a record it has just been asked about
 *     twice. The generation is compared because `gen` chooses the account DEK a reader fetches and
 *     is bound into the wrap's AAD (`record-key.ts`): a row built by hand from two fields, or a
 *     store that "helpfully" stamps the account's current generation, persists the right
 *     ciphertext under the wrong `gen` and stores something that is not the wrap that was
 *     committed. Compared on the ciphertext alone it passes here and then fails
 *     `RECORD_KEY_UNWRAP_FAILED` the first time anybody reopens the record.
 *  2. **Not before** — the independent read sees nothing on a record with no wraps. Asserted
 *     BEFORE the commit rather than during it: "nothing observable while the call is in flight" is
 *     a race against a store doing exactly what it was asked to, and a flaky gate gets deleted.
 *     What this clause is really for is (1)'s non-vacuity — a `readWraps` that always returns
 *     something would make (1) pass for a committer that wrote nothing.
 *  3. **Create-only** — a second `commitWraps` for the same record REJECTS, `isPreconditionFailure`
 *     says `true` of that rejection, and the first wrap is still what the record holds. This is the
 *     clause that fails a committer built on a batch writer which retries row by row and counts a
 *     lost precondition as "already done" — right for a content row, and a shredder here.
 *  4. **Positional** — n requests produce n receipts, in order, each acknowledging the right
 *     record, and n records produce n answers from `readWraps`. A misrouted wrap is durable in a
 *     place no reader looks, and a short answer to a page is where a partial commit hides.
 *  7. **The page is not the committer's to mutate** — the array of requests is handed over
 *     `Object.freeze`d, exactly as the package hands it over. A committer that sorts the page by
 *     path before writing it, splices off the entries it has dealt with, or reuses the array as a
 *     scratch buffer tells no lie and writes every wrap durably — and the caller re-indexes that
 *     array positionally, for the read-back and for each record's `committedUpdate`, so a
 *     reordered page hands a record ANOTHER record's wrap and both become permanently unreadable.
 *     Nothing else here can see it: every wrap genuinely landed, so (1) is satisfied on both
 *     records. Sort a COPY — `[...requests].sort(…)` — which this suite accepts and is the only
 *     thing it ever asked for.
 *
 *     **`sort`, `splice`, `push` and a strict-mode assignment all throw**, and that is what this
 *     clause reports. A bare `requests[1] = requests[0]` inside a committer that is NOT in strict
 *     mode fails SILENTLY instead — so the freeze turns it from a shred into a no-op and there is
 *     nothing left for this suite to report. That is the freeze doing its job rather than a gap,
 *     but it does mean a clause of this kind can never be a CHECK that the page came back
 *     unchanged: after `Object.freeze` it always has.
 *  8. **The receipts are not the committer's to tidy afterwards** — (7) with the port turned
 *     round. `commitWraps` commonly returns an array the committer keeps, and the caller re-reads
 *     it POSITIONALLY several awaits later: the package validates the receipts, reads the wraps
 *     back through `readWraps`, and only then assembles `receipt: receipts[i]`. A committer that
 *     reverses, sorts or splices that array in between — tidying its own books, nothing false
 *     said — hands every record another record's receipt, and `WrapReceipt.precondition` is *the
 *     precondition token for the row as it now stands*, so the content write that follows carries
 *     a token belonging to a different record.
 *
 *     This clause is the only place it can be seen. The array is the COMMITTER'S, so no caller can
 *     freeze it; the package defends itself with a copy instead, on every create. That copy closes
 *     the ordering half and **is shallow**: the receipt OBJECTS are never cloned, so one receipt
 *     reused across calls, or a field written onto it after the fact, still reaches the caller as
 *     it stands. So this suite re-reads the receipts at the END of the run — three port calls and
 *     a `reset` later, more awaits than a create ever passes — and compares them against what was
 *     handed over. Build each receipt fresh and return an array you do not keep.
 *  5. **Receipts** — every `committedAt` parses as an instant, and moves forward across two calls.
 *     A fixed literal is the tell of a committer that invented one because the signature asked.
 *  6. **No key material** in any receipt, because the receipt reaches the audit trail.
 *
 * What it does NOT and cannot check is stated in the refusals rather than hidden, and is
 * ENUMERATED rather than counted — for the reason the residue list in `content-crypto.ts` gives: a
 * number in prose is a claim somebody has to keep in sync with a list, and this package has had
 * one go stale twice. A further gap joins this list by being written here; nothing else moves.
 *
 *  - **A pending caller transaction.** The package cannot see one. A committer enlisted in a
 *    caller's transaction seals inside a commit that has not happened, and a retried callback
 *    mints twice.
 *  - **A receipt that corresponds to a real write** rather than a convincing one. Nothing readable
 *    from here separates the two.
 *  - **A genuinely independent `readWraps`.** A reader that lies in step with its writer defeats
 *    this suite and the package's own read-back alike — the residue reduced to two deliberate
 *    falsehoods rather than removed.
 */
export async function checkWrapCommit<RT extends string>(
  scope: ResolvedScope<RT>,
  committer: WrapCommitter,
  harness: WrapCommitHarness,
): Promise<void> {
  if (committer === null || typeof committer !== 'object'
    || typeof committer.commitWraps !== 'function'
    || typeof committer.readWraps !== 'function'
    || typeof committer.isPreconditionFailure !== 'function') {
    throw refuseCommit(
      'checkWrapCommit needs the product\'s WrapCommitter — commitWraps, readWraps and '
        + 'isPreconditionFailure. `readWraps` must be an INDEPENDENT, uncached read: one served '
        + 'from the committer\'s own pending batch would pass an enqueue-only committer, which is '
        + 'the one this suite exists to fail',
    );
  }
  if (harness === null || typeof harness !== 'object'
    || typeof harness.reset !== 'function'
    || !Array.isArray(harness.records) || harness.records.length !== 2) {
    throw refuseCommit(
      'checkWrapCommit needs a harness with two distinct records and a reset — and nothing else, '
        + 'because the read it used to carry now lives on the committer, where production uses it',
    );
  }
  const [first, second] = harness.records;
  // The scope is a parameter for the same reason `checkTraversal` takes one: it is where a record
  // type becomes a granularity, and granularity is decided in ONE file. It also means the check
  // writes records of the PRODUCT'S own shape rather than a plausible-looking invention.
  for (const record of harness.records) scope.assertRecord(record);
  if (first.path === second.path) {
    throw refuseCommit(
      'checkWrapCommit needs two DISTINCT records: a one-record check cannot see a committer '
        + 'that returns its receipts in the wrong order, and a misrouted wrap is durable where no '
        + 'reader looks',
    );
  }

  /**
   * One record at a time, through the PLURAL port. The length check is not ceremony: a reader that
   * answers a different number of records than it was asked about cannot be matched to them
   * positionally, and every assertion below is positional.
   */
  const readOne = async (record: RecordRef): Promise<unknown> => {
    const answers = await committer.readWraps([record]);
    if (!Array.isArray(answers) || answers.length !== 1) {
      throw refuseCommit(
        `readWraps answered ${Array.isArray(answers) ? `${answers.length} time(s)` : 'with a non-array'} `
          + 'for 1 record. One answer per record, in the same order, the same length — a caller '
          + 'matches an answer to the record it is about by POSITION and by nothing else',
        record.path,
      );
    }
    return answers[0];
  };

  await harness.reset();

  // (2) Non-vacuity for (1). If this already reports wraps, everything below is meaningless.
  for (const record of [first, second]) {
    if (wrapCount(parseKeyWraps(await readOne(record))) !== 0) {
      throw refuseCommit(
        `after reset() the independent read still reports wraps on '${record.path}'. Every `
          + 'assertion below compares "before" against "after", so a read that always answers '
          + 'something would pass a committer that wrote nothing at all',
        record.path,
      );
    }
  }

  const one = buildCommitRequest(scope, first, 'checkWrapCommit_owner');
  const two = buildCommitRequest(scope, second, 'checkWrapCommit_owner');

  // (7) The page is handed over FROZEN, exactly as `mintAndCommit` hands it over, so a committer
  // that sorts or splices it in place fails here rather than in a product's first migration.
  const page: readonly WrapCommitRequest[] = Object.freeze([one.request, two.request]);

  const startedAt = Date.now();
  const receipts = await commitPage(committer, page);
  const settledAt = Date.now();

  // (8) What was handed over, kept for the comparison at the end of the run. Both halves are
  // recorded: the ARRAY, whose order is what a positional caller depends on, and the two FIELDS of
  // each receipt, which the package's own defensive copy does not protect because that copy is
  // shallow. Neither is read again until everything else here has run.
  const handedOver: readonly (WrapReceipt | null)[] = receipts.map((receipt) => receipt ?? null);
  const handedOverFields = handedOver.map((receipt) => ({
    committedAt: receipt?.committedAt,
    precondition: receipt?.precondition,
  }));

  // (4) Positional.
  if (!Array.isArray(receipts) || receipts.length !== 2) {
    throw refuseCommit(
      `commitWraps returned ${Array.isArray(receipts) ? `${receipts.length} receipt(s)` : 'a non-array'} `
        + 'for 2 requests. One receipt per request, in the same order: a caller matches a receipt '
        + 'to the record it acknowledges by POSITION and by nothing else',
    );
  }

  // (5) and (6).
  const times: number[] = [];
  for (let i = 0; i < 2; i += 1) {
    const receipt = receipts[i] as Partial<WrapReceipt> | null;
    const at = `receipt ${i} (record '${harness.records[i].path}')`;
    if (receipt === null || typeof receipt !== 'object') {
      throw refuseCommit(`commitWraps returned no object as ${at}`);
    }
    const parsed = typeof receipt.committedAt === 'string' ? Date.parse(receipt.committedAt) : NaN;
    if (Number.isNaN(parsed)) {
      throw refuseCommit(
        `${at} carries no committedAt that parses as an instant. A batch that has not flushed has `
          + 'no write time to report, which is why the receipt is the shape it is: a committer '
          + 'that has to INVENT one is a committer that has not committed',
        harness.records[i].path,
      );
    }
    if (Math.abs(parsed - startedAt) > COMMIT_SKEW_MS) {
      throw refuseCommit(
        `${at} reports a committedAt more than 24 hours from this write ('${String(receipt.committedAt)}'). `
          + 'The window is generous on purpose — clock skew between a store and this process must '
          + 'never be the failure — so what it catches is a FIXED value: a literal, the epoch, or '
          + 'a copy-pasted example standing in for a write time the committer does not have',
        harness.records[i].path,
      );
    }
    times.push(parsed);
    try {
      assertNoKeyMaterial(receipt, at);
    } catch {
      throw refuseCommit(
        `${at} carries key material. A receipt reaches the audit trail, so a store that echoes the `
          + 'row back puts a wrapped record key into a log by way of a field nobody thought of as '
          + 'carrying any',
        harness.records[i].path,
      );
    }
  }

  // (1) DURABILITY. The one that matters, and the one an enqueue-only committer fails. Read
  // PLURALLY, in one call, because that is the shape the package itself uses after a page commit.
  const seenBoth = await committer.readWraps([first, second]);
  if (!Array.isArray(seenBoth) || seenBoth.length !== 2) {
    throw refuseCommit(
      `readWraps answered ${Array.isArray(seenBoth) ? `${seenBoth.length} time(s)` : 'with a non-array'} `
        + 'for 2 records. One answer per record, in the same order, the same length: a partial '
        + 'answer to a page is how a partial commit hides behind a full set of receipts',
    );
  }
  for (let i = 0; i < 2; i += 1) {
    const record = harness.records[i];
    const seen = parseKeyWraps(seenBoth[i]);
    if (!hasWrap(seen, 'checkWrapCommit_owner')) {
      throw refuseCommit(
        `commitWraps RESOLVED and an independent read of '${record.path}' still sees no wrap. The `
          + 'wrap must be COMMITTED, not merely enqueued: content is sealed under this key the '
          + 'moment this promise resolves, and a wrap sitting unflushed in a batch — or waiting on '
          + 'a caller transaction that has not committed — is content we have destroyed. Do not '
          + 'build a WrapCommitter on your BatchWriter',
        record.path,
      );
    }
    // (1), second half: the SAME wrap, not merely A wrap. Never the wrap string in a message — it
    // is wrapped key material and this text reaches a CI log — so the two fields are named and the
    // values are not.
    const committed = parseKeyWraps(page[i].keyWraps)['checkWrapCommit_owner'];
    const stored = seen['checkWrapCommit_owner'];
    if (stored.wrapped !== committed.wrapped || stored.gen !== committed.gen) {
      throw refuseCommit(
        `an independent read of '${record.path}' holds a DIFFERENT wrap than the one commitWraps `
          + `was handed (the ${stored.wrapped === committed.wrapped ? 'generation' : 'wrapped key'} `
          + 'differs). Persist the wrap ENTRY as it was given: `gen` chooses which account DEK a '
          + 'reader fetches and is bound into the wrap\'s own AAD, so the right ciphertext under '
          + 'the wrong generation is not the wrap that was committed — it passes a check that '
          + 'compares ciphertext alone, and then fails to unwrap the first time anybody reopens '
          + 'the record. Write request.update as it stands rather than rebuilding the row field by '
          + 'field, and do not let the store stamp a generation of its own',
        record.path,
      );
    }
  }

  // (3) CREATE-ONLY. A second key leaves everything under the first permanently unreadable.
  const again = buildCommitRequest(scope, first, 'checkWrapCommit_owner');
  let rejection: unknown = null;
  let rejected = false;
  try {
    await committer.commitWraps(Object.freeze([again.request]));
  } catch (err) {
    rejected = true;
    rejection = err;
  }
  // A `TypeError` out of a committer handed a frozen page is a page it tried to mutate, not a
  // precondition it lost — and reported as the latter it would send a reader to the wrong file.
  if (rejected && rejection instanceof TypeError) throw refusePageMutation();
  if (!rejected) {
    throw refuseCommit(
      `a second commitWraps on '${first.path}' was accepted. It must FAIL: the record already `
        + 'holds a key, and a second one leaves every value sealed under the first permanently '
        + 'unreadable. A batch writer that retries row by row and counts a lost precondition as '
        + '"already done" is right for a content row and is a shredder here',
      first.path,
    );
  }
  if (committer.isPreconditionFailure(rejection) !== true) {
    throw refuseCommit(
      `the second commitWraps on '${first.path}' rejected, but isPreconditionFailure() did not `
        + 'recognise the rejection. That classifier is what turns "somebody minted a key here '
        + 'first" into a 409 the caller can act on — re-read and ADOPT — rather than an opaque '
        + 'store error nobody can classify',
      first.path,
    );
  }
  const after = parseKeyWraps(await readOne(first));
  if (JSON.stringify(after) !== JSON.stringify(parseKeyWraps(one.request.keyWraps))) {
    throw refuseCommit(
      `the refused second commitWraps still changed the wraps on '${first.path}'. A refusal must `
        + 'leave the first key in place, or the refusal is a shred with an error message attached',
      first.path,
    );
  }

  // (5), second half: a real write time moves forward. A fixed literal does not.
  await harness.reset();
  const third = buildCommitRequest(scope, first, 'checkWrapCommit_owner');
  const [later] = await commitPage(committer, Object.freeze([third.request]));
  const laterAt = typeof later?.committedAt === 'string' ? Date.parse(later.committedAt) : NaN;
  if (Number.isNaN(laterAt) || laterAt < times[0] || Math.abs(laterAt - settledAt) > COMMIT_SKEW_MS) {
    throw refuseCommit(
      'a later commit reported a committedAt before an earlier one, or one nowhere near this '
        + 'write. A store\'s own write time moves forward and tracks the store\'s clock; a '
        + 'constant is the tell of a receipt invented to satisfy the signature',
      first.path,
    );
  }

  // (8) THE RETURN LEG OF (7). Read now rather than earlier, so everything the committer has been
  // asked to do since — a read-back, a refused second commit, a reset, another commit — has had
  // its chance to tidy the array it handed over at the top.
  if (receipts.length !== handedOver.length
    || receipts.some((receipt, i) => receipt !== handedOver[i])
    || handedOver.some((receipt, i) => receipt?.committedAt !== handedOverFields[i].committedAt
      || receipt?.precondition !== handedOverFields[i].precondition)) {
    throw refuseCommit(
      'the receipts commitWraps returned have CHANGED since it returned them — reordered, '
        + 'shortened, or a receipt\'s own fields rewritten. A receipt is matched to the record it '
        + 'acknowledges by POSITION and by nothing else, and WrapReceipt.precondition is the token '
        + 'for the row as it now stands, carried into the content write that follows without a '
        + 're-read — so a receipt that moves or changes after the fact puts one record\'s token on '
        + 'another record\'s write. The package takes a defensive copy of the ARRAY on every '
        + 'create, so an array tidied afterwards can no longer misroute a session; that copy is '
        + 'SHALLOW, and the receipt objects are yours, so one reused across calls or written to '
        + 'later reaches the caller as it stands. Build each receipt fresh and return an array you '
        + 'do not keep: `return requests.map(…)`',
    );
  }

  await harness.reset();
}

/**
 * Call `commitWraps` with a page the committer may not mutate, and name the failure if it tries.
 *
 * `Object.freeze` makes `sort` and `splice` throw a bare `TypeError` from inside the committer's
 * own code — which is the right place for it to happen and the wrong error for a product to read
 * in CI, because a `TypeError` says nothing about what the committer did wrong. This translates it
 * once, here, rather than leaving every adopting product to work it out. A store error is NOT
 * translated: it is rethrown as it arrived, because a committer that genuinely cannot write is a
 * different problem with a different fix.
 */
async function commitPage(
  committer: WrapCommitter,
  page: readonly WrapCommitRequest[],
): Promise<readonly WrapReceipt[]> {
  try {
    return await committer.commitWraps(page);
  } catch (err) {
    if (err instanceof TypeError) throw refusePageMutation();
    throw err;
  }
}

/** The one refusal both halves of assertion (7) report, written once so they cannot drift. */
function refusePageMutation(): ContentCryptoError {
  return refuseCommit(
    'commitWraps threw a TypeError on a page it was handed FROZEN, which is a committer trying to '
      + 'sort, splice or reassign the array of requests IN PLACE. The package freezes that array '
      + 'for the same reason this suite does: the caller re-indexes it positionally — for the '
      + 'read-back and for each record\'s committedUpdate — so a page mutated in place routes a '
      + 'record\'s wrap to ANOTHER record, and both are then permanently unreadable, with every '
      + 'wrap durably written and nothing false said by anybody. Sort or filter a COPY: '
      + '`[...requests].sort(…)`. If the TypeError came from somewhere else in the committer, it '
      + 'is still the committer\'s to fix',
  );
}

/**
 * A throwaway record key, wrapped for a throwaway account, so the check writes something of the
 * RIGHT SHAPE. A committer given `{}` would never exercise the store's field handling, and the
 * 94-character wrap is the thing whose absence assertion (1) is looking for.
 */
function buildCommitRequest<RT extends string>(
  scope: ResolvedScope<RT>,
  record: RecordRef,
  owner: string,
): { readonly request: WrapCommitRequest } {
  const dek: DekHandle = {
    generation: 1,
    key: dekFromBytes(randomBytes(KEY_BYTES), `checkWrapCommit/${owner}@1`),
  };
  const recordKey = mintRecordKey(record);
  try {
    const patch = planWraps({
      current: {},
      desired: { [owner]: dek },
      recordKey,
      productId: scope.productId,
      record,
      // Asked, never asserted: this module holds no granularity literal, because granularity is
      // decided in key-scope.ts and switched on in walk.ts and nowhere else (assertion 10).
      granularity: scope.granularityOf(record.type as RT),
      actorAccountId: owner,
      scope: 'this-record',
    });
    return {
      request: Object.freeze({
        record,
        ownerAccountId: owner,
        keyWraps: patch.wraps,
        wrapHolders: patch.holdersAfter,
        update: Object.freeze({
          [KEY_WRAPS_FIELD]: patch.wraps,
          [WRAP_HOLDERS_FIELD]: patch.holdersAfter,
        }),
        holderExists: false,
        audit: patch.audit,
      }),
    };
  } finally {
    // The check never seals anything, so the key has no further use. It is destroyed here rather
    // than left resident in a test process for the length of a suite.
    zeroise(recordKey);
  }
}

function refuseCommit(message: string, scopePath?: string): ContentCryptoError {
  return new ContentCryptoError(
    'VALIDATION_ERROR',
    `checkWrapCommit: ${message}`,
    scopePath === undefined ? undefined : { scopePath },
  );
}
