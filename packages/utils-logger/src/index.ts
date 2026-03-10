/**
 * Logger utility barrel export
 */
export * from './logger';
export * from './logger-types';

import { Logger } from './logger';

/**
 * Default logger instance for use outside request context
 * For request-scoped logging, use the logger from req.logger
 */
export const logger = new Logger('system', { service: 'wishlist-api' });