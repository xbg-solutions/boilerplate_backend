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

// Get model files from command line arguments
const modelFiles = process.argv.slice(2);

if (modelFiles.length === 0) {
  console.error(`${colors.red}❌ Usage: npm run generate <model-file> [model-file2 ...]${colors.reset}`);
  console.log(`\nExample: npm run generate __examples__/user.model.js`);
  console.log(`         npm run generate __examples__/accounts.model.js __examples__/projects.model.js\n`);
  process.exit(1);
}

try {
  // Load and merge all models
  const mergedEntities = {};

  for (const modelFile of modelFiles) {
    const modelPath = path.resolve(modelFile);

    if (!fs.existsSync(modelPath)) {
      console.error(`${colors.red}❌ Model file not found: ${modelPath}${colors.reset}\n`);
      process.exit(1);
    }

    if (modelPath.endsWith('.ts')) {
      console.error(`${colors.yellow}⚠️  TypeScript models need to be compiled first${colors.reset}`);
      console.log(`   Please create a .js version or use the compiled output\n`);
      process.exit(1);
    }

    console.log(`${colors.blue}📄 Loading model: ${modelPath}${colors.reset}`);
    const model = require(modelPath);

    // Handle default export, named export with .entities, or bare object
    let modelData = model.default || model;
    if (!modelData.entities) {
      const namedKey = Object.keys(model).find((k) => model[k] && model[k].entities);
      if (namedKey) {
        modelData = model[namedKey];
      }
    }

    if (!modelData || !modelData.entities) {
      throw new Error(`Invalid model format in ${modelFile}. Expected object with "entities" property`);
    }

    Object.assign(mergedEntities, modelData.entities);
  }

  console.log(`\n${colors.green}✅ ${modelFiles.length} model(s) loaded successfully${colors.reset}\n`);
  console.log(`${colors.bright}Entities found:${colors.reset}`);
  Object.keys(mergedEntities).forEach((name) => {
    console.log(`  - ${name}`);
  });
  console.log('');

  // Create generator
  const outputDir = path.join(__dirname, '../functions/src/generated');
  const generator = createGenerator(outputDir);

  // Generate code for each entity (pass full entities map for cross-entity resolution)
  console.log(`${colors.bright}${colors.blue}Generating code...${colors.reset}\n`);

  const contexts = [];
  for (const [entityName, spec] of Object.entries(mergedEntities)) {
    console.log(`${colors.blue}📦 Generating ${entityName}...${colors.reset}`);
    const ctx = generator.generateEntity(entityName, spec, {}, mergedEntities);
    contexts.push(ctx);
  }

  // Generate encryption registry (if any entity has encrypted fields)
  generator.generateEncryptionRegistry(contexts);

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
