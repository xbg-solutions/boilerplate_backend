/**
 * Generic Firebase/Firestore type definitions for portable use
 * Clean implementation without legacy compatibility
 */
import { Firestore } from 'firebase-admin/firestore';
import { LogContext } from '../logger';

/**
 * Generic database configuration for any project
 */
export type DatabaseConfig<TDatabaseNames extends string = string> = {
  [dbName in TDatabaseNames]: {
    /** Firestore database name (for named databases in production) */
    firestoreName?: string;
    /** Collections that exist in this database */
    collections: string[];
    /** Whether this database should be available in emulator mode */
    emulatorSupport?: boolean;
    /** Custom initialization options for this database */
    initOptions?: Record<string, any>;
  };
};

/**
 * Runtime database instances
 */
export type DatabaseInstances<TDatabaseNames extends string = string> = {
  [K in TDatabaseNames]: Firestore;
};

/**
 * Database connection test results
 */
export type DatabaseConnectionResult<TDatabaseNames extends string = string> = {
  [K in TDatabaseNames]: boolean;
};

/**
 * Firestore environment detection
 */
export interface FirestoreEnvironment {
  isEmulator: boolean;
  isProduction: boolean;
  isFunctionsEnvironment: boolean;
  projectId: string;
  emulatorHost?: string;
  emulatorPort?: number;
}

/**
 * Firebase configuration interface
 */
export interface FirebaseConfig {
  projectId: string;
  databaseURL?: string;
  storageBucket?: string;
  serviceAccountPath?: string;
}

/**
 * Extended LogContext for Firebase operations
 */
export interface FirebaseLogContext extends LogContext {
  // Database identifiers
  dbName?: string;
  databases?: string[];
  
  // Document/Collection identifiers
  collection?: string;
  document?: string;
  docId?: string;
  
  // Firebase-specific metadata
  firebaseOperation?: FirebaseOperation;
  connectionTest?: boolean;
  healthCheck?: boolean;
}

/**
 * Health check result interface
 */
export interface HealthCheckResult<TDatabaseNames extends string = string> {
  firebase: boolean;
  databases: DatabaseConnectionResult<TDatabaseNames>;
  timestamp: Date;
}

/**
 * Firebase error interface
 */
export interface FirebaseError extends Error {
  code?: string;
  details?: string;
  httpStatus?: number;
}

/**
 * Test document interface
 */
export interface TestDocument {
  timestamp: any; // FirebaseFirestore.FieldValue
  test: boolean;
  database: string;
}

/**
 * Firebase connection state
 */
export interface FirebaseConnectionState {
  initialized: boolean;
  connected: boolean;
  databasesInitialized: boolean;
  lastHealthCheck?: Date;
  connectionErrors?: Error[];
}

/**
 * Firebase initialization options
 */
export interface FirebaseInitOptions {
  forceReinitialize?: boolean;
  skipDatabaseInit?: boolean;
  testMode?: boolean;
  emulatorMode?: boolean;
}

/**
 * Firebase operation types
 */
export enum FirebaseOperation {
  INITIALIZE = 'initialize',
  CONNECT = 'connect',
  DISCONNECT = 'disconnect',
  READ = 'read',
  WRITE = 'write',
  DELETE = 'delete',
  QUERY = 'query',
  HEALTH_CHECK = 'health_check',
  CONNECTION_TEST = 'connection_test'
}

/**
 * Type guard for standard errors
 */
export const isError = (error: any): error is Error => {
  return error instanceof Error;
};

/**
 * Convert unknown error to Error type
 */
export const toError = (error: unknown): Error => {
  if (isError(error)) {
    return error;
  }
  
  if (typeof error === 'string') {
    return new Error(error);
  }
  
  if (error && typeof error === 'object' && 'message' in error) {
    return new Error(String(error.message));
  }
  
  return new Error('Unknown error occurred');
};

/**
 * Detect Firestore environment
 */
export const detectEnvironment = (): FirestoreEnvironment => {
  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || '';
  
  return {
    isEmulator: !!(process.env.FUNCTIONS_EMULATOR || process.env.FIRESTORE_EMULATOR_HOST),
    isProduction: !!(process.env.K_SERVICE || process.env.GCLOUD_PROJECT),
    isFunctionsEnvironment: !!(process.env.FUNCTIONS_EMULATOR || process.env.K_SERVICE),
    projectId,
    emulatorHost: process.env.FIRESTORE_EMULATOR_HOST,
    emulatorPort: process.env.FIRESTORE_EMULATOR_PORT ? parseInt(process.env.FIRESTORE_EMULATOR_PORT) : undefined
  };
};

/**
 * Get Firebase configuration from environment
 */
export const getFirebaseConfigFromEnv = (): FirebaseConfig => {
  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT;
  const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  
  if (!projectId) {
    throw new Error('FIREBASE_PROJECT_ID or GCLOUD_PROJECT environment variable is required');
  }
  
  // In Firebase Functions environment, service account credentials are not required
  if (!serviceAccountPath && !process.env.FUNCTIONS_EMULATOR && !process.env.K_SERVICE) {
    throw new Error('GOOGLE_APPLICATION_CREDENTIALS environment variable is required');
  }
  
  return {
    projectId,
    databaseURL: process.env.FIREBASE_DATABASE_URL || `https://${projectId}.firebaseio.com`,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || `${projectId}.appspot.com`,
    serviceAccountPath: serviceAccountPath || ''
  };
};

// Re-export Firestore types for convenience
export { Firestore, CollectionReference, DocumentReference, DocumentSnapshot, QuerySnapshot } from 'firebase-admin/firestore';