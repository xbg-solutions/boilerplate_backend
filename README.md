# Node.js/TypeScript AI-Compatible Backend Boilerplate

An experiment by [XBG Solutions](https://xbg.solutions) aided by [Claude Code](https://www.claude.com/product/claude-code).

**Production-ready backend foundation optimized for AI-assisted data-to-code workflows.**

Build and launch backend APIs in **days, not months** using modern AI-assisted development patterns.

[![TypeScript](https://img.shields.io/badge/TypeScript-Strict-blue)](https://www.typescriptlang.org/)
[![Tests](https://img.shields.io/badge/Tests-796%20Passing-green)](./functions/src/__tests__)
[![License](https://img.shields.io/badge/License-MIT-yellow)](./LICENSE)

**Sister Project:** [boilerplate_frontend](https://github.com/xbg-solutions/boilerplate_frontend) - SvelteKit 5 frontend boilerplate

---

## Architecture: Distributable Packages

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
│   ├── utils-email-connector/   → @xbg/utils-email-connector
│   ├── utils-sms-connector/     → @xbg/utils-sms-connector
│   ├── utils-crm-connector/     → @xbg/utils-crm-connector
│   ├── utils-llm-connector/     → @xbg/utils-llm-connector
│   ├── utils-token-handler/     → @xbg/utils-token-handler
│   ├── utils-hashing/           → @xbg/utils-hashing
│   ├── ... (20+ utility packages)
│   │
│   └── create-backend/          → @xbg/create-backend (CLI scaffolding tool)
│       ├── src/
│       │   ├── cli.ts           #   CLI entry point
│       │   ├── commands/        #   init, sync, add-util commands
│       │   ├── utils-registry.ts #  Available utilities registry
│       │   └── project-template/ #  Scaffold files for new projects
│       └── package.json
│
├── package.json                  → Monorepo root (npm workspaces)
└── README.md
```

### How It Works

**Two-part distribution model:**

1. **npm packages** (runtime dependencies) — Base classes, middleware, config, and utilities live in `node_modules/`. Updates propagate via `npm update`. Semver protects against breaking changes.

2. **CLI scaffolding tool** (`@xbg/create-backend`) — Handles project structure, config files, scripts, and templates. Operates in init mode (new project) and sync mode (update existing).

This is the same pattern as `firebase-tools` + `firebase init`.

---

## Quick Start

### Create a New Project

```bash
# Scaffold a new project
npx @xbg/create-backend init

# The CLI will:
#   - Ask about your project (name, Firebase project, features)
#   - Let you select which utilities to include
#   - Generate project structure with selected packages
#   - Install dependencies
```

### What a Generated Project Looks Like

```
my-project/
├── functions/
│   ├── src/
│   │   ├── index.ts              # Firebase Functions entry point
│   │   └── generated/            # Code generator output
│   ├── package.json              # Depends on @xbg/* packages
│   └── tsconfig.json
├── __scripts__/                  # Setup, generate, deploy, validate
├── __examples__/                 # Example data models
├── firebase.json
└── .firebaserc
```

### In Your Project Code

```typescript
// Import from packages instead of relative paths
import { createApp, BaseService, BaseController } from '@xbg/backend-core';
import { logger } from '@xbg/utils-logger';
import { eventBus } from '@xbg/utils-events';
import { getCacheConnector } from '@xbg/utils-cache-connector';
```

### Update an Existing Project

```bash
# Check for and apply boilerplate updates
npx @xbg/create-backend sync

# Update packages to latest versions
cd functions && npm update

# Add a new utility
npx @xbg/create-backend add-util
```

---

## What Makes This Different

- **AI-Assisted Development**: Declarative data models that AI can understand and generate code from
- **Rapid API Development**: Define your data model, generate CRUD endpoints in seconds
- **Update Propagation**: Projects built on this boilerplate receive updates via npm
- **Modular Utilities**: Only install what you need — no bloated dependency trees
- **Production Readiness**: 796 passing tests, security-first architecture, deployment infrastructure

### The Development Workflow

```
1. npx @xbg/create-backend init    →  2. Define Data Model         →  3. Generate & Deploy
   (select utilities)                   (declarative TypeScript)         npm run generate
                                                                         npm run deploy
   ↓                                    ↓                               ↓
   Project scaffold with               AI reads model,                  Ready to ship!
   selected @xbg packages              generates CRUD code
```

---

## Packages

### @xbg/backend-core

The foundation. Always required. Includes:

- **Base Classes**: `BaseEntity`, `BaseRepository`, `BaseService`, `BaseController`
- **Middleware**: Auth, CORS, rate limiting, error handling, logging, request ID, validation, body sanitization
- **Configuration**: App, database, auth, cache, middleware, communications, tokens
- **Code Generator**: Generates entities, repositories, services, and controllers from data model specs
- **Types**: Custom error classes (`RepositoryError`, `ServiceError`, `AuthError`, etc.)

### Utility Packages

Each utility is a standalone package. Install only what you need:

| Package | Description |
|---------|-------------|
| `@xbg/utils-logger` | Structured logging with PII sanitization and GCP Cloud Logging |
| `@xbg/utils-events` | Event bus for domain events |
| `@xbg/utils-errors` | Custom error classes |
| `@xbg/utils-cache-connector` | Multi-provider caching (memory, Firestore, Redis) |
| `@xbg/utils-firestore-connector` | Multi-database Firestore access and Firebase Admin SDK init |
| `@xbg/utils-firebase-event-bridge` | Firebase triggers to domain event normalization |
| `@xbg/utils-email-connector` | Email sending with Mailjet and Ortto providers |
| `@xbg/utils-sms-connector` | SMS sending with Twilio and MessageBird providers |
| `@xbg/utils-push-notifications-connector` | Push notifications via FCM |
| `@xbg/utils-realtime-connector` | SSE and WebSocket providers |
| `@xbg/utils-crm-connector` | CRM integration with HubSpot and Salesforce |
| `@xbg/utils-llm-connector` | LLM integration with OpenAI, Claude, and Gemini |
| `@xbg/utils-erp-connector` | ERP integration with Workday |
| `@xbg/utils-journey-connector` | Customer journey integration with Ortto |
| `@xbg/utils-survey-connector` | Survey integration |
| `@xbg/utils-work-mgmt-connector` | Work management with Notion and Asana |
| `@xbg/utils-document-connector` | Document processing |
| `@xbg/utils-token-handler` | JWT generation, verification, and blacklist management |
| `@xbg/utils-hashing` | PII encryption with AES-256-GCM |
| `@xbg/utils-validation` | Input validation with Joi and express-validator |
| `@xbg/utils-timezone` | Timezone conversion helper |
| `@xbg/utils-address-validation` | Google Maps address validation |

### @xbg/create-backend

CLI tool for project scaffolding and lifecycle management:

```bash
npx @xbg/create-backend init       # New project
npx @xbg/create-backend sync       # Update existing project
npx @xbg/create-backend add-util   # Add a utility package
```

---

## Code Generation

Define your entities in a declarative format:

```typescript
import { DataModelSpecification } from '@xbg/backend-core';

export const BlogModel: DataModelSpecification = {
  entities: {
    Post: {
      fields: {
        title: { type: 'string', required: true },
        content: { type: 'string', required: true },
        published: { type: 'boolean', default: false },
        authorId: { type: 'reference', required: true }
      },
      relationships: {
        comments: { type: 'one-to-many', entity: 'Comment', foreignKey: 'postId' }
      },
      access: {
        create: ['authenticated'],
        read: ['public'],
        update: ['self', 'admin'],
        delete: ['admin']
      }
    }
  }
};
```

Generate code:

```bash
npm run generate __examples__/blog.model.js

# Generates:
# - functions/src/generated/entities/Post.ts
# - functions/src/generated/repositories/PostRepository.ts
# - functions/src/generated/services/PostService.ts
# - functions/src/generated/controllers/PostController.ts
```

Generated code imports from packages:

```typescript
// Generated entity
import { BaseEntity, ValidationResult, ValidationHelper } from '@xbg/backend-core';

// Generated repository
import { BaseRepository } from '@xbg/backend-core';

// Generated service
import { BaseService, RequestContext } from '@xbg/backend-core';

// Generated controller
import { BaseController } from '@xbg/backend-core';
```

---

## Development (Contributing to the Boilerplate)

This repo is a monorepo using npm workspaces.

```bash
# Install all dependencies
npm install

# Build all packages
npm run build

# Build specific package
npm run build -w packages/core
npm run build -w packages/utils-logger

# Run tests across all packages
npm test
```

### Publishing

Packages are published to npm under the `@xbg` scope:

```bash
# Bump version
cd packages/core
npm version patch

# Publish
npm publish
```

---

## License

MIT License - see [LICENSE](LICENSE) file for details.

---

**Built with care by [XBG Solutions](https://xbg.solutions) for rapid API development and AI-assisted coding**

If this project helps you, please consider buying us a beer or two!
https://xbg.solutions/donations
