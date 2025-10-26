/**
 * Base Controller Class
 * Handles HTTP requests and responses
 * All controllers should extend this class
 */

import { Request, Response, NextFunction, Router } from 'express';
import { BaseService, RequestContext } from './BaseService';
import { BaseEntity } from './BaseEntity';
import { logger } from '../utilities/logger';
import { QueryOptions } from './BaseRepository';

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: Record<string, any>;
  };
  metadata?: {
    requestId: string;
    timestamp: string;
    version: string;
  };
}

export interface PaginatedApiResponse<T = any> extends ApiResponse<T[]> {
  pagination?: {
    page: number;
    pageSize: number;
    total: number;
    hasMore: boolean;
  };
}

export abstract class BaseController<T extends BaseEntity> {
  protected service: BaseService<T>;
  protected router: Router;
  protected basePath: string;

  constructor(service: BaseService<T>, basePath: string) {
    this.service = service;
    this.basePath = basePath;
    this.router = Router();
    this.registerRoutes();
  }

  /**
   * Register routes (override in subclasses to add custom routes)
   */
  protected registerRoutes(): void {
    this.router.post('/', this.handleCreate.bind(this));
    this.router.get('/', this.handleFindAll.bind(this));
    this.router.get('/:id', this.handleFindById.bind(this));
    this.router.put('/:id', this.handleUpdate.bind(this));
    this.router.patch('/:id', this.handleUpdate.bind(this));
    this.router.delete('/:id', this.handleDelete.bind(this));
  }

  /**
   * Get router instance
   */
  getRouter(): Router {
    return this.router;
  }

  /**
   * Get base path
   */
  getBasePath(): string {
    return this.basePath;
  }

  /**
   * Create request context from Express request
   */
  protected createContext(req: Request): RequestContext {
    return {
      requestId: req.headers['x-request-id'] as string || 'unknown',
      userId: (req as any).user?.uid || (req as any).user?.id,
      userRole: (req as any).user?.role,
      timestamp: new Date(),
      metadata: {
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      },
    };
  }

  /**
   * Handle CREATE request
   */
  protected async handleCreate(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const context = this.createContext(req);

      logger.info('Create request received', {
        requestId: context.requestId,
        path: req.path,
      });

      const result = await this.service.create(req.body, context);

      if (result.success && result.data) {
        this.sendSuccess(res, result.data, 201, context.requestId);
      } else {
        this.sendError(res, result.error!, context.requestId);
      }
    } catch (error) {
      next(error);
    }
  }

  /**
   * Handle FIND BY ID request
   */
  protected async handleFindById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const context = this.createContext(req);
      const { id } = req.params;

      logger.debug('Find by ID request received', {
        requestId: context.requestId,
        id,
      });

      const result = await this.service.findById(id, context);

      if (result.success && result.data) {
        this.sendSuccess(res, result.data, 200, context.requestId);
      } else {
        this.sendError(res, result.error!, context.requestId);
      }
    } catch (error) {
      next(error);
    }
  }

  /**
   * Handle FIND ALL request
   */
  protected async handleFindAll(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const context = this.createContext(req);

      logger.debug('Find all request received', {
        requestId: context.requestId,
        query: req.query,
      });

      // Parse query options
      const options = this.parseQueryOptions(req);

      // Check if pagination is requested
      const page = parseInt(req.query.page as string);
      const pageSize = parseInt(req.query.pageSize as string) || 20;

      if (page && page > 0) {
        const result = await this.service.findPaginated(page, pageSize, options, context);

        if (result.success && result.data) {
          this.sendPaginatedSuccess(res, result.data, context.requestId);
        } else {
          this.sendError(res, result.error!, context.requestId);
        }
      } else {
        const result = await this.service.findAll(options, context);

        if (result.success && result.data) {
          this.sendSuccess(res, result.data, 200, context.requestId);
        } else {
          this.sendError(res, result.error!, context.requestId);
        }
      }
    } catch (error) {
      next(error);
    }
  }

  /**
   * Handle UPDATE request
   */
  protected async handleUpdate(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const context = this.createContext(req);
      const { id } = req.params;

      logger.info('Update request received', {
        requestId: context.requestId,
        id,
      });

      const result = await this.service.update(id, req.body, context);

      if (result.success && result.data) {
        this.sendSuccess(res, result.data, 200, context.requestId);
      } else {
        this.sendError(res, result.error!, context.requestId);
      }
    } catch (error) {
      next(error);
    }
  }

  /**
   * Handle DELETE request
   */
  protected async handleDelete(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const context = this.createContext(req);
      const { id } = req.params;
      const hardDelete = req.query.hard === 'true';

      logger.info('Delete request received', {
        requestId: context.requestId,
        id,
        hardDelete,
      });

      const result = await this.service.delete(id, context, hardDelete);

      if (result.success) {
        this.sendSuccess(res, { message: 'Deleted successfully' }, 200, context.requestId);
      } else {
        this.sendError(res, result.error!, context.requestId);
      }
    } catch (error) {
      next(error);
    }
  }

  /**
   * Parse query options from request
   */
  protected parseQueryOptions(req: Request): QueryOptions {
    const options: QueryOptions = {};

    // Parse limit
    if (req.query.limit) {
      options.limit = parseInt(req.query.limit as string);
    }

    // Parse offset
    if (req.query.offset) {
      options.offset = parseInt(req.query.offset as string);
    }

    // Parse orderBy
    if (req.query.orderBy) {
      const orderByStr = req.query.orderBy as string;
      options.orderBy = orderByStr.split(',').map((field) => {
        const [name, direction = 'asc'] = field.split(':');
        return { field: name, direction: direction as 'asc' | 'desc' };
      });
    }

    // Parse where clauses (basic implementation)
    // Expected format: ?where=field:operator:value
    if (req.query.where) {
      const whereStr = Array.isArray(req.query.where) ? req.query.where : [req.query.where];
      options.where = whereStr.map((clause: any) => {
        const [field, operator, value] = clause.split(':');
        return {
          field,
          operator: operator as FirebaseFirestore.WhereFilterOp,
          value: this.parseValue(value),
        };
      });
    }

    return options;
  }

  /**
   * Parse query value to appropriate type
   */
  protected parseValue(value: string): any {
    if (value === 'null') return null;
    if (value === 'true') return true;
    if (value === 'false') return false;
    if (!isNaN(Number(value))) return Number(value);
    return value;
  }

  /**
   * Send success response
   */
  protected sendSuccess<D>(res: Response, data: D, status = 200, requestId?: string): void {
    const response: ApiResponse<D> = {
      success: true,
      data,
      metadata: {
        requestId: requestId || 'unknown',
        timestamp: new Date().toISOString(),
        version: '1.0.0',
      },
    };

    res.status(status).json(response);
  }

  /**
   * Send paginated success response
   */
  protected sendPaginatedSuccess<D>(
    res: Response,
    result: { data: D[]; total: number; page: number; pageSize: number; hasMore: boolean },
    requestId?: string
  ): void {
    const response: PaginatedApiResponse<D> = {
      success: true,
      data: result.data,
      pagination: {
        page: result.page,
        pageSize: result.pageSize,
        total: result.total,
        hasMore: result.hasMore,
      },
      metadata: {
        requestId: requestId || 'unknown',
        timestamp: new Date().toISOString(),
        version: '1.0.0',
      },
    };

    res.status(200).json(response);
  }

  /**
   * Send error response
   */
  protected sendError(
    res: Response,
    error: { code: string; message: string; details?: Record<string, any> },
    requestId?: string
  ): void {
    const statusCode = this.getStatusCodeFromError(error.code);

    const response: ApiResponse = {
      success: false,
      error,
      metadata: {
        requestId: requestId || 'unknown',
        timestamp: new Date().toISOString(),
        version: '1.0.0',
      },
    };

    res.status(statusCode).json(response);
  }

  /**
   * Map error codes to HTTP status codes
   */
  protected getStatusCodeFromError(code: string): number {
    const statusMap: Record<string, number> = {
      NOT_FOUND: 404,
      FORBIDDEN: 403,
      UNAUTHORIZED: 401,
      VALIDATION_ERROR: 400,
      CONFLICT: 409,
      INTERNAL_ERROR: 500,
      UNKNOWN_ERROR: 500,
    };

    return statusMap[code] || 500;
  }
}
