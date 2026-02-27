---
description: "Overview of the XBG boilerplate backend: architecture, philosophy, layered structure, and navigation guide to sub-skills for setup, data, services, utilities, and API."
---

# XBG Boilerplate Backend — Overview

A production-ready Node.js/TypeScript backend optimized for AI-assisted development. Built on Firebase Functions + Firestore + Express.js, designed so that AI can reliably generate, extend, and debug application code.

**Repository:** `boilerplate_backend` (sister: `boilerplate_frontend` — SvelteKit 5)

---

## Core Philosophy

This boilerplate provides **infrastructure**; you (or AI) provide **business logic**. The pattern is:

1. Define a declarative data model (`DataModelSpecification`)
2. Run the generator to scaffold Controller/Service/Repository/Entity
3. Register the controller in `functions/src/index.ts`
4. Add business logic in the service layer

The boilerplate never ships pre-built domain models (no User, Product, Order). That's intentional — AI generates those from your model spec.

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

## Project Layout

```
boilerplate_backend/
├── functions/
│   ├── src/
│   │   ├── config/          ← All env-driven config, single source of truth
│   │   ├── base/            ← BaseEntity, BaseController, BaseService, BaseRepository
│   │   ├── middleware/       ← Auth, CORS, rate limiting, logging, error handling
│   │   ├── utilities/        ← Logger, hashing, events, token handler, connectors
│   │   ├── generator/        ← Code generator engine + Handlebars templates
│   │   ├── generated/        ← Output of generator (gitignored in real projects)
│   │   ├── subscribers/      ← Event subscribers (communication side effects)
│   │   ├── app.ts            ← Express setup, middleware pipeline
│   │   ├── index.ts          ← Firebase Functions entry, controller registration
│   │   └── server.ts         ← Local dev server
│   ├── scripts/              ← setup.js, validate.js, generate.js, deploy.js
│   └── .env.example
├── __examples__/             ← Sample DataModelSpecification files
├── __scripts__/              ← Project-level scripts
└── mcp/                      ← Legacy MCP docs (superseded by these skills)
```

---

## Sub-Skills — When to Use Each

| Skill | Use when you need to... |
|---|---|
| `/xbg_bpbe_setup` | Configure .env, run setup wizard, understand npm scripts, validate config |
| `/xbg_bpbe_data` | Define entities, understand BaseEntity, use the generator, work with Firestore schemas |
| `/xbg_bpbe_services` | Write service methods, handle events, implement auth/access control, lifecycle hooks |
| `/xbg_bpbe_utils` | Use logger, PII hashing, cache, token handler, or any communication connector |
| `/xbg_bpbe_api` | Add routes, register controllers, use middleware, understand API response shapes |

---

## Key Import Paths

```typescript
// Base classes
import { BaseEntity, ValidationHelper } from './base/BaseEntity';
import { BaseRepository } from './base/BaseRepository';
import { BaseService, RequestContext, ServiceResult } from './base/BaseService';
import { BaseController, ApiResponse } from './base/BaseController';

// Config
import { APP_CONFIG, isFeatureEnabled } from './config/app.config';

// Utilities
import { logger } from './utilities/logger';
import { eventBus, EventType } from './utilities/events';
import { hashValue, hashFields, unhashValue } from './utilities/hashing';

// Middleware
import { createAuthMiddleware, requireRoles, requireAdmin } from './middleware/auth.middleware';
```

---

## Tech Stack

- **Runtime:** Node.js 18+, TypeScript (strict mode)
- **Framework:** Express.js
- **Deployment:** Firebase Functions (also runs on Cloud Run, AWS Lambda, Docker)
- **Database:** Firestore (multi-database support)
- **Auth:** Firebase Auth + custom JWT token handler with blacklisting
- **Testing:** Jest, 807 passing tests
- **Caching:** Memory / Firestore / Redis (progressive, per-repository opt-in)
- **Events:** Internal EventEmitter-based event bus (not Pub/Sub)

---

## Non-Obvious Decisions

- **Soft delete by default.** `BaseRepository.delete()` sets `deletedAt`; pass `hardDelete=true` for permanent. `findAll()` automatically excludes soft-deleted records.
- **`deletedAt === null` in Firestore queries.** The repository filters by `where('deletedAt', '==', null)` — this requires a composite index if combined with other where clauses.
- **Events are synchronous.** The event bus uses Node.js `EventEmitter`. It's fire-and-forget within the request lifecycle, not durable. For durable async, use Firebase Pub/Sub or queue systems.
- **Generated code goes in `src/generated/`.** This directory is gitignored in production projects. Treat generated files as a starting point — copy and modify in your own directories.
- **Config is all env-driven.** Never hardcode values in `app.config.ts`. Feature flags via `FEATURE_*` env vars.
