// Settings shared by jest.config.js (test running, grouped per package) and
// jest.coverage.config.js (a flat run, needed for an honest denominator).

// Dependencies published as ESM only, which Jest's CommonJS runtime must be told
// to transform. Add to this list if a future upgrade drops its CJS build.
//
// Node 22 can require() these natively, so production is unaffected — this is
// purely a Jest limitation. uuid 14 is a direct dep; jose 6 arrives via
// firebase-admin -> jwks-rsa.
const ESM_ONLY_DEPS = ['uuid', 'jose'];

const common = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: { allowJs: true, module: 'commonjs' } }],
  },
  transformIgnorePatterns: [`/node_modules/(?!(${ESM_ONLY_DEPS.join('|')})/)`],
  testPathIgnorePatterns: ['/node_modules/', '/lib/'],
};

module.exports = { ESM_ONLY_DEPS, common };
