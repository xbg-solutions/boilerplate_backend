# Middleware

> Express middleware pipeline for authentication, logging, validation, and error handling

## Overview

The middleware directory contains Express middleware functions that form the application's request/response processing pipeline. Each middleware handles a specific concern: authentication, CORS, error handling, logging, rate limiting, request ID tracking, and validation.

## Available Middleware

### auth.middleware.ts

Handles JWT authentication and authorization.

**Features:**
- Token extraction from Authorization header
- JWT verification via token handler
- User attachment to request
- Role-based access control (RBAC)
- Optional vs required authentication
- Custom claims support

**Usage:**
```typescript
import { createAuthMiddleware } from './middleware/auth.middleware';
import { tokenHandler } from './utilities/token-handler';

// Require authentication
router.get('/profile',
  createAuthMiddleware({ tokenHandler, required: true }),
  profileController.get
);

// Require admin role
router.delete('/users/:id',
  createAuthMiddleware({ tokenHandler, roles: ['admin'] }),
  userController.delete
);

// Optional authentication
router.get('/public',
  createAuthMiddleware({ tokenHandler, required: false }),
  publicController.get
);
```

**Gaps:**
- [ ] API key authentication
- [ ] OAuth2 token support
- [ ] Refresh token handling
- [ ] Session management
- [ ] Multi-tenancy support
- [ ] Permission-based authorization (beyond roles)

---

### cors.middleware.ts

Configures Cross-Origin Resource Sharing (CORS).

**Features:**
- Environment-aware origin configuration
- Credential support
- Allowed methods and headers
- Production vs development origins

**Configuration:**
```typescript
export const CORS_CONFIG = {
  development: {
    origin: ['http://localhost:3000', 'http://localhost:5173'],
    credentials: true,
  },
  production: {
    origin: [process.env.WEB_APP_URL || 'https://example.com'],
    credentials: true,
  },
};
```

**Gaps:**
- [ ] Dynamic origin validation
- [ ] Preflight caching configuration
- [ ] Wildcard subdomain support
- [ ] Per-route CORS settings

---

### error.middleware.ts

Centralized error handling with standardized responses.

**Features:**
- AppError detection and handling
- Operational vs programming error distinction
- Error response formatting
- Stack trace sanitization in production
- Structured logging integration
- HTTP status code mapping

**Usage:**
```typescript
// Automatically catches errors from routes
app.use(errorMiddleware);

// Works with custom errors
throw new NotFoundError('User');
throw new ValidationError('Email is required');
```

**Response Format:**
```typescript
{
  success: false,
  error: {
    code: 'NOT_FOUND',
    message: 'User not found',
    details: { /* optional */ }
  }
}
```

**Gaps:**
- [ ] Error codes internationalization
- [ ] Error tracking integration (Sentry, Rollbar)
- [ ] Custom error pages
- [ ] Error rate limiting
- [ ] Client error vs server error metrics
- [ ] Error context (request ID, user ID, etc.)

---

### logging.middleware.ts

Request/response logging with PII protection.

**Features:**
- Request logging (method, path, query params)
- Response logging (status code, duration)
- Performance metrics
- PII-safe logging (masks sensitive data)
- Request correlation ID tracking
- Error logging

**Log Output:**
```
[INFO] HTTP Request: GET /api/users?limit=10
[INFO] HTTP Response: GET /api/users - 200 (45ms)
[ERROR] HTTP Error: POST /api/users - 400 (12ms) - Validation failed
```

**Gaps:**
- [ ] Configurable log levels per route
- [ ] Request/response body logging (optional)
- [ ] Slow request warnings
- [ ] Log sampling for high-traffic routes
- [ ] Structured log filtering
- [ ] Log aggregation integration

---

### rateLimit.middleware.ts

Rate limiting to prevent abuse.

**Features:**
- Per-IP rate limiting
- Per-user rate limiting
- Configurable time windows
- Configurable request limits
- Skip whitelisted IPs
- Rate limit headers in response

**Configuration:**
```typescript
export const RATE_LIMIT_CONFIG = {
  perIP: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // 100 requests per window
  },
  perUser: {
    windowMs: 15 * 60 * 1000,
    max: 1000,
  },
  whitelist: ['127.0.0.1'],
};
```

**Usage:**
```typescript
// Apply globally
app.use(createRateLimitMiddleware());

// Apply to specific routes
router.post('/api/auth/login',
  createRateLimitMiddleware({ max: 5, windowMs: 15 * 60 * 1000 }),
  authController.login
);
```

**Gaps:**
- [ ] Redis-based distributed rate limiting
- [ ] Dynamic rate limits based on user tier
- [ ] Rate limit by API endpoint
- [ ] Burst allowance
- [ ] Rate limit bypass for internal services
- [ ] Custom rate limit responses
- [ ] Rate limit analytics

---

### requestId.middleware.ts

Assigns unique ID to each request for tracing.

**Features:**
- UUID generation for each request
- Header-based request ID (if provided)
- Request ID in response headers
- Request ID in logs
- Distributed tracing support

**Usage:**
```typescript
app.use(requestIdMiddleware);

// Request ID available in logs
logger.info('Processing request', { requestId: req.id });

// Response includes X-Request-ID header
```

**Gaps:**
- [ ] Correlation ID propagation to external services
- [ ] Parent/child request relationships
- [ ] Trace context (OpenTelemetry)
- [ ] Request ID in error messages

---

### validation.middleware.ts

Request validation using express-validator.

**Features:**
- Body, query, param validation
- Custom validators
- Sanitization
- Error formatting
- Integration with custom errors

**Usage:**
```typescript
import { body, query } from 'express-validator';
import { validateRequest } from './middleware/validation.middleware';

router.post('/users',
  body('email').isEmail().normalizeEmail(),
  body('name').isLength({ min: 2, max: 100 }),
  body('age').optional().isInt({ min: 18 }),
  validateRequest,
  userController.create
);
```

**Gaps:**
- [ ] Schema-based validation (JSON Schema, Yup)
- [ ] Async validators
- [ ] Conditional validation
- [ ] Cross-field validation
- [ ] Custom error messages per validator
- [ ] Validation caching

---

## Middleware Pipeline Order

**Critical:** Middleware order matters! Use this recommended order:

```typescript
// 1. Request ID (must be first for logging)
app.use(requestIdMiddleware);

// 2. Logging (log all requests)
app.use(loggingMiddleware);

// 3. Security headers (Helmet)
app.use(helmet());

// 4. CORS
app.use(corsMiddleware);

// 5. Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 6. Rate limiting
app.use(rateLimitMiddleware);

// 7. Routes
app.use('/api', routes);

// 8. Error handling (must be last)
app.use(errorMiddleware);
```

## Known Gaps & Future Enhancements

### Missing Middleware
- [ ] **Compression** middleware for response compression
- [ ] **Cache** middleware for caching responses
- [ ] **Helmet** security headers configuration
- [ ] **Body size limit** enforcement
- [ ] **Request timeout** handling
- [ ] **API versioning** middleware
- [ ] **Feature flags** middleware
- [ ] **A/B testing** middleware
- [ ] **Maintenance mode** middleware
- [ ] **IP geolocation** middleware
- [ ] **User agent parsing** middleware
- [ ] **File upload** handling

### Testing Gaps
- [ ] Unit tests for each middleware
- [ ] Integration tests for middleware chain
- [ ] Performance benchmarks
- [ ] Edge case testing

### Configuration Gaps
- [ ] Per-environment middleware configuration
- [ ] Dynamic middleware loading
- [ ] Middleware disable/enable flags
- [ ] Middleware ordering configuration

### Monitoring Gaps
- [ ] Middleware execution time metrics
- [ ] Error rate by middleware
- [ ] Rate limit hit tracking
- [ ] Authentication failure metrics

## Best Practices

1. **Order matters**: Always follow the recommended middleware order
2. **Error handling last**: Error middleware must be registered after routes
3. **Async errors**: Use async error wrapper for async route handlers
4. **Selective application**: Apply middleware only where needed
5. **Performance**: Monitor middleware execution time
6. **Testing**: Test middleware in isolation and integration

## Common Patterns

### Async Error Wrapper

```typescript
const asyncHandler = (fn: Function) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

router.get('/users', asyncHandler(async (req, res) => {
  const users = await userService.getAll();
  res.json({ success: true, data: users });
}));
```

### Conditional Middleware

```typescript
const conditionalAuth = (req: Request, res: Response, next: NextFunction) => {
  if (req.path.startsWith('/public')) {
    return next();
  }
  return authMiddleware(req, res, next);
};
```

### Middleware Composition

```typescript
const requireAdmin = [
  authMiddleware,
  roleMiddleware(['admin']),
  auditMiddleware,
];

router.delete('/users/:id', ...requireAdmin, userController.delete);
```

## Related Components

- **utilities/errors**: Error types used by error middleware
- **utilities/logger**: Logger used by logging middleware
- **utilities/token-handler**: JWT handling for auth middleware
- **config/**: Configuration for all middleware

## Support

For issues or questions:
- Check middleware order in app.ts
- Review middleware configuration files
- Verify environment variables
- Check logs for middleware errors

## References

- [Express Middleware Guide](https://expressjs.com/en/guide/using-middleware.html)
- [Error Handling in Express](https://expressjs.com/en/guide/error-handling.html)
- [express-validator Documentation](https://express-validator.github.io/docs/)
