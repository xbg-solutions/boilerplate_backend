/**
 * Redis Cache Provider
 *
 * Redis-based cache provider for high-performance distributed caching.
 *
 * Features:
 * - Sub-10ms response times
 * - Distributed caching across all instances
 * - Pub/sub for distributed invalidation
 * - Advanced data structures (Sets for tags)
 * - Connection pooling
 * - Automatic reconnection
 *
 * Best for:
 * - High-traffic applications (>1M requests/month)
 * - Sub-10ms response time requirements
 * - Large cache sizes exceeding Firestore limits
 * - Advanced caching patterns
 *
 * Trade-offs:
 * - Cost: ~$50/month minimum (Google Cloud Memorystore)
 * - Infrastructure: Requires Redis server
 * - Complexity: Additional service to manage
 */

import Redis from 'ioredis';
import { BaseCacheProvider } from './base-cache-provider';
import {
  CacheProviderType,
  CacheSetOptions,
  CacheEntry,
  CacheEntryMetadata,
  RedisCacheProviderConfig,
} from '../types';
import { logger } from '../../logger';

interface RedisCacheDocument {
  value: any;
  metadata: {
    createdAt: number;
    expiresAt: number;
    hitCount: number;
    lastAccessedAt: number;
    tags: string[];
    size?: number;
  };
}

export class RedisCacheProvider extends BaseCacheProvider {
  private client: Redis;
  private isConnected: boolean = false;

  constructor(private config: RedisCacheProviderConfig) {
    super();

    // Create Redis client
    this.client = new Redis({
      host: config.host,
      port: config.port,
      password: config.password,
      db: config.db,
      connectTimeout: config.connectTimeout || 5000,
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      ...(config.tls ? { tls: {} } : {}),
    });

    // Setup event handlers
    this.setupEventHandlers();
  }

  /**
   * Setup Redis event handlers
   */
  private setupEventHandlers(): void {
    this.client.on('connect', () => {
      this.isConnected = true;
      logger.info('Redis cache connected', {
        operation: 'cache.redis.connect',
        host: this.config.host,
        port: this.config.port,
      });
    });

    this.client.on('error', (error) => {
      logger.error('Redis cache error', error, {
        operation: 'cache.redis.error',
      });
    });

    this.client.on('close', () => {
      this.isConnected = false;
      logger.warn('Redis cache connection closed', {
        operation: 'cache.redis.close',
      });
    });

    this.client.on('reconnecting', () => {
      logger.info('Redis cache reconnecting', {
        operation: 'cache.redis.reconnecting',
      });
    });
  }

  getType(): CacheProviderType {
    return 'redis';
  }

  /**
   * Build tag set key
   */
  private buildTagKey(tag: string): string {
    return `cache:tags:${tag}`;
  }

  /**
   * Build metadata key
   */
  private buildMetaKey(key: string): string {
    return `cache:meta:${key}`;
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      if (!this.isConnected) {
        this.recordMiss();
        return null;
      }

      // Get value and metadata in parallel
      const [valueStr, metaStr] = await Promise.all([
        this.client.get(key),
        this.client.get(this.buildMetaKey(key)),
      ]);

      if (!valueStr || !metaStr) {
        this.recordMiss();
        return null;
      }

      // Parse metadata
      const meta: RedisCacheDocument['metadata'] = JSON.parse(metaStr);

      // Check if expired (shouldn't happen due to Redis TTL, but double-check)
      if (meta.expiresAt < Date.now()) {
        this.recordExpiration();
        this.recordMiss();
        return null;
      }

      // Update access metadata (fire and forget)
      this.client
        .set(
          this.buildMetaKey(key),
          JSON.stringify({
            ...meta,
            hitCount: meta.hitCount + 1,
            lastAccessedAt: Date.now(),
          })
        )
        .catch((error) => {
          logger.warn('Failed to update Redis cache metadata', error, {
            operation: 'cache.redis.updateMeta',
            key,
          });
        });

      this.recordHit();

      // Parse and return value
      return JSON.parse(valueStr) as T;
    } catch (error) {
      logger.error('Error getting cache entry from Redis', error as Error, {
        operation: 'cache.redis.get',
        key,
      });
      this.recordMiss();
      return null;
    }
  }

  async getWithMetadata<T>(key: string): Promise<CacheEntry<T> | null> {
    try {
      if (!this.isConnected) {
        this.recordMiss();
        return null;
      }

      const [valueStr, metaStr] = await Promise.all([
        this.client.get(key),
        this.client.get(this.buildMetaKey(key)),
      ]);

      if (!valueStr || !metaStr) {
        this.recordMiss();
        return null;
      }

      const meta: RedisCacheDocument['metadata'] = JSON.parse(metaStr);

      // Check if expired
      if (meta.expiresAt < Date.now()) {
        this.recordExpiration();
        this.recordMiss();
        return null;
      }

      this.recordHit();

      return {
        key,
        value: JSON.parse(valueStr) as T,
        metadata: {
          createdAt: new Date(meta.createdAt),
          expiresAt: new Date(meta.expiresAt),
          hitCount: meta.hitCount,
          lastAccessedAt: new Date(meta.lastAccessedAt),
          tags: meta.tags,
          size: meta.size,
        },
      };
    } catch (error) {
      logger.error('Error getting cache entry with metadata from Redis', error as Error, {
        operation: 'cache.redis.getWithMetadata',
        key,
      });
      this.recordMiss();
      return null;
    }
  }

  async set<T>(key: string, value: T, options: CacheSetOptions = {}): Promise<void> {
    try {
      if (!this.isConnected) {
        return;
      }

      const ttl = options.ttl || 300; // Default 5 minutes
      const tags = options.tags || [];
      const size = this.estimateSize(value);

      const now = Date.now();
      const expiresAt = now + ttl * 1000;

      const meta: RedisCacheDocument['metadata'] = {
        createdAt: now,
        expiresAt,
        hitCount: 0,
        lastAccessedAt: now,
        tags,
        size,
      };

      // Use pipeline for atomic operations
      const pipeline = this.client.pipeline();

      // Set value with TTL
      pipeline.set(key, JSON.stringify(value), 'EX', ttl);

      // Set metadata with TTL
      pipeline.set(this.buildMetaKey(key), JSON.stringify(meta), 'EX', ttl);

      // Add key to tag sets
      for (const tag of tags) {
        pipeline.sadd(this.buildTagKey(tag), key);
        // Set expiry on tag set (slightly longer than cache TTL)
        pipeline.expire(this.buildTagKey(tag), ttl + 60);
      }

      await pipeline.exec();
    } catch (error) {
      logger.error('Error setting cache entry in Redis', error as Error, {
        operation: 'cache.redis.set',
        key,
        ttl: options.ttl,
      });
      throw error;
    }
  }

  async delete(key: string): Promise<boolean> {
    try {
      if (!this.isConnected) {
        return false;
      }

      // Get metadata to find tags
      const metaStr = await this.client.get(this.buildMetaKey(key));

      const pipeline = this.client.pipeline();

      // Delete value and metadata
      pipeline.del(key);
      pipeline.del(this.buildMetaKey(key));

      // Remove from tag sets
      if (metaStr) {
        const meta: RedisCacheDocument['metadata'] = JSON.parse(metaStr);
        for (const tag of meta.tags) {
          pipeline.srem(this.buildTagKey(tag), key);
        }
      }

      const results = await pipeline.exec();

      // Check if value was deleted (first operation)
      return results?.[0]?.[1] === 1;
    } catch (error) {
      logger.error('Error deleting cache entry from Redis', error as Error, {
        operation: 'cache.redis.delete',
        key,
      });
      return false;
    }
  }

  async has(key: string): Promise<boolean> {
    try {
      if (!this.isConnected) {
        return false;
      }

      const exists = await this.client.exists(key);
      return exists === 1;
    } catch (error) {
      logger.error('Error checking cache entry in Redis', error as Error, {
        operation: 'cache.redis.has',
        key,
      });
      return false;
    }
  }

  async invalidateByTags(tags: string[]): Promise<number> {
    try {
      if (!this.isConnected) {
        return 0;
      }

      let count = 0;

      for (const tag of tags) {
        const tagKey = this.buildTagKey(tag);

        // Get all keys with this tag
        const keys = await this.client.smembers(tagKey);

        if (keys.length === 0) {
          continue;
        }

        // Delete all keys and their metadata
        const pipeline = this.client.pipeline();

        for (const key of keys) {
          pipeline.del(key);
          pipeline.del(this.buildMetaKey(key));
        }

        // Delete the tag set itself
        pipeline.del(tagKey);

        await pipeline.exec();
        count += keys.length;
      }

      return count;
    } catch (error) {
      logger.error('Error invalidating cache by tags in Redis', error as Error, {
        operation: 'cache.redis.invalidateByTags',
        tags,
      });
      return 0;
    }
  }

  async invalidateByPattern(
    pattern: string,
    mode: 'prefix' | 'suffix' | 'contains' = 'prefix'
  ): Promise<number> {
    try {
      if (!this.isConnected) {
        return 0;
      }

      // Build Redis pattern based on mode
      let redisPattern: string;
      switch (mode) {
        case 'prefix':
          redisPattern = `${pattern}*`;
          break;
        case 'suffix':
          redisPattern = `*${pattern}`;
          break;
        case 'contains':
          redisPattern = `*${pattern}*`;
          break;
        default:
          redisPattern = pattern;
      }

      const keys: string[] = [];
      let cursor = '0';

      // Use SCAN to iterate through keys (safer than KEYS for production)
      do {
        const result = await this.client.scan(cursor, 'MATCH', redisPattern, 'COUNT', 100);
        cursor = result[0];
        keys.push(...result[1]);
      } while (cursor !== '0');

      if (keys.length === 0) {
        return 0;
      }

      // Delete matched keys and their metadata
      const pipeline = this.client.pipeline();

      for (const key of keys) {
        // Don't delete metadata or tag keys
        if (!key.startsWith('cache:meta:') && !key.startsWith('cache:tags:')) {
          pipeline.del(key);
          pipeline.del(this.buildMetaKey(key));
        }
      }

      await pipeline.exec();

      return keys.length;
    } catch (error) {
      logger.error('Error invalidating cache by pattern in Redis', error as Error, {
        operation: 'cache.redis.invalidateByPattern',
        pattern,
        mode,
      });
      return 0;
    }
  }

  async clear(): Promise<void> {
    try {
      if (!this.isConnected) {
        return;
      }

      // Clear all keys in the current database
      await this.client.flushdb();

      logger.info('Redis cache cleared', {
        operation: 'cache.redis.clear',
      });
    } catch (error) {
      logger.error('Error clearing cache in Redis', error as Error, {
        operation: 'cache.redis.clear',
      });
      throw error;
    }
  }

  async cleanup(): Promise<number> {
    // Redis handles TTL expiration automatically
    // This method is a no-op for Redis
    return 0;
  }

  async getStats(): Promise<any> {
    try {
      if (!this.isConnected) {
        return super.getStats();
      }

      // Get Redis info
      const info = await this.client.info('stats');
      const keyspace = await this.client.info('keyspace');

      // Parse keyspace info
      const dbMatch = keyspace.match(/db\d+:keys=(\d+)/);
      const keyCount = dbMatch ? parseInt(dbMatch[1], 10) : 0;

      this.updateEntryCount(keyCount);

      return super.getStats();
    } catch (error) {
      logger.error('Error getting cache stats from Redis', error as Error, {
        operation: 'cache.redis.getStats',
      });
      return super.getStats();
    }
  }

  /**
   * Check if Redis is connected
   */
  isReady(): boolean {
    return this.isConnected;
  }

  /**
   * Cleanup on provider destruction
   */
  destroy(): void {
    if (this.client) {
      this.client.disconnect();
    }
  }
}
