const { common } = require('./jest.shared');

// A deliberately FLAT config — no `projects`.
//
// Jest collects coverage per project, and skips a project entirely when it runs
// no tests. Under the grouped config that silently excluded every package
// without a test suite, so the report read 88% while measuring 28 files out of
// ~29,600 lines of source — flattering the real figure by roughly 2x. A flat run
// instruments files that no test ever loads, so untested packages score zero
// instead of disappearing.
//
// Run tests with jest.config.js (grouped, supports --selectProjects); measure
// coverage with this one.
module.exports = {
  ...common,
  rootDir: __dirname,
  testMatch: ['<rootDir>/packages/*/src/**/__tests__/**/*.test.ts'],
  collectCoverageFrom: [
    'packages/*/src/**/*.ts',
    '!packages/*/src/**/__tests__/**',
    '!packages/*/src/**/*.d.ts',
  ],
  coverageReporters: ['text-summary', 'lcov'],
};
