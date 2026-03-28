/**
 * Repository Factory
 *
 * Creates scoped repository instances and transaction managers.
 * Consuming projects use this to wire up subcollection access without
 * importing Firestore directly in service code.
 *
 * Usage:
 *   const factory = new RepositoryFactory({ default: db });
 *   const memberRepo = factory.createScopedRepository(
 *     'default',
 *     ['projects', projectId, 'projectMembers'],
 *     (id, data) => ProjectMember.fromFirestore(id, data)
 *   );
 */

import { Firestore } from 'firebase-admin/firestore';
import { IScopedRepository, ITransactionManager } from '../types/repository';
import { FirestoreScopedRepository, FirestoreTransactionManager } from './FirestoreScopedRepository';

export class RepositoryFactory {
  private databases: Record<string, Firestore>;

  constructor(databases: Record<string, Firestore>) {
    this.databases = databases;
  }

  /**
   * Create a scoped repository for a subcollection path.
   *
   * @param databaseName Key into the databases map (e.g. 'default')
   * @param pathSegments Odd-length array: [collection, docId, ..., collection]
   * @param entityFactory Converts a Firestore doc (id + data) into a domain entity
   */
  createScopedRepository<T>(
    databaseName: string,
    pathSegments: readonly string[],
    entityFactory: (id: string, data: Record<string, any>) => T
  ): IScopedRepository<T> {
    const db = this.getDatabase(databaseName);
    return new FirestoreScopedRepository<T>(db, pathSegments, entityFactory);
  }

  /**
   * Create a transaction manager for a specific database.
   */
  createTransactionManager(databaseName: string): ITransactionManager {
    const db = this.getDatabase(databaseName);
    return new FirestoreTransactionManager(db);
  }

  private getDatabase(name: string): Firestore {
    const db = this.databases[name];
    if (!db) {
      throw new Error(
        `Database "${name}" not found in RepositoryFactory. Available: [${Object.keys(this.databases).join(', ')}]`
      );
    }
    return db;
  }
}
