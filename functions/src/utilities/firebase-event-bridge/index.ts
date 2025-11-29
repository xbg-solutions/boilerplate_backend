// src/utilities/firebase-event-bridge/index.ts

export { FirebaseEventBridge } from './bridge';
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