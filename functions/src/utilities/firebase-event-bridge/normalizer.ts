// src/utilities/firebase-event-bridge/normalizer.ts

import { Logger } from '../logger';
import { BaseEventPayload } from '../events/event-types';

/**
 * Normalized event structure for internal event bus
 * Extends BaseEventPayload for type compatibility with event bus
 */
export interface NormalizedFirebaseEvent extends BaseEventPayload {
  // Standard metadata
  eventId: string;
  eventName: string;                   // 'firestore.users.created'
  timestamp: Date;
  source: 'firestore' | 'auth' | 'storage';
  
  // Normalized fields (extracted for convenience)
  normalized: {
    databaseName?: string;             // For Firestore
    documentId?: string;               // For Firestore
    documentPath?: string;             // For Firestore
    collection?: string;               // For Firestore
    userId?: string;                   // For Auth
    filePath?: string;                 // For Storage
    operation?: string;                // 'create', 'update', 'delete'
  };
  
  // Raw Firebase payload (complete, untouched)
  // ⚠️ NEVER LOG THIS - may contain PII even if hashed
  raw: any;
  
  // For updates: before/after comparison
  // ⚠️ NEVER LOG THIS - may contain PII even if hashed
  changes?: {
    before: any;
    after: any;
  };
  
  // Allow additional string-indexed properties for BaseEventPayload compatibility
  [key: string]: any;
}

/**
 * Normalize Firestore event to standard format
 * 
 * ⚠️ LOGGING SAFETY: Only logs metadata, never document data
 */
export function normalizeFirestoreEvent(
  operation: string,
  documentPath: string,
  documentId: string,
  databaseName: string,
  collectionName: string,
  data: any,
  logger: Logger,
  eventNameOverride?: string,
  changes?: { before: any; after: any }
): NormalizedFirebaseEvent {
  const collection = eventNameOverride || collectionName;
  const eventName = `firestore.${collection}.${operation}`;
  
  // ✅ Safe logging - only metadata
  logger.debug('Normalizing Firestore event', {
    eventName,
    documentId,
    databaseName,
    collection: collectionName,
    operation,
    hasChanges: !!changes,
    hasEventNameOverride: !!eventNameOverride
    // ❌ NEVER LOG: data, changes, raw document content
  });
  
  return {
    eventId: `${eventName}-${documentId}-${Date.now()}`,
    eventName,
    timestamp: new Date(),
    source: 'firestore',
    normalized: {
      databaseName,
      documentId,
      documentPath,
      collection: collectionName,
      operation
    },
    raw: data,  // Not logged, just passed through to event bus
    changes     // Not logged, just passed through to event bus
  };
}

/**
 * Normalize Auth event to standard format
 * 
 * ⚠️ LOGGING SAFETY: Only logs metadata, never user data
 */
export function normalizeAuthEvent(
  operation: string,
  userId: string,
  userData: any,
  logger: Logger
): NormalizedFirebaseEvent {
  const eventName = `auth.user.${operation}`;
  
  // ✅ Safe logging - only metadata
  logger.debug('Normalizing Auth event', {
    eventName,
    userId,
    operation
    // ❌ NEVER LOG: userData, email, phone, etc.
  });
  
  return {
    eventId: `${eventName}-${userId}-${Date.now()}`,
    eventName,
    timestamp: new Date(),
    source: 'auth',
    normalized: {
      userId,
      operation
    },
    raw: userData  // Not logged, just passed through
  };
}

/**
 * Normalize Storage event to standard format
 * 
 * ⚠️ LOGGING SAFETY: Only logs file path, never metadata content
 */
export function normalizeStorageEvent(
  filePath: string,
  metadata: any,
  logger: Logger
): NormalizedFirebaseEvent {
  const eventName = 'storage.object.finalized';
  
  // ✅ Safe logging - only file path
  logger.debug('Normalizing Storage event', {
    eventName,
    filePath,
    hasMetadata: !!metadata
    // ❌ NEVER LOG: metadata content (may contain user info)
  });
  
  return {
    eventId: `${eventName}-${Date.now()}`,
    eventName,
    timestamp: new Date(),
    source: 'storage',
    normalized: {
      filePath,
      operation: 'upload'
    },
    raw: metadata  // Not logged, just passed through
  };
}

/**
 * Extract collection name from document path
 * Examples:
 *   'users/{userUID}' -> 'users'
 *   'items/{itemUID}/images/{imageUID}' -> 'images'
 */
export function extractCollectionName(path: string): string {
  const parts = path.split('/');
  // Get last non-parameter part
  for (let i = parts.length - 1; i >= 0; i--) {
    if (!parts[i].startsWith('{')) {
      return parts[i];
    }
  }
  return parts[0];
}