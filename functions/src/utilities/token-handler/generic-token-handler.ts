/**
 * Generic Token Handler
 * Platform-agnostic token handling with configurable auth providers
 */

import { Logger } from '../logger';
import {
  ITokenHandler,
  ITokenAdapter,
  TokenVerificationResult,
  TokenVerificationError,
  TokenBlacklistEntry,
  TokenHandlerConfig
} from './token-types';
import { TokenBlacklistManager } from './token-blacklist-manager';

export class TokenHandler<TCustomClaims = Record<string, any>> 
  implements ITokenHandler<TCustomClaims> {

  private blacklistManager: TokenBlacklistManager;

  constructor(
    private config: TokenHandlerConfig<TCustomClaims>,
    private adapter: ITokenAdapter<TCustomClaims>
  ) {
    this.blacklistManager = new TokenBlacklistManager(
      this.config.database,
      this.config.blacklist
    );
  }

  /**
   * Verify and unpack raw token string
   * Returns normalized token if valid, or error details if invalid
   */
  async verifyAndUnpack(
    rawToken: string,
    logger: Logger
  ): Promise<TokenVerificationResult<TCustomClaims>> {
    logger.debug('TokenHandler: Starting token verification');

    try {
      // Step 1: Verify token with auth provider
      const providerToken = await this.adapter.verifyToken(rawToken, logger);
      
      logger.debug('TokenHandler: Token verified by provider', {
        authUID: this.extractAuthUID(providerToken)
      });

      // Step 2: Check if token is individually blacklisted
      const tokenIdentifier = await this.adapter.getTokenIdentifier(rawToken);
      const isIndividuallyBlacklisted = await this.blacklistManager.isBlacklisted(
        tokenIdentifier, 
        logger
      );

      if (isIndividuallyBlacklisted) {
        logger.warn('TokenHandler: Token is individually blacklisted', {
          authUID: this.extractAuthUID(providerToken)
        });

        return {
          isValid: false,
          isBlacklisted: true,
          token: null,
          error: TokenVerificationError.BLACKLISTED
        };
      }

      // Step 3: Check if user has global token revocation
      const authUID = this.extractAuthUID(providerToken);
      const revocationTime = await this.blacklistManager.getUserTokenRevocationTime(
        authUID,
        logger
      );

      if (revocationTime) {
        const tokenIssuedAt = this.extractIssuedAt(providerToken);
        const tokenIssuedDate = new Date(tokenIssuedAt * 1000);
        
        if (tokenIssuedDate < revocationTime) {
          logger.warn('TokenHandler: Token issued before global revocation', {
            authUID,
            tokenIssuedAt: tokenIssuedDate,
            // Don't log revocation time for privacy
          });

          return {
            isValid: false,
            isBlacklisted: true,
            token: null,
            error: TokenVerificationError.BLACKLISTED
          };
        }
      }

      // Step 4: Normalize token to platform-agnostic structure
      const normalizedToken = this.adapter.normalizeToken(
        providerToken,
        this.config.customClaims
      );

      logger.debug('TokenHandler: Token verified and normalized', {
        authUID: normalizedToken.authUID,
        userUID: normalizedToken.userUID,
        issuer: normalizedToken.issuer
      });

      return {
        isValid: true,
        isBlacklisted: false,
        token: normalizedToken,
        error: null
      };

    } catch (error: any) {
      logger.warn('TokenHandler: Token verification failed', {
        error: error.message
      });

      // Map provider errors to our error types
      const verificationError = this.adapter.mapProviderError(error);

      return {
        isValid: false,
        isBlacklisted: false,
        token: null,
        error: verificationError
      };
    }
  }

  /**
   * Generate token identifier for blacklist lookup
   */
  async getTokenIdentifier(rawToken: string): Promise<string> {
    return this.adapter.getTokenIdentifier(rawToken);
  }

  /**
   * Sync custom claims to auth provider
   */
  async syncCustomClaims(
    authUID: string,
    claims: TCustomClaims,
    logger: Logger
  ): Promise<void> {
    logger.debug('TokenHandler: Syncing custom claims', {
      authUID,
      provider: this.config.provider.type
    });

    await this.adapter.syncCustomClaims(authUID, claims, logger);
  }

  /**
   * Revoke all tokens for a user at provider level
   */
  async revokeUserTokens(authUID: string, logger: Logger): Promise<boolean> {
    logger.info('TokenHandler: Revoking user tokens at provider level', {
      authUID,
      provider: this.config.provider.type
    });

    return this.adapter.revokeUserTokens(authUID, logger);
  }

  /**
   * Blacklist individual token
   */
  async blacklistToken(
    tokenIdentifier: string,
    authUID: string,
    reason: string,
    tokenExpiresAt: Date,
    blacklistedBy: string | null,
    logger: Logger
  ): Promise<TokenBlacklistEntry> {
    return this.blacklistManager.blacklistToken(
      tokenIdentifier,
      authUID,
      reason,
      tokenExpiresAt,
      blacklistedBy,
      logger
    );
  }

  /**
   * Blacklist all tokens for a user (global revocation)
   */
  async blacklistAllUserTokens(
    authUID: string,
    reason: string,
    blacklistedBy: string | null,
    logger: Logger
  ): Promise<void> {
    return this.blacklistManager.blacklistAllUserTokens(
      authUID,
      reason,
      blacklistedBy,
      logger
    );
  }

  /**
   * Check if token is blacklisted
   */
  async isTokenBlacklisted(tokenIdentifier: string, logger: Logger): Promise<boolean> {
    return this.blacklistManager.isBlacklisted(tokenIdentifier, logger);
  }

  /**
   * Get user's token revocation timestamp
   */
  async getUserTokenRevocationTime(authUID: string, logger: Logger): Promise<Date | null> {
    return this.blacklistManager.getUserTokenRevocationTime(authUID, logger);
  }

  /**
   * Cleanup expired blacklist entries
   */
  async cleanupExpiredEntries(logger: Logger): Promise<number> {
    return this.blacklistManager.cleanupExpiredEntries(logger);
  }

  /**
   * Get token handler configuration
   */
  getConfig(): TokenHandlerConfig<TCustomClaims> {
    return { ...this.config };
  }

  /**
   * Extract authUID from provider token
   * Different providers may structure this differently
   */
  private extractAuthUID(providerToken: any): string {
    // Common patterns for different providers
    return providerToken.uid || providerToken.sub || providerToken.user_id || '';
  }

  /**
   * Extract issued-at timestamp from provider token
   * Different providers may structure this differently
   */
  private extractIssuedAt(providerToken: any): number {
    return providerToken.iat || providerToken.issued_at || Math.floor(Date.now() / 1000);
  }
}

/**
 * Factory function to create token handler with type safety
 */
export function createTokenHandler<TCustomClaims = Record<string, any>>(
  config: TokenHandlerConfig<TCustomClaims>,
  adapter: ITokenAdapter<TCustomClaims>
): TokenHandler<TCustomClaims> {
  return new TokenHandler<TCustomClaims>(config, adapter);
}