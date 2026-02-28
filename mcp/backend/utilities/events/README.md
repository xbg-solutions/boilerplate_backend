# Event Bus Utility

An internal event-driven architecture utility for the backend boilerplate. Provides decoupled communication between components through a publish/subscribe pattern with type-safe event handling.

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

### Two Paths to Same Bus

**Path 1: Service → Event Bus → Subscribers**
```typescript
// 1. Service performs operation (e.g., userService.createUser())
userService.create(userData, context)
  → eventBus.publish(USER_CREATED, payload)

// 2. Subscribers react immediately
notificationService.subscribe(USER_CREATED, sendWelcomeEmail)
analyticsService.subscribe(USER_CREATED, trackSignupEvent)
crmService.subscribe(USER_CREATED, syncCrmContact)
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
- **Clear business event** - Represents a meaningful domain event (USER_CREATED, AUTH_LOGIN, FILE_UPLOADED)

**Examples:**
```typescript
// services/user.service.ts
async createUser(data: CreateUserDto, context: RequestContext): Promise<ServiceResult<User>> {
  const user = await this.repository.create(data);

  // Emit event for side effects (notifications, analytics)
  eventBus.publish(EventType.USER_CREATED, {
    userUID: user.id,
    email: user.email,
  });

  return { success: true, data: user };
}

// services/auth.service.ts
async login(credentials: LoginDto, context: RequestContext): Promise<ServiceResult<AuthToken>> {
  const token = await this.authenticate(credentials);

  // Emit event — triggers audit logging, analytics
  eventBus.publish(EventType.AUTH_LOGIN, {
    userUID: token.userUID,
    method: 'email_password',
  });

  return { success: true, data: token };
}
```

### ✅ Use Firebase Event Bridge (Path 2)

**Firebase triggers are ESSENTIAL for these scenarios:**

#### 1. **Client Direct Interactions** (No API Layer)

**File Uploads - Storage Triggers**
```typescript
// Client uploads directly to Firebase Storage (bypasses our API)
// ❌ Our API is NOT involved in the upload
// ✅ Storage trigger fires → Bridge publishes → Sync metadata to Firestore

// Example: Client uploads profile image
// 1. Client: Upload to gs://bucket/profiles/user-123/photo.jpg
// 2. Firebase: Storage trigger fires
// 3. Bridge: Publishes FILE_UPLOADED event
// 4. Subscriber: Updates user record in Firestore with image URL/metadata
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
// 5. Subscriber: Sends welcome email, creates CRM contact, analytics
```

#### 2. **External Data Changes**

- **Admin actions** - Data modified via Firebase console, admin SDK, batch jobs
- **Cross-platform sync** - Capturing changes from mobile SDKs writing directly to Firestore
- **Data integrity** - Reacting to document lifecycle events for validation/cleanup
- **Audit trail** - Ensuring ALL data changes are captured, not just service-initiated ones

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

**Best practice:**
- Services emit events for operations they perform
- Firebase triggers handle events for external/direct data changes
- The event mapping config controls which Firebase events map to which domain events

### Decision Tree

```
Does a SERVICE perform the operation?
├─ YES → Emit event from service
│         eventBus.publish(EventType.MY_EVENT, payload)
│
└─ NO → Handled by Firebase Bridge
          Firebase trigger → Bridge → Event bus
```

## Base Event Types

The boilerplate ships with a small, intentional set of base events. The code generator adds entity-specific CRUD events automatically (e.g., `ORDER_CREATED`, `PRODUCT_UPDATED`), and you can extend the enum with custom domain events as needed.

### User Lifecycle Events
```typescript
USER_CREATED     // New user registration
USER_UPDATED     // Profile changes
USER_DELETED     // Account deletion
```

### Authentication Events
```typescript
AUTH_LOGIN              // User logged in
AUTH_LOGOUT             // User logged out
AUTH_TOKEN_REFRESHED    // Token refresh
AUTH_TOKEN_BLACKLISTED  // Token invalidated
AUTH_PASSWORD_CHANGED   // Password update
```

### File / Storage Events
```typescript
FILE_UPLOADED    // File upload completed
FILE_DELETED     // File removed
```

### Notification Events
```typescript
NOTIFICATION_SENT     // Notification delivered
NOTIFICATION_FAILED   // Notification delivery failed
```

### System Events
```typescript
EXTERNAL_DATA_CHANGE  // Catch-all for external data changes (Firebase triggers, webhooks)
```

## Usage

### Publishing Events (Services)

```typescript
import { eventBus, EventType } from '../utilities/events';

// Simple event publishing
eventBus.publish(EventType.USER_CREATED, {
  userUID: user.id,
  email: user.email,
});

// File upload event
eventBus.publish(EventType.FILE_UPLOADED, {
  filePath: 'profiles/user-123/avatar.jpg',
  contentType: 'image/jpeg',
  size: 204800,
  bucket: 'my-app.appspot.com',
});
```

### Subscribing to Events (Services)

```typescript
import { eventBus, EventType } from '../utilities/events';

// Permanent subscription
eventBus.subscribe(EventType.USER_CREATED, async (payload) => {
  await emailConnector.sendEmail({
    to: payload.email,
    subject: 'Welcome!',
    html: '<p>Your account is ready.</p>',
  });
});

// One-time subscription
eventBus.subscribeOnce(EventType.USER_CREATED, async (payload) => {
  await welcomeService.sendWelcomeEmail(payload.userUID);
});

// Type-safe payload handling
eventBus.subscribe<UserCreatedPayload>(EventType.USER_CREATED, async (payload) => {
  // payload is fully typed with UserCreatedPayload interface
  console.log(`User ${payload.userUID} created`);
});
```

### Subscriber Classes (Recommended Pattern)

**Create subscriber classes** to organize event handlers:

```typescript
// src/subscribers/notifications.subscriber.ts
import { Logger } from '../utilities/logger';
import { eventBus, EventType } from '../utilities/events';
import type { UserCreatedPayload } from '../utilities/events/event-types';

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
    eventBus.subscribe(EventType.USER_CREATED, this.handleUserCreated.bind(this));
    eventBus.subscribe(EventType.NOTIFICATION_FAILED, this.handleNotificationFailed.bind(this));

    this.isInitialized = true;
    this.logger.info('Notification subscribers initialized');
  }

  private async handleUserCreated(payload: UserCreatedPayload): Promise<void> {
    // Subscriber is unaware if event came from service or Firebase trigger
    // Business logic remains the same either way
    this.logger.debug('Processing USER_CREATED event', {
      userUID: payload.userUID,
    });

    // Send welcome email, create CRM contact, etc.
  }
}

// Initialize in src/index.ts
const notificationSubscribers = new NotificationSubscribers(logger);
notificationSubscribers.initialize();
```

### Firebase Event Bridge Integration

See [Firebase Event Bridge README](../firebase-event-bridge/README.md) for details on how Firebase triggers publish to this event bus.

The Firebase Event Bridge uses a dynamic event mapping configuration that translates Firebase events (e.g., `firestore.users.created`) to domain events (`USER_CREATED`). Custom mappings are defined in `functions/src/config/firebase-event-mapping.config.ts`, and unmapped collections automatically get `{collection}.{operation}` event names.

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
// User lifecycle
interface UserCreatedPayload extends BaseEventPayload {
  userUID: string;
  email?: string;
}

// Authentication
interface AuthLoginPayload extends BaseEventPayload {
  userUID: string;
  method?: string;
}

// File operations
interface FileUploadedPayload extends BaseEventPayload {
  filePath: string;
  contentType?: string;
  size?: number;
  bucket?: string;
}

// Notifications
interface NotificationSentPayload extends BaseEventPayload {
  channel: 'email' | 'sms' | 'push' | string;
  recipientId?: string;
}

// Entity CRUD (auto-published by BaseService)
interface EntityCreatedPayload extends BaseEventPayload {
  entityId: string;
  entityType: string;
  action: 'CREATED';
  userId?: string;
  requestId?: string;
  data?: Record<string, unknown>;
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
eventBus.subscribe(EventType.FILE_UPLOADED, async (payload) => {
  // Only process image files
  if (payload.contentType?.startsWith('image/')) {
    await imageProcessingService.generateThumbnail(payload);
  }
});
```

### Event Aggregation
```typescript
// Track multiple related events
const uploadTracker = new Map<string, FileUploadedPayload[]>();

eventBus.subscribe(EventType.FILE_UPLOADED, (payload) => {
  const key = payload.bucket || 'default';
  const uploads = uploadTracker.get(key) || [];
  uploads.push(payload);
  uploadTracker.set(key, uploads);
});
```

### Error Handling in Subscribers
```typescript
eventBus.subscribe(EventType.USER_CREATED, async (payload) => {
  try {
    await analyticsService.trackSignup(payload);
  } catch (error) {
    // Log error but don't break other subscribers
    logger.error('Analytics tracking failed', error, {
      eventType: EventType.USER_CREATED,
      userUID: payload.userUID,
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
describe('UserService', () => {
  beforeEach(() => {
    mockEventBus.publish.mockClear();
  });

  it('publishes USER_CREATED event when user created', async () => {
    const user = await userService.create(userData, context);

    expect(mockEventBus.publish).toHaveBeenCalledWith(
      EventType.USER_CREATED,
      expect.objectContaining({
        userUID: user.id,
      })
    );
  });
});
```

### Testing Event Subscribers
```typescript
describe('NotificationService', () => {
  it('sends welcome email when user is created', async () => {
    const payload: UserCreatedPayload = {
      userUID: 'user-123',
      email: 'user@example.com',
    };

    // Trigger the subscriber directly
    await notificationService.handleUserCreated(payload);

    expect(emailConnector.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'user@example.com',
        subject: expect.stringContaining('Welcome'),
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
  userUID: user.id,           // ✅ Safe UID
  // email: user.email,       // ❌ Never include PII
  // phoneNumber: user.phone  // ❌ Never include PII
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
ORDER_SHIPPED = 'order.shipped',
```

2. **Define payload interface**:
```typescript
export interface OrderShippedPayload extends BaseEventPayload {
  orderUID: string;
  trackingNumber: string;
  carrier: string;
  shippedBy: string; // userUID
}
```

3. **Add to EventPayloadMap**:
```typescript
export interface EventPayloadMap {
  [EventType.ORDER_SHIPPED]: OrderShippedPayload;
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

2. **External data changes** → Handled by Firebase Bridge via dynamic event mapping
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
| Service creates user | Emit from service | `eventBus.publish(EventType.USER_CREATED, ...)` |
| Service updates user | Emit from service | `eventBus.publish(EventType.USER_UPDATED, ...)` |
| Service authenticates user | Emit from service | `eventBus.publish(EventType.AUTH_LOGIN, ...)` |
| **Client uploads file to Storage** | **Firebase Bridge** | **Storage trigger → FILE_UPLOADED** |
| **Client signs up with Auth** | **Firebase Bridge** | **Firestore trigger → USER_CREATED** |
| Admin modifies data via console | Firebase Bridge | Firestore trigger → dynamic event mapping |
| React to any event | Subscriber class | `eventBus.subscribe(EventType.*, handler)` |

## Related Documentation

- [Architecture Governance Document](../../../__docs__/20251005_arch_governance_doc.md#55-event-driven-patterns)
- [Firebase Event Bridge Utility](../firebase-event-bridge/README.md)
- [Service Layer Guidelines](../../../__docs__/20251005_arch_governance_doc.md#52-service-layer)
- [Subscriber Examples](../../subscribers/README.md)
