/**
 * Rate Limiting Middleware
 *
 * IMPORTANT: express-rate-limit uses an in-memory store by default.
 * In serverless environments (Cloud Functions), each instance has its own
 * memory and rate limits reset on cold starts. This means rate limiting
 * is per-instance and won't protect against distributed abuse at scale.
 *
 * For production hardening, replace the default store with a shared store:
 *   - Redis: use rate-limit-redis with the existing redis-cache-provider
 *   - Firestore: implement a custom store using firestore-connector
 *   - Firebase App Check: for client-side abuse prevention
 */

import rateLimit from 'express-rate-limit';
import { MIDDLEWARE_CONFIG } from '../config/middleware.config';
import { logger } from '@xbg.solutions/utils-logger';

/**
 * Create standard rate limiter
 */
export function createRateLimiter() {
  return rateLimit({
    windowMs: MIDDLEWARE_CONFIG.rateLimit.windowMs,
    max: MIDDLEWARE_CONFIG.rateLimit.max,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: MIDDLEWARE_CONFIG.rateLimit.skipSuccessfulRequests,
    skipFailedRequests: MIDDLEWARE_CONFIG.rateLimit.skipFailedRequests,
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
export function createStrictRateLimiter() {
  return rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // 5 requests per window
    standardHeaders: true,
    legacyHeaders: false,
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
export function createPerUserRateLimiter(max = 100, windowMs = 15 * 60 * 1000) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
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
