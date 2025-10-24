/**
 * Validation Middleware
 * Input validation and sanitization
 */

import { Request, Response, NextFunction } from 'express';
import { validationResult, ValidationChain } from 'express-validator';
import { logger } from '../utilities/logger';

/**
 * Validation middleware factory
 * Runs express-validator chains and returns errors
 */
export function validate(validations: ValidationChain[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    // Run all validations
    await Promise.all(validations.map((validation) => validation.run(req)));

    // Check for errors
    const errors = validationResult(req);

    if (!errors.isEmpty()) {
      logger.warn('Validation failed', {
        path: req.path,
        errors: errors.array(),
      });

      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Input validation failed',
          details: errors.array().map((error) => ({
            field: error.type === 'field' ? error.path : undefined,
            message: error.msg,
          })),
        },
      });
    }

    next();
  };
}

/**
 * Sanitize request body
 * Remove potentially dangerous characters
 */
export function sanitizeBody() {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (req.body && typeof req.body === 'object') {
      req.body = sanitizeObject(req.body);
    }
    next();
  };
}

/**
 * Recursively sanitize object
 */
function sanitizeObject(obj: any): any {
  if (Array.isArray(obj)) {
    return obj.map(sanitizeObject);
  }

  if (obj !== null && typeof obj === 'object') {
    const sanitized: any = {};
    for (const [key, value] of Object.entries(obj)) {
      sanitized[key] = sanitizeObject(value);
    }
    return sanitized;
  }

  if (typeof obj === 'string') {
    return sanitizeString(obj);
  }

  return obj;
}

/**
 * Sanitize string value
 */
function sanitizeString(str: string): string {
  // Remove null bytes
  str = str.replace(/\0/g, '');

  // Basic XSS prevention (use a proper library like DOMPurify for production)
  str = str.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');

  return str.trim();
}

/**
 * Validate pagination parameters
 */
export function validatePagination() {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.query.page) {
      const page = parseInt(req.query.page as string);
      if (isNaN(page) || page < 1) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_PARAMETER',
            message: 'Page must be a positive integer',
          },
        });
      }
    }

    if (req.query.pageSize) {
      const pageSize = parseInt(req.query.pageSize as string);
      if (isNaN(pageSize) || pageSize < 1 || pageSize > 100) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_PARAMETER',
            message: 'Page size must be between 1 and 100',
          },
        });
      }
    }

    next();
  };
}

/**
 * Validate UUID parameter
 */
export function validateUUID(paramName = 'id') {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  return (req: Request, res: Response, next: NextFunction) => {
    const id = req.params[paramName];

    if (!id || !uuidRegex.test(id)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_PARAMETER',
          message: `Invalid ${paramName} format`,
        },
      });
    }

    next();
  };
}
