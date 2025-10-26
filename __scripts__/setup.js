#!/usr/bin/env node

/**
 * Interactive Setup Wizard
 * Configures the backend boilerplate project
 */

const readline = require('readline');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  blue: '\x1b[34m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
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

console.log(`
${colors.bright}${colors.blue}╔════════════════════════════════════════════════════════════╗
║                                                            ║
║   🚀 Backend Boilerplate Setup Wizard                     ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝${colors.reset}

${colors.bright}This wizard will help you set up your backend project.${colors.reset}

`);

async function setup() {
  const config = {};

  // Project name
  config.projectName = await question(`${colors.blue}Project name:${colors.reset} `) || 'my-backend-api';

  // Firebase project
  config.firebaseProject = await question(`${colors.blue}Firebase project ID:${colors.reset} `);

  // Environment
  const envChoice = await question(`${colors.blue}Environment (development/staging/production):${colors.reset} `) || 'development';
  config.environment = envChoice;

  // CORS origins
  config.corsOrigins = await question(`${colors.blue}CORS origins (comma-separated):${colors.reset} `) || 'http://localhost:3000';

  // Features
  console.log(`\n${colors.bright}Enable features:${colors.reset}`);
  config.enableAuth = (await question(`  Authentication (Y/n): `)).toLowerCase() !== 'n';
  config.enableMultiTenant = (await question(`  Multi-tenant (y/N): `)).toLowerCase() === 'y';
  config.enableFileUploads = (await question(`  File uploads (Y/n): `)).toLowerCase() !== 'n';
  config.enableNotifications = (await question(`  Notifications (Y/n): `)).toLowerCase() !== 'n';

  // Generate .env file
  console.log(`\n${colors.yellow}📝 Creating environment file...${colors.reset}`);

  const envContent = `
# Application Configuration
APP_NAME=${config.projectName}
APP_VERSION=1.0.0
NODE_ENV=${config.environment}
PORT=5001

# Firebase Configuration
FIREBASE_PROJECT_ID=${config.firebaseProject}

# API Configuration
API_BASE_PATH=/api/v1
CORS_ORIGINS=${config.corsOrigins}
REQUEST_SIZE_LIMIT=10mb

# Features
FEATURE_AUTHENTICATION=${config.enableAuth}
FEATURE_MULTI_TENANT=${config.enableMultiTenant}
FEATURE_FILE_UPLOADS=${config.enableFileUploads}
FEATURE_NOTIFICATIONS=${config.enableNotifications}
FEATURE_ANALYTICS=false
FEATURE_REALTIME=true

# Rate Limiting
RATE_LIMIT_ENABLED=true
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX=100

# Logging
LOG_LEVEL=info

# JWT Configuration
JWT_ISSUER=${config.projectName}
JWT_AUDIENCE=${config.projectName}-api
JWT_EXPIRES_IN=1h
JWT_REFRESH_EXPIRES_IN=7d

# Token Blacklist
TOKEN_BLACKLIST_ENABLED=true
TOKEN_BLACKLIST_CLEANUP_INTERVAL=3600000
TOKEN_BLACKLIST_RETENTION_DAYS=30

# Add your integration keys here:
# SENDGRID_API_KEY=
# SENDGRID_FROM_EMAIL=
# STRIPE_SECRET_KEY=
# STRIPE_WEBHOOK_SECRET=
`.trim();

  const envPath = path.join(__dirname, '../functions/.env');
  fs.writeFileSync(envPath, envContent);
  console.log(`${colors.green}✅ Created .env file${colors.reset}`);

  // Install dependencies
  const installDeps = await question(`\n${colors.blue}Install dependencies? (Y/n):${colors.reset} `);
  if (installDeps.toLowerCase() !== 'n') {
    console.log(`\n${colors.yellow}📦 Installing dependencies...${colors.reset}`);
    try {
      execSync('npm install', {
        cwd: path.join(__dirname, '../functions'),
        stdio: 'inherit',
      });
      console.log(`${colors.green}✅ Dependencies installed${colors.reset}`);
    } catch (error) {
      console.error(`${colors.red}❌ Failed to install dependencies${colors.reset}`);
    }
  }

  // Summary
  console.log(`
${colors.green}${colors.bright}✅ Setup complete!${colors.reset}

${colors.bright}Configuration:${colors.reset}
  - Project: ${config.projectName}
  - Environment: ${config.environment}
  - Firebase Project: ${config.firebaseProject}
  - Authentication: ${config.enableAuth ? 'Enabled' : 'Disabled'}
  - Multi-tenant: ${config.enableMultiTenant ? 'Enabled' : 'Disabled'}

${colors.bright}Next steps:${colors.reset}
  1. Update .env file with your integration keys
  2. Create data model in examples/ directory
  3. Run 'npm run generate examples/your-model.ts'
  4. Update functions/src/index.ts to register controllers
  5. Run 'npm run build' to compile TypeScript
  6. Run 'npm start' for local development
  7. Run 'npm run deploy' to deploy to Firebase

${colors.blue}Documentation: See docs/ directory for guides${colors.reset}
${colors.blue}Examples: See examples/ directory for sample models${colors.reset}

${colors.green}Happy coding! 🎉${colors.reset}
`);

  rl.close();
}

setup().catch((error) => {
  console.error(`\n${colors.red}❌ Setup failed: ${error.message}${colors.reset}\n`);
  rl.close();
  process.exit(1);
});
