/**
 * Memory Cache Provider
 *
 * In-memory cache provider using Map data structure.
 * Features:
 * - TTL-based expiration
 * - LRU eviction when max size is reached
 * - Automatic cleanup of expired entries
 * - Tag-based invalidation
 *
 * Best for:
 * - Request-scoped caching
 * - Hot data within a single function instance
 * - Auth/permissions data
 * - Configuration values
 *
 * Limitations:
 * - Not shared across function instances
 * - Lost on cold starts
 * - Limited by instance memory
 */

import { BaseCacheProvider } from './base-cache-provider';
import {
  CacheProviderType,
  CacheSetOptions,
  CacheEntry,
  CacheEntryMetadata,
  MemoryCacheProviderConfig,
} from '../types';

interface MemoryCacheEntry<T = any> {
  value: T;
  metadata: CacheEntryMetadata;
}

export class MemoryCacheProvider extends BaseCacheProvider {
  private cache: Map<string, MemoryCacheEntry>;
  private cleanupInterval: NodeJS.Timeout | null = null;
  private currentSize: number = 0;

  constructor(private config: MemoryCacheProviderConfig) {
    super();
    this.cache = new Map();

    // Start automatic cleanup
    this.startCleanup();
  }

  getType(): CacheProviderType {
    return 'memory';
  }

  async get<T>(key: string): Promise<T | null> {
    const entry = this.cache.get(key) as MemoryCacheEntry<T> | undefined;

    if (!entry) {
      this.recordMiss();
      return null;
    }

    // Check if expired
    if (this.isExpired(entry.metadata.expiresAt)) {
      this.cache.delete(key);
      this.recordExpiration();
      this.recordMiss();
      return null;
    }

    // Update access metadata
    entry.metadata.hitCount++;
    entry.metadata.lastAccessedAt = new Date();

    this.recordHit();

    // Return clone if configured (prevents mutations)
    if (this.config.useClones) {
      return JSON.parse(JSON.stringify(entry.value)) as T;
    }

    return entry.value;
  }

  async getWithMetadata<T>(key: string): Promise<CacheEntry<T> | null> {
    const value = await this.get<T>(key);

    if (value === null) {
      return null;
    }

    const entry = this.cache.get(key) as MemoryCacheEntry<T>;

    return {
      key,
      value,
      metadata: { ...entry.metadata },
    };
  }

  async set<T>(key: string, value: T, options: CacheSetOptions = {}): Promise<void> {
    const ttl = options.ttl || 300; // Default 5 minutes
    const tags = options.tags || [];

    // Estimate size
    const size = this.estimateSize(value);

    // Check if we need to evict (before adding new entry)
    if (this.currentSize + size > this.config.maxSize) {
      await this.evictLRU(size);
    }

    // Create entry
    const entry: MemoryCacheEntry<T> = {
      value: this.config.useClones ? JSON.parse(JSON.stringify(value)) : value,
      metadata: {
        ...this.createMetadata(ttl, tags),
        size,
      },
    };

    // Store in cache
    this.cache.set(key, entry);
    this.currentSize += size;
    this.updateEntryCount(this.cache.size);
    this.updateSize(this.currentSize);
  }

  async delete(key: string): Promise<boolean> {
    const entry = this.cache.get(key);

    if (!entry) {
      return false;
    }

    this.cache.delete(key);
    this.currentSize -= entry.metadata.size || 0;
    this.updateEntryCount(this.cache.size);
    this.updateSize(this.currentSize);

    return true;
  }

  async has(key: string): Promise<boolean> {
    const entry = this.cache.get(key);

    if (!entry) {
      return false;
    }

    // Check if expired
    if (this.isExpired(entry.metadata.expiresAt)) {
      this.cache.delete(key);
      this.recordExpiration();
      return false;
    }

    return true;
  }

  async invalidateByTags(tags: string[]): Promise<number> {
    let count = 0;

    for (const [key, entry] of this.cache.entries()) {
      // Check if entry has any of the specified tags
      const hasTag = tags.some((tag) => entry.metadata.tags.includes(tag));

      if (hasTag) {
        this.cache.delete(key);
        this.currentSize -= entry.metadata.size || 0;
        count++;
      }
    }

    this.updateEntryCount(this.cache.size);
    this.updateSize(this.currentSize);

    return count;
  }

  async invalidateByPattern(pattern: string, mode: 'prefix' | 'suffix' | 'contains' = 'prefix'): Promise<number> {
    let count = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (this.matchPattern(key, pattern, mode)) {
        this.cache.delete(key);
        this.currentSize -= entry.metadata.size || 0;
        count++;
      }
    }

    this.updateEntryCount(this.cache.size);
    this.updateSize(this.currentSize);

    return count;
  }

  async clear(): Promise<void> {
    this.cache.clear();
    this.currentSize = 0;
    this.updateEntryCount(0);
    this.updateSize(0);
  }

  async cleanup(): Promise<number> {
    let count = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (this.isExpired(entry.metadata.expiresAt)) {
        this.cache.delete(key);
        this.currentSize -= entry.metadata.size || 0;
        this.recordExpiration();
        count++;
      }
    }

    this.updateEntryCount(this.cache.size);
    this.updateSize(this.currentSize);

    return count;
  }

  /**
   * Evict least recently used entries to make space
   */
  private async evictLRU(requiredSpace: number): Promise<void> {
    // Sort entries by last accessed time
    const entries = Array.from(this.cache.entries()).sort(
      (a, b) => a[1].metadata.lastAccessedAt.getTime() - b[1].metadata.lastAccessedAt.getTime()
    );

    let freedSpace = 0;

    for (const [key, entry] of entries) {
      if (freedSpace >= requiredSpace) {
        break;
      }

      this.cache.delete(key);
      const entrySize = entry.metadata.size || 0;
      this.currentSize -= entrySize;
      freedSpace += entrySize;
      this.recordEviction();
    }

    this.updateEntryCount(this.cache.size);
    this.updateSize(this.currentSize);
  }

  /**
   * Start automatic cleanup of expired entries
   */
  private startCleanup(): void {
    if (this.cleanupInterval) {
      return;
    }

    this.cleanupInterval = setInterval(async () => {
      await this.cleanup();
    }, this.config.checkPeriod * 1000);

    // Don't prevent Node.js from exiting
    this.cleanupInterval.unref();
  }

  /**
   * Stop automatic cleanup
   */
  stopCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Cleanup on provider destruction
   */
  destroy(): void {
    this.stopCleanup();
    this.cache.clear();
  }
}
