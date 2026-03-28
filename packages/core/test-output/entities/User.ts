/**
 * User Entity
 * Generated from data model specification
 */

import { BaseEntity, BaseEntityData, ValidationResult, ValidationHelper } from '@xbg.solutions/backend-core';
import { Timestamp, FieldValue } from 'firebase-admin/firestore';
import { Post } from './Post';

export interface UserData extends BaseEntityData {
  name: string;
  email: string;
  age?: number;
  status: 'active' | 'inactive' | 'pending';
}

export class User extends BaseEntity {
  name: string;
  email: string;
  age?: number;
  status: 'active' | 'inactive' | 'pending';

  constructor(data: UserData) {
    super(data);
    this.name = data.name;
    this.email = data.email;
    this.age = data.age;
    this.status = data.status || 'pending';
  }

  /**
   * Get entity-specific data for Firestore
   */
  protected getEntityData(): Record<string, any> {
    return {
      name: this.name,
      email: this.email,
      age: this.age,
      status: this.status,
    };
  }

  /**
   * Validate entity
   */
  validate(): ValidationResult {
    const errors = ValidationHelper.collectErrors(
      ValidationHelper.required(this.name, 'name'),
      ValidationHelper.minLength(this.name, 3, 'name'),
      ValidationHelper.maxLength(this.name, 100, 'name'),
      ValidationHelper.required(this.email, 'email'),
      ValidationHelper.email(this.email, 'email'),
      ValidationHelper.range(this.age, 0, 150, 'age'),
      ValidationHelper.required(this.status, 'status'),
      ValidationHelper.oneOf(this.status, ['active', 'inactive', 'pending'], 'status'),
    );

    return ValidationHelper.isValidResult(errors);
  }

  /**
   * Create entity from Firestore document
   */
  static fromFirestore(id: string, data: Record<string, any>): User {
    return new User({
      id,
      ...data,
    });
  }

  /**
   * Convert to plain object for API responses
   */
  toJSON(): Record<string, any> {
    return {
      id: this.id,
      name: this.name,
      email: this.email,
      age: this.age,
      status: this.status,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }
}
