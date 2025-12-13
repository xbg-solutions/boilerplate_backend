# Testing Philosophy & Guide

## 🎯 Core Principle: Test WHAT, Not HOW

This backend boilerplate follows behavioral testing principles that focus on **outcomes and contracts**, not implementation details.

### Why This Matters

```typescript
// ✅ GOOD - Test behavior
test('creates user and returns user ID', async () => {
  const userData = { email: 'user@example.com', name: 'Test User' };

  const result = await userService.createUser(userData);

  expect(result.success).toBe(true);
  expect(result.userId).toBeDefined();
});

// ❌ BAD - Test implementation
test('calls repository.insert with transformed data', async () => {
  const spy = jest.spyOn(repository, 'insert');
  await userService.createUser(userData);
  expect(spy).toHaveBeenCalledWith(expect.objectContaining({ ... }));
});
```

**The difference:**
- The good test validates that the service **does what it's supposed to do**
- The bad test validates **how it does it internally**
- If you refactor the implementation but keep the same behavior, the good test still passes
- The bad test breaks even though the behavior is correct

---

## 🧪 Testing Standards

### 1. Test Structure: Arrange-Act-Assert (AAA)

Every test should follow the AAA pattern for clarity:

```typescript
it('validates address and returns formatted result', async () => {
  // Arrange
  const address = {
    addressLine1: '1600 Amphitheatre Parkway',
    city: 'Mountain View',
    state: 'CA',
    postalCode: '94043'
  };

  // Act
  const result = await addressValidator.validateAddress(address);

  // Assert
  expect(result.isValid).toBe(true);
  expect(result.formattedAddress).toContain('Mountain View');
});
```

### 2. Minimal, Strategic Mocking

**Only mock external dependencies**, not your own code.

```typescript
// ✅ GOOD - Mock external services
jest.mock('firebase-admin', () => ({
  firestore: jest.fn(() => mockFirestore)
}));

jest.mock('@google-cloud/firestore', () => ({
  Firestore: jest.fn(() => mockFirestoreClient)
}));

// ✅ GOOD - Mock third-party APIs
jest.mock('@googlemaps/google-maps-services-js', () => ({
  Client: jest.fn(() => ({ geocode: mockGeocode }))
}));

// ❌ BAD - Mock your own utilities
jest.mock('../services/UserService'); // Don't do this!
```

**Why?**
- Mocking your own code tests nothing - you're just testing the mock
- External dependencies (APIs, databases, third-party SDKs) **should** be mocked to keep tests fast and deterministic
- Your business logic should be tested with real implementations

### 3. Meaningful Test Names

Test names should describe the **expected behavior** in plain English:

```typescript
// ✅ GOOD
describe('TokenHandler', () => {
  describe('verifyAndUnpack', () => {
    it('rejects tokens issued before global revocation timestamp', async () => {
      // ...
    });

    it('accepts valid tokens with correct signature', async () => {
      // ...
    });
  });
});

// ❌ BAD
describe('TokenHandler', () => {
  it('test1', () => { /* ... */ });
  it('works', () => { /* ... */ });
  it('handles edge case', () => { /* ... */ });
});
```

### 4. Test Both Success and Error Paths

Every public method should have tests for:
- ✅ **Happy path** (success scenario)
- ✅ **Error scenarios** (validation failures, network errors, etc.)
- ✅ **Edge cases** (null, undefined, empty strings, boundary values)

```typescript
describe('createUser', () => {
  it('creates user successfully with valid data', async () => {
    // Test success
  });

  it('throws error when email is invalid', async () => {
    // Test validation error
  });

  it('throws error when email already exists', async () => {
    // Test business rule violation
  });

  it('handles database connection failures gracefully', async () => {
    // Test infrastructure error
  });
});
```

### 5. Fast, Deterministic, Isolated

- **Fast**: Tests should run in seconds, not minutes
- **Deterministic**: Same input = same output, every time
- **Isolated**: Each test should be independent (no shared state)

```typescript
// ✅ GOOD - Independent tests
beforeEach(() => {
  // Fresh state for each test
  mockDb.clear();
  mockLogger.mockClear();
});

it('test A', () => { /* ... */ });
it('test B', () => { /* ... */ });

// ❌ BAD - Shared state
let sharedUser; // Don't share state between tests!

it('creates user', () => {
  sharedUser = createUser();
});

it('updates user', () => {
  updateUser(sharedUser); // Depends on previous test
});
```

---

## 📊 Test Coverage Philosophy

### We Value Valuable Tests, Not Coverage Percentages

**Coverage metrics are a tool, not a goal.**

```
80% coverage with meaningful behavioral tests > 100% coverage with brittle mocks
```

### What We Care About

✅ **Early Warnings** - Tests catch real bugs before production
✅ **Confidence** - Tests give us confidence to refactor safely
✅ **Documentation** - Tests document expected behavior
✅ **Fast Feedback** - Tests run quickly in CI/CD

❌ **Vanity Metrics** - 100% coverage that tests nothing useful
❌ **False Confidence** - Tests that pass but don't validate real behavior
❌ **Brittle Tests** - Tests that break on every refactor

### Coverage Guidelines

- **Critical paths**: 100% coverage (auth, PII handling, payment)
- **Business logic**: 80%+ coverage (services, repositories)
- **Utilities**: 80%+ coverage (validators, formatters, connectors)
- **Infrastructure**: 60%+ coverage (config, middleware)
- **Generated code**: Not required (but integration tests recommended)

---

## 🏗️ Test Organization

### File Structure

```
functions/src/
├── utilities/
│   ├── hashing/
│   │   ├── hasher.ts
│   │   ├── unhashing.ts
│   │   └── __tests__/
│   │       ├── hasher.test.ts          # 1:1 mapping
│   │       └── unhashing.test.ts       # 1:1 mapping
│   ├── logger/
│   │   ├── logger.ts
│   │   └── __tests__/
│   │       └── logger.test.ts
│   └── ...
├── services/
│   ├── UserService.ts
│   └── __tests__/
│       └── UserService.test.ts
```

**Rule:** Every source file should have a corresponding test file in a `__tests__` directory.

### Test File Structure

```typescript
/**
 * Tests for ModuleName
 *
 * Testing philosophy: Test WHAT, not HOW
 * - Focus on behavior and public contracts
 * - Mock only external dependencies
 * - Test both success and error paths
 */

import { ModuleName } from '../module-name';

// Mock external dependencies
jest.mock('external-package');

describe('ModuleName', () => {
  // Setup and teardown
  beforeEach(() => {
    // Arrange: Set up test state
  });

  afterEach(() => {
    // Cleanup
  });

  describe('methodName', () => {
    describe('success scenarios', () => {
      it('does X when Y', () => {
        // Test happy path
      });
    });

    describe('error scenarios', () => {
      it('throws Z when invalid input', () => {
        // Test error handling
      });
    });

    describe('edge cases', () => {
      it('handles null input gracefully', () => {
        // Test edge cases
      });
    });
  });
});
```

---

## 🔒 Security Testing

Security-critical code requires extra attention:

### PII Protection

```typescript
describe('Logger', () => {
  it('sanitizes PII fields in log output', () => {
    const logData = {
      email: 'user@example.com',
      password: 'secret123',
      ssn: '123-45-6789'
    };

    logger.info('User data', logData);

    const logOutput = mockGcpLogger.info.mock.calls[0][0];
    expect(logOutput.email).toBe('[REDACTED]');
    expect(logOutput.password).toBe('[REDACTED]');
    expect(logOutput.ssn).toBe('[REDACTED]');
  });
});
```

### Token Security

```typescript
describe('TokenHandler', () => {
  it('rejects blacklisted tokens', async () => {
    await tokenHandler.blacklistToken(validToken, 'user_logout');

    const result = await tokenHandler.verifyAndUnpack(validToken);

    expect(result.valid).toBe(false);
    expect(result.error).toContain('blacklisted');
  });
});
```

### Encryption

```typescript
describe('Hasher', () => {
  it('encrypts and decrypts data correctly', () => {
    const plaintext = 'sensitive-data';

    const encrypted = hasher.hash(plaintext);
    const decrypted = hasher.unhash(encrypted);

    expect(decrypted).toBe(plaintext);
    expect(encrypted).not.toBe(plaintext); // Never store plaintext
  });
});
```

---

## 📈 Current Test Statistics

**Test Suites:** 25 passed, 25 total
**Tests:** 807 passed, 807 total
**Execution Time:** ~35 seconds

### Breakdown by Module

**Core Utilities:**
- Hashing utilities: 175 tests
- Logger: 54 tests
- Event bus: 30 tests
- Address validation: 28 tests
- Token handler: 72 tests

**Infrastructure Connectors:**
- Firestore connector: 44 tests
- Firebase event bridge: 32 tests
- Realtime connector: 25 tests
- LLM connector: 24 tests

**Communication Connectors:**
- SMS connector: 24 tests
- Push notifications: 27 tests

**Business Connectors:**
- CRM connector: 26 tests
- Document connector: 28 tests
- Journey connector: 34 tests
- Survey connector: 28 tests
- Work management connector: 44 tests
- ERP connector: 42 tests

---

## 🚀 Running Tests

### Run All Tests

```bash
npm test
```

### Run Specific Test Suite

```bash
# By module
npm test -- --testPathPattern="utilities/hashing"
npm test -- --testPathPattern="services/UserService"

# By file
npm test -- hasher.test.ts
```

### Watch Mode

```bash
npm run test:watch
```

### Coverage Report

```bash
npm run test:coverage
```

### Run Only Changed Tests

```bash
npm test -- --onlyChanged
```

---

## 🎓 Examples from the Codebase

### Example 1: Testing Error Handling (Event Bus)

```typescript
describe('edge cases', () => {
  it('handles errors thrown by subscribers gracefully', () => {
    const errorHandler = jest.fn(() => {
      throw new Error('Handler error');
    });
    const workingHandler = jest.fn();

    eventBus.subscribe('error-event', errorHandler);
    eventBus.subscribe('error-event', workingHandler);

    // Should not throw - errors are swallowed
    expect(() => {
      eventBus.publish('error-event', { data: 'test' });
    }).not.toThrow();

    // Working handler should still be called
    expect(workingHandler).toHaveBeenCalled();
  });
});
```

**What this tests:**
- The event bus doesn't crash when a subscriber throws
- Other subscribers continue to execute
- Error handling is graceful

### Example 2: Testing PII Protection (Logger)

```typescript
describe('PII sanitization', () => {
  it('sanitizes all PII fields recursively', () => {
    const meta = {
      user: {
        email: 'test@example.com',
        ssn: '123-45-6789',
        nested: {
          password: 'secret'
        }
      }
    };

    logger.info('User action', meta);

    const logData = gcpLogger.info.mock.calls[0][0];
    expect(logData.context.user.email).toBe('[REDACTED]');
    expect(logData.context.user.ssn).toBe('[REDACTED]');
    expect(logData.context.user.nested.password).toBe('[REDACTED]');
  });
});
```

**What this tests:**
- No PII ever reaches the logs
- Sanitization works recursively on nested objects
- Security compliance is maintained

### Example 3: Testing Business Logic (CRM Connector)

```typescript
describe('createContact', () => {
  it('creates contact successfully', async () => {
    const contactData = {
      email: 'contact@example.com',
      firstName: 'John',
      lastName: 'Doe',
      company: 'Acme Corp'
    };

    const result = await crmConnector.createContact(contactData);

    expect(result.success).toBe(true);
    expect(result.contactId).toBeDefined();
    expect(mockProvider.createContact).toHaveBeenCalledWith(
      expect.objectContaining(contactData)
    );
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining('Contact created'),
      expect.any(Object)
    );
  });
});
```

**What this tests:**
- The connector fulfills its contract (returns success + ID)
- The provider is called with correct data
- Operations are logged for observability
- External behavior, not internal implementation

---

## 🛠️ Testing Utilities

### Test Helpers

Create reusable test helpers for common patterns:

```typescript
// test-helpers/factories.ts
export const createMockUser = (overrides = {}) => ({
  id: 'user-123',
  email: 'test@example.com',
  name: 'Test User',
  ...overrides
});

export const createMockFirestore = () => ({
  collection: jest.fn(() => mockCollection),
  runTransaction: jest.fn((callback) => callback(mockTransaction))
});
```

### Assertion Helpers

```typescript
// test-helpers/assertions.ts
export const expectPIIToBeRedacted = (logOutput, field) => {
  expect(logOutput[field]).toBe('[REDACTED]');
};

export const expectValidUserId = (userId) => {
  expect(userId).toBeDefined();
  expect(typeof userId).toBe('string');
  expect(userId.length).toBeGreaterThan(0);
};
```

---

## 📚 Additional Resources

- [Testing Best Practices](../../__docs__/test_suite_improvements.md)
- [Jest Documentation](https://jestjs.io/docs/getting-started)
- [Testing Library Principles](https://testing-library.com/docs/guiding-principles/)

---

## ✅ Checklist for New Tests

Before submitting a PR with new code, ensure:

- [ ] Test file created in `__tests__/` directory
- [ ] Test file name matches source file (`module.ts` → `module.test.ts`)
- [ ] All public methods have tests
- [ ] Both success and error paths tested
- [ ] Edge cases covered (null, undefined, empty, boundary values)
- [ ] Only external dependencies mocked
- [ ] Test names describe expected behavior
- [ ] AAA pattern followed (Arrange-Act-Assert)
- [ ] No shared state between tests
- [ ] Tests run fast (< 100ms per test ideally)
- [ ] All tests pass: `npm test`

---

**Remember:** The goal is confidence, not coverage. Write tests that give you confidence to ship to production.
