/**
 * Configuration barrel export
 * Single entry point for all configuration
 */

export * from './app.config';
export * from './database.config';
export * from './auth.config';
export * from './middleware.config';

import { validateAppConfig } from './app.config';
import { validateAuthConfig } from './auth.config';

/**
 * Validate all configuration on startup
 */
export function validateAllConfig(): void {
  validateAppConfig();
  validateAuthConfig();
}
