/**
 * `secret.ts` — the branded opaque key handles (§5.2).
 *
 * Two key types, one class. An `AccountDek` wraps record keys and touches content in exactly
 * one file (`legacy-readers.ts`); a `RecordKey` is what content is sealed under. They are the
 * same runtime shape and are kept apart by a phantom brand, so passing one where the other is
 * required is a compile error rather than a code review.
 *
 * WHAT THIS FILE IS FOR. Key bytes leak by accident, not by attack: a handle lands in a log
 * line, an error's `details`, a Cloud Tasks payload, an audit record, a snapshot assertion.
 * Every one of those is a serialiser, so the defence is to make every serialiser produce a
 * redaction. The measured table (§5.2, Node v22.20.0, identical at es2017 and es2022):
 *
 *   Object.keys(h) / getOwnPropertyNames(h)   []
 *   { ...h }                                  {}
 *   structuredClone(h)                        {}   — it does NOT throw
 *   util.inspect(h)                           [redacted dek collab/acc_1@3]
 *   JSON.stringify(h)                         "[redacted dek collab/acc_1@3]"
 *   `${h}`                                    [redacted dek collab/acc_1@3]
 *
 * THREE IMPLEMENTATION RULES CARRY THAT TABLE, and each is load-bearing rather than stylistic:
 *
 *  1. `kind`, `label`, `byteLength` and `destroyed` are PROTOTYPE GETTERS, never own data
 *     properties. As own fields the first two rows become
 *     `['kind','label','byteLength','destroyed']` and a populated spread — the public
 *     interface reads identically either way, which is exactly why the rule has to be
 *     written down rather than left to whoever edits this class next.
 *  2. `[util.inspect.custom]` is implemented. Without it `util.inspect` walks the private
 *     state and prints `SecretHandle [Secret] { … }`; `toString` alone does not reach it.
 *     That is the whole reason `node:util` is on this package's allowed-import list.
 *  3. The bytes live in a `#private` class field. At `target: es2017` TypeScript down-levels
 *     that to a module-scope `WeakMap`, which is no more reachable from outside this module
 *     than a native private field and is not an own property of the instance — so every row
 *     above holds identically in both trees.
 *
 * WHAT IS NOT DEFENDED, said plainly (§11.6.2): a determined caller in the same process.
 * `secretBytes` is module-private and the published `exports` map closes deep imports, but
 * the functions-tree mirror has no `exports` map, so `check-mirror.js` assertion (4) — a
 * scan, not the language — is what stops the reference app importing it. An inspector
 * session reads the private field regardless, and V8 may retain copies past `zeroise`. The
 * honest claim is that this stops key bytes reaching a log, an error bag, a queue payload or
 * an event payload BY ACCIDENT.
 *
 * `Secret.label` leaks tenancy, not key material: it carries `productId`, `accountId` and
 * `generation`, it is printed everywhere, it is never derived from the key bytes, and it is
 * never fed into an AAD.
 */

import { inspect } from 'node:util';

import { ContentCryptoError } from './errors';

/**
 * The phantom brand. Declared, never defined: no runtime object carries this property, which
 * is what makes `dekFromBytes`/`recordKeyFromBytes` (and, above them, the custodian and
 * `mintRecordKey`) the only routes to a value of these types.
 */
declare const SECRET_KIND: unique symbol;

/** 32 bytes of AES-256 key material. The bytes are not reachable through this interface. */
export interface Secret<K extends string> {
  readonly [SECRET_KIND]: K;          // phantom brand — an AccountDek cannot be passed as a RecordKey
  readonly kind: K;
  /** 'dek collab/acc_1@3' | 'record-key projects/p_1' — safe to print, and it is a LABEL:
   *  never derived from key bytes, never fed back into any AAD. */
  readonly label: string;
  readonly byteLength: 32;
  readonly destroyed: boolean;
  toJSON(): string;                   // '[redacted dek collab/acc_1@3]'
  toString(): string;                 // same
  readonly [Symbol.toStringTag]: string;
}

/** The account key. Wraps record keys. Touches CONTENT in exactly one file: legacy-readers.ts. */
export type AccountDek = Secret<'dek'>;
/** The key content is sealed under. Obtainable only by mintRecordKey or unwrapRecordKey. */
export type RecordKey = Secret<'record-key'>;

export const KEY_BYTES = 32 as const;
/** Random 96-bit IVs are safe to roughly 2^32 seals under one key. See §18 Q-IV. */
export const MAX_SEALS_PER_KEY = 2 ** 32;

/** `util.inspect.custom`, hoisted so the computed key below reads as one thing. */
const INSPECT_CUSTOM = inspect.custom;

/**
 * Compose the printed label from the kind and the caller's identity, so a handle can never be
 * built without one and two call sites cannot disagree about the shape.
 *
 * `'dek'` + `'collab/acc_1@3'` -> `'dek collab/acc_1@3'`; `'record-key'` + a record's
 * `path` -> `'record-key projects/p_1'`. An identity that already carries the prefix is
 * passed through rather than doubled — the two spellings are equally natural at a call site
 * and `'dek dek collab/acc_1@3'` in a production log is a puzzle nobody should have to solve.
 */
function composeLabel(kind: string, identity: string): string {
  if (typeof identity !== 'string' || identity.trim() === '') {
    throw new ContentCryptoError(
      'VALIDATION_ERROR',
      `A ${kind} handle needs a non-empty identity for its label; a handle that prints as nothing is a handle nobody can trace`,
    );
  }
  const trimmed = identity.trim();
  return trimmed.startsWith(`${kind} `) ? trimmed : `${kind} ${trimmed}`;
}

/**
 * The one class. Not exported: a `Secret` is an interface, the class is an implementation
 * detail, and `instanceof SecretHandle` is reachable only from inside this module.
 *
 * `implements Omit<Secret<K>, typeof SECRET_KIND>` is the compiler checking that the class
 * really does satisfy the published interface apart from the phantom brand, which no runtime
 * value can satisfy. Without it the casts in the constructors below would hide a divergence.
 */
class SecretHandle<K extends string> implements Omit<Secret<K>, typeof SECRET_KIND> {
  readonly #kind: K;

  readonly #label: string;

  readonly #bytes: Buffer;

  #destroyed = false;

  constructor(kind: K, identity: string, bytes: Buffer | Uint8Array) {
    // The label is composed first: its validation message is the one a caller sees when the
    // arguments were passed in the wrong order, and it must not depend on the bytes.
    const label = composeLabel(kind, identity);

    if (!(bytes instanceof Uint8Array)) {
      throw new ContentCryptoError(
        'VALIDATION_ERROR',
        `A ${kind} handle is built from bytes, not from a ${typeof bytes}`,
        { constructorName: safeConstructorName(bytes) },
      );
    }
    if (bytes.byteLength !== KEY_BYTES) {
      // The LENGTH may be stated — it is not key material, and being told "16" rather than
      // "wrong" is the difference between finding a truncated base64 decode in a minute and
      // in an afternoon. The bytes themselves never appear, here or anywhere else.
      throw new ContentCryptoError(
        'VALIDATION_ERROR',
        `A ${kind} handle needs exactly ${KEY_BYTES} bytes of key material; received ${bytes.byteLength}`,
      );
    }

    this.#kind = kind;
    this.#label = label;
    // COPIED, into an allocation of our own: `Buffer.alloc` does not draw from Node's shared
    // small-buffer pool, so `zeroise` wipes a region nothing else has a view of. The caller's
    // buffer is not retained, and a caller mutating or reusing theirs cannot reach ours —
    // which is what lets `fixedDekSource` accept a raw `Buffer` and keep nothing (§12.6).
    this.#bytes = Buffer.alloc(KEY_BYTES);
    this.#bytes.set(bytes);
  }

  // --- The four accessors. Prototype getters, deliberately: see rule 1 in the docblock. ---

  get kind(): K {
    return this.#kind;
  }

  get label(): string {
    return this.#label;
  }

  get byteLength(): 32 {
    return KEY_BYTES;
  }

  get destroyed(): boolean {
    return this.#destroyed;
  }

  get [Symbol.toStringTag](): string {
    return 'Secret';
  }

  // --- Every serialiser a handle can plausibly reach. ---

  toJSON(): string {
    return this.#redaction();
  }

  toString(): string {
    return this.#redaction();
  }

  [INSPECT_CUSTOM](): string {
    return this.#redaction();
  }

  #redaction(): string {
    return `[redacted ${this.#label}]`;
  }

  // --- The two module-private operations. Static, so they are reachable from the module
  // functions below (a `#private` field is visible only inside this class body) but never
  // from a handle a consumer holds: an instance method named `unsafeBytes()` would be one
  // `(h as any)` away, and a static on an unexported class is not. ---

  static read<K2 extends string>(handle: SecretHandle<K2>): Buffer {
    if (handle.#destroyed) {
      throw new ContentCryptoError(
        'KEY_MATERIAL_DESTROYED',
        `The key handle ${handle.#redaction()} has been zeroised and cannot be used again`,
      );
    }
    return handle.#bytes;
  }

  static wipe<K2 extends string>(handle: SecretHandle<K2>): void {
    if (handle.#destroyed) return;                    // idempotent: close() may be called twice
    handle.#bytes.fill(0);
    handle.#destroyed = true;
  }
}

/** The constructor name of an arbitrary value, without invoking anything on it. */
function safeConstructorName(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  const proto: unknown = Object.getPrototypeOf(value as object);
  if (proto === null || proto === undefined) return 'Object';
  const ctor = (proto as { constructor?: { name?: unknown } }).constructor;
  return typeof ctor?.name === 'string' ? ctor.name : 'Object';
}

/**
 * The bytes→key constructors. **Neither is on the barrel** — assertion (7) scans `index.ts`
 * for `/[Ff]romBytes|[Bb]ytesTo/` for exactly this reason. Key material enters the package
 * through the custodian (and, for a record key, through `mintRecordKey`) and nowhere else.
 *
 * `identity` is the tenancy part of the printed label: `'{productId}/{accountId}@{generation}'`
 * for a DEK, the record's `path` for a record key. It is never key material and never an AAD.
 */
export function dekFromBytes(bytes: Buffer | Uint8Array, identity: string): AccountDek {
  return new SecretHandle('dek', identity, bytes) as unknown as AccountDek;
}

export function recordKeyFromBytes(bytes: Buffer | Uint8Array, identity: string): RecordKey {
  return new SecretHandle('record-key', identity, bytes) as unknown as RecordKey;
}

/**
 * True for a handle this module built, and for nothing else — including a hand-rolled
 * look-alike with the same four getters. `errors.ts`'s `assertNoSecrets` leans on this as its
 * first rule, so a false positive here would be a refused error and a false negative a leaked
 * key: an identity test is the only answer with neither.
 */
export function isSecret(value: unknown): value is Secret<string> {
  return value instanceof SecretHandle;
}

/**
 * Whether `zeroise` has run. Strict rather than tolerant on a non-handle, because both total
 * answers are lies: `false` says "safe to use" of something that is not a key at all, and
 * `true` says a key was destroyed that never existed.
 */
export function isDestroyed(secret: Secret<string>): boolean {
  if (!isSecret(secret)) {
    throw new ContentCryptoError(
      'VALIDATION_ERROR',
      'isDestroyed expects a key handle',
      { constructorName: safeConstructorName(secret) },
    );
  }
  return (secret as unknown as SecretHandle<string>).destroyed;
}

/**
 * THE KIND REFUSAL (R14). A handle of the expected kind, live: the phantom brand says this at
 * compile time, and this says the same thing at runtime to a caller the compiler never saw — a
 * product's plain-JavaScript job script, a fixture, a `as unknown as RecordKey` that got through
 * review, a value that arrived from JSON.
 *
 * It lives HERE, beside the two kinds, and not in the module that first needed it. Until R14 it
 * was `record-key.ts`'s module-private helper guarding the wrap path; R14 gives the three content
 * codecs the same sentence to say, and a second spelling of it would be a second rule to disagree
 * about. The messages are byte-for-byte what they were, because they are what the wrap layer's
 * suite reads.
 *
 * **Why the refusal matters more in one direction than the other.** A record key doing the
 * wrapping produces a wrap no account DEK can ever open — bad, and loud at the next read. An
 * ACCOUNT DEK sealing content is worse and quiet: the value is well-formed `enc:v3:`, it opens
 * perfectly under that DEK, and there is no wrap anywhere on the record pointing at it, because a
 * DEK is never a `keyWraps` entry — `unwrapRecordKey` yields record keys and nothing else. The
 * content is therefore unreachable through every route this package offers, for ever, and nothing
 * false was said by anyone to get there. That is the data-loss shape, and it is what this refusal
 * exists to stop.
 */
export function assertKind(value: unknown, kind: 'dek' | 'record-key', what: string): void {
  if (!isSecret(value)) {
    throw new ContentCryptoError(
      'VALIDATION_ERROR',
      `${what} must be a key handle, received ${typeName(value)}`,
      { constructorName: value === null || value === undefined ? String(value) : typeof value },
    );
  }
  if (value.kind !== kind) {
    // An account DEK reaching a content codec, or a record key doing the wrapping, is the one
    // confusion the whole two-layer design exists to prevent. Name the kinds, never the bytes.
    throw new ContentCryptoError(
      'VALIDATION_ERROR',
      `${what} must be a ${kind} handle; received a ${value.kind} handle. An account DEK wraps ` +
        'record keys and a record key seals content: swapping them is not a mode, it is a bug',
    );
  }
}

/** `null` / `an array` / `a string`. The wrap layer's phrasing, moved here with `assertKind` so
 *  its messages did not change when the function did. */
function typeName(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  return `a ${typeof value}`;
}

/**
 * THE ACCESSOR. Module-private in the sense that matters: exported so `cipher.ts` and
 * `record-key.ts` can reach the bytes, never re-exported from `index.ts`, and unreachable
 * from a published consumer because the `exports` map closes deep imports.
 *
 * The LIVE buffer is returned, not a copy. A copy would be a second set of key bytes that
 * `zeroise` cannot reach and that outlives the handle — the opposite of the point. Callers
 * hand it straight to `createCipheriv` and hold no local beyond the call (§7.1).
 */
export function secretBytes(s: Secret<string>): Buffer {
  if (!isSecret(s)) {
    throw new ContentCryptoError(
      'VALIDATION_ERROR',
      'secretBytes expects a key handle',
      { constructorName: safeConstructorName(s) },
    );
  }
  return SecretHandle.read(s as unknown as SecretHandle<string>);
}

/**
 * Fill the bytes with zeroes and mark the handle destroyed. Every later `secretBytes` throws
 * `KEY_MATERIAL_DESTROYED`, which is what makes `session.close()` mean something.
 *
 * CALLED ON EXCLUSIVELY-OWNED MATERIAL ONLY — a `RecordKey` at `session.close()`. **A cached
 * `AccountDek` is never zeroised**: the cache hands one handle to concurrent callers, and
 * wiping a buffer a request is mid-decrypt with corrupts that request. That is a data-loss
 * bug traded for a heap-hygiene gesture V8 does not honour anyway (§5.2, §11.2).
 *
 * Not on the barrel either: a consumer holding a handle has no business destroying it, and
 * the two places that do (`close()` and `withRecord`) are inside the package.
 */
export function zeroise(secret: Secret<string>): void {
  if (!isSecret(secret)) {
    throw new ContentCryptoError(
      'VALIDATION_ERROR',
      'zeroise expects a key handle',
      { constructorName: safeConstructorName(secret) },
    );
  }
  SecretHandle.wipe(secret as unknown as SecretHandle<string>);
}
