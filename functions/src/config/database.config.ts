/**
 * Database Configuration
 * Multi-database setup with connection pooling and retry logic
 */

export interface DatabaseConfig {
  databases: {
    [key: string]: {
      projectId?: string;
      databaseId?: string;
      emulator?: {
        host: string;
        port: number;
      };
    };
  };

  defaults: {
    retryAttempts: number;
    retryDelay: number;
    timeout: number;
    enableCache: boolean;
  };

  collections: {
    [key: string]: {
      database: string;
      name: string;
    };
  };
}

export const DATABASE_CONFIG: DatabaseConfig = {
  databases: {
    main: {
      projectId: process.env.FIREBASE_PROJECT_ID,
      databaseId: process.env.MAIN_DATABASE_ID || '(default)',
      emulator: process.env.FIRESTORE_EMULATOR_HOST ? {
        host: process.env.FIRESTORE_EMULATOR_HOST.split(':')[0],
        port: parseInt(process.env.FIRESTORE_EMULATOR_HOST.split(':')[1] || '8080', 10),
      } : undefined,
    },
    analytics: {
      projectId: process.env.FIREBASE_PROJECT_ID,
      databaseId: process.env.ANALYTICS_DATABASE_ID || 'analytics',
      emulator: process.env.FIRESTORE_EMULATOR_HOST ? {
        host: process.env.FIRESTORE_EMULATOR_HOST.split(':')[0],
        port: parseInt(process.env.FIRESTORE_EMULATOR_HOST.split(':')[1] || '8080', 10),
      } : undefined,
    },
  },

  defaults: {
    retryAttempts: parseInt(process.env.DB_RETRY_ATTEMPTS || '3', 10),
    retryDelay: parseInt(process.env.DB_RETRY_DELAY || '1000', 10),
    timeout: parseInt(process.env.DB_TIMEOUT || '10000', 10),
    enableCache: process.env.DB_ENABLE_CACHE !== 'false',
  },

  collections: {
    users: {
      database: 'main',
      name: 'users',
    },
    sessions: {
      database: 'main',
      name: 'sessions',
    },
    tokenBlacklist: {
      database: 'main',
      name: 'token_blacklist',
    },
    auditLogs: {
      database: 'main',
      name: 'audit_logs',
    },
  },
};

/**
 * Get database configuration by name
 */
export function getDatabaseConfig(name: string) {
  const config = DATABASE_CONFIG.databases[name];
  if (!config) {
    throw new Error(`Database configuration not found for: ${name}`);
  }
  return config;
}

/**
 * Get collection configuration
 */
export function getCollectionConfig(collectionKey: string) {
  const config = DATABASE_CONFIG.collections[collectionKey];
  if (!config) {
    throw new Error(`Collection configuration not found for: ${collectionKey}`);
  }
  return config;
}

/**
 * Check if using Firestore emulator
 */
export function isUsingEmulator(): boolean {
  return !!process.env.FIRESTORE_EMULATOR_HOST;
}
