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
// A client-supplied request ID is only trusted if it is short and consists of
// safe characters. This prevents log-forging / response-header poisoning via a
// crafted X-Request-ID (control chars, newlines, oversized values).
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;

export function requestIdMiddleware() {
  return (req: Request, res: Response, next: NextFunction) => {
    const headerName = MIDDLEWARE_CONFIG.requestId.headerName;

    // Use the incoming request ID only if it is well-formed; otherwise generate one.
    const incoming = req.headers[headerName.toLowerCase()] as string | undefined;
    const requestId = incoming && SAFE_REQUEST_ID.test(incoming) ? incoming : uuidv4();

    // Set request ID on request object
    req.headers[headerName.toLowerCase()] = requestId;

    // Set request ID in response header
    res.setHeader(headerName, requestId);

    next();
  };
}
