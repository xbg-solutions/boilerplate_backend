/**
 * CORS Middleware Configuration
 */

import cors from 'cors';
import { APP_CONFIG } from '../config/app.config';
import { MIDDLEWARE_CONFIG } from '../config/middleware.config';

/**
 * Create CORS middleware with configuration
 */
export function createCorsMiddleware() {
  return cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, Postman, etc.)
      if (!origin) {
        return callback(null, true);
      }

      // Check if origin is allowed
      if (APP_CONFIG.api.corsOrigins.includes(origin)) {
        return callback(null, true);
      }

      // In development, allow all localhost origins
      if (APP_CONFIG.app.environment === 'development' && origin.includes('localhost')) {
        return callback(null, true);
      }

      callback(new Error('Not allowed by CORS'));
    },
    credentials: MIDDLEWARE_CONFIG.cors.credentials,
    maxAge: MIDDLEWARE_CONFIG.cors.maxAge,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Request-ID',
      'X-API-Key',
    ],
    exposedHeaders: [
      'X-Request-ID',
      'X-Total-Count',
      'X-Page',
      'X-Page-Size',
    ],
  });
}
