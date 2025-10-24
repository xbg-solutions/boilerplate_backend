// src/utilities/firebase-event-bridge/config-types.ts

import { eventBus } from '../events/event-bus';
import { DatabaseName } from '../../config/firestore.config';

/**
 * Main configuration for Firebase Event Bridge
 */
export interface FirebaseEventBridgeConfig {
  eventBus: typeof eventBus;  // Use typeof to get the instance type
  firestore?: FirestoreConfig;
  auth?: AuthConfig;
  storage?: StorageConfig;
}

/**
 * Firestore trigger configuration
 */
export interface FirestoreConfig {
  enabled: boolean;
  databases: FirestoreDatabaseConfig[];
}

/**
 * Configuration for a single Firestore database
 */
export interface FirestoreDatabaseConfig {
  databaseName: DatabaseName;
  collections: FirestoreCollectionConfig[];
}

/**
 * Configuration for a single collection
 */
export interface FirestoreCollectionConfig {
  path: string;                        // 'users' or 'items/{itemUID}/images'
  operations: FirestoreOperation[];    // ['create', 'update', 'delete']
  includeData: boolean;                // Include full document in payload
  eventNameOverride?: string;          // Optional: 'item_images' instead of 'images'
}

export type FirestoreOperation = 'create' | 'update' | 'delete';

/**
 * Auth trigger configuration
 */
export interface AuthConfig {
  enabled: boolean;
  operations: AuthOperation[];         // ['create', 'delete']
}

export type AuthOperation = 'create' | 'delete';

/**
 * Storage trigger configuration
 */
export interface StorageConfig {
  enabled: boolean;
  pathPatterns: string[];             // ['items/**', 'profiles/**']
  includeMetadata: boolean;           // Include full metadata
}