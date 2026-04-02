/**
 * Configuration barrel export
 * Single entry point for all configuration
 */

export * from './app.config';
export * from './database.config';
export * from './auth.config';
export * from './middleware.config';
export * from './communications.config';
export * from './cache.config';
export * from './firestore.config';
export * from './maps.config';
export * from './firebase-event-mapping.config';

// tokens.config is NOT re-exported here because it eagerly instantiates
// singletons (tokenHandler, tokenBlacklist) at import time, which triggers
// Firestore calls. Import directly from './config/tokens.config' or from
// '@xbg.solutions/utils-token-handler' when needed.

import { validateAppConfig } from './app.config';
import { validateAuthConfig } from './auth.config';
import { validateCommunicationsConfig } from './communications.config';
import { validateCacheConfig } from './cache.config';
import { validateFirestoreConfig } from './firestore.config';
import { validateMapsConfig } from './maps.config';
import { validateEventMappings } from './firebase-event-mapping.config';

/**
 * Validate all configuration on startup
 */
export function validateAllConfig(): void {
  validateAppConfig();
  validateAuthConfig();
  validateCommunicationsConfig();
  validateCacheConfig();
  validateFirestoreConfig();
  validateMapsConfig();
  validateEventMappings();
}
