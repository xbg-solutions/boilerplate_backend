---
description: "Utilities in the XBG boilerplate backend: logger with PII sanitization, AES-256-GCM hashing, token handler with blacklisting, multi-level cache, and all communication connectors (email, SMS, push, CRM, LLM, etc.)."
---

# XBG Boilerplate Backend — Utilities

Each utility is a standalone npm package under `@xbg.solutions/utils-*`. Install only what you need.

---

## Logger

**Package:** `@xbg.solutions/utils-logger`

Structured JSON logger with automatic PII sanitization and correlation ID tracking.

### Import and Basic Use

```typescript
import { logger } from '@xbg.solutions/utils-logger';

logger.debug('Detailed trace', { userId, queryOptions });
logger.info('Operation completed', { userId, entityId: product.id });
logger.warn('Retrying after failure', { attempt: 2, error: err.message });
logger.error('Operation failed', err, { requestId, userId });
//                                ^^^ Error object is second param for error()
```

### PII Sanitization — Automatic

The logger automatically redacts these field names from logged objects:
- `password`, `passwordHash`, `secret`, `token`, `apiKey`, `authorization`
- `email`, `phone`, `ssn`, `creditCard`, `cvv`
- `firstName`, `lastName`, `address`

```typescript
// This is safe to log — email will be redacted to '[REDACTED]'
logger.info('User created', {
  userId: 'uid-123',
  email: 'user@example.com',   // ← becomes '[REDACTED]' in output
  name: 'John Doe',            // ← also redacted (firstName/lastName components)
});
```

### Structured Logging Fields

Always include `requestId` for correlation across log lines:

```typescript
logger.info('Product updated', {
  requestId: context.requestId,
  userId: context.userId,
  productId: product.id,
  priceChange: { old: existing.price, new: product.price },
});
```

### Request-Scoped Logger

The logging middleware attaches a logger to `req` with the requestId pre-set:

```typescript
// In a controller (if needed):
import { Request } from 'express';
const reqLogger = (req as any).logger ?? logger;
reqLogger.info('Custom log', { data });
```

---

## Hashing — PII Encryption (AES-256-GCM)

**Package:** `@xbg.solutions/utils-hashing`

Provides **reversible** AES-256-GCM encryption for PII fields. Two encryption modes:

- **Transparent** — bundled into a single `_pii` blob, auto-decrypted on every read. O(1) crypto per object. For display PII (names, emails, phones).
- **Guarded** — encrypted individually per-field, requires explicit action to decrypt. For secrets (API keys, SSNs, tax file numbers).

### Setup

```bash
# Generate encryption key (64 hex chars = 32 bytes for AES-256)
openssl rand -hex 32
# Add to .env:
PII_ENCRYPTION_KEY=your-64-char-hex-key
```

### Registering Fields with Modes

Register entity fields at app startup with their encryption mode:

```typescript
import { registerHashedFields } from '@xbg.solutions/utils-hashing';

// Transparent: auto-decrypted on read (display PII)
registerHashedFields('contact', ['firstName', 'lastName', 'email', 'phone'], 'transparent');

// Guarded: explicit decrypt only (secrets) — this is the default if mode is omitted
registerHashedFields('contact', ['ssn', 'taxFileNumber'], 'guarded');
```

If using the code generator with `encryption` on fields, the generator auto-produces `encryption-registry.ts` with these calls.

### Transparent Encryption (Recommended for Display PII)

Bundles all transparent fields into a single encrypted `_pii` blob. One decrypt operation per object regardless of field count.

```typescript
import { hashTransparentFields, unhashTransparentFields } from '@xbg.solutions/utils-hashing';

// Write path: bundle transparent fields into _pii, encrypt guarded individually
const toStore = hashTransparentFields(contactData, 'contact');
// → { _pii: '<blob>', ssn: '<encrypted>', department: 'Engineering' }

// Read path: decrypt _pii blob, restore transparent fields (1 crypto op)
const readable = unhashTransparentFields(storedData, 'contact');
// → { firstName: 'Jane', email: 'j@x.com', ssn: '<still encrypted>', department: 'Engineering' }
```

### Dot-Path Support for Nested Objects

Nested sub-fields can be encrypted individually using dot-paths:

```typescript
registerHashedFields('project', ['contactPerson.email', 'contactPerson.name'], 'transparent');
registerHashedFields('project', ['billing.taxId'], 'guarded');

const stored = hashTransparentFields(projectData, 'project');
// contactPerson.email and contactPerson.name go into _pii blob
// billing.taxId encrypted individually
// contactPerson.role stays plaintext in Firestore
```

### Guarded Field Decryption (Explicit)

Guarded fields remain encrypted after `unhashTransparentFields()`. Decrypt explicitly when needed:

```typescript
import { unhashFields, unhashFieldsByName } from '@xbg.solutions/utils-hashing';

// Explicit decrypt of guarded fields
const withSsn = unhashFields(readable, ['contact.ssn']);
// Or by name (no registry):
const withSsn = unhashFieldsByName(readable, ['ssn']);
```

### Legacy Functions (Still Supported)

The original per-field functions still work for guarded-only workflows:

```typescript
import { hashFields, unhashFields, hashFieldsByName, unhashFieldsByName } from '@xbg.solutions/utils-hashing';

// Per-field encryption (all fields treated as guarded)
const encrypted = hashFields(userData, 'user');
const decrypted = unhashFields(encrypted, ['user.email', 'user.phoneNumber']);
```

### Anti-Examples

```typescript
// ❌ Don't use hashFields for entities with many display PII fields — too many decrypt ops
const users = await repo.findAll({});
const decrypted = users.map(u => unhashFields(u, ['user.email', 'user.phone', 'user.name'])); // 3 decrypts per user

// ✅ Use transparent mode — 1 decrypt per user regardless of field count
const decrypted = users.map(u => unhashTransparentFields(u, 'user'));

// ❌ Don't compare encrypted values directly
if (user.email === 'test@example.com') { ... }  // always false — it's encrypted

// ❌ Don't explicitly decrypt guarded fields unless you need to display them
const allDecrypted = unhashFields(user, ['user.ssn']); // Only when user clicks "reveal SSN"
```

---

## Token Handler — JWT & Blacklisting

**Package:** `@xbg.solutions/utils-token-handler`

Wraps Firebase Auth token verification with blacklisting support and normalized token shape.

### Basic Verification

```typescript
import { tokenHandler } from '@xbg.solutions/utils-token-handler';
import { logger } from '@xbg.solutions/utils-logger';

const result = await tokenHandler.verifyAndUnpack(bearerToken, logger);
if (!result.isValid) {
  // result.error: TokenVerificationError | null — contains reason
  // result.isBlacklisted: boolean — indicates revocation
  return res.status(401).json({ error: result.error });
}

// result.token: NormalizedToken | null (non-null when isValid is true)
const { authUID, userUID, email, customClaims } = result.token!;
```

### Token Blacklisting

```typescript
import { tokenHandler } from '@xbg.solutions/utils-token-handler';
import { logger } from '@xbg.solutions/utils-logger';

// Blacklist a single token (e.g., on logout)
const tokenId = await tokenHandler.getTokenIdentifier(rawToken);
await tokenHandler.blacklistToken(tokenId, authUID, 'LOGOUT', tokenExpiresAt, null, logger);

// Blacklist all tokens for a user (e.g., password change, account compromise)
await tokenHandler.blacklistAllUserTokens(authUID, 'PASSWORD_CHANGE', null, logger);
```

Blacklisted tokens are checked on every `verifyAndUnpack()` call. Firebase's own revocation list is also checked (`checkRevoked: true`). Cleanup of expired blacklist entries runs on schedule.

### Normalized Token Shape

```typescript
interface NormalizedToken<TCustomClaims> {
  authUID: string;           // Firebase Auth UID
  userUID: string | null;    // App-specific user ID (from custom claims)
  email: string | null;
  emailVerified: boolean;
  phoneNumber: string | null;
  issuedAt: number;          // Unix timestamp
  expiresAt: number;
  issuer: string;
  customClaims: TCustomClaims;
  rawClaims: Record<string, any>;
}
```

### API Key Auth (Service-to-Service)

```typescript
import { requireApiKey } from '@xbg.solutions/backend-core';

// In controller routes:
this.router.post(
  '/webhook',
  requireApiKey([process.env.WEBHOOK_SECRET!]),
  this.handleWebhook.bind(this)
);
```

---

## Cache Connector

**Package:** `@xbg.solutions/utils-cache-connector`

Progressive multi-level cache. Opt-in per repository. Global kill switch.

### Providers

| Provider | Latency | Scope | Use for |
|---|---|---|---|
| `memory` | ~1ms | Single function instance | Hot data, auth tokens |
| `firestore` | ~50-100ms | All instances | Shared config, user sessions |
| `redis` | ~5ms | All instances | High-traffic data (requires Redis) |
| `noop` | 0ms | None | Default when cache disabled |

### Configuration

```bash
# .env
CACHE_ENABLED=true
CACHE_DEFAULT_PROVIDER=memory
CACHE_DEFAULT_TTL=300
CACHE_NAMESPACE=myapp

# For Redis:
CACHE_REDIS_HOST=localhost
CACHE_REDIS_PORT=6379
```

### Using in Repositories

```typescript
import { BaseRepository } from '@xbg.solutions/backend-core';

export class SessionRepository extends BaseRepository<Session> {
  protected collectionName = 'sessions';

  protected cacheConfig = {
    enabled: true,
    provider: 'memory' as const,
    ttl: 900,              // 15 minutes — matches JWT expiry
    keyPrefix: 'session',
    tags: ['sessions'],
  };

  protected fromFirestore(id: string, data: DocumentData): Session { ... }
}

// Usage
const session = await sessionRepo.findByIdCached('sess-123');
const fresh = await sessionRepo.findByIdCached('sess-123', { forceRefresh: true, ttl: 60 });
```

### Direct Cache Access (Advanced)

```typescript
import { getCacheConnector } from '@xbg.solutions/utils-cache-connector';

const cache = getCacheConnector();

// Set
await cache.set('my-key', { data: 'value' }, { ttl: 300, provider: 'memory' });

// Get
const value = await cache.get<MyType>('my-key', { provider: 'memory' });

// Delete
await cache.delete('my-key', { provider: 'memory' });

// Invalidate by tag (invalidates all keys with this tag)
await cache.invalidateByTags(['sessions'], { provider: 'memory' });
```

---

## Communication Connectors

All connectors follow the same pattern: import the connector singleton from its `@xbg.solutions/utils-*` package, call methods, providers handle the transport.

### Email Connector

**Package:** `@xbg.solutions/utils-email-connector`

Providers: Mailjet (implemented), Ortto, SendGrid, AWS SES (stub/planned)

```typescript
import { emailConnector } from '@xbg.solutions/utils-email-connector';

// Simple email
await emailConnector.sendEmail({
  to: 'user@example.com',
  subject: 'Welcome to the platform',
  html: '<h1>Welcome!</h1><p>Your account is ready.</p>',
  text: 'Welcome! Your account is ready.',
});

// With sender override
await emailConnector.sendEmail({
  to: 'user@example.com',
  from: { email: 'noreply@myapp.com', name: 'MyApp' },
  subject: 'Password reset',
  html: '<p>Click <a href="...">here</a> to reset.</p>',
});
```

Configure in `.env`:
```bash
EMAIL_PROVIDER=mailjet       # mailjet | sendgrid | ses
MAILJET_API_KEY=...
MAILJET_SECRET_KEY=...
EMAIL_FROM_ADDRESS=noreply@myapp.com
EMAIL_FROM_NAME=MyApp
```

### SMS Connector

**Package:** `@xbg.solutions/utils-sms-connector`

Providers: Twilio (implemented), MessageBird, AWS SNS (stub/planned)

```typescript
import { smsConnector } from '@xbg.solutions/utils-sms-connector';

await smsConnector.sendMessage({
  to: '+12025551234',
  body: 'Your verification code is: 847293',
});
```

Configure:
```bash
SMS_PROVIDER=twilio
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...
TWILIO_FROM_NUMBER=+15005550006
```

### Push Notifications Connector

**Package:** `@xbg.solutions/utils-push-notifications-connector`

Provider: Firebase Cloud Messaging (FCM)

```typescript
import { pushNotificationsConnector } from '@xbg.solutions/utils-push-notifications-connector';

// Single device
await pushNotificationsConnector.send({
  token: deviceFcmToken,
  notification: {
    title: 'New Message',
    body: 'You have a new message from Alice',
  },
  data: { messageId: 'msg-123', type: 'chat' },
});

// Multiple devices
await pushNotificationsConnector.sendMulticast({
  tokens: [token1, token2, token3],
  notification: { title: 'System update', body: 'Maintenance in 1 hour' },
});
```

### CRM Connector

**Package:** `@xbg.solutions/utils-crm-connector`

Providers: HubSpot (implemented), Salesforce, Attio (stub/planned)

```typescript
import { crmConnector } from '@xbg.solutions/utils-crm-connector';

// Create contact
const contact = await crmConnector.createContact({
  email: 'lead@company.com',
  firstName: 'Jane',
  lastName: 'Smith',
  company: 'Acme Corp',
  phone: '+12025551234',
});

// Update contact
await crmConnector.updateContact(contact.id, {
  lifecycleStage: 'customer',
});

// Create deal
await crmConnector.createDeal({
  name: 'Acme Corp - Enterprise',
  amount: 50000,
  contactId: contact.id,
});
```

Configure:
```bash
CRM_PROVIDER=hubspot
HUBSPOT_ACCESS_TOKEN=...
```

### LLM Connector

**Package:** `@xbg.solutions/utils-llm-connector`

Providers: Claude/Anthropic, OpenAI, Gemini

```typescript
import { llmConnector } from '@xbg.solutions/utils-llm-connector';

const response = await llmConnector.complete({
  messages: [
    { role: 'user', content: 'Summarize this product description: ...' }
  ],
  maxTokens: 200,
});

// response.content: string
// response.usage: { inputTokens, outputTokens }
```

Configure:
```bash
LLM_PROVIDER=anthropic        # anthropic | openai | gemini
ANTHROPIC_API_KEY=...
ANTHROPIC_MODEL=claude-sonnet-4-6
```

### Other Connectors

| Package | Description |
|---|---|
| `@xbg.solutions/utils-document-connector` | E-signature (PandaDoc) |
| `@xbg.solutions/utils-journey-connector` | Marketing automation (Ortto) |
| `@xbg.solutions/utils-survey-connector` | Surveys (Typeform) |
| `@xbg.solutions/utils-work-mgmt-connector` | Tasks (ClickUp/Notion) |
| `@xbg.solutions/utils-erp-connector` | HR/Finance (Workday) |
| `@xbg.solutions/utils-address-validation` | Google Maps validation |
| `@xbg.solutions/utils-realtime-connector` | Firebase Realtime DB |
| `@xbg.solutions/utils-firebase-event-bridge` | Firebase → internal events |
| `@xbg.solutions/utils-firestore-connector` | Multi-DB Firestore setup |
| `@xbg.solutions/utils-timezone` | Timezone conversion utils |

---

## Subscribing to Events for Communication Side Effects

Register subscribers in your project's `src/subscribers/` directory:

```typescript
import { eventBus, EventType, UserCreatedPayload } from '@xbg.solutions/utils-events';
import { emailConnector } from '@xbg.solutions/utils-email-connector';

export function registerCommunicationSubscribers(): void {
  eventBus.subscribe<UserCreatedPayload>(
    EventType.USER_CREATED,
    async ({ userUID, accountUID }) => {
      await emailConnector.sendEmail({
        to: '...', // fetch user email from repo
        subject: 'Welcome!',
        html: '<p>Your account is ready.</p>',
      });
    }
  );
}
```

Import and call `registerCommunicationSubscribers()` in your `src/index.ts` or `app.ts` at startup.

---

## Anti-Examples

```typescript
// ❌ Don't import logger from wrong path
import { logger } from '../../logger';  // wrong — use the package
import { Logger } from './logger';      // creates new instance, wrong

// ✅ Always import the singleton from the package
import { logger } from '@xbg.solutions/utils-logger';

// ❌ Don't log raw PII
logger.info('User login', { email: user.email });  // ← logs plaintext email to Cloud Logging

// ✅ Log identifiers, not PII values
logger.info('User login', { userId: user.id });

// ❌ Don't call connectors without checking feature flags
await emailConnector.send({ ... });

// ✅ Check feature is enabled
import { isFeatureEnabled } from '@xbg.solutions/backend-core';
if (isFeatureEnabled('notifications')) {
  await emailConnector.send({ ... });
}

// ❌ Don't block on communication failures
try {
  await smsConnector.sendMessage({ ... });
} catch (e) {
  throw e;  // ← don't let SMS failure break the user flow
}

// ✅ Log and continue
try {
  await smsConnector.sendMessage({ ... });
} catch (e) {
  logger.warn('SMS send failed', { error: e, userId });
  // Continue — SMS is non-critical
}
```
