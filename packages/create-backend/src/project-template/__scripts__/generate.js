#!/usr/bin/env node

/**
 * Code Generation Script
 * Generates entities, repositories, services, and controllers from data model specifications
 *
 * Uses the code generator from @xbg/backend-core
 */

const path = require('path');
const fs = require('fs');

// Colors for console output
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
║   XBG Backend Code Generator                               ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝${colors.reset}
`);

// Import generator from @xbg/backend-core package
let createGenerator;
try {
  ({ createGenerator } = require('@xbg/backend-core'));
} catch (error) {
  console.error(`${colors.red}❌ @xbg/backend-core not installed. Run 'npm install' first.${colors.reset}`);
  process.exit(1);
}

// Get model file from command line arguments
const modelFile = process.argv[2];

if (!modelFile) {
  console.error(`${colors.red}❌ Usage: npm run generate <model-file>${colors.reset}`);
  console.log(`\nExample: npm run generate __examples__/user.model.js\n`);
  process.exit(1);
}

const modelPath = path.resolve(modelFile);

if (!fs.existsSync(modelPath)) {
  console.error(`${colors.red}❌ Model file not found: ${modelPath}${colors.reset}\n`);
  process.exit(1);
}

console.log(`${colors.blue}Loading model: ${modelPath}${colors.reset}\n`);

// Load the model
let model;
try {
  if (modelPath.endsWith('.ts')) {
    console.log(`${colors.yellow}TypeScript models need to be compiled first${colors.reset}`);
    console.log(`   Please create a .js version or use the compiled output\n`);
    process.exit(1);
  }

  model = require(modelPath);

  // Handle both default and named exports
  const modelData = model.default || model.UserManagementModel || model;

  if (!modelData || !modelData.entities) {
    throw new Error('Invalid model format. Expected object with "entities" property');
  }

  console.log(`${colors.green}Model loaded successfully${colors.reset}\n`);
  console.log(`${colors.bright}Entities found:${colors.reset}`);
  Object.keys(modelData.entities).forEach((name) => {
    console.log(`  - ${name}`);
  });
  console.log('');

  // Create generator - templates come from @xbg/backend-core package
  const outputDir = path.join(__dirname, '../functions/src/generated');
  const generator = createGenerator(outputDir);

  // Generate code for each entity
  console.log(`${colors.bright}${colors.blue}Generating code...${colors.reset}\n`);

  for (const [entityName, spec] of Object.entries(modelData.entities)) {
    console.log(`${colors.blue}Generating ${entityName}...${colors.reset}`);
    generator.generateEntity(entityName, spec);
  }

  // Generate barrel exports
  console.log('');
  generator.generateBarrelExports();

  console.log(`
${colors.green}${colors.bright}Code generation complete!${colors.reset}

${colors.bright}Generated files:${colors.reset}
  - entities/     Entity classes with validation
  - repositories/ Database access layer
  - services/     Business logic layer
  - controllers/  HTTP request handlers

${colors.bright}Next steps:${colors.reset}
  1. Review generated code in functions/src/generated/
  2. Customize business logic in service classes
  3. Add custom routes in controller classes
  4. Update functions/src/index.ts to register controllers
  5. Run 'npm run build' to compile
  6. Run 'npm start' to test locally
`);
} catch (error) {
  console.error(`\n${colors.red}Error: ${error.message}${colors.reset}\n`);
  if (error.stack) {
    console.error(error.stack);
  }
  process.exit(1);
}
