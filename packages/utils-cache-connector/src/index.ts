/**
 * Cache Connector
 *
 * Multi-level caching system with pluggable providers.
 *
 * Features:
 * - Project-level control (global enable/disable)
 * - Repository-level granularity (per-entity provider selection)
 * - Multiple providers (memory, firestore, redis)
 * - Tag-based invalidation
 * - TTL-based expiration
 * - Statistics and monitoring
 *
 * Usage:
 * ```typescript
 * // Get singleton instance
 * const cache = getCacheConnector();
 *
 * // Set a value
 * await cache.set('user:123', user, { ttl: 300, provider: 'memory' });
 *
 * // Get a value
 * const user = await cache.get<User>('user:123', { provider: 'memory' });
 *
 * // Invalidate by tags
 * await cache.invalidateByTags(['users', 'user:123']);
 * ```
 */

import { CacheConnector } from './cache-connector';
import { CacheConfig } from './types';

// Singleton instance
let cacheConnectorInstance: CacheConnector | null = null;

/**
 * Initialize the cache connector with configuration
 * Call this once during app startup before using getCacheConnector()
 */
export function initializeCacheConnector(config: CacheConfig): CacheConnector {
  if (cacheConnectorInstance) {
    cacheConnectorInstance.destroy();
  }
  cacheConnectorInstance = new CacheConnector(config);
  return cacheConnectorInstance;
}

/**
 * Get the singleton CacheConnector instance
 * Throws if not initialized - call initializeCacheConnector() first
 */
export function getCacheConnector(): CacheConnector {
  if (!cacheConnectorInstance) {
    // Create with defaults if not explicitly initialized
    cacheConnectorInstance = new CacheConnector({
      enabled: false,
      defaultProvider: 'noop' as any,
      defaultTTL: 300,
      namespace: 'app',
      providers: {},
    });
  }
  return cacheConnectorInstance;
}

/**
 * Reset the cache connector instance (useful for testing)
 */
export function resetCacheConnector(): void {
  if (cacheConnectorInstance) {
    cacheConnectorInstance.destroy();
    cacheConnectorInstance = null;
  }
}

// Export types and classes
export { CacheConnector } from './cache-connector';
export * from './types';
export { BaseCacheProvider } from './providers/base-cache-provider';
export { NoOpCacheProvider } from './providers/noop-cache-provider';
export { MemoryCacheProvider } from './providers/memory-cache-provider';
export { FirestoreCacheProvider } from './providers/firestore-cache-provider';
export { RedisCacheProvider } from './providers/redis-cache-provider';
