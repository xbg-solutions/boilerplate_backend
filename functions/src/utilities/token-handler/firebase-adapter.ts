/**
 * Firebase Auth Adapter
 * Implements ITokenAdapter for Firebase Authentication
 */

import * as admin from 'firebase-admin';
import * as crypto from 'crypto';
import { Logger } from '../logger';
import {
  ITokenAdapter,
  NormalizedToken,
  CustomClaimsConfig,
  TokenVerificationError
} from './token-types';

export class FirebaseAuthAdapter<TCustomClaims = Record<string, any>> 
  implements ITokenAdapter<TCustomClaims> {

  /**
   * Verify token with Firebase Auth
   */
  async verifyToken(rawToken: string, logger: Logger): Promise<admin.auth.DecodedIdToken> {
    logger.debug('FirebaseAuthAdapter: Verifying token with Firebase');

    try {
      const decodedToken = await admin.auth().verifyIdToken(rawToken);
      
      logger.debug('FirebaseAuthAdapter: Token verified successfully', {
        authUID: decodedToken.uid
      });

      return decodedToken;
    } catch (error: any) {
      logger.warn('FirebaseAuthAdapter: Token verification failed', {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Generate token identifier for blacklist
   * Firebase doesn't provide jti claim, so we hash the token
   */
  async getTokenIdentifier(rawToken: string): Promise<string> {
    return crypto
      .createHash('sha256')
      .update(rawToken)
      .digest('hex');
  }

  /**
   * Normalize Firebase token to platform-agnostic structure
   */
  normalizeToken(
    providerToken: admin.auth.DecodedIdToken,
    customClaimsConfig: CustomClaimsConfig<TCustomClaims>
  ): NormalizedToken<TCustomClaims> {
    // Extract custom claims using provided configuration
    let customClaims: TCustomClaims;
    try {
      customClaims = customClaimsConfig.extract(providerToken);
      
      // Validate if validator is provided
      if (customClaimsConfig.validate && !customClaimsConfig.validate(customClaims)) {
        // If validation fails, use defaults
        customClaims = customClaimsConfig.defaults as TCustomClaims;
      }
    } catch (error) {
      // If extraction fails, use defaults
      customClaims = customClaimsConfig.defaults as TCustomClaims;
    }

    return {
      authUID: providerToken.uid,
      userUID: this.extractUserUID(providerToken, customClaims),

      email: providerToken.email || null,
      emailVerified: providerToken.email_verified || false,
      phoneNumber: providerToken.phone_number || null,

      issuedAt: providerToken.iat,
      expiresAt: providerToken.exp,
      issuer: 'firebase',

      customClaims,
      rawClaims: providerToken
    };
  }

  /**
   * Sync custom claims to Firebase Auth
   */
  async syncCustomClaims(
    authUID: string,
    claims: TCustomClaims,
    logger: Logger
  ): Promise<void> {
    logger.debug('FirebaseAuthAdapter: Syncing custom claims', {
      authUID,
      claimKeys: Object.keys(claims as Record<string, any>)
    });

    try {
      await admin.auth().setCustomUserClaims(authUID, claims as Record<string, any>);
      
      logger.info('FirebaseAuthAdapter: Custom claims synced successfully', {
        authUID
      });
    } catch (error: any) {
      logger.error('FirebaseAuthAdapter: Failed to sync custom claims', error, {
        authUID
      });
      throw error;
    }
  }

  /**
   * Revoke user tokens at Firebase level
   * Firebase supports this via revokeRefreshTokens
   */
  async revokeUserTokens(authUID: string, logger: Logger): Promise<boolean> {
    logger.info('FirebaseAuthAdapter: Revoking user tokens at Firebase', {
      authUID
    });

    try {
      await admin.auth().revokeRefreshTokens(authUID);
      
      logger.info('FirebaseAuthAdapter: User tokens revoked successfully', {
        authUID
      });

      return true;
    } catch (error: any) {
      logger.error('FirebaseAuthAdapter: Failed to revoke tokens', error, {
        authUID
      });
      return false;
    }
  }

  /**
   * Map Firebase errors to standard error types
   */
  mapProviderError(error: any): TokenVerificationError {
    const errorCode = error.code || '';
    const errorMessage = error.message || '';

    // Firebase ID token verification errors
    if (errorCode.includes('expired') || errorCode.includes('exp-') || 
        errorMessage.includes('expired')) {
      return TokenVerificationError.EXPIRED;
    }

    if (errorCode.includes('invalid') || errorCode.includes('signature') ||
        errorMessage.includes('signature') || errorMessage.includes('invalid')) {
      return TokenVerificationError.INVALID_SIGNATURE;
    }

    if (errorCode.includes('malformed') || errorMessage.includes('malformed') ||
        errorMessage.includes('decode')) {
      return TokenVerificationError.MALFORMED;
    }

    // Firebase-specific error codes
    switch (errorCode) {
      case 'auth/argument-error':
      case 'auth/invalid-id-token':
        return TokenVerificationError.MALFORMED;
      
      case 'auth/id-token-expired':
        return TokenVerificationError.EXPIRED;
      
      case 'auth/id-token-revoked':
        return TokenVerificationError.BLACKLISTED;
      
      default:
        return TokenVerificationError.UNKNOWN;
    }
  }

  /**
   * Extract userUID from token, with fallback logic
   * This method can be customized based on how different projects
   * structure their custom claims
   */
  private extractUserUID(
    providerToken: admin.auth.DecodedIdToken,
    customClaims: TCustomClaims
  ): string | null {
    // Try to extract from custom claims first
    if (customClaims && typeof customClaims === 'object' && 'userUID' in customClaims) {
      return (customClaims as any).userUID || null;
    }

    // Fallback: check if it's directly in the provider token
    const anyToken = providerToken as any;
    if (anyToken.userUID) {
      return anyToken.userUID;
    }

    // No userUID found - this might be a first-time user
    return null;
  }
}

/**
 * Factory function to create Firebase adapter with type safety
 */
export function createFirebaseAuthAdapter<TCustomClaims = Record<string, any>>(): 
  FirebaseAuthAdapter<TCustomClaims> {
  return new FirebaseAuthAdapter<TCustomClaims>();
}