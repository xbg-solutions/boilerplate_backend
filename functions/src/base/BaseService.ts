/**
 * Base Service Class
 * Handles business logic orchestration and event publishing
 * All services should extend this class
 */

import { BaseEntity } from './BaseEntity';
import { BaseRepository, QueryOptions, PaginationResult } from './BaseRepository';
import { eventBus, EventType } from '../utilities/events';
import { logger } from '../utilities/logger';
import { ServiceError as CustomServiceError } from '../types/errors';

export interface RequestContext {
  requestId: string;
  userId?: string;
  userRole?: string;
  timestamp: Date;
  metadata?: Record<string, any>;
}

export interface ServiceResult<T> {
  success: boolean;
  data?: T;
  error?: ServiceError;
}

export interface ServiceError {
  code: string;
  message: string;
  details?: Record<string, any>;
}

export abstract class BaseService<T extends BaseEntity> {
  protected abstract entityName: string;
  protected repository: BaseRepository<T>;

  constructor(repository: BaseRepository<T>) {
    this.repository = repository;
  }

  /**
   * Create a new entity
   */
  async create(data: Partial<T>, context: RequestContext): Promise<ServiceResult<T>> {
    try {
      logger.info(`Creating ${this.entityName}`, {
        requestId: context.requestId,
        userId: context.userId,
      });

      // Pre-create hook
      await this.beforeCreate(data, context);

      // Create entity
      const entity = await this.buildEntity(data);
      const created = await this.repository.create(entity);

      // Post-create hook
      await this.afterCreate(created, context);

      // Publish event
      this.publishEvent('CREATED', created, context);

      return {
        success: true,
        data: created,
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      const serviceError = new CustomServiceError(
        `Failed to create ${this.entityName}: ${err.message}`,
        context.requestId
      );
      logger.error(serviceError.message, err, {
        requestId: context.requestId,
      });

      return {
        success: false,
        error: this.handleError(error),
      };
    }
  }

  /**
   * Find entity by ID
   */
  async findById(id: string, context: RequestContext): Promise<ServiceResult<T>> {
    try {
      logger.debug(`Finding ${this.entityName} by ID`, {
        requestId: context.requestId,
        id,
      });

      const entity = await this.repository.findById(id);

      if (!entity) {
        return {
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: `${this.entityName} not found`,
            details: { id },
          },
        };
      }

      // Check access permissions
      const hasAccess = await this.checkReadAccess(entity, context);
      if (!hasAccess) {
        return {
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: `Access denied to ${this.entityName}`,
          },
        };
      }

      return {
        success: true,
        data: entity,
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      const serviceError = new CustomServiceError(
        `Failed to find ${this.entityName}: ${err.message}`,
        context.requestId
      );
      logger.error(serviceError.message, err, {
        requestId: context.requestId,
        id,
      });

      return {
        success: false,
        error: this.handleError(error),
      };
    }
  }

  /**
   * Find all entities with filtering
   */
  async findAll(options: QueryOptions, context: RequestContext): Promise<ServiceResult<T[]>> {
    try {
      logger.debug(`Finding all ${this.entityName}`, {
        requestId: context.requestId,
        options,
      });

      // Apply user-specific filters
      const userOptions = await this.applyUserFilters(options, context);

      const entities = await this.repository.findAll(userOptions);

      return {
        success: true,
        data: entities,
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      const serviceError = new CustomServiceError(
        `Failed to find ${this.entityName} entities: ${err.message}`,
        context.requestId
      );
      logger.error(serviceError.message, err, {
        requestId: context.requestId,
      });

      return {
        success: false,
        error: this.handleError(error),
      };
    }
  }

  /**
   * Find entities with pagination
   */
  async findPaginated(
    page: number,
    pageSize: number,
    options: Omit<QueryOptions, 'limit' | 'offset'>,
    context: RequestContext
  ): Promise<ServiceResult<PaginationResult<T>>> {
    try {
      logger.debug(`Finding paginated ${this.entityName}`, {
        requestId: context.requestId,
        page,
        pageSize,
      });

      const userOptions = await this.applyUserFilters(options, context);
      const result = await this.repository.findPaginated(page, pageSize, userOptions);

      return {
        success: true,
        data: result,
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      const serviceError = new CustomServiceError(
        `Failed to find paginated ${this.entityName}: ${err.message}`,
        context.requestId
      );
      logger.error(serviceError.message, err, {
        requestId: context.requestId,
      });

      return {
        success: false,
        error: this.handleError(error),
      };
    }
  }

  /**
   * Update an entity
   */
  async update(id: string, data: Partial<T>, context: RequestContext): Promise<ServiceResult<T>> {
    try {
      logger.info(`Updating ${this.entityName}`, {
        requestId: context.requestId,
        id,
      });

      // Find existing entity
      const existing = await this.repository.findById(id);
      if (!existing) {
        return {
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: `${this.entityName} not found`,
            details: { id },
          },
        };
      }

      // Check update permissions
      const canUpdate = await this.checkUpdateAccess(existing, context);
      if (!canUpdate) {
        return {
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: `Access denied to update ${this.entityName}`,
          },
        };
      }

      // Pre-update hook
      await this.beforeUpdate(existing, data, context);

      // Merge changes
      const updated = await this.mergeEntity(existing, data);
      const result = await this.repository.update(updated);

      // Post-update hook
      await this.afterUpdate(result, context);

      // Publish event
      this.publishEvent('UPDATED', result, context);

      return {
        success: true,
        data: result,
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      const serviceError = new CustomServiceError(
        `Failed to update ${this.entityName}: ${err.message}`,
        context.requestId
      );
      logger.error(serviceError.message, err, {
        requestId: context.requestId,
        id,
      });

      return {
        success: false,
        error: this.handleError(error),
      };
    }
  }

  /**
   * Delete an entity
   */
  async delete(id: string, context: RequestContext, hardDelete = false): Promise<ServiceResult<void>> {
    try {
      logger.info(`Deleting ${this.entityName}`, {
        requestId: context.requestId,
        id,
        hardDelete,
      });

      const existing = await this.repository.findById(id, true);
      if (!existing) {
        return {
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: `${this.entityName} not found`,
            details: { id },
          },
        };
      }

      // Check delete permissions
      const canDelete = await this.checkDeleteAccess(existing, context);
      if (!canDelete) {
        return {
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: `Access denied to delete ${this.entityName}`,
          },
        };
      }

      // Pre-delete hook
      await this.beforeDelete(existing, context);

      // Delete entity
      await this.repository.delete(id, hardDelete);

      // Post-delete hook
      await this.afterDelete(existing, context);

      // Publish event
      this.publishEvent('DELETED', existing, context);

      return {
        success: true,
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      const serviceError = new CustomServiceError(
        `Failed to delete ${this.entityName}: ${err.message}`,
        context.requestId
      );
      logger.error(serviceError.message, err, {
        requestId: context.requestId,
        id,
      });

      return {
        success: false,
        error: this.handleError(error),
      };
    }
  }

  /**
   * Lifecycle hooks (override in subclasses)
   */
  protected async beforeCreate(_data: Partial<T>, _context: RequestContext): Promise<void> {}
  protected async afterCreate(_entity: T, _context: RequestContext): Promise<void> {}
  protected async beforeUpdate(_existing: T, _data: Partial<T>, _context: RequestContext): Promise<void> {}
  protected async afterUpdate(_entity: T, _context: RequestContext): Promise<void> {}
  protected async beforeDelete(_entity: T, _context: RequestContext): Promise<void> {}
  protected async afterDelete(_entity: T, _context: RequestContext): Promise<void> {}

  /**
   * Access control methods (override in subclasses)
   */
  protected async checkReadAccess(_entity: T, _context: RequestContext): Promise<boolean> {
    return true;
  }

  protected async checkUpdateAccess(_entity: T, _context: RequestContext): Promise<boolean> {
    return true;
  }

  protected async checkDeleteAccess(_entity: T, _context: RequestContext): Promise<boolean> {
    return true;
  }

  /**
   * Apply user-specific filters (override in subclasses)
   */
  protected async applyUserFilters(
    options: QueryOptions,
    _context: RequestContext
  ): Promise<QueryOptions> {
    return options;
  }

  /**
   * Build entity from partial data (must be implemented by subclasses)
   */
  protected abstract buildEntity(data: Partial<T>): Promise<T>;

  /**
   * Merge existing entity with updates (must be implemented by subclasses)
   */
  protected abstract mergeEntity(existing: T, updates: Partial<T>): Promise<T>;

  /**
   * Publish domain event
   */
  protected publishEvent(action: string, entity: T, context: RequestContext): void {
    const eventType = `${this.entityName.toUpperCase()}_${action}` as EventType;

    try {
      eventBus.publish(eventType, {
        entityId: entity.getId(),
        entityType: this.entityName,
        action,
        timestamp: context.timestamp,
        userId: context.userId,
        requestId: context.requestId,
        data: entity.toFirestore(),
      });
    } catch (error) {
      logger.warn('Failed to publish event', {
        eventType,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Handle errors and convert to ServiceError
   */
  protected handleError(error: unknown): ServiceError {
    if (error instanceof Error) {
      return {
        code: 'INTERNAL_ERROR',
        message: error.message,
        details: { stack: error.stack },
      };
    }

    return {
      code: 'UNKNOWN_ERROR',
      message: String(error),
    };
  }
}
