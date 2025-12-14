# Firestore Connector Utility

A portable, configuration-driven Firebase Firestore connector that can be used across multiple projects with different database schemas.

## Overview

This utility provides a **generic, reusable Firestore connector** that:
- Supports single or multi-database setups
- Handles emulator vs production environments automatically
- Provides health checks and connection testing
- Maintains type safety with generic TypeScript interfaces
- Uses singleton pattern for efficient resource management

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  Your Project (e.g., Wishlist Platform)            │
│  ┌───────────────────────────────────────────────┐ │
│  │ config/firestore.config.ts                    │ │
│  │  - DatabaseName type                          │ │
│  │  - DATABASE_CONFIG                            │ │
│  │  - Singleton connector                        │ │
│  │  - Helper functions (getDb, getDbByName, etc)│ │
│  └───────────────────────────────────────────────┘ │
│                      ↓ uses                         │
│  ┌───────────────────────────────────────────────┐ │
│  │ utilities/firestore-connector/                │ │
│  │  - FirestoreConnector<T> (generic class)     │ │
│  │  - DatabaseConfig<T> (generic types)         │ │
│  │  - Factory functions                          │ │
│  └───────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

**Philosophy**: The utility provides generic infrastructure. Your project defines the specific database schema and exports a clean API.

---

## Setting Up for a New Project

### Step 1: Copy the Utility

Copy the entire `utilities/firestore-connector/` directory to your project:

```
your-project/
  src/
    utilities/
      firestore-connector/
        ├── firebase-types.ts
        ├── firestore-connector.ts
        ├── index.ts
        └── README.md (this file)
```

### Step 2: Create Your Project Configuration

Create `config/firestore.config.ts` in your project with the following structure:

```typescript
/**
 * [Your Project Name] Firestore Configuration
 * Project-specific database schema and connector setup
 */
import { DatabaseConfig, FirebaseInitOptions } from '../utilities/firestore-connector/firebase-types';
import { FirestoreConnector, createMultiDatabaseConnector } from '../utilities/firestore-connector/firestore-connector';

// ============================================================================
// 1. DEFINE YOUR DATABASE NAMES
// ============================================================================
/**
 * Type-safe database names for your project
 * These become the keys you use throughout your application
 */
export type DatabaseName =
  | 'usersDB'      // Example: user data
  | 'contentDB'    // Example: content/posts
  | 'analyticsDB'; // Example: analytics data

// ============================================================================
// 2. CONFIGURE YOUR DATABASES
// ============================================================================
/**
 * Database configuration mapping
 * Maps logical database names to Firestore instances and collections
 */
export const DATABASE_CONFIG: DatabaseConfig<DatabaseName> = {
  // Users Database
  usersDB: {
    firestoreName: 'users',        // Production named database (or omit for default)
    collections: ['profiles', 'sessions', 'preferences'],
    emulatorSupport: true           // Support emulator mode
  },

  // Content Database
  contentDB: {
    firestoreName: 'content',
    collections: ['posts', 'comments', 'media'],
    emulatorSupport: true
  },

  // Analytics Database
  analyticsDB: {
    firestoreName: 'analytics',
    collections: ['events', 'metrics', 'reports'],
    emulatorSupport: true
  }
};

// ============================================================================
// 3. DEFINE PROJECT-SPECIFIC TYPES
// ============================================================================
/**
 * Type-safe database instances for your project
 */
export type DatabaseInstances = {
  [K in DatabaseName]: import('firebase-admin/firestore').Firestore;
};

/**
 * Database connection test results
 */
export type DatabaseConnectionResult = {
  [K in DatabaseName]: boolean;
};

/**
 * Health check result structure
 */
export interface HealthCheckResult {
  firebase: boolean;
  databases: DatabaseConnectionResult;
  timestamp: Date;
}

// ============================================================================
// 4. CREATE FACTORY FUNCTION (OPTIONAL BUT RECOMMENDED)
// ============================================================================
/**
 * Create a Firestore connector configured for your project
 * This makes it easy to create connectors with your specific configuration
 */
export const createYourProjectConnector = (
  options: FirebaseInitOptions = {}
): FirestoreConnector<DatabaseName> => {
  return createMultiDatabaseConnector(DATABASE_CONFIG, options);
};

// ============================================================================
// 5. CREATE SINGLETON CONNECTOR INSTANCE
// ============================================================================
/**
 * Singleton connector instance for your project
 * This is the main connector used throughout your application
 */
export const connector = createYourProjectConnector();

// ============================================================================
// 6. EXPORT HELPER FUNCTIONS (CLEAN API)
// ============================================================================
/**
 * Initialize Firebase Admin SDK and database instances
 * Call this once at application startup
 */
export const initializeFirebase = (): void => {
  connector.initializeFirebase();
};

/**
 * Get all database instances
 * Automatically initializes if not already done
 */
export const getDb = (): DatabaseInstances => {
  return connector.getDb();
};

/**
 * Get a specific database instance by name
 * Automatically initializes if not already done
 *
 * @param dbName - The database name (e.g., 'usersDB', 'contentDB')
 */
export const getDbByName = (dbName: DatabaseName): import('firebase-admin/firestore').Firestore => {
  return connector.getDbByName(dbName);
};

/**
 * Perform health check on Firebase connection and all databases
 */
export const healthCheck = async (): Promise<HealthCheckResult> => {
  return connector.healthCheck();
};

// ============================================================================
// 7. OPTIONAL: EXPORT COLLECTION MAPPINGS
// ============================================================================
/**
 * Database collection mappings for easy reference
 */
export const DATABASE_COLLECTIONS: Record<DatabaseName, string[]> = {
  usersDB: (DATABASE_CONFIG as Record<DatabaseName, { collections: string[] }>).usersDB.collections,
  contentDB: (DATABASE_CONFIG as Record<DatabaseName, { collections: string[] }>).contentDB.collections,
  analyticsDB: (DATABASE_CONFIG as Record<DatabaseName, { collections: string[] }>).analyticsDB.collections
};

/**
 * Get available database names
 */
export const getDatabaseNames = (): DatabaseName[] => {
  return Object.keys(DATABASE_CONFIG) as DatabaseName[];
};
```

### Step 3: Use in Your Application

#### In your entry point (e.g., `index.ts`):

```typescript
import { initializeFirebase } from './config/firestore.config';
import { logger } from './utilities/logger';

// Initialize once at startup
try {
  initializeFirebase();
  logger.info('Firebase initialized successfully');
} catch (error) {
  logger.error('Failed to initialize Firebase', error);
  throw error;
}
```

#### In your repositories:

```typescript
import { Firestore } from 'firebase-admin/firestore';
import { getDbByName } from '../config/firestore.config';

export class UsersRepository {
  private db: Firestore;
  private collection: FirebaseFirestore.CollectionReference;

  constructor() {
    this.db = getDbByName('usersDB');  // Type-safe database name
    this.collection = this.db.collection('profiles');
  }

  async getUser(userId: string) {
    const doc = await this.collection.doc(userId).get();
    return doc.exists ? doc.data() : null;
  }
}
```

---

## Configuration Reference

### DatabaseConfig Structure

```typescript
type DatabaseConfig<TDatabaseNames extends string> = {
  [dbName in TDatabaseNames]: {
    /**
     * Firestore database name for production named databases
     * - In production: Uses Firebase named database (e.g., 'users', 'content')
     * - In emulator: Ignored (all databases share same instance)
     * - Optional: Defaults to dbName if not specified
     */
    firestoreName?: string;

    /**
     * Collections that exist in this database
     * Used for validation and documentation
     */
    collections: string[];

    /**
     * Whether this database should be available in emulator mode
     * Default: true
     */
    emulatorSupport?: boolean;

    /**
     * Custom initialization options for this specific database
     * Rarely needed
     */
    initOptions?: Record<string, any>;
  };
};
```

### Key Configuration Decisions

1. **Database Names** (`DatabaseName` type)
   - Use descriptive names that reflect purpose (e.g., `identityDB`, `contentDB`)
   - Use consistent naming convention (camelCase with 'DB' suffix recommended)
   - These become your type-safe API throughout the app

2. **Firestore Names** (`firestoreName` property)
   - What the database is actually called in Firebase console
   - Can differ from your logical `DatabaseName`
   - Example: `identityDB` → `identity` in production

3. **Collections Array**
   - List all collections that exist in each database
   - Used for documentation and future validation features
   - Keep this updated as your schema evolves

---

## API Reference

### Core Connector Class

#### `FirestoreConnector<TDatabaseNames>`

The main connector class (you typically won't use this directly, but through your singleton):

```typescript
class FirestoreConnector<TDatabaseNames extends string> {
  constructor(config: DatabaseConfig<TDatabaseNames>, options?: FirebaseInitOptions)

  // Connection management
  initializeFirebase(): void
  closeConnections(): Promise<void>
  isInitialized(): boolean

  // Database access
  getDb(): DatabaseInstances<TDatabaseNames>
  getDbByName(dbName: TDatabaseNames): Firestore
  getCollection(dbName: TDatabaseNames, collectionName: string): CollectionReference

  // Testing & monitoring
  testDatabaseConnection(dbName: TDatabaseNames): Promise<boolean>
  testAllDatabaseConnections(): Promise<DatabaseConnectionResult<TDatabaseNames>>
  healthCheck(): Promise<HealthCheckResult<TDatabaseNames>>

  // Configuration
  getDatabaseNames(): TDatabaseNames[]
  getCollectionsForDatabase(dbName: TDatabaseNames): string[]
  getAllCollections(): Record<TDatabaseNames, string[]>

  // State management (primarily for testing)
  getConnectionState(): FirebaseConnectionState
  resetConnectionState(): void
}
```

### Factory Functions

#### `createSingleDatabaseConnector()`

For simple single-database projects:

```typescript
createSingleDatabaseConnector(
  projectId: string,      // Not currently used, kept for API compatibility
  collections: string[],
  options?: FirebaseInitOptions
): FirestoreConnector<'main'>

// Example:
const connector = createSingleDatabaseConnector('my-project', [
  'users',
  'posts',
  'comments'
]);
```

#### `createMultiDatabaseConnector()`

For multi-database projects (recommended):

```typescript
createMultiDatabaseConnector<T extends string>(
  config: DatabaseConfig<T>,
  options?: FirebaseInitOptions
): FirestoreConnector<T>

// Example:
const connector = createMultiDatabaseConnector(DATABASE_CONFIG);
```

### Initialization Options

```typescript
interface FirebaseInitOptions {
  /** Force re-initialization even if already initialized */
  forceReinitialize?: boolean;

  /** Skip database instance initialization (rare use case) */
  skipDatabaseInit?: boolean;

  /** Enable test mode (for unit tests) */
  testMode?: boolean;

  /** Force emulator mode regardless of environment */
  emulatorMode?: boolean;
}
```

---

## Environment Variables

The connector reads standard Firebase environment variables:

### Required

```bash
# Project ID (at least one required)
FIREBASE_PROJECT_ID=your-project-id
# OR
GCLOUD_PROJECT=your-project-id

# Service account credentials (required unless in Firebase Functions environment)
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
```

### Optional

```bash
# Firebase URLs (auto-generated if not provided)
FIREBASE_DATABASE_URL=https://your-project.firebaseio.com
FIREBASE_STORAGE_BUCKET=your-project.appspot.com

# Emulator settings
FIRESTORE_EMULATOR_HOST=localhost:8080
FIRESTORE_EMULATOR_PORT=8080
FUNCTIONS_EMULATOR=true
```

---

## Usage Patterns

### Singleton Pattern (Recommended)

**Why Singleton?**
- Firebase Admin SDK initialization is expensive
- Single connection pool for all database operations
- Consistent state across your application

**How it works:**

```typescript
// In config/firestore.config.ts
export const connector = createYourProjectConnector();

// In your repositories (instantiated multiple times)
import { getDbByName } from '../config/firestore.config';

// Every repository gets the same connector instance
const db = getDbByName('usersDB');
```

### Direct Connector Access

For advanced use cases (testing, health checks, etc.):

```typescript
import { connector } from './config/firestore.config';

// Access connector methods directly
const state = connector.getConnectionState();
const allDbs = connector.getDatabaseNames();
const isHealthy = await connector.testDatabaseConnection('usersDB');
```

---

## Testing

### Unit Tests

Mock the config module:

```typescript
// In your test file
jest.mock('../config/firestore.config', () => ({
  getDbByName: jest.fn(() => ({
    collection: jest.fn(() => ({
      doc: jest.fn(),
      get: jest.fn(),
      add: jest.fn()
    }))
  }))
}));
```

### Integration Tests

Use the connector directly with emulator:

```typescript
import { connector, initializeFirebase } from './config/firestore.config';

beforeAll(() => {
  process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080';
  connector.resetConnectionState();
  initializeFirebase();
});

afterAll(async () => {
  await connector.closeConnections();
});
```

---

## Environment Detection

The connector automatically detects your environment:

### Emulator Mode
- **Trigger**: `FIRESTORE_EMULATOR_HOST` or `FUNCTIONS_EMULATOR` env var
- **Behavior**: All databases point to same Firestore instance
- **Note**: Named databases not supported in emulator

### Production Mode
- **Trigger**: `K_SERVICE` or `GCLOUD_PROJECT` env var
- **Behavior**: Each database gets separate named Firestore instance
- **Note**: Uses `firestoreName` from config

### Functions Environment
- **Trigger**: `FUNCTIONS_EMULATOR` or `K_SERVICE` env var
- **Behavior**: Uses default Firebase Admin initialization
- **Note**: No service account credentials required

You can check environment programmatically:

```typescript
import { detectEnvironment } from './utilities/firestore-connector';

const env = detectEnvironment();
console.log({
  isEmulator: env.isEmulator,
  isProduction: env.isProduction,
  isFunctionsEnvironment: env.isFunctionsEnvironment,
  projectId: env.projectId
});
```

---

## Health Checks & Monitoring

### Health Check

Comprehensive check of Firebase and all databases:

```typescript
import { healthCheck } from './config/firestore.config';

const health = await healthCheck();
// {
//   firebase: true,
//   databases: { usersDB: true, contentDB: true, analyticsDB: true },
//   timestamp: Date
// }
```

**What it tests:**
- Firebase Admin SDK connectivity
- Each database's ability to write/read/delete documents
- Creates temporary test documents in `connection-test` collection

**When to use:**
- Once at application startup
- In health check endpoints
- Before critical operations

**Performance Note:** Health checks are expensive (write operations). Use sparingly in production.

### Connection Tests

Lightweight database availability checks:

```typescript
import { connector } from './config/firestore.config';

// Test single database
const isHealthy = await connector.testDatabaseConnection('usersDB');

// Test all databases
const results = await connector.testAllDatabaseConnections();
// { usersDB: true, contentDB: true, analyticsDB: false }
```

---

## Troubleshooting

### "Database instance not found"

**Problem:** Trying to access a database that doesn't exist in your config.

**Solution:**
```typescript
import { connector } from './config/firestore.config';

// Check what databases are available
const available = connector.getDatabaseNames();
console.log('Available databases:', available);

// Check collections per database
const collections = connector.getAllCollections();
console.log('Database collections:', collections);
```

### "Firebase not initialized"

**Problem:** Trying to use databases before calling `initializeFirebase()`.

**Solution:**
```typescript
import { connector, initializeFirebase } from './config/firestore.config';

// Check initialization status
if (!connector.isInitialized()) {
  initializeFirebase();
}
```

### Emulator Connection Issues

**Problem:** Can't connect to Firebase emulator.

**Solution:**
```bash
# 1. Start emulator
firebase emulators:start --only firestore

# 2. Set environment variable
export FIRESTORE_EMULATOR_HOST=localhost:8080

# 3. Verify in code
import { detectEnvironment } from './utilities/firestore-connector';
console.log(detectEnvironment().isEmulator); // Should be true
```

### Type Errors with DatabaseName

**Problem:** TypeScript complaining about database names.

**Solution:** Ensure your `DatabaseName` type includes all databases:
```typescript
// ❌ Wrong
export type DatabaseName = 'usersDB' | 'contentDB';
const db = getDbByName('analyticsDB'); // Type error!

// ✅ Correct
export type DatabaseName = 'usersDB' | 'contentDB' | 'analyticsDB';
const db = getDbByName('analyticsDB'); // Works!
```

---

## Best Practices

### 1. Single Source of Configuration

Keep all Firestore configuration in `config/firestore.config.ts`:
- Database names
- Collection lists
- Singleton connector
- Helper functions

### 2. Consistent Naming

Use consistent naming throughout:
- **Database names**: camelCase + 'DB' suffix (e.g., `identityDB`, `wishlistDB`)
- **Firestore names**: lowercase (e.g., `identity`, `wishlist`)
- **Collections**: camelCase (e.g., `userProfiles`, `accountMemberships`)

### 3. Type Safety

Always use the `DatabaseName` type:
```typescript
// ✅ Good - Type safe
function processData(dbName: DatabaseName) {
  const db = getDbByName(dbName);
}

// ❌ Bad - No type safety
function processData(dbName: string) {
  const db = getDbByName(dbName as any);
}
```

### 4. Initialize Early

Initialize Firebase at application startup:
```typescript
// index.ts (entry point)
import { initializeFirebase } from './config/firestore.config';

try {
  initializeFirebase();
  logger.info('Firebase ready');
} catch (error) {
  logger.error('Firebase initialization failed', error);
  process.exit(1); // Fail fast
}
```

### 5. Use Repositories

Don't access `getDbByName()` directly from services/controllers:
```typescript
// ✅ Good - Repository pattern
class UsersService {
  constructor(private usersRepo: UsersRepository) {}

  async getUser(id: string) {
    return this.usersRepo.getUserById(id);
  }
}

// ❌ Bad - Direct database access
class UsersService {
  async getUser(id: string) {
    const db = getDbByName('usersDB');
    return db.collection('users').doc(id).get();
  }
}
```

### 6. Document Your Schema

Keep the `collections` array updated:
```typescript
export const DATABASE_CONFIG: DatabaseConfig<DatabaseName> = {
  usersDB: {
    firestoreName: 'users',
    collections: [
      'profiles',    // User profile data
      'sessions',    // Active sessions
      'preferences'  // User settings
    ],
    emulatorSupport: true
  }
};
```

---

## Performance Considerations

### Connection Pooling
- Firebase Admin SDK manages connection pooling automatically
- Each database instance reuses connections efficiently
- No manual connection management needed

### Emulator vs Production
- **Emulator**: All databases use same Firestore instance (emulator limitation)
- **Production**: Each database gets separate named Firestore instance
- Switch detected automatically via environment variables

### Initialization Cost
- Firebase Admin SDK initialization is expensive (~100-500ms)
- Use singleton pattern to initialize once
- Lazy initialization supported (automatic on first `getDb()` call)

### Health Check Frequency
- Health checks write/read/delete test documents (expensive)
- Recommended: Once per startup + in health check endpoints
- Avoid: On every request or in hot paths

---

## Real-World Example: Wishlist Platform

See how the Wishlist Platform uses this connector:

**File: `functions/src/config/firestore.config.ts`**

```typescript
// 6 databases with clear domain separation
export type DatabaseName =
  | 'identityDB'         // Users, accounts, auth
  | 'wishlistDB'         // Lists, items, occasions
  | 'relationshipsDB'    // Contacts, addresses
  | 'coordinationDB'     // Claims, group gifts, subscriptions
  | 'communicationsDB'   // Notifications, messages
  | 'systemDB';          // Logs, analytics

export const DATABASE_CONFIG: DatabaseConfig<DatabaseName> = {
  identityDB: {
    firestoreName: 'identity',
    collections: ['users', 'accounts', 'accountMemberships'],
    emulatorSupport: true
  },
  // ... other databases
};

export const connector = createWishlistConnector();
export const initializeFirebase = () => connector.initializeFirebase();
export const getDbByName = (dbName: DatabaseName) => connector.getDbByName(dbName);
```

**Usage in Repository:**

```typescript
import { getDbByName } from '../config/firestore.config';

export class UsersRepository {
  private db: Firestore;
  private collection: FirebaseFirestore.CollectionReference;

  constructor() {
    this.db = getDbByName('identityDB');
    this.collection = this.db.collection('users');
  }

  async createUser(data: UserCreateDto): Promise<User> {
    const docRef = await this.collection.add(data);
    const doc = await docRef.get();
    return { userUID: doc.id, ...doc.data() };
  }
}
```

---

## Related Documentation

- [Firebase Admin SDK Documentation](https://firebase.google.com/docs/admin/setup)
- [Firestore Data Model](https://firebase.google.com/docs/firestore/data-model)
- [Named Databases](https://firebase.google.com/docs/firestore/use-multiple-databases)

---

## License

Internal utility for use within project ecosystems.
