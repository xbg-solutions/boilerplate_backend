# Scripts

> Automation scripts for setup, code generation, and deployment

## Overview

The scripts directory contains Node.js scripts that automate common development tasks: project setup, code generation from data models, and deployment to Firebase Functions.

In a generated project (created via `npx @xbg/create-backend init`), these scripts are scaffolded into your project's `__scripts__/` directory and wired up in `functions/package.json`.

## Available Scripts

### setup.js

Interactive setup wizard for initializing a new project's configuration.

**Purpose:**
- Configure project settings
- Generate environment files (`.env`)
- Set up Firebase configuration
- Enable/disable features
- Create initial project structure

**Usage:**
```bash
cd functions
npm run setup
```

**Interactive Prompts:**
- Project name
- Firebase project ID
- Deployment mode (backend-only or mono-repo)
- Environment (development/staging/production)
- Database mode (multi-DB recommended, or single-DB)
- CORS origins, API base path
- Feature flags (authentication, multi-tenant, file uploads, notifications, analytics, realtime)

**Output:**
- Creates `functions/.env` with full configuration
- Updates `.firebaserc` with project ID
- Updates `firebase.json` with runtime and emulator ports

**Mono-repo awareness:** When mono-repo mode is selected the wizard prints
guidance on directory structure (`.claude/skills/` at root, frontend in
`frontend/`, backend in `functions/`).

---

### generate.js

Code generation script that creates entities, repositories, services, and controllers from data model specifications.

**Purpose:**
- Parse `DataModelSpecification` files (imported from `@xbg/backend-core`)
- Generate TypeScript code from templates
- Create CRUD operations automatically
- Generate validation logic
- Generate access control rules

**Usage:**
```bash
npm run generate __examples__/user.model.ts
```

**Input:** Data model specification file (TypeScript)

**Output:** Generated code in `functions/src/generated/`:
- `entities/[EntityName].ts` - Entity class with validation
- `repositories/[EntityName]Repository.ts` - Database operations
- `services/[EntityName]Service.ts` - Business logic
- `controllers/[EntityName]Controller.ts` - HTTP endpoints

Generated code imports from `@xbg/*` packages:

```typescript
import { BaseEntity, ValidationHelper, ValidationResult } from '@xbg/backend-core';
import { BaseRepository } from '@xbg/backend-core';
import { BaseService, RequestContext, ServiceResult } from '@xbg/backend-core';
import { BaseController } from '@xbg/backend-core';
```

---

### deploy.js

Deployment automation script for Firebase Functions.

**Purpose:**
- Pre-deployment checks
- Run tests before deployment
- Build TypeScript code
- Deploy to Firebase Functions
- Environment-specific deployment

**Usage:**
```bash
npm run deploy           # Deploy to default environment
npm run deploy -- --env production
npm run deploy -- --force  # Skip tests
```

**Pre-deployment Checks:**
- Git working directory is clean
- All tests pass
- TypeScript builds successfully
- Environment variables are set
- Firebase project is configured

**Deployment Flow:**
```
1. Pre-flight checks
2. Run tests (unless --force)
3. Build TypeScript
4. Deploy to Firebase
5. Verify deployment
6. Tag release (if production)
```

---

### validate.js

Pre-deployment validation script.

**Usage:**
```bash
npm run validate        # Full: build + lint + tests
npm run validate:quick  # Quick: build + lint only
```

**Checks:**
- Node.js version (22+)
- Firebase CLI installed
- TypeScript compiles cleanly
- All tests pass
- `.env` has required variables
- No placeholder values left in config

---

## Running Scripts

### From package.json

All scripts are defined in `functions/package.json` and resolve to `__scripts__/`:

```json
{
  "scripts": {
    "setup": "node ../__scripts__/setup.js",
    "generate": "node ../__scripts__/generate.js",
    "validate": "node ../__scripts__/validate.js",
    "deploy:full": "node ../__scripts__/deploy.js"
  }
}
```

### Direct Execution

Scripts can also be run directly from the repo root:

```bash
node __scripts__/setup.js
node __scripts__/validate.js
```

## Best Practices

1. **Run setup first**: Always run `npm run setup` for new projects
2. **Commit before deploy**: Commit changes before running deploy script
3. **Test before generate**: Validate model files before generation
4. **Use version control**: Commit generated code for review
5. **Environment variables**: Never commit `.env` files
6. **Backup before migration**: Always backup data before migrations

## Related Components

- **@xbg/backend-core**: Code generator engine and Handlebars templates
- **@xbg/create-backend**: CLI tool for project scaffolding (`init`, `sync`, `add-util`)
- **__examples__/**: Example data model files
- **.firebaserc**: Firebase project configuration
- **firebase.json**: Firebase deployment configuration
