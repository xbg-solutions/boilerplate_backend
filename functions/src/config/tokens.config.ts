/**
 * Token Configuration
 * Generic token handler configuration for boilerplate backend
 *
 * NOTE: This is a generic configuration. When using this boilerplate for your
 * specific project, customize the custom claims interface and blacklist reasons
 * to match your application's requirements.
 */

import { createTokenHandler } from '../utilities/token-handler/generic-token-handler';
import { createTokenBlacklistManager } from '../utilities/token-handler/token-blacklist-manager';
import { createFirebaseAuthAdapter } from '../utilities/token-handler/firebase-adapter';
import { createFirestoreTokenDatabase } from '../utilities/token-handler/firestore-database-adapter';
import { getFirestore } from '../utilities/firebase';
import type { ITokenHandler } from '../utilities/token-handler/token-types';
import type { TokenBlacklistManager } from '../utilities/token-handler/token-blacklist-manager';

/**
 * Generic custom claims interface
 * Customize this for your specific application needs
 */
export interface CustomClaims {
  userUID: string | null;
  role?: string;
  emailVerified?: boolean;
  [key: string]: any; // Allow additional custom claims
}

/**
 * Generic blacklist reasons
 * Customize these for your application's specific use cases
 */
export enum BlacklistReason {
  LOGOUT = 'LOGOUT',
  PASSWORD_CHANGE = 'PASSWORD_CHANGE',
  SECURITY_BREACH = 'SECURITY_BREACH',
  ACCOUNT_DELETION = 'ACCOUNT_DELETION',
  ADMIN_REVOCATION = 'ADMIN_REVOCATION',
}

/**
 * Token handler singleton instance
 */
let tokenHandlerInstance: ITokenHandler<CustomClaims> | null = null;
let tokenBlacklistInstance: TokenBlacklistManager | null = null;

/**
 * Create configured token handler
 */
export function createProjectTokenHandler(): ITokenHandler<CustomClaims> {
  // Get Firestore instance
  const db = getFirestore();

  // Create database adapter
  const tokenDatabase = createFirestoreTokenDatabase(
    db,
    process.env.TOKEN_BLACKLIST_COLLECTION || 'tokenBlacklist'
  );

  // Create auth adapter with CustomClaims type
  const authAdapter = createFirebaseAuthAdapter<CustomClaims>();

  // Build configuration
  const config = {
    customClaims: {
      extract: (token: any): CustomClaims => ({
        userUID: token.userUID || null,
        role: token.role || 'user',
        emailVerified: token.email_verified || false,
      }),
      validate: (claims: CustomClaims): boolean => {
        // Add your custom validation logic here
        if (claims.userUID !== null && typeof claims.userUID !== 'string') {
          return false;
        }
        return true;
      },
      defaults: {
        userUID: null,
        role: 'user',
        emailVerified: false,
      },
    },
    blacklist: {
      storage: {
        database: 'main',
        collection: process.env.TOKEN_BLACKLIST_COLLECTION || 'tokenBlacklist',
      },
      retention: {
        cleanupRetentionDays: parseInt(process.env.TOKEN_BLACKLIST_RETENTION_DAYS || '30', 10),
        globalRevocationRetentionDays: parseInt(
          process.env.TOKEN_GLOBAL_REVOCATION_RETENTION_DAYS || '30',
          10
        ),
      },
      reasons: Object.values(BlacklistReason),
    },
    provider: {
      type: 'firebase' as const,
      firebase: {
        projectId: process.env.FIREBASE_PROJECT_ID,
      },
    },
    database: tokenDatabase,
  };

  return createTokenHandler(config, authAdapter);
}

/**
 * Get or create token handler singleton
 */
export function getTokenHandler(): ITokenHandler<CustomClaims> {
  if (!tokenHandlerInstance) {
    tokenHandlerInstance = createProjectTokenHandler();
  }
  return tokenHandlerInstance;
}

/**
 * Get or create token blacklist manager singleton
 */
export function getTokenBlacklist(): TokenBlacklistManager {
  if (!tokenBlacklistInstance) {
    const db = getFirestore();
    const tokenDatabase = createFirestoreTokenDatabase(
      db,
      process.env.TOKEN_BLACKLIST_COLLECTION || 'tokenBlacklist'
    );

    tokenBlacklistInstance = createTokenBlacklistManager(tokenDatabase, {
      storage: {
        database: 'main',
        collection: process.env.TOKEN_BLACKLIST_COLLECTION || 'tokenBlacklist',
      },
      retention: {
        cleanupRetentionDays: parseInt(process.env.TOKEN_BLACKLIST_RETENTION_DAYS || '30', 10),
        globalRevocationRetentionDays: parseInt(
          process.env.TOKEN_GLOBAL_REVOCATION_RETENTION_DAYS || '30',
          10
        ),
      },
      reasons: Object.values(BlacklistReason),
    });
  }
  return tokenBlacklistInstance;
}

/**
 * Export singleton instances for convenience
 */
export const tokenHandler = getTokenHandler();
export const tokenBlacklist = getTokenBlacklist();

/**
 * Reset singletons (useful for testing)
 */
export function resetTokenHandlerSingletons(): void {
  tokenHandlerInstance = null;
  tokenBlacklistInstance = null;
}
