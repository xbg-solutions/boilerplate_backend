/**
 * Base Repository Class
 * Provides common CRUD operations with Firestore
 * All repositories should extend this class
 */

import { Firestore, CollectionReference, DocumentData, Query, Timestamp } from 'firebase-admin/firestore';
import { BaseEntity } from './BaseEntity';
import { logger } from '../utilities/logger';
import { RepositoryError } from '../types/errors';
import { getCacheConnector } from '../utilities/cache-connector';
import { RepositoryCacheConfig, CacheOptions, CacheProviderType } from '../utilities/cache-connector/types';
import { CACHE_CONFIG } from '../config/cache.config';

export interface QueryOptions {
  limit?: number;
  offset?: number;
  orderBy?: { field: string; direction: 'asc' | 'desc' }[];
  where?: WhereClause[];
  includeSoftDeleted?: boolean;
}

export interface WhereClause {
  field: string;
  operator: FirebaseFirestore.WhereFilterOp;
  value: any;
}

export interface PaginationResult<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export abstract class BaseRepository<T extends BaseEntity> {
  protected abstract collectionName: string;
  protected db: Firestore;

  /**
   * Cache configuration for this repository
   * Override in subclasses to enable caching
   */
  protected cacheConfig: RepositoryCacheConfig = {
    enabled: false, // Opt-in per repository
  };

  constructor(db: Firestore) {
    this.db = db;
  }

  /**
   * Get collection reference
   */
  protected getCollection(): CollectionReference<DocumentData> {
    return this.db.collection(this.collectionName);
  }

  /**
   * Check if caching is enabled for this repository
   * Respects both global and repository-level settings
   */
  protected isCacheEnabled(): boolean {
    // Global cache must be enabled
    if (!CACHE_CONFIG.enabled) {
      return false;
    }

    // Repository must opt-in
    return this.cacheConfig.enabled === true;
  }

  /**
   * Get effective cache provider for this repository
   */
  protected getCacheProvider(): CacheProviderType {
    return this.cacheConfig.provider || CACHE_CONFIG.defaultProvider;
  }

  /**
   * Get effective TTL for this repository
   */
  protected getCacheTTL(override?: number): number {
    return override || this.cacheConfig.ttl || CACHE_CONFIG.defaultTTL;
  }

  /**
   * Build cache key with repository prefix
   */
  protected buildCacheKey(type: string, identifier: string): string {
    const prefix = this.cacheConfig.keyPrefix || this.collectionName;
    return `${CACHE_CONFIG.namespace}:${prefix}:${type}:${identifier}`;
  }

  /**
   * Build cache tags for invalidation
   */
  protected buildCacheTags(entity: T, additionalTags?: string[]): string[] {
    const tags = [
      this.collectionName,
      `${this.collectionName}:${entity.id}`,
      ...(this.cacheConfig.tags || []),
      ...(additionalTags || []),
    ];
    return tags;
  }

  /**
   * Invalidate cache for a specific entity
   * Called automatically on update/delete
   */
  protected async invalidateEntityCache(id: string): Promise<void> {
    if (!this.isCacheEnabled()) {
      return;
    }

    const cache = getCacheConnector();
    const provider = this.getCacheProvider();

    try {
      // Invalidate by tags
      await cache.invalidateByTags(
        [this.collectionName, `${this.collectionName}:${id}`],
        { provider }
      );

      logger.debug('Cache invalidated for entity', {
        operation: 'cache.invalidate',
        collection: this.collectionName,
        id,
      });
    } catch (error) {
      // Log error but don't fail the operation
      logger.warn('Failed to invalidate cache', error as Error, {
        operation: 'cache.invalidate',
        collection: this.collectionName,
        id,
      });
    }
  }

  /**
   * Log cache hit
   */
  protected logCacheHit(key: string): void {
    logger.debug('Cache hit', {
      operation: 'cache.hit',
      collection: this.collectionName,
      key,
    });
  }

  /**
   * Log cache miss
   */
  protected logCacheMiss(key: string): void {
    logger.debug('Cache miss', {
      operation: 'cache.miss',
      collection: this.collectionName,
      key,
    });
  }

  /**
   * Create a new entity
   */
  async create(entity: T): Promise<T> {
    try {
      const validation = entity.validate();
      if (!validation.valid) {
        throw new Error(`Validation failed: ${JSON.stringify(validation.errors)}`);
      }

      const entityId = entity.getId();
      const docRef = entityId ?
        this.getCollection().doc(entityId) :
        this.getCollection().doc();

      entity.id = docRef.id;

      await docRef.set(entity.toFirestore());

      logger.info('Entity created', {
        collection: this.collectionName,
        id: entity.getId(),
      });

      return entity;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error('Failed to create entity', err, {
        collection: this.collectionName,
      });
      const repoError = new RepositoryError(
        `Failed to create entity: ${err.message}`,
        this.collectionName
      );
      throw repoError;
    }
  }

  /**
   * Find entity by ID
   */
  async findById(id: string, includeSoftDeleted = false): Promise<T | null> {
    try {
      const doc = await this.getCollection().doc(id).get();

      if (!doc.exists) {
        return null;
      }

      const data = doc.data();
      if (!data) {
        return null;
      }

      // Check if soft deleted
      if (!includeSoftDeleted && data.deletedAt) {
        return null;
      }

      return this.fromFirestore(doc.id, data);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error('Failed to find entity by ID', err, {
        collection: this.collectionName,
        id,
      });
      const repoError = new RepositoryError(
        `Failed to find entity by ID: ${err.message}`,
        this.collectionName
      );
      throw repoError;
    }
  }

  /**
   * Find entity by ID with caching
   * Only uses cache if enabled at both global and repository levels
   */
  async findByIdCached(id: string, options: CacheOptions = {}): Promise<T | null> {
    // If caching disabled, fallback to regular method
    if (!this.isCacheEnabled()) {
      return this.findById(id);
    }

    const cache = getCacheConnector();
    const cacheKey = this.buildCacheKey('id', id);
    const provider = this.getCacheProvider();

    try {
      // Try cache first (unless force refresh)
      if (!options.forceRefresh) {
        const cached = await cache.get<T>(cacheKey, { provider });

        if (cached) {
          this.logCacheHit(cacheKey);
          return cached;
        }
      }

      // Cache miss - fetch from database
      this.logCacheMiss(cacheKey);
      const entity = await this.findById(id);

      // Store in cache
      if (entity) {
        await cache.set(cacheKey, entity, {
          ttl: this.getCacheTTL(options.ttl),
          tags: this.buildCacheTags(entity, options.tags),
          provider,
        });
      }

      return entity;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error('Failed to find entity by ID (cached)', err, {
        collection: this.collectionName,
        id,
      });
      const repoError = new RepositoryError(
        `Failed to find entity by ID: ${err.message}`,
        this.collectionName
      );
      throw repoError;
    }
  }

  /**
   * Find all entities with optional filtering
   */
  async findAll(options: QueryOptions = {}): Promise<T[]> {
    try {
      let query: Query = this.getCollection();

      // Apply soft delete filter
      if (!options.includeSoftDeleted) {
        query = query.where('deletedAt', '==', null);
      }

      // Apply where clauses
      if (options.where) {
        for (const clause of options.where) {
          query = query.where(clause.field, clause.operator, clause.value);
        }
      }

      // Apply ordering
      if (options.orderBy) {
        for (const order of options.orderBy) {
          query = query.orderBy(order.field, order.direction);
        }
      }

      // Apply pagination
      if (options.offset) {
        query = query.offset(options.offset);
      }

      if (options.limit) {
        query = query.limit(options.limit);
      }

      const snapshot = await query.get();
      return snapshot.docs.map((doc) => this.fromFirestore(doc.id, doc.data()));
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error('Failed to find entities', err, {
        collection: this.collectionName,
      });
      const repoError = new RepositoryError(
        `Failed to find entities: ${err.message}`,
        this.collectionName
      );
      throw repoError;
    }
  }

  /**
   * Find with pagination
   */
  async findPaginated(
    page: number,
    pageSize: number,
    options: Omit<QueryOptions, 'limit' | 'offset'> = {}
  ): Promise<PaginationResult<T>> {
    const offset = (page - 1) * pageSize;

    const [data, total] = await Promise.all([
      this.findAll({ ...options, limit: pageSize + 1, offset }),
      this.count(options),
    ]);

    const hasMore = data.length > pageSize;
    if (hasMore) {
      data.pop(); // Remove extra item used for hasMore check
    }

    return {
      data,
      total,
      page,
      pageSize,
      hasMore,
    };
  }

  /**
   * Update an entity
   */
  async update(entity: T): Promise<T> {
    try {
      const validation = entity.validate();
      if (!validation.valid) {
        throw new Error(`Validation failed: ${JSON.stringify(validation.errors)}`);
      }

      if (!entity.getId()) {
        throw new Error('Cannot update entity without ID');
      }

      entity.incrementVersion();

      await this.getCollection().doc(entity.getId()!).update(entity.toFirestore());

      // Invalidate cache after update
      await this.invalidateEntityCache(entity.getId()!);

      logger.info('Entity updated', {
        collection: this.collectionName,
        id: entity.getId(),
      });

      return entity;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error('Failed to update entity', err, {
        collection: this.collectionName,
        id: entity.getId(),
      });
      const repoError = new RepositoryError(
        `Failed to update entity: ${err.message}`,
        this.collectionName
      );
      throw repoError;
    }
  }

  /**
   * Delete an entity (soft delete by default)
   */
  async delete(id: string, hardDelete = false): Promise<void> {
    try {
      if (hardDelete) {
        await this.getCollection().doc(id).delete();
        logger.info('Entity hard deleted', {
          collection: this.collectionName,
          id,
        });
      } else {
        await this.getCollection().doc(id).update({
          deletedAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
        });
        logger.info('Entity soft deleted', {
          collection: this.collectionName,
          id,
        });
      }

      // Invalidate cache after delete
      await this.invalidateEntityCache(id);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error('Failed to delete entity', err, {
        collection: this.collectionName,
        id,
      });
      const repoError = new RepositoryError(
        `Failed to delete entity: ${err.message}`,
        this.collectionName
      );
      throw repoError;
    }
  }

  /**
   * Count entities
   */
  async count(options: Omit<QueryOptions, 'limit' | 'offset'> = {}): Promise<number> {
    try {
      let query: Query = this.getCollection();

      if (!options.includeSoftDeleted) {
        query = query.where('deletedAt', '==', null);
      }

      if (options.where) {
        for (const clause of options.where) {
          query = query.where(clause.field, clause.operator, clause.value);
        }
      }

      const snapshot = await query.count().get();
      return snapshot.data().count;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error('Failed to count entities', err, {
        collection: this.collectionName,
      });
      const repoError = new RepositoryError(
        `Failed to count entities: ${err.message}`,
        this.collectionName
      );
      throw repoError;
    }
  }

  /**
   * Check if entity exists
   */
  async exists(id: string): Promise<boolean> {
    const doc = await this.getCollection().doc(id).get();
    return doc.exists;
  }

  /**
   * Batch create entities
   */
  async batchCreate(entities: T[]): Promise<T[]> {
    const batch = this.db.batch();

    for (const entity of entities) {
      const validation = entity.validate();
      if (!validation.valid) {
        throw new Error(`Validation failed for entity: ${JSON.stringify(validation.errors)}`);
      }

      const entityId = entity.getId();
      const docRef = entityId ?
        this.getCollection().doc(entityId) :
        this.getCollection().doc();

      entity.id = docRef.id;
      batch.set(docRef, entity.toFirestore());
    }

    await batch.commit();

    logger.info('Batch entities created', {
      collection: this.collectionName,
      count: entities.length,
    });

    return entities;
  }

  /**
   * Convert Firestore document to entity (must be implemented by subclasses)
   */
  protected abstract fromFirestore(id: string, data: DocumentData): T;
}
