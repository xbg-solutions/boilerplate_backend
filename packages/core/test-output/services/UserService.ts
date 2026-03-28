/**
 * User Service
 * Generated from data model specification
 */

import { BaseService, RequestContext } from '@xbg.solutions/backend-core';
import { User, UserData } from '../entities/User';
import { UserRepository } from '../repositories/UserRepository';

export class UserService extends BaseService<User> {
  protected entityName = 'User';

  constructor(repository: UserRepository) {
    super(repository);
  }

  /**
   * Build entity from partial data
   */
  protected async buildEntity(data: Partial<UserData>): Promise<User> {
    return new User(data as UserData);
  }

  /**
   * Merge existing entity with updates
   */
  protected async mergeEntity(existing: User, updates: Partial<UserData>): Promise<User> {
    return new User({
      ...existing.toJSON(),
      ...updates,
      id: existing.id,
    });
  }

  /**
   * Check read access
   */
  protected async checkReadAccess(entity: User, context: RequestContext): Promise<boolean> {
    const allowedRoles = ['admin', 'user', 'self'];

    // Check if user has required role
    if (context.userRole && allowedRoles.includes(context.userRole)) {
      return true;
    }

    // Check if user owns the resource
    if (allowedRoles.includes('self')) {
      // TODO: Implement ownership check based on your entity structure
      return true;
    }

    return false;
  }

  /**
   * Check update access
   */
  protected async checkUpdateAccess(entity: User, context: RequestContext): Promise<boolean> {
    const allowedRoles = ['admin', 'self'];

    if (context.userRole && allowedRoles.includes(context.userRole)) {
      return true;
    }

    if (allowedRoles.includes('self')) {
      // TODO: Implement ownership check
      return true;
    }

    return false;
  }

  /**
   * Check delete access
   */
  protected async checkDeleteAccess(entity: User, context: RequestContext): Promise<boolean> {
    const allowedRoles = ['admin'];

    if (context.userRole && allowedRoles.includes(context.userRole)) {
      return true;
    }

    return false;
  }

  /**
   * Business Rules:
   * - Users must be at least 18 years old to create an account
   * - Email addresses must be unique across the system
   */
}
