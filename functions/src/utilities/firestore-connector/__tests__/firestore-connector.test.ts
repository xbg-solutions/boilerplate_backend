/**
 * Firestore Connector - Unit Tests
 *
 * Testing WHAT the Firestore connector does, not HOW it works internally:
 * - Initializes Firebase Admin SDK
 * - Manages multiple named database instances
 * - Tests database connectivity
 * - Performs health checks
 * - Handles emulator vs production environments
 */

import { FirestoreConnector, createSingleDatabaseConnector, createMultiDatabaseConnector } from '../firestore-connector';
import { DatabaseConfig, FirebaseInitOptions } from '../firebase-types';
import * as admin from 'firebase-admin';

// Mock firebase-admin
jest.mock('firebase-admin', () => {
  const mockApp = {
    delete: jest.fn().mockResolvedValue(undefined),
  };

  return {
    initializeApp: jest.fn(() => mockApp),
    app: jest.fn(() => mockApp),
    credential: {
      applicationDefault: jest.fn(),
    },
    firestore: {
      FieldValue: {
        serverTimestamp: jest.fn(() => 'server-timestamp'),
      },
    },
  };
});

jest.mock('firebase-admin/firestore', () => ({
  getFirestore: jest.fn(() => ({
    collection: jest.fn((name: string) => ({
      doc: jest.fn((id: string) => ({
        set: jest.fn().mockResolvedValue(undefined),
        get: jest.fn().mockResolvedValue({ exists: true }),
        delete: jest.fn().mockResolvedValue(undefined),
      })),
    })),
  })),
}));

// Mock logger
jest.mock('../../logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// Mock firebase-types detectEnvironment and getFirebaseConfigFromEnv
jest.mock('../firebase-types', () => {
  const actual = jest.requireActual('../firebase-types');
  return {
    ...actual,
    detectEnvironment: jest.fn(() => ({
      isFunctionsEnvironment: false,
      isEmulator: false,
      isLocal: true,
    })),
    getFirebaseConfigFromEnv: jest.fn(() => ({
      projectId: 'test-project',
      databaseURL: 'https://test.firebaseio.com',
      storageBucket: 'test.appspot.com',
    })),
  };
});

import { getFirestore } from 'firebase-admin/firestore';
import { logger } from '../../logger';
import { detectEnvironment } from '../firebase-types';

describe('Firestore Connector', () => {
  let config: DatabaseConfig<'identityDB' | 'relationshipsDB'>;

  beforeEach(() => {
    config = {
      identityDB: {
        collections: ['users', 'accounts'],
        emulatorSupport: true,
      },
      relationshipsDB: {
        collections: ['contacts', 'addresses'],
        emulatorSupport: true,
      },
    };

    jest.clearAllMocks();

    // Reset admin mocks to default implementations
    const mockApp = {
      delete: jest.fn().mockResolvedValue(undefined),
      name: 'default',
    };

    // Track initialization state
    let isInitialized = false;

    (admin.initializeApp as jest.Mock).mockImplementation(() => {
      isInitialized = true;
      return mockApp;
    });

    (admin.app as jest.Mock).mockImplementation(() => {
      if (!isInitialized) {
        throw new Error('No Firebase app');
      }
      return mockApp;
    });

    // Reset detectEnvironment to default
    (detectEnvironment as jest.Mock).mockReturnValue({
      isFunctionsEnvironment: false,
      isEmulator: false,
      isLocal: true,
    });

    // Reset getFirestore to return a working mock Firestore instance
    (getFirestore as jest.Mock).mockReturnValue({
      collection: jest.fn((name: string) => ({
        doc: jest.fn((id: string) => ({
          set: jest.fn().mockResolvedValue(undefined),
          get: jest.fn().mockResolvedValue({ exists: true }),
          delete: jest.fn().mockResolvedValue(undefined),
        })),
      })),
    });
  });

  describe('constructor', () => {
    it('creates connector with configuration', () => {
      const connector = new FirestoreConnector(config);
      expect(connector).toBeInstanceOf(FirestoreConnector);
    });

    it('creates connector with options', () => {
      const options: FirebaseInitOptions = {
        skipDatabaseInit: true,
        forceReinitialize: false,
      };
      const connector = new FirestoreConnector(config, options);
      expect(connector).toBeInstanceOf(FirestoreConnector);
    });
  });

  describe('initializeFirebase', () => {
    it('initializes Firebase Admin SDK', () => {
      const connector = new FirestoreConnector(config);
      connector.initializeFirebase();

      expect(admin.initializeApp).toHaveBeenCalled();
    });

    it('does not reinitialize if already initialized', () => {
      // Mock app as already initialized
      (admin.app as jest.Mock).mockImplementation(() => ({ name: 'default' }));

      const connector = new FirestoreConnector(config);
      connector.initializeFirebase();

      expect(admin.initializeApp).not.toHaveBeenCalled();
    });

    it('forces reinitialization when option set', () => {
      (admin.app as jest.Mock).mockImplementation(() => ({ name: 'default' }));

      const options: FirebaseInitOptions = { forceReinitialize: true };
      const connector = new FirestoreConnector(config, options);
      connector.initializeFirebase();

      expect(admin.initializeApp).toHaveBeenCalled();
    });

    it('initializes in Functions environment without credentials', () => {
      (detectEnvironment as jest.Mock).mockReturnValue({
        isFunctionsEnvironment: true,
        isEmulator: false,
        isLocal: false,
      });

      const connector = new FirestoreConnector(config);
      connector.initializeFirebase();

      expect(admin.initializeApp).toHaveBeenCalledWith();
      expect(admin.credential.applicationDefault).not.toHaveBeenCalled();
    });

    it('initializes with credentials in non-Functions environment', () => {
      (detectEnvironment as jest.Mock).mockReturnValue({
        isFunctionsEnvironment: false,
        isEmulator: false,
        isLocal: true,
      });

      const connector = new FirestoreConnector(config);
      connector.initializeFirebase();

      expect(admin.credential.applicationDefault).toHaveBeenCalled();
      expect(admin.initializeApp).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: 'test-project',
        })
      );
    });

    it('skips database initialization when option set', () => {
      const options: FirebaseInitOptions = { skipDatabaseInit: true };
      const connector = new FirestoreConnector(config, options);
      connector.initializeFirebase();

      expect(getFirestore).not.toHaveBeenCalled();
    });

    it('initializes database instances by default', () => {
      const connector = new FirestoreConnector(config);
      connector.initializeFirebase();

      expect(getFirestore).toHaveBeenCalled();
    });

    it('handles initialization errors', () => {
      (admin.initializeApp as jest.Mock).mockImplementationOnce(() => {
        throw new Error('Initialization failed');
      });

      const connector = new FirestoreConnector(config);

      expect(() => connector.initializeFirebase()).toThrow('Initialization failed');
    });
  });

  describe('getDb', () => {
    it('returns all database instances', () => {
      const connector = new FirestoreConnector(config);
      const databases = connector.getDb();

      expect(databases).toHaveProperty('identityDB');
      expect(databases).toHaveProperty('relationshipsDB');
    });

    it('initializes Firebase if not already initialized', () => {
      const connector = new FirestoreConnector(config);
      connector.getDb();

      expect(admin.initializeApp).toHaveBeenCalled();
    });

    it('throws error if initialization fails', () => {
      (admin.initializeApp as jest.Mock).mockImplementationOnce(() => {
        throw new Error('Init failed');
      });

      const connector = new FirestoreConnector(config);

      expect(() => connector.getDb()).toThrow();
    });
  });

  describe('getDbByName', () => {
    it('returns specific database instance', () => {
      const connector = new FirestoreConnector(config);
      const db = connector.getDbByName('identityDB');

      expect(db).toBeDefined();
      expect(db.collection).toBeDefined();
    });

    it('throws error for non-existent database', () => {
      const connector = new FirestoreConnector(config);

      expect(() => connector.getDbByName('nonExistent' as any)).toThrow(
        "Database instance 'nonExistent' not found"
      );
    });
  });

  describe('getCollection', () => {
    it('returns collection reference', () => {
      const connector = new FirestoreConnector(config);
      const collection = connector.getCollection('identityDB', 'users');

      expect(collection).toBeDefined();
      expect(collection.doc).toBeDefined();
    });

    it('returns correct collection for different databases', () => {
      const connector = new FirestoreConnector(config);

      const usersCollection = connector.getCollection('identityDB', 'users');
      const contactsCollection = connector.getCollection('relationshipsDB', 'contacts');

      expect(usersCollection).toBeDefined();
      expect(contactsCollection).toBeDefined();
    });
  });

  describe('testDatabaseConnection', () => {
    it('successfully tests database connection', async () => {
      const connector = new FirestoreConnector(config);
      const result = await connector.testDatabaseConnection('identityDB');

      expect(result).toBe(true);
    });

    it('writes, reads, and deletes test document', async () => {
      const mockSet = jest.fn().mockResolvedValue(undefined);
      const mockGet = jest.fn().mockResolvedValue({ exists: true });
      const mockDelete = jest.fn().mockResolvedValue(undefined);

      (getFirestore as jest.Mock).mockReturnValue({
        collection: jest.fn(() => ({
          doc: jest.fn(() => ({
            set: mockSet,
            get: mockGet,
            delete: mockDelete,
          })),
        })),
      });

      const connector = new FirestoreConnector(config);
      await connector.testDatabaseConnection('identityDB');

      expect(mockSet).toHaveBeenCalled();
      expect(mockGet).toHaveBeenCalled();
      expect(mockDelete).toHaveBeenCalled();
    });

    it('returns false when connection test fails', async () => {
      (getFirestore as jest.Mock).mockReturnValue({
        collection: jest.fn(() => ({
          doc: jest.fn(() => ({
            set: jest.fn().mockRejectedValue(new Error('Write failed')),
            get: jest.fn(),
            delete: jest.fn(),
          })),
        })),
      });

      const connector = new FirestoreConnector(config);
      const result = await connector.testDatabaseConnection('identityDB');

      expect(result).toBe(false);
    });

    it('returns false when test document not found', async () => {
      (getFirestore as jest.Mock).mockReturnValue({
        collection: jest.fn(() => ({
          doc: jest.fn(() => ({
            set: jest.fn().mockResolvedValue(undefined),
            get: jest.fn().mockResolvedValue({ exists: false }),
            delete: jest.fn(),
          })),
        })),
      });

      const connector = new FirestoreConnector(config);
      const result = await connector.testDatabaseConnection('identityDB');

      expect(result).toBe(false);
    });
  });

  describe('testAllDatabaseConnections', () => {
    it('tests all configured databases', async () => {
      const connector = new FirestoreConnector(config);
      const results = await connector.testAllDatabaseConnections();

      expect(results).toHaveProperty('identityDB');
      expect(results).toHaveProperty('relationshipsDB');
      expect(results.identityDB).toBe(true);
      expect(results.relationshipsDB).toBe(true);
    });

    it('returns mixed results when some connections fail', async () => {
      let callCount = 0;
      (getFirestore as jest.Mock).mockReturnValue({
        collection: jest.fn(() => ({
          doc: jest.fn(() => {
            callCount++;
            if (callCount <= 3) {
              // First database succeeds (set, get, delete)
              return {
                set: jest.fn().mockResolvedValue(undefined),
                get: jest.fn().mockResolvedValue({ exists: true }),
                delete: jest.fn().mockResolvedValue(undefined),
              };
            } else {
              // Second database fails
              return {
                set: jest.fn().mockRejectedValue(new Error('Failed')),
                get: jest.fn(),
                delete: jest.fn(),
              };
            }
          }),
        })),
      });

      const connector = new FirestoreConnector(config);
      const results = await connector.testAllDatabaseConnections();

      expect(results.identityDB).toBe(true);
      expect(results.relationshipsDB).toBe(false);
    });
  });

  describe('healthCheck', () => {
    it('performs comprehensive health check', async () => {
      (admin.app as jest.Mock).mockReturnValue({ name: 'default' });

      const connector = new FirestoreConnector(config);
      const result = await connector.healthCheck();

      expect(result.firebase).toBe(true);
      expect(result.databases).toHaveProperty('identityDB');
      expect(result.databases).toHaveProperty('relationshipsDB');
      expect(result.timestamp).toBeInstanceOf(Date);
    });

    it('returns health check with timestamp', async () => {
      (admin.app as jest.Mock).mockReturnValue({ name: 'default' });

      const connector = new FirestoreConnector(config);
      const beforeCheck = Date.now();
      const result = await connector.healthCheck();
      const afterCheck = Date.now();

      expect(result.timestamp.getTime()).toBeGreaterThanOrEqual(beforeCheck);
      expect(result.timestamp.getTime()).toBeLessThanOrEqual(afterCheck);
    });
  });

  describe('closeConnections', () => {
    it('closes Firebase connections', async () => {
      const mockDelete = jest.fn().mockResolvedValue(undefined);
      (admin.app as jest.Mock).mockReturnValue({ delete: mockDelete });

      const connector = new FirestoreConnector(config);
      connector.initializeFirebase();
      await connector.closeConnections();

      expect(mockDelete).toHaveBeenCalled();
    });

    it('clears database instances', async () => {
      const mockDelete = jest.fn().mockResolvedValue(undefined);
      (admin.app as jest.Mock).mockReturnValue({ delete: mockDelete });

      const connector = new FirestoreConnector(config);
      connector.initializeFirebase();
      await connector.closeConnections();

      expect(connector.isInitialized()).toBe(false);
    });
  });

  describe('getConnectionState', () => {
    it('returns connection state', () => {
      const connector = new FirestoreConnector(config);
      const state = connector.getConnectionState();

      expect(state).toHaveProperty('initialized');
      expect(state).toHaveProperty('connected');
      expect(state).toHaveProperty('databasesInitialized');
      expect(state).toHaveProperty('connectionErrors');
    });

    it('reflects initialization status', () => {
      const connector = new FirestoreConnector(config);

      let state = connector.getConnectionState();
      expect(state.initialized).toBe(false);

      connector.initializeFirebase();

      state = connector.getConnectionState();
      expect(state.initialized).toBe(true);
    });
  });

  describe('resetConnectionState', () => {
    it('resets connection state to initial values', () => {
      const connector = new FirestoreConnector(config);
      connector.initializeFirebase();

      connector.resetConnectionState();
      const state = connector.getConnectionState();

      expect(state.initialized).toBe(false);
      expect(state.connected).toBe(false);
      expect(state.databasesInitialized).toBe(false);
      expect(state.connectionErrors).toEqual([]);
    });
  });

  describe('isInitialized', () => {
    it('returns false when not initialized', () => {
      const connector = new FirestoreConnector(config);
      expect(connector.isInitialized()).toBe(false);
    });

    it('returns true when fully initialized', () => {
      const connector = new FirestoreConnector(config);
      connector.initializeFirebase();
      expect(connector.isInitialized()).toBe(true);
    });
  });

  describe('getDatabaseNames', () => {
    it('returns all configured database names', () => {
      const connector = new FirestoreConnector(config);
      const names = connector.getDatabaseNames();

      expect(names).toContain('identityDB');
      expect(names).toContain('relationshipsDB');
      expect(names.length).toBe(2);
    });
  });

  describe('getCollectionsForDatabase', () => {
    it('returns collections for specific database', () => {
      const connector = new FirestoreConnector(config);
      const collections = connector.getCollectionsForDatabase('identityDB');

      expect(collections).toEqual(['users', 'accounts']);
    });

    it('throws error for non-existent database', () => {
      const connector = new FirestoreConnector(config);

      expect(() => connector.getCollectionsForDatabase('nonExistent' as any)).toThrow(
        "Database configuration for 'nonExistent' not found"
      );
    });
  });

  describe('getAllCollections', () => {
    it('returns all collections across all databases', () => {
      const connector = new FirestoreConnector(config);
      const allCollections = connector.getAllCollections();

      expect(allCollections).toEqual({
        identityDB: ['users', 'accounts'],
        relationshipsDB: ['contacts', 'addresses'],
      });
    });
  });

  describe('createSingleDatabaseConnector', () => {
    it('creates connector with single database', () => {
      const connector = createSingleDatabaseConnector(
        'test-project',
        ['users', 'posts', 'comments']
      );

      expect(connector).toBeInstanceOf(FirestoreConnector);
      expect(connector.getDatabaseNames()).toEqual(['main']);
      expect(connector.getCollectionsForDatabase('main')).toEqual([
        'users',
        'posts',
        'comments',
      ]);
    });

    it('accepts options', () => {
      const options: FirebaseInitOptions = { skipDatabaseInit: true };
      const connector = createSingleDatabaseConnector('test-project', ['users'], options);

      expect(connector).toBeInstanceOf(FirestoreConnector);
    });
  });

  describe('createMultiDatabaseConnector', () => {
    it('creates connector with multiple databases', () => {
      const multiConfig: DatabaseConfig<'db1' | 'db2'> = {
        db1: { collections: ['col1', 'col2'], emulatorSupport: true },
        db2: { collections: ['col3', 'col4'], emulatorSupport: true },
      };

      const connector = createMultiDatabaseConnector(multiConfig);

      expect(connector).toBeInstanceOf(FirestoreConnector);
      expect(connector.getDatabaseNames()).toEqual(['db1', 'db2']);
    });

    it('accepts options', () => {
      const multiConfig: DatabaseConfig<'testDB'> = {
        testDB: { collections: ['test'], emulatorSupport: true },
      };
      const options: FirebaseInitOptions = { forceReinitialize: true };

      const connector = createMultiDatabaseConnector(multiConfig, options);

      expect(connector).toBeInstanceOf(FirestoreConnector);
    });
  });

  describe('emulator environment', () => {
    it('uses same Firestore instance for all databases in emulator', () => {
      (detectEnvironment as jest.Mock).mockReturnValue({
        isFunctionsEnvironment: false,
        isEmulator: true,
        isLocal: true,
      });

      const connector = new FirestoreConnector(config);
      connector.initializeFirebase();

      // In emulator mode, getFirestore is called once and shared
      expect(getFirestore).toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('emulator mode'),
        expect.any(Object)
      );
    });
  });

  describe('edge cases', () => {
    it('handles empty configuration', () => {
      const emptyConfig: DatabaseConfig<never> = {} as any;
      const connector = new FirestoreConnector(emptyConfig);

      expect(connector.getDatabaseNames()).toEqual([]);
    });

    it('handles single database configuration', () => {
      const singleConfig: DatabaseConfig<'onlyDB'> = {
        onlyDB: { collections: ['col1'], emulatorSupport: true },
      };
      const connector = new FirestoreConnector(singleConfig);

      expect(connector.getDatabaseNames()).toEqual(['onlyDB']);
    });

    it('handles database with no collections', () => {
      const noCollectionsConfig: DatabaseConfig<'emptyDB'> = {
        emptyDB: { collections: [], emulatorSupport: true },
      };
      const connector = new FirestoreConnector(noCollectionsConfig);

      expect(connector.getCollectionsForDatabase('emptyDB')).toEqual([]);
    });
  });
});
