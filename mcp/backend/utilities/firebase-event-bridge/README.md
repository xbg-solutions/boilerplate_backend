// src/utilities/firebase-event-bridge/README.md

# Firebase Event Bridge Utility

A reusable, configuration-driven utility that bridges Firebase triggers (Firestore, Auth, Storage) to an internal event bus with normalized event payloads and PII-safe logging.

## Overview

This utility implements the **event-driven choreography** pattern by:
1. Listening to Firebase service events (Firestore, Auth, Storage)
2. Normalizing event payloads to a consistent structure
3. Mapping Firebase events to domain events via configurable mapping layer
4. Publishing domain events to an internal event bus
5. Enabling platform-agnostic event subscribers

**Key Architectural Insight:**
- Services emit domain events directly to the event bus when operations occur
- Firebase triggers (via this bridge) also publish to the SAME event bus when data changes
- Subscribers listen to ONE unified event bus, unaware of event source (service or Firebase)
- This allows both synchronous (service) and asynchronous (Firebase trigger) event sources

## Key Features

### 🔄 **Platform Abstraction**
- Firebase-specific triggers isolated in one utility
- Business logic subscribes to normalized events
- Easy migration path away from Firebase (only this utility changes)

### ⚙️ **Configuration-Driven**
- Define which collections/operations trigger events via config
- Per-database Firestore trigger configuration
- Event name overrides for subcollections
- Dynamic event mapping from Firebase events to domain events

### 🔒 **PII-Safe Logging**
- Never logs document data or event payloads
- Only logs metadata (event names, IDs, operations)
- Compliant with GDPR, SOC 2, Essential Eight
- Comprehensive logging safety enforcement

### 🎯 **Type-Safe Events**
- Strongly typed normalized event structure
- TypeScript interfaces for all configurations
- Intellisense support throughout

## Architecture
```
┌─────────────────────────────────────────────────────────────────┐
│                        Event Bus (Unified)                       │
│                                                                  │
│  Domain Events: USER_CREATED, FILE_UPLOADED, AUTH_LOGIN, etc.   │
└─────────────────────────────────────────────────────────────────┘
           ▲                                    ▲
           │                                    │
    ┌──────┴──────┐                    ┌───────┴────────┐
    │  Services   │                    │ Firebase Bridge │
    │             │                    │                 │
    │ Emit events │                    │ Normalizes and  │
    │ directly    │                    │ publishes events│
    └─────────────┘                    └─────────────────┘
                                                ▲
                                                │
                                       ┌────────┴────────┐
                                       │ Firebase Triggers│
                                       │ (Firestore, etc.)│
                                       └─────────────────┘
           │
           ▼
    ┌──────────────┐
    │ Subscribers  │
    │              │
    │ React to all │
    │ events       │
    └──────────────┘
```

### Event Flow - Two Paths to Same Bus

**Path 1: Service → Event Bus → Subscribers**
1. Service performs operation (e.g., `userService.create()`)
2. Service emits domain event to event bus (e.g., `USER_CREATED`)
3. Subscribers react immediately to event

**Path 2: Firebase Trigger → Bridge → Event Bus → Subscribers**
1. Firestore document changes (e.g., user created in database)
2. Firebase trigger fires
3. Adapter receives raw Firebase event
4. Normalizer creates standardized event structure
5. Event mapping translates Firebase event to domain event
6. Bridge publishes domain event to event bus (e.g., `USER_CREATED`)
7. Same subscribers react to event (unaware of source)

### Why Two Paths?

**Path 1: Services emit events** when they perform actions (immediate, synchronous)
- API endpoints call services
- Services orchestrate business logic
- Services emit domain events directly

**Path 2: Firebase triggers emit events** when:
- **Client direct interactions** - Client uploads files to Storage, authenticates with Auth (bypasses API)
- **External data changes** - Admin console, batch jobs, mobile SDKs writing directly to Firestore
- **Data integrity events** - Document lifecycle events for validation/cleanup

### Key Use Cases for Firebase Event Bridge

#### 1. File Uploads (Client → Storage → Firestore Sync)
```
Client uploads image → Firebase Storage → Storage trigger fires
  → Bridge publishes FILE_UPLOADED → Subscriber updates Firestore record
```
**Why needed:** Client uploads directly to Storage, our API is NOT involved

#### 2. Authentication (Client → Auth → Firestore Sync)
```
Client signs up → Firebase Auth → Firestore trigger fires
  → Bridge publishes USER_CREATED → Subscriber creates account, sends welcome
```
**Why needed:** Client authenticates directly with Auth, our API is NOT involved

## Installation

This utility is already part of your project utilities. No installation needed.

## Usage

### 1. Create Configuration
```typescript
// src/config/firebase-triggers.config.ts
import { FirebaseEventBridgeConfig } from '../utilities/firebase-event-bridge';
import { eventBus } from '../utilities/events';

export const firebaseTriggerConfig: FirebaseEventBridgeConfig = {
  eventBus,

  firestore: {
    enabled: true,
    databases: [
      {
        databaseName: 'main',
        collections: [
          {
            path: 'users',
            operations: ['create', 'update', 'delete'],
            includeData: true
          },
          {
            path: 'orders',
            operations: ['create', 'update', 'delete'],
            includeData: true
          }
        ]
      },
      {
        databaseName: 'analytics',
        collections: [
          {
            path: 'events',
            operations: ['create'],
            includeData: false
          }
        ]
      }
    ]
  },

  auth: {
    enabled: true,
    operations: ['create', 'delete']
  },

  storage: {
    enabled: true,
    pathPatterns: ['uploads/**', 'profiles/**'],
    includeMetadata: true
  }
};
```

### 2. Initialize Bridge and Export Triggers
```typescript
// src/triggers/firebase-bridge.triggers.ts
import { FirebaseEventBridge } from '../utilities/firebase-event-bridge';
import { firebaseTriggerConfig } from '../config/firebase-triggers.config';
import { logger } from '../utilities/logger';

logger.info('Initializing Firebase Event Bridge');

const bridge = new FirebaseEventBridge(firebaseTriggerConfig);
const triggers = bridge.generateTriggers();

logger.info('Firebase Event Bridge initialized', {
  totalTriggers: Object.keys(triggers).length,
  triggerNames: Object.keys(triggers)
});

export const firebaseBridgeTriggers = triggers;
```

### 3. Export Triggers in Main Index
```typescript
// src/index.ts
import * as functions from 'firebase-functions';
import express from 'express';

const app = express();

// ... your existing Express setup

// Export HTTP function
export const api = functions.https.onRequest(app);

// Export all Firebase triggers
import { firebaseBridgeTriggers } from './triggers/firebase-bridge.triggers';

Object.entries(firebaseBridgeTriggers).forEach(([name, trigger]) => {
  exports[name] = trigger;
});

logger.info('Firebase triggers exported', {
  triggerCount: Object.keys(firebaseBridgeTriggers).length,
  triggerNames: Object.keys(firebaseBridgeTriggers)
});
```

### 4. Initialize Subscribers on Startup
```typescript
// src/index.ts (continued)
import { NotificationSubscribers } from './subscribers/notifications.subscriber';

const notificationSubscribers = new NotificationSubscribers(logger);

// Initialize all subscribers
notificationSubscribers.initialize();

logger.info('Event subscribers initialized');
```

### 5. Create Subscriber Classes
```typescript
// src/subscribers/notifications.subscriber.ts
import { Logger } from '../utilities/logger';
import { eventBus, EventType } from '../utilities/events';
import type { UserCreatedPayload } from '../utilities/events/event-types';

/**
 * Notification Subscribers Class
 * Listens to domain events and creates appropriate notifications
 */
export class NotificationSubscribers {
  private logger: Logger;
  private isInitialized = false;

  constructor(logger: Logger) {
    this.logger = logger.child({ component: 'NotificationSubscribers' });
  }

  initialize(): void {
    if (this.isInitialized) {
      this.logger.warn('Notification subscribers already initialized');
      return;
    }

    this.logger.info('Initializing notification subscribers');

    // Subscribe to domain events (both service-emitted and Firebase-triggered)
    eventBus.subscribe(EventType.USER_CREATED, this.handleUserCreated.bind(this));
    eventBus.subscribe(EventType.FILE_UPLOADED, this.handleFileUploaded.bind(this));

    this.isInitialized = true;
    this.logger.info('Notification subscribers initialized successfully');
  }

  private async handleUserCreated(payload: UserCreatedPayload): Promise<void> {
    const handlerLogger = this.logger.child({
      handler: 'handleUserCreated',
      userUID: payload.userUID
    });

    handlerLogger.debug('Processing USER_CREATED event');

    try {
      // Send welcome email, create CRM contact, etc.
      handlerLogger.info('USER_CREATED event processed');
    } catch (error) {
      handlerLogger.error('Failed to process USER_CREATED event', error as Error);
    }
  }
}
```

## Event Mapping

The event mapping layer translates Firebase-specific events into domain events. This is configured in `functions/src/config/firebase-event-mapping.config.ts`.

### How Mapping Works

1. **Custom mappings** — Specific collections can be mapped to specific `EventType` members:
```typescript
const CUSTOM_FIRESTORE_MAPPINGS = {
  users: {
    created: EventType.USER_CREATED,
    updated: EventType.USER_UPDATED,
    deleted: EventType.USER_DELETED,
  },
};
```

2. **Dynamic mappings** — Unmapped collections automatically get `{collection}.{operation}` events:
   - `firestore.orders.created` → `orders.created` event on the bus
   - `firestore.products.updated` → `products.updated` event on the bus

3. **Auth mappings** — Auth events map to standard domain events:
   - `auth.user.created` → `EventType.USER_CREATED`
   - `auth.user.deleted` → `EventType.USER_DELETED`

4. **Storage mappings** — Storage events map to file events:
   - `storage.object.finalized` → `EventType.FILE_UPLOADED`
   - `storage.object.deleted` → `EventType.FILE_DELETED`

### Adding Custom Mappings

To map a specific collection to a domain event, add entries to `CUSTOM_FIRESTORE_MAPPINGS`:

```typescript
const CUSTOM_FIRESTORE_MAPPINGS = {
  users: {
    created: EventType.USER_CREATED,
    updated: EventType.USER_UPDATED,
    deleted: EventType.USER_DELETED,
  },
  // Add your project-specific mappings:
  orders: {
    created: EventType.ORDER_CREATED,  // requires adding ORDER_CREATED to EventType enum
  },
};
```

## Configuration Options

### Firestore Configuration
```typescript
interface FirestoreConfig {
  enabled: boolean;
  databases: FirestoreDatabaseConfig[];
}

interface FirestoreDatabaseConfig {
  databaseName: DatabaseName;  // 'main', 'analytics', etc.
  collections: FirestoreCollectionConfig[];
}

interface FirestoreCollectionConfig {
  path: string;                 // 'users' or 'orders/{orderId}/items'
  operations: FirestoreOperation[];  // ['create', 'update', 'delete']
  includeData: boolean;         // Include full document in event.raw
  eventNameOverride?: string;   // Override collection name in event
}
```

**Event Naming:**
- Default: `firestore.{collection}.{operation}`
- With override: `firestore.{eventNameOverride}.{operation}`

**Examples:**
- `firestore.users.created` - User document created in Firestore
- `firestore.orders.updated` - Order document updated in Firestore
- `firestore.order_items.created` - Subcollection (with override)

### Auth Configuration
```typescript
interface AuthConfig {
  enabled: boolean;
  operations: AuthOperation[];  // ['create', 'delete']
}
```

**Event Naming:**
- `auth.user.created` - User created in Firebase Auth
- `auth.user.deleted` - User deleted from Firebase Auth

### Storage Configuration
```typescript
interface StorageConfig {
  enabled: boolean;
  pathPatterns: string[];      // ['uploads/**', 'profiles/**']
  includeMetadata: boolean;    // Include file metadata in event.raw
}
```

**Event Naming:**
- `storage.object.finalized` - File upload completed

## Event Structure

### NormalizedFirebaseEvent
```typescript
interface NormalizedFirebaseEvent {
  // Standard metadata
  eventId: string;              // Unique event identifier
  eventName: string;            // e.g., 'firestore.users.created'
  timestamp: Date;              // When event occurred
  source: 'firestore' | 'auth' | 'storage';

  // Normalized fields (convenient access)
  normalized: {
    databaseName?: string;      // Firestore database name
    documentId?: string;        // Firestore document ID
    documentPath?: string;      // Full Firestore path
    collection?: string;        // Collection name
    userId?: string;            // Auth user ID
    filePath?: string;          // Storage file path
    operation?: string;         // 'create', 'update', 'delete'
  };

  // Raw Firebase payload (use with caution - may contain PII)
  raw: any;

  // For updates: before/after data
  changes?: {
    before: any;
    after: any;
  };
}
```

## Trigger Naming Convention

Generated trigger function names follow this pattern:

**Firestore:** `{database}{Collection}{Operation}`
- `mainUsersCreated`
- `mainOrdersUpdated`
- `analyticsEventsCreated`

**Auth:** `authUser{Operation}`
- `authUserCreated`
- `authUserDeleted`

**Storage:** `storageObjectFinalized`

## Logging Safety

### ✅ SAFE to Log
- Event names, IDs, types
- Document IDs, UIDs
- Collection/database names
- Operation types
- Metadata counts

### ❌ NEVER Log
- `event.raw` - Contains document data
- `event.changes` - Contains before/after data
- Firebase event data/metadata
- User information (email, phone, addresses)

### Example
```typescript
// ✅ GOOD - Safe logging
logger.info('Event processed', {
  eventName: event.eventName,
  eventId: event.eventId,
  documentId: event.normalized.documentId,
  operation: event.normalized.operation
});

// ❌ BAD - Logging PII
logger.debug('Event details', {
  raw: event.raw,           // Contains document data!
  changes: event.changes    // Contains before/after data!
});
```

## Error Handling

The bridge uses a **swallow and emit** error handling strategy:

1. Errors in event handling are caught and logged
2. A `system.event_bridge.error` event is emitted
3. Original event processing doesn't block other triggers
4. Subscribers can listen to error events for custom handling
```typescript
// Subscribe to error events
eventBus.subscribe('system.event_bridge.error', async (errorEvent) => {
  logger.error('Event bridge error detected', {
    originalEvent: errorEvent.originalEvent,
    eventId: errorEvent.eventId,
    error: errorEvent.error
  });

  // Send alert, retry, or custom error handling
});
```

## Testing

See unit tests in `__tests__/` directory for comprehensive examples.

### Mock Event Bus for Testing
```typescript
// In your tests
const mockEventBus = {
  publish: jest.fn(),
  subscribe: jest.fn(),
  listenerCount: jest.fn()
};

const config: FirebaseEventBridgeConfig = {
  eventBus: mockEventBus as any,
  firestore: { /* config */ }
};

const bridge = new FirebaseEventBridge(config);
const triggers = bridge.generateTriggers();

// Verify triggers were created
expect(Object.keys(triggers).length).toBeGreaterThan(0);
```

## Migration Path

If migrating away from Firebase:

1. **Keep event subscribers unchanged** - they listen to normalized events
2. **Replace this utility** - new bridge for different platform
3. **Update configuration** - map new platform events to same event names
4. **Business logic unaffected** - services continue working

## Performance Considerations

### Trigger Count
- Each collection + operation = 1 trigger function
- Example: 5 collections × 3 operations = 15 triggers
- Firebase has no practical limit on trigger count

### Cold Starts
- Each trigger function instance starts independently
- Initial invocation has ~500ms-2s cold start
- Subsequent invocations are warm (~50ms)

### Event Volume
- High-write collections generate many events
- Consider batching or throttling in subscribers
- Event bus is in-memory (same function instance)

## Related Documentation

- [Architecture Governance Document](../../../__docs__/20251005_arch_governance_doc.md#55-event-driven-patterns)
- [Event Bus Utility](../events/README.md)
- [Logging Standards](../logger/README.md)

## Extending

### Adding New Event Sources

1. Create new adapter in `adapters/`
2. Add configuration interface to `config-types.ts`
3. Update `TriggerFactory` to generate triggers
4. Update `FirebaseEventBridge` to call factory method

### Custom Event Names

Use `eventNameOverride` for subcollections or to create semantic event names:
```typescript
{
  path: 'orders/{orderId}/items/{itemId}',
  operations: ['create'],
  includeData: true,
  eventNameOverride: 'order_items'
  // Event: firestore.order_items.created
}
```

## Troubleshooting

### Triggers Not Firing

1. Check Firebase Functions deployment logs
2. Verify database names match your Firebase project
3. Ensure collection paths are correct
4. Check trigger function is exported in `src/index.ts`

### Events Not Reaching Subscribers

1. **Check event mapping**: Verify your collection has a mapping in `firebase-event-mapping.config.ts`
2. **Check subscriber registration**: Ensure subscribers are initialized before triggers fire
3. Verify subscriber is listening to the correct `EventType`
4. Look for errors in `system.event_bridge.error` events
5. Enable debug logging: `LOG_LEVEL=debug`

### Too Many Triggers

1. Reduce operations (only what you need)
2. Combine related events in subscribers
3. Use Firestore batch operations to reduce writes
