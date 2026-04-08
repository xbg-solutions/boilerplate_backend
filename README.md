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
│   ├── core/                    → @xbg.solutions/backend-core
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
│   ├── utils-logger/            → @xbg.solutions/utils-logger
│   ├── utils-events/            → @xbg.solutions/utils-events
│   ├── utils-errors/            → @xbg.solutions/utils-errors
│   ├── utils-cache-connector/   → @xbg.solutions/utils-cache-connector
│   ├── utils-firestore-connector/ → @xbg.solutions/utils-firestore-connector
│   ├── utils-email-connector/   → @xbg.solutions/utils-email-connector
│   ├── utils-sms-connector/     → @xbg.solutions/utils-sms-connector
│   ├── utils-crm-connector/     → @xbg.solutions/utils-crm-connector
│   ├── utils-llm-connector/     → @xbg.solutions/utils-llm-connector
│   ├── utils-token-handler/     → @xbg.solutions/utils-token-handler
│   ├── utils-hashing/           → @xbg.solutions/utils-hashing
│   ├── ... (20+ utility packages)
│   │
│   └── create-backend/          → @xbg.solutions/create-backend (CLI scaffolding tool)
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

2. **CLI scaffolding tool** (`@xbg.solutions/create-backend`) — Handles project structure, config files, scripts, and templates. Operates in init mode (new project) and sync mode (update existing).

This is the same pattern as `firebase-tools` + `firebase init`.

---

## Quick Start

### Create a New Project

```bash
# Scaffold a new project
npx @xbg.solutions/create-backend init

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
│   ├── package.json              # Depends on @xbg.solutions/* packages
│   └── tsconfig.json
├── __scripts__/                  # Setup, generate, deploy, validate
├── __examples__/                 # Example data models
├── firebase.json
└── .firebaserc
```

### In Your Project Code

```typescript
// Import from packages instead of relative paths
import { createApp, BaseService, BaseController } from '@xbg.solutions/backend-core';
import { logger } from '@xbg.solutions/utils-logger';
import { eventBus } from '@xbg.solutions/utils-events';
import { getCacheConnector } from '@xbg.solutions/utils-cache-connector';
```

### Update an Existing Project

```bash
# Check for and apply boilerplate updates
npx @xbg.solutions/create-backend sync

# Update packages to latest versions
cd functions && npm update

# Add a new utility
npx @xbg.solutions/create-backend add-util
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
1. npx @xbg.solutions/create-backend init    →  2. Define Data Model         →  3. Generate & Deploy
   (select utilities)                   (declarative TypeScript)         npm run generate
                                                                         npm run deploy
   ↓                                    ↓                               ↓
   Project scaffold with               AI reads model,                  Ready to ship!
   selected @xbg packages              generates CRUD code
```

---

## Packages

### @xbg.solutions/backend-core

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
| `@xbg.solutions/utils-logger` | Structured logging with PII sanitization and GCP Cloud Logging |
| `@xbg.solutions/utils-events` | Event bus for domain events |
| `@xbg.solutions/utils-errors` | Custom error classes |
| `@xbg.solutions/utils-cache-connector` | Multi-provider caching (memory, Firestore, Redis) |
| `@xbg.solutions/utils-firestore-connector` | Multi-database Firestore access and Firebase Admin SDK init |
| `@xbg.solutions/utils-firebase-event-bridge` | Firebase triggers to domain event normalization |
| `@xbg.solutions/utils-email-connector` | Email sending with Mailjet and Ortto providers |
| `@xbg.solutions/utils-sms-connector` | SMS sending with Twilio and MessageBird providers |
| `@xbg.solutions/utils-push-notifications-connector` | Push notifications via FCM |
| `@xbg.solutions/utils-realtime-connector` | SSE and WebSocket providers |
| `@xbg.solutions/utils-crm-connector` | CRM integration with HubSpot and Salesforce |
| `@xbg.solutions/utils-llm-connector` | LLM integration with OpenAI, Claude, and Gemini |
| `@xbg.solutions/utils-erp-connector` | ERP integration with Workday |
| `@xbg.solutions/utils-journey-connector` | Customer journey integration with Ortto |
| `@xbg.solutions/utils-survey-connector` | Survey integration |
| `@xbg.solutions/utils-work-mgmt-connector` | Work management with Notion and Asana |
| `@xbg.solutions/utils-document-connector` | Document processing |
| `@xbg.solutions/utils-token-handler` | JWT generation, verification, and blacklist management |
| `@xbg.solutions/utils-hashing` | PII encryption with AES-256-GCM (transparent and guarded modes) |
| `@xbg.solutions/utils-validation` | Input validation with Joi and express-validator |
| `@xbg.solutions/utils-timezone` | Timezone conversion helper |
| `@xbg.solutions/utils-address-validation` | Google Maps address validation |

### @xbg.solutions/create-backend

CLI tool for project scaffolding and lifecycle management:

```bash
npx @xbg.solutions/create-backend init       # New project
npx @xbg.solutions/create-backend sync       # Update existing project
npx @xbg.solutions/create-backend add-util   # Add a utility package
```

---

## Code Generation

Define your entities in a declarative format. The generator reads `storage` blocks and `foreignKey` on relationships to produce working Firestore queries — not stubs.

```typescript
import { DataModelSpecification } from '@xbg.solutions/backend-core';

export const BlogModel: DataModelSpecification = {
  entities: {
    Post: {
      storage: { type: 'collection', collectionName: 'posts' },
      fields: {
        title: { type: 'string', required: true, encryption: 'transparent' },
        content: { type: 'string', required: true },
        published: { type: 'boolean', default: false },
        authorId: { type: 'reference', required: true },
        categoryId: { type: 'reference', required: true },
      },
      relationships: {
        author: { type: 'many-to-one', entity: 'User', foreignKey: 'authorId' },
        comments: { type: 'one-to-many', entity: 'Comment', foreignKey: 'postId' },
      },
    },
    Comment: {
      storage: {
        type: 'subcollection',
        collectionName: 'comments',
        parent: { entity: 'Post', collectionName: 'posts', foreignKey: 'postId' },
      },
      fields: {
        content: { type: 'string', required: true },
        authorId: { type: 'reference', required: true },
      },
    },
  },
};
```

Generate code from one or more model files:

```bash
# Single model
npm run generate __examples__/blog.model.js

# Multiple models (enables cross-model relationship resolution)
npm run generate __examples__/accounts.model.js __examples__/projects.model.js

# Generates per entity:
# - functions/src/generated/entities/Post.ts
# - functions/src/generated/repositories/PostRepository.ts      (with working relationship queries)
# - functions/src/generated/services/PostService.ts
# - functions/src/generated/controllers/PostController.ts
```

Generated code imports from packages:

```typescript
// Generated entity
import { BaseEntity, ValidationResult, ValidationHelper } from '@xbg.solutions/backend-core';

// Generated repository (top-level)
import { BaseRepository } from '@xbg.solutions/backend-core';

// Generated repository (subcollection) — uses IScopedRepository via RepositoryFactory
import { RepositoryFactory, IScopedRepository } from '@xbg.solutions/backend-core';

// Generated service
import { BaseService, RequestContext } from '@xbg.solutions/backend-core';
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

Packages are published to npm under the `@xbg.solutions` scope:

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
