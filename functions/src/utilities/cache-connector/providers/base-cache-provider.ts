/**
 * Base Cache Provider
 *
 * Abstract base class that all cache providers extend.
 * Provides common functionality and enforces interface compliance.
 */

import {
  CacheProviderType,
  ICacheProvider,
  CacheSetOptions,
  CacheEntry,
  CacheStats,
  CacheEntryMetadata,
} from '../types';

export abstract class BaseCacheProvider implements ICacheProvider {
  protected stats: CacheStats = {
    hits: 0,
    misses: 0,
    hitRatio: 0,
    entryCount: 0,
    size: 0,
    evictions: 0,
    expirations: 0,
  };

  /**
   * Get the provider type
   */
  abstract getType(): CacheProviderType;

  /**
   * Get a value from cache
   */
  abstract get<T>(key: string): Promise<T | null>;

  /**
   * Get a value with metadata
   */
  abstract getWithMetadata<T>(key: string): Promise<CacheEntry<T> | null>;

  /**
   * Set a value in cache
   */
  abstract set<T>(key: string, value: T, options?: CacheSetOptions): Promise<void>;

  /**
   * Delete a specific key
   */
  abstract delete(key: string): Promise<boolean>;

  /**
   * Check if a key exists
   */
  abstract has(key: string): Promise<boolean>;

  /**
   * Invalidate cache entries by tags
   */
  abstract invalidateByTags(tags: string[]): Promise<number>;

  /**
   * Invalidate cache entries by pattern
   */
  abstract invalidateByPattern(
    pattern: string,
    mode?: 'prefix' | 'suffix' | 'contains'
  ): Promise<number>;

  /**
   * Clear all cache entries
   */
  abstract clear(): Promise<void>;

  /**
   * Get cache statistics
   */
  async getStats(): Promise<CacheStats> {
    // Calculate hit ratio
    const total = this.stats.hits + this.stats.misses;
    this.stats.hitRatio = total > 0 ? this.stats.hits / total : 0;

    return { ...this.stats };
  }

  /**
   * Record a cache hit
   */
  protected recordHit(): void {
    this.stats.hits++;
  }

  /**
   * Record a cache miss
   */
  protected recordMiss(): void {
    this.stats.misses++;
  }

  /**
   * Record an eviction
   */
  protected recordEviction(): void {
    this.stats.evictions++;
  }

  /**
   * Record an expiration
   */
  protected recordExpiration(): void {
    this.stats.expirations++;
  }

  /**
   * Update entry count
   */
  protected updateEntryCount(count: number): void {
    this.stats.entryCount = count;
  }

  /**
   * Update cache size
   */
  protected updateSize(size: number): void {
    this.stats.size = size;
  }

  /**
   * Check if an entry is expired
   */
  protected isExpired(expiresAt: Date): boolean {
    return expiresAt.getTime() < Date.now();
  }

  /**
   * Calculate TTL in milliseconds
   */
  protected calculateExpiresAt(ttl: number): Date {
    return new Date(Date.now() + ttl * 1000);
  }

  /**
   * Create cache entry metadata
   */
  protected createMetadata(ttl: number, tags: string[] = []): CacheEntryMetadata {
    const now = new Date();
    return {
      createdAt: now,
      expiresAt: this.calculateExpiresAt(ttl),
      hitCount: 0,
      lastAccessedAt: now,
      tags,
    };
  }

  /**
   * Estimate size of a value in bytes
   */
  protected estimateSize(value: any): number {
    try {
      return JSON.stringify(value).length * 2; // Rough estimate (UTF-16)
    } catch {
      return 0;
    }
  }

  /**
   * Match key against pattern
   */
  protected matchPattern(key: string, pattern: string, mode: 'prefix' | 'suffix' | 'contains'): boolean {
    switch (mode) {
      case 'prefix':
        return key.startsWith(pattern);
      case 'suffix':
        return key.endsWith(pattern);
      case 'contains':
        return key.includes(pattern);
      default:
        return false;
    }
  }
}
