/**
 * Logger type definitions
 */

/**
 * Base log context interface
 * Represents metadata that can be attached to log messages
 */
export interface LogContext {
  [key: string]: unknown;
}

/**
 * Common context fields used across the application
 */
export interface BaseLogContext extends LogContext {
  operation?: string;
  userId?: string;
  accountUID?: string;
  listUID?: string;
  itemUID?: string;
  contactUID?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Log level enum (re-export for convenience)
 */
export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
}