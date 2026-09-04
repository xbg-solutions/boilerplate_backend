/**
 * Rate limiter store resolution.
 *
 * The thing under test is WHICH Firestore database the default store talks
 * to, because projects on named databases have no `(default)` and a store
 * bound to it fails every request before authentication.
 */

const getFirestore: jest.Mock = jest.fn();
const getApp: jest.Mock = jest.fn(() => ({ name: 'mock-app' }));

jest.mock('firebase-admin/app', () => ({ getApp: (...a: any[]) => getApp(...a) }));
jest.mock('firebase-admin/firestore', () => ({ getFirestore: (...a: any[]) => getFirestore(...a) }));
jest.mock('../../utilities/logger', () => ({ logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

import {
  FirestoreRateLimitStore,
  createRateLimiter,
  createStrictRateLimiter,
  createPerUserRateLimiter,
} from '../rateLimit.middleware';

function fakeDb(label: string) {
  const doc = { delete: jest.fn().mockResolvedValue(undefined) };
  return {
    label,
    collection: jest.fn(() => ({ doc: jest.fn(() => doc) })),
    runTransaction: jest.fn(async (fn: (tx: any) => Promise<unknown>) =>
      fn({ get: jest.fn().mockResolvedValue({ data: () => undefined }), set: jest.fn(), update: jest.fn() })
    ),
    _doc: doc,
  };
}

beforeEach(() => {
  getFirestore.mockReset();
  getApp.mockClear();
});

describe('FirestoreRateLimitStore database resolution', () => {
  it('uses the (default) database when nothing is configured', async () => {
    const db = fakeDb('default');
    getFirestore.mockReturnValue(db);
    const store = new FirestoreRateLimitStore();
    await store.increment('k');
    expect(getFirestore).toHaveBeenCalledWith();
    expect(getApp).not.toHaveBeenCalled();
    expect(db.runTransaction).toHaveBeenCalled();
  });

  it('binds to the named database when databaseId is given', async () => {
    const db = fakeDb('named');
    getFirestore.mockReturnValue(db);
    const store = new FirestoreRateLimitStore({ databaseId: 'accounts' });
    await store.increment('k');
    expect(getApp).toHaveBeenCalledTimes(1);
    expect(getFirestore).toHaveBeenCalledWith({ name: 'mock-app' }, 'accounts');
    expect(db.runTransaction).toHaveBeenCalled();
  });

  it('prefers an explicit Firestore instance over databaseId', async () => {
    const mine = fakeDb('mine');
    const store = new FirestoreRateLimitStore({ firestore: mine as any, databaseId: 'ignored' });
    await store.resetKey('k');
    expect(getFirestore).not.toHaveBeenCalled();
    expect(mine._doc.delete).toHaveBeenCalled();
  });

  it('resolves lazily, so construction before initializeApp() is safe', () => {
    new FirestoreRateLimitStore({ databaseId: 'accounts' });
    expect(getFirestore).not.toHaveBeenCalled();
    expect(getApp).not.toHaveBeenCalled();
  });

  it('resolves once and reuses the instance', async () => {
    getFirestore.mockReturnValue(fakeDb('once'));
    const store = new FirestoreRateLimitStore({ databaseId: 'accounts' });
    await store.increment('a');
    await store.decrement('a');
    await store.resetKey('a');
    expect(getFirestore).toHaveBeenCalledTimes(1);
  });
});

describe('limiter factories pass database options through', () => {
  // express-rate-limit calls store.init() synchronously; the store's Firestore
  // handle is still lazy, so building the limiter must not touch Firestore.
  it.each([
    ['createRateLimiter', () => createRateLimiter({ databaseId: 'accounts' })],
    ['createStrictRateLimiter', () => createStrictRateLimiter({ databaseId: 'accounts' })],
    ['createPerUserRateLimiter', () => createPerUserRateLimiter(10, 1000, { databaseId: 'accounts' })],
  ])('%s does not resolve Firestore at construction', (_name, build) => {
    expect(build).not.toThrow();
    expect(getFirestore).not.toHaveBeenCalled();
  });

  it('an explicit store wins over databaseId', () => {
    const custom = { init: jest.fn(), increment: jest.fn(), decrement: jest.fn(), resetKey: jest.fn() };
    createRateLimiter({ store: custom as any, databaseId: 'accounts' });
    expect(custom.init).toHaveBeenCalled();
    expect(getFirestore).not.toHaveBeenCalled();
  });
});
