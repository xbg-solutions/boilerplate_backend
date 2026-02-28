#!/usr/bin/env node

/**
 * Interactive Setup Wizard
 *
 * Configures the backend boilerplate project for either:
 *   - Backend-only deployment (standalone Firebase Functions)
 *   - Mono-repo deployment (e.g. SvelteKit frontend + Firebase backend)
 *
 * Handles:
 *   - Project naming and Firebase project ID
 *   - Database mode (multi-DB recommended, single-DB supported)
 *   - Environment configuration (.env generation)
 *   - Feature flag selection
 *   - .firebaserc update
 *   - Dependency installation
 */

const readline = require('readline');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  blue: '\x1b[34m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
};

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function question(prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

function printBanner() {
  console.log(`
${colors.bright}${colors.blue}╔════════════════════════════════════════════════════════════╗
║                                                            ║
║   Backend Boilerplate Setup Wizard                         ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝${colors.reset}

${colors.bright}This wizard configures your backend project.${colors.reset}
${colors.dim}Press Enter to accept default values shown in [brackets].${colors.reset}
`);
}

function printSection(title) {
  console.log(`\n${colors.bright}${colors.cyan}── ${title} ${'─'.repeat(Math.max(0, 54 - title.length))}${colors.reset}\n`);
}

// ──────────────────────────────────────────────────────────
// Resolve paths relative to __scripts__/ location
// ──────────────────────────────────────────────────────────
const SCRIPTS_DIR = __dirname;
const REPO_ROOT = path.resolve(SCRIPTS_DIR, '..');

async function setup() {
  printBanner();
  const config = {};

  // ── Project basics ──────────────────────────────────────
  printSection('Project');

  config.projectName = (await question(
    `${colors.blue}Project name ${colors.dim}[my-backend-api]${colors.reset}: `
  )).trim() || 'my-backend-api';

  config.firebaseProject = (await question(
    `${colors.blue}Firebase project ID ${colors.dim}(required)${colors.reset}: `
  )).trim();

  if (!config.firebaseProject) {
    console.log(`\n${colors.red}Firebase project ID is required.${colors.reset}`);
    console.log(`${colors.dim}Create one at https://console.firebase.google.com${colors.reset}\n`);
    rl.close();
    process.exit(1);
  }

  // ── Deployment mode ─────────────────────────────────────
  printSection('Deployment Mode');

  console.log(`  ${colors.bright}1)${colors.reset} Backend-only  ${colors.dim}(standalone Firebase Functions project)${colors.reset}`);
  console.log(`  ${colors.bright}2)${colors.reset} Mono-repo     ${colors.dim}(frontend + backend in one repo, backend in functions/)${colors.reset}`);

  const modeChoice = (await question(
    `\n${colors.blue}Choose mode ${colors.dim}[1]${colors.reset}: `
  )).trim() || '1';
  config.isMonoRepo = modeChoice === '2';

  if (config.isMonoRepo) {
    console.log(`\n${colors.yellow}Mono-repo mode selected.${colors.reset}`);
    console.log(`${colors.dim}The backend source lives in functions/src/ and deploys as Firebase Functions.`);
    console.log(`In a mono-repo the project root has its own package.json and the frontend`);
    console.log(`typically lives in frontend/ (or a similar directory).${colors.reset}`);
    console.log(`\n${colors.dim}Note: .claude/skills/ should live at the mono-repo root, not inside functions/.${colors.reset}`);
  }

  // ── Environment ─────────────────────────────────────────
  printSection('Environment');

  const envChoice = (await question(
    `${colors.blue}Environment ${colors.dim}[development]${colors.reset} (development/staging/production): `
  )).trim() || 'development';
  config.environment = envChoice;

  config.port = (await question(
    `${colors.blue}Port ${colors.dim}[5001]${colors.reset}: `
  )).trim() || '5001';

  // ── Database ────────────────────────────────────────────
  printSection('Database');

  console.log(`  ${colors.bright}Multi-database${colors.reset} ${colors.dim}(recommended)${colors.reset}: Separate Firestore databases for`);
  console.log(`  different concerns (e.g. main data vs analytics). Each database`);
  console.log(`  has independent scaling and can be in different regions.`);
  console.log('');
  console.log(`  ${colors.bright}Single-database${colors.reset}: Everything in Firestore's (default) database.`);
  console.log(`  Simpler to start but harder to separate later.\n`);

  const dbChoice = (await question(
    `${colors.blue}Use multi-database? ${colors.dim}[Y/n]${colors.reset}: `
  )).trim().toLowerCase();
  config.multiDB = dbChoice !== 'n';

  if (config.multiDB) {
    config.mainDatabaseId = (await question(
      `${colors.blue}Main database ID ${colors.dim}[main]${colors.reset}: `
    )).trim() || 'main';

    config.analyticsDatabaseId = (await question(
      `${colors.blue}Analytics database ID ${colors.dim}[analytics]${colors.reset}: `
    )).trim() || 'analytics';
  } else {
    config.mainDatabaseId = '(default)';
    config.analyticsDatabaseId = '(default)';
  }

  // ── API ─────────────────────────────────────────────────
  printSection('API');

  config.corsOrigins = (await question(
    `${colors.blue}CORS origins ${colors.dim}[http://localhost:5173,http://localhost:3000]${colors.reset}: `
  )).trim() || 'http://localhost:5173,http://localhost:3000';

  config.apiBasePath = (await question(
    `${colors.blue}API base path ${colors.dim}[/api/v1]${colors.reset}: `
  )).trim() || '/api/v1';

  // ── Features ────────────────────────────────────────────
  printSection('Features');

  config.enableAuth = (await question(`  Authentication ${colors.dim}[Y/n]${colors.reset}: `)).trim().toLowerCase() !== 'n';
  config.enableMultiTenant = (await question(`  Multi-tenant ${colors.dim}[y/N]${colors.reset}: `)).trim().toLowerCase() === 'y';
  config.enableFileUploads = (await question(`  File uploads ${colors.dim}[Y/n]${colors.reset}: `)).trim().toLowerCase() !== 'n';
  config.enableNotifications = (await question(`  Notifications ${colors.dim}[Y/n]${colors.reset}: `)).trim().toLowerCase() !== 'n';
  config.enableAnalytics = (await question(`  Analytics ${colors.dim}[y/N]${colors.reset}: `)).trim().toLowerCase() === 'y';
  config.enableRealtime = (await question(`  Realtime (SSE/WebSocket) ${colors.dim}[Y/n]${colors.reset}: `)).trim().toLowerCase() !== 'n';

  // ── Write files ─────────────────────────────────────────
  printSection('Writing configuration');

  writeEnvFile(config);
  writeFirebaseRc(config);
  updateFirebaseJson(config);

  // ── Install dependencies ────────────────────────────────
  const installDeps = (await question(
    `\n${colors.blue}Install dependencies? ${colors.dim}[Y/n]${colors.reset}: `
  )).trim().toLowerCase();

  if (installDeps !== 'n') {
    console.log(`\n${colors.dim}Installing dependencies...${colors.reset}`);
    try {
      execSync('npm install', {
        cwd: path.join(REPO_ROOT, 'functions'),
        stdio: 'inherit',
      });
      console.log(`${colors.green}Dependencies installed.${colors.reset}`);
    } catch (error) {
      console.error(`${colors.red}Failed to install dependencies. Run 'npm install' in functions/ manually.${colors.reset}`);
    }
  }

  // ── Summary ─────────────────────────────────────────────
  printSummary(config);

  rl.close();
}

// ──────────────────────────────────────────────────────────
// File writers
// ──────────────────────────────────────────────────────────

function writeEnvFile(config) {
  const envContent = `# ──────────────────────────────────────────────────────────
# Application
# ──────────────────────────────────────────────────────────
APP_NAME=${config.projectName}
APP_VERSION=1.0.0
NODE_ENV=${config.environment}
PORT=${config.port}

# ──────────────────────────────────────────────────────────
# Firebase
# ──────────────────────────────────────────────────────────
FIREBASE_PROJECT_ID=${config.firebaseProject}

# ──────────────────────────────────────────────────────────
# Database
# ──────────────────────────────────────────────────────────
MAIN_DATABASE_ID=${config.mainDatabaseId}
ANALYTICS_DATABASE_ID=${config.analyticsDatabaseId}
# DB_RETRY_ATTEMPTS=3
# DB_RETRY_DELAY=1000
# DB_TIMEOUT=10000
# DB_ENABLE_CACHE=true

# Uncomment for local development with emulator:
# FIRESTORE_EMULATOR_HOST=localhost:8080

# ──────────────────────────────────────────────────────────
# API
# ──────────────────────────────────────────────────────────
API_BASE_PATH=${config.apiBasePath}
CORS_ORIGINS=${config.corsOrigins}
REQUEST_SIZE_LIMIT=10mb
# ENABLE_SWAGGER=true

# ──────────────────────────────────────────────────────────
# Features
# ──────────────────────────────────────────────────────────
FEATURE_AUTHENTICATION=${config.enableAuth}
FEATURE_MULTI_TENANT=${config.enableMultiTenant}
FEATURE_FILE_UPLOADS=${config.enableFileUploads}
FEATURE_NOTIFICATIONS=${config.enableNotifications}
FEATURE_ANALYTICS=${config.enableAnalytics}
FEATURE_REALTIME=${config.enableRealtime}

# ──────────────────────────────────────────────────────────
# Rate Limiting
# ──────────────────────────────────────────────────────────
RATE_LIMIT_ENABLED=true
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX=100

# ──────────────────────────────────────────────────────────
# Logging
# ──────────────────────────────────────────────────────────
LOG_LEVEL=info

# ──────────────────────────────────────────────────────────
# JWT / Authentication
# ──────────────────────────────────────────────────────────
JWT_ISSUER=${config.projectName}
JWT_AUDIENCE=${config.projectName}-api
JWT_EXPIRES_IN=1h
JWT_REFRESH_EXPIRES_IN=7d
TOKEN_BLACKLIST_ENABLED=true
TOKEN_BLACKLIST_CLEANUP_INTERVAL=3600000
TOKEN_BLACKLIST_RETENTION_DAYS=30

# ──────────────────────────────────────────────────────────
# Integrations (uncomment and configure as needed)
# ──────────────────────────────────────────────────────────
# EMAIL_ENABLED=true
# EMAIL_PROVIDER=mailjet
# MAILJET_API_KEY=
# MAILJET_SECRET_KEY=

# SMS_ENABLED=true
# SMS_PROVIDER=twilio
# TWILIO_ACCOUNT_SID=
# TWILIO_AUTH_TOKEN=
# TWILIO_FROM_NUMBER=

# CRM_ENABLED=true
# CRM_PROVIDER=hubspot
# HUBSPOT_API_KEY=

# STRIPE_SECRET_KEY=
# STRIPE_WEBHOOK_SECRET=

# ──────────────────────────────────────────────────────────
# Cache (disabled by default)
# ──────────────────────────────────────────────────────────
# CACHE_ENABLED=false
# CACHE_DEFAULT_PROVIDER=memory
# CACHE_DEFAULT_TTL=300
# CACHE_NAMESPACE=v1
`;

  const envPath = path.join(REPO_ROOT, 'functions', '.env');
  fs.writeFileSync(envPath, envContent);
  console.log(`  ${colors.green}Created${colors.reset} functions/.env`);
}

function writeFirebaseRc(config) {
  const firebaseRc = {
    projects: {
      default: config.firebaseProject,
    },
  };

  const rcPath = path.join(REPO_ROOT, '.firebaserc');
  fs.writeFileSync(rcPath, JSON.stringify(firebaseRc, null, 2) + '\n');
  console.log(`  ${colors.green}Updated${colors.reset} .firebaserc`);
}

function updateFirebaseJson(config) {
  const firebaseJsonPath = path.join(REPO_ROOT, 'firebase.json');

  let firebaseJson;
  try {
    firebaseJson = JSON.parse(fs.readFileSync(firebaseJsonPath, 'utf8'));
  } catch {
    // Create a fresh firebase.json if it doesn't exist or is invalid
    firebaseJson = {};
  }

  firebaseJson.functions = {
    source: 'functions',
    runtime: 'nodejs22',
    ignore: [
      'node_modules',
      '.git',
      'firebase-debug.log',
      'firebase-debug.*.log',
    ],
    predeploy: [
      'npm --prefix "$RESOURCE_DIR" run lint',
      'npm --prefix "$RESOURCE_DIR" run build',
    ],
  };

  firebaseJson.emulators = {
    functions: { port: parseInt(config.port, 10) },
    firestore: { port: 8080 },
    ui: { enabled: true, port: 4000 },
    singleProjectMode: true,
  };

  fs.writeFileSync(firebaseJsonPath, JSON.stringify(firebaseJson, null, 2) + '\n');
  console.log(`  ${colors.green}Updated${colors.reset} firebase.json`);
}

// ──────────────────────────────────────────────────────────
// Summary
// ──────────────────────────────────────────────────────────

function printSummary(config) {
  const features = [
    config.enableAuth && 'Authentication',
    config.enableMultiTenant && 'Multi-tenant',
    config.enableFileUploads && 'File uploads',
    config.enableNotifications && 'Notifications',
    config.enableAnalytics && 'Analytics',
    config.enableRealtime && 'Realtime',
  ].filter(Boolean);

  console.log(`
${colors.green}${colors.bright}Setup complete!${colors.reset}

${colors.bright}Configuration:${colors.reset}
  Project:          ${config.projectName}
  Firebase project: ${config.firebaseProject}
  Environment:      ${config.environment}
  Mode:             ${config.isMonoRepo ? 'Mono-repo' : 'Backend-only'}
  Database:         ${config.multiDB ? `Multi-DB (main: ${config.mainDatabaseId}, analytics: ${config.analyticsDatabaseId})` : 'Single (default)'}
  Features:         ${features.join(', ') || 'None'}

${colors.bright}Next steps:${colors.reset}
  1. Review functions/.env and add integration keys as needed
  2. Define your data model in __examples__/ (see existing examples)
  3. Run ${colors.cyan}npm run generate __examples__/your-model.ts${colors.reset} to generate code
  4. Register generated controllers in functions/src/index.ts
  5. Run ${colors.cyan}npm run build${colors.reset} to compile TypeScript
  6. Run ${colors.cyan}npm start${colors.reset} for local development`);

  if (config.isMonoRepo) {
    console.log(`
${colors.yellow}Mono-repo notes:${colors.reset}
  - Ensure .claude/skills/ live at the mono-repo root (not inside functions/)
  - The project root should have its own package.json
  - The frontend typically lives in frontend/ (or similar)
  - Backend source stays in functions/src/`);
  }

  console.log(`
${colors.dim}Documentation: See __docs__/ for guides${colors.reset}
${colors.dim}Examples:      See __examples__/ for sample data models${colors.reset}
`);
}

// ──────────────────────────────────────────────────────────
// Run
// ──────────────────────────────────────────────────────────

setup().catch((error) => {
  console.error(`\n${colors.red}Setup failed: ${error.message}${colors.reset}\n`);
  rl.close();
  process.exit(1);
});
