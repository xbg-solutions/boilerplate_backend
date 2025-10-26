/**
 * Firestore Configuration
 * Generic configuration for multi-database Firestore setup
 *
 * NOTE: This is a generic boilerplate configuration. Customize the DatabaseName
 * type and database configurations to match your specific application needs.
 */

/**
 * Database names enum
 * Customize these to match your application's database structure
 */
export type DatabaseName =
  | 'identityDB'
  | 'wishlistDB'
  | 'relationshipsDB'
  | 'coordinationDB'
  | 'communicationsDB'
  | 'systemDB';

/**
 * Database configuration interface
 */
export interface FirestoreDatabaseConfig {
  /** Firestore database name (for named databases in production) */
  firestoreName: string;
  /** Collections that exist in this database */
  collections: string[];
  /** Whether this database should be available in emulator mode */
  emulatorSupport: boolean;
}

/**
 * Firestore configuration type
 */
export type FirestoreConfig = {
  [K in DatabaseName]: FirestoreDatabaseConfig;
};

/**
 * Default Firestore configuration
 * Customize this to match your application's database structure
 */
export const FIRESTORE_CONFIG: FirestoreConfig = {
  identityDB: {
    firestoreName: process.env.IDENTITY_DATABASE_ID || 'identity',
    collections: ['users', 'sessions', 'auth_metadata'],
    emulatorSupport: true,
  },
  wishlistDB: {
    firestoreName: process.env.WISHLIST_DATABASE_ID || 'wishlist',
    collections: ['wishlists', 'items', 'categories'],
    emulatorSupport: true,
  },
  relationshipsDB: {
    firestoreName: process.env.RELATIONSHIPS_DATABASE_ID || 'relationships',
    collections: ['connections', 'invitations', 'groups'],
    emulatorSupport: true,
  },
  coordinationDB: {
    firestoreName: process.env.COORDINATION_DATABASE_ID || 'coordination',
    collections: ['events', 'tasks', 'schedules'],
    emulatorSupport: true,
  },
  communicationsDB: {
    firestoreName: process.env.COMMUNICATIONS_DATABASE_ID || 'communications',
    collections: ['messages', 'notifications', 'email_logs'],
    emulatorSupport: true,
  },
  systemDB: {
    firestoreName: process.env.SYSTEM_DATABASE_ID || 'system',
    collections: ['audit_logs', 'token_blacklist', 'system_config'],
    emulatorSupport: true,
  },
};

/**
 * Get Firestore database name
 */
export function getFirestoreDatabaseName(database: DatabaseName): string {
  return FIRESTORE_CONFIG[database].firestoreName;
}

/**
 * Get collections for a database
 */
export function getDatabaseCollections(database: DatabaseName): string[] {
  return FIRESTORE_CONFIG[database].collections;
}

/**
 * Check if database supports emulator
 */
export function isDatabaseEmulatorSupported(database: DatabaseName): boolean {
  return FIRESTORE_CONFIG[database].emulatorSupport;
}

/**
 * Validate Firestore configuration
 */
export function validateFirestoreConfig(): void {
  const errors: string[] = [];

  // Validate each database configuration
  Object.entries(FIRESTORE_CONFIG).forEach(([dbName, config]) => {
    if (!config.firestoreName) {
      errors.push(`Firestore name is required for database: ${dbName}`);
    }

    if (!config.collections || config.collections.length === 0) {
      errors.push(`At least one collection is required for database: ${dbName}`);
    }
  });

  if (errors.length > 0) {
    throw new Error(`Firestore configuration validation failed:\n${errors.join('\n')}`);
  }
}
