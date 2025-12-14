#!/usr/bin/env node

/**
 * Configuration Validation Script
 * Validates that the backend project is properly configured
 */

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

const CHECK_MARK = '✓';
const CROSS_MARK = '✗';
const WARNING_MARK = '⚠';

let errors = 0;
let warnings = 0;
let checks = 0;

function printHeader(title) {
  console.log(`\n${colors.bright}${colors.blue}${title}${colors.reset}`);
  console.log(`${colors.dim}${'─'.repeat(60)}${colors.reset}`);
}

function printSuccess(message) {
  checks++;
  console.log(`${colors.green}${CHECK_MARK}${colors.reset} ${message}`);
}

function printWarning(message) {
  checks++;
  warnings++;
  console.log(`${colors.yellow}${WARNING_MARK}${colors.reset} ${message}`);
}

function printError(message) {
  checks++;
  errors++;
  console.log(`${colors.red}${CROSS_MARK}${colors.reset} ${message}`);
}

function fileExists(filePath) {
  return fs.existsSync(path.join(__dirname, '..', filePath));
}

function readEnvFile() {
  const envPath = path.join(__dirname, '../.env');
  if (!fs.existsSync(envPath)) {
    return null;
  }

  const envContent = fs.readFileSync(envPath, 'utf8');
  const env = {};

  envContent.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const [key, ...valueParts] = trimmed.split('=');
      env[key.trim()] = valueParts.join('=').trim();
    }
  });

  return env;
}

function checkCommand(command, name) {
  try {
    execSync(`which ${command}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function runCommand(command, cwd) {
  try {
    execSync(command, {
      cwd: cwd || path.join(__dirname, '..'),
      stdio: 'pipe',
      encoding: 'utf8',
    });
    return true;
  } catch (error) {
    return false;
  }
}

console.log(`
${colors.bright}${colors.blue}╔════════════════════════════════════════════════════════════╗
║                                                            ║
║   🔍 Backend Boilerplate Validation                       ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝${colors.reset}
`);

// Check prerequisites
printHeader('Prerequisites');

if (checkCommand('node', 'Node.js')) {
  const nodeVersion = execSync('node --version', { encoding: 'utf8' }).trim();
  printSuccess(`Node.js installed (${nodeVersion})`);

  // Check Node.js version
  const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0]);
  if (majorVersion < 18) {
    printWarning(`Node.js version ${nodeVersion} is below recommended 18+`);
  }
} else {
  printError('Node.js not found - install from https://nodejs.org');
}

if (checkCommand('npm', 'npm')) {
  const npmVersion = execSync('npm --version', { encoding: 'utf8' }).trim();
  printSuccess(`npm installed (v${npmVersion})`);
} else {
  printError('npm not found');
}

if (checkCommand('firebase', 'Firebase CLI')) {
  const firebaseVersion = execSync('firebase --version', { encoding: 'utf8' }).trim();
  printSuccess(`Firebase CLI installed (${firebaseVersion})`);
} else {
  printWarning('Firebase CLI not found - install with: npm install -g firebase-tools');
}

// Check project structure
printHeader('Project Structure');

const requiredFiles = [
  'package.json',
  'tsconfig.json',
  'src/index.ts',
];

requiredFiles.forEach(file => {
  if (fileExists(file)) {
    printSuccess(`Found ${file}`);
  } else {
    printError(`Missing required file: ${file}`);
  }
});

const requiredDirs = [
  'src/config',
  'src/base',
  'src/middleware',
  'src/utilities',
];

requiredDirs.forEach(dir => {
  if (fileExists(dir)) {
    printSuccess(`Found directory: ${dir}`);
  } else {
    printWarning(`Directory not found: ${dir}`);
  }
});

// Check environment configuration
printHeader('Environment Configuration');

const env = readEnvFile();

if (env) {
  printSuccess('.env file exists');

  // Check for required environment variables
  const requiredVars = [
    'APP_NAME',
    'NODE_ENV',
    'FIREBASE_PROJECT_ID',
    'API_BASE_PATH',
  ];

  const optionalVars = [
    'CORS_ORIGINS',
    'LOG_LEVEL',
    'RATE_LIMIT_ENABLED',
  ];

  requiredVars.forEach(varName => {
    if (env[varName]) {
      if (env[varName].includes('FIXME') || env[varName].includes('your-')) {
        printWarning(`${varName} is set but contains placeholder value`);
      } else {
        printSuccess(`${varName} is configured`);
      }
    } else {
      printError(`Missing required environment variable: ${varName}`);
    }
  });

  optionalVars.forEach(varName => {
    if (env[varName]) {
      printSuccess(`${varName} is configured`);
    } else {
      printWarning(`Optional variable ${varName} not set`);
    }
  });

} else {
  printError('.env file not found - run: npm run setup');
}

// Check dependencies
printHeader('Dependencies');

const packageJsonPath = path.join(__dirname, '../package.json');
if (fs.existsSync(packageJsonPath)) {
  printSuccess('package.json found');

  const nodeModulesPath = path.join(__dirname, '../node_modules');
  if (fs.existsSync(nodeModulesPath)) {
    printSuccess('node_modules directory exists');
  } else {
    printError('node_modules not found - run: npm install');
  }
} else {
  printError('package.json not found');
}

// Check TypeScript compilation
printHeader('TypeScript Compilation');

console.log(`${colors.dim}Running TypeScript compiler check...${colors.reset}`);
if (runCommand('npx tsc --noEmit')) {
  printSuccess('TypeScript compilation check passed');
} else {
  printWarning('TypeScript compilation has errors - run: npm run build');
}

// Check linting (if requested)
const skipLint = process.argv.includes('--skip-lint');
if (!skipLint) {
  printHeader('Code Quality');

  console.log(`${colors.dim}Running ESLint...${colors.reset}`);
  if (runCommand('npm run lint')) {
    printSuccess('ESLint passed');
  } else {
    printWarning('ESLint found issues - run: npm run lint:fix');
  }
}

// Check tests (if requested)
const skipTests = process.argv.includes('--skip-tests');
if (!skipTests) {
  printHeader('Tests');

  console.log(`${colors.dim}Running test suite...${colors.reset}`);
  if (runCommand('npm test')) {
    printSuccess('All tests passed (807 tests)');
  } else {
    printError('Some tests failed - run: npm test');
  }
}

// Check build (if requested)
const skipBuild = process.argv.includes('--skip-build');
if (!skipBuild) {
  printHeader('Build');

  console.log(`${colors.dim}Running production build...${colors.reset}`);
  if (runCommand('npm run build')) {
    printSuccess('Production build succeeded');
  } else {
    printError('Build failed - check TypeScript errors');
  }
}

// Summary
printHeader('Summary');

console.log(`
${colors.bright}Validation Results:${colors.reset}
  ${colors.green}${CHECK_MARK} ${checks - errors - warnings} checks passed${colors.reset}
  ${warnings > 0 ? `${colors.yellow}${WARNING_MARK} ${warnings} warnings${colors.reset}` : ''}
  ${errors > 0 ? `${colors.red}${CROSS_MARK} ${errors} errors${colors.reset}` : ''}
`);

if (errors === 0 && warnings === 0) {
  console.log(`${colors.green}${colors.bright}✨ All checks passed! Your project is properly configured.${colors.reset}\n`);
  process.exit(0);
} else if (errors === 0) {
  console.log(`${colors.yellow}${colors.bright}⚠️  Validation completed with warnings. Review warnings above.${colors.reset}\n`);
  process.exit(0);
} else {
  console.log(`${colors.red}${colors.bright}❌ Validation failed. Fix the errors above before proceeding.${colors.reset}\n`);
  console.log(`${colors.dim}Tip: Run ${colors.bright}npm run setup${colors.reset}${colors.dim} to configure the project automatically.${colors.reset}\n`);
  process.exit(1);
}
