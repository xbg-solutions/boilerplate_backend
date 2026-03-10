// src/utilities/firebase-event-bridge/index.ts

export { FirebaseEventBridge, initializeFirebaseEventBridge } from './bridge';
export type { MapFirebaseEventToDomainFn } from './bridge';
export type {
  FirebaseEventBridgeConfig,
  FirestoreConfig,
  FirestoreDatabaseConfig,
  FirestoreCollectionConfig,
  FirestoreOperation,
  AuthConfig,
  AuthOperation,
  StorageConfig
} from './config-types';
export type { NormalizedFirebaseEvent } from './normalizer';