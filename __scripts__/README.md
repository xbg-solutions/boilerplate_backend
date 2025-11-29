# Scripts

> Automation scripts for setup, code generation, and deployment

## Overview

The scripts directory contains Node.js scripts that automate common development tasks: project setup, code generation from data models, and deployment to Firebase Functions.

## Available Scripts

### setup.js

Interactive setup wizard for initializing a new project.

**Purpose:**
- Configure project settings
- Generate environment files
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
- Environment (development/staging/production)
- CORS origins
- Feature flags (authentication, multi-tenant, file uploads, notifications)

**Output:**
- Creates `.env` file with configuration
- Updates `.firebaserc` with project ID
- Generates initial `functions/src/config/` files

**Environment Variables Created:**
```
APP_NAME
NODE_ENV
PORT
FIREBASE_PROJECT_ID
API_BASE_PATH
CORS_ORIGINS
FEATURE_AUTHENTICATION
FEATURE_MULTI_TENANT
FEATURE_FILE_UPLOADS
FEATURE_NOTIFICATIONS
RATE_LIMIT_ENABLED
LOG_LEVEL
```

**Gaps:**
- [ ] Database initialization scripts
- [ ] API key generation
- [ ] Admin user creation
- [ ] Sample data seeding
- [ ] CI/CD configuration setup
- [ ] Docker configuration generation
- [ ] SSL certificate setup
- [ ] Custom domain configuration

---

### generate.js

Code generation script that creates entities, repositories, services, and controllers from data model specifications.

**Purpose:**
- Parse data model specifications
- Generate TypeScript code from templates
- Create CRUD operations automatically
- Generate validation logic
- Generate access control rules

**Usage:**
```bash
npm run generate examples/user.model.ts
```

**Input:** Data model specification file (TypeScript)

**Output:** Generated code in `functions/src/generated/`:
- `entities/[EntityName].ts` - Entity class with validation
- `repositories/[EntityName]Repository.ts` - Database operations
- `services/[EntityName]Service.ts` - Business logic
- `controllers/[EntityName]Controller.ts` - HTTP endpoints

**Example Model:**
```typescript
export const UserModel = {
  entities: {
    User: {
      fields: {
        email: { type: 'email', unique: true, required: true },
        name: { type: 'string', required: true },
        role: { type: 'enum', values: ['admin', 'user'] },
      },
      relationships: {
        posts: { type: 'one-to-many', entity: 'Post' },
      },
      access: {
        create: ['public'],
        read: ['self', 'admin'],
        update: ['self', 'admin'],
        delete: ['admin'],
      },
    },
  },
};
```

**Gaps:**
- [ ] Support for JavaScript model files (not just TypeScript)
- [ ] Incremental generation (update existing code)
- [ ] Custom template directory configuration
- [ ] Dry-run mode (preview changes)
- [ ] Validation of model specification
- [ ] Relationship validation
- [ ] Migration generation for schema changes
- [ ] Rollback capability
- [ ] Integration test generation
- [ ] API documentation generation

---

### deploy.js

Deployment automation script for Firebase Functions.

**Purpose:**
- Pre-deployment checks
- Run tests before deployment
- Build TypeScript code
- Deploy to Firebase Functions
- Environment-specific deployment
- Rollback support

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

**Gaps:**
- [ ] Blue-green deployment support
- [ ] Canary deployment support
- [ ] Automatic rollback on errors
- [ ] Deployment notifications (Slack, email)
- [ ] Performance benchmarking post-deploy
- [ ] Smoke tests after deployment
- [ ] Database migration execution
- [ ] Secret rotation during deployment
- [ ] Multi-region deployment
- [ ] Traffic splitting configuration
- [ ] Deployment approval workflow

---

## Running Scripts

### From package.json

All scripts are defined in `functions/package.json`:

```json
{
  "scripts": {
    "setup": "node ../scripts/setup.js",
    "generate": "node ../scripts/generate.js",
    "deploy": "node ../scripts/deploy.js"
  }
}
```

### Direct Execution

Scripts can also be run directly:

```bash
# Make executable
chmod +x scripts/setup.js

# Run directly
./scripts/setup.js
```

## Script Development

### Adding New Scripts

1. Create new script in `scripts/` directory
2. Add shebang: `#!/usr/bin/env node`
3. Make executable: `chmod +x scripts/your-script.js`
4. Add to `package.json` scripts
5. Document in this README

### Common Utilities

Scripts share common utilities:

```javascript
// Colors for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  blue: '\x1b[34m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
};

// Interactive prompts
const readline = require('readline');
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function question(prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

// File system operations
const fs = require('fs');
const path = require('path');

// Execute shell commands
const { execSync } = require('child_process');
execSync('npm run build', { stdio: 'inherit' });
```

## Known Gaps & Future Enhancements

### Missing Scripts
- [ ] **migrate.js** - Database migration execution
- [ ] **seed.js** - Database seeding with test data
- [ ] **backup.js** - Database backup automation
- [ ] **restore.js** - Database restore from backup
- [ ] **test.js** - Enhanced test runner with reporting
- [ ] **lint-fix.js** - Auto-fix linting issues
- [ ] **clean.js** - Clean build artifacts and cache
- [ ] **docs.js** - Generate API documentation
- [ ] **analyze.js** - Bundle size analysis
- [ ] **security-audit.js** - Security vulnerability scanning
- [ ] **performance-test.js** - Load testing automation
- [ ] **rollback.js** - Rollback deployment

### Script Improvements
- [ ] Better error handling and recovery
- [ ] Progress bars for long operations
- [ ] Colored diff output
- [ ] Confirmation prompts for destructive operations
- [ ] Verbose/debug mode flags
- [ ] JSON output mode for CI/CD
- [ ] Script composition (call one script from another)
- [ ] Configuration file support (.scriptrc)

### Testing Gaps
- [ ] Unit tests for script functions
- [ ] Integration tests for full workflows
- [ ] Mock file system for testing
- [ ] CI/CD integration tests

### Documentation Gaps
- [ ] Video tutorials for each script
- [ ] Troubleshooting guide
- [ ] Common error messages and solutions
- [ ] Best practices guide

## Best Practices

1. **Run setup first**: Always run `npm run setup` for new projects
2. **Commit before deploy**: Commit changes before running deploy script
3. **Test before generate**: Validate model files before generation
4. **Use version control**: Commit generated code for review
5. **Environment variables**: Never commit `.env` files
6. **Backup before migration**: Always backup data before migrations

## Troubleshooting

### Setup Script Issues

**Problem:** Firebase project not found
```bash
Solution: Verify Firebase project ID with `firebase projects:list`
```

**Problem:** Permission denied
```bash
Solution: Make script executable with `chmod +x scripts/setup.js`
```

### Generate Script Issues

**Problem:** Model file not found
```bash
Solution: Use absolute or relative path to model file
```

**Problem:** TypeScript compilation error
```bash
Solution: Run `npm run build` manually to see detailed errors
```

### Deploy Script Issues

**Problem:** Tests failing
```bash
Solution: Fix tests or use `--force` flag to skip (not recommended)
```

**Problem:** Firebase authentication error
```bash
Solution: Run `firebase login` to authenticate
```

## Related Components

- **functions/src/generator/**: Code generation engine
- **functions/src/templates/**: Handlebars templates for code generation
- **examples/**: Example data model files
- **.firebaserc**: Firebase project configuration
- **firebase.json**: Firebase deployment configuration

## Support

For issues or questions:
- Check script output for error messages
- Review logs in `logs/` directory (if available)
- Verify environment variables are set
- Check Firebase project permissions
- Review generated code for issues

## References

- [Firebase CLI Documentation](https://firebase.google.com/docs/cli)
- [Node.js Child Process](https://nodejs.org/api/child_process.html)
- [Readline Module](https://nodejs.org/api/readline.html)
