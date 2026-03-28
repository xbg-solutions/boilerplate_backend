/**
 * User Repository
 * Generated from data model specification
 */

import { Firestore, DocumentData } from 'firebase-admin/firestore';
import { BaseRepository } from '@xbg.solutions/backend-core';
import { User } from '../entities/User';

export class UserRepository extends BaseRepository<User> {
  protected collectionName = 'users';

  constructor(db: Firestore) {
    super(db);
  }

  /**
   * Convert Firestore document to entity
   */
  protected fromFirestore(id: string, data: DocumentData): User {
    return User.fromFirestore(id, data);
  }

  /**
   * Find User by email
   */
  async findByEmail(email: string): Promise<User | null> {
    const snapshot = await this.getCollection()
      .where('email', '==', email)
      .where('deletedAt', '==', null)
      .limit(1)
      .get();

    if (snapshot.empty) {
      return null;
    }

    const doc = snapshot.docs[0];
    return this.fromFirestore(doc.id, doc.data());
  }

  /**
   * Get posts for User
   */
  async getPosts(userId: string): Promise<Post[]> {
    // Implementation depends on relationship type
    // TODO: Implement relationship query
    return [];
  }
}
