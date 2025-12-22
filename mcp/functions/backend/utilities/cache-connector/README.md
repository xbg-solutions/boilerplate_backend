# Cache Connector

Multi-level caching system with pluggable providers for Firebase Functions applications.

## Overview

The Cache Connector provides a flexible, production-ready caching solution that supports multiple cache providers and can be enabled/disabled at both project and repository levels. It follows a progressive enhancement model - start with caching disabled, then enable it incrementally as your usage patterns demand.

## Features

- **Multi-level configuration**: Project-level master switch + repository-level granularity
- **Multiple providers**: Memory (in-process), Firestore (distributed), Redis (future)
- **Zero overhead when disabled**: No-op provider pattern ensures no performance impact
- **Tag-based invalidation**: Invalidate related cache entries by tags
- **TTL-based expiration**: Automatic cleanup of expired entries
- **Automatic cache invalidation**: Repository mutations auto-invalidate cache
- **Statistics and monitoring**: Built-in metrics for cache performance
- **Type-safe**: Full TypeScript support with generics

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Level 1: Global Project Config (Master Switch)        │
│  ├─ enabled: boolean                                    │
│  ├─ defaultProvider: 'memory' | 'firestore' | 'redis'  │
│  └─ defaultTTL: number                                  │
└────────────┬────────────────────────────────────────────┘
             │ If disabled, all caching is no-op
             ▼
┌─────────────────────────────────────────────────────────┐
│  Level 2: Repository-Level Config (Per-Entity)         │
│  ├─ enabled: boolean  (respects global)                │
│  ├─ provider: string  (override default)               │
│  ├─ ttl: number       (override default)               │
│  └─ tags: string[]    (auto-applied tags)              │
└────────────┬────────────────────────────────────────────┘
             │ Inherits from global if not specified
             ▼
┌─────────────────────────────────────────────────────────┐
│  Level 3: Method-Level Options (Runtime)               │
│  ├─ ttl?: number      (one-off override)               │
│  ├─ tags?: string[]   (invalidation groups)            │
│  └─ forceRefresh?: boolean                             │
└─────────────────────────────────────────────────────────┘
```

## Quick Start

### 1. Enable Caching Globally

Set environment variable:

```bash
# .env
CACHE_ENABLED=true
CACHE_DEFAULT_PROVIDER=memory
CACHE_DEFAULT_TTL=300
```

### 2. Enable Caching in a Repository

```typescript
import { BaseRepository } from '@/base/BaseRepository';
import { User } from './User';

export class UserRepository extends BaseRepository<User> {
  protected collectionName = 'users';

  // Enable caching for this repository
  protected cacheConfig = {
    enabled: true,          // Opt-in to caching
    provider: 'memory',     // Use in-memory cache
    ttl: 300,               // 5 minutes
    keyPrefix: 'user',
    tags: ['auth', 'users']
  };
}
```

### 3. Use Cached Methods

```typescript
// Use cached version
const user = await userRepository.findByIdCached('user123');

// Force refresh
const freshUser = await userRepository.findByIdCached('user123', {
  forceRefresh: true
});

// Custom TTL
const shortCacheUser = await userRepository.findByIdCached('user123', {
  ttl: 60 // 1 minute
});
```

## Configuration

### Global Configuration

Located in `/functions/src/config/cache.config.ts`:

```typescript
export const CACHE_CONFIG: CacheConfig = {
  // Master switch
  enabled: process.env.CACHE_ENABLED === 'true',

  // Default provider
  defaultProvider: process.env.CACHE_DEFAULT_PROVIDER || 'memory',

  // Default TTL (seconds)
  defaultTTL: parseInt(process.env.CACHE_DEFAULT_TTL || '300'),

  // Cache namespace (for versioning)
  namespace: process.env.CACHE_NAMESPACE || 'v1',

  // Provider-specific configs
  providers: {
    memory: { /* ... */ },
    firestore: { /* ... */ },
    redis: { /* ... */ }
  }
};
```

### Environment Variables

```bash
# Master switch
CACHE_ENABLED=true|false

# Default provider: 'memory', 'firestore', 'redis'
CACHE_DEFAULT_PROVIDER=memory

# Default TTL in seconds
CACHE_DEFAULT_TTL=300

# Cache namespace for versioning
CACHE_NAMESPACE=v1

# Memory provider settings
CACHE_MEMORY_MAX_SIZE_MB=100
CACHE_MEMORY_CHECK_PERIOD=60
CACHE_MEMORY_USE_CLONES=false

# Firestore provider settings
CACHE_FIRESTORE_DATABASE=systemDB
CACHE_FIRESTORE_COLLECTION=_cache
CACHE_FIRESTORE_ENABLE_CLEANUP=true
CACHE_FIRESTORE_CLEANUP_INTERVAL=3600

# Redis provider settings (optional)
# CACHE_REDIS_HOST=localhost
# CACHE_REDIS_PORT=6379
# CACHE_REDIS_PASSWORD=
# CACHE_REDIS_DB=0
```

### Repository Configuration

```typescript
protected cacheConfig: RepositoryCacheConfig = {
  // Enable caching (only if global is enabled)
  enabled: true,

  // Provider override
  provider: 'memory',

  // TTL override (seconds)
  ttl: 300,

  // Key prefix for this repository
  keyPrefix: 'user',

  // Auto-applied tags
  tags: ['auth', 'users'],

  // Advanced strategies (future)
  strategies: []
};
```

## Cache Providers

### Memory Provider

**Best for:**
- Request-scoped caching
- Hot data within a single function instance
- Auth/permissions data
- Configuration values

**Limitations:**
- Not shared across function instances
- Lost on cold starts
- Limited by instance memory

**Configuration:**
```typescript
memory: {
  maxSize: 100 * 1024 * 1024,  // 100MB
  checkPeriod: 60,              // Cleanup interval
  useClones: false              // Clone values on get/set
}
```

### Firestore Provider

**Best for:**
- Medium-traffic repositories
- Data shared across function instances
- Cache that should survive cold starts

**Trade-offs:**
- Latency: ~50-100ms (vs memory ~1-5ms)
- Cost: Firestore read/write operations
- Size limit: 1MB per document

**Configuration:**
```typescript
firestore: {
  database: 'systemDB',
  collection: '_cache',
  enableCleanup: true,
  cleanupInterval: 3600  // 1 hour
}
```

### Redis Provider (Future)

**Best for:**
- High-traffic applications (>1M requests/month)
- Sub-10ms response time requirements
- Cache sizes exceeding Firestore limits

**Cost:** ~$50/month minimum (Google Cloud Memorystore)

## Usage Examples

### Basic Caching

```typescript
// Define repository with caching
export class ProductRepository extends BaseRepository<Product> {
  protected collectionName = 'products';

  protected cacheConfig = {
    enabled: true,
    provider: 'firestore',
    ttl: 600  // 10 minutes
  };
}

// Use cached methods
const product = await productRepo.findByIdCached('prod-123');
```

### Custom Cache Methods

```typescript
export class UserRepository extends BaseRepository<User> {
  protected collectionName = 'users';

  protected cacheConfig = {
    enabled: true,
    provider: 'memory',
    ttl: 300
  };

  // Custom cached method
  async findByEmailCached(email: string, options: CacheOptions = {}): Promise<User | null> {
    if (!this.isCacheEnabled()) {
      return this.findByEmail(email);
    }

    const cache = getCacheConnector();
    const cacheKey = this.buildCacheKey('email', email);
    const provider = this.getCacheProvider();

    // Try cache first
    if (!options.forceRefresh) {
      const cached = await cache.get<User>(cacheKey, { provider });
      if (cached) {
        this.logCacheHit(cacheKey);
        return cached;
      }
    }

    // Cache miss
    this.logCacheMiss(cacheKey);
    const user = await this.findByEmail(email);

    // Store in cache
    if (user) {
      await cache.set(cacheKey, user, {
        ttl: this.getCacheTTL(options.ttl),
        tags: this.buildCacheTags(user, ['email', options.tags]),
        provider
      });
    }

    return user;
  }
}
```

### Manual Cache Operations

```typescript
import { getCacheConnector } from '@utilities/cache-connector';

const cache = getCacheConnector();

// Set value
await cache.set('my-key', { foo: 'bar' }, {
  ttl: 300,
  tags: ['myapp', 'feature-x'],
  provider: 'memory'
});

// Get value
const value = await cache.get<MyType>('my-key', {
  provider: 'memory'
});

// Invalidate by tags
await cache.invalidateByTags(['feature-x']);

// Invalidate by pattern
await cache.invalidateByPattern('user:', { pattern: 'prefix' });

// Get stats
const stats = await cache.getStats({ provider: 'memory' });
console.log(`Hit ratio: ${stats.hitRatio}`);
```

### Progressive Enablement

```typescript
// Stage 1: New project, no caching
// .env: CACHE_ENABLED=false
// All repositories work normally

// Stage 2: Enable caching for auth layer
// .env: CACHE_ENABLED=true, CACHE_DEFAULT_PROVIDER=memory
export class UserRepository extends BaseRepository<User> {
  protected cacheConfig = {
    enabled: true,
    provider: 'memory',
    ttl: 300
  };
}

// Stage 3: High traffic, add Firestore cache for products
export class ProductRepository extends BaseRepository<Product> {
  protected cacheConfig = {
    enabled: true,
    provider: 'firestore',
    ttl: 600
  };
}

// Stage 4: Scale further, add Redis for hot data
// .env: Add CACHE_REDIS_HOST, CACHE_REDIS_PORT
export class UserRepository extends BaseRepository<User> {
  protected cacheConfig = {
    enabled: true,
    provider: 'redis',
    ttl: 300
  };
}
```

## Cache Invalidation

### Automatic Invalidation

Cache is automatically invalidated when entities are updated or deleted:

```typescript
// Update invalidates cache
await userRepo.update(user);  // Cache for this user is cleared

// Delete invalidates cache
await userRepo.delete(userId);  // Cache for this user is cleared
```

### Manual Invalidation

```typescript
// Invalidate specific entity
await userRepo.invalidateEntityCache('user-123');

// Invalidate by tags
const cache = getCacheConnector();
await cache.invalidateByTags(['users', 'auth']);

// Invalidate by pattern
await cache.invalidateByPattern('user:email:', { pattern: 'prefix' });

// Clear all cache for a provider
await cache.clear({ provider: 'memory' });

// Clear all cache across all providers
await cache.clearAll();
```

### Cache Versioning

Change the namespace to invalidate all cached data:

```bash
# .env
CACHE_NAMESPACE=v2  # Changed from v1
```

All existing cache entries become inaccessible with the new namespace.

## Monitoring

### Cache Statistics

```typescript
const cache = getCacheConnector();

// Get stats for specific provider
const memoryStats = await cache.getStats({ provider: 'memory' });
console.log({
  hits: memoryStats.hits,
  misses: memoryStats.misses,
  hitRatio: memoryStats.hitRatio,
  entryCount: memoryStats.entryCount,
  size: memoryStats.size
});

// Get stats for all providers
const allStats = await cache.getAllStats();
```

### Logging

Cache operations are automatically logged:

```typescript
// Cache hits/misses are logged at DEBUG level
logger.debug('Cache hit', { key: 'user:123' });
logger.debug('Cache miss', { key: 'user:123' });

// Cache invalidation is logged at DEBUG level
logger.debug('Cache invalidated', { tags: ['users'] });

// Cache errors are logged at WARN level
logger.warn('Failed to invalidate cache', error);
```

## Best Practices

### 1. Start Disabled

Leave caching disabled (`CACHE_ENABLED=false`) for new projects. Enable it when you have:
- Performance metrics showing need for caching
- Clear understanding of your data access patterns
- Monitoring in place to track cache effectiveness

### 2. Choose the Right Provider

- **Memory**: Auth data, permissions, config (< 1 min TTL)
- **Firestore**: Product catalogs, user profiles (5-30 min TTL)
- **Redis**: When you have >1M requests/month and can justify the cost

### 3. Set Appropriate TTLs

- **User auth/permissions**: 1-5 minutes
- **Reference data**: 15-60 minutes
- **Computed values**: 5-15 minutes
- **Search results**: 1-5 minutes

### 4. Use Tags for Invalidation

```typescript
protected cacheConfig = {
  enabled: true,
  tags: ['users', 'auth']  // Auto-applied to all entries
};

// Invalidate all user-related cache
await cache.invalidateByTags(['users']);
```

### 5. Monitor Cache Performance

```typescript
// Log stats periodically
setInterval(async () => {
  const stats = await cache.getAllStats();
  logger.info('Cache statistics', { stats });
}, 60000);  // Every minute
```

### 6. Handle Cache Failures Gracefully

The system is designed to fail open - if cache operations fail, it falls back to database:

```typescript
// Cache failures don't break your app
try {
  const cached = await cache.get('key');
  if (!cached) {
    // Fall back to database
    return await db.fetch();
  }
} catch (error) {
  // Log and continue
  logger.warn('Cache error, using database', error);
  return await db.fetch();
}
```

## Testing

### Unit Tests

```typescript
import { getCacheConnector, resetCacheConnector } from '@utilities/cache-connector';

describe('UserRepository', () => {
  beforeEach(() => {
    resetCacheConnector();
  });

  it('should use cache when enabled', async () => {
    // Test with caching enabled
    const user = await userRepo.findByIdCached('user-123');

    // Second call should hit cache
    const cachedUser = await userRepo.findByIdCached('user-123');

    expect(cachedUser).toEqual(user);
  });
});
```

### Integration Tests

```typescript
describe('Cache Integration', () => {
  it('should invalidate cache on update', async () => {
    const user = await userRepo.findByIdCached('user-123');

    // Update user
    user.name = 'Updated Name';
    await userRepo.update(user);

    // Cache should be invalidated
    const cache = getCacheConnector();
    const cached = await cache.get('v1:users:id:user-123');

    expect(cached).toBeNull();
  });
});
```

## Troubleshooting

### Cache Not Working

1. Check global config: `CACHE_ENABLED=true`
2. Check repository config: `cacheConfig.enabled = true`
3. Check logs for cache operations
4. Verify provider configuration

### High Cache Miss Rate

1. Check TTL - might be too short
2. Monitor invalidation frequency
3. Check if cache size limits are being hit
4. Review cache key strategy

### Memory Issues

1. Reduce `CACHE_MEMORY_MAX_SIZE_MB`
2. Reduce TTL values
3. Switch to Firestore provider for large datasets

### Firestore Costs Too High

1. Increase TTL to reduce writes
2. Review what you're caching
3. Consider memory provider for frequently accessed data
4. Check cleanup interval

## API Reference

See [API Documentation](./API.md) for detailed API reference.

## Architecture Details

See [Architecture Documentation](./ARCHITECTURE.md) for implementation details.
