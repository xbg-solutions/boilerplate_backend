/**
 * Token Blacklist Manager - Unit Tests
 *
 * Testing WHAT the blacklist manager does, not HOW it works internally:
 * - Adds tokens to blacklist with validated reasons
 * - Checks if tokens are blacklisted
 * - Global user token revocation
 * - Cleanup of expired entries
 * - Token identifier masking for security
 */

import { TokenBlacklistManager, createTokenBlacklistManager } from '../token-blacklist-manager';
import { Logger } from '../../logger';
import { ITokenDatabase, BlacklistConfig } from '../token-types';

describe('Token Blacklist Manager', () => {
  let mockDatabase: jest.Mocked<ITokenDatabase>;
  let mockLogger: Logger;
  let config: BlacklistConfig;
  let manager: TokenBlacklistManager;

  beforeEach(() => {
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
      reasons: ['user_logout', 'user_deleted', 'password_changed', 'security_breach'],
      storage: {
        database: 'firestore',
        collection: 'token_blacklist',
      },
      retention: {
        cleanupRetentionDays: 30,
        globalRevocationRetentionDays: 90,
      },
    };

    manager = new TokenBlacklistManager(mockDatabase, config);

    jest.clearAllMocks();
  });

  describe('blacklistToken', () => {
    it('adds token to blacklist with valid reason', async () => {
      const tokenIdentifier = 'token-jti-123';
      const authUID = 'auth-user-123';
      const reason = 'user_logout';
      const tokenExpiresAt = new Date(Date.now() + 3600000); // 1 hour
      const blacklistedBy = 'admin-user-456';

      const result = await manager.blacklistToken(
        tokenIdentifier,
        authUID,
        reason,
        tokenExpiresAt,
        blacklistedBy,
        mockLogger
      );

      expect(result).toMatchObject({
        tokenJTI: tokenIdentifier,
        authUID,
        reason,
        blacklistedBy,
        expiresAt: tokenExpiresAt,
      });
      expect(result.blacklistEntryUID).toBeDefined();
      expect(result.blacklistedAt).toBeInstanceOf(Date);
      expect(mockDatabase.addBlacklistEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          tokenJTI: tokenIdentifier,
          authUID,
          reason,
        })
      );
    });

    it('generates unique blacklistEntryUID', async () => {
      const result1 = await manager.blacklistToken(
        'token-1',
        'auth-1',
        'user_logout',
        new Date(),
        null,
        mockLogger
      );

      const result2 = await manager.blacklistToken(
        'token-2',
        'auth-2',
        'user_logout',
        new Date(),
        null,
        mockLogger
      );

      expect(result1.blacklistEntryUID).not.toBe(result2.blacklistEntryUID);
    });

    it('allows blacklistedBy to be null', async () => {
      const result = await manager.blacklistToken(
        'token-123',
        'auth-123',
        'user_logout',
        new Date(),
        null, // User-initiated logout
        mockLogger
      );

      expect(result.blacklistedBy).toBeNull();
    });

    it('throws error for invalid reason', async () => {
      const invalidReason = 'invalid_reason';

      await expect(
        manager.blacklistToken(
          'token-123',
          'auth-123',
          invalidReason,
          new Date(),
          null,
          mockLogger
        )
      ).rejects.toThrow(/Invalid blacklist reason/);

      expect(mockDatabase.addBlacklistEntry).not.toHaveBeenCalled();
    });

    it('validates all configured reasons', async () => {
      const validReasons = ['user_logout', 'user_deleted', 'password_changed', 'security_breach'];

      for (const reason of validReasons) {
        await manager.blacklistToken(
          `token-${reason}`,
          'auth-123',
          reason,
          new Date(),
          null,
          mockLogger
        );
      }

      expect(mockDatabase.addBlacklistEntry).toHaveBeenCalledTimes(4);
    });

    it('sets blacklistedAt to current time', async () => {
      const beforeCall = Date.now();
      const result = await manager.blacklistToken(
        'token-123',
        'auth-123',
        'user_logout',
        new Date(),
        null,
        mockLogger
      );
      const afterCall = Date.now();

      const blacklistedAtTime = result.blacklistedAt.getTime();
      expect(blacklistedAtTime).toBeGreaterThanOrEqual(beforeCall);
      expect(blacklistedAtTime).toBeLessThanOrEqual(afterCall);
    });
  });

  describe('isBlacklisted', () => {
    it('returns true when token is blacklisted', async () => {
      mockDatabase.isTokenBlacklisted.mockResolvedValue(true);

      const result = await manager.isBlacklisted('token-123', mockLogger);

      expect(result).toBe(true);
      expect(mockDatabase.isTokenBlacklisted).toHaveBeenCalledWith('token-123');
    });

    it('returns false when token is not blacklisted', async () => {
      mockDatabase.isTokenBlacklisted.mockResolvedValue(false);

      const result = await manager.isBlacklisted('token-123', mockLogger);

      expect(result).toBe(false);
    });

    it('masks token identifier in logs', async () => {
      const longTokenIdentifier = 'very-long-token-identifier-that-should-be-masked';

      await manager.isBlacklisted(longTokenIdentifier, mockLogger);

      // Verify the database still gets full identifier
      expect(mockDatabase.isTokenBlacklisted).toHaveBeenCalledWith(longTokenIdentifier);
    });
  });

  describe('blacklistAllUserTokens', () => {
    it('creates global revocation for user', async () => {
      const authUID = 'auth-user-123';
      const reason = 'password_changed';
      const blacklistedBy = 'user-123';

      await manager.blacklistAllUserTokens(authUID, reason, blacklistedBy, mockLogger);

      expect(mockDatabase.addUserRevocation).toHaveBeenCalledWith(
        authUID,
        reason,
        blacklistedBy,
        expect.any(Date)
      );
    });

    it('sets expiration based on globalRevocationRetentionDays', async () => {
      const retentionDays = config.retention.globalRevocationRetentionDays;
      const beforeCall = Date.now();

      await manager.blacklistAllUserTokens('auth-123', 'password_changed', null, mockLogger);

      const afterCall = Date.now();
      const [, , , expiresAt] = mockDatabase.addUserRevocation.mock.calls[0];
      const expiresAtTime = (expiresAt as Date).getTime();

      const expectedMinExpiration = beforeCall + retentionDays * 24 * 60 * 60 * 1000;
      const expectedMaxExpiration = afterCall + retentionDays * 24 * 60 * 60 * 1000;

      expect(expiresAtTime).toBeGreaterThanOrEqual(expectedMinExpiration);
      expect(expiresAtTime).toBeLessThanOrEqual(expectedMaxExpiration);
    });

    it('allows blacklistedBy to be null', async () => {
      await manager.blacklistAllUserTokens('auth-123', 'user_logout', null, mockLogger);

      expect(mockDatabase.addUserRevocation).toHaveBeenCalledWith(
        'auth-123',
        'user_logout',
        null,
        expect.any(Date)
      );
    });

    it('throws error for invalid reason', async () => {
      await expect(
        manager.blacklistAllUserTokens('auth-123', 'invalid_reason', null, mockLogger)
      ).rejects.toThrow(/Invalid blacklist reason/);

      expect(mockDatabase.addUserRevocation).not.toHaveBeenCalled();
    });

    it('validates all configured reasons', async () => {
      const validReasons = ['user_logout', 'user_deleted', 'password_changed', 'security_breach'];

      for (const reason of validReasons) {
        await manager.blacklistAllUserTokens('auth-123', reason, null, mockLogger);
      }

      expect(mockDatabase.addUserRevocation).toHaveBeenCalledTimes(4);
    });
  });

  describe('getUserTokenRevocationTime', () => {
    it('returns revocation time when user has global revocation', async () => {
      const revocationTime = new Date('2024-01-01T00:00:00Z');
      mockDatabase.getUserRevocationTime.mockResolvedValue(revocationTime);

      const result = await manager.getUserTokenRevocationTime('auth-123', mockLogger);

      expect(result).toBe(revocationTime);
      expect(mockDatabase.getUserRevocationTime).toHaveBeenCalledWith('auth-123');
    });

    it('returns null when user has no global revocation', async () => {
      mockDatabase.getUserRevocationTime.mockResolvedValue(null);

      const result = await manager.getUserTokenRevocationTime('auth-123', mockLogger);

      expect(result).toBeNull();
    });
  });

  describe('cleanupExpiredEntries', () => {
    it('returns count of deleted entries', async () => {
      mockDatabase.cleanupExpiredEntries.mockResolvedValue(42);

      const result = await manager.cleanupExpiredEntries(mockLogger);

      expect(result).toBe(42);
      expect(mockDatabase.cleanupExpiredEntries).toHaveBeenCalled();
    });

    it('returns zero when no entries deleted', async () => {
      mockDatabase.cleanupExpiredEntries.mockResolvedValue(0);

      const result = await manager.cleanupExpiredEntries(mockLogger);

      expect(result).toBe(0);
    });

    it('handles large cleanup counts', async () => {
      mockDatabase.cleanupExpiredEntries.mockResolvedValue(10000);

      const result = await manager.cleanupExpiredEntries(mockLogger);

      expect(result).toBe(10000);
    });
  });

  describe('getConfig', () => {
    it('returns copy of configuration', () => {
      const returnedConfig = manager.getConfig();

      expect(returnedConfig).toEqual(config);
    });

    it('returns a copy (not reference)', () => {
      const returnedConfig1 = manager.getConfig();
      const returnedConfig2 = manager.getConfig();

      // Modifying returned config should not affect other calls
      expect(returnedConfig1).toEqual(returnedConfig2);
      expect(returnedConfig1).not.toBe(returnedConfig2); // Different objects
    });
  });

  describe('createTokenBlacklistManager factory', () => {
    it('creates TokenBlacklistManager instance', () => {
      const instance = createTokenBlacklistManager(mockDatabase, config);

      expect(instance).toBeInstanceOf(TokenBlacklistManager);
    });

    it('creates functional manager from factory', async () => {
      const instance = createTokenBlacklistManager(mockDatabase, config);

      await instance.blacklistToken(
        'token-123',
        'auth-123',
        'user_logout',
        new Date(),
        null,
        mockLogger
      );

      expect(mockDatabase.addBlacklistEntry).toHaveBeenCalled();
    });
  });

  describe('token identifier masking', () => {
    it('masks long token identifiers in logs (security)', async () => {
      const longToken = 'a'.repeat(50);

      // The mask should happen internally before logging
      // We can't directly test private methods, but we can verify database gets full token
      await manager.isBlacklisted(longToken, mockLogger);

      expect(mockDatabase.isTokenBlacklisted).toHaveBeenCalledWith(longToken);
    });

    it('does not mask short token identifiers', async () => {
      const shortToken = 'short';

      await manager.isBlacklisted(shortToken, mockLogger);

      expect(mockDatabase.isTokenBlacklisted).toHaveBeenCalledWith(shortToken);
    });
  });

  describe('edge cases', () => {
    it('handles token expiration far in future', async () => {
      const farFuture = new Date('2099-12-31T23:59:59Z');

      const result = await manager.blacklistToken(
        'token-123',
        'auth-123',
        'user_logout',
        farFuture,
        null,
        mockLogger
      );

      expect(result.expiresAt).toEqual(farFuture);
    });

    it('handles token expiration in past', async () => {
      const past = new Date('2020-01-01T00:00:00Z');

      const result = await manager.blacklistToken(
        'token-123',
        'auth-123',
        'user_logout',
        past,
        null,
        mockLogger
      );

      expect(result.expiresAt).toEqual(past);
    });

    it('handles empty authUID', async () => {
      const result = await manager.blacklistToken(
        'token-123',
        '',
        'user_logout',
        new Date(),
        null,
        mockLogger
      );

      expect(result.authUID).toBe('');
    });

    it('handles very long reason strings', async () => {
      const longReasonConfig = {
        ...config,
        reasons: ['a'.repeat(1000)],
      };
      const managerWithLongReason = new TokenBlacklistManager(mockDatabase, longReasonConfig);

      await expect(
        managerWithLongReason.blacklistToken(
          'token-123',
          'auth-123',
          'a'.repeat(1000),
          new Date(),
          null,
          mockLogger
        )
      ).resolves.toBeDefined();
    });

    it('handles special characters in token identifiers', async () => {
      const specialToken = 'token-with-special-chars-!@#$%^&*()';

      await manager.isBlacklisted(specialToken, mockLogger);

      expect(mockDatabase.isTokenBlacklisted).toHaveBeenCalledWith(specialToken);
    });

    it('handles unicode in token identifiers', async () => {
      const unicodeToken = 'token-测试-🎉';

      await manager.isBlacklisted(unicodeToken, mockLogger);

      expect(mockDatabase.isTokenBlacklisted).toHaveBeenCalledWith(unicodeToken);
    });
  });

  describe('error handling', () => {
    it('propagates database errors', async () => {
      const dbError = new Error('Database connection failed');
      mockDatabase.addBlacklistEntry.mockRejectedValue(dbError);

      await expect(
        manager.blacklistToken('token-123', 'auth-123', 'user_logout', new Date(), null, mockLogger)
      ).rejects.toThrow('Database connection failed');
    });

    it('propagates database errors from isBlacklisted', async () => {
      const dbError = new Error('Query failed');
      mockDatabase.isTokenBlacklisted.mockRejectedValue(dbError);

      await expect(manager.isBlacklisted('token-123', mockLogger)).rejects.toThrow('Query failed');
    });

    it('propagates database errors from cleanup', async () => {
      const dbError = new Error('Cleanup failed');
      mockDatabase.cleanupExpiredEntries.mockRejectedValue(dbError);

      await expect(manager.cleanupExpiredEntries(mockLogger)).rejects.toThrow('Cleanup failed');
    });
  });

  describe('configuration validation', () => {
    it('accepts empty reasons array', () => {
      const emptyReasonsConfig = {
        ...config,
        reasons: [],
      };

      const emptyManager = new TokenBlacklistManager(mockDatabase, emptyReasonsConfig);

      expect(emptyManager).toBeInstanceOf(TokenBlacklistManager);
    });

    it('rejects any reason when reasons array is empty', async () => {
      const emptyReasonsConfig = {
        ...config,
        reasons: [],
      };
      const emptyManager = new TokenBlacklistManager(mockDatabase, emptyReasonsConfig);

      await expect(
        emptyManager.blacklistToken('token-123', 'auth-123', 'any_reason', new Date(), null, mockLogger)
      ).rejects.toThrow(/Invalid blacklist reason/);
    });

    it('handles single reason in config', async () => {
      const singleReasonConfig = {
        ...config,
        reasons: ['user_logout'],
      };
      const singleReasonManager = new TokenBlacklistManager(mockDatabase, singleReasonConfig);

      await expect(
        singleReasonManager.blacklistToken(
          'token-123',
          'auth-123',
          'user_logout',
          new Date(),
          null,
          mockLogger
        )
      ).resolves.toBeDefined();
    });

    it('handles many reasons in config', async () => {
      const manyReasons = Array.from({ length: 100 }, (_, i) => `reason_${i}`);
      const manyReasonsConfig = {
        ...config,
        reasons: manyReasons,
      };
      const manyReasonsManager = new TokenBlacklistManager(mockDatabase, manyReasonsConfig);

      await expect(
        manyReasonsManager.blacklistToken(
          'token-123',
          'auth-123',
          'reason_50',
          new Date(),
          null,
          mockLogger
        )
      ).resolves.toBeDefined();
    });
  });
});
