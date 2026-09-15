# Node.js/TypeScript AI-Compatible Backend Boilerplate

An experiment by [XBG Solutions](https://xbg.solutions) aided by [Claude Code](https://www.claude.com/product/claude-code).

**Production-ready backend foundation optimized for AI-assisted data-to-code workflows.**

Build and launch backend APIs in **days, not months** using modern AI-assisted development patterns.

[![TypeScript](https://img.shields.io/badge/TypeScript-Strict-blue)](https://www.typescriptlang.org/)
[![Tests](https://img.shields.io/badge/Tests-797%20Passing-green)](./functions/src/__tests__)
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
│   ├── utils-content-crypto/    → @xbg.solutions/utils-content-crypto
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
│   ├── .gitignore                # Ignores .env*, node_modules, lib, keys
│   └── tsconfig.json
├── __scripts__/                  # Setup, generate, deploy, validate
├── __examples__/                 # Example data models
├── .gitignore                    # Written at scaffold time (protects secrets)
├── firebase.json
├── firestore.rules
├── firestore.indexes.json        # Token-revocation composite index
├── UPGRADING.md                  # Read before bumping @xbg.solutions/* versions
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
- **Production Readiness**: 797 passing tests, security-first architecture, deployment infrastructure
- **Secure by Default**: generated routes require authentication (explicit `public` opt-out), base access checks default to deny, list endpoints are page-size capped, and PII is encrypted with authenticated AES-256-GCM. Breaking secure-by-default changes and dependency upgrades are documented in [UPGRADING.md](./UPGRADING.md).

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
| `@xbg.solutions/utils-hashing` | **Identity** encryption with AES-256-GCM, under one install-wide key (transparent and guarded modes) |
| `@xbg.solutions/utils-content-crypto` | **Content** encryption under per-record keys, with Accounts as custodian. Not the same system as `utils-hashing` — see below |
| `@xbg.solutions/utils-validation` | Input validation with Joi and express-validator |
| `@xbg.solutions/utils-timezone` | Timezone conversion helper |
| `@xbg.solutions/utils-address-validation` | Google Maps address validation |

### Two encryption packages, and they are not alternatives

`utils-hashing` and `utils-content-crypto` answer different questions, and
conflating them is the mistake the platform most wants to avoid. **The word
"key" is ambiguous across these repos; say which kind you mean.**

| | `utils-hashing` | `utils-content-crypto` |
|---|---|---|
| Protects | **Identity and commercial records** — names, emails, credentials | **Client content** — the material a customer creates in a product |
| Keyed on | one install-wide `PII_ENCRYPTION_KEY` | a **per-record key**, wrapped under a per-account data key |
| Custodian | the product, in its own environment | **Accounts**, over its API. The product holds no key material |
| On erasure | **survives** — identity outlives content, deliberately | destroyed, which is what makes erasure reach backups |
| Use it for | a field a regulator expects you to hold | a field a client would call theirs |

A product uses **both**. Neither folds into the other, and
`PII_ENCRYPTION_KEY` must never wrap content.

### @xbg.solutions/utils-content-crypto — status

Published at **0.1.1**; **0.1.2 is cut and green, awaiting publish**. On the `0.x`
line deliberately: under caret semantics a minor is breaking, which is the honest
contract for a wire format that freezes on first write. It joins the `3.x` line at
the first line-wide publish after it has run on real data in more than one product.

**0.1.2 fixes a silent-plaintext bug** and should be taken by every consumer. Every
plainness test asked `constructor === Object`, which is false for a plain object from
another realm (`structuredClone` under Jest) and for a null-prototype object — both
documents, both SKIPPED by the walk, so `encryptDoc` returned the document unchanged,
reported success, and the caller stored plaintext in strict mode with no error. Those
are now walked; a class instance is now REFUSED rather than skipped, because walking one
would mangle a Firestore sentinel, which is what the original strictness protected.
Neither live consumer was affected — collab and sf-mapper pass object literals and
`snap.data()`, both plain — but a test double is exactly how it was found, and a product
that adds a mapper layer would hit it for real. Reasoning in the package README.

Rollout, tracked in `accounts.xbg.solutions/__docs__/01-content-key-custody.md`:

| | |
|---|---|
| **Phase A** — the package | ✅ published 2026-09-12, `0.1.1` on 2026-09-13; `0.1.2` cut 2026-09-16 |
| **Phase B** — Accounts as custodian | ✅ deployed 2026-09-13 |
| **Phase C** — collab | ✅ complete 2026-09-14. 280 values and 5 objects converted; collab's own custodian, KMS key and legacy wires deleted |
| **Phase D** — sf-mapper, then Morph | in progress |
| **Phase E** — build, then fedi-CRM | not started |

**What a product supplies is exactly three things**: a field **registry**, a
**traversal**, and a **`ContentKeyScope`**. Everything else — the cipher, the
record keys, the wrap set, batching — is the package's and must not be restated
in a product.

**Two conformance suites are required, not advisory.** `checkWrapCommit` and
`checkTraversal` ship from the `./testing` subpath and a product runs them in
its own CI against its own ports. The package can prove a wrap was made durable;
only the product's tests can prove its committer was called at all, that its
writes are create-only, and that its traversal walks what it claims to.

Two things learned in the rollout that are cheaper to read than to rediscover:

- **`dekHandleFromBase64` is the only door key material comes in through.** The
  bytes→key constructors are deliberately off the barrel.
- **Never seal a value that is also a document id.** It protects nothing — the
  id is readable to anyone who can read the collection — and it costs a query,
  because an encrypted field cannot be filtered on. A `where` against ciphertext
  is a valid query that silently matches nothing.

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
