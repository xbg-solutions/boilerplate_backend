/**
 * Structured Logger with Correlation IDs
 * 
 * Integrates with Firebase Functions logging (GCP Cloud Logging)
 * Never logs PII in plaintext - sanitizes metadata
 */

import { logger as gcpLogger } from 'firebase-functions';
import { LogLevel, LogContext } from './logger-types';

export { LogLevel } from './logger-types';

/**
 * Sensitive field names that should never be logged
 */
const SENSITIVE_FIELDS = [
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

export class Logger {
  constructor(
    private readonly correlationId: string,
    private readonly context: LogContext = {}
  ) {}

  /**
   * Sanitize metadata to remove sensitive fields
   */
  private sanitizeMetadata(meta: LogContext): LogContext {
    const sanitized: LogContext = {};

    for (const [key, value] of Object.entries(meta)) {
      // Check if field name is sensitive
      const lowerKey = key.toLowerCase();
      const isSensitive = SENSITIVE_FIELDS.some((field) =>
        lowerKey.includes(field.toLowerCase())
      );

      if (isSensitive) {
        sanitized[key] = '[REDACTED]';
      } else if (value && typeof value === 'object' && !Array.isArray(value)) {
        // Recursively sanitize nested objects
        sanitized[key] = this.sanitizeMetadata(value as LogContext);
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }

  /**
   * Build log data structure
   */
  private buildLogData(
    level: LogLevel,
    message: string,
    meta: LogContext = {}
  ): LogContext {
    const sanitizedMeta = this.sanitizeMetadata(meta);

    return {
      correlationId: this.correlationId,
      timestamp: new Date().toISOString(),
      level,
      message,
      context: this.context,
      ...sanitizedMeta,
    };
  }

  /**
   * Log debug message (development only)
   */
  debug(message: string, meta: LogContext = {}): void {
    if (process.env.LOG_LEVEL === 'debug' || process.env.NODE_ENV === 'development') {
      const logData = this.buildLogData(LogLevel.DEBUG, message, meta);
      gcpLogger.debug(logData);
    }
  }

  /**
   * Log info message
   */
  info(message: string, meta: LogContext = {}): void {
    const logData = this.buildLogData(LogLevel.INFO, message, meta);
    gcpLogger.info(logData);
  }

  /**
   * Log warning message
   */
  warn(message: string, meta: LogContext = {}): void {
    const logData = this.buildLogData(LogLevel.WARN, message, meta);
    gcpLogger.warn(logData);
  }

  /**
   * Log error message with error object
   */
  error(message: string, error: Error, meta: LogContext = {}): void {
    const logData = this.buildLogData(LogLevel.ERROR, message, {
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack,
      },
      ...meta,
    });
    gcpLogger.error(logData);
  }

  /**
   * Create child logger with additional context
   */
  child(additionalContext: LogContext): Logger {
    return new Logger(this.correlationId, {
      ...this.context,
      ...additionalContext,
    });
  }
}