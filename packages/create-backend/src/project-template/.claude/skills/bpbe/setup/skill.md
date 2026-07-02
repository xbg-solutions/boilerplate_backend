---
description: "Setup, configuration, and development workflow for the XBG boilerplate backend: creating projects with the CLI, .env variables, npm scripts, Firebase config, validation, and local dev server."
---

# XBG Boilerplate Backend — Setup & Configuration

---

## Quick Start — New Project

```bash
# Scaffold a new project with the CLI
npx @xbg.solutions/create-backend init

# The CLI will:
#   - Ask about your project (name, Firebase project, features)
#   - Let you select which utilities to include
#   - Generate project structure with selected @xbg.solutions/* packages
#   - Install dependencies

# Once scaffolded:
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
│   ├── .gitignore                # Ignores .env, node_modules, lib, keys
│   └── .env                      # Secrets — gitignored, never committed
├── __scripts__/                  # Setup, generate, deploy, validate
├── __examples__/                 # Example data models
├── firebase.json
├── firestore.rules
├── firestore.indexes.json        # Composite indexes (required for token revocation)
├── .gitignore                    # Root-level ignore rules
├── UPGRADING.md                  # Read before bumping @xbg.solutions/* versions
└── .firebaserc
```

> **Secrets never get committed.** `init` writes `.gitignore` files — at the project root **and** in `functions/` — *before* it creates the secret-bearing `functions/.env`, so credentials can't be accidentally committed on your first push. These ignore `.env`/`.env.*` (except `.env.example`), `node_modules/`, `lib/`, `serviceAccountKey*.json`, `*-credentials.json`, and similar.
>
> Only the skills under `.claude/skills/` are scaffolded — projects no longer ship a `.claude/settings.local.json` permission allowlist (which could auto-approve destructive commands).

### Updating an Existing Project

```bash
# Check for and apply boilerplate updates
npx @xbg.solutions/create-backend sync

# Update packages to latest versions
cd functions && npm update

# Add a new utility
npx @xbg.solutions/create-backend add-util
```

> Read **`UPGRADING.md`** (project root) before bumping `@xbg.solutions/*` package versions — it documents breaking secure-by-default changes and the deferred `firebase-admin` v14 upgrade.

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

Required for the hashing utility (`@xbg.solutions/utils-hashing`). Without it, `hashValue()` will throw at runtime.

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

## Configuration in Code

All config is centralized via `@xbg.solutions/backend-core`. In a generated project, configuration is driven entirely by environment variables.

Reading config in your code:

```typescript
// ✅ Correct — import from @xbg.solutions/backend-core
import { APP_CONFIG, isFeatureEnabled } from '@xbg.solutions/backend-core';
const basePath = APP_CONFIG.api.basePath;
const env = APP_CONFIG.app.environment;

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

# Setup & Validation
npm run setup          # Interactive setup wizard
npm run validate       # Full: build + tests
npm run validate:quick # Quick: build only

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

Defines the functions source directory and references `firestore.rules` and `firestore.indexes.json`. Its `functions.predeploy` hook runs **build only** — `["npm --prefix \"$RESOURCE_DIR\" run build"]`. It does **not** run lint; ESLint is not configured by default, so there is no lint step to fix before deploying. Generally don't modify this.

### `firestore.rules` (project root)

Deny-all rules for client SDK access. This backend uses the Admin SDK (which bypasses rules). These rules act as defense-in-depth against accidental client-side database exposure.

### `firestore.indexes.json` (project root)

Wired into `firebase.json` as `firestore.indexes`. It ships the composite index **required** by the token-handler global-revocation query — the `tokenBlacklist` collection indexed on `tokenJTI` (ASC) + `blacklistedAt` (DESC). That query runs on **every authenticated request**; without the index a fresh deploy returns `FAILED_PRECONDITION` and every authenticated request fails.

Deploy indexes with:

```bash
firebase deploy --only firestore:indexes   # or a full `firebase deploy`
```

> If you change `TOKEN_BLACKLIST_COLLECTION` from its default, update the index's `collectionGroup` in `firestore.indexes.json` to match.

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
