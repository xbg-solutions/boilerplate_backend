# Token Handler Utility

**Version**: 2.0
**Last Updated**: 2025-01-21
**Status**: Complete - Portable & Reusable

---

## Overview

The token handler utility provides a **portable, provider-agnostic authentication token system** with verification, normalization, and blacklisting capabilities. It abstracts away auth provider details (Firebase, Auth0, Clerk, etc.) so business logic works with a consistent token structure across different projects.

### Key Features

- ✅ **Portable & Reusable**: Copy to any project without modification
- ✅ **Provider-agnostic**: Swap auth providers without changing business logic  
- ✅ **Configurable**: Custom claims, blacklist rules, and retention policies
- ✅ **Token verification**: Validates signatures with auth provider
- ✅ **Token normalization**: Converts provider-specific tokens to unified structure
- ✅ **Token blacklisting**: Individual session + global user revocation
- ✅ **Security layered**: Blacklist checks + provider-level revocation
- ✅ **Auto-cleanup**: CRON removes expired blacklist entries
- ✅ **Type-safe**: Full TypeScript support with generic custom claims

---

## Quick Start

### For New Projects

```typescript
import { createFirebaseTokenHandler } from './utilities/token-handler';

// Define your custom claims structure
interface MyCustomClaims {
  userID: string;
  permissions: string[];
  organizationID: string;
}

// Create configured handler
const tokenHandler = createFirebaseTokenHandler<MyCustomClaims>({
  customClaims: {
    extract: (token) => ({
      userID: token.userID || null,
      permissions: token.permissions || [],
      organizationID: token.organizationID || null
    }),
    defaults: { userID: null, permissions: [], organizationID: null }
  },
  blacklist: {
    storage: { database: 'security', collection: 'revokedTokens' },
    retention: { cleanupRetentionDays: 30, globalRevocationRetentionDays: 30 },
    reasons: ['LOGOUT', 'PASSWORD_CHANGE', 'SECURITY_BREACH']
  },
  database: firestoreInstance
});

// Use in your auth middleware
const result = await tokenHandler.verifyAndUnpack(rawToken, logger);
if (result.isValid) {
  req.user = result.token; // Type-safe!
}
```

### For Wishlist Platform (Existing)

```typescript
import { tokenHandler } from '../config/tokens.config';

// Works exactly as before - no changes needed
const result = await tokenHandler.instance.verifyAndUnpack(rawToken, logger);
```

---

## Architecture

```
Client (Web/Mobile)
    ↓
    Authenticates with Auth Provider (Firebase/Auth0/Clerk)
    Receives JWT token
    ↓
    Sends request: Authorization: Bearer {token}
    ↓
Backend API
    ↓
Auth Middleware
    ↓
Token Handler Utility
    ├── Provider Adapter (Firebase/Auth0/Clerk)
    │   ├── Verify signature with provider
    │   ├── Extract provider-specific data
    │   └── Normalize to NormalizedToken<T>
    ├── Blacklist Manager
    │   ├── Check individual token blacklist
    │   ├── Check global user revocation timestamp
    │   └── Database operations
    └── Return TokenVerificationResult<T>
    ↓
Request.user = NormalizedToken<T>
    ↓
Controllers/Services use Request.user (type-safe)
```

---

## File Structure

```
utilities/token-handler/
├── README.md                          # This file
├── index.ts                           # Barrel export + factory functions
├── token-handler-types.ts             # Core platform-agnostic types
├── generic-token-handler.ts           # Main TokenHandler<T> class
├── token-blacklist-manager.ts         # Generic blacklist implementation
├── adapters/
│   ├── firebase-auth-adapter.ts       # Firebase Auth implementation
│   ├── firestore-database-adapter.ts  # Firestore blacklist storage
│   ├── auth0-adapter.ts               # Future: Auth0 implementation
│   └── clerk-adapter.ts               # Future: Clerk implementation
└── __tests__/
    ├── generic-token-handler.test.ts
    ├── token-blacklist-manager.test.ts
    └── adapters/

config/tokens.config.ts                # Project-specific configuration
```

---

## Core Concepts

### 1. Generic Types System

**Configurable Custom Claims**:
```typescript
// Different projects define their own claim structures
interface EcommerceCustomClaims {
  userID: string;
  storeIDs: string[];
  subscriptionTier: 'free' | 'pro' | 'enterprise';
}

interface SaaSCustomClaims {
  organizationId: string;
  role: string;
  features: string[];
}

// Type-safe handlers
const ecommerceHandler = TokenHandler<EcommerceCustomClaims>({ ... });
const saasHandler = TokenHandler<SaaSCustomClaims>({ ... });
```

**Normalized Token Structure**:
```typescript
interface NormalizedToken<TCustomClaims> {
  // Core identity (same across all projects)
  authUID: string;                    // Provider's user ID
  userUID: string | null;             // App's user ID
  
  // Contact info (from provider)
  email: string | null;
  emailVerified: boolean;
  phoneNumber: string | null;
  
  // Token metadata
  issuedAt: number;                   // Unix timestamp
  expiresAt: number;                  // Unix timestamp
  issuer: string;                     // "firebase", "auth0", "clerk"
  
  // Project-specific custom claims
  customClaims: TCustomClaims;
  
  // Raw provider data (debugging only)
  rawClaims: Record<string, any>;
}
```

### 2. Provider Adapter Pattern

**Abstract Interface**:
```typescript
interface ITokenAdapter<TCustomClaims> {
  verifyToken(rawToken: string, logger: Logger): Promise<any>;
  getTokenIdentifier(rawToken: string): Promise<string>;
  normalizeToken(providerToken: any, config: CustomClaimsConfig<TCustomClaims>): NormalizedToken<TCustomClaims>;
  syncCustomClaims(authUID: string, claims: TCustomClaims, logger: Logger): Promise<void>;
  revokeUserTokens(authUID: string, logger: Logger): Promise<boolean>;
  mapProviderError(error: any): TokenVerificationError;
}
```

**Implementations**:
- `FirebaseAuthAdapter` - Complete implementation for Firebase Auth
- `Auth0Adapter` - Future implementation for Auth0
- `ClerkAdapter` - Future implementation for Clerk

### 3. Configurable Blacklist System

**Project-Specific Configuration**:
```typescript
const blacklistConfig = {
  storage: {
    database: 'securityDB',           // Your database name
    collection: 'revokedTokens'       // Your collection name
  },
  retention: {
    cleanupRetentionDays: 90,         // How long to keep individual blacklist entries
    globalRevocationRetentionDays: 30 // How long to keep global revocation timestamps
  },
  reasons: [                          // Your project's blacklist reasons
    'USER_LOGOUT',
    'PASSWORD_CHANGE', 
    'SUBSCRIPTION_EXPIRED',
    'TERMS_VIOLATION'
  ]
};
```

---

## Usage Examples

### Project Configuration

**Create your project's token configuration**:

```typescript
// config/tokens.config.ts
import { createFirebaseTokenHandler } from '../utilities/token-handler';

export interface MyProjectCustomClaims {
  userID: string;
  permissions: string[];
  organizationID: string;
}

export const createProjectTokenHandler = () => {
  return createFirebaseTokenHandler<MyProjectCustomClaims>({
    customClaims: {
      extract: (token) => ({
        userID: token.userID || null,
        permissions: token.permissions || [],
        organizationID: token.organizationID || null
      }),
      validate: (claims) => {
        return claims.userID !== null && Array.isArray(claims.permissions);
      },
      defaults: { userID: null, permissions: [], organizationID: null }
    },
    blacklist: {
      storage: { database: 'mainDB', collection: 'tokenBlacklist' },
      retention: { cleanupRetentionDays: 30, globalRevocationRetentionDays: 30 },
      reasons: ['LOGOUT', 'PASSWORD_CHANGE', 'ROLE_CHANGE', 'ACCOUNT_SUSPENDED']
    },
    database: getFirestoreDatabase('mainDB')
  });
};

export const tokenHandler = createProjectTokenHandler();
```

### Auth Middleware

```typescript
// middleware/auth.middleware.ts
import { tokenHandler } from '../config/tokens.config';
import { UnauthorizedError } from '../utilities/errors';

export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader?.startsWith('Bearer ')) {
    throw new UnauthorizedError('No token provided');
  }
  
  const rawToken = authHeader.substring(7);
  
  // Verify and unpack (auto-checks blacklist)
  const result = await tokenHandler.verifyAndUnpack(rawToken, req.logger);
  
  if (!result.isValid) {
    throw new UnauthorizedError(result.error || 'Invalid token');
  }
  
  // Attach normalized token to request (type-safe!)
  req.user = result.token!;
  next();
}
```

### Single Session Logout

```typescript
// services/auth.service.ts
async logout(userID: string, rawToken: string, logger: Logger): Promise<void> {
  logger.info('Service: User logging out', { userID });
  
  // Verify token to get metadata
  const result = await tokenHandler.verifyAndUnpack(rawToken, logger);
  if (!result.isValid || !result.token) {
    throw new UnauthorizedError('Invalid token');
  }
  
  // Get token identifier
  const tokenIdentifier = await tokenHandler.getTokenIdentifier(rawToken);
  
  // Calculate expiry
  const expiresAt = new Date(result.token.expiresAt * 1000);
  
  // Blacklist this specific token
  await tokenHandler.blacklistToken(
    tokenIdentifier,
    result.token.authUID,
    'LOGOUT',
    expiresAt,
    userID,
    logger
  );
}
```

### Global Session Logout (All Devices)

```typescript
// services/auth.service.ts
async logoutAllSessions(userID: string, logger: Logger): Promise<void> {
  logger.info('Service: Logging out all sessions', { userID });
  
  // Get user's auth UID
  const user = await usersRepository.getUserByIdOrThrow(userID, logger);
  
  // Global token revocation (invalidates all tokens issued before now)
  await tokenHandler.blacklistAllUserTokens(
    user.authUID,
    'LOGOUT',
    userID,
    logger
  );
  
  // Also revoke at provider level (if supported)
  await tokenHandler.revokeUserTokens(user.authUID, logger);
}
```

### Password Change

```typescript
// services/users.service.ts
async changePassword(userID: string, newPassword: string, logger: Logger): Promise<void> {
  const user = await usersRepository.getUserByIdOrThrow(userID, logger);
  
  // Change password at provider level
  await updateUserPassword(user.authUID, newPassword);
  
  // Global token revocation (all existing sessions invalidated)
  await tokenHandler.blacklistAllUserTokens(
    user.authUID,
    'PASSWORD_CHANGE',
    userID,
    logger
  );
  
  // Revoke refresh tokens at provider
  await tokenHandler.revokeUserTokens(user.authUID, logger);
}
```

### Custom Claims Sync

```typescript
// services/users.service.ts
async syncUserClaims(userID: string, logger: Logger): Promise<void> {
  const user = await usersRepository.getUserByIdOrThrow(userID, logger);
  const permissions = await permissionsRepository.getUserPermissions(userID, logger);
  
  const customClaims = {
    userID: userID,
    permissions: permissions.map(p => p.name),
    organizationID: user.organizationID
  };
  
  await tokenHandler.syncCustomClaims(user.authUID, customClaims, logger);
}
```

### CRON Cleanup

```typescript
// scheduled/cleanup.function.ts
import { tokenHandler } from '../config/tokens.config';

export const cleanupTokenBlacklist = onSchedule('every 24 hours', async () => {
  const logger = new Logger('cron-token-cleanup', {});
  
  logger.info('CRON: Starting token blacklist cleanup');
  
  const deletedCount = await tokenHandler.cleanupExpiredEntries(logger);
  
  logger.info('CRON: Cleanup completed', { deletedCount });
});
```

---

## Swapping Auth Providers

One of the key benefits is easy provider swapping. Here's how:

### From Firebase to Auth0

**Step 1: Implement Auth0 Adapter** (when available)
```typescript
// adapters/auth0-adapter.ts
export class Auth0Adapter<TCustomClaims> implements ITokenAdapter<TCustomClaims> {
  // Auth0-specific implementation
}
```

**Step 2: Update Configuration**
```typescript
// config/tokens.config.ts
const providerConfig = {
  type: 'auth0',  // Changed from 'firebase'
  auth0: {
    domain: 'your-auth0-domain.auth0.com',
    audience: 'your-api-identifier'
  }
};

// Update factory function
export const createProjectTokenHandler = () => {
  return createAuth0TokenHandler<MyProjectCustomClaims>({
    // Same custom claims and blacklist config
    customClaims: { ... },
    blacklist: { ... },
    database: getFirestoreDatabase('mainDB')
  });
};
```

**Step 3: Done!**
- No changes to middleware, services, or business logic
- Everything continues working with the same `NormalizedToken<T>` structure
- Provider swap is completely transparent

---

## Configuration Reference

### Custom Claims Configuration

```typescript
interface CustomClaimsConfig<TCustomClaims> {
  /**
   * Extract custom claims from provider token
   */
  extract: (providerToken: any) => TCustomClaims;

  /**
   * Validate custom claims structure (optional)
   */
  validate?: (claims: TCustomClaims) => boolean;

  /**
   * Default/fallback claims when none exist
   */
  defaults: Partial<TCustomClaims>;
}
```

**Example configurations for different projects**:

```typescript
// E-commerce Platform
interface EcommerceCustomClaims {
  customerID: string;
  storeAccess: string[];
  subscriptionTier: 'free' | 'premium' | 'enterprise';
  permissions: string[];
}

const ecommerceClaimsConfig = {
  extract: (token) => ({
    customerID: token.customer_id || null,
    storeAccess: token.stores || [],
    subscriptionTier: token.subscription || 'free',
    permissions: token.permissions || []
  }),
  validate: (claims) => {
    return claims.customerID !== null && 
           ['free', 'premium', 'enterprise'].includes(claims.subscriptionTier);
  },
  defaults: {
    customerID: null,
    storeAccess: [],
    subscriptionTier: 'free',
    permissions: []
  }
};

// SaaS Platform
interface SaaSCustomClaims {
  organizationId: string;
  role: 'admin' | 'member' | 'viewer';
  features: string[];
  apiQuota: number;
}

const saasClaimsConfig = {
  extract: (token) => ({
    organizationId: token.org_id || null,
    role: token.role || 'viewer',
    features: token.features || [],
    apiQuota: token.api_quota || 1000
  }),
  validate: (claims) => {
    return claims.organizationId !== null &&
           ['admin', 'member', 'viewer'].includes(claims.role) &&
           typeof claims.apiQuota === 'number';
  },
  defaults: {
    organizationId: null,
    role: 'viewer',
    features: [],
    apiQuota: 1000
  }
};
```

### Blacklist Configuration

```typescript
interface BlacklistConfig {
  storage: {
    database: string;        // Database name
    collection: string;      // Collection name
  };
  retention: {
    cleanupRetentionDays: number;           // Individual token blacklist retention
    globalRevocationRetentionDays: number;  // Global revocation retention
  };
  reasons: string[];         // Valid blacklist reasons for this project
}
```

**Project-specific examples**:

```typescript
// High-security Financial App
const financialBlacklistConfig = {
  storage: { database: 'securityDB', collection: 'revokedSessions' },
  retention: { cleanupRetentionDays: 90, globalRevocationRetentionDays: 365 },
  reasons: [
    'USER_LOGOUT',
    'PASSWORD_CHANGE',
    'SUSPICIOUS_ACTIVITY',
    'COMPLIANCE_REVOCATION',
    'ACCOUNT_FROZEN',
    'REGULATORY_REQUIREMENT'
  ]
};

// Casual Social App
const socialBlacklistConfig = {
  storage: { database: 'mainDB', collection: 'tokenBlacklist' },
  retention: { cleanupRetentionDays: 7, globalRevocationRetentionDays: 30 },
  reasons: [
    'LOGOUT',
    'PASSWORD_CHANGE',
    'ACCOUNT_DEACTIVATED'
  ]
};
```

### Provider Configuration

```typescript
interface ProviderConfig {
  type: 'firebase' | 'auth0' | 'clerk' | 'custom';
  
  firebase?: {
    projectId?: string;
    // Other Firebase-specific config
  };
  
  auth0?: {
    domain: string;
    audience: string;
    // Other Auth0-specific config
  };
  
  clerk?: {
    secretKey: string;
    // Other Clerk-specific config
  };
}
```

---

## Security Features

### Token Verification Flow

```
1. Extract token from Authorization header
2. Verify signature with auth provider (Firebase Admin SDK, Auth0, etc.)
3. Check individual token blacklist (via token identifier)
4. Check global user revocation timestamp
5. If token.issuedAt < revocation.timestamp → BLACKLISTED
6. Normalize to NormalizedToken<T> structure
7. Return TokenVerificationResult<T>
```

### Blacklist Strategy

**Individual Token Blacklist**:
- **Identifier**: Provider JTI claim or SHA-256 hash of JWT
- **Lookup**: O(1) via database index on `tokenJTI`
- **Use case**: Single session logout
- **Storage**: Database collection with `tokenJTI = identifier`

**Global User Revocation**:
- **Identifier**: Special JTI format `ALL_TOKENS_{authUID}`
- **Check**: `token.issuedAt < blacklist.blacklistedAt`
- **Use case**: Password change, account deletion, security breach
- **Storage**: Database collection with timestamp

### Auto-Cleanup

CRON function runs periodically to delete expired blacklist entries:
```typescript
await tokenHandler.cleanupExpiredEntries(logger);
```

**Retention**:
- Individual tokens: Until token naturally expires (or configured retention days)
- Global revocations: Configurable retention period (e.g., 30-365 days)

---

## Database Schema

### Collection: {configurable}

```typescript
interface TokenBlacklistEntry {
  blacklistEntryUID: string;          // Document ID
  tokenJTI: string;                   // Token identifier OR "ALL_TOKENS_{authUID}"
  authUID: string;                    // User who owned this token
  blacklistedAt: Date;                // When blacklisted
  blacklistedBy: string | null;       // userUID who triggered (or null)
  reason: string;                     // Configurable reason (project-specific)
  expiresAt: Date;                    // Auto-delete after this date
}
```

**Required Indexes**:
```javascript
tokenJTI                                 // Primary blacklist lookup
authUID                                  // User's blacklisted tokens  
expiresAt                                // Cleanup job
(tokenJTI, authUID)                      // Fast composite lookup
(authUID, blacklistedAt)                 // User token history
```

---

## Testing

### Unit Test Structure

```typescript
// Test generic handler with mocked adapter
describe('TokenHandler<CustomClaims>', () => {
  let mockAdapter: jest.Mocked<ITokenAdapter<TestCustomClaims>>;
  let mockDatabase: jest.Mocked<ITokenDatabase>;
  let tokenHandler: TokenHandler<TestCustomClaims>;

  beforeEach(() => {
    mockAdapter = createMockAdapter();
    mockDatabase = createMockDatabase();
    tokenHandler = createTokenHandler(testConfig, mockAdapter);
  });

  describe('verifyAndUnpack', () => {
    it('should verify valid token and return normalized result', async () => {
      // Test implementation
    });
    
    it('should reject blacklisted token', async () => {
      // Test implementation
    });
  });
});

// Test provider-specific adapters
describe('FirebaseAuthAdapter', () => {
  // Firebase-specific tests
});

// Test with different custom claims configurations
describe('Custom Claims Handling', () => {
  it('should handle e-commerce custom claims', async () => {
    // Test with EcommerceCustomClaims
  });
  
  it('should handle SaaS custom claims', async () => {
    // Test with SaaSCustomClaims
  });
});
```

### Integration Tests

```typescript
// Test full flow with real Firebase (emulator)
describe('Integration: Firebase Token Handler', () => {
  let firebaseApp: admin.app.App;
  let tokenHandler: TokenHandler<TestCustomClaims>;

  beforeAll(async () => {
    // Setup Firebase emulator
    firebaseApp = initializeTestApp();
    tokenHandler = createTestTokenHandler();
  });

  it('should handle complete auth flow', async () => {
    // 1. Create test user in Firebase Auth
    // 2. Generate real token
    // 3. Verify with token handler
    // 4. Test blacklisting
    // 5. Verify blacklist enforcement
  });
});
```

---

## Migration Guide

### From Version 1.x (Original Implementation)

**No Breaking Changes Required**:

1. **Keep existing imports working**:
   ```typescript
   // This continues to work
   import { tokenHandler, tokenBlacklist } from '../utilities/token';
   ```

2. **Gradually adopt new API**:
   ```typescript
   // New code can use the configured handler directly
   import { createProjectTokenHandler } from '../config/tokens.config';
   const handler = createProjectTokenHandler();
   ```

3. **Eventually remove compatibility layer**:
   - After all code is migrated, remove singleton exports
   - Update imports to use factory functions

### Adding to New Project

1. **Copy utility folder**:
   ```bash
   cp -r utilities/token-handler/ your-project/utilities/
   ```

2. **Create your configuration**:
   ```typescript
   // your-project/config/tokens.config.ts
   import { createFirebaseTokenHandler } from '../utilities/token-handler';
   
   interface YourCustomClaims {
     // Define your project's custom claims
   }
   
   export const tokenHandler = createFirebaseTokenHandler<YourCustomClaims>({
     // Your configuration
   });
   ```

3. **Use in middleware**:
   ```typescript
   const result = await tokenHandler.verifyAndUnpack(rawToken, logger);
   ```

---

## Troubleshooting

### Token Verification Fails

**Symptom**: `401 Unauthorized` on all requests

**Causes & Solutions**:
1. **Token expired**: Check `exp` claim in JWT
2. **Invalid signature**: Verify provider configuration (project ID, secret key)
3. **Token blacklisted**: Check blacklist database
4. **Custom claims invalid**: Verify claims extraction logic

**Debug**:
```typescript
const result = await tokenHandler.verifyAndUnpack(rawToken, logger);
console.log('Verification result:', {
  isValid: result.isValid,
  isBlacklisted: result.isBlacklisted,
  error: result.error
});

// Check token structure
const identifier = await tokenHandler.getTokenIdentifier(rawToken);
const isBlacklisted = await tokenHandler.isTokenBlacklisted(identifier, logger);
console.log('Blacklist status:', { identifier: identifier.substring(0, 10), isBlacklisted });
```

### Custom Claims Not Working

**Symptom**: Claims are null or have default values

**Causes & Solutions**:
1. **Claims not synced to provider**: Call `syncCustomClaims()`
2. **Extraction logic incorrect**: Check `extract` function
3. **Provider claims structure changed**: Update extraction logic

**Debug**:
```typescript
// Check raw provider token
const result = await tokenHandler.verifyAndUnpack(rawToken, logger);
if (result.token) {
  console.log('Raw claims from provider:', result.token.rawClaims);
  console.log('Extracted custom claims:', result.token.customClaims);
}
```

### Blacklist Not Working

**Symptom**: Revoked user can still make requests

**Causes & Solutions**:
1. **Blacklist entry not created**: Check database
2. **Token identifier mismatch**: Verify hash generation
3. **Global revocation timing**: Check `issuedAt` vs `blacklistedAt`

**Debug**:
```typescript
// Check blacklist directly
const identifier = await tokenHandler.getTokenIdentifier(rawToken);
const isBlacklisted = await tokenHandler.isTokenBlacklisted(identifier, logger);

// Check global revocation
const authUID = 'user-auth-id';
const revocationTime = await tokenHandler.getUserTokenRevocationTime(authUID, logger);
console.log('Revocation check:', { identifier, isBlacklisted, revocationTime });
```

---

## API Reference

### TokenHandler<TCustomClaims>

```typescript
interface ITokenHandler<TCustomClaims> {
  // Core verification
  verifyAndUnpack(rawToken: string, logger: Logger): Promise<TokenVerificationResult<TCustomClaims>>;
  getTokenIdentifier(rawToken: string): Promise<string>;
  
  // Provider operations
  syncCustomClaims(authUID: string, claims: TCustomClaims, logger: Logger): Promise<void>;
  revokeUserTokens(authUID: string, logger: Logger): Promise<boolean>;
  
  // Blacklist operations
  blacklistToken(tokenIdentifier: string, authUID: string, reason: string, tokenExpiresAt: Date, blacklistedBy: string | null, logger: Logger): Promise<TokenBlacklistEntry>;
  blacklistAllUserTokens(authUID: string, reason: string, blacklistedBy: string | null, logger: Logger): Promise<void>;
  isTokenBlacklisted(tokenIdentifier: string, logger: Logger): Promise<boolean>;
  getUserTokenRevocationTime(authUID: string, logger: Logger): Promise<Date | null>;
  
  // Maintenance
  cleanupExpiredEntries(logger: Logger): Promise<number>;
}
```

### Factory Functions

```typescript
// Generic factory
createTokenHandler<T>(config: TokenHandlerConfig<T>, adapter: ITokenAdapter<T>): TokenHandler<T>

// Firebase-specific factory
createFirebaseTokenHandler<T>(config: FirebaseTokenConfig<T>): TokenHandler<T>

// Auth0-specific factory (future)
createAuth0TokenHandler<T>(config: Auth0TokenConfig<T>): TokenHandler<T>

// Adapter factories
createFirebaseAuthAdapter<T>(): FirebaseAuthAdapter<T>
createFirestoreTokenDatabase(db: Firestore, collection: string): FirestoreTokenDatabase
```

---

## Contributing

### Adding New Auth Providers

1. **Implement `ITokenAdapter<T>`**:
   ```typescript
   // adapters/your-provider-adapter.ts
   export class YourProviderAdapter<T> implements ITokenAdapter<T> {
     // Implement all required methods
   }
   ```

2. **Add factory function**:
   ```typescript
   export function createYourProviderTokenHandler<T>(config: YourProviderConfig<T>) {
     // Create adapter and handler
   }
   ```

3. **Update exports**:
   ```typescript
   // index.ts
   export { createYourProviderTokenHandler } from './factories/your-provider-factory';
   ```

4. **Add tests**:
   ```typescript
   // __tests__/adapters/your-provider-adapter.test.ts
   describe('YourProviderAdapter', () => {
     // Test all methods
   });
   ```

### Code Standards

- **TypeScript strict mode** enabled
- **Generic types** for custom claims
- **Comprehensive error handling** with provider error mapping
- **Security-conscious logging** (no PII in logs)
- **100% test coverage** for new adapters
- **Documentation** for all public methods

---

## Version History

**v2.0** (2025-01-21)
- Portable, configurable architecture
- Generic custom claims support
- Provider adapter pattern
- Configurable blacklist system
- Full backwards compatibility

**v1.0** (2025-01-05)
- Initial Firebase-specific implementation
- Fixed custom claims structure
- Hardcoded configuration

---

## License

Internal utility for use across project portfolios.