/**
 * Cache Connector Type Definitions
 *
 * Defines the types and interfaces for the multi-level caching system.
 */

/**
 * Supported cache provider types
 */
export type CacheProviderType = 'memory' | 'firestore' | 'redis' | 'noop';

/**
 * Cache strategies for advanced behavior
 */
export type CacheStrategy =
  | 'write-through'    // Update cache and DB simultaneously
  | 'write-behind'     // Update cache first, DB async
  | 'cache-aside'      // Lazy loading (default)
  | 'refresh-ahead';   // Pre-emptive refresh before TTL

/**
 * Global cache configuration (project-level)
 */
export interface CacheConfig {
  /**
   * Master switch - if false, all caching is disabled
   */
  enabled: boolean;

  /**
   * Default provider for repositories that don't specify
   */
  defaultProvider: CacheProviderType;

  /**
   * Default TTL in seconds
   */
  defaultTTL: number;

  /**
   * Global cache namespace (for versioning)
   * Change this to invalidate all cached data
   */
  namespace: string;

  /**
   * Provider-specific configurations
   */
  providers: {
    memory: MemoryCacheProviderConfig;
    firestore: FirestoreCacheProviderConfig;
    redis?: RedisCacheProviderConfig;
  };
}

/**
 * Memory cache provider configuration
 */
export interface MemoryCacheProviderConfig {
  /**
   * Maximum cache size in bytes
   */
  maxSize: number;

  /**
   * Interval to check for expired entries (seconds)
   */
  checkPeriod: number;

  /**
   * Whether to use LRU eviction when max size is reached
   */
  useClones?: boolean;
}

/**
 * Firestore cache provider configuration
 */
export interface FirestoreCacheProviderConfig {
  /**
   * Which database to use for cache storage
   */
  database: string;

  /**
   * Collection name for cache entries
   */
  collection: string;

  /**
   * Enable automatic cleanup of expired entries
   */
  enableCleanup: boolean;

  /**
   * Cleanup interval in seconds
   */
  cleanupInterval: number;
}

/**
 * Redis cache provider configuration
 */
export interface RedisCacheProviderConfig {
  /**
   * Redis server host
   */
  host: string;

  /**
   * Redis server port
   */
  port: number;

  /**
   * Redis password (optional)
   */
  password?: string;

  /**
   * Redis database number
   */
  db: number;

  /**
   * Connection timeout in milliseconds
   */
  connectTimeout?: number;

  /**
   * Enable TLS
   */
  tls?: boolean;
}

/**
 * Repository-level cache configuration
 */
export interface RepositoryCacheConfig {
  /**
   * Enable caching for this repository (only if global is enabled)
   */
  enabled: boolean;

  /**
   * Which provider to use (overrides global default)
   */
  provider?: CacheProviderType;

  /**
   * Default TTL for this repository (overrides global default)
   */
  ttl?: number;

  /**
   * Cache key prefix for this repository
   */
  keyPrefix?: string;

  /**
   * Invalidation tags (auto-applied to all cache entries)
   */
  tags?: string[];

  /**
   * Advanced: cache strategies
   */
  strategies?: CacheStrategy[];
}

/**
 * Method-level cache options (runtime)
 */
export interface CacheOptions {
  /**
   * Time-to-live override in seconds
   */
  ttl?: number;

  /**
   * Tags for cache invalidation
   */
  tags?: string[];

  /**
   * Force refresh, skip cache lookup
   */
  forceRefresh?: boolean;

  /**
   * Additional metadata for debugging
   */
  metadata?: Record<string, any>;
}

/**
 * Options for setting cache entries
 */
export interface CacheSetOptions extends CacheOptions {
  /**
   * Provider to use for this operation
   */
  provider?: CacheProviderType;
}

/**
 * Options for getting cache entries
 */
export interface CacheGetOptions {
  /**
   * Provider to use for this operation
   */
  provider?: CacheProviderType;

  /**
   * Return metadata along with value
   */
  includeMetadata?: boolean;
}

/**
 * Options for invalidation operations
 */
export interface CacheInvalidateOptions {
  /**
   * Provider to use for this operation
   */
  provider?: CacheProviderType;

  /**
   * Pattern matching mode
   */
  pattern?: 'exact' | 'prefix' | 'suffix' | 'contains';
}

/**
 * Cache entry metadata
 */
export interface CacheEntryMetadata {
  /**
   * When the entry was created
   */
  createdAt: Date;

  /**
   * When the entry expires
   */
  expiresAt: Date;

  /**
   * Number of times this entry has been accessed
   */
  hitCount: number;

  /**
   * Last access timestamp
   */
  lastAccessedAt: Date;

  /**
   * Tags associated with this entry
   */
  tags: string[];

  /**
   * Size in bytes (approximate)
   */
  size?: number;
}

/**
 * Cache entry with metadata
 */
export interface CacheEntry<T = any> {
  /**
   * Cache key
   */
  key: string;

  /**
   * Cached value
   */
  value: T;

  /**
   * Entry metadata
   */
  metadata: CacheEntryMetadata;
}

/**
 * Cache statistics
 */
export interface CacheStats {
  /**
   * Total number of cache hits
   */
  hits: number;

  /**
   * Total number of cache misses
   */
  misses: number;

  /**
   * Hit ratio (hits / (hits + misses))
   */
  hitRatio: number;

  /**
   * Total number of entries in cache
   */
  entryCount: number;

  /**
   * Total size of cache in bytes
   */
  size: number;

  /**
   * Number of evictions (LRU or size-based)
   */
  evictions: number;

  /**
   * Number of expirations
   */
  expirations: number;
}

/**
 * Cache operation result
 */
export interface CacheOperationResult {
  /**
   * Whether the operation succeeded
   */
  success: boolean;

  /**
   * Error message if operation failed
   */
  error?: string;

  /**
   * Operation duration in milliseconds
   */
  duration?: number;
}

/**
 * Base cache provider interface
 * All cache providers must implement this interface
 */
export interface ICacheProvider {
  /**
   * Get a value from cache
   */
  get<T>(key: string): Promise<T | null>;

  /**
   * Get a value with metadata
   */
  getWithMetadata<T>(key: string): Promise<CacheEntry<T> | null>;

  /**
   * Set a value in cache
   */
  set<T>(key: string, value: T, options?: CacheSetOptions): Promise<void>;

  /**
   * Delete a specific key
   */
  delete(key: string): Promise<boolean>;

  /**
   * Check if a key exists
   */
  has(key: string): Promise<boolean>;

  /**
   * Invalidate cache entries by tags
   */
  invalidateByTags(tags: string[]): Promise<number>;

  /**
   * Invalidate cache entries by pattern
   */
  invalidateByPattern(pattern: string, mode?: 'prefix' | 'suffix' | 'contains'): Promise<number>;

  /**
   * Clear all cache entries
   */
  clear(): Promise<void>;

  /**
   * Get cache statistics
   */
  getStats(): Promise<CacheStats>;

  /**
   * Get the provider type
   */
  getType(): CacheProviderType;

  /**
   * Cleanup expired entries (if supported)
   */
  cleanup?(): Promise<number>;
}
