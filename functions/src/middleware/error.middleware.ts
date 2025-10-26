/**
 * Error Handling Middleware
 * Global error handler and custom error classes
 */

import { Request, Response, NextFunction } from 'express';
import { logger } from '../utilities/logger';
import { APP_CONFIG } from '../config/app.config';

/**
 * Custom application errors
 */
export class AppError extends Error {
  constructor(
    public code: string,
    public message: string,
    public statusCode: number = 500,
    public details?: Record<string, any>
  ) {
    super(message);
    this.name = 'AppError';
    Error.captureStackTrace(this, this.constructor);
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id?: string) {
    super(
      'NOT_FOUND',
      `${resource} not found${id ? `: ${id}` : ''}`,
      404,
      { resource, id }
    );
    this.name = 'NotFoundError';
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: Record<string, any>) {
    super('VALIDATION_ERROR', message, 400, details);
    this.name = 'ValidationError';
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required') {
    super('UNAUTHORIZED', message, 401);
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Access denied') {
    super('FORBIDDEN', message, 403);
    this.name = 'ForbiddenError';
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details?: Record<string, any>) {
    super('CONFLICT', message, 409, details);
    this.name = 'ConflictError';
  }
}

/**
 * Global error handling middleware
 * Must be registered last in middleware chain
 */
export function errorHandler() {
  return (err: Error, req: Request, res: Response, _next: NextFunction) => {
    const requestId = (req.headers['x-request-id'] as string) || 'unknown';

    // Log error
    logger.error('Request error', err, {
      requestId,
      path: req.path,
      method: req.method,
    });

    // Handle known AppErrors
    if (err instanceof AppError) {
      return res.status(err.statusCode).json({
        success: false,
        error: {
          code: err.code,
          message: err.message,
          details: err.details,
        },
        metadata: {
          requestId,
          timestamp: new Date().toISOString(),
          version: '1.0.0',
        },
      });
    }

    // Handle validation errors from express-validator
    if (err.name === 'ValidationError') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: err.message,
        },
        metadata: {
          requestId,
          timestamp: new Date().toISOString(),
          version: '1.0.0',
        },
      });
    }

    // Handle Firestore errors
    if (err.message.includes('PERMISSION_DENIED')) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'PERMISSION_DENIED',
          message: 'Database permission denied',
        },
        metadata: {
          requestId,
          timestamp: new Date().toISOString(),
          version: '1.0.0',
        },
      });
    }

    // Default to 500 Internal Server Error
    const isDevelopment = APP_CONFIG.app.environment === 'development';

    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: isDevelopment ? err.message : 'An unexpected error occurred',
        details: isDevelopment ? { stack: err.stack } : undefined,
      },
      metadata: {
        requestId,
        timestamp: new Date().toISOString(),
        version: '1.0.0',
      },
    });
  };
}

/**
 * 404 Not Found handler
 * For unmatched routes
 */
export function notFoundHandler() {
  return (req: Request, res: Response) => {
    const requestId = (req.headers['x-request-id'] as string) || 'unknown';

    logger.warn('Route not found', {
      requestId,
      path: req.path,
      method: req.method,
    });

    res.status(404).json({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: `Route not found: ${req.method} ${req.path}`,
      },
      metadata: {
        requestId,
        timestamp: new Date().toISOString(),
        version: '1.0.0',
      },
    });
  };
}

/**
 * Async handler wrapper
 * Catches async errors and passes to error middleware
 */
export function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<any>) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
