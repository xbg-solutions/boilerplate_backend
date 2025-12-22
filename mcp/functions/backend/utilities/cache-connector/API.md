# Cache Connector API Reference

Complete API documentation for the Cache Connector utility.

## Table of Contents

- [CacheConnector](#cacheconnector)
- [BaseRepository Cache Methods](#baserepository-cache-methods)
- [Cache Providers](#cache-providers)
- [Types](#types)
- [Configuration](#configuration)

## CacheConnector

Main facade class for cache operations.

### `getCacheConnector()`

Get the singleton CacheConnector instance.

```typescript
import { getCacheConnector } from '@utilities/cache-connector';

const cache = getCacheConnector();
```

**Returns:** `CacheConnector`

### `resetCacheConnector()`

Reset the cache connector instance (useful for testing).

```typescript
import { resetCacheConnector } from '@utilities/cache-connector';

resetCacheConnector();
```

**Returns:** `void`

---

## CacheConnector Methods

### `isEnabled()`

Check if caching is enabled globally.

```typescript
const enabled = cache.isEnabled();
```

**Returns:** `boolean`

---

### `get<T>(key, options?)`

Get a value from cache.

```typescript
const user = await cache.get<User>('user:123', {
  provider: 'memory'
});
```

**Parameters:**
- `key: string` - Cache key
- `options?: CacheGetOptions` - Optional get options
  - `provider?: CacheProviderType` - Provider override
  - `includeMetadata?: boolean` - Return metadata

**Returns:** `Promise<T | null>`

---

### `getWithMetadata<T>(key, options?)`

Get a value with metadata from cache.

```typescript
const entry = await cache.getWithMetadata<User>('user:123', {
  provider: 'memory'
});

if (entry) {
  console.log(entry.value);
  console.log(entry.metadata.hitCount);
  console.log(entry.metadata.expiresAt);
}
```

**Parameters:**
- `key: string` - Cache key
- `options?: CacheGetOptions` - Optional get options

**Returns:** `Promise<CacheEntry<T> | null>`

---

### `set<T>(key, value, options?)`

Set a value in cache.

```typescript
await cache.set('user:123', user, {
  ttl: 300,
  tags: ['users', 'auth'],
  provider: 'memory'
});
```

**Parameters:**
- `key: string` - Cache key
- `value: T` - Value to cache
- `options?: CacheSetOptions` - Optional set options
  - `ttl?: number` - Time-to-live in seconds
  - `tags?: string[]` - Invalidation tags
  - `provider?: CacheProviderType` - Provider override
  - `metadata?: Record<string, any>` - Additional metadata

**Returns:** `Promise<void>`

---

### `delete(key, options?)`

Delete a specific cache entry.

```typescript
const deleted = await cache.delete('user:123', {
  provider: 'memory'
});
```

**Parameters:**
- `key: string` - Cache key
- `options?: CacheInvalidateOptions` - Optional invalidate options

**Returns:** `Promise<boolean>` - True if entry was deleted

---

### `has(key, options?)`

Check if a cache entry exists.

```typescript
const exists = await cache.has('user:123', {
  provider: 'memory'
});
```

**Parameters:**
- `key: string` - Cache key
- `options?: CacheGetOptions` - Optional get options

**Returns:** `Promise<boolean>`

---

### `invalidateByTags(tags, options?)`

Invalidate cache entries by tags.

```typescript
const count = await cache.invalidateByTags(['users', 'auth'], {
  provider: 'memory'
});

console.log(`Invalidated ${count} entries`);
```

**Parameters:**
- `tags: string[]` - Tags to invalidate
- `options?: CacheInvalidateOptions` - Optional invalidate options

**Returns:** `Promise<number>` - Number of entries invalidated

---

### `invalidateByPattern(pattern, options?)`

Invalidate cache entries by key pattern.

```typescript
// Invalidate all keys starting with 'user:'
const count = await cache.invalidateByPattern('user:', {
  pattern: 'prefix',
  provider: 'memory'
});
```

**Parameters:**
- `pattern: string` - Pattern to match
- `options?: CacheInvalidateOptions` - Optional invalidate options
  - `pattern?: 'prefix' | 'suffix' | 'contains'` - Pattern mode
  - `provider?: CacheProviderType` - Provider override

**Returns:** `Promise<number>` - Number of entries invalidated

---

### `clear(options?)`

Clear all cache entries.

```typescript
await cache.clear({ provider: 'memory' });
```

**Parameters:**
- `options?: CacheInvalidateOptions` - Optional invalidate options

**Returns:** `Promise<void>`

---

### `clearAll()`

Clear all cache entries across all providers.

```typescript
await cache.clearAll();
```

**Returns:** `Promise<void>`

---

### `getStats(options?)`

Get cache statistics.

```typescript
const stats = await cache.getStats({ provider: 'memory' });

console.log({
  hits: stats.hits,
  misses: stats.misses,
  hitRatio: stats.hitRatio,
  entryCount: stats.entryCount,
  size: stats.size
});
```

**Parameters:**
- `options?: CacheGetOptions` - Optional get options

**Returns:** `Promise<CacheStats>`

---

### `getAllStats()`

Get statistics for all active providers.

```typescript
const allStats = await cache.getAllStats();

Object.entries(allStats).forEach(([provider, stats]) => {
  console.log(`${provider}: ${stats.hitRatio}`);
});
```

**Returns:** `Promise<Record<CacheProviderType, CacheStats>>`

---

### `cleanup(options?)`

Manually trigger cleanup of expired entries.

```typescript
const cleaned = await cache.cleanup({ provider: 'memory' });
console.log(`Cleaned up ${cleaned} expired entries`);
```

**Parameters:**
- `options?: CacheGetOptions` - Optional get options

**Returns:** `Promise<number>` - Number of entries cleaned up

---

### `buildKey(...parts)`

Build a namespaced cache key.

```typescript
const key = cache.buildKey('user', 'email', 'john@example.com');
// Returns: 'v1:user:email:john@example.com'
```

**Parameters:**
- `...parts: string[]` - Key parts to join

**Returns:** `string`

---

### `destroy()`

Destroy all providers and cleanup resources.

```typescript
cache.destroy();
```

**Returns:** `void`

---

## BaseRepository Cache Methods

Methods available in repositories that extend `BaseRepository`.

### `findByIdCached(id, options?)`

Find entity by ID with caching.

```typescript
const user = await userRepo.findByIdCached('user-123', {
  ttl: 300,
  forceRefresh: false
});
```

**Parameters:**
- `id: string` - Entity ID
- `options?: CacheOptions` - Optional cache options
  - `ttl?: number` - TTL override
  - `tags?: string[]` - Additional tags
  - `forceRefresh?: boolean` - Skip cache lookup
  - `metadata?: Record<string, any>` - Additional metadata

**Returns:** `Promise<T | null>`

---

### Protected Helper Methods

Methods available to subclasses for implementing custom cached methods.

#### `isCacheEnabled()`

Check if caching is enabled for this repository.

```typescript
protected async myCustomMethod() {
  if (!this.isCacheEnabled()) {
    return this.fallbackMethod();
  }
  // Use cache
}
```

**Returns:** `boolean`

---

#### `getCacheProvider()`

Get effective cache provider for this repository.

```typescript
const provider = this.getCacheProvider();
// Returns: 'memory' | 'firestore' | 'redis'
```

**Returns:** `CacheProviderType`

---

#### `getCacheTTL(override?)`

Get effective TTL for this repository.

```typescript
const ttl = this.getCacheTTL(600); // Override with 10 minutes
```

**Parameters:**
- `override?: number` - TTL override

**Returns:** `number`

---

#### `buildCacheKey(type, identifier)`

Build cache key with repository prefix.

```typescript
const key = this.buildCacheKey('email', 'john@example.com');
// Returns: 'v1:users:email:john@example.com'
```

**Parameters:**
- `type: string` - Key type
- `identifier: string` - Entity identifier

**Returns:** `string`

---

#### `buildCacheTags(entity, additionalTags?)`

Build cache tags for invalidation.

```typescript
const tags = this.buildCacheTags(user, ['auth']);
// Returns: ['users', 'users:user-123', 'auth']
```

**Parameters:**
- `entity: T` - Entity instance
- `additionalTags?: string[]` - Additional tags

**Returns:** `string[]`

---

#### `invalidateEntityCache(id)`

Invalidate cache for a specific entity.

```typescript
await this.invalidateEntityCache('user-123');
```

**Parameters:**
- `id: string` - Entity ID

**Returns:** `Promise<void>`

---

## Types

### `CacheProviderType`

```typescript
type CacheProviderType = 'memory' | 'firestore' | 'redis' | 'noop';
```

---

### `CacheOptions`

```typescript
interface CacheOptions {
  ttl?: number;
  tags?: string[];
  forceRefresh?: boolean;
  metadata?: Record<string, any>;
}
```

---

### `CacheSetOptions`

```typescript
interface CacheSetOptions extends CacheOptions {
  provider?: CacheProviderType;
}
```

---

### `CacheGetOptions`

```typescript
interface CacheGetOptions {
  provider?: CacheProviderType;
  includeMetadata?: boolean;
}
```

---

### `CacheInvalidateOptions`

```typescript
interface CacheInvalidateOptions {
  provider?: CacheProviderType;
  pattern?: 'exact' | 'prefix' | 'suffix' | 'contains';
}
```

---

### `RepositoryCacheConfig`

```typescript
interface RepositoryCacheConfig {
  enabled: boolean;
  provider?: CacheProviderType;
  ttl?: number;
  keyPrefix?: string;
  tags?: string[];
  strategies?: CacheStrategy[];
}
```

---

### `CacheEntry<T>`

```typescript
interface CacheEntry<T> {
  key: string;
  value: T;
  metadata: CacheEntryMetadata;
}
```

---

### `CacheEntryMetadata`

```typescript
interface CacheEntryMetadata {
  createdAt: Date;
  expiresAt: Date;
  hitCount: number;
  lastAccessedAt: Date;
  tags: string[];
  size?: number;
}
```

---

### `CacheStats`

```typescript
interface CacheStats {
  hits: number;
  misses: number;
  hitRatio: number;
  entryCount: number;
  size: number;
  evictions: number;
  expirations: number;
}
```

---

## Configuration

### `CACHE_CONFIG`

Global cache configuration object.

```typescript
import { CACHE_CONFIG } from '@config/cache.config';

console.log(CACHE_CONFIG.enabled);
console.log(CACHE_CONFIG.defaultProvider);
console.log(CACHE_CONFIG.defaultTTL);
```

---

### Configuration Helper Functions

#### `isCacheEnabled()`

```typescript
import { isCacheEnabled } from '@config/cache.config';

if (isCacheEnabled()) {
  // Use caching
}
```

**Returns:** `boolean`

---

#### `getCacheNamespace()`

```typescript
import { getCacheNamespace } from '@config/cache.config';

const namespace = getCacheNamespace();
```

**Returns:** `string`

---

#### `getDefaultCacheTTL()`

```typescript
import { getDefaultCacheTTL } from '@config/cache.config';

const ttl = getDefaultCacheTTL();
```

**Returns:** `number`

---

#### `getDefaultCacheProvider()`

```typescript
import { getDefaultCacheProvider } from '@config/cache.config';

const provider = getDefaultCacheProvider();
```

**Returns:** `CacheProviderType`

---

#### `validateCacheConfig()`

```typescript
import { validateCacheConfig } from '@config/cache.config';

try {
  validateCacheConfig();
  console.log('Cache config is valid');
} catch (error) {
  console.error('Invalid cache config:', error);
}
```

**Returns:** `void`
**Throws:** `Error` if configuration is invalid

---

## Example: Custom Cached Repository Method

```typescript
import { BaseRepository } from '@/base/BaseRepository';
import { getCacheConnector } from '@utilities/cache-connector';
import { CacheOptions } from '@utilities/cache-connector/types';

export class UserRepository extends BaseRepository<User> {
  protected collectionName = 'users';

  protected cacheConfig = {
    enabled: true,
    provider: 'memory' as const,
    ttl: 300
  };

  /**
   * Find user by email with caching
   */
  async findByEmailCached(
    email: string,
    options: CacheOptions = {}
  ): Promise<User | null> {
    // Check if caching is enabled
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

    // Cache miss - fetch from database
    this.logCacheMiss(cacheKey);
    const user = await this.findByEmail(email);

    // Store in cache
    if (user) {
      await cache.set(cacheKey, user, {
        ttl: this.getCacheTTL(options.ttl),
        tags: this.buildCacheTags(user, ['email', ...(options.tags || [])]),
        provider
      });
    }

    return user;
  }

  /**
   * Regular method (no caching)
   */
  private async findByEmail(email: string): Promise<User | null> {
    const snapshot = await this.getCollection()
      .where('email', '==', email)
      .limit(1)
      .get();

    if (snapshot.empty) {
      return null;
    }

    return this.fromFirestore(snapshot.docs[0].id, snapshot.docs[0].data());
  }
}
```
