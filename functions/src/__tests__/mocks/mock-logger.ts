/**
 * Mock Logger
 * For testing without actual logging
 */

export interface MockLogger {
  debug: jest.Mock;
  info: jest.Mock;
  warn: jest.Mock;
  error: jest.Mock;
  setContext: jest.Mock;
  child: jest.Mock;
}

export const createMockLogger = (): MockLogger => {
  const logger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    setContext: jest.fn(),
    child: jest.fn(),
  };

  // child() should return another mock logger
  logger.child.mockReturnValue(logger);

  return logger;
};

/**
 * Reset all mock logger calls
 */
export const resetMockLogger = (logger: MockLogger) => {
  Object.values(logger).forEach(mock => {
    if (typeof mock.mockClear === 'function') {
      mock.mockClear();
    }
  });
};

/**
 * Assert logger was called with specific level and message
 */
export const expectLoggerCalled = (
  logger: MockLogger,
  level: 'debug' | 'info' | 'warn' | 'error',
  message: string | RegExp
) => {
  const calls = logger[level].mock.calls;
  const found = calls.some(call => {
    const msg = call[0];
    if (typeof message === 'string') {
      return msg === message;
    }
    return message.test(msg);
  });

  expect(found).toBe(true);
};
