/**
 * Configuration barrel export
 * Single entry point for all configuration
 */

export * from './app.config';
export * from './database.config';
export * from './auth.config';
export * from './middleware.config';
export * from './communications.config';

import { validateAppConfig } from './app.config';
import { validateAuthConfig } from './auth.config';
import { validateCommunicationsConfig } from './communications.config';

/**
 * Validate all configuration on startup
 */
export function validateAllConfig(): void {
  validateAppConfig();
  validateAuthConfig();
  validateCommunicationsConfig();
}
