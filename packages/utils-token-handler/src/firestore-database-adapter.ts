/**
 * Firestore Database Adapter
 * Implements ITokenDatabase for Firestore operations
 */

import * as admin from 'firebase-admin';
import { Firestore } from 'firebase-admin/firestore';
import {
  ITokenDatabase,
  TokenBlacklistEntry
} from './token-types';

export class FirestoreTokenDatabase implements ITokenDatabase {
  private collection: admin.firestore.CollectionReference;

  constructor(
    private db: Firestore,
    private collectionName: string
  ) {
    this.collection = this.db.collection(this.collectionName);
  }

  /**
   * Add entry to blacklist
   */
  async addBlacklistEntry(entry: TokenBlacklistEntry): Promise<void> {
    await this.collection.doc(entry.blacklistEntryUID).set({
      ...entry,
      // Ensure dates are Firestore timestamps
      blacklistedAt: entry.blacklistedAt,
      expiresAt: entry.expiresAt
    });
  }

  /**
   * Check if token identifier is blacklisted
   */
  async isTokenBlacklisted(tokenIdentifier: string): Promise<boolean> {
    const snapshot = await this.collection
      .where('tokenJTI', '==', tokenIdentifier)
      .limit(1)
      .get();

    return !snapshot.empty;
  }

  /**
   * Get user's global token revocation timestamp
   */
  async getUserRevocationTime(authUID: string): Promise<Date | null> {
    const snapshot = await this.collection
      .where('tokenJTI', '==', `ALL_TOKENS_${authUID}`)
      .orderBy('blacklistedAt', 'desc')
      .limit(1)
      .get();

    if (snapshot.empty) {
      return null;
    }

    const entry = snapshot.docs[0].data() as TokenBlacklistEntry;
    
    // Handle both Firestore Timestamp and Date objects
    const blacklistedAt = entry.blacklistedAt;
    if (blacklistedAt instanceof Date) {
      return blacklistedAt;
    } else if (blacklistedAt && typeof blacklistedAt === 'object' && 'toDate' in blacklistedAt) {
      // Firestore Timestamp
      return (blacklistedAt as any).toDate();
    }
    
    return null;
  }

  /**
   * Add global revocation entry for user
   */
  async addUserRevocation(
    authUID: string,
    reason: string,
    blacklistedBy: string | null,
    expiresAt: Date
  ): Promise<void> {
    const entry: TokenBlacklistEntry = {
      blacklistEntryUID: `revocation_${authUID}_${Date.now()}`,
      tokenJTI: `ALL_TOKENS_${authUID}`,
      authUID,
      blacklistedAt: new Date(),
      blacklistedBy,
      reason,
      expiresAt
    };

    await this.addBlacklistEntry(entry);
  }

  /**
   * Remove expired blacklist entries
   */
  async cleanupExpiredEntries(): Promise<number> {
    const now = new Date();
    const snapshot = await this.collection
      .where('expiresAt', '<=', now)
      .get();

    if (snapshot.empty) {
      return 0;
    }

    // Batch delete for efficiency
    const batch = this.db.batch();
    snapshot.docs.forEach((doc: any) => {
      batch.delete(doc.ref);
    });

    await batch.commit();
    return snapshot.size;
  }

  /**
   * Get collection reference for advanced operations
   */
  getCollection(): admin.firestore.CollectionReference {
    return this.collection;
  }

  /**
   * Health check - verify database connectivity
   */
  async healthCheck(): Promise<boolean> {
    try {
      // Simple read operation to test connectivity
      await this.collection.limit(1).get();
      return true;
    } catch (error) {
      return false;
    }
  }
}

/**
 * Factory function to create Firestore database adapter
 */
export function createFirestoreTokenDatabase(
  db: Firestore,
  collectionName: string
): FirestoreTokenDatabase {
  return new FirestoreTokenDatabase(db, collectionName);
}