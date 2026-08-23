#!/usr/bin/env node

/**
 * Deployment Script
 * Automates Firebase Functions deployment with safety checks
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  blue: '\x1b[34m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
};

console.log(`
${colors.bright}${colors.blue}╔════════════════════════════════════════════════════════════╗
║                                                            ║
║   🚀 Backend Boilerplate Deployment                       ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝${colors.reset}
`);

function runCommand(command, description) {
  console.log(`${colors.blue}▶ ${description}...${colors.reset}`);
  try {
    execSync(command, {
      cwd: path.join(__dirname, '../functions'),
      stdio: 'inherit',
    });
    console.log(`${colors.green}✅ ${description} complete${colors.reset}\n`);
    return true;
  } catch {
    console.error(`${colors.red}❌ ${description} failed${colors.reset}\n`);
    return false;
  }
}

async function deploy() {
  // Check environment
  const envPath = path.join(__dirname, '../functions/.env');
  if (!fs.existsSync(envPath)) {
    console.error(`${colors.red}❌ .env file not found. Run 'npm run setup' first.${colors.reset}\n`);
    process.exit(1);
  }

  // Run linter
  if (!runCommand('npm run lint', 'Linting code')) {
    console.error(`${colors.yellow}⚠️  Fix linting errors before deploying${colors.reset}\n`);
    process.exit(1);
  }

  // Run build
  if (!runCommand('npm run build', 'Building TypeScript')) {
    console.error(`${colors.red}❌ Build failed. Cannot deploy.${colors.reset}\n`);
    process.exit(1);
  }

  // Run tests (if they exist)
  const testScript = path.join(__dirname, '../functions/package.json');
  if (fs.existsSync(testScript)) {
    const pkg = JSON.parse(fs.readFileSync(testScript, 'utf-8'));
    if (pkg.scripts && pkg.scripts.test) {
      console.log(`${colors.blue}▶ Running tests...${colors.reset}`);
      try {
        execSync('npm test', {
          cwd: path.join(__dirname, '../functions'),
          stdio: 'inherit',
        });
        console.log(`${colors.green}✅ Tests passed${colors.reset}\n`);
      } catch {
        console.error(`${colors.red}❌ Tests failed${colors.reset}\n`);
        const proceed = process.argv.includes('--force');
        if (!proceed) {
          console.log(`Use ${colors.yellow}--force${colors.reset} to deploy anyway\n`);
          process.exit(1);
        }
      }
    }
  }

  // Deploy to Firebase
  console.log(`${colors.bright}${colors.blue}Deploying to Firebase...${colors.reset}\n`);

  try {
    execSync('firebase deploy --only functions', {
      cwd: path.join(__dirname, '..'),
      stdio: 'inherit',
    });

    console.log(`
${colors.green}${colors.bright}✅ Deployment successful!${colors.reset}

${colors.bright}Next steps:${colors.reset}
  - Verify deployment in Firebase Console
  - Test API endpoints
  - Monitor logs with 'npm run logs'

${colors.green}🎉 Your backend is live!${colors.reset}
`);
  } catch {
    console.error(`\n${colors.red}❌ Deployment failed${colors.reset}\n`);
    process.exit(1);
  }
}

deploy().catch((error) => {
  console.error(`\n${colors.red}❌ Error: ${error.message}${colors.reset}\n`);
  process.exit(1);
});
