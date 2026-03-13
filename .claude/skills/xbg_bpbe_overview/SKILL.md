---
description: "Overview of the XBG boilerplate backend: architecture, philosophy, layered structure, and navigation guide to sub-skills for setup, data, services, utilities, and API."
---

# XBG Boilerplate Backend — Overview

A production-ready Node.js/TypeScript backend distributed as **npm packages** (`@xbg/*`) and optimized for AI-assisted development. Built on Firebase Functions + Firestore + Express.js, designed so that AI can reliably generate, extend, and debug application code.

**Repository:** `boilerplate_backend` (sister: `boilerplate_frontend` — SvelteKit 5)

---

## Core Philosophy

This boilerplate provides **infrastructure**; you (or AI) provide **business logic**. The pattern is:

1. Scaffold a new project with `npx @xbg/create-backend init`
2. Define a declarative data model (`DataModelSpecification`)
3. Run the generator to scaffold Controller/Service/Repository/Entity
4. Register the controller in `functions/src/index.ts`
5. Add business logic in the service layer

The boilerplate never ships pre-built domain models (no User, Product, Order). That's intentional — AI generates those from your model spec.

---

## Architecture: Distributable npm Packages

This boilerplate is structured as a **monorepo of publishable npm packages**, enabling update propagation to projects built on it.

```
boilerplate_backend/
├── packages/
│   ├── core/                    → @xbg/backend-core
│   │   ├── src/
│   │   │   ├── base/            #   BaseEntity, BaseRepository, BaseService, BaseController
│   │   │   ├── middleware/      #   Auth, CORS, rate limiting, error handling, logging
│   │   │   ├── config/          #   App, database, auth, cache, middleware config
│   │   │   ├── types/           #   Custom error classes
│   │   │   ├── generator/       #   Code generator engine
│   │   │   ├── templates/       #   Handlebars templates for code generation
│   │   │   └── app.ts           #   Express app factory
│   │   └── package.json
│   │
│   ├── utils-logger/            → @xbg/utils-logger
│   ├── utils-events/            → @xbg/utils-events
│   ├── utils-errors/            → @xbg/utils-errors
│   ├── utils-cache-connector/   → @xbg/utils-cache-connector
│   ├── utils-firestore-connector/ → @xbg/utils-firestore-connector
│   ├── utils-hashing/           → @xbg/utils-hashing
│   ├── utils-token-handler/     → @xbg/utils-token-handler
│   ├── utils-email-connector/   → @xbg/utils-email-connector
│   ├── utils-sms-connector/     → @xbg/utils-sms-connector
│   ├── ... (20+ utility packages)
│   │
│   └── create-backend/          → @xbg/create-backend (CLI scaffolding tool)
│
├── functions/                   ← Local development/testing workspace (not published)
│   ├── src/                     #   Mirrors packages structure for local dev
│   └── __tests__/               #   Test suite
├── __examples__/                ← Sample DataModelSpecification files
├── __scripts__/                 ← Project-level scripts (setup, generate, deploy, validate)
└── package.json                 ← Monorepo root (npm workspaces)
```

### Two-Part Distribution Model

1. **npm packages** (runtime dependencies) — Base classes, middleware, config, and utilities live in `node_modules/`. Updates propagate via `npm update`. Semver protects against breaking changes.

2. **CLI scaffolding tool** (`@xbg/create-backend`) — Handles project structure, config files, scripts, and templates. Operates in init mode (new project) and sync mode (update existing).

This is the same pattern as `firebase-tools` + `firebase init`.

---

## Architecture: Strict 3-Layer Stack

```
HTTP Request
    ↓
BaseController        ← Route handling, request/response shaping
    ↓
BaseService           ← Business logic, auth checks, event publishing
    ↓
BaseRepository        ← Firestore CRUD, soft-delete, caching
    ↓
Firestore
```

All generated code follows this exact pattern. Never put business logic in controllers, never put Firestore calls in services.

---

## Sub-Skills — When to Use Each

| Skill | Use when you need to... |
|---|---|
| `/xbg_bpbe_setup` | Create a new project, configure .env, understand npm scripts, validate config |
| `/xbg_bpbe_data` | Define entities, understand BaseEntity, use the generator, work with Firestore schemas |
| `/xbg_bpbe_services` | Write service methods, handle events, implement auth/access control, lifecycle hooks |
| `/xbg_bpbe_utils` | Use logger, PII hashing, cache, token handler, or any communication connector |
| `/xbg_bpbe_api` | Add routes, register controllers, use middleware, understand API response shapes |

---

## Key Import Paths

All imports come from npm packages — no relative paths to boilerplate internals.

```typescript
// Base classes (from @xbg/backend-core)
import { BaseEntity, ValidationHelper, ValidationResult } from '@xbg/backend-core';
import { BaseRepository, QueryOptions } from '@xbg/backend-core';
import { BaseService, RequestContext, ServiceResult } from '@xbg/backend-core';
import { BaseController, ApiResponse } from '@xbg/backend-core';

// App factory and config
import { createApp, APP_CONFIG, isFeatureEnabled } from '@xbg/backend-core';

// Middleware
import { createAuthMiddleware, requireRoles, requireAdmin } from '@xbg/backend-core';

// Utilities (each is a separate package)
import { logger } from '@xbg/utils-logger';
import { eventBus, EventType } from '@xbg/utils-events';
import { hashValue, hashFields, unhashValue } from '@xbg/utils-hashing';
import { getCacheConnector } from '@xbg/utils-cache-connector';
import { tokenHandler } from '@xbg/utils-token-handler';
import { emailConnector } from '@xbg/utils-email-connector';
```

---

## Tech Stack

- **Runtime:** Node.js 22+, TypeScript (strict mode)
- **Framework:** Express.js
- **Deployment:** Firebase Functions (also runs on Cloud Run, AWS Lambda, Docker)
- **Database:** Firestore (multi-database support)
- **Auth:** Firebase Auth + custom JWT token handler with blacklisting
- **Testing:** Jest, 796 passing tests
- **Caching:** Memory / Firestore / Redis (progressive, per-repository opt-in)
- **Events:** Internal EventEmitter-based event bus (not Pub/Sub)

---

## Non-Obvious Decisions

- **Soft delete by default.** `BaseRepository.delete()` sets `deletedAt`; pass `hardDelete=true` for permanent. `findAll()` automatically excludes soft-deleted records.
- **`deletedAt === null` in Firestore queries.** The repository filters by `where('deletedAt', '==', null)` — this requires a composite index if combined with other where clauses.
- **Events are synchronous.** The event bus uses Node.js `EventEmitter`. It's fire-and-forget within the request lifecycle, not durable. For durable async, use Firebase Pub/Sub or queue systems.
- **Generated code goes in `src/generated/`.** This directory is gitignored in production projects. Treat generated files as a starting point — copy and modify in your own directories.
- **Config is all env-driven.** Never hardcode values in config. Feature flags via `FEATURE_*` env vars.
