---
description: "API layer for the XBG boilerplate backend: implementing controllers with BaseController, registering routes, adding middleware, response shapes, and wiring up functions/src/index.ts."
---

# XBG Boilerplate Backend — API Layer

Covers: `BaseController`, custom routes, middleware pipeline, response shapes, registering controllers in `index.ts`, and the Express app setup.

All base classes and middleware are imported from `@xbg.solutions/backend-core`.

---

## BaseController — HTTP Layer

**Package:** `@xbg.solutions/backend-core`

Controllers handle HTTP: extract request data, delegate to service, format response. No business logic here.

### Implementing a Controller

```typescript
import { Request, Response, NextFunction } from 'express';
import { BaseController, ApiResponse, requiredAuth, requireAdmin } from '@xbg.solutions/backend-core';
import { Product } from '../entities/Product';
import { ProductService } from '../services/ProductService';
import { tokenHandler } from '@xbg.solutions/utils-token-handler';

export class ProductController extends BaseController<Product> {
  constructor(private productService: ProductService) {
    super(productService, '/products');  // second arg = base path for this resource
  }

  // Override to add custom routes ON TOP of the default CRUD routes
  protected registerRoutes(): void {
    super.registerRoutes();  // ← registers GET /, GET /:id, POST /, PUT /:id, DELETE /:id

    // Add auth middleware to writes
    this.router.post('/', requiredAuth(tokenHandler), this.handleCreate.bind(this));
    this.router.put('/:id', requireAdmin(tokenHandler), this.handleUpdate.bind(this));
    this.router.delete('/:id', requireAdmin(tokenHandler), this.handleDelete.bind(this));

    // Custom domain action
    this.router.post(
      '/:id/archive',
      requireAdmin(tokenHandler),
      this.handleArchive.bind(this)
    );

    // Custom query endpoint
    this.router.get(
      '/by-category/:categoryId',
      this.handleFindByCategory.bind(this)
    );
  }

  private async handleArchive(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const context = this.createContext(req);
      const { id } = req.params;

      const result = await this.productService.archiveProduct(id, context);

      if (result.success && result.data) {
        this.sendSuccess(res, result.data, 200, context.requestId);
      } else {
        this.sendError(res, result.error!, context.requestId);
      }
    } catch (error) {
      next(error);
    }
  }

  private async handleFindByCategory(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const context = this.createContext(req);
      const { categoryId } = req.params;

      const result = await this.productService.findByCategory(categoryId, context);

      if (result.success && result.data) {
        this.sendSuccess(res, result.data, 200, context.requestId);
      } else {
        this.sendError(res, result.error!, context.requestId);
      }
    } catch (error) {
      next(error);
    }
  }
}
```

### Default Routes (from BaseController.registerRoutes)

| Method | Path | Handler |
|---|---|---|
| `POST` | `/` | `handleCreate` → `service.create(req.body, context)` |
| `GET` | `/` | `handleFindAll` → `service.findAll(options, context)` or `findPaginated` if `?page=N` |
| `GET` | `/:id` | `handleFindById` → `service.findById(id, context)` |
| `PUT` | `/:id` | `handleUpdate` → `service.update(id, req.body, context)` |
| `PATCH` | `/:id` | `handleUpdate` (same handler) |
| `DELETE` | `/:id` | `handleDelete` → `service.delete(id, context, hardDelete?)` |

### Query String Parsing (handleFindAll)

```
GET /api/v1/products?limit=20&offset=0&orderBy=price:asc,name:desc&where=status:==:active&page=2&pageSize=10
```

- `limit`, `offset`: pagination
- `orderBy`: `field:direction` comma-separated
- `where`: `field:operator:value` comma-separated (multiple: repeat param)
- `page` + `pageSize`: triggers `findPaginated` instead of `findAll`
- `?hard=true`: on DELETE, triggers hard delete

---

## Response Shapes

All controllers inherit these helpers:

### Success Response

```typescript
this.sendSuccess(res, data, 200, context.requestId);
```

```json
{
  "success": true,
  "data": { "id": "...", "name": "Widget", "price": 9.99 },
  "metadata": {
    "requestId": "req-abc-123",
    "timestamp": "2025-03-01T12:00:00.000Z",
    "version": "1.0.0"
  }
}
```

### Paginated Success Response

```typescript
this.sendPaginatedSuccess(res, { data, total, page, pageSize, hasMore }, context.requestId);
```

```json
{
  "success": true,
  "data": [...],
  "pagination": {
    "page": 2,
    "pageSize": 20,
    "total": 147,
    "hasMore": true
  },
  "metadata": { ... }
}
```

### Error Response

```typescript
this.sendError(res, { code: 'NOT_FOUND', message: 'Product not found', details: { id } }, context.requestId);
```

```json
{
  "success": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "Product not found",
    "details": { "id": "prod-123" }
  },
  "metadata": { ... }
}
```

### Error Code → HTTP Status Mapping

| Code | HTTP |
|---|---|
| `NOT_FOUND` | 404 |
| `FORBIDDEN` | 403 |
| `UNAUTHORIZED` | 401 |
| `VALIDATION_ERROR` | 400 |
| `CONFLICT` | 409 |
| `INTERNAL_ERROR` | 500 |
| `UNKNOWN_ERROR` | 500 |

---

## Registering Controllers

**File:** `functions/src/index.ts` (in your generated project)

This is the Firebase Functions entry point. Add your controllers here.

```typescript
import * as functions from 'firebase-functions';
import { createApp, getFirestoreDb } from '@xbg.solutions/backend-core';
import { logger } from '@xbg.solutions/utils-logger';

// 1. Import your generated/custom controllers
import { ProductController } from './generated/controllers/ProductController';
import { OrderController } from './orders/OrderController';

// 2. Import services and repositories
import { ProductRepository } from './generated/repositories/ProductRepository';
import { ProductService } from './generated/services/ProductService';
import { OrderRepository } from './orders/OrderRepository';
import { OrderService } from './orders/OrderService';

function initializeControllers(): Array<{ getRouter: () => any; getBasePath: () => string }> {
  const db = getFirestoreDb('main');

  // Wire up the dependency graph
  const productRepo = new ProductRepository(db);
  const productService = new ProductService(productRepo);
  const productController = new ProductController(productService);

  const orderRepo = new OrderRepository(db);
  const orderService = new OrderService(orderRepo, productService);
  const orderController = new OrderController(orderService);

  return [productController, orderController];
}

const expressApp = createApp({
  controllers: initializeControllers(),
});

export const api = functions.https.onRequest(expressApp);
```

The `api` export becomes your Cloud Function. All routes are mounted under `API_BASE_PATH` (default `/api/v1`):

- `GET /api/v1/products` → `ProductController`
- `GET /api/v1/orders` → `OrderController`

---

## Express App & Middleware Pipeline

**Package:** `@xbg.solutions/backend-core` (`createApp`)

### Middleware Stack (Order is Critical)

```
1.  app.set('trust proxy', 1)              ← real IP (1 hop behind Google's LB)
2.  helmet()                               ← security headers (all environments)
3.  createCorsMiddleware()                 ← CORS from CORS_ORIGINS env
4.  requestIdMiddleware()                  ← X-Request-ID header
5.  requestLoggingMiddleware()             ← logs all requests
6.  express.json({ limit: '10mb' })       ← parse JSON bodies
7.  express.urlencoded({ extended: true }) ← parse form bodies
8.  sanitizeBody()                         ← strip dangerous chars
9.  createRateLimiter()                    ← rate limiting (non-dev only)
10. /health, /health/ready routes
11. apiRouter (your controllers)
12. notFoundHandler()                      ← 404 for unmatched routes
13. errorHandler()                         ← global error handler (MUST be last)
```

### Adding Middleware to Specific Route Groups

```typescript
// In your controller, you can scope middleware to specific routes:
protected registerRoutes(): void {
  super.registerRoutes();

  // Add auth to all write operations in this controller
  this.router.use((req, res, next) => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      requiredAuth(tokenHandler)(req, res, next);
    } else {
      next();
    }
  });
}
```

Or apply per-route as shown in the controller example above.

### Health Endpoints (Built-In)

```
GET /health         → { success: true, data: { status: 'healthy', timestamp } }
                      (version and environment included in non-production only)
GET /health/ready   → { success: true, data: { status: 'ready', checks: { database: 'ok' } } }
```

Use `/health/ready` for Kubernetes liveness/readiness probes and Firebase healthcheck config.

---

## Validation Middleware

**Package:** `@xbg.solutions/backend-core` (middleware exports)

Add request body validation using `express-validator` in your routes:

```typescript
import { body, validationResult } from 'express-validator';

// Define validation rules
const createProductValidation = [
  body('name').isString().isLength({ min: 3, max: 100 }),
  body('price').isFloat({ min: 0.01 }),
  body('categoryId').isString().notEmpty(),
  body('status').optional().isIn(['active', 'archived']),
];

// In registerRoutes():
this.router.post(
  '/',
  requiredAuth(tokenHandler),
  ...createProductValidation,
  this.validateRequest.bind(this),  // included in BaseController
  this.handleCreate.bind(this)
);
```

---

## CORS Configuration

Configured via `CORS_ORIGINS` environment variable:

```bash
# .env
CORS_ORIGINS=http://localhost:5173,http://localhost:3000,https://myapp.com
```

In development, all origins are allowed. In production, only listed origins.

---

## Handling File Uploads

Not yet built into the boilerplate. Pattern to add:

```typescript
import multer from 'multer';
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// In registerRoutes():
this.router.post(
  '/:id/image',
  requiredAuth(tokenHandler),
  upload.single('image'),
  this.handleUploadImage.bind(this)
);

private async handleUploadImage(req: Request, res: Response, next: NextFunction): Promise<void> {
  // req.file is the uploaded file buffer
}
```

---

## Anti-Examples

```typescript
// ❌ Don't put business logic in controllers
private async handleCreate(req: Request, res: Response): Promise<void> {
  const product = new Product(req.body);
  product.status = 'active';  // ← business logic — belongs in service.beforeCreate()
  await productRepo.create(product);  // ← bypass service — don't do this
  res.json(product);
}

// ✅ Delegate everything to the service
private async handleCreate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const context = this.createContext(req);
    const result = await this.service.create(req.body, context);
    if (result.success) {
      this.sendSuccess(res, result.data!, 201, context.requestId);
    } else {
      this.sendError(res, result.error!, context.requestId);
    }
  } catch (error) {
    next(error);  // ← always pass unexpected errors to next()
  }
}

// ❌ Don't forget next(error) in try/catch — unhandled errors crash the function
private async handleCreate(req: Request, res: Response): Promise<void> {
  try { ... } catch (error) {
    res.status(500).json({ error: 'Something went wrong' });  // ← doesn't use errorHandler
  }
}

// ❌ Don't add controllers to app.use() directly — use initializeControllers() in index.ts
app.use('/products', new ProductController(service).getRouter());  // wrong place

// ❌ Don't hardcode status codes
res.status(200).json({ ... });   // use this.sendSuccess() which handles 200 vs 201

// ❌ Don't return responses without the standard shape
res.json({ product: data });     // clients expect { success, data, metadata }
// ✅
this.sendSuccess(res, data, 200, context.requestId);
```
