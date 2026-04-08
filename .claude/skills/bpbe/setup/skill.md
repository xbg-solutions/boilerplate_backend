---
name: bpbe-setup
description: "Setup, configuration, and development workflow for the XBG boilerplate backend: creating projects with the CLI, .env variables, npm scripts, Firebase config, validation, and local dev server."
---

# XBG Boilerplate Backend — Setup & Configuration

---

## Quick Start — New Project

### Interactive (human users)

```bash
# Scaffold a new project with the CLI
npx @xbg.solutions/create-backend init

# The CLI will:
#   - Ask about your project (name, Firebase project, features)
#   - Let you select which utilities to include
#   - Generate project structure with selected @xbg.solutions/* packages
#   - Install dependencies
```

### Non-interactive (agents / CI)

Pass a `setup-config.json` to skip all interactive prompts:

```bash
npx @xbg.solutions/create-backend init --config setup-config.json

# Or shorthand (no "init" subcommand needed):
npx @xbg.solutions/create-backend --config setup-config.json

# Combine with other flags:
npx @xbg.solutions/create-backend init -d ./my-project --config setup-config.json --skip-install
```

#### setup-config.json shape

Only `firebaseProject` is required. All other fields fall back to sensible defaults if omitted.

```jsonc
{
  // Required
  "firebaseProject": "my-firebase-project-id",

  // Optional — defaults shown
  "projectName": "my-app",                    // defaults to target directory basename
  "deploymentMode": "standalone",             // "standalone" | "monorepo"
  "environment": "development",               // "development" | "staging" | "production"
  "multiDB": true,
  "apiBasePath": "/api/v1",
  "corsOrigins": "http://localhost:5173,http://localhost:3000",

  "features": {
    "auth": true,
    "multiTenant": false,
    "fileUploads": true,
    "notifications": true,
    "analytics": false,
    "realtime": true
  },

  // Optional utility packages (core utils are always included).
  // Defaults to cache-connector, token-handler, and validation.
  "selectedUtils": [
    "@xbg.solutions/utils-cache-connector",
    "@xbg.solutions/utils-token-handler",
    "@xbg.solutions/utils-validation"
  ]
}
```

**Available `selectedUtils` packages** (all prefixed `@xbg.solutions/`):

| Category | Packages |
|---|---|
| Data | `utils-cache-connector`, `utils-firebase-event-bridge` |
| Communication | `utils-email`, `utils-sms`, `utils-push-notifications`, `utils-realtime` |
| Integration | `utils-crm`, `utils-llm`, `utils-erp`, `utils-journey`, `utils-survey`, `utils-work-mgmt`, `utils-document` |
| Security | `utils-token-handler`, `utils-hashing`, `utils-validation` |
| Infrastructure | `utils-timezone`, `utils-address-validation` |

Core utilities (`utils-logger`, `utils-events`, `utils-errors`, `utils-firestore-connector`) are always included regardless of `selectedUtils`.

An example config file is included at `__examples__/setup-config.json` in every scaffolded project.

### After scaffolding

```bash
cd my-project/functions

# Interactive setup wizard (generates .env, configures Firebase)
npm run setup

# Validate configuration + run tests
npm run validate

# Start local dev server
npm start
# Visit: http://localhost:5001/health
```

### What a Generated Project Looks Like

```
my-project/
├── functions/
│   ├── src/
│   │   ├── index.ts              # Firebase Functions entry point
│   │   └── generated/            # Code generator output
│   ├── package.json              # Depends on @xbg.solutions/* packages
│   ├── tsconfig.json
│   └── .env
├── __scripts__/                  # Setup, generate, deploy, validate
├── __examples__/                 # Example data models
├── firebase.json
└── .firebaserc
```

### Updating an Existing Project

```bash
# Check for and apply boilerplate updates
npx @xbg.solutions/create-backend sync

# Update packages to latest versions
cd functions && npm update

# Add a new utility
npx @xbg.solutions/create-backend add-util
```

---

## Environment Variables

Copy `.env.example` to `.env` in the `functions/` directory. All config is env-driven — never hardcode values.

### Core Variables

```bash
# Application
APP_NAME=my-backend-api
APP_VERSION=1.0.0
NODE_ENV=development         # development | staging | production
PORT=5001

# Firebase
FIREBASE_PROJECT_ID=your-project-id

# API
API_BASE_PATH=/api/v1
CORS_ORIGINS=http://localhost:3000,http://localhost:5173
REQUEST_SIZE_LIMIT=10mb
```

### Feature Flags

```bash
FEATURE_AUTHENTICATION=true     # JWT auth middleware
FEATURE_MULTI_TENANT=false      # Multi-tenant mode
FEATURE_FILE_UPLOADS=true
FEATURE_NOTIFICATIONS=true
FEATURE_ANALYTICS=false
FEATURE_REALTIME=true
```

Feature flags gate entire subsystems. Check them in code:

```typescript
import { isFeatureEnabled } from '@xbg.solutions/backend-core';

if (isFeatureEnabled('notifications')) {
  await pushNotificationsConnector.send({ ... });
}
```

### Auth / Token Variables

```bash
JWT_ISSUER=my-backend-api
JWT_AUDIENCE=my-backend-api
JWT_EXPIRES_IN=1h
JWT_REFRESH_EXPIRES_IN=7d
TOKEN_BLACKLIST_ENABLED=true
TOKEN_BLACKLIST_CLEANUP_INTERVAL=3600000
TOKEN_BLACKLIST_RETENTION_DAYS=30
```

### Database

```bash
MAIN_DATABASE_ID=(default)       # Primary Firestore database ID
ANALYTICS_DATABASE_ID=analytics  # Secondary database (optional)
DB_RETRY_ATTEMPTS=3
DB_RETRY_DELAY=1000
DB_TIMEOUT=10000
DB_ENABLE_CACHE=true
```

### PII Encryption

```bash
# Generate: openssl rand -hex 32
PII_ENCRYPTION_KEY=your-64-hex-char-key
```

Required for the hashing utility (`@xbg.solutions/utils-hashing`). Without it, any `hashValue()` or `unhashValue()` call will throw at runtime.

**Key requirements:**
- Exactly 64 hex characters (= 32 bytes for AES-256)
- Must be identical across all environments that share encrypted data
- Rotating the key requires re-encrypting all existing PII — there is no built-in key rotation

**Startup checklist for encrypted entities:**
1. Set `PII_ENCRYPTION_KEY` in `.env`
2. Call `registerEncryptedFields()` (from generated `encryption-registry.ts`) before any database read/write
3. See the **Data Layer** skill for full hasher utility documentation (transparent vs guarded modes, function reference, dot-path support)

### Caching

```bash
CACHE_ENABLED=false              # Global cache switch
CACHE_DEFAULT_PROVIDER=memory    # memory | firestore | redis
CACHE_DEFAULT_TTL=300            # seconds
CACHE_NAMESPACE=myapp
# Redis (optional):
CACHE_REDIS_HOST=localhost
CACHE_REDIS_PORT=6379
```

### Google Maps / Address Validation

```bash
GOOGLE_MAPS_API_KEY=your-api-key     # Required for utils-address-validation
GOOGLE_MAPS_TIMEOUT=5000             # Request timeout (ms)
GOOGLE_MAPS_RATE_LIMIT_PER_SECOND=50
GOOGLE_MAPS_RATE_LIMIT_PER_DAY=100000
```

### Rate Limiting

```bash
RATE_LIMIT_ENABLED=true
RATE_LIMIT_WINDOW_MS=900000      # 15 minutes
RATE_LIMIT_MAX=100               # requests per window
```

---

## Configuration in Code

All config is centralized via `@xbg.solutions/backend-core`. In a generated project, configuration is driven entirely by environment variables.

### Config Modules

| Module | Exports | Barrel-exported |
|---|---|---|
| `app.config` | `APP_CONFIG`, `isFeatureEnabled`, `validateAppConfig` | Yes |
| `database.config` | `getFirestoreDb` | Yes |
| `auth.config` | Auth config, `validateAuthConfig` | Yes |
| `middleware.config` | Middleware settings | Yes |
| `communications.config` | Email/SMS/push config, `validateCommunicationsConfig` | Yes |
| `cache.config` | Cache settings, `validateCacheConfig` | Yes |
| `firestore.config` | `FIRESTORE_CONFIG`, `DatabaseName`, `getFirestoreDatabaseName` | Yes |
| `maps.config` | `MAPS_CONFIG`, `getGoogleMapsApiKey`, `isGoogleMapsConfigured` | Yes |
| `firebase-event-mapping.config` | `mapFirebaseEventToDomain`, `validateEventMappings` | Yes |
| `tokens.config` | `tokenHandler`, `tokenBlacklist`, `CustomClaims`, `BlacklistReason` | **No** — eagerly instantiates singletons; import directly |

Reading config in your code:

```typescript
// ✅ Correct — import from @xbg.solutions/backend-core
import { APP_CONFIG, isFeatureEnabled } from '@xbg.solutions/backend-core';
const basePath = APP_CONFIG.api.basePath;
const env = APP_CONFIG.app.environment;

// ✅ Firestore config
import { FIRESTORE_CONFIG, getFirestoreDatabaseName } from '@xbg.solutions/backend-core';

// ✅ Token handler — import from the utility package, not from core barrel
import { tokenHandler } from '@xbg.solutions/utils-token-handler';

// ❌ Wrong — don't access process.env scattered through your code
const basePath = process.env.API_BASE_PATH; // don't do this
```

---

## npm Scripts

Run from `functions/` in a generated project:

```bash
# Development
npm start              # Local server (http://localhost:5001)
npm run serve          # Firebase emulators
npm run build          # TypeScript compile
npm run build:watch    # Watch mode

# Testing
npm test               # All tests
npm run test:coverage  # Coverage report
npm run test:watch     # Watch mode

# Code Quality
npm run lint           # ESLint
npm run lint:fix       # Auto-fix lint issues

# Setup & Validation
npm run setup          # Interactive setup wizard
npm run validate       # Full: build + lint + tests
npm run validate:quick # Quick: build + lint only

# Code Generation
npm run generate <model-file> [model-file2 ...]   # Generate from DataModelSpecification
# Examples:
npm run generate ../__examples__/blog-platform.model.js
npm run generate ../__examples__/accounts.model.js ../__examples__/projects.model.js

# Deployment
npm run deploy         # Deploy to Firebase
npm run logs           # View Firebase logs
```

---

## Firebase Configuration

### `firebase.json` (project root)

Defines functions source directory and references `firestore.rules`. Generally don't modify this.

### `firestore.rules` (project root)

Deny-all rules for client SDK access. This backend uses the Admin SDK (which bypasses rules). These rules act as defense-in-depth against accidental client-side database exposure.

### `.firebaserc` (project root)

Maps aliases to Firebase project IDs:

```json
{
  "projects": {
    "default": "your-firebase-project-id",
    "staging": "your-staging-project-id",
    "production": "your-production-project-id"
  }
}
```

Switch projects: `firebase use staging`

### Local Development with Emulators

```bash
# Start Firestore emulator
firebase emulators:start --only firestore

# In .env, add:
FIRESTORE_EMULATOR_HOST=localhost:8080
```

---

## Validation

Run `npm run validate` before deploying. It checks:

- Node.js version (22+)
- Firebase CLI installed
- TypeScript compiles cleanly
- All tests pass
- `.env` has required variables
- No placeholder values left in config

Common validation failures and fixes:

```bash
# "TypeScript compilation failed"
npm run build        # See full TS errors

# "Tests failing"
npm test             # See which tests

# "PII_ENCRYPTION_KEY not set"
openssl rand -hex 32   # Generate a key, add to .env
```

---

## Anti-Examples

```typescript
// ❌ Don't hardcode env values
export const config = {
  apiKey: 'abc123'  // Never do this
};

// ❌ Don't scatter process.env calls
const limit = parseInt(process.env.RATE_LIMIT_MAX);  // Use APP_CONFIG

// ❌ Don't ignore feature flags
await emailConnector.send({ ... });  // Check isFeatureEnabled('notifications') first

// ✅ Correct pattern
if (isFeatureEnabled('notifications')) {
  await emailConnector.send({ ... });
}
```
