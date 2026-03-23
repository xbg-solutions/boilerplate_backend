/**
 * Init Command
 * Scaffolds a new XBG backend project
 */

import * as path from 'path';
import * as fs from 'fs-extra';
import inquirer from 'inquirer';
import chalk from 'chalk';
import { execSync } from 'child_process';
import { getOptionalUtilities, getRequiredUtilities, UtilityDefinition } from '../utils-registry';

interface InitOptions {
  directory: string;
  name?: string;
  skipInstall?: boolean;
}

export async function initProject(options: InitOptions): Promise<void> {
  printBanner();

  const targetDir = path.resolve(options.directory);
  const templateDir = path.resolve(__dirname, '../../src/project-template');

  // ── Gather configuration ──────────────────────────────
  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'projectName',
      message: 'Project name:',
      default: options.name || path.basename(targetDir) || 'my-backend-api',
    },
    {
      type: 'input',
      name: 'firebaseProject',
      message: 'Firebase project ID:',
      validate: (input: string) => input.trim() ? true : 'Firebase project ID is required',
    },
    {
      type: 'list',
      name: 'deploymentMode',
      message: 'Deployment mode:',
      choices: [
        { name: 'Backend-only (standalone Firebase Functions)', value: 'standalone' },
        { name: 'Mono-repo (frontend + backend in one repo)', value: 'monorepo' },
      ],
    },
    {
      type: 'list',
      name: 'environment',
      message: 'Initial environment:',
      choices: ['development', 'staging', 'production'],
      default: 'development',
    },
    {
      type: 'confirm',
      name: 'multiDB',
      message: 'Use multi-database mode? (recommended)',
      default: true,
    },
    {
      type: 'input',
      name: 'apiBasePath',
      message: 'API base path:',
      default: '/api/v1',
    },
    {
      type: 'input',
      name: 'corsOrigins',
      message: 'CORS origins:',
      default: 'http://localhost:5173,http://localhost:3000',
    },
  ]);

  // ── Feature flags ─────────────────────────────────────
  const features = await inquirer.prompt([
    { type: 'confirm', name: 'auth', message: 'Authentication:', default: true },
    { type: 'confirm', name: 'multiTenant', message: 'Multi-tenant:', default: false },
    { type: 'confirm', name: 'fileUploads', message: 'File uploads:', default: true },
    { type: 'confirm', name: 'notifications', message: 'Notifications:', default: true },
    { type: 'confirm', name: 'analytics', message: 'Analytics:', default: false },
    { type: 'confirm', name: 'realtime', message: 'Realtime (SSE/WebSocket):', default: true },
  ]);

  // ── Utility selection ─────────────────────────────────
  console.log(chalk.cyan('\n── Select Utilities ─────────────────────────────'));
  console.log(chalk.dim('Core utilities (logger, events, errors, firestore) are always included.\n'));

  const optionalUtils = getOptionalUtilities();
  const categories = [...new Set(optionalUtils.map((u) => u.category))];

  const utilChoices = categories.flatMap((category) => {
    const categoryUtils = optionalUtils.filter((u) => u.category === category);
    return [
      new inquirer.Separator(`── ${category.toUpperCase()} ──`),
      ...categoryUtils.map((u) => ({
        name: `${u.name} - ${chalk.dim(u.description)}`,
        value: u.package,
        checked: ['@xbg.solutions/utils-cache-connector', '@xbg.solutions/utils-token-handler', '@xbg.solutions/utils-validation'].includes(u.package),
      })),
    ];
  });

  const { selectedUtils } = await inquirer.prompt([
    {
      type: 'checkbox',
      name: 'selectedUtils',
      message: 'Select utilities to include:',
      choices: utilChoices,
      pageSize: 25,
    },
  ]);

  // ── Scaffold project ──────────────────────────────────
  console.log(chalk.cyan('\n── Scaffolding Project ─────────────────────────'));

  // Copy template files
  const functionsDir = path.join(targetDir, 'functions');
  await fs.ensureDir(functionsDir);

  // Copy project structure
  await fs.copy(path.join(templateDir, 'functions', 'src'), path.join(functionsDir, 'src'), {
    filter: (src) => !src.includes('node_modules'),
  });
  await fs.copy(path.join(templateDir, 'functions', 'tsconfig.json'), path.join(functionsDir, 'tsconfig.json'));
  await fs.copy(path.join(templateDir, 'functions', 'jest.config.js'), path.join(functionsDir, 'jest.config.js'));
  console.log(chalk.green('  Created'), 'functions/src/');
  console.log(chalk.green('  Created'), 'functions/tsconfig.json');

  // Copy scripts and examples
  await fs.copy(path.join(templateDir, '__scripts__'), path.join(targetDir, '__scripts__'));
  await fs.copy(path.join(templateDir, '__examples__'), path.join(targetDir, '__examples__'));
  console.log(chalk.green('  Created'), '__scripts__/');
  console.log(chalk.green('  Created'), '__examples__/');

  // Generate firebase.json
  const firebaseJson = {
    firestore: { rules: 'firestore.rules' },
    functions: {
      source: 'functions',
      runtime: 'nodejs22',
      ignore: ['node_modules', '.git', 'firebase-debug.log', 'firebase-debug.*.log'],
      predeploy: ['npm --prefix "$RESOURCE_DIR" run lint', 'npm --prefix "$RESOURCE_DIR" run build'],
    },
    emulators: {
      functions: { port: 5001 },
      firestore: { port: 8080 },
      ui: { enabled: true, port: 4000 },
      singleProjectMode: true,
    },
  };
  await fs.writeJson(path.join(targetDir, 'firebase.json'), firebaseJson, { spaces: 2 });
  console.log(chalk.green('  Created'), 'firebase.json');

  // Generate .firebaserc
  await fs.writeJson(path.join(targetDir, '.firebaserc'), {
    projects: { default: answers.firebaseProject },
  }, { spaces: 2 });
  console.log(chalk.green('  Created'), '.firebaserc');

  // Copy firestore.rules if exists
  const rulesTemplate = path.join(templateDir, 'firestore.rules');
  if (await fs.pathExists(rulesTemplate)) {
    await fs.copy(rulesTemplate, path.join(targetDir, 'firestore.rules'));
    console.log(chalk.green('  Created'), 'firestore.rules');
  }

  // Generate package.json for functions/
  const requiredUtils = getRequiredUtilities();
  const allPackages = [
    '@xbg.solutions/backend-core',
    ...requiredUtils.map((u) => u.package),
    ...(selectedUtils as string[]),
  ];

  const functionsPackageJson = generateFunctionsPackageJson(answers.projectName, allPackages);
  await fs.writeJson(path.join(functionsDir, 'package.json'), functionsPackageJson, { spaces: 2 });
  console.log(chalk.green('  Created'), 'functions/package.json');

  // Generate .env
  const envContent = generateEnvFile(answers, features);
  await fs.writeFile(path.join(functionsDir, '.env'), envContent);
  console.log(chalk.green('  Created'), 'functions/.env');

  // Update tsconfig to remove path aliases (now using packages)
  const tsconfig = await fs.readJson(path.join(functionsDir, 'tsconfig.json'));
  delete tsconfig.compilerOptions.paths;
  await fs.writeJson(path.join(functionsDir, 'tsconfig.json'), tsconfig, { spaces: 2 });

  // ── Install dependencies ──────────────────────────────
  if (!options.skipInstall) {
    const { install } = await inquirer.prompt([
      { type: 'confirm', name: 'install', message: 'Install dependencies?', default: true },
    ]);

    if (install) {
      console.log(chalk.dim('\nInstalling dependencies...'));
      try {
        execSync('npm install', { cwd: functionsDir, stdio: 'inherit' });
        console.log(chalk.green('Dependencies installed.'));
      } catch {
        console.error(chalk.red('Failed to install. Run npm install in functions/ manually.'));
      }
    }
  }

  // ── Summary ───────────────────────────────────────────
  printSummary(answers, features, selectedUtils as string[], targetDir);
}

function printBanner(): void {
  console.log(chalk.bold.blue(`
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║   XBG Backend - Project Setup                              ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
`));
}

function generateFunctionsPackageJson(projectName: string, packages: string[]): Record<string, any> {
  const deps: Record<string, string> = {};

  // Add XBG packages
  for (const pkg of packages) {
    deps[pkg] = '^1.0.0';
  }

  // Add required non-XBG dependencies
  deps['dotenv'] = '^16.3.1';
  deps['firebase-admin'] = '^12.0.0';
  deps['firebase-functions'] = '^4.6.0';

  return {
    name: `${projectName}-functions`,
    version: '1.0.0',
    description: `Backend functions for ${projectName}`,
    main: 'lib/index.js',
    engines: { node: '22' },
    scripts: {
      build: 'tsc',
      'build:watch': 'tsc --watch',
      serve: 'npm run build && firebase emulators:start --only functions',
      shell: 'npm run build && firebase functions:shell',
      start: 'npm run shell',
      deploy: 'firebase deploy --only functions',
      logs: 'firebase functions:log',
      lint: 'eslint --ext .js,.ts .',
      'lint:fix': 'eslint --ext .js,.ts . --fix',
      test: 'jest',
      'test:watch': 'jest --watch',
      'test:coverage': 'jest --coverage',
      generate: 'node ../__scripts__/generate.js',
      setup: 'node ../__scripts__/setup.js',
      'deploy:full': 'node ../__scripts__/deploy.js',
      validate: 'node ../__scripts__/validate.js',
      'validate:quick': 'node ../__scripts__/validate.js --skip-tests --skip-build',
    },
    dependencies: deps,
    devDependencies: {
      '@types/node': '^20.11.0',
      '@typescript-eslint/eslint-plugin': '^6.18.1',
      '@typescript-eslint/parser': '^6.18.1',
      eslint: '^8.56.0',
      'eslint-config-google': '^0.14.0',
      'eslint-plugin-import': '^2.29.1',
      'firebase-functions-test': '^3.1.1',
      jest: '^29.7.0',
      'ts-jest': '^29.1.1',
      typescript: '^5.3.3',
    },
    private: true,
  };
}

function generateEnvFile(answers: any, features: any): string {
  return `# ──────────────────────────────────────────────────────────
# Application
# ──────────────────────────────────────────────────────────
APP_NAME=${answers.projectName}
APP_VERSION=1.0.0
NODE_ENV=${answers.environment}
PORT=5001

# ──────────────────────────────────────────────────────────
# Firebase
# ──────────────────────────────────────────────────────────
FIREBASE_PROJECT_ID=${answers.firebaseProject}

# ──────────────────────────────────────────────────────────
# Database
# ──────────────────────────────────────────────────────────
MAIN_DATABASE_ID=${answers.multiDB ? 'main' : '(default)'}
ANALYTICS_DATABASE_ID=${answers.multiDB ? 'analytics' : '(default)'}

# ──────────────────────────────────────────────────────────
# API
# ──────────────────────────────────────────────────────────
API_BASE_PATH=${answers.apiBasePath}
CORS_ORIGINS=${answers.corsOrigins}
REQUEST_SIZE_LIMIT=10mb

# ──────────────────────────────────────────────────────────
# Features
# ──────────────────────────────────────────────────────────
FEATURE_AUTHENTICATION=${features.auth}
FEATURE_MULTI_TENANT=${features.multiTenant}
FEATURE_FILE_UPLOADS=${features.fileUploads}
FEATURE_NOTIFICATIONS=${features.notifications}
FEATURE_ANALYTICS=${features.analytics}
FEATURE_REALTIME=${features.realtime}

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
# PII Encryption (generate with: openssl rand -hex 32)
# ──────────────────────────────────────────────────────────
PII_ENCRYPTION_KEY=

# ──────────────────────────────────────────────────────────
# JWT / Authentication
# ──────────────────────────────────────────────────────────
JWT_ISSUER=${answers.projectName}
JWT_AUDIENCE=${answers.projectName}-api
JWT_EXPIRES_IN=1h
JWT_REFRESH_EXPIRES_IN=7d
TOKEN_BLACKLIST_ENABLED=true
`;
}

function printSummary(answers: any, features: any, selectedUtils: string[], targetDir: string): void {
  const enabledFeatures = Object.entries(features)
    .filter(([, v]) => v)
    .map(([k]) => k);

  console.log(chalk.green.bold('\nProject created successfully!'));
  console.log(`
${chalk.bold('Configuration:')}
  Project:          ${answers.projectName}
  Firebase project: ${answers.firebaseProject}
  Mode:             ${answers.deploymentMode}
  Database:         ${answers.multiDB ? 'Multi-DB' : 'Single'}
  Features:         ${enabledFeatures.join(', ') || 'None'}
  Utilities:        ${selectedUtils.length} selected

${chalk.bold('Next steps:')}
  1. Review functions/.env and add integration keys as needed
  2. Define your data model in __examples__/
  3. Run ${chalk.cyan('npm run generate __examples__/your-model.ts')} to generate code
  4. Register generated controllers in functions/src/index.ts
  5. Run ${chalk.cyan('npm run build')} to compile
  6. Run ${chalk.cyan('npm start')} for local development

${chalk.bold('Update propagation:')}
  Run ${chalk.cyan('npx @xbg.solutions/create-backend sync')} to check for and apply updates
  Run ${chalk.cyan('npm update')} in functions/ to update @xbg packages
`);
}
