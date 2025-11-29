/**
 * Request Logging Middleware
 * Logs all HTTP requests with configurable detail level
 */

import { Request, Response, NextFunction } from 'express';
import { logger } from '../utilities/logger';
import { MIDDLEWARE_CONFIG } from '../config/middleware.config';

/**
 * Request logging middleware
 */
export function requestLoggingMiddleware() {
  return (req: Request, res: Response, next: NextFunction) => {
    const startTime = Date.now();
    const requestId = req.headers['x-request-id'] as string || 'unknown';

    // Log request
    const logData: Record<string, any> = {
      requestId,
      method: req.method,
      path: req.path,
      query: req.query,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    };

    if (MIDDLEWARE_CONFIG.logging.logHeaders) {
      logData.headers = filterSensitiveHeaders(req.headers);
    }

    if (MIDDLEWARE_CONFIG.logging.logBody && req.body) {
      logData.body = filterSensitiveData(req.body);
    }

    logger.info('Incoming request', logData);

    // Log response
    const originalSend = res.send;
    res.send = function (data: any) {
      const duration = Date.now() - startTime;

      logger.info('Outgoing response', {
        requestId,
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        duration: `${duration}ms`,
      });

      return originalSend.call(this, data);
    };

    next();
  };
}

/**
 * Filter sensitive headers
 */
function filterSensitiveHeaders(headers: Record<string, any>): Record<string, any> {
  const filtered: Record<string, any> = {};
  const sensitiveHeaders = MIDDLEWARE_CONFIG.logging.sensitiveHeaders;

  for (const [key, value] of Object.entries(headers)) {
    if (sensitiveHeaders.includes(key.toLowerCase())) {
      filtered[key] = '[REDACTED]';
    } else {
      filtered[key] = value;
    }
  }

  return filtered;
}

/**
 * Filter sensitive data from request body
 */
function filterSensitiveData(body: any): any {
  if (typeof body !== 'object' || body === null) {
    return body;
  }

  const filtered: any = Array.isArray(body) ? [] : {};
  const sensitiveFields = ['password', 'token', 'secret', 'apiKey', 'creditCard'];

  for (const [key, value] of Object.entries(body)) {
    if (sensitiveFields.some((field) => key.toLowerCase().includes(field.toLowerCase()))) {
      filtered[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      filtered[key] = filterSensitiveData(value);
    } else {
      filtered[key] = value;
    }
  }

  return filtered;
}
