# Error Utilities

> Typed error classes for consistent error handling across the application

## Overview

The Error Utilities provide a standardized error hierarchy for the application. All errors extend from a base `AppError` class, making error handling consistent and predictable across controllers, services, and middleware.

## Features

- **Base error class** (`AppError`) with consistent properties
- **HTTP status codes** automatically assigned to error types
- **Operational vs Programming errors** distinction
- **Error details** support for additional context
- **Stack trace preservation** for debugging
- **TypeScript support** with proper prototype chain

## Installation

```typescript
import {
  AppError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  InternalServerError,
} from '../utilities/errors';
```

## Available Error Types

### AppError (Base Class)

The foundation for all application errors.

```typescript
class AppError extends Error {
  statusCode: number;
  isOperational: boolean;
  details?: unknown;
}
```

**Properties:**
- `statusCode`: HTTP status code (400, 401, 404, 500, etc.)
- `isOperational`: `true` for expected errors, `false` for programming errors
- `details`: Optional additional context about the error
- `message`: Error message (inherited from Error)
- `stack`: Stack trace (inherited from Error)

### ValidationError (400 Bad Request)

Use when client sends invalid data.

```typescript
throw new ValidationError('Email is required', {
  field: 'email',
  value: null,
});
```

### UnauthorizedError (401 Unauthorized)

Use when authentication is required or has failed.

```typescript
throw new UnauthorizedError('Invalid token');
throw new UnauthorizedError(); // Default: "Unauthorized"
```

### ForbiddenError (403 Forbidden)

Use when user is authenticated but lacks permissions.

```typescript
throw new ForbiddenError('Admin access required');
throw new ForbiddenError(); // Default: "Forbidden"
```

### NotFoundError (404 Not Found)

Use when a requested resource doesn't exist.

```typescript
throw new NotFoundError('User'); // Message: "User not found"
throw new NotFoundError('Order'); // Message: "Order not found"
```

### ConflictError (409 Conflict)

Use when request conflicts with current state.

```typescript
throw new ConflictError('Email already exists');
throw new ConflictError('Cannot delete user with active orders');
```

### InternalServerError (500 Internal Server Error)

Use for unexpected server errors.

```typescript
throw new InternalServerError('Database connection failed', {
  error: dbError,
});
```

**Note:** `InternalServerError` has `isOperational: false` by default.

## Usage Examples

### In Services

```typescript
class UserService {
  async getUser(id: string): Promise<User> {
    const user = await this.repository.findById(id);

    if (!user) {
      throw new NotFoundError('User');
    }

    return user;
  }

  async createUser(data: CreateUserDto): Promise<User> {
    // Validate input
    if (!data.email) {
      throw new ValidationError('Email is required', {
        field: 'email',
      });
    }

    // Check for conflicts
    const existing = await this.repository.findByEmail(data.email);
    if (existing) {
      throw new ConflictError('Email already exists');
    }

    return await this.repository.create(data);
  }

  async deleteUser(id: string, requestingUserId: string): Promise<void> {
    const user = await this.getUser(id);

    // Check permissions
    if (user.id !== requestingUserId && !user.isAdmin) {
      throw new ForbiddenError('Cannot delete other users');
    }

    await this.repository.delete(id);
  }
}
```

### In Middleware

```typescript
import { AppError } from '../utilities/errors';

export const errorHandler = (
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  if (err instanceof AppError) {
    // Operational error - send to client
    return res.status(err.statusCode).json({
      success: false,
      message: err.message,
      details: err.details,
    });
  }

  // Programming error - log and hide details
  logger.error('Unhandled error', err);
  return res.status(500).json({
    success: false,
    message: 'Internal server error',
  });
};
```

### In Controllers

```typescript
class UserController {
  async getUser(req: Request, res: Response): Promise<void> {
    try {
      const user = await this.service.getUser(req.params.id);
      res.json({ success: true, data: user });
    } catch (error) {
      // Errors are caught by error middleware
      throw error;
    }
  }
}
```

### With Async Error Handling

```typescript
// Wrap async route handlers to catch errors
const asyncHandler = (fn: Function) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

// Usage
router.get('/users/:id', asyncHandler(async (req, res) => {
  const user = await userService.getUser(req.params.id);
  res.json({ success: true, data: user });
}));
```

## Operational vs Programming Errors

### Operational Errors (`isOperational: true`)

Expected errors that are part of normal application flow:
- Invalid user input (ValidationError)
- Resource not found (NotFoundError)
- Authentication failures (UnauthorizedError)
- Permission issues (ForbiddenError)
- Business rule violations (ConflictError)

**Handling:** Send error to client, continue application

### Programming Errors (`isOperational: false`)

Unexpected errors indicating bugs:
- InternalServerError
- Unhandled exceptions
- Type errors
- Reference errors

**Handling:** Log error, optionally restart application

## Error Details

Use the `details` field to provide additional context:

```typescript
throw new ValidationError('Validation failed', {
  errors: [
    { field: 'email', message: 'Invalid format' },
    { field: 'age', message: 'Must be at least 18' },
  ],
});

throw new InternalServerError('External service failure', {
  service: 'payment-gateway',
  statusCode: 503,
  retryable: true,
});
```

## Best Practices

1. **Use specific error types**: Don't throw generic `Error`, use typed errors
2. **Provide context**: Use `details` field for debugging information
3. **Don't expose internals**: Sanitize error messages sent to clients
4. **Log programming errors**: Always log unexpected errors with full details
5. **Handle in middleware**: Let error middleware handle error responses
6. **Document error cases**: Document which errors each function can throw

## Known Gaps & Future Enhancements

### Missing Error Types
- [ ] **BadRequestError (400)**: Generic bad request (distinct from validation)
- [ ] **PaymentRequiredError (402)**: Payment/subscription required
- [ ] **MethodNotAllowedError (405)**: HTTP method not allowed
- [ ] **RequestTimeoutError (408)**: Request timeout
- [ ] **TooManyRequestsError (429)**: Rate limit exceeded
- [ ] **ServiceUnavailableError (503)**: Service temporarily unavailable
- [ ] **GatewayTimeoutError (504)**: Gateway/upstream timeout

### Missing Features
- [ ] **Error codes**: Unique error codes for client-side handling
- [ ] **Internationalization**: Error message translations
- [ ] **Error aggregation**: Combine multiple errors (e.g., batch validation)
- [ ] **Error serialization**: Custom JSON serialization
- [ ] **Error recovery**: Retry strategies for recoverable errors
- [ ] **Error context**: Request context (user ID, request ID, etc.)
- [ ] **Error tracking integration**: Sentry, Rollbar, etc.
- [ ] **Error metrics**: Count errors by type, endpoint, etc.

### Testing Gaps
- [ ] Unit tests for each error type
- [ ] Tests for prototype chain correctness
- [ ] Tests for stack trace preservation
- [ ] Integration tests with error middleware

### Documentation Gaps
- [ ] Error response format documentation
- [ ] API documentation with error examples
- [ ] Error handling guide for developers
- [ ] Common error scenarios and solutions

### Monitoring Gaps
- [ ] Error rate monitoring
- [ ] Error alerting thresholds
- [ ] Error distribution dashboards
- [ ] Client-side error tracking

## Integration with Error Middleware

The error middleware (see `functions/src/middleware/error.middleware.ts`) handles AppError instances:

```typescript
// Error middleware automatically:
// 1. Checks if error is AppError instance
// 2. Uses statusCode from error
// 3. Sends appropriate response
// 4. Logs errors appropriately
// 5. Sanitizes error details in production
```

## TypeScript Support

All error classes maintain proper prototype chains for `instanceof` checks:

```typescript
try {
  // Some operation
} catch (error) {
  if (error instanceof ValidationError) {
    // Handle validation error
  } else if (error instanceof NotFoundError) {
    // Handle not found
  } else if (error instanceof AppError) {
    // Handle other app errors
  } else {
    // Handle unknown errors
  }
}
```

## Related Components

- **error.middleware.ts**: Error handling middleware
- **logger**: Structured logging for errors
- **validation**: Input validation that throws ValidationError

## Support

For issues or questions:
- Review error middleware implementation
- Check error logs for stack traces
- Ensure proper error propagation in async code
- Verify error middleware is registered last

## References

- [HTTP Status Codes](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status)
- [Node.js Error Handling Best Practices](https://nodejs.org/api/errors.html)
- [Express Error Handling](https://expressjs.com/en/guide/error-handling.html)
