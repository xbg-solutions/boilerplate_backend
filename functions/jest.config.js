module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: [
    '**/__tests__/**/*.test.ts',
    '**/?(*.)+(spec|test).ts'
  ],
  transform: {
    '^.+\\.ts$': 'ts-jest',
    // firebase-admin 14 depends on jose 6 and the utils on uuid 14; both ship
    // ESM only. Jest runs CommonJS, so those packages are transformed rather
    // than ignored like the rest of node_modules.
    '^.+\\.js$': ['ts-jest', { tsconfig: { allowJs: true, module: 'commonjs', esModuleInterop: true }, diagnostics: false }],
  },
  transformIgnorePatterns: ['^(?!.*/node_modules/(jose|uuid)/).*/node_modules/'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/**/__tests__/**',
    '!src/index.ts',
    '!src/server.ts',
    '!src/generated/**',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 70,
      lines: 70,
      statements: 70,
    },
  },
  setupFilesAfterEnv: ['<rootDir>/src/__tests__/setup.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@utilities/(.*)$': '<rootDir>/src/utilities/$1',
    '^@base/(.*)$': '<rootDir>/src/base/$1',
    '^@middleware/(.*)$': '<rootDir>/src/middleware/$1',
    '^@config/(.*)$': '<rootDir>/src/config/$1',
    '^@generated/(.*)$': '<rootDir>/src/generated/$1',
  },
  globals: {
    'ts-jest': {
      tsconfig: {
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
      },
    },
  },
  testTimeout: 10000,
  verbose: true,
};
