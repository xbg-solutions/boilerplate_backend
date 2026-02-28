/**
 * Firestore Configuration
 *
 * Multi-database Firestore setup. Customize the DatabaseName type and
 * FIRESTORE_CONFIG map to match your application's database structure.
 *
 * The boilerplate ships with two databases (main + analytics) as a
 * starting point. Add or remove databases to fit your domain:
 *
 *   1. Add the name to the DatabaseName union type.
 *   2. Add the config entry to FIRESTORE_CONFIG.
 *   3. Add the matching env var to .env (the setup wizard handles the
 *      two defaults automatically).
 *
 * For single-database mode, set every firestoreName to "(default)".
 */

/**
 * Database names — extend this type as your project grows.
 */
export type DatabaseName =
  | 'main'
  | 'analytics';

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
 * Firestore configuration.
 *
 * Collections listed here are framework-level only. Entity-specific
 * collections are created by the code generator via repository classes.
 */
export const FIRESTORE_CONFIG: FirestoreConfig = {
  main: {
    firestoreName: process.env.MAIN_DATABASE_ID || '(default)',
    collections: ['sessions', 'token_blacklist', 'audit_logs'],
    emulatorSupport: true,
  },
  analytics: {
    firestoreName: process.env.ANALYTICS_DATABASE_ID || 'analytics',
    collections: [],
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

  Object.entries(FIRESTORE_CONFIG).forEach(([dbName, config]) => {
    if (!config.firestoreName) {
      errors.push(`Firestore name is required for database: ${dbName}`);
    }
  });

  if (errors.length > 0) {
    throw new Error(`Firestore configuration validation failed:\n${errors.join('\n')}`);
  }
}
