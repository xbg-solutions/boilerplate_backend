/**
 * Request ID Middleware
 * Adds unique request ID to each request for tracing
 */

import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { MIDDLEWARE_CONFIG } from '../config/middleware.config';

/**
 * Request ID middleware
 * Generates or uses existing request ID for correlation tracking
 */
export function requestIdMiddleware() {
  return (req: Request, res: Response, next: NextFunction) => {
    const headerName = MIDDLEWARE_CONFIG.requestId.headerName;

    // Get existing request ID or generate new one
    const requestId = (req.headers[headerName.toLowerCase()] as string) || uuidv4();

    // Set request ID on request object
    req.headers[headerName.toLowerCase()] = requestId;

    // Set request ID in response header
    res.setHeader(headerName, requestId);

    next();
  };
}
