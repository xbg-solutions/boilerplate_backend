const { readdirSync, existsSync } = require('node:fs');
const { join } = require('node:path');
const { common } = require('./jest.shared');

const packagesDir = join(__dirname, 'packages');

// Each workspace carrying tests becomes its own Jest project, so a failure is
// reported against the package it belongs to and `--selectProjects <name>` can
// run one package. Discovered rather than listed, so a new package's tests are
// picked up without editing this file.
//
// Coverage is NOT measured here — see jest.coverage.config.js for why.
const projects = readdirSync(packagesDir)
  .filter((pkg) => existsSync(join(packagesDir, pkg, 'src', '__tests__')))
  .sort()
  .map((pkg) => ({
    ...common,
    displayName: pkg,
    rootDir: join(packagesDir, pkg),
    testMatch: ['<rootDir>/src/**/__tests__/**/*.test.ts'],
  }));

module.exports = { projects };
