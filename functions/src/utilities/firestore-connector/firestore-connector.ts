/**
 * Generic Firebase configuration and database access utility
 * Clean implementation without legacy compatibility
 */
import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import { logger } from '../logger';
import {
  DatabaseConfig,
  DatabaseInstances,
  DatabaseConnectionResult,
  HealthCheckResult,
  TestDocument,
  FirebaseConnectionState,
  FirebaseOperation,
  FirebaseLogContext,
  FirebaseInitOptions,
  getFirebaseConfigFromEnv,
  detectEnvironment,
  toError,
  Firestore
} from './firebase-types';

/**
 * Generic Firestore Connector Class
 * Can be configured for any project's database schema
 */
export class FirestoreConnector<TDatabaseNames extends string = string> {
  private dbInstances: DatabaseInstances<TDatabaseNames> | null = null;
  private connectionState: FirebaseConnectionState = {
    initialized: false,
    connected: false,
    databasesInitialized: false,
    connectionErrors: []
  };

  constructor(
    private config: DatabaseConfig<TDatabaseNames>,
    private options: FirebaseInitOptions = {}
  ) {}

  /**
   * Initialize Firebase Admin SDK with service account
   */
  public initializeFirebase(): void {
    try {
      // Check if already initialized (unless forcing reinitialize)
      if (!this.options.forceReinitialize) {
        try {
          admin.app();
          this.connectionState.initialized = true;
          logger.debug('Firebase already initialized');
        } catch {
          // Not initialized, continue with initialization
        }
      }

      if (!this.connectionState.initialized || this.options.forceReinitialize) {
        const environment = detectEnvironment();
        
        if (environment.isFunctionsEnvironment) {
          // Use default initialization for Firebase Functions
          admin.initializeApp();
        } else {
          const firebaseConfig = getFirebaseConfigFromEnv();
          
          admin.initializeApp({
            credential: admin.credential.applicationDefault(),
            projectId: firebaseConfig.projectId,
            databaseURL: firebaseConfig.databaseURL,
            storageBucket: firebaseConfig.storageBucket,
          });
        }
        
        this.connectionState.initialized = true;
        this.connectionState.connected = true;
      }
    } catch (error) {
      const firebaseError = toError(error);
      this.connectionState.connectionErrors = this.connectionState.connectionErrors || [];
      this.connectionState.connectionErrors.push(firebaseError);
      throw firebaseError;
    }

    // Initialize database instances if not skipped
    if (!this.options.skipDatabaseInit) {
      this.initializeDatabaseInstances();
    }
  }

  /**
   * Initialize database instances based on configuration
   */
  private initializeDatabaseInstances(): void {
    try {
      const environment = detectEnvironment();
      const dbInstances = {} as DatabaseInstances<TDatabaseNames>;
      
      if (environment.isEmulator) {
        // Emulator doesn't support multiple databases - use same instance for all
        const db = getFirestore();
        
        for (const dbName of this.getDatabaseNames()) {
          dbInstances[dbName] = db;
        }
        
        logger.warn('Running in emulator mode - all databases point to same Firestore instance', {
          operation: 'initializeDatabaseInstances',
          emulator: true,
          databases: this.getDatabaseNames()
        });
      } else {
        // Production: Use named databases
        for (const [dbName, dbConfig] of Object.entries(this.config) as Array<[TDatabaseNames, DatabaseConfig<TDatabaseNames>[TDatabaseNames]]>) {
          const firestoreName = dbConfig.firestoreName || dbName;
          dbInstances[dbName] = getFirestore(admin.app(), firestoreName);
        }
        
        logger.info(`Initialized ${this.getDatabaseNames().length} named Firestore databases`, {
          operation: 'initializeDatabaseInstances',
          production: true,
          databases: this.getDatabaseNames()
        });
      }
      
      this.dbInstances = dbInstances;
      this.connectionState.databasesInitialized = true;
    } catch (error) {
      const firebaseError = toError(error);
      this.connectionState.connectionErrors = this.connectionState.connectionErrors || [];
      this.connectionState.connectionErrors.push(firebaseError);
      throw firebaseError;
    }
  }

  /**
   * Get all database instances, initializing if necessary
   */
  public getDb(): DatabaseInstances<TDatabaseNames> {
    if (!this.dbInstances) {
      this.initializeFirebase();
    }
    
    if (!this.dbInstances) {
      throw new Error('Failed to initialize Firebase database instances');
    }
    
    return this.dbInstances;
  }

  /**
   * Get specific database instance by name
   */
  public getDbByName(dbName: TDatabaseNames): Firestore {
    const databases = this.getDb();
    const db = databases[dbName];
    
    if (!db) {
      throw new Error(`Database instance '${String(dbName)}' not found`);
    }
    
    return db;
  }

  /**
   * Get database instance with collection reference for convenience
   */
  public getCollection(dbName: TDatabaseNames, collectionName: string) {
    const db = this.getDbByName(dbName);
    return db.collection(collectionName);
  }

  /**
   * Test database connectivity for a specific database
   */
  public async testDatabaseConnection(dbName: TDatabaseNames): Promise<boolean> {
    const baseContext: FirebaseLogContext = {
      operation: 'testDatabaseConnection',
      dbName: String(dbName),
      firebaseOperation: FirebaseOperation.CONNECTION_TEST,
      connectionTest: true
    };

    try {
      const db = this.getDbByName(dbName);
      
      // Test by writing and reading a test document
      const testCollection = 'connection-test';
      const testDocId = `test-${Date.now()}`;
      const testData: TestDocument = {
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        test: true,
        database: String(dbName)
      };
      
      // Write test document
      await db.collection(testCollection).doc(testDocId).set(testData);
      
      logger.debug('Test document written', {
        ...baseContext,
        collection: testCollection,
        docId: testDocId,
        firebaseOperation: FirebaseOperation.WRITE
      });
      
      // Read test document
      const doc = await db.collection(testCollection).doc(testDocId).get();
      
      if (!doc.exists) {
        throw new Error('Test document not found after write');
      }
      
      // Clean up test document
      await db.collection(testCollection).doc(testDocId).delete();
      
      logger.debug('Test document cleaned up', {
        ...baseContext,
        collection: testCollection,
        docId: testDocId,
        firebaseOperation: FirebaseOperation.DELETE
      });
      
      logger.info(`Database connection test passed for ${String(dbName)}`, baseContext);
      return true;
    } catch (error) {
      const firebaseError = toError(error);
      logger.error(`Database connection test failed for ${String(dbName)}`, firebaseError, baseContext);
      return false;
    }
  }

  /**
   * Test all database connections
   */
  public async testAllDatabaseConnections(): Promise<DatabaseConnectionResult<TDatabaseNames>> {
    const context: FirebaseLogContext = {
      operation: 'testAllDatabaseConnections',
      firebaseOperation: FirebaseOperation.CONNECTION_TEST
    };

    logger.info('Testing all database connections', context);
    const databases = this.getDb();
    const results = {} as DatabaseConnectionResult<TDatabaseNames>;
    
    for (const dbName of Object.keys(databases) as Array<TDatabaseNames>) {
      try {
        results[dbName] = await this.testDatabaseConnection(dbName);
      } catch (error) {
        const firebaseError = toError(error);
        logger.error(`Failed to test database connection for ${String(dbName)}`, firebaseError, {
          ...context,
          dbName: String(dbName)
        });
        results[dbName] = false;
      }
    }
    
    const successCount = Object.values(results).filter(Boolean).length;
    const totalCount = Object.keys(results).length;
    
    if (successCount === totalCount) {
      logger.info(`All ${totalCount} database connections tested successfully`, {
        ...context,
        metadata: { results, successCount, totalCount }
      });
    } else {
      logger.warn(`Database connection tests: ${successCount}/${totalCount} passed`, {
        ...context,
        metadata: { results, successCount, totalCount }
      });
    }
    
    return results;
  }

  /**
   * Health check for Firebase connection
   */
  public async healthCheck(): Promise<HealthCheckResult<TDatabaseNames>> {
    const context: FirebaseLogContext = {
      operation: 'healthCheck',
      firebaseOperation: FirebaseOperation.HEALTH_CHECK,
      healthCheck: true
    };

    try {
      // Test Firebase admin connectivity
      const app = admin.app();
      const firebaseHealthy = !!app;
      
      // Test all database connections
      const databaseResults = await this.testAllDatabaseConnections();
      
      const result: HealthCheckResult<TDatabaseNames> = {
        firebase: firebaseHealthy,
        databases: databaseResults,
        timestamp: new Date()
      };
      
      this.connectionState.lastHealthCheck = result.timestamp;
      
      logger.info('Firebase health check completed', {
        ...context,
        metadata: { result }
      });
      
      return result;
    } catch (error) {
      const firebaseError = toError(error);
      logger.error('Firebase health check failed', firebaseError, context);
      throw firebaseError;
    }
  }

  /**
   * Gracefully close Firebase connections
   */
  public async closeConnections(): Promise<void> {
    const context: FirebaseLogContext = {
      operation: 'closeConnections',
      firebaseOperation: FirebaseOperation.DISCONNECT
    };

    try {
      if (this.dbInstances) {
        // Firebase Admin SDK doesn't require explicit connection closing
        // but we can clean up our references
        this.dbInstances = null;
        this.connectionState.databasesInitialized = false;
        logger.info('Firebase database instances cleared', context);
      }
      
      // Delete the default app to fully clean up
      await admin.app().delete();
      this.connectionState.initialized = false;
      this.connectionState.connected = false;
      logger.info('Firebase connections closed successfully', context);
    } catch (error) {
      const firebaseError = toError(error);
      logger.error('Error closing Firebase connections', firebaseError, context);
      throw firebaseError;
    }
  }

  /**
   * Get current Firebase connection state
   */
  public getConnectionState(): FirebaseConnectionState {
    return { ...this.connectionState };
  }

  /**
   * Reset connection state (useful for testing)
   */
  public resetConnectionState(): void {
    this.connectionState = {
      initialized: false,
      connected: false,
      databasesInitialized: false,
      connectionErrors: []
    };
    this.dbInstances = null;
  }

  /**
   * Check if Firebase is properly initialized
   */
  public isInitialized(): boolean {
    return this.connectionState.initialized && 
           this.connectionState.databasesInitialized && 
           this.dbInstances !== null;
  }

  /**
   * Get available database names from configuration
   */
  public getDatabaseNames(): TDatabaseNames[] {
    return Object.keys(this.config) as TDatabaseNames[];
  }

  /**
   * Get collections for a specific database
   */
  public getCollectionsForDatabase(dbName: TDatabaseNames): string[] {
    const dbConfig = this.config[dbName];
    if (!dbConfig) {
      throw new Error(`Database configuration for '${String(dbName)}' not found`);
    }
    return dbConfig.collections;
  }

  /**
   * Get all collections across all databases
   */
  public getAllCollections(): Record<TDatabaseNames, string[]> {
    const result = {} as Record<TDatabaseNames, string[]>;
    for (const [dbName, dbConfig] of Object.entries(this.config) as Array<[TDatabaseNames, DatabaseConfig<TDatabaseNames>[TDatabaseNames]]>) {
      result[dbName] = dbConfig.collections;
    }
    return result;
  }
}

/**
 * Factory function to create a simple single-database connector
 */
export const createSingleDatabaseConnector = (
  _projectId: string,
  collections: string[],
  options: FirebaseInitOptions = {}
): FirestoreConnector<'main'> => {
  const config: DatabaseConfig<'main'> = {
    main: {
      collections,
      emulatorSupport: true
    }
  };

  return new FirestoreConnector(config, options);
};

/**
 * Factory function to create a multi-database connector with custom names
 */
export const createMultiDatabaseConnector = <T extends string>(
  config: DatabaseConfig<T>,
  options: FirebaseInitOptions = {}
): FirestoreConnector<T> => {
  return new FirestoreConnector(config, options);
};