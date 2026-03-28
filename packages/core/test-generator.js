/**
 * Test script for the code generator
 * Verifies that:
 * 1. Templates are embedded and accessible
 * 2. Generated code includes BaseEntityData
 * 3. No duplicate base entity fields
 * 4. No unused imports
 */

const { createGenerator } = require('./lib/core/src/generator/generator');
const fs = require('fs');
const path = require('path');

// Clean test output directory
const testOutputDir = path.join(__dirname, 'test-output');
if (fs.existsSync(testOutputDir)) {
  fs.rmSync(testOutputDir, { recursive: true });
}
fs.mkdirSync(testOutputDir, { recursive: true });

// Create generator
const generator = createGenerator(testOutputDir);

// Define test entity specification
const testEntitySpec = {
  fields: {
    // These should be SKIPPED (base entity fields)
    id: {
      type: 'string',
      required: false,
    },
    createdAt: {
      type: 'timestamp',
      required: false,
    },
    updatedAt: {
      type: 'timestamp',
      required: false,
    },
    version: {
      type: 'number',
      required: false,
    },
    // These should be INCLUDED (custom fields)
    name: {
      type: 'string',
      required: true,
      minLength: 3,
      maxLength: 100,
    },
    email: {
      type: 'email',
      required: true,
      unique: true,
    },
    age: {
      type: 'number',
      required: false,
      min: 0,
      max: 150,
    },
    status: {
      type: 'enum',
      values: ['active', 'inactive', 'pending'],
      required: true,
      default: 'pending',
    },
  },
  relationships: {
    posts: {
      type: 'one-to-many',
      entity: 'Post',
    },
  },
  access: {
    create: ['admin', 'user'],
    read: ['admin', 'user', 'self'],
    update: ['admin', 'self'],
    delete: ['admin'],
  },
  businessRules: [
    'Users must be at least 18 years old to create an account',
    'Email addresses must be unique across the system',
  ],
};

// Test generation
async function runTest() {
  try {
    console.log('🔧 Testing code generator...\n');

    // Generate entity
    await generator.generateEntity('User', testEntitySpec, {
      collectionName: 'users',
      generateTests: false,
    });

    console.log('\n✅ Generation completed successfully!\n');

    // Verify generated files
    const entityPath = path.join(testOutputDir, 'entities', 'User.ts');
    const repositoryPath = path.join(testOutputDir, 'repositories', 'UserRepository.ts');
    const servicePath = path.join(testOutputDir, 'services', 'UserService.ts');
    const controllerPath = path.join(testOutputDir, 'controllers', 'UserController.ts');

    console.log('📁 Checking generated files...');
    const files = [
      { name: 'Entity', path: entityPath },
      { name: 'Repository', path: repositoryPath },
      { name: 'Service', path: servicePath },
      { name: 'Controller', path: controllerPath },
    ];

    let allFilesExist = true;
    for (const file of files) {
      if (fs.existsSync(file.path)) {
        console.log(`  ✓ ${file.name}: ${file.path}`);
      } else {
        console.log(`  ✗ ${file.name}: NOT FOUND`);
        allFilesExist = false;
      }
    }

    if (!allFilesExist) {
      console.error('\n❌ Some files were not generated!');
      process.exit(1);
    }

    // Check entity file content
    console.log('\n🔍 Verifying entity file content...');
    const entityContent = fs.readFileSync(entityPath, 'utf-8');

    // Check for BaseEntityData import
    if (entityContent.includes('BaseEntityData')) {
      console.log('  ✓ BaseEntityData is imported');
    } else {
      console.error('  ✗ BaseEntityData is NOT imported');
      process.exit(1);
    }

    // Check that base entity fields are NOT duplicated
    const duplicateChecks = [
      { field: 'id:', shouldNotExist: true },
      { field: 'createdAt:', shouldNotExist: true },
      { field: 'updatedAt:', shouldNotExist: true },
      { field: 'version:', shouldNotExist: true },
    ];

    // Count occurrences in the class body (between "export class User" and first method)
    const classBodyMatch = entityContent.match(/export class User extends BaseEntity \{([\s\S]*?)constructor/);
    const classBody = classBodyMatch ? classBodyMatch[1] : '';

    for (const check of duplicateChecks) {
      const occurrences = (classBody.match(new RegExp(check.field, 'g')) || []).length;
      if (occurrences === 0) {
        console.log(`  ✓ ${check.field} not duplicated in class body`);
      } else {
        console.error(`  ✗ ${check.field} found ${occurrences} time(s) in class body (should be 0)`);
        process.exit(1);
      }
    }

    // Check that custom fields ARE present (handle both optional and required syntax)
    const customFieldChecks = [
      { field: 'name', pattern: /name:\s*string/ },
      { field: 'email', pattern: /email:\s*string/ },
      { field: 'age', pattern: /age\?:\s*number/ },  // Optional field
      { field: 'status', pattern: /status:\s*'active'/ },  // Enum field
    ];
    for (const check of customFieldChecks) {
      if (check.pattern.test(classBody)) {
        console.log(`  ✓ Custom field ${check.field} is present`);
      } else {
        console.error(`  ✗ Custom field ${check.field} is NOT present or has wrong type`);
        console.error(`    Pattern: ${check.pattern}`);
        process.exit(1);
      }
    }

    // Check controller file for unused imports
    console.log('\n🔍 Verifying controller file...');
    const controllerContent = fs.readFileSync(controllerPath, 'utf-8');

    // Router import should not be present (we removed it as it was unused)
    if (!controllerContent.includes("import { Router } from 'express'")) {
      console.log('  ✓ No unused Router import');
    } else {
      console.error('  ✗ Unused Router import found');
      process.exit(1);
    }

    console.log('\n🎉 All tests passed!\n');
    console.log('Generated files are in:', testOutputDir);

  } catch (error) {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  }
}

runTest();
