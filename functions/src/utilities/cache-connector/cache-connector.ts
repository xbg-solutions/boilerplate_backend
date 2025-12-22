/**
 * Cache Connector
 *
 * Main facade class for the caching system.
 * Provides a unified API for all cache operations and manages multiple cache providers.
 *
 * Features:
 * - Multi-provider support (memory, firestore, redis)
 * - Lazy provider initialization
 * - Global enable/disable switch
 * - Provider-specific routing
 * - Automatic fallback to no-op when disabled
 *
 * Usage:
 * ```typescript
 * const cache = getCacheConnector();
 * await cache.set('key', value, { ttl: 300, provider: 'memory' });
 * const cached = await cache.get<User>('key', { provider: 'memory' });
 * ```
 */

import {
  CacheConfig,
  CacheProviderType,
  ICacheProvider,
  CacheSetOptions,
  CacheGetOptions,
  CacheInvalidateOptions,
  CacheEntry,
  CacheStats,
} from './types';
import { BaseCacheProvider } from './providers/base-cache-provider';
import { NoOpCacheProvider } from './providers/noop-cache-provider';
import { MemoryCacheProvider } from './providers/memory-cache-provider';
import { FirestoreCacheProvider } from './providers/firestore-cache-provider';
import { logger } from '../logger';

export class CacheConnector {
  private providers: Map<CacheProviderType, ICacheProvider>;
  private noopProvider: ICacheProvider;

  constructor(private config: CacheConfig) {
    this.providers = new Map();
    this.noopProvider = new NoOpCacheProvider();

    logger.info('CacheConnector initialized', {
      operation: 'cache.init',
      enabled: config.enabled,
      defaultProvider: config.defaultProvider,
    });
  }

  /**
   * Check if caching is enabled globally
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Get or create a provider instance
   */
  private getProvider(type: CacheProviderType): ICacheProvider {
    // If global cache disabled, always return no-op
    if (!this.config.enabled) {
      return this.noopProvider;
    }

    // Check if provider already exists
    if (this.providers.has(type)) {
      return this.providers.get(type)!;
    }

    // Create new provider instance
    try {
      const provider = this.createProvider(type);
      this.providers.set(type, provider);

      logger.debug(`Cache provider created: ${type}`, {
        operation: 'cache.createProvider',
        provider: type,
      });

      return provider;
    } catch (error) {
      logger.error(`Failed to create cache provider: ${type}`, error as Error, {
        operation: 'cache.createProvider',
        provider: type,
      });

      // Fallback to no-op on error
      return this.noopProvider;
    }
  }

  /**
   * Create a new provider instance based on type
   */
  private createProvider(type: CacheProviderType): ICacheProvider {
    switch (type) {
      case 'memory':
        return new MemoryCacheProvider(this.config.providers.memory);

      case 'firestore':
        return new FirestoreCacheProvider(this.config.providers.firestore);

      case 'redis':
        if (!this.config.providers.redis) {
          throw new Error('Redis provider configuration not found');
        }
        // TODO: Implement Redis provider when needed
        throw new Error('Redis provider not yet implemented');

      case 'noop':
        return this.noopProvider;

      default:
        throw new Error(`Unknown cache provider type: ${type}`);
    }
  }

  /**
   * Resolve provider from options or use default
   */
  private resolveProvider(providerType?: CacheProviderType): ICacheProvider {
    const type = providerType || this.config.defaultProvider;
    return this.getProvider(type);
  }

  /**
   * Get a value from cache
   *
   * @param key - Cache key
   * @param options - Get options (provider override, metadata, etc.)
   * @returns Cached value or null if not found/expired
   */
  async get<T>(key: string, options: CacheGetOptions = {}): Promise<T | null> {
    const provider = this.resolveProvider(options.provider);
    return provider.get<T>(key);
  }

  /**
   * Get a value with metadata from cache
   *
   * @param key - Cache key
   * @param options - Get options
   * @returns Cache entry with metadata or null
   */
  async getWithMetadata<T>(key: string, options: CacheGetOptions = {}): Promise<CacheEntry<T> | null> {
    const provider = this.resolveProvider(options.provider);
    return provider.getWithMetadata<T>(key);
  }

  /**
   * Set a value in cache
   *
   * @param key - Cache key
   * @param value - Value to cache
   * @param options - Set options (TTL, tags, provider, etc.)
   */
  async set<T>(key: string, value: T, options: CacheSetOptions = {}): Promise<void> {
    const provider = this.resolveProvider(options.provider);
    const ttl = options.ttl || this.config.defaultTTL;

    return provider.set(key, value, { ...options, ttl });
  }

  /**
   * Delete a specific cache entry
   *
   * @param key - Cache key to delete
   * @param options - Invalidate options
   * @returns True if entry was deleted
   */
  async delete(key: string, options: CacheInvalidateOptions = {}): Promise<boolean> {
    const provider = this.resolveProvider(options.provider);
    return provider.delete(key);
  }

  /**
   * Check if a cache entry exists
   *
   * @param key - Cache key to check
   * @param options - Get options
   * @returns True if entry exists and is not expired
   */
  async has(key: string, options: CacheGetOptions = {}): Promise<boolean> {
    const provider = this.resolveProvider(options.provider);
    return provider.has(key);
  }

  /**
   * Invalidate cache entries by tags
   *
   * @param tags - Array of tags to invalidate
   * @param options - Invalidate options
   * @returns Number of entries invalidated
   */
  async invalidateByTags(tags: string[], options: CacheInvalidateOptions = {}): Promise<number> {
    const provider = this.resolveProvider(options.provider);
    return provider.invalidateByTags(tags);
  }

  /**
   * Invalidate cache entries by key pattern
   *
   * @param pattern - Pattern to match
   * @param options - Invalidate options
   * @returns Number of entries invalidated
   */
  async invalidateByPattern(pattern: string, options: CacheInvalidateOptions = {}): Promise<number> {
    const provider = this.resolveProvider(options.provider);
    const mode = options.pattern || 'prefix';
    return provider.invalidateByPattern(pattern, mode);
  }

  /**
   * Clear all cache entries
   *
   * @param options - Invalidate options
   */
  async clear(options: CacheInvalidateOptions = {}): Promise<void> {
    const provider = this.resolveProvider(options.provider);
    return provider.clear();
  }

  /**
   * Clear all cache entries across all providers
   */
  async clearAll(): Promise<void> {
    const providers = Array.from(this.providers.values());

    await Promise.all(
      providers.map(async (provider) => {
        try {
          await provider.clear();
        } catch (error) {
          logger.error(`Failed to clear cache for provider: ${provider.getType()}`, error as Error, {
            operation: 'cache.clearAll',
            provider: provider.getType(),
          });
        }
      })
    );
  }

  /**
   * Get cache statistics
   *
   * @param options - Get options
   * @returns Cache statistics
   */
  async getStats(options: CacheGetOptions = {}): Promise<CacheStats> {
    const provider = this.resolveProvider(options.provider);
    return provider.getStats();
  }

  /**
   * Get statistics for all active providers
   */
  async getAllStats(): Promise<Record<CacheProviderType, CacheStats>> {
    const stats: Partial<Record<CacheProviderType, CacheStats>> = {};

    for (const [type, provider] of this.providers.entries()) {
      try {
        stats[type] = await provider.getStats();
      } catch (error) {
        logger.error(`Failed to get stats for provider: ${type}`, error as Error, {
          operation: 'cache.getAllStats',
          provider: type,
        });
      }
    }

    return stats as Record<CacheProviderType, CacheStats>;
  }

  /**
   * Manually trigger cleanup of expired entries
   *
   * @param options - Get options
   * @returns Number of entries cleaned up
   */
  async cleanup(options: CacheGetOptions = {}): Promise<number> {
    const provider = this.resolveProvider(options.provider);

    if ('cleanup' in provider && typeof provider.cleanup === 'function') {
      return provider.cleanup();
    }

    return 0;
  }

  /**
   * Build a namespaced cache key
   *
   * @param parts - Key parts to join
   * @returns Namespaced cache key
   */
  buildKey(...parts: string[]): string {
    return `${this.config.namespace}:${parts.join(':')}`;
  }

  /**
   * Destroy all providers and cleanup resources
   */
  destroy(): void {
    for (const provider of this.providers.values()) {
      if ('destroy' in provider && typeof provider.destroy === 'function') {
        (provider as any).destroy();
      }
    }

    this.providers.clear();

    logger.info('CacheConnector destroyed', {
      operation: 'cache.destroy',
    });
  }
}
