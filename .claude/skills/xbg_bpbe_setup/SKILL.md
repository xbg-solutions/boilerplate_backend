---
description: "Setup, configuration, and development workflow for the XBG boilerplate backend: .env variables, npm scripts, Firebase config, setup wizard, validation, and local dev server."
---

# XBG Boilerplate Backend — Setup & Configuration

Everything lives in `functions/` directory. All commands are run from `functions/`.

---

## Quick Start

```bash
cd boilerplate_backend/functions
npm install

# Interactive setup wizard (generates .env, configures Firebase)
npm run setup

# Validate configuration + run tests
npm run validate

# Start local dev server
npm start
# Visit: http://localhost:5001/health
```

---

## Environment Variables

Copy `functions/.env.example` to `functions/.env`. All config is env-driven — never hardcode values.

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
import { isFeatureEnabled } from './config/app.config';

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

Required for the hashing utility. Without it, `hashValue()` will throw at runtime.

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

### Rate Limiting

```bash
RATE_LIMIT_ENABLED=true
RATE_LIMIT_WINDOW_MS=900000      # 15 minutes
RATE_LIMIT_MAX=100               # requests per window
```

---

## Configuration Files

All config is centralized in `functions/src/config/`:

```
config/
├── app.config.ts        ← APP_CONFIG: app, api, features, integrations, logging
├── auth.config.ts       ← Auth providers, JWT settings
├── cache.config.ts      ← CACHE_CONFIG: enabled, provider, TTL, namespace
├── database.config.ts   ← Database connections, retry settings
├── middleware.config.ts ← Rate limits, CORS settings
├── tokens.config.ts     ← Token blacklist settings
├── maps.config.ts       ← Google Maps API config
├── communications.config.ts ← Email, SMS, push provider config
└── index.ts             ← Re-exports + validateAllConfig()
```

Reading config in your code:

```typescript
// ✅ Correct — import from config, not process.env directly
import { APP_CONFIG } from './config/app.config';
const basePath = APP_CONFIG.api.basePath;
const env = APP_CONFIG.app.environment;

// ❌ Wrong — don't access process.env scattered through your code
const basePath = process.env.API_BASE_PATH; // don't do this
```

---

## npm Scripts

Run from `functions/`:

```bash
# Development
npm start              # Local server (http://localhost:5001)
npm run serve          # Firebase emulators
npm run build          # TypeScript compile
npm run build:watch    # Watch mode

# Testing
npm test               # All 796 tests
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
npm run generate <model-file>   # Generate from DataModelSpecification
# Example:
npm run generate ../__examples__/blog-platform.model.ts

# Deployment
npm run deploy         # Deploy to Firebase
npm run logs           # View Firebase logs
```

---

## Firebase Configuration

### `firebase.json` (project root)

Defines which directory contains functions. Generally don't modify this.

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
