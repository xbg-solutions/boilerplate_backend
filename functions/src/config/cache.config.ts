/**
 * Cache Configuration
 *
 * Multi-level caching configuration for the application.
 *
 * Configuration Hierarchy:
 * 1. Global Project Config (Master Switch)
 * 2. Repository-Level Config (Per-Entity)
 * 3. Method-Level Options (Runtime)
 *
 * Usage:
 * - Set CACHE_ENABLED=true to enable caching globally
 * - Configure default provider and TTL
 * - Individual repositories can opt-in and choose their provider
 */

import {
  CacheConfig,
  CacheProviderType,
  MemoryCacheProviderConfig,
  FirestoreCacheProviderConfig,
  RedisCacheProviderConfig,
} from '@utilities/cache-connector/types';

/**
 * Global cache configuration
 *
 * Master Configuration:
 * - enabled: Master switch - if false, all caching is disabled
 * - defaultProvider: Default cache provider for repositories
 * - defaultTTL: Default time-to-live in seconds
 * - namespace: Cache key namespace for versioning
 */
export const CACHE_CONFIG: CacheConfig = {
  /**
   * Master switch - set to 'true' to enable caching globally
   * Default: false (caching disabled for new projects)
   */
  enabled: process.env.CACHE_ENABLED === 'true',

  /**
   * Default provider for repositories that don't specify
   * Options: 'memory', 'firestore', 'redis'
   * Default: 'memory'
   */
  defaultProvider: (process.env.CACHE_DEFAULT_PROVIDER as CacheProviderType) || 'memory',

  /**
   * Default TTL in seconds (300 = 5 minutes)
   */
  defaultTTL: parseInt(process.env.CACHE_DEFAULT_TTL || '300', 10),

  /**
   * Cache namespace for versioning
   * Change this to invalidate all cached data
   * Default: 'v1'
   */
  namespace: process.env.CACHE_NAMESPACE || 'v1',

  /**
   * Provider-specific configurations
   */
  providers: {
    /**
     * Memory Cache Provider Configuration
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
    memory: {
      /**
       * Maximum cache size in bytes
       * Default: 100MB
       */
      maxSize: parseInt(process.env.CACHE_MEMORY_MAX_SIZE_MB || '100', 10) * 1024 * 1024,

      /**
       * Cleanup check period in seconds
       * Default: 60 seconds
       */
      checkPeriod: parseInt(process.env.CACHE_MEMORY_CHECK_PERIOD || '60', 10),

      /**
       * Whether to clone values (prevents mutations)
       * Default: false (better performance)
       */
      useClones: process.env.CACHE_MEMORY_USE_CLONES === 'true',
    } as MemoryCacheProviderConfig,

    /**
     * Firestore Cache Provider Configuration
     *
     * Best for:
     * - Medium-traffic repositories
     * - Data shared across function instances
     * - Cache data that should survive cold starts
     *
     * Trade-offs:
     * - Latency: ~50-100ms (vs memory ~1-5ms)
     * - Cost: Firestore read/write operations
     * - Size limit: 1MB per document
     */
    firestore: {
      /**
       * Database to use for cache storage
       * Default: 'systemDB'
       */
      database: process.env.CACHE_FIRESTORE_DATABASE || 'systemDB',

      /**
       * Collection name for cache entries
       * Default: '_cache'
       */
      collection: process.env.CACHE_FIRESTORE_COLLECTION || '_cache',

      /**
       * Enable automatic cleanup of expired entries
       * Default: true
       */
      enableCleanup: process.env.CACHE_FIRESTORE_ENABLE_CLEANUP !== 'false',

      /**
       * Cleanup interval in seconds
       * Default: 3600 (1 hour)
       */
      cleanupInterval: parseInt(process.env.CACHE_FIRESTORE_CLEANUP_INTERVAL || '3600', 10),
    } as FirestoreCacheProviderConfig,

    /**
     * Redis Cache Provider Configuration (Optional)
     *
     * Best for:
     * - High-traffic applications (>1M requests/month)
     * - Sub-10ms response time requirements
     * - Cache sizes exceeding Firestore limits
     * - Advanced features (pub/sub, sorted sets)
     *
     * Cost: ~$50/month minimum (Google Cloud Memorystore)
     *
     * Note: Only configured if CACHE_REDIS_HOST is set
     */
    redis: process.env.CACHE_REDIS_HOST
      ? ({
          host: process.env.CACHE_REDIS_HOST,
          port: parseInt(process.env.CACHE_REDIS_PORT || '6379', 10),
          password: process.env.CACHE_REDIS_PASSWORD,
          db: parseInt(process.env.CACHE_REDIS_DB || '0', 10),
          connectTimeout: parseInt(process.env.CACHE_REDIS_CONNECT_TIMEOUT || '5000', 10),
          tls: process.env.CACHE_REDIS_TLS === 'true',
        } as RedisCacheProviderConfig)
      : undefined,
  },
};

/**
 * Validate cache configuration
 */
export function validateCacheConfig(): void {
  const errors: string[] = [];

  // Validate default provider
  const validProviders: CacheProviderType[] = ['memory', 'firestore', 'redis', 'noop'];
  if (!validProviders.includes(CACHE_CONFIG.defaultProvider)) {
    errors.push(`Invalid default provider: ${CACHE_CONFIG.defaultProvider}`);
  }

  // Validate default TTL
  if (CACHE_CONFIG.defaultTTL <= 0) {
    errors.push('Default TTL must be greater than 0');
  }

  // Validate namespace
  if (!CACHE_CONFIG.namespace || CACHE_CONFIG.namespace.trim() === '') {
    errors.push('Cache namespace is required');
  }

  // Validate memory provider config
  if (CACHE_CONFIG.providers.memory.maxSize <= 0) {
    errors.push('Memory cache max size must be greater than 0');
  }

  if (CACHE_CONFIG.providers.memory.checkPeriod <= 0) {
    errors.push('Memory cache check period must be greater than 0');
  }

  // Validate firestore provider config
  if (!CACHE_CONFIG.providers.firestore.database) {
    errors.push('Firestore cache database is required');
  }

  if (!CACHE_CONFIG.providers.firestore.collection) {
    errors.push('Firestore cache collection is required');
  }

  if (CACHE_CONFIG.providers.firestore.cleanupInterval <= 0) {
    errors.push('Firestore cache cleanup interval must be greater than 0');
  }

  // Validate redis provider config if configured
  if (CACHE_CONFIG.providers.redis) {
    if (!CACHE_CONFIG.providers.redis.host) {
      errors.push('Redis host is required when Redis is configured');
    }

    if (CACHE_CONFIG.providers.redis.port <= 0 || CACHE_CONFIG.providers.redis.port > 65535) {
      errors.push('Redis port must be between 1 and 65535');
    }

    if (CACHE_CONFIG.providers.redis.db < 0) {
      errors.push('Redis database number must be >= 0');
    }
  }

  if (errors.length > 0) {
    throw new Error(`Cache configuration validation failed:\n${errors.join('\n')}`);
  }
}

/**
 * Check if caching is enabled
 */
export function isCacheEnabled(): boolean {
  return CACHE_CONFIG.enabled;
}

/**
 * Get cache namespace
 */
export function getCacheNamespace(): string {
  return CACHE_CONFIG.namespace;
}

/**
 * Get default cache TTL
 */
export function getDefaultCacheTTL(): number {
  return CACHE_CONFIG.defaultTTL;
}

/**
 * Get default cache provider
 */
export function getDefaultCacheProvider(): CacheProviderType {
  return CACHE_CONFIG.defaultProvider;
}
