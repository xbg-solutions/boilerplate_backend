/**
 * Base Entity Class
 * All domain entities should extend this class
 * Provides common fields and validation patterns
 */

import { FieldValue, Timestamp } from 'firebase-admin/firestore';

export interface EntityMetadata {
  createdAt: Timestamp;
  updatedAt: Timestamp;
  deletedAt?: Timestamp | null;
  version: number;
}

export interface BaseEntityData {
  id?: string;
  createdAt?: Timestamp | FieldValue;
  updatedAt?: Timestamp | FieldValue;
  deletedAt?: Timestamp | FieldValue | null;
  version?: number;
}

export abstract class BaseEntity {
  id?: string;
  createdAt: Timestamp | FieldValue;
  updatedAt: Timestamp | FieldValue;
  deletedAt?: Timestamp | FieldValue | null;
  version: number;

  constructor(data: BaseEntityData = {}) {
    this.id = data.id;
    this.createdAt = data.createdAt || FieldValue.serverTimestamp();
    this.updatedAt = data.updatedAt || FieldValue.serverTimestamp();
    this.deletedAt = data.deletedAt || null;
    this.version = data.version || 1;
  }

  /**
   * Convert entity to plain object for Firestore
   */
  toFirestore(): Record<string, any> {
    const data: Record<string, any> = {
      ...this.getEntityData(),
      createdAt: this.createdAt,
      updatedAt: FieldValue.serverTimestamp(),
      version: this.version,
    };

    // Only include deletedAt if it's set
    if (this.deletedAt) {
      data.deletedAt = this.deletedAt;
    }

    // Remove undefined values
    Object.keys(data).forEach((key) => {
      if (data[key] === undefined) {
        delete data[key];
      }
    });

    return data;
  }

  /**
   * Get entity-specific data (override in subclasses)
   */
  protected abstract getEntityData(): Record<string, any>;

  /**
   * Create entity from Firestore document
   */
  static fromFirestore<T extends BaseEntity>(
    this: new (data: any) => T,
    id: string,
    data: Record<string, any>
  ): T {
    return new this({
      id,
      ...data,
    });
  }

  /**
   * Mark entity as deleted (soft delete)
   */
  softDelete(): void {
    this.deletedAt = FieldValue.serverTimestamp();
    this.updatedAt = FieldValue.serverTimestamp();
  }

  /**
   * Check if entity is deleted
   */
  isDeleted(): boolean {
    return !!this.deletedAt && this.deletedAt !== null;
  }

  /**
   * Increment version for optimistic locking
   */
  incrementVersion(): void {
    this.version += 1;
    this.updatedAt = FieldValue.serverTimestamp();
  }

  /**
   * Validate entity (override in subclasses)
   */
  abstract validate(): ValidationResult;

  /**
   * Get entity identifier
   */
  getId(): string | undefined {
    return this.id;
  }

  /**
   * Check if entity is new (not persisted)
   */
  isNew(): boolean {
    return !this.id;
  }

  /**
   * Clone entity
   */
  clone(): this {
    const constructor = this.constructor as new (data: any) => this;
    return new constructor({
      ...this.toFirestore(),
      id: this.id,
    });
  }
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

export interface ValidationError {
  field: string;
  message: string;
  code: string;
}

/**
 * Validation helper functions
 */
export class ValidationHelper {
  static createError(field: string, message: string, code: string): ValidationError {
    return { field, message, code };
  }

  static isValidResult(errors: ValidationError[]): ValidationResult {
    return {
      valid: errors.length === 0,
      errors,
    };
  }

  static required(value: any, field: string): ValidationError | null {
    if (value === undefined || value === null || value === '') {
      return this.createError(field, `${field} is required`, 'REQUIRED');
    }
    return null;
  }

  static minLength(value: string, minLen: number, field: string): ValidationError | null {
    if (value && value.length < minLen) {
      return this.createError(
        field,
        `${field} must be at least ${minLen} characters`,
        'MIN_LENGTH'
      );
    }
    return null;
  }

  static maxLength(value: string, maxLen: number, field: string): ValidationError | null {
    if (value && value.length > maxLen) {
      return this.createError(
        field,
        `${field} must be at most ${maxLen} characters`,
        'MAX_LENGTH'
      );
    }
    return null;
  }

  static email(value: string, field: string): ValidationError | null {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (value && !emailRegex.test(value)) {
      return this.createError(field, `${field} must be a valid email`, 'INVALID_EMAIL');
    }
    return null;
  }

  static pattern(value: string, pattern: RegExp, field: string, message?: string): ValidationError | null {
    if (value && !pattern.test(value)) {
      return this.createError(
        field,
        message || `${field} has invalid format`,
        'INVALID_FORMAT'
      );
    }
    return null;
  }

  static range(value: number, min: number, max: number, field: string): ValidationError | null {
    if (value !== undefined && (value < min || value > max)) {
      return this.createError(
        field,
        `${field} must be between ${min} and ${max}`,
        'OUT_OF_RANGE'
      );
    }
    return null;
  }

  static oneOf(value: any, allowedValues: any[], field: string): ValidationError | null {
    if (value !== undefined && !allowedValues.includes(value)) {
      return this.createError(
        field,
        `${field} must be one of: ${allowedValues.join(', ')}`,
        'INVALID_VALUE'
      );
    }
    return null;
  }

  static collectErrors(...errors: (ValidationError | null)[]): ValidationError[] {
    return errors.filter((e): e is ValidationError => e !== null);
  }
}
