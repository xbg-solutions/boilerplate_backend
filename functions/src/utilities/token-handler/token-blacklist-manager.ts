/**
 * Token Blacklist Manager
 * Generic token blacklist implementation with configurable database backend
 */

import { Logger } from '../logger';
import {
  TokenBlacklistEntry,
  ITokenDatabase,
  BlacklistConfig
} from './token-types';
import { v4 as uuidv4 } from 'uuid';

export class TokenBlacklistManager {
  constructor(
    private database: ITokenDatabase,
    private config: BlacklistConfig
  ) {}

  /**
   * Add token to blacklist
   * 
   * @param tokenIdentifier - Token JTI or hash
   * @param authUID - User who owned this token
   * @param reason - Reason for blacklisting (must be in configured reasons)
   * @param tokenExpiresAt - When token would naturally expire
   * @param blacklistedBy - Optional userUID who triggered blacklist
   * @param logger - Logger instance
   */
  async blacklistToken(
    tokenIdentifier: string,
    authUID: string,
    reason: string,
    tokenExpiresAt: Date,
    blacklistedBy: string | null,
    logger: Logger
  ): Promise<TokenBlacklistEntry> {
    // Validate reason against configured reasons
    this.validateReason(reason, logger);

    logger.debug('TokenBlacklistManager: Adding token to blacklist', {
      tokenIdentifier: this.maskTokenIdentifier(tokenIdentifier),
      authUID,
      reason,
      database: this.config.storage.database,
      collection: this.config.storage.collection
    });

    const entry: TokenBlacklistEntry = {
      blacklistEntryUID: uuidv4(),
      tokenJTI: tokenIdentifier,
      authUID,
      blacklistedAt: new Date(),
      blacklistedBy,
      reason,
      expiresAt: tokenExpiresAt
    };

    await this.database.addBlacklistEntry(entry);

    logger.info('TokenBlacklistManager: Token blacklisted successfully', {
      blacklistEntryUID: entry.blacklistEntryUID,
      authUID,
      reason
    });

    return entry;
  }

  /**
   * Check if token is blacklisted
   * 
   * @param tokenIdentifier - Token JTI or hash
   * @param logger - Logger instance
   * @returns true if blacklisted, false otherwise
   */
  async isBlacklisted(
    tokenIdentifier: string,
    logger: Logger
  ): Promise<boolean> {
    logger.debug('TokenBlacklistManager: Checking if token is blacklisted', {
      tokenIdentifier: this.maskTokenIdentifier(tokenIdentifier)
    });

    const isBlacklisted = await this.database.isTokenBlacklisted(tokenIdentifier);

    logger.debug('TokenBlacklistManager: Blacklist check result', {
      tokenIdentifier: this.maskTokenIdentifier(tokenIdentifier),
      isBlacklisted
    });

    return isBlacklisted;
  }

  /**
   * Blacklist all tokens for a user (global revocation)
   * Used when user logs out all sessions, changes password, or account deleted
   * 
   * This creates a revocation timestamp. Token verification checks:
   * is token issued before this timestamp?
   * 
   * @param authUID - User's auth UID
   * @param reason - Reason for blacklisting (must be in configured reasons)
   * @param blacklistedBy - Optional userUID who triggered blacklist
   * @param logger - Logger instance
   */
  async blacklistAllUserTokens(
    authUID: string,
    reason: string,
    blacklistedBy: string | null,
    logger: Logger
  ): Promise<void> {
    // Validate reason against configured reasons
    this.validateReason(reason, logger);

    logger.info('TokenBlacklistManager: Blacklisting all tokens for user', {
      authUID,
      reason
    });

    const expiresAt = new Date(
      Date.now() + this.config.retention.globalRevocationRetentionDays * 24 * 60 * 60 * 1000
    );

    await this.database.addUserRevocation(authUID, reason, blacklistedBy, expiresAt);

    logger.info('TokenBlacklistManager: All user tokens blacklisted', {
      authUID,
      reason,
      expiresAt
    });
  }

  /**
   * Check if user has a global token revocation
   * Returns the timestamp of revocation if exists
   * 
   * @param authUID - User's auth UID
   * @param logger - Logger instance
   * @returns Date of revocation, or null if no global revocation
   */
  async getUserTokenRevocationTime(
    authUID: string,
    logger: Logger
  ): Promise<Date | null> {
    logger.debug('TokenBlacklistManager: Checking user token revocation', { 
      authUID 
    });

    const revocationTime = await this.database.getUserRevocationTime(authUID);

    logger.debug('TokenBlacklistManager: User revocation check result', {
      authUID,
      hasRevocation: revocationTime !== null,
      // Don't log the actual timestamp for privacy
    });

    return revocationTime;
  }

  /**
   * Cleanup expired blacklist entries
   * Run via CRON job periodically
   * 
   * @param logger - Logger instance
   * @returns Number of entries deleted
   */
  async cleanupExpiredEntries(logger: Logger): Promise<number> {
    logger.info('TokenBlacklistManager: Starting cleanup of expired entries', {
      database: this.config.storage.database,
      collection: this.config.storage.collection
    });

    const deletedCount = await this.database.cleanupExpiredEntries();

    logger.info('TokenBlacklistManager: Cleanup completed', {
      deletedCount,
      database: this.config.storage.database,
      collection: this.config.storage.collection
    });

    return deletedCount;
  }

  /**
   * Get blacklist configuration
   */
  getConfig(): BlacklistConfig {
    return { ...this.config };
  }

  /**
   * Validate that reason is allowed by configuration
   */
  private validateReason(reason: string, logger: Logger): void {
    if (!this.config.reasons.includes(reason)) {
      const error = new Error(
        `Invalid blacklist reason: ${reason}. Allowed reasons: ${this.config.reasons.join(', ')}`
      );
      
      logger.error('TokenBlacklistManager: Invalid blacklist reason', error, {
        providedReason: reason,
        allowedReasons: this.config.reasons
      });
      
      throw error;
    }
  }

  /**
   * Mask token identifier for logging (security)
   * Shows first 10 characters + ...
   */
  private maskTokenIdentifier(tokenIdentifier: string): string {
    if (tokenIdentifier.length <= 10) {
      return tokenIdentifier;
    }
    return tokenIdentifier.substring(0, 10) + '...';
  }
}

/**
 * Factory function to create blacklist manager
 */
export function createTokenBlacklistManager(
  database: ITokenDatabase,
  config: BlacklistConfig
): TokenBlacklistManager {
  return new TokenBlacklistManager(database, config);
}