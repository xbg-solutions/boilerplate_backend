/**
 * Test Helpers
 * Common utilities for unit tests
 */

/**
 * Wait for a specified time
 */
export const wait = (ms: number): Promise<void> => {
  return new Promise(resolve => setTimeout(resolve, ms));
};

/**
 * Create a spy that returns a resolved promise
 */
export const createResolvedSpy = <T>(value: T) => {
  return jest.fn().mockResolvedValue(value);
};

/**
 * Create a spy that returns a rejected promise
 */
export const createRejectedSpy = (error: Error) => {
  return jest.fn().mockRejectedValue(error);
};

/**
 * Suppress console output during tests
 */
export const suppressConsole = () => {
  beforeAll(() => {
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
    jest.spyOn(console, 'warn').mockImplementation();
    jest.spyOn(console, 'info').mockImplementation();
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });
};

/**
 * Create a mock function that tracks calls
 */
export const createMockFn = <T extends (...args: any[]) => any>() => {
  const calls: Parameters<T>[] = [];
  const fn = jest.fn((...args: Parameters<T>) => {
    calls.push(args);
  });

  return {
    fn,
    calls,
    reset: () => {
      calls.length = 0;
      fn.mockClear();
    },
  };
};

/**
 * Assert that a promise rejects with a specific error
 */
export const expectToReject = async (
  promise: Promise<any>,
  errorMessage?: string | RegExp
) => {
  await expect(promise).rejects.toThrow(errorMessage);
};

/**
 * Assert that a promise resolves successfully
 */
export const expectToResolve = async <T>(promise: Promise<T>): Promise<T> => {
  return await expect(promise).resolves.toBeDefined();
};

/**
 * Create a partial mock of an object
 */
export const createPartialMock = <T extends object>(
  partial: Partial<T>
): jest.Mocked<T> => {
  return partial as jest.Mocked<T>;
};

/**
 * Mock Date.now() to return a fixed timestamp
 */
export const mockDateNow = (timestamp: number) => {
  const original = Date.now;

  beforeAll(() => {
    Date.now = jest.fn(() => timestamp);
  });

  afterAll(() => {
    Date.now = original;
  });
};

/**
 * Create a mock timer and fast-forward time
 */
export const useFakeTimers = () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  return {
    advance: (ms: number) => jest.advanceTimersByTime(ms),
    runAll: () => jest.runAllTimers(),
    runPending: () => jest.runOnlyPendingTimers(),
  };
};
