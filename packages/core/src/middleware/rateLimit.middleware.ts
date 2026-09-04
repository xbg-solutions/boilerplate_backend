/**
 * Rate Limiting Middleware
 *
 * By default these limiters use a Firestore-backed shared store
 * (`FirestoreRateLimitStore`) so limits are enforced ACROSS all Cloud
 * Function/Cloud Run instances rather than per-instance in memory (the
 * express-rate-limit default, which resets on cold starts and does not
 * coordinate across concurrent instances).
 *
 * Trade-off: one Firestore transaction per request (~read+write cost + a few
 * ms latency). For high-traffic tenants, swap in Redis instead — install
 * `rate-limit-redis`, point it at the same Redis as the cache connector, and
 * pass it as the `store` option:
 *
 *   import RedisStore from 'rate-limit-redis';
 *   createRateLimiter({ store: new RedisStore({ sendCommand: (...a) => client.call(...a) }) })
 *
 * Named databases: the default store resolves Firestore lazily on first use.
 * Projects that have no `(default)` database MUST pass either `databaseId`
 * or a `firestore` instance, otherwise every counter read fails with
 * NOT_FOUND and, because the limiter is mounted ahead of the router, every
 * request 500s before authentication:
 *
 *   createApp({ rateLimit: { databaseId: 'accounts' } })
 */

import rateLimit, { Store, ClientRateLimitInfo, Options } from 'express-rate-limit';
import * as crypto from 'crypto';
import { getApp } from 'firebase-admin/app';
import { DocumentReference, Firestore, getFirestore } from 'firebase-admin/firestore';
import { MIDDLEWARE_CONFIG } from '../config/middleware.config';
import { logger } from '@xbg.solutions/utils-logger';

/** Constructor options for {@link FirestoreRateLimitStore}. */
export interface FirestoreRateLimitStoreOptions {
  /** Collection that holds the counters. Default `rateLimits`. */
  collection?: string;
  /** Key prefix, so several limiters can share one collection. Default `rl:`. */
  prefix?: string;
  /** Use this Firestore instance. Takes precedence over `databaseId`. */
  firestore?: Firestore;
  /** Named Firestore database id (e.g. `accounts`). Omit for `(default)`. */
  databaseId?: string;
}

/**
 * A shared, Firestore-backed store for express-rate-limit. Counts are kept in a
 * Firestore collection keyed by a hash of the client key, so every instance
 * sees the same counter. Fixed-window algorithm.
 */
export class FirestoreRateLimitStore implements Store {
  private windowMs = 60_000;
  private collectionName: string;
  private firestore?: Firestore;
  private databaseId?: string;
  prefix: string;

  constructor(opts: FirestoreRateLimitStoreOptions = {}) {
    this.collectionName = opts.collection ?? 'rateLimits';
    this.prefix = opts.prefix ?? 'rl:';
    this.firestore = opts.firestore;
    this.databaseId = opts.databaseId;
  }

  /**
   * Resolved lazily so the store can be constructed (typically at module load,
   * inside `createApp()`) before the consumer has called `initializeApp()`.
   */
  private get db(): Firestore {
    if (!this.firestore) {
      this.firestore = this.databaseId ? getFirestore(getApp(), this.databaseId) : getFirestore();
    }
    return this.firestore;
  }

  init(options: Options): void {
    this.windowMs = options.windowMs;
  }

  private docRef(key: string): DocumentReference {
    // Hash the key: it may contain characters that are invalid in a Firestore
    // document ID (IPv6 ':' / '/'), and hashing also bounds the length.
    const id = crypto.createHash('sha256').update(this.prefix + key).digest('hex');
    return this.db.collection(this.collectionName).doc(id);
  }

  async increment(key: string): Promise<ClientRateLimitInfo> {
    const ref = this.docRef(key);
    const nowMs = Date.now();
    return this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const data = snap.data();
      let totalHits: number;
      let resetTimeMs: number;
      if (!data || typeof data.resetTimeMs !== 'number' || nowMs > data.resetTimeMs) {
        // New window
        totalHits = 1;
        resetTimeMs = nowMs + this.windowMs;
      } else {
        totalHits = (data.totalHits ?? 0) + 1;
        resetTimeMs = data.resetTimeMs;
      }
      tx.set(ref, { totalHits, resetTimeMs });
      return { totalHits, resetTime: new Date(resetTimeMs) };
    });
  }

  async decrement(key: string): Promise<void> {
    const ref = this.docRef(key);
    await this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const data = snap.data();
      if (data && typeof data.totalHits === 'number' && data.totalHits > 0) {
        tx.update(ref, { totalHits: data.totalHits - 1 });
      }
    });
  }

  async resetKey(key: string): Promise<void> {
    await this.docRef(key).delete();
  }
}

/**
 * Options accepted by the limiter factories. Either swap the store entirely
 * (`store`), or point the default Firestore store at a specific database
 * (`databaseId` / `firestore`). `store` wins when both are given.
 */
export interface RateLimiterOptions {
  store?: Store;
  firestore?: Firestore;
  databaseId?: string;
}

function defaultStore(options: RateLimiterOptions, prefix?: string): Store {
  return options.store ?? new FirestoreRateLimitStore({
    prefix,
    firestore: options.firestore,
    databaseId: options.databaseId,
  });
}

/**
 * Create standard rate limiter
 */
export function createRateLimiter(options: RateLimiterOptions = {}) {
  return rateLimit({
    windowMs: MIDDLEWARE_CONFIG.rateLimit.windowMs,
    max: MIDDLEWARE_CONFIG.rateLimit.max,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: MIDDLEWARE_CONFIG.rateLimit.skipSuccessfulRequests,
    skipFailedRequests: MIDDLEWARE_CONFIG.rateLimit.skipFailedRequests,
    store: defaultStore(options),
    handler: (req, res) => {
      logger.warn('Rate limit exceeded', {
        ip: req.ip,
        path: req.path,
      });

      res.status(429).json({
        success: false,
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many requests, please try again later',
        },
      });
    },
  });
}

/**
 * Create strict rate limiter for sensitive endpoints
 */
export function createStrictRateLimiter(options: RateLimiterOptions = {}) {
  return rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // 5 requests per window
    standardHeaders: true,
    legacyHeaders: false,
    store: defaultStore(options, 'rl-strict:'),
    handler: (req, res) => {
      logger.warn('Strict rate limit exceeded', {
        ip: req.ip,
        path: req.path,
      });

      res.status(429).json({
        success: false,
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many attempts, please try again later',
        },
      });
    },
  });
}

/**
 * Create per-user rate limiter
 */
export function createPerUserRateLimiter(max = 100, windowMs = 15 * 60 * 1000, options: RateLimiterOptions = {}) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    store: defaultStore(options, 'rl-user:'),
    keyGenerator: (req) => {
      const user = (req as any).user;
      return user?.uid || req.ip || 'anonymous';
    },
    handler: (req, res) => {
      logger.warn('Per-user rate limit exceeded', {
        userId: (req as any).user?.uid,
        ip: req.ip,
        path: req.path,
      });

      res.status(429).json({
        success: false,
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many requests, please try again later',
        },
      });
    },
  });
}
