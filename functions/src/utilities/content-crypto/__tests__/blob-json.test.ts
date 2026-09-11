/**
 * `blob-json.test.ts` — §16.4.
 *
 * The serialiser is pure, synchronous and has no crypto, which is what makes it the one
 * module that can be tested exhaustively, and why the build order puts it before anything
 * that seals bytes. Three things are being proved here, and only the first is a type-system
 * tour:
 *
 *  1. every row of §8.3's table, in three directions — `encodeBlob` accepts it, `decodeBlob`
 *     returns it, and `blobRoundTrips` agrees IN ADVANCE about which documented asymmetry
 *     applies;
 *  2. the refusals are refusals, each naming a path and a constructor and never a value;
 *  3. the ceiling aborts DURING the walk, in bounded memory — the defect that takes a Cloud
 *     Function down rather than returning a 400.
 *
 * The generative round-trip uses `blobRoundTrips` as its ORACLE, asserted in BOTH
 * directions: a codec that quietly became lossless where the predicate says it is lossy is
 * as much a defect as the reverse, because the predicate is what callers branch on. The seed
 * list is fixed so a failure reproduces from the test name alone and CI never goes yellow;
 * `BLOB_FUZZ_SEEDS` widens it locally for a long soak before publishing.
 */

import { deflateRawSync } from 'node:zlib';

import {
  BLOB_SERIALISER_VERSION,
  BUILTIN_TAGS,
  DEFAULT_MAX_DEPTH,
  DEFAULT_MAX_SEALED_BYTES,
  blobRoundTrips,
  decodeBlob,
  decodeBlobBody,
  documentByteCost,
  encodeBlob,
  firestoreTimestampAdapter,
  maxPlaintextFor,
} from '../blob-json';
import type { BlobAdapter } from '../blob-json';
import { ContentCryptoError } from '../errors';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const KIND_JSON = 0x02;
const KIND_DEFLATE = 0x03;

const HEAD = `{"v":${BLOB_SERIALISER_VERSION},"d":`;

/** The whole plaintext body as text — everything after the kind byte. */
const bodyText = (plaintext: Buffer): string => plaintext.subarray(1).toString('utf8');

/** The encoded `d` fragment, with the envelope asserted rather than assumed. */
function payloadJson(plaintext: Buffer): string {
  const text = bodyText(plaintext);
  expect(text.slice(0, HEAD.length)).toBe(HEAD);
  expect(text.slice(-1)).toBe('}');
  return text.slice(HEAD.length, -1);
}

/** A hand-built plaintext, for the wires no encoder of ours would ever emit. */
const forge = (kind: number, json: string): Buffer =>
  Buffer.concat([Buffer.from([kind]), Buffer.from(json, 'utf8')]);

function caught(fn: () => unknown): ContentCryptoError {
  try {
    fn();
  } catch (err) {
    if (err instanceof ContentCryptoError) return err;
    throw err;
  }
  throw new Error('expected a ContentCryptoError; nothing was thrown');
}

// ---------------------------------------------------------------------------
// The wire
// ---------------------------------------------------------------------------

describe('the plaintext wire', () => {
  it('returns the COMPLETE plaintext, kind byte at index 0 (R14)', () => {
    const plaintext = encodeBlob({ a: 1 });
    expect(Buffer.isBuffer(plaintext)).toBe(true);
    expect(plaintext[0]).toBe(KIND_JSON);
    expect(bodyText(plaintext)).toBe('{"v":1,"d":{"a":1}}');
    // The spill path is `sealObject(key, ref, scopePath, encodeBlob(value))`: the whole
    // buffer, discriminator included, becomes the object body. Nothing may be stripped here.
    expect(plaintext.length).toBe(1 + Buffer.byteLength(bodyText(plaintext), 'utf8'));
  });

  it('carries the inner serialiser version, which is not the wire version', () => {
    expect(BLOB_SERIALISER_VERSION).toBe(1);
    expect(payloadJson(encodeBlob(null))).toBe('null');
  });

  it('reserves exactly six tags', () => {
    expect([...BUILTIN_TAGS]).toStrictEqual(['$n', '$u', '$i', '$d', '$b', '$x']);
  });
});

// ---------------------------------------------------------------------------
// §8.3 — the table, in three directions
// ---------------------------------------------------------------------------

interface Row {
  readonly name: string;
  readonly value: unknown;
  readonly wire: string;
  /** What `blobRoundTrips` must say IN ADVANCE. */
  readonly roundTrips: boolean;
}

const ROWS: readonly Row[] = [
  { name: 'null', value: null, wire: 'null', roundTrips: true },
  { name: 'true', value: true, wire: 'true', roundTrips: true },
  { name: 'false', value: false, wire: 'false', roundTrips: true },
  { name: 'the empty string', value: '', wire: '""', roundTrips: true },
  { name: 'a string', value: 'hello', wire: '"hello"', roundTrips: true },
  {
    name: 'a string that looks like ciphertext',
    value: 'enc:v3:AAAAAAAAAAAAAAAA:AA:AAAAAAAAAAAAAAAAAAAAAA==',
    wire: '"enc:v3:AAAAAAAAAAAAAAAA:AA:AAAAAAAAAAAAAAAAAAAAAA=="',
    roundTrips: true,
  },
  { name: 'a lone surrogate', value: '\uD800', wire: '"\\ud800"', roundTrips: true },
  { name: 'zero', value: 0, wire: '0', roundTrips: true },
  { name: 'a fraction', value: 1.5, wire: '1.5', roundTrips: true },
  { name: 'a negative', value: -12.25, wire: '-12.25', roundTrips: true },
  { name: 'an exponent', value: 1e21, wire: '1e+21', roundTrips: true },
  { name: 'the smallest double', value: Number.MIN_VALUE, wire: '5e-324', roundTrips: true },
  {
    name: 'an integer past 2^53, which stays a number',
    value: 9007199254740994,
    wire: '9007199254740994',
    roundTrips: true,
  },
  { name: 'minus zero', value: -0, wire: '{"$n":"-0"}', roundTrips: true },
  { name: 'NaN', value: NaN, wire: '{"$n":"NaN"}', roundTrips: true },
  { name: 'Infinity', value: Infinity, wire: '{"$n":"Infinity"}', roundTrips: true },
  { name: 'minus Infinity', value: -Infinity, wire: '{"$n":"-Infinity"}', roundTrips: true },
  { name: 'undefined', value: undefined, wire: '{"$u":0}', roundTrips: true },
  { name: 'a bigint', value: BigInt(123), wire: '{"$i":"123"}', roundTrips: true },
  {
    name: 'a bigint far past any double',
    value: -BigInt('1180591620717411303424'),
    wire: '{"$i":"-1180591620717411303424"}',
    roundTrips: true,
  },
  {
    name: 'a Date, to the millisecond',
    value: new Date('2026-09-10T04:05:06.007Z'),
    wire: '{"$d":"2026-09-10T04:05:06.007Z"}',
    roundTrips: true,
  },
  { name: 'the epoch', value: new Date(0), wire: '{"$d":"1970-01-01T00:00:00.000Z"}', roundTrips: true },
  { name: 'a Buffer', value: Buffer.from('hi', 'utf8'), wire: '{"$b":"aGk="}', roundTrips: true },
  { name: 'an empty Buffer', value: Buffer.alloc(0), wire: '{"$b":""}', roundTrips: true },
  {
    name: 'a Uint8Array — comes back a Buffer, asymmetry 1',
    value: new Uint8Array([1, 2, 3]),
    wire: '{"$b":"AQID"}',
    roundTrips: false,
  },
  { name: 'the empty array', value: [], wire: '[]', roundTrips: true },
  { name: 'the empty object', value: {}, wire: '{}', roundTrips: true },
  {
    name: 'undefined as an array element, which keeps the length',
    value: [1, undefined, 3],
    wire: '[1,{"$u":0},3]',
    roundTrips: true,
  },
  {
    name: 'undefined as an own property, which keeps the key',
    value: { a: undefined },
    wire: '{"a":{"$u":0}}',
    roundTrips: true,
  },
  {
    name: 'keys containing . [ ] a backtick and a newline',
    value: { 'a.b': 1, 'c[0]': 2, '`': 3, 'x\ny': 4 },
    wire: '{"a.b":1,"c[0]":2,"`":3,"x\\ny":4}',
    roundTrips: true,
  },
  { name: 'the empty key', value: { '': 1 }, wire: '{"":1}', roundTrips: true },
  {
    name: 'a nested mixture',
    value: { a: [{ b: null }, [BigInt(1), new Date(1000)]], c: { d: {} } },
    wire: '{"a":[{"b":null},[{"$i":"1"},{"$d":"1970-01-01T00:00:01.000Z"}]],"c":{"d":{}}}',
    roundTrips: true,
  },
];

describe('§8.3 the encoding table', () => {
  it.each(ROWS.map((r) => [r.name, r] as const))('%s — encodes to its wire', (_name, row) => {
    expect(payloadJson(encodeBlob(row.value))).toBe(row.wire);
  });

  it.each(ROWS.map((r) => [r.name, r] as const))('%s — blobRoundTrips agrees', (_name, row) => {
    expect(blobRoundTrips(row.value)).toBe(row.roundTrips);
  });

  it.each(ROWS.filter((r) => r.roundTrips).map((r) => [r.name, r] as const))(
    '%s — decodes back to itself',
    (_name, row) => {
      expect(decodeBlob(encodeBlob(row.value))).toStrictEqual(row.value);
    },
  );

  it('distinguishes a Buffer from a Uint8Array on the way back', () => {
    const fromBuffer = decodeBlob(encodeBlob(Buffer.from([1, 2, 3])));
    const fromView = decodeBlob(encodeBlob(new Uint8Array([1, 2, 3])));
    expect(Buffer.isBuffer(fromBuffer)).toBe(true);
    // Asymmetry 1, inherited from JavaScript rather than chosen: a Buffer IS a Uint8Array,
    // so the declared type is satisfied and `instanceof Buffer` becomes true where it was
    // false. Documented, and asserted rather than tolerated.
    expect(Buffer.isBuffer(fromView)).toBe(true);
    expect(fromView).toStrictEqual(Buffer.from([1, 2, 3]));
    expect(fromView).not.toStrictEqual(new Uint8Array([1, 2, 3]));
  });

  it('preserves a byte-array VIEW without widening it to its backing buffer', () => {
    const backing = Buffer.from([9, 9, 1, 2, 9, 9]);
    const view = backing.subarray(2, 4);
    expect(payloadJson(encodeBlob(view))).toBe('{"$b":"AQI="}');
  });

  it('round-trips every finite double it is handed', () => {
    const doubles = [
      0.1, 1 / 3, Math.PI, Number.EPSILON, Number.MAX_VALUE, -Number.MAX_VALUE,
      Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER, 1e-308, -5e-324,
    ];
    for (const d of doubles) {
      expect(Object.is(decodeBlob(encodeBlob(d)), d)).toBe(true);
    }
  });

  it('keeps -0 and 0 apart in every position', () => {
    expect(Object.is(decodeBlob(encodeBlob(-0)), -0)).toBe(true);
    expect(Object.is(decodeBlob(encodeBlob(0)), 0)).toBe(true);
    const back = decodeBlob(encodeBlob({ a: -0, b: [0, -0] })) as { a: number; b: number[] };
    expect(Object.is(back.a, -0)).toBe(true);
    expect(Object.is(back.b[0], 0)).toBe(true);
    expect(Object.is(back.b[1], -0)).toBe(true);
    expect(blobRoundTrips({ a: -0 })).toBe(true);
  });

  it('keeps an absent key and a present undefined key apart', () => {
    const present = decodeBlob(encodeBlob({ a: undefined })) as Record<string, unknown>;
    const absent = decodeBlob(encodeBlob({})) as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(present, 'a')).toBe(true);
    expect(present.a).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(absent, 'a')).toBe(false);
    // Asymmetry 3: the blob is MORE faithful than the store it sits in.
    expect(present).not.toStrictEqual(absent);
  });
});

// ---------------------------------------------------------------------------
// §8.3 — the escaping, which reserves no namespace from the consumer
// ---------------------------------------------------------------------------

describe('§8.3 the $ escaping', () => {
  const CASES: ReadonlyArray<readonly [string, unknown, string, unknown]> = [
    ['a single-key $d map', { $d: 1 }, '{"$$d":1}', { $d: 1 }],
    ['a single-key $$d map', { $$d: 1 }, '{"$$$d":1}', { $$d: 1 }],
    ['a $n key beside another', { $n: 1, other: 2 }, '{"$$n":1,"other":2}', { $n: 1, other: 2 }],
    ['a real NaN', NaN, '{"$n":"NaN"}', NaN],
    ['the empty object', {}, '{}', {}],
  ];

  it.each(CASES)('%s', (_name, value, wire, decoded) => {
    expect(payloadJson(encodeBlob(value))).toBe(wire);
    expect(decodeBlob(encodeBlob(value))).toStrictEqual(decoded);
  });

  it('is unambiguous at every depth', () => {
    const value = { a: [{ $u: { $x: 1 } }, { $b: 'not base64 at all' }] };
    expect(payloadJson(encodeBlob(value)))
      .toBe('{"a":[{"$$u":{"$$x":1}},{"$$b":"not base64 at all"}]}');
    expect(decodeBlob(encodeBlob(value))).toStrictEqual(value);
  });

  it('leaves a $-prefixed key alone when it is one of several', () => {
    const value = { $n: 'a', $d: 'b', plain: 'c' };
    expect(decodeBlob(encodeBlob(value))).toStrictEqual(value);
  });
});

// ---------------------------------------------------------------------------
// Prototype safety
// ---------------------------------------------------------------------------

describe('prototype safety', () => {
  it('decodes __proto__ as an own data property and pollutes nothing', () => {
    const payload = JSON.parse('{"__proto__":{"polluted":true},"ok":1}') as Record<string, unknown>;
    const back = decodeBlob(encodeBlob(payload)) as Record<string, unknown>;

    expect(Object.prototype.hasOwnProperty.call(back, '__proto__')).toBe(true);
    expect(Object.getOwnPropertyDescriptor(back, '__proto__')).toStrictEqual({
      value: { polluted: true }, writable: true, enumerable: true, configurable: true,
    });
    expect(Object.getPrototypeOf(back)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(back.ok).toBe(1);
  });

  it('does the same for a nested __proto__ and for a constructor key', () => {
    const payload = JSON.parse('{"a":{"__proto__":{"polluted":true},"constructor":1}}');
    const back = decodeBlob(encodeBlob(payload)) as { a: Record<string, unknown> };
    expect(Object.prototype.hasOwnProperty.call(back.a, '__proto__')).toBe(true);
    expect(back.a.constructor).toBe(1);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('accepts a null-prototype map, and says so when it comes back with a prototype', () => {
    const value = Object.create(null) as Record<string, unknown>;
    value.a = 1;
    expect(payloadJson(encodeBlob(value))).toBe('{"a":1}');
    const back = decodeBlob(encodeBlob(value)) as Record<string, unknown>;
    expect(back.a).toBe(1);
    expect(Object.getPrototypeOf(back)).toBe(Object.prototype);
    // A documented asymmetry, so the oracle must say `false` rather than shrug.
    expect(blobRoundTrips(value)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Depth
// ---------------------------------------------------------------------------

const deep = (n: number): unknown => (n === 0 ? 1 : { a: deep(n - 1) });

describe('depth', () => {
  it(`nests to ${DEFAULT_MAX_DEPTH}`, () => {
    expect(blobRoundTrips(deep(DEFAULT_MAX_DEPTH))).toBe(true);
  });

  it('throws at +1, naming the path and the depth', () => {
    const err = caught(() => encodeBlob(deep(DEFAULT_MAX_DEPTH + 1)));
    expect(err.code).toBe('BLOB_ENCODE_FAILED');
    expect(err.details.depth).toBe(DEFAULT_MAX_DEPTH + 1);
    expect(err.details.path).toBe(new Array(DEFAULT_MAX_DEPTH + 1).fill('a').join('.'));
  });

  it('counts arrays as depth too', () => {
    const arrayDeep = (n: number): unknown => (n === 0 ? 1 : [arrayDeep(n - 1)]);
    expect(blobRoundTrips(arrayDeep(DEFAULT_MAX_DEPTH))).toBe(true);
    expect(caught(() => encodeBlob(arrayDeep(DEFAULT_MAX_DEPTH + 1))).code)
      .toBe('BLOB_ENCODE_FAILED');
  });

  it('honours a lowered maxDepth', () => {
    expect(blobRoundTrips(deep(2), { maxDepth: 2 })).toBe(true);
    expect(caught(() => encodeBlob(deep(3), { maxDepth: 2 })).details.depth).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// §8.4 — refused loudly
// ---------------------------------------------------------------------------

class Widget {
  readonly n = 1;
}

describe('§8.4 refusals', () => {
  const REFUSED: ReadonlyArray<readonly [string, unknown, string]> = [
    ['a function', () => 1, 'Function'],
    ['a symbol', Symbol('s'), 'Symbol'],
    ['a Map', new Map([['a', 1]]), 'Map'],
    ['a Set', new Set([1]), 'Set'],
    ['a RegExp', /x/g, 'RegExp'],
    ['a Promise', Promise.resolve(1), 'Promise'],
    ['a class instance', new Widget(), 'Widget'],
    ['an invalid Date', new Date(NaN), 'Date'],
    ['an ArrayBuffer', new ArrayBuffer(4), 'ArrayBuffer'],
    ['a Float64Array', new Float64Array(2), 'Float64Array'],
  ];

  it.each(REFUSED)('refuses %s, naming the path and the constructor', (_n, value, ctor) => {
    const err = caught(() => encodeBlob({ a: [0, value] }));
    expect(err.code).toBe('BLOB_ENCODE_FAILED');
    expect(err.details.path).toBe('a[1]');
    expect(err.details.constructorName).toBe(ctor);
    // Never the value. An error message is a log line.
    expect(err.message).not.toContain('secret');
    expect(Object.keys(err.details).sort()).toStrictEqual(['constructorName', 'path']);
  });

  it.each(REFUSED)('blobRoundTrips returns false for %s rather than throwing', (_n, value) => {
    expect(blobRoundTrips(value)).toBe(false);
  });

  it('names a quoted segment when the key contains a dot', () => {
    const err = caught(() => encodeBlob({ 'a.b': new Map() }));
    expect(err.details.path).toBe('`a.b`');
  });

  it('names the root when the root itself is refused', () => {
    expect(caught(() => encodeBlob(new Map())).details.path).toBe('<root>');
  });

  it('detects a cycle through an object, naming the path', () => {
    const cyclic: Record<string, unknown> = { name: 'x' };
    cyclic.self = cyclic;
    const err = caught(() => encodeBlob(cyclic));
    expect(err.code).toBe('BLOB_ENCODE_FAILED');
    expect(err.details.path).toBe('self');
    expect(err.details.constructorName).toBe('Object');
    expect(err.message).toContain('circular');
  });

  it('detects a cycle through an array', () => {
    const arr: unknown[] = [1];
    arr.push(arr);
    const err = caught(() => encodeBlob(arr));
    expect(err.details.path).toBe('[1]');
    expect(err.details.constructorName).toBe('Array');
  });

  it('encodes a repeated reference that is not an ancestor', () => {
    const shared = { a: 1 };
    expect(payloadJson(encodeBlob({ x: shared, y: shared }))).toBe('{"x":{"a":1},"y":{"a":1}}');
    expect(blobRoundTrips({ x: shared, y: shared })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §8.4 — a Timestamp is refused, not coerced
// ---------------------------------------------------------------------------

/** Shaped like the class a product passes in. Named so `constructorName` is the real word. */
class Timestamp {
  constructor(readonly seconds: number, readonly nanoseconds: number) {}

  toDate(): Date {
    return new Date(this.seconds * 1000 + Math.floor(this.nanoseconds / 1e6));
  }
}

describe('§8.4 a Timestamp is refused, not coerced', () => {
  const stamp = new Timestamp(1789056306, 7_000_000);

  it('refuses it without an adapter, and says which adapter to register', () => {
    const err = caught(() => encodeBlob({ results: [{ createdAt: stamp }] }));
    expect(err.code).toBe('BLOB_ENCODE_FAILED');
    expect(err.details.path).toBe('results[0].createdAt');
    expect(err.details.constructorName).toBe('Timestamp');
    expect(err.message).toContain('is a Timestamp');
    expect(err.message).toContain('firestoreTimestampAdapter');
    expect(err.message).toContain('blobAdapters');
  });

  it('never silently becomes a Date', () => {
    expect(blobRoundTrips(stamp)).toBe(false);
    expect(() => encodeBlob(stamp)).toThrow(ContentCryptoError);
  });

  it('round-trips with its nanoseconds once the adapter is registered', () => {
    const adapters = [firestoreTimestampAdapter(Timestamp)];
    const value = { createdAt: stamp };

    expect(payloadJson(encodeBlob(value, { adapters })))
      .toBe('{"createdAt":{"$x":{"t":"ts","v":{"s":1789056306,"n":7000000}}}}');

    const back = decodeBlob(encodeBlob(value, { adapters }), { adapters }) as {
      createdAt: Timestamp;
    };
    expect(back.createdAt).toBeInstanceOf(Timestamp);
    expect(back.createdAt.seconds).toBe(1789056306);
    expect(back.createdAt.nanoseconds).toBe(7_000_000);
    expect(typeof back.createdAt.toDate).toBe('function');
    expect(blobRoundTrips(value, { adapters })).toBe(true);
  });

  it('matches a subclass, because the check is the prototype chain', () => {
    class Later extends Timestamp {}
    const adapters = [firestoreTimestampAdapter(Timestamp)];
    expect(payloadJson(encodeBlob(new Later(1, 2), { adapters })))
      .toBe('{"$x":{"t":"ts","v":{"s":1,"n":2}}}');
  });

  it('refuses a payload that is not {s,n} on the way back', () => {
    const adapters = [firestoreTimestampAdapter(Timestamp)];
    const err = caught(() => decodeBlob(forge(KIND_JSON, '{"v":1,"d":{"$x":{"t":"ts","v":1}}}'), {
      adapters,
    }));
    expect(err.code).toBe('CONTENT_DECRYPT_FAILED');
  });
});

// ---------------------------------------------------------------------------
// Adapters in general
// ---------------------------------------------------------------------------

const widgetAdapter: BlobAdapter = {
  t: 'widget',
  match: (v) => v instanceof Widget,
  encode: (v) => ({ n: (v as Widget).n }),
  decode: (p) => Object.assign(new Widget(), p),
};

describe('adapters', () => {
  it('runs AFTER the builtins, so it cannot shadow a Date', () => {
    const greedy: BlobAdapter = {
      t: 'greedy', match: () => true, encode: () => 'swallowed', decode: (p) => p,
    };
    expect(payloadJson(encodeBlob(new Date(0), { adapters: [greedy] })))
      .toBe('{"$d":"1970-01-01T00:00:00.000Z"}');
    expect(payloadJson(encodeBlob(Buffer.from([1]), { adapters: [greedy] })))
      .toBe('{"$b":"AQ=="}');
    expect(payloadJson(encodeBlob({ a: 1 }, { adapters: [greedy] }))).toBe('{"a":1}');
    expect(payloadJson(encodeBlob([1], { adapters: [greedy] }))).toBe('[1]');
    expect(payloadJson(encodeBlob(BigInt(1), { adapters: [greedy] }))).toBe('{"$i":"1"}');
  });

  it('takes the first match in declaration order', () => {
    const second: BlobAdapter = {
      t: 'second', match: (v) => v instanceof Widget, encode: () => 'no', decode: (p) => p,
    };
    expect(payloadJson(encodeBlob(new Widget(), { adapters: [widgetAdapter, second] })))
      .toBe('{"$x":{"t":"widget","v":{"n":1}}}');
    expect(payloadJson(encodeBlob(new Widget(), { adapters: [second, widgetAdapter] })))
      .toBe('{"$x":{"t":"second","v":"no"}}');
  });

  it('re-walks the adapter output, so a nested Date is tagged too', () => {
    const dated: BlobAdapter = {
      t: 'dated',
      match: (v) => v instanceof Widget,
      encode: () => ({ at: new Date(0) }),
      decode: (p) => p,
    };
    expect(payloadJson(encodeBlob(new Widget(), { adapters: [dated] })))
      .toBe('{"$x":{"t":"dated","v":{"at":{"$d":"1970-01-01T00:00:00.000Z"}}}}');
  });

  it('refuses an adapter whose output it would match again, naming the tag', () => {
    class Loopy {
      readonly x = 1;
    }
    const looping: BlobAdapter = {
      t: 'loop',
      match: (v) => typeof v === 'object' && v !== null
        && Object.prototype.hasOwnProperty.call(v, 'x'),
      encode: () => ({ x: 2 }),
      decode: (p) => p,
    };
    const err = caught(() => encodeBlob(new Loopy(), { adapters: [looping] }));
    expect(err.code).toBe('BLOB_ENCODE_FAILED');
    expect(err.message).toContain('loop');
    expect(err.message).toContain('not terminate');
  });

  it('rejects a tag containing the escape character, or the wrong length', () => {
    const bad = (t: string): BlobAdapter => ({ t, match: () => false, encode: (v) => v, decode: (v) => v });
    for (const t of ['a$b', '$', '', 'x'.repeat(33)]) {
      expect(caught(() => encodeBlob(1, { adapters: [bad(t)] })).code).toBe('VALIDATION_ERROR');
    }
    expect(payloadJson(encodeBlob(1, { adapters: [bad('x'.repeat(32))] }))).toBe('1');
  });

  it('rejects two adapters sharing a tag', () => {
    const err = caught(() => encodeBlob(1, { adapters: [widgetAdapter, widgetAdapter] }));
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.message).toContain('widget');
  });

  it('rejects an adapter missing a member', () => {
    const half = { t: 'half', match: () => false } as unknown as BlobAdapter;
    expect(caught(() => encodeBlob(1, { adapters: [half] })).code).toBe('VALIDATION_ERROR');
  });

  it('refuses to decode a tag no registered adapter claims', () => {
    const sealed = encodeBlob(new Widget(), { adapters: [widgetAdapter] });
    expect(decodeBlob(sealed, { adapters: [widgetAdapter] })).toBeInstanceOf(Widget);
    const err = caught(() => decodeBlob(sealed));
    expect(err.code).toBe('CONTENT_DECRYPT_FAILED');
    expect(err.message).toContain('widget');
  });
});

// ---------------------------------------------------------------------------
// The documented asymmetries
// ---------------------------------------------------------------------------

describe('the three asymmetries, asserted rather than smoothed over', () => {
  it('2 — integer-like string keys come back in numeric order', () => {
    const value = { b: 1, 0: 2 };
    // JavaScript's own own-property-order rule, obeyed by the object literal itself and by
    // `JSON.parse`. Any claim that key insertion order is preserved without this caveat is
    // false — so the wire already reads `0` first.
    expect(payloadJson(encodeBlob(value))).toBe('{"0":2,"b":1}');
    expect(Object.keys(decodeBlob(encodeBlob(value)) as object)).toStrictEqual(['0', 'b']);
    expect(blobRoundTrips(value)).toBe(true);
  });

  it('a sparse array comes back dense, and the oracle says so', () => {
    const sparse = [1, , 3] as unknown[];
    expect(payloadJson(encodeBlob(sparse))).toBe('[1,{"$u":0},3]');
    const back = decodeBlob(encodeBlob(sparse)) as unknown[];
    expect(back.length).toBe(3);
    expect(1 in back).toBe(true);
    expect(1 in sparse).toBe(false);
    expect(blobRoundTrips(sparse)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §8.5 — the ceiling, checked DURING the walk
// ---------------------------------------------------------------------------

describe('§8.5 maxPlaintextFor', () => {
  it('is the pinned number', () => {
    expect(maxPlaintextFor(DEFAULT_MAX_SEALED_BYTES)).toBe(674_960);
    expect(DEFAULT_MAX_SEALED_BYTES).toBe(900_000);
  });

  it('inverts §7.3s arithmetic exactly', () => {
    const sealedFor = (body: number): number => 49 + 4 * Math.ceil((1 + body) / 3);
    for (const limit of [53, 100, 1_000, 4_096, 900_000, 1_000_000]) {
      const body = maxPlaintextFor(limit);
      expect(sealedFor(body)).toBeLessThanOrEqual(limit);
      expect(sealedFor(body + 1)).toBeGreaterThan(limit);
    }
  });

  it('floors at zero rather than going negative', () => {
    expect(maxPlaintextFor(0)).toBe(0);
    expect(maxPlaintextFor(49)).toBe(0);
    expect(maxPlaintextFor(-1)).toBe(0);
    expect(maxPlaintextFor(Number.NaN)).toBe(0);
  });
});

describe('§8.5 the plaintext budget', () => {
  const LIMIT = 674_960;

  it('encodes a payload sitting exactly on the boundary', () => {
    // `{"v":1,"d":{"big":"<n x's>"}}` is n + 22 bytes.
    const value = { big: 'x'.repeat(LIMIT - 22) };
    const plaintext = encodeBlob(value);
    expect(plaintext.length - 1).toBe(LIMIT);
    expect(decodeBlob(plaintext)).toStrictEqual(value);
  });

  it('refuses one byte over, with the byte counts in details', () => {
    const err = caught(() => encodeBlob({ big: 'x'.repeat(LIMIT - 21) }));
    expect(err.code).toBe('BLOB_TOO_LARGE');
    expect(err.status).toBe(400);
    expect(err.details.plaintextBytes).toBe(LIMIT + 1);
    expect(err.details.limitBytes).toBe(LIMIT);
  });

  it('names the path of the value that crossed', () => {
    const err = caught(() => encodeBlob(
      { items: [{ transcript: 'x'.repeat(200) }] }, { maxPlaintextBytes: 100 },
    ));
    expect(err.code).toBe('BLOB_TOO_LARGE');
    expect(err.details.path).toBe('items[0].transcript');
    expect(err.details.limitBytes).toBe(100);
    expect(err.message).toContain('items[0].transcript');
  });

  it('aborts DURING the walk, in bounded memory', () => {
    // One megabyte, referenced sixty-four times: the PAYLOAD costs about a megabyte, while
    // a walk that ran to completion would hold sixty-four of them in chunks. This test must
    // fail if the abort is ever moved after the walk.
    const chunk = 'x'.repeat(1_000_000);
    const payload = { items: new Array(64).fill(chunk) };

    const before = process.memoryUsage().heapUsed;
    const err = caught(() => encodeBlob(payload));
    const after = process.memoryUsage().heapUsed;

    expect(err.code).toBe('BLOB_TOO_LARGE');
    expect(err.details.path).toBe('items[0]');
    expect(after - before).toBeLessThan(8 * 1024 * 1024);
  });

  it('counts the envelope, not just the leaves', () => {
    // `{"v":1,"d":1}` is thirteen bytes, so twelve is not enough room for the number 1.
    expect(caught(() => encodeBlob(1, { maxPlaintextBytes: 12 })).code).toBe('BLOB_TOO_LARGE');
    expect(encodeBlob(1, { maxPlaintextBytes: 13 }).length).toBe(14);
  });

  it('counts UTF-8 bytes, not characters', () => {
    // Four bytes on the wire for the astral character, plus two quotes.
    expect(encodeBlob('\u{1F600}').length - 1).toBe(HEAD.length + 6 + 1);
  });

  it('validates its options rather than silently taking them', () => {
    expect(caught(() => encodeBlob(1, { maxDepth: 0 })).code).toBe('VALIDATION_ERROR');
    expect(caught(() => encodeBlob(1, { maxDepth: 1.5 })).code).toBe('VALIDATION_ERROR');
    expect(caught(() => encodeBlob(1, { deflateOver: -1 })).code).toBe('VALIDATION_ERROR');
    expect(caught(() => encodeBlob(1, { maxPlaintextBytes: -1 })).code).toBe('VALIDATION_ERROR');
  });
});

// ---------------------------------------------------------------------------
// §8.7 — compression, and the read seam the addendum's finding 3 is about
// ---------------------------------------------------------------------------

describe('§8.7 compression', () => {
  const compressible = { rows: new Array(500).fill('the same line, over and over') };

  it('is off by default', () => {
    expect(encodeBlob(compressible)[0]).toBe(KIND_JSON);
  });

  it('fires above deflateOver and round-trips', () => {
    const plaintext = encodeBlob(compressible, { deflateOver: 100 });
    expect(plaintext[0]).toBe(KIND_DEFLATE);
    expect(plaintext.length).toBeLessThan(encodeBlob(compressible).length);
    expect(decodeBlob(plaintext)).toStrictEqual(compressible);
    expect(blobRoundTrips(compressible, { deflateOver: 100 })).toBe(true);
  });

  it('is discarded when it does not shrink the payload', () => {
    // A short, high-entropy value: deflate's own framing costs more than it saves.
    const value = 'Zm9vYmFyYmF6cXV4' + 'K3xhLWJ+YyEkJQ';
    const json = encodeBlob(value).subarray(1);
    expect(deflateRawSync(json).length).toBeGreaterThanOrEqual(json.length);
    expect(encodeBlob(value, { deflateOver: 1 })[0]).toBe(KIND_JSON);
  });

  it('stays below deflateOver without paying for a compressor', () => {
    expect(encodeBlob(compressible, { deflateOver: 10_000_000 })[0]).toBe(KIND_JSON);
  });

  it('decodeBlob and decodeBlobBody agree on a deflated payload', () => {
    // The whole of finding 3: the field read seam splits the kind byte out and hands both
    // halves on, and a blob's kind is a REAL branch that only the opened plaintext settles.
    const plaintext = encodeBlob(compressible, { deflateOver: 100 });
    expect(decodeBlobBody(plaintext[0], plaintext.subarray(1)))
      .toStrictEqual(decodeBlob(plaintext));
    const plain = encodeBlob(compressible);
    expect(decodeBlobBody(plain[0], plain.subarray(1))).toStrictEqual(decodeBlob(plain));
  });

  it('bounds the inflate when the caller states its own ceiling', () => {
    const plaintext = encodeBlob(compressible, { deflateOver: 100 });
    expect(caught(() => decodeBlob(plaintext, { maxPlaintextBytes: 10 })).code)
      .toBe('CONTENT_DECRYPT_FAILED');
  });
});

// ---------------------------------------------------------------------------
// Strict decode — never partial output
// ---------------------------------------------------------------------------

describe('decodeBlob is strict', () => {
  it('refuses an empty buffer', () => {
    expect(caught(() => decodeBlob(Buffer.alloc(0))).code).toBe('VALIDATION_ERROR');
  });

  it('refuses something that is not a buffer', () => {
    expect(caught(() => decodeBlob('{"v":1,"d":1}' as unknown as Buffer)).code)
      .toBe('VALIDATION_ERROR');
  });

  it('is CONTENT_KIND_MISMATCH on a 0x01 plaintext, not a JSON parse failure', () => {
    // A string field's plaintext opened at a blob path. The kind byte is what turns "a
    // silently wrong-typed value" into a refusal.
    const err = caught(() => decodeBlob(forge(0x01, '{"v":1,"d":1}')));
    expect(err.code).toBe('CONTENT_KIND_MISMATCH');
    expect(err.status).toBe(500);
  });

  it.each([0x00, 0x01, 0x04, 0x7f, 0xff])('refuses kind byte %i', (kind) => {
    expect(caught(() => decodeBlob(forge(kind, '{"v":1,"d":1}'))).code)
      .toBe('CONTENT_KIND_MISMATCH');
    expect(caught(() => decodeBlobBody(kind, Buffer.from('{"v":1,"d":1}'))).code)
      .toBe('CONTENT_KIND_MISMATCH');
  });

  const CORRUPT: ReadonlyArray<readonly [string, string]> = [
    ['a body that is not JSON', 'not json at all'],
    ['an unknown serialiser version', '{"v":2,"d":1}'],
    ['a missing d', '{"v":1}'],
    ['an array envelope', '[1,2]'],
    ['a null envelope', 'null'],
    ['a scalar envelope', '7'],
    ['an undefined tag carrying something else', '{"v":1,"d":{"$u":1}}'],
    ['a number tag with an unknown label', '{"v":1,"d":{"$n":"nope"}}'],
    ['a bigint tag that is not an integer', '{"v":1,"d":{"$i":"1.5"}}'],
    ['a bigint tag with a leading zero', '{"v":1,"d":{"$i":"01"}}'],
    ['a date tag that is not an instant', '{"v":1,"d":{"$d":"2026-09-10"}}'],
    ['a bytes tag that is not base64', '{"v":1,"d":{"$b":"!!!!"}}'],
    ['a bytes tag with non-canonical base64', '{"v":1,"d":{"$b":"AR=="}}'],
    ['an adapter tag that is not {t,v}', '{"v":1,"d":{"$x":{"t":"ts"}}}'],
    ['two keys that collapse to one', '{"v":1,"d":{"$a":1,"a":2}}'],
  ];

  it.each(CORRUPT)('refuses %s, with no partial output', (_name, json) => {
    const err = caught(() => decodeBlob(forge(KIND_JSON, json)));
    expect(err.code).toBe('CONTENT_DECRYPT_FAILED');
  });

  it('refuses a body that does not inflate', () => {
    expect(caught(() => decodeBlob(forge(KIND_DEFLATE, 'not deflate output'))).code)
      .toBe('CONTENT_DECRYPT_FAILED');
  });

  it('reads a hand-built wire that is well formed', () => {
    expect(decodeBlob(forge(KIND_JSON, '{"v":1,"d":{"a":[1,{"$u":0}]}}')))
      .toStrictEqual({ a: [1, undefined] });
  });
});

// ---------------------------------------------------------------------------
// §8.6 — documentByteCost
// ---------------------------------------------------------------------------

describe('§8.6 documentByteCost', () => {
  it('is 32 bytes of overhead over an empty field map', () => {
    expect(documentByteCost({})).toBe(32);
  });

  it('charges a field name plus one, and a string its bytes plus one', () => {
    expect(documentByteCost({ a: 'hi' })).toBe(32 + (1 + 1) + (2 + 1));
    expect(documentByteCost({ a: 'é' })).toBe(32 + 2 + 3);
  });

  it('charges the fixed sizes for the scalars', () => {
    expect(documentByteCost({ n: 1 })).toBe(32 + 2 + 8);
    expect(documentByteCost({ b: true })).toBe(32 + 2 + 1);
    expect(documentByteCost({ z: null })).toBe(32 + 2 + 1);
    expect(documentByteCost({ d: new Date(0) })).toBe(32 + 2 + 8);
    expect(documentByteCost({ x: Buffer.alloc(10) })).toBe(32 + 2 + 10);
    expect(documentByteCost({ u: undefined })).toBe(32 + 2);
  });

  it('sums a nested map and an array', () => {
    expect(documentByteCost({ m: { a: 1 } })).toBe(32 + 2 + (2 + 8));
    expect(documentByteCost({ a: [1, 2] })).toBe(32 + 2 + 16);
  });

  it('grows with a sealed value the way the per-document budget needs', () => {
    const sealed = 'enc:v3:'.padEnd(900_000, 'A');
    expect(documentByteCost({ blob: sealed })).toBeGreaterThan(900_000);
  });

  it('never throws — not on a cycle, not on a function, not on a symbol', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => documentByteCost(cyclic)).not.toThrow();
    expect(() => documentByteCost({ f: () => 1, s: Symbol('x') })).not.toThrow();
    expect(documentByteCost(undefined)).toBe(32);
  });
});

// ---------------------------------------------------------------------------
// The generative round-trip, with `blobRoundTrips` as the oracle
// ---------------------------------------------------------------------------

/** mulberry32 — four lines, no dependency, deterministic. Rule 4 of §16.3. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const KEYS = ['a', 'b', '$n', '$$d', '__proto__', 'a.b', '0', '', 'x\ny'];

function randomBlobValue(rand: () => number, depth: number): unknown {
  const pick = Math.floor(rand() * (depth >= 3 ? 12 : 14));
  switch (pick) {
    case 0: return null;
    case 1: return rand() < 0.5;
    case 2: return 'str' + Math.floor(rand() * 1e6).toString(36);
    case 3: return (rand() - 0.5) * 10 ** Math.floor(rand() * 40 - 20);
    case 4: return Math.floor(rand() * 1e9);
    case 5: return [-0, NaN, Infinity, -Infinity][Math.floor(rand() * 4)];
    case 6: return undefined;
    case 7: return BigInt(Math.floor(rand() * 1e15)) * BigInt(1000000);
    case 8: return new Date(Math.floor(rand() * 4e12));
    case 9: return Buffer.from([Math.floor(rand() * 256), Math.floor(rand() * 256)]);
    case 10: return new Uint8Array([Math.floor(rand() * 256)]);
    case 11: return '';
    case 12: {
      const n = Math.floor(rand() * 4);
      const out: unknown[] = [];
      for (let i = 0; i < n; i += 1) out.push(randomBlobValue(rand, depth + 1));
      return out;
    }
    default: {
      const n = Math.floor(rand() * 4);
      const out: Record<string, unknown> = {};
      for (let i = 0; i < n; i += 1) {
        // `defineProperty`, not assignment: `out.__proto__ = x` sets the prototype and
        // creates no key at all, so the generator would silently stop fuzzing the one key
        // the decoder has a rule about.
        Object.defineProperty(out, KEYS[Math.floor(rand() * KEYS.length)], {
          value: randomBlobValue(rand, depth + 1),
          writable: true,
          enumerable: true,
          configurable: true,
        });
      }
      return out;
    }
  }
}

describe('generative round-trip', () => {
  const SEEDS = Number(process.env.BLOB_FUZZ_SEEDS ?? 200);

  it.each(Array.from({ length: SEEDS }, (_, i) => i + 1))('seed %i round-trips', (seed) => {
    const value = randomBlobValue(rng(seed), 0);
    const back = decodeBlob(encodeBlob(value));
    if (blobRoundTrips(value)) expect(back).toStrictEqual(value);
    else expect(back).not.toStrictEqual(value);
  });

  it('generates both arms, so neither branch is vacuous', () => {
    let lossless = 0;
    let lossy = 0;
    for (let seed = 1; seed <= 200; seed += 1) {
      if (blobRoundTrips(randomBlobValue(rng(seed), 0))) lossless += 1;
      else lossy += 1;
    }
    expect(lossless).toBeGreaterThan(0);
    expect(lossy).toBeGreaterThan(0);
  });
});
