/**
 * Logger - Unit Tests
 *
 * Testing WHAT the logger does, not HOW it works internally:
 * - Sanitizes sensitive fields from logs (PII protection)
 * - Provides structured logging with correlation IDs
 * - Supports different log levels
 * - Creates child loggers with additional context
 */

import { Logger, LogLevel } from '../logger';
import { logger as gcpLogger } from 'firebase-functions';

// Mock firebase-functions logger
jest.mock('firebase-functions', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe('Logger', () => {
  const originalEnv = process.env;
  let testLogger: Logger;

  beforeEach(() => {
    process.env = { ...originalEnv };
    testLogger = new Logger('test-correlation-id');
    jest.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('constructor', () => {
    it('creates logger with correlation ID', () => {
      const logger = new Logger('correlation-123');
      expect(logger).toBeInstanceOf(Logger);
    });

    it('creates logger with correlation ID and context', () => {
      const context = { operation: 'test-operation' };
      const logger = new Logger('correlation-123', context);
      expect(logger).toBeInstanceOf(Logger);
    });
  });

  describe('debug', () => {
    it('logs debug message when LOG_LEVEL is debug', () => {
      process.env.LOG_LEVEL = 'debug';
      testLogger.debug('Debug message', { detail: 'test' });

      expect(gcpLogger.debug).toHaveBeenCalledWith(
        expect.objectContaining({
          correlationId: 'test-correlation-id',
          level: LogLevel.DEBUG,
          message: 'Debug message',
          detail: 'test',
        })
      );
    });

    it('logs debug message when NODE_ENV is development', () => {
      process.env.NODE_ENV = 'development';
      testLogger.debug('Debug message');

      expect(gcpLogger.debug).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Debug message',
          level: LogLevel.DEBUG,
        })
      );
    });

    it('does not log debug message in production without debug level', () => {
      process.env.NODE_ENV = 'production';
      delete process.env.LOG_LEVEL;

      testLogger.debug('Debug message');

      expect(gcpLogger.debug).not.toHaveBeenCalled();
    });

    it('includes timestamp in debug log', () => {
      process.env.LOG_LEVEL = 'debug';
      testLogger.debug('Debug message');

      expect(gcpLogger.debug).toHaveBeenCalledWith(
        expect.objectContaining({
          timestamp: expect.any(String),
        })
      );
    });
  });

  describe('info', () => {
    it('logs info message', () => {
      testLogger.info('Info message');

      expect(gcpLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          correlationId: 'test-correlation-id',
          level: LogLevel.INFO,
          message: 'Info message',
        })
      );
    });

    it('logs info message with metadata', () => {
      testLogger.info('Info message', { userId: 'user-123', count: 5 });

      expect(gcpLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Info message',
          userId: 'user-123',
          count: 5,
        })
      );
    });

    it('includes timestamp in info log', () => {
      testLogger.info('Info message');

      expect(gcpLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          timestamp: expect.any(String),
        })
      );
    });
  });

  describe('warn', () => {
    it('logs warning message', () => {
      testLogger.warn('Warning message');

      expect(gcpLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          correlationId: 'test-correlation-id',
          level: LogLevel.WARN,
          message: 'Warning message',
        })
      );
    });

    it('logs warning message with metadata', () => {
      testLogger.warn('Warning message', { reason: 'Rate limit exceeded' });

      expect(gcpLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Warning message',
          reason: 'Rate limit exceeded',
        })
      );
    });

    it('includes timestamp in warn log', () => {
      testLogger.warn('Warning message');

      expect(gcpLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          timestamp: expect.any(String),
        })
      );
    });
  });

  describe('error', () => {
    it('logs error message with error object', () => {
      const error = new Error('Test error');
      testLogger.error('Error occurred', error);

      expect(gcpLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          correlationId: 'test-correlation-id',
          level: LogLevel.ERROR,
          message: 'Error occurred',
          error: {
            name: 'Error',
            message: 'Test error',
            stack: expect.any(String),
          },
        })
      );
    });

    it('logs error with additional metadata', () => {
      const error = new Error('Database error');
      testLogger.error('Query failed', error, { query: 'SELECT * FROM users' });

      expect(gcpLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Query failed',
          query: 'SELECT * FROM users',
          error: expect.objectContaining({
            message: 'Database error',
          }),
        })
      );
    });

    it('includes error stack trace', () => {
      const error = new Error('Test error');
      testLogger.error('Error occurred', error);

      expect(gcpLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            stack: expect.stringContaining('Error: Test error'),
          }),
        })
      );
    });

    it('includes timestamp in error log', () => {
      const error = new Error('Test error');
      testLogger.error('Error occurred', error);

      expect(gcpLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          timestamp: expect.any(String),
        })
      );
    });
  });

  describe('PII sanitization', () => {
    describe('redacts sensitive field names', () => {
      const sensitiveFields = [
        'password',
        'token',
        'secret',
        'key',
        'apiKey',
        'api_key',
        'accessToken',
        'access_token',
        'refreshToken',
        'refresh_token',
        'email',
        'phoneNumber',
        'phone',
        'address',
        'addressLine1',
        'addressLine2',
        'city',
        'state',
        'postalCode',
        'postal_code',
        'ssn',
        'creditCard',
        'credit_card',
        'cardNumber',
        'card_number',
        'cvv',
        'authorization',
      ];

      sensitiveFields.forEach((fieldName) => {
        it(`redacts ${fieldName}`, () => {
          testLogger.info('Test message', { [fieldName]: 'sensitive-value' });

          expect(gcpLogger.info).toHaveBeenCalledWith(
            expect.objectContaining({
              [fieldName]: '[REDACTED]',
            })
          );
        });
      });
    });

    it('redacts fields with partial matches (case-insensitive)', () => {
      testLogger.info('Test message', {
        userPassword: 'secret123',
        apiKeyValue: 'key-123',
        emailAddress: 'test@example.com',
      });

      expect(gcpLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          userPassword: '[REDACTED]',
          apiKeyValue: '[REDACTED]',
          emailAddress: '[REDACTED]',
        })
      );
    });

    it('redacts sensitive fields in nested objects', () => {
      testLogger.info('Test message', {
        user: {
          email: 'test@example.com',
          phoneNumber: '+61412345678',
          name: 'John Doe',
        },
      });

      expect(gcpLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          user: {
            email: '[REDACTED]',
            phoneNumber: '[REDACTED]',
            name: 'John Doe',
          },
        })
      );
    });

    it('preserves non-sensitive fields', () => {
      testLogger.info('Test message', {
        userId: 'user-123',
        accountUID: 'account-456',
        operation: 'create-user',
        count: 42,
      });

      expect(gcpLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-123',
          accountUID: 'account-456',
          operation: 'create-user',
          count: 42,
        })
      );
    });

    it('handles mixed sensitive and non-sensitive fields', () => {
      testLogger.info('Test message', {
        userId: 'user-123',
        email: 'test@example.com',
        operation: 'login',
        password: 'secret123',
      });

      expect(gcpLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-123',
          email: '[REDACTED]',
          operation: 'login',
          password: '[REDACTED]',
        })
      );
    });

    it('does not redact arrays', () => {
      testLogger.info('Test message', {
        items: ['item1', 'item2', 'item3'],
      });

      expect(gcpLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          items: ['item1', 'item2', 'item3'],
        })
      );
    });

    it('handles null values in metadata', () => {
      testLogger.info('Test message', {
        email: null,
        password: null,
      });

      expect(gcpLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          email: '[REDACTED]',
          password: '[REDACTED]',
        })
      );
    });
  });

  describe('child logger', () => {
    it('creates child logger with additional context', () => {
      const childLogger = testLogger.child({ operation: 'test-operation' });

      childLogger.info('Child message');

      expect(gcpLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          correlationId: 'test-correlation-id',
          context: { operation: 'test-operation' },
        })
      );
    });

    it('merges parent and child context', () => {
      const parentLogger = new Logger('correlation-123', { userId: 'user-123' });
      const childLogger = parentLogger.child({ operation: 'create-item' });

      childLogger.info('Child message');

      expect(gcpLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          context: {
            userId: 'user-123',
            operation: 'create-item',
          },
        })
      );
    });

    it('child context overrides parent context for same keys', () => {
      const parentLogger = new Logger('correlation-123', { operation: 'parent-op' });
      const childLogger = parentLogger.child({ operation: 'child-op' });

      childLogger.info('Child message');

      expect(gcpLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          context: {
            operation: 'child-op',
          },
        })
      );
    });

    it('child logger inherits correlation ID', () => {
      const parentLogger = new Logger('parent-correlation-id');
      const childLogger = parentLogger.child({ extra: 'context' });

      childLogger.info('Child message');

      expect(gcpLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          correlationId: 'parent-correlation-id',
        })
      );
    });

    it('child logger sanitizes sensitive fields', () => {
      const childLogger = testLogger.child({ operation: 'test' });

      childLogger.info('Message', { password: 'secret' });

      expect(gcpLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          password: '[REDACTED]',
        })
      );
    });

    it('can create nested child loggers', () => {
      const child1 = testLogger.child({ level1: 'context1' });
      const child2 = child1.child({ level2: 'context2' });
      const child3 = child2.child({ level3: 'context3' });

      child3.info('Nested message');

      expect(gcpLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          context: {
            level1: 'context1',
            level2: 'context2',
            level3: 'context3',
          },
        })
      );
    });
  });

  describe('context handling', () => {
    it('includes context in all log levels', () => {
      const logger = new Logger('correlation-123', { operation: 'test-op' });

      process.env.LOG_LEVEL = 'debug';
      logger.debug('Debug message');
      logger.info('Info message');
      logger.warn('Warn message');
      logger.error('Error message', new Error('test'));

      expect(gcpLogger.debug).toHaveBeenCalledWith(
        expect.objectContaining({ context: { operation: 'test-op' } })
      );
      expect(gcpLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ context: { operation: 'test-op' } })
      );
      expect(gcpLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ context: { operation: 'test-op' } })
      );
      expect(gcpLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ context: { operation: 'test-op' } })
      );
    });

    it('handles empty context', () => {
      const logger = new Logger('correlation-123', {});

      logger.info('Message');

      expect(gcpLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          context: {},
        })
      );
    });
  });

  describe('edge cases', () => {
    it('handles empty message', () => {
      testLogger.info('');

      expect(gcpLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          message: '',
        })
      );
    });

    it('handles empty metadata object', () => {
      testLogger.info('Message', {});

      expect(gcpLogger.info).toHaveBeenCalled();
    });

    it('handles metadata with undefined values', () => {
      testLogger.info('Message', { field: undefined });

      expect(gcpLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          field: undefined,
        })
      );
    });

    it('handles very long messages', () => {
      const longMessage = 'a'.repeat(10000);
      testLogger.info(longMessage);

      expect(gcpLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          message: longMessage,
        })
      );
    });

    it('handles special characters in message', () => {
      const specialMessage = 'Message with "quotes" and \'apostrophes\' and \n newlines';
      testLogger.info(specialMessage);

      expect(gcpLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          message: specialMessage,
        })
      );
    });

    it('handles deeply nested objects in metadata', () => {
      const deepObject = {
        level1: {
          level2: {
            level3: {
              level4: {
                email: 'test@example.com',
              },
            },
          },
        },
      };

      testLogger.info('Message', deepObject);

      // Should sanitize nested email
      expect(gcpLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          level1: {
            level2: {
              level3: {
                level4: {
                  email: '[REDACTED]',
                },
              },
            },
          },
        })
      );
    });
  });
});
