#!/usr/bin/env node

/**
 * Code Generation Script
 * Generates entities, repositories, services, and controllers from data model specifications
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
║   🚀 Backend Boilerplate Code Generator                   ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝${colors.reset}
`);

// Check if TypeScript files need to be built
const libPath = path.join(__dirname, '../functions/lib');
if (!fs.existsSync(libPath)) {
  console.log(`${colors.yellow}⚠️  Building TypeScript files...${colors.reset}\n`);
  const { execSync } = require('child_process');
  try {
    execSync('npm run build', {
      cwd: path.join(__dirname, '../functions'),
      stdio: 'inherit',
    });
    console.log(`\n${colors.green}✅ Build complete${colors.reset}\n`);
  } catch (error) {
    console.error(`${colors.red}❌ Build failed. Please run 'npm run build' manually.${colors.reset}`);
    process.exit(1);
  }
}

// Import generator (from compiled JS)
const { createGenerator } = require('../functions/lib/generator/generator');

// Get model file from command line arguments
const modelFile = process.argv[2];

if (!modelFile) {
  console.error(`${colors.red}❌ Usage: npm run generate <model-file>${colors.reset}`);
  console.log(`\nExample: npm run generate examples/user.model.ts\n`);
  process.exit(1);
}

const modelPath = path.resolve(modelFile);

if (!fs.existsSync(modelPath)) {
  console.error(`${colors.red}❌ Model file not found: ${modelPath}${colors.reset}\n`);
  process.exit(1);
}

console.log(`${colors.blue}📄 Loading model: ${modelPath}${colors.reset}\n`);

// Load the model
let model;
try {
  // For TypeScript files, we need to use ts-node or compile first
  if (modelPath.endsWith('.ts')) {
    console.log(`${colors.yellow}⚠️  TypeScript models need to be compiled first${colors.reset}`);
    console.log(`   Please create a .js version or use the compiled output\n`);
    process.exit(1);
  }

  model = require(modelPath);

  // Handle both default and named exports
  const modelData = model.default || model.UserManagementModel || model;

  if (!modelData || !modelData.entities) {
    throw new Error('Invalid model format. Expected object with "entities" property');
  }

  console.log(`${colors.green}✅ Model loaded successfully${colors.reset}\n`);
  console.log(`${colors.bright}Entities found:${colors.reset}`);
  Object.keys(modelData.entities).forEach((name) => {
    console.log(`  - ${name}`);
  });
  console.log('');

  // Create generator
  const outputDir = path.join(__dirname, '../functions/src/generated');
  const generator = createGenerator(outputDir);

  // Generate code for each entity
  console.log(`${colors.bright}${colors.blue}Generating code...${colors.reset}\n`);

  for (const [entityName, spec] of Object.entries(modelData.entities)) {
    console.log(`${colors.blue}📦 Generating ${entityName}...${colors.reset}`);
    generator.generateEntity(entityName, spec);
  }

  // Generate barrel exports
  console.log('');
  generator.generateBarrelExports();

  console.log(`
${colors.green}${colors.bright}✅ Code generation complete!${colors.reset}

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

${colors.blue}Happy coding! 🎉${colors.reset}
`);
} catch (error) {
  console.error(`\n${colors.red}❌ Error: ${error.message}${colors.reset}\n`);
  if (error.stack) {
    console.error(error.stack);
  }
  process.exit(1);
}
