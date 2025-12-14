# Structured Logger Utility

A defensive security-focused logging utility for the Wishlist Coordination Platform. Provides structured logging with automatic PII sanitization, correlation tracking, and GCP Cloud Logging integration.

## Overview

This logger utility implements the **structured logging standards** outlined in the [Architecture Governance Document](../../../__docs__/20251005_arch_governance_doc.md#74-logging-standards-pii-protection). It ensures **no PII is ever logged in plaintext** while maintaining comprehensive audit trails for security and compliance.

## Key Features

### 🔒 **PII Protection**
- Automatic sanitization of sensitive fields
- Recursive object sanitization for nested data
- Comprehensive sensitive field detection
- Compliance with GDPR, SOC 2, and Essential Eight

### 📋 **Structured Logging**
- JSON-formatted logs for GCP Cloud Logging
- Correlation ID tracking across requests
- Context inheritance and child logger support
- Standardized log levels (DEBUG, INFO, WARN, ERROR)

### 🎯 **Firebase Integration**
- Native Firebase Functions logging support
- Automatic GCP Cloud Logging integration
- Production-optimized performance
- Environment-aware log levels

## Protected Fields

The logger automatically redacts these sensitive field types:

### Authentication & Tokens
- `password`, `secret`, `key`, `token`
- `apiKey`, `accessToken`, `refreshToken`
- `authorization`

### Personal Information
- `email`, `phoneNumber`, `phone`
- `address`, `addressLine1`, `addressLine2`
- `city`, `state`, `postalCode`, `ssn`

### Payment Data
- `creditCard`, `cardNumber`, `cvv`
- Any field containing sensitive payment information

## Usage

### Request-Scoped Logging (Recommended)

```typescript
// Middleware creates request-scoped logger
app.use(correlationMiddleware); // Sets req.logger

// Controllers use request logger
async createList(req: Request, res: Response): Promise<void> {
  const logger = req.logger; // Has correlation ID and context
  
  logger.info('Creating list', { 
    userId: req.user.uid,
    listName: req.body.listName // Safe to log
  });
  
  // PII automatically sanitized
  logger.debug('Request data', { 
    email: 'user@example.com' // Becomes '[REDACTED]'
  });
}
```

### Service Layer Logging

```typescript
// Services receive logger from controllers
async createList(
  listData: CreateListDto, 
  userId: string, 
  logger: Logger
): Promise<List> {
  logger.info('Service: Creating list', { 
    userId,
    operation: 'createList'
  });

  try {
    const list = await listRepository.createList(listData);
    logger.info('List created successfully', { 
      listUID: list.listUID,
      duration: Date.now() - startTime
    });
    return list;
  } catch (error) {
    logger.error('Failed to create list', error as Error, { 
      userId,
      listData: listData // PII fields auto-redacted
    });
    throw error;
  }
}
```

### System-Wide Logging

```typescript
import { logger } from './utilities/logger';

// For background tasks, triggers, or system operations
export const cleanupTask = onSchedule('daily', async () => {
  logger.info('Starting cleanup task', { 
    task: 'userCleanup',
    timestamp: new Date()
  });
  
  // Work with system logger
});
```

### Child Loggers

```typescript
// Create specialized loggers with additional context
const auditLogger = logger.child({ 
  component: 'audit',
  compliance: 'GDPR'
});

auditLogger.info('Data export requested', { 
  userId: 'user123',
  exportType: 'full'
});
```

## Log Levels

### DEBUG (Development Only)
- Enabled when `LOG_LEVEL=debug` or `NODE_ENV=development`
- Detailed execution flow information
- Performance timing data
- Not logged in production for performance

```typescript
logger.debug('Processing items', { 
  itemCount: items.length,
  processingTime: timing.elapsed
});
```

### INFO (Standard Operations)
- Normal application flow
- Successful operations
- User actions and system events

```typescript
logger.info('User authenticated', { 
  userId: user.uid,
  method: 'firebase-auth'
});
```

### WARN (Recoverable Issues)
- Expected errors that don't break functionality
- Rate limiting triggers
- Fallback mechanisms activated

```typescript
logger.warn('Rate limit exceeded', { 
  userId: req.user.uid,
  endpoint: req.path,
  retryAfter: '60s'
});
```

### ERROR (Unexpected Failures)
- System errors requiring investigation
- Failed operations that affect users
- Integration failures

```typescript
logger.error('Database connection failed', error, { 
  database: 'wishlistDB',
  operation: 'createList',
  retryAttempt: 3
});
```

## File Structure

```
logger/
├── index.ts           # Barrel exports + default logger
├── logger-types.ts    # Type definitions and interfaces
├── logger.ts          # Core Logger class implementation
└── README.md          # This documentation
```

## Configuration

### Environment Variables

```bash
# Development
LOG_LEVEL=debug          # Enable debug logs
NODE_ENV=development     # Auto-enable debug logs

# Production  
LOG_LEVEL=info          # Standard production logging
NODE_ENV=production     # Optimized performance
```

### Log Output Format

```json
{
  "correlationId": "550e8400-e29b-41d4-a716-446655440000",
  "timestamp": "2025-01-05T12:34:56.789Z",
  "level": "info",
  "message": "List created successfully",
  "context": {
    "method": "POST",
    "path": "/v1/lists",
    "userId": "user_abc123"
  },
  "listUID": "list_xyz789",
  "duration": 245
}
```

## Security Best Practices

### ✅ **DO**
```typescript
// Use UIDs instead of PII
logger.info('Contact notification sent', {
  contactUID: 'contact_123',
  notificationType: 'itemClaimed'
});

// Log business events with safe identifiers
logger.info('Item approved', {
  itemUID: item.itemUID,
  approvedBy: userId,
  previousState: 'pending'
});

// Use masking for essential display context
logger.info('Email validation sent', {
  emailMasked: 'j***@example.com',
  validationType: 'signup'
});
```

### ❌ **DON'T**
```typescript
// Never log PII directly (auto-sanitized anyway)
logger.error('User creation failed', error, {
  email: 'john@example.com',        // Becomes [REDACTED]
  phoneNumber: '+61412345678'       // Becomes [REDACTED]
});

// Never log full request bodies with potential PII
logger.debug('Request received', {
  body: req.body  // Could contain PII - let sanitizer handle it
});

// Never log authentication tokens
logger.info('Request authenticated', {
  token: req.headers.authorization  // Becomes [REDACTED]
});
```

## Correlation Tracking

### Request Flow Correlation
```typescript
// Middleware creates correlation ID
app.use(correlationMiddleware);

// Same correlation ID flows through entire request
controller -> service -> repository
```

### Cross-Service Correlation
```typescript
// Pass correlation through event bus
eventBus.emit('item.claimed', {
  itemUID: item.itemUID,
  correlationId: req.correlationId  // Maintain tracing
});
```

## Performance Considerations

### Production Optimizations
- Debug logs disabled in production (`LOG_LEVEL=info`)
- Lazy JSON serialization for unused log levels  
- Efficient field sanitization with early returns
- Minimal memory allocation for high-frequency logs

### Development Features
- Rich debug information when `NODE_ENV=development`
- Stack traces for all error levels
- Timing information for performance analysis

## Compliance Integration

### GDPR Article 32 (Security)
- No personal data in logs (automatic sanitization)
- Audit trail with correlation IDs
- Right to deletion includes log retention policies

### SOC 2 Type II (Logging)
- Comprehensive security event logging
- Tamper-evident log structure via GCP
- Administrative access logging with `actingAsSysAdmin` flag

### Essential Eight (Monitoring)
- Application event logging for security monitoring
- Failed authentication attempt tracking
- Privilege escalation logging

## Integration Examples

### Error Handler Integration
```typescript
// Global error middleware
export function errorHandler(err: Error, req: Request, res: Response) {
  const logger = req.logger;
  
  if (err instanceof AppError) {
    logger.warn('Operational error', {
      statusCode: err.statusCode,
      errorType: err.constructor.name,
      path: req.path
    });
  } else {
    logger.error('Unexpected error', err, {
      path: req.path,
      method: req.method,
      userId: req.user?.uid
    });
  }
}
```

### Audit Logging Integration
```typescript
// Audit sensitive operations
async deleteUserData(userId: string, logger: Logger): Promise<void> {
  const auditLogger = logger.child({
    compliance: 'GDPR',
    operation: 'data-deletion'
  });
  
  auditLogger.info('User data deletion started', { userId });
  
  // Perform deletion...
  
  auditLogger.info('User data deletion completed', { 
    userId,
    deletedCollections: ['contacts', 'addresses', 'lists']
  });
}
```

## Testing

### Unit Tests Verify
- Sensitive field sanitization
- Correlation ID propagation  
- Child logger context inheritance
- Log level filtering behavior
- Error object serialization

### Test Utilities
```typescript
// Mock logger for testing
export const mockLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  child: jest.fn(() => mockLogger)
};
```

## Related Documentation

- [Architecture Governance Document](../../../__docs__/20251005_arch_governance_doc.md#74-logging-standards-pii-protection)
- [Error Handling & Logging](../../../__docs__/20251005_arch_governance_doc.md#8-error-handling--logging)
- [Privacy & Compliance](../../../__docs__/20251005_arch_governance_doc.md#7-privacy--compliance)