// src/utilities/firebase-event-bridge/README.md

# Firebase Event Bridge Utility

A reusable, configuration-driven utility that bridges Firebase triggers (Firestore, Auth, Storage) to an internal event bus with normalized event payloads and PII-safe logging.

## Overview

This utility implements the **event-driven choreography** pattern by:
1. Listening to Firebase service events (Firestore, Auth, Storage)
2. Normalizing event payloads to a consistent structure
3. Publishing normalized events to an internal event bus
4. Enabling platform-agnostic event subscribers

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
- Zero hardcoded trigger logic

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
│  Domain Events: USER_CREATED, LIST_SHARED, ITEM_APPROVED, etc. │
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
1. Service performs operation (e.g., `listsService.shareList()`)
2. Service emits domain event to event bus (e.g., `LIST_SHARED`)
3. Subscribers react immediately to event

**Path 2: Firebase Trigger → Bridge → Event Bus → Subscribers**
1. Firestore document changes (e.g., user created in database)
2. Firebase trigger fires
3. Adapter receives raw Firebase event
4. Normalizer creates standardized event structure
5. Bridge publishes domain event to event bus (e.g., `USER_CREATED`)
6. Same subscribers react to event (unaware of source)

### Why Two Paths?

**Path 1: Services emit events** when they perform actions (immediate, synchronous)
- API endpoints call services
- Services orchestrate business logic
- Services emit domain events directly

**Path 2: Firebase triggers emit events** when:
- **Client direct interactions** - Client uploads files to Storage, authenticates with Auth (bypasses API)
- **External data changes** - Admin console, batch jobs, mobile SDKs writing directly to Firestore
- **Data integrity events** - Document lifecycle events for validation/cleanup

**Current Implementation Note:**
In the current state, subscribers only react to domain events emitted by services. Firebase triggers publish Firebase-specific events (`firestore.{collection}.{operation}`) which are not yet mapped to domain events. To achieve true platform abstraction, a mapping layer is needed to convert Firebase events into domain events that subscribers can react to.

### Key Use Cases for Firebase Event Bridge

#### 1. File Uploads (Client → Storage → Firestore Sync)
```
Client uploads image → Firebase Storage → Storage trigger fires
  → Bridge publishes IMAGE_UPLOADED → Subscriber updates Firestore record
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
        databaseName: 'identityDB',
        collections: [
          {
            path: 'users',
            operations: ['create', 'update', 'delete'],
            includeData: true
          },
          {
            path: 'accounts',
            operations: ['create', 'update', 'delete'],
            includeData: true
          }
        ]
      },
      {
        databaseName: 'wishlistDB',
        collections: [
          {
            path: 'lists',
            operations: ['create', 'update', 'delete'],
            includeData: true
          },
          {
            path: 'items',
            operations: ['create', 'update', 'delete'],
            includeData: true
          },
          {
            path: 'items/{itemUID}/images',
            operations: ['create', 'delete'],
            includeData: false,
            eventNameOverride: 'item_images'  // Event: firestore.item_images.created
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
    pathPatterns: ['items/**', 'profiles/**'],
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
import { ContactLinkingSubscribers } from './subscribers/contact-linking.subscriber';

const notificationSubscribers = new NotificationSubscribers(logger);
const contactLinkingSubscribers = new ContactLinkingSubscribers(logger);

// Initialize all subscribers
notificationSubscribers.initialize();
contactLinkingSubscribers.initialize();

logger.info('Event subscribers initialized', {
  subscribers: ['NotificationSubscribers', 'ContactLinkingSubscribers']
});
```

### 5. Create Subscriber Classes
```typescript
// src/subscribers/notifications.subscriber.ts
import { Logger } from '../utilities/logger';
import { eventBus, EventType } from '../utilities/events';
import type { ListSharedPayload } from '../utilities/events/event-types';

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

  /**
   * Initialize all notification subscribers
   * Call this once during application startup
   */
  initialize(): void {
    if (this.isInitialized) {
      this.logger.warn('Notification subscribers already initialized');
      return;
    }

    this.logger.info('Initializing notification subscribers');

    // Subscribe to domain events (both service-emitted and Firebase-triggered)
    eventBus.subscribe(EventType.LIST_SHARED, this.handleListShared.bind(this));
    eventBus.subscribe(EventType.ITEM_CREATED, this.handleItemCreated.bind(this));
    eventBus.subscribe(EventType.USER_ADDED_TO_ACCOUNT, this.handleUserAdded.bind(this));

    this.isInitialized = true;
    this.logger.info('Notification subscribers initialized successfully');
  }

  /**
   * Handle LIST_SHARED event
   *
   * Current State:
   * - This event is ONLY triggered by lists.service.ts shareList() method
   * - Firebase triggers do NOT emit domain events yet
   *
   * Future State (with event mapping):
   * - Would also be triggered by Firestore trigger on lists collection update
   * - Subscriber would be unaware of event source (service vs Firebase)
   */
  private async handleListShared(payload: ListSharedPayload): Promise<void> {
    const handlerLogger = this.logger.child({
      handler: 'handleListShared',
      listUID: payload.listUID
    });

    handlerLogger.debug('Processing LIST_SHARED event');

    try {
      // Get list details
      const list = await listsRepository.getListById(payload.listUID, handlerLogger);
      if (!list) {
        handlerLogger.warn('List not found, skipping notification');
        return;
      }

      // Create notifications for each contact...
      handlerLogger.info('LIST_SHARED event processed');
    } catch (error) {
      handlerLogger.error('Failed to process LIST_SHARED event', error as Error);
    }
  }
}
```

## Configuration Options

### Firestore Configuration
```typescript
interface FirestoreConfig {
  enabled: boolean;
  databases: FirestoreDatabaseConfig[];
}

interface FirestoreDatabaseConfig {
  databaseName: DatabaseName;  // 'identityDB', 'wishlistDB', etc.
  collections: FirestoreCollectionConfig[];
}

interface FirestoreCollectionConfig {
  path: string;                 // 'users' or 'items/{itemUID}/images'
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
- `firestore.items.updated` - Item document updated in Firestore
- `firestore.item_images.created` - Image subcollection (with override)

**⚠️ ARCHITECTURAL NOTE:**
The current implementation publishes Firebase-specific event names (`firestore.users.created`) to the event bus. For complete platform abstraction, there should be a mapping layer that translates these to domain events (`USER_CREATED`, `ITEM_UPDATED`, etc.) matching the events emitted by services. This would allow subscribers to remain truly platform-agnostic.

**Current State:**
- Services emit domain events: `USER_CREATED`, `LIST_SHARED`, `ITEM_APPROVED`
- Firebase Bridge emits Firebase events: `firestore.users.created`, `firestore.lists.updated`
- Subscribers listen to domain events (from services only)

**Future Enhancement:**
Add event mapping configuration to translate Firebase events to domain events:
```typescript
eventMapping: {
  'firestore.users.created': EventType.USER_CREATED,
  'firestore.lists.updated': (data) => data.sharedWith ? EventType.LIST_SHARED : null,
  // ... conditional mappings
}
```

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

**Note:** Auth triggers use Firestore triggers on the `users` collection in `identityDB` as a proxy since Firebase Functions v2 doesn't provide direct auth event triggers.

### Storage Configuration
```typescript
interface StorageConfig {
  enabled: boolean;
  pathPatterns: string[];      // ['items/**', 'profiles/**']
  includeMetadata: boolean;    // Include file metadata in event.raw
}
```

**Event Naming:**
- `storage.object.finalized` - File upload completed

**Path Patterns:**
- `items/**` - Matches `items/abc/image.jpg`, `items/xyz/photo.png`
- `profiles/*` - Matches `profiles/user123.jpg` (single level only)

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
- `identityUsersCreated`
- `wishlistItemsUpdated`
- `wishlistItemImagesDeleted` (with override)

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
- [Data Schema Specification](../../../__docs/20250101_data_schema_specification.md)

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
  path: 'items/{itemUID}/contributors/{contributorUID}',
  operations: ['create'],
  includeData: true,
  eventNameOverride: 'item_contributors'
  // Event: firestore.item_contributors.created
}
```

## Current Limitations & Future Enhancements

### Known Limitations

**1. No Firebase-to-Domain Event Mapping**
- Firebase triggers currently publish Firebase-specific event names (`firestore.users.created`)
- Domain subscribers listen to domain events (`USER_CREATED`)
- Result: Subscribers only react to service-emitted events, not Firebase trigger events
- Impact: External data changes (admin SDK, Firebase console) don't trigger subscriber logic

**2. Manual Event Mapping Required**
- Each Firebase event requires manual inspection to determine corresponding domain event
- No declarative configuration for event translation
- Complex conditional logic (e.g., list updated → LIST_SHARED only if sharedWith changed)

### Planned Enhancements

**Event Mapping Layer**
Add configuration-based event mapping to translate Firebase events to domain events:

```typescript
// Future config structure
export const firebaseTriggerConfig = {
  eventBus,
  firestore: { /* ... */ },
  storage: { /* ... */ },

  // NEW: Event mapping configuration
  eventMapping: {
    // ============================================================
    // ESSENTIAL MAPPINGS (Client direct interactions)
    // ============================================================

    // Storage: File uploads (client uploads directly to Storage)
    'storage.object.finalized': (event: NormalizedFirebaseEvent) => {
      const filePath = event.normalized.filePath;

      // Determine event type based on path pattern
      if (filePath.startsWith('items/')) {
        return {
          eventType: EventType.IMAGE_UPLOADED,
          payload: {
            itemUID: extractItemUID(filePath),
            imageUrl: event.raw.mediaLink,
            filePath: filePath,
            contentType: event.raw.contentType,
            size: event.raw.size
          }
        };
      }

      if (filePath.startsWith('profiles/')) {
        return {
          eventType: EventType.PROFILE_IMAGE_UPLOADED,
          payload: {
            userUID: extractUserUID(filePath),
            imageUrl: event.raw.mediaLink,
            filePath: filePath
          }
        };
      }

      return null;
    },

    // Firestore: User creation (client authenticates directly with Auth)
    'firestore.users.created': EventType.USER_CREATED,

    // ============================================================
    // STANDARD MAPPINGS (Simple 1:1)
    // ============================================================

    'firestore.accounts.created': EventType.ACCOUNT_CREATED,
    'firestore.lists.created': EventType.LIST_CREATED,

    // ============================================================
    // CONDITIONAL MAPPINGS (Complex logic)
    // ============================================================

    // Lists: Check if sharedWith changed → LIST_SHARED
    'firestore.lists.updated': (event: NormalizedFirebaseEvent) => {
      const changes = event.changes;
      if (!changes) return null;

      // If sharedWith array changed, emit LIST_SHARED
      if (JSON.stringify(changes.before.sharedWith) !==
          JSON.stringify(changes.after.sharedWith)) {
        return {
          eventType: EventType.LIST_SHARED,
          payload: {
            listUID: event.normalized.documentId,
            sharedBy: changes.after.updatedBy,
            sharedWith: changes.after.sharedWith
          }
        };
      }

      return null; // No domain event for this change
    },

    // Items: Check state transitions → ITEM_APPROVED/ITEM_DENIED
    'firestore.items.updated': (event: NormalizedFirebaseEvent) => {
      const events = [];
      const before = event.changes?.before;
      const after = event.changes?.after;

      if (before.state === 'unapproved' && after.state === 'active') {
        events.push({
          eventType: EventType.ITEM_APPROVED,
          payload: { itemUID: after.itemUID, approvedBy: after.approvedBy }
        });
      }

      if (before.state === 'unapproved' && after.state === 'denied') {
        events.push({
          eventType: EventType.ITEM_DENIED,
          payload: { itemUID: after.itemUID, reviewedBy: after.reviewedBy }
        });
      }

      return events;
    }
  }
};
```

**Benefits:**
- Subscribers truly platform-agnostic
- React to both service and Firebase trigger events
- Declarative, testable event mapping
- Easy to migrate platforms (just update mapping)

## Troubleshooting

### Triggers Not Firing

1. Check Firebase Functions deployment logs
2. Verify database names match your Firebase project
3. Ensure collection paths are correct
4. Check trigger function is exported in `src/index.ts`

### Events Not Reaching Subscribers

1. **Check event name matching**: Firebase events use `firestore.*` naming, domain events use `EventType.*`
2. **Current limitation**: Subscribers only receive service-emitted events, not Firebase trigger events
3. Verify subscriber registered before trigger fires
4. Look for errors in `system.event_bridge.error` events
5. Enable debug logging: `LOG_LEVEL=debug`

### Too Many Triggers

1. Reduce operations (only what you need)
2. Combine related events in subscribers
3. Use Firestore batch operations to reduce writes
