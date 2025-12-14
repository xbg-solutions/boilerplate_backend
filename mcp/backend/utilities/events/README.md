# Event Bus Utility

An internal event-driven architecture utility for the Wishlist Coordination Platform. Provides decoupled communication between components through a publish/subscribe pattern with type-safe event handling.

## Overview

This utility implements the **event-driven choreography** pattern described in the [Architecture Governance Document](../../../__docs__/20251005_arch_governance_doc.md#55-event-driven-patterns). It enables loose coupling between services and supports asynchronous workflows without direct dependencies.

### Event Sources

Events published to this event bus come from **two sources**:

1. **Services** - Domain events emitted directly by service layer when business logic executes
2. **Firebase Event Bridge** - Normalized Firebase trigger events (Firestore, Auth, Storage) published to the same bus

**Subscribers are platform-agnostic**: They listen to domain events on the event bus, unaware whether the event originated from a service or a Firebase trigger.

## Key Features

### 🔄 **Decoupled Architecture**
- Services publish events without knowing subscribers
- Multiple services can react to the same event
- Easy to add new functionality without modifying existing code
- Clean separation between synchronous and asynchronous operations

### 🛡️ **Type Safety**
- Strongly typed event definitions with TypeScript
- Event payload validation at compile time
- Intellisense support for event types and payloads
- Runtime type checking for event publishing

### ⚡ **Performance**
- Built on Node.js EventEmitter (native performance)
- In-memory event handling (no external dependencies)
- Support for up to 100 concurrent listeners per event
- Non-blocking async event handlers

### 🧪 **Testing Support**
- Easy mocking and testing utilities
- Event listener counting for test assertions
- Clear event handlers for test isolation
- One-time subscription support

## Architecture Pattern

### Unified Event Flow
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

### Two Paths to Same Bus

**Path 1: Service → Event Bus → Subscribers**
```typescript
// 1. Service performs operation (e.g., lists.service.ts shareList())
itemService.claimItem()
  → eventBus.publish(ITEM_CLAIMED, payload)

// 2. Subscribers react immediately
notificationService.subscribe(ITEM_CLAIMED, sendClaimNotification)
analyticsService.subscribe(ITEM_CLAIMED, trackClaimEvent)
auditService.subscribe(ITEM_CLAIMED, logClaimAction)
```

**Path 2: Firebase Trigger → Bridge → Event Bus → Subscribers**
```typescript
// 1. Firestore document changes (e.g., user created in database)
// 2. Firebase trigger fires (via firebase-event-bridge)
// 3. Bridge normalizes and publishes to event bus
// 4. Same subscribers react (unaware of source)
```

## When to Use Each Approach

### ✅ Use Service Events (Path 1)

**Emit events directly from services when:**

- **Service performs the action** - The service is orchestrating the business logic
- **Immediate reaction needed** - Synchronous follow-up actions required
- **Multiple side effects** - Need to trigger notifications, analytics, audit logs
- **Clear business event** - Represents a meaningful domain event (USER_CREATED, LIST_SHARED, ITEM_APPROVED)

**Examples:**
```typescript
// services/lists.service.ts
async shareList(listUID: string, contacts: string[]): Promise<void> {
  // ... business logic to share list

  // Emit event for side effects (notifications, analytics)
  eventBus.publish(EventType.LIST_SHARED, {
    listUID,
    sharedWith: contacts,
    sharedBy: currentUserUID
  });
}

// services/items.service.ts
async approveItem(itemUID: string, approverUID: string): Promise<void> {
  await itemsRepository.updateItemState(itemUID, 'active');

  // Emit event - triggers notification to item submitter
  eventBus.publish(EventType.ITEM_APPROVED, {
    itemUID,
    approvedBy: approverUID
  });
}
```

### ✅ Use Firebase Event Bridge (Path 2)

**⚠️ CURRENT LIMITATION**: The Firebase Event Bridge is configured but does NOT yet emit domain events. See [Firebase Event Bridge README](../firebase-event-bridge/README.md#current-limitations--future-enhancements) for details.

**Firebase triggers are ESSENTIAL for these scenarios:**

#### 1. **Client Direct Interactions** (No API Layer)

**File Uploads - Storage Triggers**
```typescript
// Client uploads directly to Firebase Storage (bypasses our API)
// ❌ Our API is NOT involved in the upload
// ✅ Storage trigger fires → Bridge publishes → Sync metadata to Firestore

// Example: Client uploads item image
// 1. Client: Upload to gs://bucket/items/item-123/photo.jpg
// 2. Firebase: Storage trigger fires
// 3. Bridge: Publishes IMAGE_UPLOADED event
// 4. Subscriber: Updates item record in Firestore with image URL/metadata
```

**Authentication - Auth to Firestore Sync**
```typescript
// Client authenticates directly with Firebase Auth (bypasses our API)
// ❌ Our API is NOT involved in signup/signin
// ✅ Firestore trigger fires → Bridge publishes → Sync user data

// Example: User signs up with Firebase Auth
// 1. Client: firebase.auth().createUserWithEmailAndPassword()
// 2. Firebase Auth: Creates user in Auth system
// 3. Firebase: Firestore trigger fires (users collection onCreate)
// 4. Bridge: Publishes USER_CREATED event
// 5. Subscriber: Creates default account, sends welcome email, analytics
```

#### 2. **External Data Changes**

- **Admin actions** - Data modified via Firebase console, admin SDK, batch jobs
- **Cross-platform sync** - Capturing changes from mobile SDKs writing directly to Firestore
- **Data integrity** - Reacting to document lifecycle events for validation/cleanup
- **Audit trail** - Ensuring ALL data changes are captured, not just service-initiated ones

**Future examples (once event mapping is implemented):**
```typescript
// Scenario 1: File upload metadata sync
// Storage trigger: onObjectFinalized
// Bridge maps: storage.object.finalized → IMAGE_UPLOADED
// Subscriber: Updates Firestore with image URL, dimensions, file size

// Scenario 2: Auth user creation sync
// Firestore trigger: users collection onCreate (created by Auth trigger)
// Bridge maps: firestore.users.created → USER_CREATED
// Subscriber: Creates account, sends welcome notification, tracks signup

// Scenario 3: Admin creates user via Firebase console
// Firestore trigger: users collection onCreate
// Bridge maps: firestore.users.created → USER_CREATED
// Subscriber: Same notification/analytics logic runs
```

### ❌ Do NOT Duplicate Events

**Never emit the same event from both sources:**

```typescript
// ❌ BAD - Double event emission
// services/users.service.ts
async createUser(data: CreateUserDto): Promise<User> {
  const user = await usersRepository.createUser(data);

  // ❌ Service emits event
  eventBus.publish(EventType.USER_CREATED, { userUID: user.userUID });

  return user;
}

// ❌ Firebase trigger ALSO emits same event
// Result: USER_CREATED fires twice, notifications sent twice!
```

**Current best practice:**
- Services emit events for operations they perform
- Firebase triggers are configured but awaiting event mapping layer
- When mapping is implemented, services may STOP emitting certain events if Firebase triggers handle them

### Decision Tree

```
Does a SERVICE perform the operation?
├─ YES → Emit event from service
│         eventBus.publish(EventType.MY_EVENT, payload)
│
└─ NO → Will be handled by Firebase Bridge (future)
          Currently: No event emission
          Future: Firebase trigger → Bridge → Event bus
```

## Event Categories

### User Lifecycle Events
```typescript
USER_CREATED     // New user registration
USER_UPDATED     // Profile changes
USER_DELETED     // Account deletion
```

### Account Management Events
```typescript
ACCOUNT_CREATED  // New coordination group
ACCOUNT_UPDATED  // Settings/membership changes
ACCOUNT_DELETED  // Group dissolution
```

### List Management Events
```typescript
LIST_CREATED     // New wishlist created
LIST_UPDATED     // List details changed
LIST_SHARED      // List shared with contacts
LIST_DELETED     // List removed
```

### Item Lifecycle Events
```typescript
ITEM_CREATED     // New item added to list
ITEM_UPDATED     // Item details modified
ITEM_APPROVED    // Item approved for sharing
ITEM_DENIED      // Item rejected
ITEM_CLAIMED     // Contact claims item
ITEM_UNCLAIMED   // Claim cancelled
ITEM_DELETED     // Item removed
```

### Occasion Events
```typescript
OCCASION_CREATED // New occasion (birthday, holiday)
OCCASION_UPDATED // Occasion details changed
OCCASION_PASSED  // Occasion date has passed
OCCASION_DELETED // Occasion removed
```

### Contact Events
```typescript
CONTACT_CREATED           // New contact added
CONTACT_CONVERTED_TO_USER // Contact becomes app user
CONTACT_DELETED          // Contact removed (⚠️ Missing - see Known Issues)
```

### System Events
```typescript
IMAGE_UPLOADED        // Item image uploaded
NOTIFICATION_SENT     // Notification delivered
NOTIFICATION_FAILED   // Notification delivery failed
```

## Usage

### Publishing Events (Services)

```typescript
import { eventBus, EventType } from '../utilities/events';

// Simple event publishing
eventBus.publish(EventType.LIST_CREATED, {
  listUID: list.listUID,
  listOwnerUID: userId,
  accountUID: list.accountUID
});

// Event with custom payload
eventBus.publish(EventType.ITEM_CLAIMED, {
  itemUID: item.itemUID,
  listUID: item.listUID,
  contactUID: claimingContact.contactUID,
  claimType: 'full_purchase',
  timestamp: new Date()
});
```

### Subscribing to Events (Services)

```typescript
import { eventBus, EventType } from '../utilities/events';

// Permanent subscription
eventBus.subscribe(EventType.ITEM_CLAIMED, async (payload) => {
  await notificationService.notifyItemClaimed({
    itemUID: payload.itemUID,
    contactUID: payload.contactUID
  });
});

// One-time subscription
eventBus.subscribeOnce(EventType.USER_CREATED, async (payload) => {
  await welcomeService.sendWelcomeEmail(payload.userUID);
});

// Type-safe payload handling
eventBus.subscribe<ItemClaimedPayload>(EventType.ITEM_CLAIMED, async (payload) => {
  // payload is fully typed with ItemClaimedPayload interface
  console.log(`Item ${payload.itemUID} claimed by ${payload.contactUID}`);
});
```

### Subscriber Classes (Recommended Pattern)

**Create subscriber classes** to organize event handlers:

```typescript
// src/subscribers/notifications.subscriber.ts
import { Logger } from '../utilities/logger';
import { eventBus, EventType } from '../utilities/events';
import type { ListSharedPayload } from '../utilities/events/event-types';

export class NotificationSubscribers {
  private logger: Logger;
  private isInitialized = false;

  constructor(logger: Logger) {
    this.logger = logger.child({ component: 'NotificationSubscribers' });
  }

  /**
   * Initialize all notification subscribers
   * Call once during application startup
   */
  initialize(): void {
    if (this.isInitialized) {
      this.logger.warn('Notification subscribers already initialized');
      return;
    }

    // Subscribe to domain events (from services or Firebase bridge)
    eventBus.subscribe(EventType.LIST_SHARED, this.handleListShared.bind(this));
    eventBus.subscribe(EventType.ITEM_APPROVED, this.handleItemApproved.bind(this));
    eventBus.subscribe(EventType.USER_ADDED_TO_ACCOUNT, this.handleUserAdded.bind(this));

    this.isInitialized = true;
    this.logger.info('Notification subscribers initialized');
  }

  private async handleListShared(payload: ListSharedPayload): Promise<void> {
    // Subscriber is unaware if event came from service or Firebase trigger
    // Business logic remains the same either way
    this.logger.debug('Processing LIST_SHARED event', {
      listUID: payload.listUID,
      contactCount: payload.sharedWith.length
    });

    // Create notifications for each contact...
  }
}

// Initialize in src/index.ts
const notificationSubscribers = new NotificationSubscribers(logger);
notificationSubscribers.initialize();
```

### Firebase Event Bridge Integration

See [Firebase Event Bridge README](../firebase-event-bridge/README.md) for details on how Firebase triggers publish to this event bus.

**Current State:**
- Firebase triggers are configured and deployed
- Bridge normalizes Firebase events but does NOT yet map them to domain events
- Subscribers currently only react to service-emitted events

**Future State:**
- Event mapping layer will translate Firebase events to domain events
- Subscribers will react to events from both sources identically

## Event Payload Types

### Base Payload
```typescript
interface BaseEventPayload {
  timestamp?: Date;  // Auto-added if not provided
  [key: string]: unknown;
}
```

### Typed Payloads
```typescript
// Item claiming with contribution details
interface ItemClaimedPayload extends BaseEventPayload {
  itemUID: string;
  listUID: string;
  contactUID: string;
  claimType: 'full_purchase' | 'group_contribution';
}

// List sharing with multiple contacts
interface ListSharedPayload extends BaseEventPayload {
  listUID: string;
  sharedWith: string[];  // contactUIDs
  sharedBy: string;      // userUID
}

// Contact conversion to app user
interface ContactConvertedPayload extends BaseEventPayload {
  contactUID: string;
  userUID: string;
  accountUID: string;
}
```

## File Structure

```
events/
├── index.ts           # Barrel exports
├── event-bus.ts       # EventBus class implementation
├── event-types.ts     # Event definitions and payload types
└── README.md          # This documentation
```

## Advanced Usage

### Conditional Event Handling
```typescript
eventBus.subscribe(EventType.ITEM_APPROVED, async (payload) => {
  const item = await itemRepository.getById(payload.itemUID);
  
  // Only send notifications for high-value items
  if (item.estimatedPrice && item.estimatedPrice > 100) {
    await notificationService.notifyHighValueItemApproved(payload);
  }
});
```

### Event Aggregation
```typescript
// Track multiple related events
const claimTracker = new Map<string, ItemClaimedPayload[]>();

eventBus.subscribe(EventType.ITEM_CLAIMED, (payload) => {
  const listClaims = claimTracker.get(payload.listUID) || [];
  listClaims.push(payload);
  claimTracker.set(payload.listUID, listClaims);
  
  // Trigger when list is fully claimed
  if (listClaims.length >= LIST_ITEM_THRESHOLD) {
    eventBus.publish(EventType.LIST_FULLY_CLAIMED, {
      listUID: payload.listUID,
      totalClaims: listClaims.length
    });
  }
});
```

### Error Handling in Subscribers
```typescript
eventBus.subscribe(EventType.ITEM_CREATED, async (payload) => {
  try {
    await analyticsService.trackItemCreation(payload);
  } catch (error) {
    // Log error but don't break other subscribers
    logger.error('Analytics tracking failed', error, {
      eventType: EventType.ITEM_CREATED,
      itemUID: payload.itemUID
    });
  }
});
```

## Testing

### Mock Event Bus
```typescript
// __tests__/mocks/event-bus.mock.ts
export const mockEventBus = {
  publish: jest.fn(),
  subscribe: jest.fn(),
  subscribeOnce: jest.fn(),
  unsubscribe: jest.fn(),
  unsubscribeAll: jest.fn(),
  listenerCount: jest.fn(),
  clear: jest.fn()
};
```

### Testing Event Publishing
```typescript
describe('ListService', () => {
  beforeEach(() => {
    mockEventBus.publish.mockClear();
  });

  it('publishes LIST_CREATED event when list created', async () => {
    const list = await listsService.createList(listData, userId, logger);

    expect(mockEventBus.publish).toHaveBeenCalledWith(
      EventType.LIST_CREATED,
      expect.objectContaining({
        listUID: list.listUID,
        listOwnerUID: userId,
        accountUID: listData.accountUID
      })
    );
  });
});
```

### Testing Event Subscribers
```typescript
describe('NotificationService', () => {
  it('sends notification when item is claimed', async () => {
    const payload: ItemClaimedPayload = {
      itemUID: 'item123',
      listUID: 'list456', 
      contactUID: 'contact789',
      claimType: 'full_purchase'
    };

    // Trigger the subscriber directly
    await notificationService.handleItemClaimed(payload);

    expect(notificationRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'item_claimed',
        recipientUID: expect.any(String)
      })
    );
  });
});
```

## Performance Considerations

### Memory Management
- EventBus singleton prevents memory leaks
- Automatic cleanup of one-time subscriptions
- Maximum 100 listeners per event type (configurable)

### Async Handling
- All event handlers are non-blocking
- Failed handlers don't affect other subscribers
- Event publishing is synchronous, handling is async

### Scalability
- In-memory events (single function instance)
- For multi-instance scaling, consider external message queue
- Current design optimized for Firebase Functions single-instance model

## Security Considerations

### Event Payload Sanitization
```typescript
// Never include sensitive data in events
eventBus.publish(EventType.USER_CREATED, {
  userUID: user.userUID,        // ✅ Safe UID
  accountUID: user.accountUID,  // ✅ Safe UID
  // email: user.email,         // ❌ Never include PII
  // phoneNumber: user.phone    // ❌ Never include PII
});
```

### Access Control
- Events are internal to the application
- No external access to event bus
- Subscribers should validate payload data
- Log security-relevant events for audit

## Extending Events

When adding new event types:

1. **Add to EventType enum**:
```typescript
// In event-types.ts
CONTACT_DELETED = 'contact.deleted',
```

2. **Define payload interface**:
```typescript
export interface ContactDeletedPayload extends BaseEventPayload {
  contactUID: string;
  accountUID: string;
  deletedBy: string; // userUID
}
```

3. **Add to EventPayloadMap**:
```typescript
export interface EventPayloadMap {
  [EventType.CONTACT_DELETED]: ContactDeletedPayload;
  // ... other mappings
}
```


## Summary: Event Emission Rules

### For AI Agents and Developers

**When implementing new features:**

1. **Services perform operations** → Emit events from service layer
   ```typescript
   eventBus.publish(EventType.MY_EVENT, payload);
   ```

2. **External data changes** → Will be handled by Firebase Bridge (future enhancement)
   - DO NOT manually create Firebase triggers that emit domain events
   - Firebase triggers are managed by the firebase-event-bridge utility

3. **Creating subscribers** → Use subscriber classes, initialized on startup
   ```typescript
   export class MySubscribers {
     initialize() {
       eventBus.subscribe(EventType.MY_EVENT, this.handler.bind(this));
     }
   }
   ```

4. **Never duplicate** → Don't emit the same event from both service AND Firebase trigger

5. **Always use EventType enum** → Never use raw strings for event names

6. **Type-safe payloads** → Use interfaces from `event-types.ts`

### Quick Reference

| Scenario | Action | Example |
|----------|--------|---------|
| Service creates list | Emit from service | `eventBus.publish(EventType.LIST_CREATED, ...)` |
| Service shares list | Emit from service | `eventBus.publish(EventType.LIST_SHARED, ...)` |
| Service approves item | Emit from service | `eventBus.publish(EventType.ITEM_APPROVED, ...)` |
| **Client uploads file to Storage** | **Firebase Bridge** | **Storage trigger → IMAGE_UPLOADED** |
| **Client signs up with Auth** | **Firebase Bridge** | **Firestore trigger → USER_CREATED** |
| Admin creates user via console | Firebase Bridge (future) | Currently: No event |
| Batch job updates data | Firebase Bridge (future) | Currently: No event |
| React to any event | Subscriber class | `eventBus.subscribe(EventType.*, handler)` |

## Related Documentation

- [Architecture Governance Document](../../../__docs__/20251005_arch_governance_doc.md#55-event-driven-patterns)
- [Firebase Event Bridge Utility](../firebase-event-bridge/README.md)
- [Service Layer Guidelines](../../../__docs__/20251005_arch_governance_doc.md#52-service-layer)
- [Subscriber Examples](../../subscribers/README.md)