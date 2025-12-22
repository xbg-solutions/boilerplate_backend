/**
 * Firestore Cache Provider
 *
 * Firestore-based cache provider for distributed caching across function instances.
 *
 * Features:
 * - Shared cache across all function instances
 * - Persistent across cold starts
 * - TTL-based expiration using Firestore timestamps
 * - Tag-based invalidation
 * - Automatic cleanup of expired entries
 *
 * Best for:
 * - Medium-traffic repositories
 * - Data that needs to be shared across instances
 * - Cache data that should survive cold starts
 *
 * Trade-offs:
 * - Latency: ~50-100ms (vs memory ~1-5ms)
 * - Cost: Firestore read/write operations
 * - Size limit: 1MB per document
 */

import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { BaseCacheProvider } from './base-cache-provider';
import {
  CacheProviderType,
  CacheSetOptions,
  CacheEntry,
  FirestoreCacheProviderConfig,
} from '../types';
import { logger } from '../../logger';

interface FirestoreCacheDocument {
  key: string;
  value: any;
  createdAt: Timestamp;
  expiresAt: Timestamp;
  hitCount: number;
  lastAccessedAt: Timestamp;
  tags: string[];
  size?: number;
}

export class FirestoreCacheProvider extends BaseCacheProvider {
  private db: admin.firestore.Firestore;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(private config: FirestoreCacheProviderConfig) {
    super();

    // Get Firestore instance
    // We use the default app's Firestore and access the systemDB
    this.db = admin.firestore();

    // Start automatic cleanup if enabled
    if (config.enableCleanup) {
      this.startCleanup();
    }
  }

  getType(): CacheProviderType {
    return 'firestore';
  }

  /**
   * Get collection reference
   */
  private getCollection(): admin.firestore.CollectionReference<FirestoreCacheDocument> {
    return this.db.collection(this.config.collection) as admin.firestore.CollectionReference<FirestoreCacheDocument>;
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      const docRef = this.getCollection().doc(key);
      const doc = await docRef.get();

      if (!doc.exists) {
        this.recordMiss();
        return null;
      }

      const data = doc.data();
      if (!data) {
        this.recordMiss();
        return null;
      }

      // Check if expired
      const expiresAt = data.expiresAt.toDate();
      if (this.isExpired(expiresAt)) {
        // Delete expired entry
        await docRef.delete();
        this.recordExpiration();
        this.recordMiss();
        return null;
      }

      // Update access metadata (fire and forget)
      docRef.update({
        hitCount: admin.firestore.FieldValue.increment(1),
        lastAccessedAt: Timestamp.now(),
      }).catch((error) => {
        logger.warn('Failed to update cache access metadata', {
          operation: 'cache.get',
          key,
          error,
        });
      });

      this.recordHit();
      return data.value as T;
    } catch (error) {
      logger.error('Error getting cache entry from Firestore', error as Error, {
        operation: 'cache.get',
        key,
      });
      this.recordMiss();
      return null;
    }
  }

  async getWithMetadata<T>(key: string): Promise<CacheEntry<T> | null> {
    try {
      const docRef = this.getCollection().doc(key);
      const doc = await docRef.get();

      if (!doc.exists) {
        this.recordMiss();
        return null;
      }

      const data = doc.data();
      if (!data) {
        this.recordMiss();
        return null;
      }

      // Check if expired
      const expiresAt = data.expiresAt.toDate();
      if (this.isExpired(expiresAt)) {
        await docRef.delete();
        this.recordExpiration();
        this.recordMiss();
        return null;
      }

      this.recordHit();

      return {
        key,
        value: data.value as T,
        metadata: {
          createdAt: data.createdAt.toDate(),
          expiresAt: expiresAt,
          hitCount: data.hitCount,
          lastAccessedAt: data.lastAccessedAt.toDate(),
          tags: data.tags,
          size: data.size,
        },
      };
    } catch (error) {
      logger.error('Error getting cache entry with metadata from Firestore', error as Error, {
        operation: 'cache.getWithMetadata',
        key,
      });
      this.recordMiss();
      return null;
    }
  }

  async set<T>(key: string, value: T, options: CacheSetOptions = {}): Promise<void> {
    try {
      const ttl = options.ttl || 300; // Default 5 minutes
      const tags = options.tags || [];
      const size = this.estimateSize(value);

      const now = Timestamp.now();
      const expiresAt = Timestamp.fromDate(this.calculateExpiresAt(ttl));

      const cacheDoc: FirestoreCacheDocument = {
        key,
        value,
        createdAt: now,
        expiresAt,
        hitCount: 0,
        lastAccessedAt: now,
        tags,
        size,
      };

      await this.getCollection().doc(key).set(cacheDoc);
    } catch (error) {
      logger.error('Error setting cache entry in Firestore', error as Error, {
        operation: 'cache.set',
        key,
        ttl: options.ttl,
      });
      throw error;
    }
  }

  async delete(key: string): Promise<boolean> {
    try {
      const docRef = this.getCollection().doc(key);
      const doc = await docRef.get();

      if (!doc.exists) {
        return false;
      }

      await docRef.delete();
      return true;
    } catch (error) {
      logger.error('Error deleting cache entry from Firestore', error as Error, {
        operation: 'cache.delete',
        key,
      });
      return false;
    }
  }

  async has(key: string): Promise<boolean> {
    try {
      const docRef = this.getCollection().doc(key);
      const doc = await docRef.get();

      if (!doc.exists) {
        return false;
      }

      const data = doc.data();
      if (!data) {
        return false;
      }

      // Check if expired
      const expiresAt = data.expiresAt.toDate();
      if (this.isExpired(expiresAt)) {
        await docRef.delete();
        this.recordExpiration();
        return false;
      }

      return true;
    } catch (error) {
      logger.error('Error checking cache entry in Firestore', error as Error, {
        operation: 'cache.has',
        key,
      });
      return false;
    }
  }

  async invalidateByTags(tags: string[]): Promise<number> {
    try {
      let count = 0;

      // Query for documents with any of the specified tags
      for (const tag of tags) {
        const query = this.getCollection().where('tags', 'array-contains', tag);
        const snapshot = await query.get();

        // Delete matching documents in batch
        const batch = this.db.batch();
        snapshot.docs.forEach((doc) => {
          batch.delete(doc.ref);
          count++;
        });

        if (!snapshot.empty) {
          await batch.commit();
        }
      }

      return count;
    } catch (error) {
      logger.error('Error invalidating cache by tags in Firestore', error as Error, {
        operation: 'cache.invalidateByTags',
        tags,
      });
      return 0;
    }
  }

  async invalidateByPattern(
    pattern: string,
    mode: 'prefix' | 'suffix' | 'contains' = 'prefix'
  ): Promise<number> {
    try {
      let query: admin.firestore.Query<FirestoreCacheDocument>;

      if (mode === 'prefix') {
        // Use Firestore range query for prefix matching
        const endPattern = pattern.slice(0, -1) + String.fromCharCode(pattern.charCodeAt(pattern.length - 1) + 1);
        query = this.getCollection()
          .where('key', '>=', pattern)
          .where('key', '<', endPattern);
      } else {
        // For suffix and contains, we need to get all documents and filter
        // This is inefficient but Firestore doesn't support these natively
        query = this.getCollection();
      }

      const snapshot = await query.get();
      let count = 0;

      const batch = this.db.batch();
      snapshot.docs.forEach((doc) => {
        const key = doc.data().key;

        // Apply pattern matching
        if (mode === 'prefix' || this.matchPattern(key, pattern, mode)) {
          batch.delete(doc.ref);
          count++;
        }
      });

      if (count > 0) {
        await batch.commit();
      }

      return count;
    } catch (error) {
      logger.error('Error invalidating cache by pattern in Firestore', error as Error, {
        operation: 'cache.invalidateByPattern',
        pattern,
        mode,
      });
      return 0;
    }
  }

  async clear(): Promise<void> {
    try {
      // Delete all documents in batches
      const batchSize = 500;
      let snapshot = await this.getCollection().limit(batchSize).get();

      while (!snapshot.empty) {
        const batch = this.db.batch();
        snapshot.docs.forEach((doc) => {
          batch.delete(doc.ref);
        });
        await batch.commit();

        // Get next batch
        snapshot = await this.getCollection().limit(batchSize).get();
      }
    } catch (error) {
      logger.error('Error clearing cache in Firestore', error as Error, {
        operation: 'cache.clear',
      });
      throw error;
    }
  }

  async cleanup(): Promise<number> {
    try {
      const now = Timestamp.now();
      const query = this.getCollection().where('expiresAt', '<', now);
      const snapshot = await query.get();

      if (snapshot.empty) {
        return 0;
      }

      // Delete expired documents in batches
      const batch = this.db.batch();
      snapshot.docs.forEach((doc) => {
        batch.delete(doc.ref);
        this.recordExpiration();
      });

      await batch.commit();

      logger.debug(`Cleaned up ${snapshot.size} expired cache entries`, {
        operation: 'cache.cleanup',
        count: snapshot.size,
      });

      return snapshot.size;
    } catch (error) {
      logger.error('Error cleaning up expired cache entries in Firestore', error as Error, {
        operation: 'cache.cleanup',
      });
      return 0;
    }
  }

  async getStats(): Promise<any> {
    try {
      const snapshot = await this.getCollection().get();
      let totalSize = 0;
      let expiredCount = 0;

      snapshot.docs.forEach((doc) => {
        const data = doc.data();
        totalSize += data.size || 0;

        if (this.isExpired(data.expiresAt.toDate())) {
          expiredCount++;
        }
      });

      this.updateEntryCount(snapshot.size - expiredCount);
      this.updateSize(totalSize);

      return super.getStats();
    } catch (error) {
      logger.error('Error getting cache stats from Firestore', error as Error, {
        operation: 'cache.getStats',
      });
      return super.getStats();
    }
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
    }, this.config.cleanupInterval * 1000);

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
  }
}
