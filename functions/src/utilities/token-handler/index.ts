/**
 * Token Handler Utility - Barrel Export
 * Portable, configurable token handling with auth provider abstraction
 */

// Core types and interfaces
export * from './token-types';

// Generic implementations
export * from './generic-token-handler';
export * from './token-blacklist-manager';

// Adapters
export * from './firebase-adapter';
export * from './firestore-database-adapter';

// Factory functions for common configurations
export { createTokenHandler } from './generic-token-handler';
export { createTokenBlacklistManager } from './token-blacklist-manager';
export { createFirebaseAuthAdapter } from './firebase-adapter';
export { createFirestoreTokenDatabase } from './firestore-database-adapter';

// Project-specific factory functions
export {
  createProjectTokenHandler,
  getTokenHandler,
  getTokenBlacklist,
  tokenHandler,
  tokenBlacklist,
  BlacklistReason,
  type CustomClaims
} from '../../config/tokens.config';

/**
 * Quick-start factory for Firebase-based token handling
 * 
 * @example
 * ```typescript
 * const handler = createFirebaseTokenHandler({
 *   customClaims: {
 *     extract: (token) => ({ userID: token.userID }),
 *     defaults: { userID: null }
 *   },
 *   blacklist: {
 *     storage: { database: 'main', collection: 'blacklist' },
 *     retention: { cleanupRetentionDays: 30, globalRevocationRetentionDays: 30 },
 *     reasons: ['LOGOUT', 'PASSWORD_CHANGE']
 *   },
 *   database: firestoreInstance
 * });
 * ```
 */
export function createFirebaseTokenHandler<TCustomClaims = Record<string, any>>(config: {
  customClaims: {
    extract: (token: any) => TCustomClaims;
    validate?: (claims: TCustomClaims) => boolean;
    defaults: Partial<TCustomClaims>;
  };
  blacklist: {
    storage: { database: string; collection: string };
    retention: { cleanupRetentionDays: number; globalRevocationRetentionDays: number };
    reasons: string[];
  };
  database: any; // Firestore instance
}) {
  const { createTokenHandler } = require('./generic-token-handler');
  const { createFirebaseAuthAdapter } = require('./adapters/firebase-auth-adapter');
  const { createFirestoreTokenDatabase } = require('./adapters/firestore-database-adapter');

  // Create database adapter
  const tokenDatabase = createFirestoreTokenDatabase(
    config.database,
    config.blacklist.storage.collection
  );

  // Create auth adapter
  const authAdapter = createFirebaseAuthAdapter();

  // Build complete configuration
  const handlerConfig = {
    customClaims: config.customClaims,
    blacklist: config.blacklist,
    provider: { type: 'firebase' as const },
    database: tokenDatabase
  };

  return createTokenHandler(handlerConfig, authAdapter);
}

/**
 * Quick-start factory for Auth0-based token handling
 * Future implementation when Auth0 adapter is available
 */
export function createAuth0TokenHandler<_TCustomClaims = Record<string, any>>(_config: any) {
  throw new Error('Auth0 adapter not yet implemented. Use createFirebaseTokenHandler for now.');
}

/**
 * Quick-start factory for Clerk-based token handling
 * Future implementation when Clerk adapter is available
 */
export function createClerkTokenHandler<_TCustomClaims = Record<string, any>>(_config: any) {
  throw new Error('Clerk adapter not yet implemented. Use createFirebaseTokenHandler for now.');
}

/**
 * Version and metadata
 */
export const TOKEN_HANDLER_VERSION = '2.0.0';
export const SUPPORTED_PROVIDERS = ['firebase'] as const;

/**
 * Utility function to validate token handler configuration
 */
export function validateTokenHandlerConfig(
  config: any
): boolean {
  return (
    config &&
    typeof config === 'object' &&
    config.customClaims &&
    config.blacklist &&
    config.provider &&
    config.database
  );
}