/**
 * Token Handler Types
 * Platform-agnostic types for token handling utilities
 */

import { Logger } from '../logger';

/**
 * Normalized token payload - platform-agnostic structure
 * This is what applications work with internally, regardless of auth provider
 */
export interface NormalizedToken<TCustomClaims = Record<string, any>> {
  // Core identity
  authUID: string;                    // Unique identifier from auth provider
  userUID: string | null;             // App's user ID (null if first-time)
  
  // Contact info (from provider)
  email: string | null;
  emailVerified: boolean;
  phoneNumber: string | null;
  
  // Token metadata
  issuedAt: number;                   // Unix timestamp
  expiresAt: number;                  // Unix timestamp
  issuer: string;                     // e.g., "firebase", "auth0", "clerk"
  
  // Custom claims (app data synced to provider)
  customClaims: TCustomClaims;
  
  // Raw provider-specific data (for debugging, not for business logic)
  rawClaims: Record<string, any>;
}

/**
 * Token verification result
 */
export interface TokenVerificationResult<TCustomClaims = Record<string, any>> {
  isValid: boolean;
  isBlacklisted: boolean;
  token: NormalizedToken<TCustomClaims> | null;
  error: TokenVerificationError | null;
}

/**
 * Token verification errors
 */
export enum TokenVerificationError {
  EXPIRED = 'EXPIRED',
  INVALID_SIGNATURE = 'INVALID_SIGNATURE',
  BLACKLISTED = 'BLACKLISTED',
  MALFORMED = 'MALFORMED',
  ISSUER_MISMATCH = 'ISSUER_MISMATCH',
  UNKNOWN = 'UNKNOWN'
}

/**
 * Blacklist entry
 */
export interface TokenBlacklistEntry {
  blacklistEntryUID: string;          // Database document ID
  tokenJTI: string;                   // JWT ID (jti claim) or token hash
  authUID: string;                    // User who owned this token
  blacklistedAt: Date;
  blacklistedBy: string | null;       // userUID who triggered blacklist (or null if user-initiated)
  reason: string;                     // Configurable reason (project-specific)
  expiresAt: Date;                    // Auto-delete after token would expire anyway
}

/**
 * Abstract token adapter interface
 * All auth provider implementations must implement this
 */
export interface ITokenAdapter<TCustomClaims = Record<string, any>> {
  /**
   * Verify token with the auth provider
   * Returns provider-specific decoded token or throws error
   */
  verifyToken(rawToken: string, logger: Logger): Promise<any>;

  /**
   * Generate unique identifier for token (for blacklist lookup)
   * Different providers may use jti claim or hash of token
   */
  getTokenIdentifier(rawToken: string): Promise<string>;

  /**
   * Normalize provider-specific token to platform-agnostic structure
   */
  normalizeToken(
    providerToken: any,
    customClaimsConfig: CustomClaimsConfig<TCustomClaims>
  ): NormalizedToken<TCustomClaims>;

  /**
   * Sync custom claims to auth provider
   * Updates provider's custom claims with app data
   */
  syncCustomClaims(
    authUID: string,
    claims: TCustomClaims,
    logger: Logger
  ): Promise<void>;

  /**
   * Revoke all tokens for a user at provider level (if supported)
   * Not all providers support this - return false if unsupported
   */
  revokeUserTokens(authUID: string, logger: Logger): Promise<boolean>;

  /**
   * Map provider-specific errors to standard error types
   */
  mapProviderError(error: any): TokenVerificationError;
}

/**
 * Configuration for custom claims extraction and validation
 */
export interface CustomClaimsConfig<TCustomClaims> {
  /**
   * Extract custom claims from provider token
   */
  extract: (providerToken: any) => TCustomClaims;

  /**
   * Validate custom claims structure (optional)
   */
  validate?: (claims: TCustomClaims) => boolean;

  /**
   * Default/fallback claims when none exist
   */
  defaults: Partial<TCustomClaims>;
}

/**
 * Database connector interface for blacklist operations
 */
export interface ITokenDatabase {
  /**
   * Add entry to blacklist
   */
  addBlacklistEntry(entry: TokenBlacklistEntry): Promise<void>;

  /**
   * Check if token identifier is blacklisted
   */
  isTokenBlacklisted(tokenIdentifier: string): Promise<boolean>;

  /**
   * Get user's global token revocation timestamp
   */
  getUserRevocationTime(authUID: string): Promise<Date | null>;

  /**
   * Add global revocation entry for user
   */
  addUserRevocation(
    authUID: string,
    reason: string,
    blacklistedBy: string | null,
    expiresAt: Date
  ): Promise<void>;

  /**
   * Remove expired blacklist entries
   */
  cleanupExpiredEntries(): Promise<number>;
}

/**
 * Blacklist configuration
 */
export interface BlacklistConfig {
  /**
   * Database/collection to store blacklist entries
   */
  storage: {
    database: string;
    collection: string;
  };

  /**
   * Cleanup and retention settings
   */
  retention: {
    cleanupRetentionDays: number;
    globalRevocationRetentionDays: number;
  };

  /**
   * Valid blacklist reasons for this project
   */
  reasons: string[];
}

/**
 * Provider-specific configuration
 */
export interface ProviderConfig {
  type: 'firebase' | 'auth0' | 'clerk' | 'custom';
  
  // Provider-specific settings
  firebase?: {
    projectId?: string;
    // Other Firebase-specific config
  };
  
  auth0?: {
    domain: string;
    audience: string;
    // Other Auth0-specific config
  };
  
  clerk?: {
    secretKey: string;
    // Other Clerk-specific config
  };
  
  custom?: {
    // Custom provider configuration
    [key: string]: any;
  };
}

/**
 * Complete token handler configuration
 */
export interface TokenHandlerConfig<TCustomClaims = Record<string, any>> {
  /**
   * Custom claims configuration
   */
  customClaims: CustomClaimsConfig<TCustomClaims>;

  /**
   * Blacklist settings
   */
  blacklist: BlacklistConfig;

  /**
   * Auth provider configuration
   */
  provider: ProviderConfig;

  /**
   * Database connector for blacklist operations
   */
  database: ITokenDatabase;
}

/**
 * Factory function signature for creating configured token handlers
 */
export type TokenHandlerFactory<TCustomClaims = Record<string, any>> = (
  config: TokenHandlerConfig<TCustomClaims>
) => ITokenHandler<TCustomClaims>;

/**
 * Main token handler interface
 */
export interface ITokenHandler<TCustomClaims = Record<string, any>> {
  /**
   * Verify and unpack raw token string
   * Returns normalized token if valid, or error details if invalid
   */
  verifyAndUnpack(
    rawToken: string,
    logger: Logger
  ): Promise<TokenVerificationResult<TCustomClaims>>;

  /**
   * Generate token identifier for blacklist lookup
   */
  getTokenIdentifier(rawToken: string): Promise<string>;

  /**
   * Sync custom claims to auth provider
   */
  syncCustomClaims(
    authUID: string,
    claims: TCustomClaims,
    logger: Logger
  ): Promise<void>;

  /**
   * Revoke all tokens for a user at provider level
   */
  revokeUserTokens(authUID: string, logger: Logger): Promise<boolean>;

  /**
   * Blacklist individual token
   */
  blacklistToken(
    tokenIdentifier: string,
    authUID: string,
    reason: string,
    tokenExpiresAt: Date,
    blacklistedBy: string | null,
    logger: Logger
  ): Promise<TokenBlacklistEntry>;

  /**
   * Blacklist all tokens for a user (global revocation)
   */
  blacklistAllUserTokens(
    authUID: string,
    reason: string,
    blacklistedBy: string | null,
    logger: Logger
  ): Promise<void>;

  /**
   * Check if token is blacklisted
   */
  isTokenBlacklisted(tokenIdentifier: string, logger: Logger): Promise<boolean>;

  /**
   * Get user's token revocation timestamp
   */
  getUserTokenRevocationTime(authUID: string, logger: Logger): Promise<Date | null>;

  /**
   * Cleanup expired blacklist entries
   */
  cleanupExpiredEntries(logger: Logger): Promise<number>;
}