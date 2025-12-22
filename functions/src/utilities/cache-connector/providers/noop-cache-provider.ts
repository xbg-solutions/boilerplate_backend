/**
 * NoOp Cache Provider
 *
 * A no-operation cache provider used when caching is globally disabled.
 * All operations are no-ops that return immediately without doing anything.
 * This ensures zero performance overhead when caching is turned off.
 */

import { BaseCacheProvider } from './base-cache-provider';
import { CacheProviderType, CacheSetOptions, CacheEntry } from '../types';

export class NoOpCacheProvider extends BaseCacheProvider {
  getType(): CacheProviderType {
    return 'noop';
  }

  async get<T>(_key: string): Promise<T | null> {
    return null;
  }

  async getWithMetadata<T>(_key: string): Promise<CacheEntry<T> | null> {
    return null;
  }

  async set<T>(_key: string, _value: T, _options?: CacheSetOptions): Promise<void> {
    // No-op
  }

  async delete(_key: string): Promise<boolean> {
    return false;
  }

  async has(_key: string): Promise<boolean> {
    return false;
  }

  async invalidateByTags(_tags: string[]): Promise<number> {
    return 0;
  }

  async invalidateByPattern(_pattern: string, _mode?: 'prefix' | 'suffix' | 'contains'): Promise<number> {
    return 0;
  }

  async clear(): Promise<void> {
    // No-op
  }
}
