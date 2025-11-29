/**
 * Generic Token Handler - Unit Tests
 *
 * Testing WHAT the token handler does, not HOW it works internally:
 * - Verifies tokens through provider adapter
 * - Checks blacklist (individual and global)
 * - Normalizes provider tokens to platform-agnostic structure
 * - Syncs custom claims
 * - Revokes tokens at provider level
 */

import { TokenHandler, createTokenHandler } from '../generic-token-handler';
import { Logger } from '../../logger';
import {
  ITokenAdapter,
  ITokenDatabase,
  TokenHandlerConfig,
  NormalizedToken,
  TokenVerificationError,
} from '../token-types';

describe('Generic Token Handler', () => {
  let mockAdapter: jest.Mocked<ITokenAdapter>;
  let mockDatabase: jest.Mocked<ITokenDatabase>;
  let mockLogger: Logger;
  let config: TokenHandlerConfig;
  let handler: TokenHandler;

  beforeEach(() => {
    // Mock adapter
    mockAdapter = {
      verifyToken: jest.fn(),
      getTokenIdentifier: jest.fn(),
      normalizeToken: jest.fn(),
      syncCustomClaims: jest.fn(),
      revokeUserTokens: jest.fn(),
      mapProviderError: jest.fn(),
    };

    // Mock database
    mockDatabase = {
      addBlacklistEntry: jest.fn().mockResolvedValue(undefined),
      isTokenBlacklisted: jest.fn().mockResolvedValue(false),
      addUserRevocation: jest.fn().mockResolvedValue(undefined),
      getUserRevocationTime: jest.fn().mockResolvedValue(null),
      cleanupExpiredEntries: jest.fn().mockResolvedValue(0),
    };

    // Mock logger
    mockLogger = new Logger('test-correlation-id');

    // Test configuration
    config = {
      provider: {
        type: 'firebase',
        firebase: {
          projectId: 'test-project',
        },
      },
      customClaims: {
        extract: (rawClaims: any) => rawClaims,
        defaults: {},
      },
      blacklist: {
        reasons: ['user_logout', 'user_deleted', 'password_changed'],
        storage: {
          database: 'firestore',
          collection: 'token_blacklist',
        },
        retention: {
          cleanupRetentionDays: 30,
          globalRevocationRetentionDays: 90,
        },
      },
      database: mockDatabase,
    };

    handler = new TokenHandler(config, mockAdapter);

    jest.clearAllMocks();
  });

  describe('verifyAndUnpack', () => {
    const mockProviderToken = {
      uid: 'auth-user-123',
      sub: 'auth-user-123',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
      email: 'test@example.com',
      email_verified: true,
    };

    const mockNormalizedToken: NormalizedToken = {
      authUID: 'auth-user-123',
      userUID: 'user-123',
      email: 'test@example.com',
      emailVerified: true,
      phoneNumber: null,
      issuedAt: Math.floor(Date.now() / 1000),
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
      issuer: 'firebase',
      customClaims: { userUID: 'user-123' },
      rawClaims: mockProviderToken,
    };

    it('successfully verifies and unpacks valid token', async () => {
      mockAdapter.verifyToken.mockResolvedValue(mockProviderToken);
      mockAdapter.getTokenIdentifier.mockResolvedValue('token-jti-123');
      mockAdapter.normalizeToken.mockReturnValue(mockNormalizedToken);
      mockDatabase.isTokenBlacklisted.mockResolvedValue(false);
      mockDatabase.getUserRevocationTime.mockResolvedValue(null);

      const result = await handler.verifyAndUnpack('raw-token-string', mockLogger);

      expect(result.isValid).toBe(true);
      expect(result.isBlacklisted).toBe(false);
      expect(result.token).toEqual(mockNormalizedToken);
      expect(result.error).toBeNull();
    });

    it('calls adapter methods in correct sequence', async () => {
      mockAdapter.verifyToken.mockResolvedValue(mockProviderToken);
      mockAdapter.getTokenIdentifier.mockResolvedValue('token-jti-123');
      mockAdapter.normalizeToken.mockReturnValue(mockNormalizedToken);

      await handler.verifyAndUnpack('raw-token', mockLogger);

      expect(mockAdapter.verifyToken).toHaveBeenCalledWith('raw-token', mockLogger);
      expect(mockAdapter.getTokenIdentifier).toHaveBeenCalledWith('raw-token');
      expect(mockAdapter.normalizeToken).toHaveBeenCalledWith(mockProviderToken, config.customClaims);
    });

    it('rejects individually blacklisted token', async () => {
      mockAdapter.verifyToken.mockResolvedValue(mockProviderToken);
      mockAdapter.getTokenIdentifier.mockResolvedValue('token-jti-123');
      mockDatabase.isTokenBlacklisted.mockResolvedValue(true); // Blacklisted

      const result = await handler.verifyAndUnpack('raw-token', mockLogger);

      expect(result.isValid).toBe(false);
      expect(result.isBlacklisted).toBe(true);
      expect(result.token).toBeNull();
      expect(result.error).toBe(TokenVerificationError.BLACKLISTED);
    });

    it('rejects token issued before global revocation', async () => {
      const tokenIssuedAt = Math.floor(Date.now() / 1000) - 7200; // 2 hours ago
      const revocationTime = new Date(Date.now() - 3600000); // 1 hour ago

      const oldProviderToken = {
        ...mockProviderToken,
        iat: tokenIssuedAt,
      };

      mockAdapter.verifyToken.mockResolvedValue(oldProviderToken);
      mockAdapter.getTokenIdentifier.mockResolvedValue('token-jti-123');
      mockDatabase.isTokenBlacklisted.mockResolvedValue(false);
      mockDatabase.getUserRevocationTime.mockResolvedValue(revocationTime);

      const result = await handler.verifyAndUnpack('raw-token', mockLogger);

      expect(result.isValid).toBe(false);
      expect(result.isBlacklisted).toBe(true);
      expect(result.error).toBe(TokenVerificationError.BLACKLISTED);
    });

    it('accepts token issued after global revocation', async () => {
      const revocationTime = new Date(Date.now() - 7200000); // 2 hours ago
      const tokenIssuedAt = Math.floor(Date.now() / 1000) - 1800; // 30 minutes ago

      const newProviderToken = {
        ...mockProviderToken,
        iat: tokenIssuedAt,
      };

      mockAdapter.verifyToken.mockResolvedValue(newProviderToken);
      mockAdapter.getTokenIdentifier.mockResolvedValue('token-jti-123');
      mockAdapter.normalizeToken.mockReturnValue(mockNormalizedToken);
      mockDatabase.isTokenBlacklisted.mockResolvedValue(false);
      mockDatabase.getUserRevocationTime.mockResolvedValue(revocationTime);

      const result = await handler.verifyAndUnpack('raw-token', mockLogger);

      expect(result.isValid).toBe(true);
      expect(result.isBlacklisted).toBe(false);
    });

    it('handles provider verification error', async () => {
      const providerError = new Error('Invalid signature');
      mockAdapter.verifyToken.mockRejectedValue(providerError);
      mockAdapter.mapProviderError.mockReturnValue(TokenVerificationError.INVALID_SIGNATURE);

      const result = await handler.verifyAndUnpack('raw-token', mockLogger);

      expect(result.isValid).toBe(false);
      expect(result.isBlacklisted).toBe(false);
      expect(result.token).toBeNull();
      expect(result.error).toBe(TokenVerificationError.INVALID_SIGNATURE);
    });

    it('handles token expiration error', async () => {
      const expiredError = new Error('Token expired');
      mockAdapter.verifyToken.mockRejectedValue(expiredError);
      mockAdapter.mapProviderError.mockReturnValue(TokenVerificationError.EXPIRED);

      const result = await handler.verifyAndUnpack('raw-token', mockLogger);

      expect(result.error).toBe(TokenVerificationError.EXPIRED);
    });

    it('handles malformed token error', async () => {
      const malformedError = new Error('Malformed JWT');
      mockAdapter.verifyToken.mockRejectedValue(malformedError);
      mockAdapter.mapProviderError.mockReturnValue(TokenVerificationError.MALFORMED);

      const result = await handler.verifyAndUnpack('raw-token', mockLogger);

      expect(result.error).toBe(TokenVerificationError.MALFORMED);
    });

    it('extracts authUID from provider token (uid field)', async () => {
      const tokenWithUID = { uid: 'auth-123', iat: 1234567890 };
      mockAdapter.verifyToken.mockResolvedValue(tokenWithUID);
      mockAdapter.getTokenIdentifier.mockResolvedValue('jti-123');
      mockAdapter.normalizeToken.mockReturnValue(mockNormalizedToken);

      await handler.verifyAndUnpack('raw-token', mockLogger);

      expect(mockDatabase.getUserRevocationTime).toHaveBeenCalledWith('auth-123');
    });

    it('extracts authUID from provider token (sub field)', async () => {
      const tokenWithSub = { sub: 'auth-456', iat: 1234567890 };
      mockAdapter.verifyToken.mockResolvedValue(tokenWithSub);
      mockAdapter.getTokenIdentifier.mockResolvedValue('jti-123');
      mockAdapter.normalizeToken.mockReturnValue(mockNormalizedToken);

      await handler.verifyAndUnpack('raw-token', mockLogger);

      expect(mockDatabase.getUserRevocationTime).toHaveBeenCalledWith('auth-456');
    });

    it('handles token with no global revocation', async () => {
      mockAdapter.verifyToken.mockResolvedValue(mockProviderToken);
      mockAdapter.getTokenIdentifier.mockResolvedValue('token-jti-123');
      mockAdapter.normalizeToken.mockReturnValue(mockNormalizedToken);
      mockDatabase.getUserRevocationTime.mockResolvedValue(null); // No revocation

      const result = await handler.verifyAndUnpack('raw-token', mockLogger);

      expect(result.isValid).toBe(true);
      expect(result.isBlacklisted).toBe(false);
    });
  });

  describe('getTokenIdentifier', () => {
    it('delegates to adapter', async () => {
      mockAdapter.getTokenIdentifier.mockResolvedValue('token-jti-123');

      const result = await handler.getTokenIdentifier('raw-token');

      expect(result).toBe('token-jti-123');
      expect(mockAdapter.getTokenIdentifier).toHaveBeenCalledWith('raw-token');
    });
  });

  describe('syncCustomClaims', () => {
    it('syncs custom claims through adapter', async () => {
      const claims = { userUID: 'user-123', role: 'admin' };
      mockAdapter.syncCustomClaims.mockResolvedValue(undefined);

      await handler.syncCustomClaims('auth-123', claims, mockLogger);

      expect(mockAdapter.syncCustomClaims).toHaveBeenCalledWith('auth-123', claims, mockLogger);
    });

    it('handles empty custom claims', async () => {
      const emptyClaims = {};
      mockAdapter.syncCustomClaims.mockResolvedValue(undefined);

      await handler.syncCustomClaims('auth-123', emptyClaims, mockLogger);

      expect(mockAdapter.syncCustomClaims).toHaveBeenCalledWith('auth-123', emptyClaims, mockLogger);
    });
  });

  describe('revokeUserTokens', () => {
    it('revokes tokens at provider level', async () => {
      mockAdapter.revokeUserTokens.mockResolvedValue(true);

      const result = await handler.revokeUserTokens('auth-123', mockLogger);

      expect(result).toBe(true);
      expect(mockAdapter.revokeUserTokens).toHaveBeenCalledWith('auth-123', mockLogger);
    });

    it('returns false when revocation fails', async () => {
      mockAdapter.revokeUserTokens.mockResolvedValue(false);

      const result = await handler.revokeUserTokens('auth-123', mockLogger);

      expect(result).toBe(false);
    });
  });

  describe('blacklistToken', () => {
    it('adds token to blacklist', async () => {
      const tokenIdentifier = 'token-jti-123';
      const authUID = 'auth-user-123';
      const reason = 'user_logout';
      const tokenExpiresAt = new Date(Date.now() + 3600000);
      const blacklistedBy = 'admin-123';

      await handler.blacklistToken(
        tokenIdentifier,
        authUID,
        reason,
        tokenExpiresAt,
        blacklistedBy,
        mockLogger
      );

      expect(mockDatabase.addBlacklistEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          tokenJTI: tokenIdentifier,
          authUID,
          reason,
          blacklistedBy,
        })
      );
    });
  });

  describe('blacklistAllUserTokens', () => {
    it('creates global revocation for user', async () => {
      const authUID = 'auth-123';
      const reason = 'password_changed';
      const blacklistedBy = 'user-123';

      await handler.blacklistAllUserTokens(authUID, reason, blacklistedBy, mockLogger);

      expect(mockDatabase.addUserRevocation).toHaveBeenCalledWith(
        authUID,
        reason,
        blacklistedBy,
        expect.any(Date)
      );
    });
  });

  describe('isTokenBlacklisted', () => {
    it('checks if token is blacklisted', async () => {
      mockDatabase.isTokenBlacklisted.mockResolvedValue(true);

      const result = await handler.isTokenBlacklisted('token-jti-123', mockLogger);

      expect(result).toBe(true);
    });
  });

  describe('getUserTokenRevocationTime', () => {
    it('returns user revocation timestamp', async () => {
      const revocationTime = new Date('2024-01-01T00:00:00Z');
      mockDatabase.getUserRevocationTime.mockResolvedValue(revocationTime);

      const result = await handler.getUserTokenRevocationTime('auth-123', mockLogger);

      expect(result).toBe(revocationTime);
    });
  });

  describe('cleanupExpiredEntries', () => {
    it('cleans up expired blacklist entries', async () => {
      mockDatabase.cleanupExpiredEntries.mockResolvedValue(42);

      const result = await handler.cleanupExpiredEntries(mockLogger);

      expect(result).toBe(42);
    });
  });

  describe('getConfig', () => {
    it('returns copy of configuration', () => {
      const returnedConfig = handler.getConfig();

      expect(returnedConfig).toEqual(config);
    });

    it('returns a copy (not reference)', () => {
      const returnedConfig1 = handler.getConfig();
      const returnedConfig2 = handler.getConfig();

      // Each call should return a new object
      expect(returnedConfig1).toEqual(returnedConfig2);
      expect(returnedConfig1).not.toBe(returnedConfig2); // Different objects
    });
  });

  describe('createTokenHandler factory', () => {
    it('creates TokenHandler instance', () => {
      const instance = createTokenHandler(config, mockAdapter);

      expect(instance).toBeInstanceOf(TokenHandler);
    });

    it('creates functional handler from factory', async () => {
      const instance = createTokenHandler(config, mockAdapter);

      mockAdapter.verifyToken.mockResolvedValue({ uid: 'auth-123', iat: 123456 });
      mockAdapter.getTokenIdentifier.mockResolvedValue('jti-123');
      mockAdapter.normalizeToken.mockReturnValue({} as NormalizedToken);

      await instance.verifyAndUnpack('raw-token', mockLogger);

      expect(mockAdapter.verifyToken).toHaveBeenCalled();
    });

    it('supports custom claims type parameter', () => {
      interface CustomClaims {
        userUID: string;
        role: string;
        permissions: string[];
      }

      // Type casting through unknown to avoid strict type checking
      const typedConfig = config as unknown as TokenHandlerConfig<CustomClaims>;
      const typedAdapter = mockAdapter as unknown as ITokenAdapter<CustomClaims>;
      const instance = createTokenHandler<CustomClaims>(typedConfig, typedAdapter);

      expect(instance).toBeInstanceOf(TokenHandler);
    });
  });

  describe('edge cases', () => {
    it('handles provider token with missing iat field', async () => {
      const tokenWithoutIat = { uid: 'auth-123' };
      mockAdapter.verifyToken.mockResolvedValue(tokenWithoutIat);
      mockAdapter.getTokenIdentifier.mockResolvedValue('jti-123');
      mockAdapter.normalizeToken.mockReturnValue({} as NormalizedToken);

      await handler.verifyAndUnpack('raw-token', mockLogger);

      // Should not throw, uses current time as fallback
      expect(mockAdapter.verifyToken).toHaveBeenCalled();
    });

    it('handles provider token with missing uid field', async () => {
      const tokenWithoutUID = { iat: 123456 };
      mockAdapter.verifyToken.mockResolvedValue(tokenWithoutUID);
      mockAdapter.getTokenIdentifier.mockResolvedValue('jti-123');
      mockAdapter.normalizeToken.mockReturnValue({} as NormalizedToken);

      await handler.verifyAndUnpack('raw-token', mockLogger);

      // Should handle gracefully (empty string as fallback)
      expect(mockDatabase.getUserRevocationTime).toHaveBeenCalledWith('');
    });

    it('handles very long token strings', async () => {
      const longToken = 'a'.repeat(10000);
      mockAdapter.verifyToken.mockResolvedValue({ uid: 'auth-123', iat: 123456 });
      mockAdapter.getTokenIdentifier.mockResolvedValue('jti-123');
      mockAdapter.normalizeToken.mockReturnValue({} as NormalizedToken);

      await handler.verifyAndUnpack(longToken, mockLogger);

      expect(mockAdapter.verifyToken).toHaveBeenCalledWith(longToken, mockLogger);
    });

    it('handles empty token string', async () => {
      const emptyTokenError = new Error('Empty token');
      mockAdapter.verifyToken.mockRejectedValue(emptyTokenError);
      mockAdapter.mapProviderError.mockReturnValue(TokenVerificationError.MALFORMED);

      const result = await handler.verifyAndUnpack('', mockLogger);

      expect(result.isValid).toBe(false);
      expect(result.error).toBe(TokenVerificationError.MALFORMED);
    });

    it('handles token with future issuedAt', async () => {
      const futureIat = Math.floor(Date.now() / 1000) + 3600; // 1 hour in future
      const futureToken = { uid: 'auth-123', iat: futureIat };

      mockAdapter.verifyToken.mockResolvedValue(futureToken);
      mockAdapter.getTokenIdentifier.mockResolvedValue('jti-123');
      mockAdapter.normalizeToken.mockReturnValue({} as NormalizedToken);
      mockDatabase.getUserRevocationTime.mockResolvedValue(new Date());

      await handler.verifyAndUnpack('raw-token', mockLogger);

      // Should handle gracefully
      expect(mockAdapter.verifyToken).toHaveBeenCalled();
    });
  });

  describe('error propagation', () => {
    it('propagates adapter errors through mapProviderError', async () => {
      const customError = new Error('Custom provider error');
      mockAdapter.verifyToken.mockRejectedValue(customError);
      mockAdapter.mapProviderError.mockReturnValue(TokenVerificationError.UNKNOWN);

      const result = await handler.verifyAndUnpack('raw-token', mockLogger);

      expect(result.error).toBe(TokenVerificationError.UNKNOWN);
      expect(mockAdapter.mapProviderError).toHaveBeenCalledWith(customError);
    });

    it('handles non-Error thrown from adapter', async () => {
      mockAdapter.verifyToken.mockRejectedValue('string error');
      mockAdapter.mapProviderError.mockReturnValue(TokenVerificationError.UNKNOWN);

      const result = await handler.verifyAndUnpack('raw-token', mockLogger);

      expect(result.isValid).toBe(false);
    });

    it('handles database errors gracefully', async () => {
      const dbError = new Error('Database error');
      mockAdapter.verifyToken.mockResolvedValue({ uid: 'auth-123', iat: 123456 });
      mockAdapter.getTokenIdentifier.mockResolvedValue('jti-123');
      mockDatabase.isTokenBlacklisted.mockRejectedValue(dbError);

      // Database errors during blacklist check are caught and returned as unknown errors
      const result = await handler.verifyAndUnpack('raw-token', mockLogger);
      expect(result.isValid).toBe(false);
      // The error is caught by the try-catch in verifyAndUnpack
    });
  });
});
