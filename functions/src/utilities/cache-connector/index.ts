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
import { CACHE_CONFIG } from '@config/cache.config';

// Singleton instance
let cacheConnectorInstance: CacheConnector | null = null;

/**
 * Get the singleton CacheConnector instance
 */
export function getCacheConnector(): CacheConnector {
  if (!cacheConnectorInstance) {
    cacheConnectorInstance = new CacheConnector(CACHE_CONFIG);
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
