---
description: "Services layer for the XBG boilerplate backend: implementing BaseService, lifecycle hooks, access control, event bus publishing and subscribing, and auth patterns."
---

# XBG Boilerplate Backend — Services Layer

Covers: `BaseService`, lifecycle hooks, access control, events (`eventBus`, `EventType`), and auth middleware patterns.

All base classes are imported from `@xbg.solutions/backend-core`. Events from `@xbg.solutions/utils-events`.

---

## BaseService — Business Logic Layer

**Package:** `@xbg.solutions/backend-core`

Services sit between controllers and repositories. They own:
- Business validation (beyond field-level validation)
- Authorization / access control
- Pre/post operation hooks
- Event publishing
- Orchestration across multiple repositories

### Implementing a Service

```typescript
import { BaseService, RequestContext, ServiceResult } from '@xbg.solutions/backend-core';
import { Product } from '../entities/Product';
import { ProductRepository } from '../repositories/ProductRepository';
import { eventBus, EventType } from '@xbg.solutions/utils-events';

export class ProductService extends BaseService<Product> {
  protected entityName = 'Product';

  constructor(private productRepo: ProductRepository) {
    super(productRepo);
  }

  // REQUIRED: build a new entity instance from raw data
  protected async buildEntity(data: Partial<Product>): Promise<Product> {
    return new Product({
      name: data.name ?? '',
      price: data.price ?? 0,
      status: data.status ?? 'active',
      categoryId: data.categoryId ?? '',
    });
  }

  // REQUIRED: apply partial updates to an existing entity
  protected async mergeEntity(existing: Product, updates: Partial<Product>): Promise<Product> {
    if (updates.name !== undefined) existing.name = updates.name;
    if (updates.price !== undefined) existing.price = updates.price;
    if (updates.status !== undefined) existing.status = updates.status;
    if (updates.categoryId !== undefined) existing.categoryId = updates.categoryId;
    return existing;
  }
}
```

### Core Methods (from BaseService — don't re-implement unless overriding)

```typescript
await service.create(data, context);              // validates, creates, fires afterCreate, publishes event
await service.findById(id, context);              // fetches + checks read access
await service.findAll(options, context);          // applies user filters + fetches
await service.findPaginated(page, size, opts, context);
await service.update(id, data, context);          // checks update access, merges, saves, publishes event
await service.delete(id, context, hardDelete?);   // checks delete access, deletes, publishes event
```

All return `ServiceResult<T>`:

```typescript
interface ServiceResult<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;     // 'NOT_FOUND' | 'FORBIDDEN' | 'VALIDATION_ERROR' | 'INTERNAL_ERROR'
    message: string;
    details?: Record<string, any>;
  };
}
```

---

## Lifecycle Hooks

Override any hook in your service to add custom logic. All hooks are no-ops in the base class.

```typescript
export class ProductService extends BaseService<Product> {
  protected entityName = 'Product';

  // Called BEFORE create — good for business validation, data enrichment
  protected async beforeCreate(data: Partial<Product>, context: RequestContext): Promise<void> {
    // Example: validate that the category exists
    const category = await this.categoryRepo.findById(data.categoryId!);
    if (!category) {
      throw new Error('Category does not exist');
    }
  }

  // Called AFTER create — good for side effects, notifications
  protected async afterCreate(entity: Product, context: RequestContext): Promise<void> {
    // Example: update category product count
    await this.categoryRepo.incrementProductCount(entity.categoryId);
  }

  // Called BEFORE update — good for business rule enforcement
  protected async beforeUpdate(
    existing: Product,
    data: Partial<Product>,
    context: RequestContext
  ): Promise<void> {
    // Example: prevent price change if product has pending orders
    if (data.price !== undefined && data.price !== existing.price) {
      const pendingOrders = await this.orderRepo.countPendingForProduct(existing.id!);
      if (pendingOrders > 0) {
        throw new Error('Cannot change price while orders are pending');
      }
    }
  }

  // Called AFTER update
  protected async afterUpdate(entity: Product, context: RequestContext): Promise<void> {
    // Publish price change notification, etc.
  }

  // Called BEFORE delete
  protected async beforeDelete(entity: Product, context: RequestContext): Promise<void> {
    // Example: check for dependencies before deletion
    const orderCount = await this.orderRepo.countForProduct(entity.id!);
    if (orderCount > 0) {
      throw new Error('Cannot delete product with existing orders');
    }
  }

  // Called AFTER delete
  protected async afterDelete(entity: Product, context: RequestContext): Promise<void> {
    // Cleanup: remove product from search index, etc.
  }

  // ... buildEntity, mergeEntity
}
```

**Hook error handling:** If a hook throws, the operation fails and returns `{ success: false, error: { code: 'INTERNAL_ERROR', message: ... } }`. The exception is logged.

---

## Access Control

Override the check methods to implement authorization. Default is open (returns `true`).

```typescript
export class ProductService extends BaseService<Product> {
  protected entityName = 'Product';

  // Who can read this product?
  protected async checkReadAccess(entity: Product, context: RequestContext): Promise<boolean> {
    // Public products: anyone
    if (entity.status === 'active') return true;
    // Archived products: admin only
    return context.userRole === 'admin';
  }

  // Who can update this product?
  protected async checkUpdateAccess(entity: Product, context: RequestContext): Promise<boolean> {
    return context.userRole === 'admin';
  }

  // Who can delete this product?
  protected async checkDeleteAccess(entity: Product, context: RequestContext): Promise<boolean> {
    return context.userRole === 'admin';
  }

  // Apply query-level filtering (e.g., show only user's own items)
  protected async applyUserFilters(
    options: QueryOptions,
    context: RequestContext
  ): Promise<QueryOptions> {
    if (context.userRole !== 'admin') {
      // Non-admins only see active products
      return {
        ...options,
        where: [
          ...(options.where ?? []),
          { field: 'status', operator: '==', value: 'active' },
        ],
      };
    }
    return options;
  }
}
```

### RequestContext

Every service method receives a `RequestContext` populated by the controller:

```typescript
interface RequestContext {
  requestId: string;       // Correlation ID from X-Request-ID header
  userId?: string;         // Firebase Auth UID (undefined if unauthenticated)
  userRole?: string;       // Custom claim role (e.g., 'admin', 'user')
  timestamp: Date;
  metadata?: {
    ip?: string;
    userAgent?: string;
  };
}
```

---

## Event Bus

**Package:** `@xbg.solutions/utils-events`

The event bus is a singleton Node.js `EventEmitter`. Services publish events; subscribers react to them.

### Publishing Events (in Services)

`BaseService.publishEvent()` handles this automatically on create/update/delete. For custom events:

```typescript
import { eventBus, EventType } from '@xbg.solutions/utils-events';

// In your service method:
eventBus.publish(EventType.USER_CREATED, {
  userUID: user.id!,
  email: user.email,
});
```

### Adding Event Types

Add new events to `@xbg.solutions/utils-events` event types (or extend locally in your project):

```typescript
// In EventType enum:
PRODUCT_PRICE_CHANGED = 'product.price_changed',
INVENTORY_LOW = 'inventory.low',

// Add payload interface:
export interface ProductPriceChangedPayload extends BaseEventPayload {
  productUID: string;
  oldPrice: number;
  newPrice: number;
  changedBy: string;
}

// Add to EventPayloadMap:
export interface EventPayloadMap {
  [EventType.PRODUCT_PRICE_CHANGED]: ProductPriceChangedPayload;
  // ...
}
```

### Subscribing to Events

Register subscribers in your project's `src/subscribers/` directory or at app startup:

```typescript
import { eventBus, EventType, ProductPriceChangedPayload } from '@xbg.solutions/utils-events';
import { emailConnector } from '@xbg.solutions/utils-email-connector';

// Register in subscribers/product-subscribers.ts
export function registerProductSubscribers(): void {
  eventBus.subscribe<ProductPriceChangedPayload>(
    EventType.PRODUCT_PRICE_CHANGED,
    async (payload) => {
      // Send email notification to watchers
      await emailConnector.sendEmail({
        to: 'watcher@example.com',
        subject: `Price drop: ${payload.productUID}`,
        html: `Price changed from ${payload.oldPrice} to ${payload.newPrice}`,
      });
    }
  );
}

// Call in app.ts or index.ts:
registerProductSubscribers();
```

**Important:** The event bus is synchronous. Errors in subscribers are silently caught (by design) so one failing subscriber doesn't block others. For reliable async processing, use Firebase Pub/Sub or a queue.

---

## Authentication Patterns

**Package:** `@xbg.solutions/backend-core` (middleware exports)

All middleware functions accept a typed `ITokenHandler` — they call `verifyAndUnpack()` (which includes blacklist checking).

### Middleware Functions Available

```typescript
import {
  createAuthMiddleware,
  optionalAuth,
  requiredAuth,
  requireRoles,
  requireAdmin,
  requireOwnership,
  requireApiKey,
} from '@xbg.solutions/backend-core';
```

### Using in Routes (in Controller)

```typescript
import { tokenHandler } from '@xbg.solutions/utils-token-handler';

export class ProductController extends BaseController<Product> {
  protected registerRoutes(): void {
    // Public read
    this.router.get('/', this.handleFindAll.bind(this));
    this.router.get('/:id', this.handleFindById.bind(this));

    // Require auth for writes
    this.router.post('/', requiredAuth(tokenHandler), this.handleCreate.bind(this));

    // Admin only (default role: 'admin', configurable per project)
    this.router.put('/:id', requireAdmin(tokenHandler), this.handleUpdate.bind(this));
    this.router.delete('/:id', requireAdmin(tokenHandler), this.handleDelete.bind(this));

    // Custom admin roles (not hardcoded — pass your project's roles)
    this.router.put('/:id', requireAdmin(tokenHandler, ['admin', 'sysAdmin']), this.handleUpdate.bind(this));

    // Owner or admin (admin bypass roles also configurable)
    this.router.get(
      '/:id/my-orders',
      requiredAuth(tokenHandler),
      requireOwnership((req) => req.params.id, ['admin', 'sysAdmin']),
      this.handleGetMyOrders.bind(this)
    );
  }
}
```

### RBAC Is Configurable, Not Hardcoded

Roles are defined per project through data model specs and custom claims. The auth middleware defaults (`['admin']`) are overridable:

```typescript
// Default: only 'admin' role
requireAdmin(tokenHandler);

// Your project's admin roles
requireAdmin(tokenHandler, ['admin', 'sysAdmin', 'superAdmin']);

// Ownership with custom bypass roles
requireOwnership((req) => req.params.userId, ['admin', 'manager']);

// Arbitrary role requirements
requireRoles(tokenHandler, ['consultant', 'admin']);
```

### Accessing User in Service

After `requiredAuth` middleware runs, `req.user` is populated. `BaseController.createContext()` extracts it:

```typescript
// In BaseController.createContext():
protected createContext(req: Request): RequestContext {
  return {
    requestId: req.headers['x-request-id'] as string || 'unknown',
    userId:    (req as AuthenticatedRequest).user?.uid,
    userRole:  (req as AuthenticatedRequest).user?.role,
    timestamp: new Date(),
    metadata:  { ip: req.ip, userAgent: req.headers['user-agent'] },
  };
}
```

In your service, use `context.userId` and `context.userRole`:

```typescript
protected async checkUpdateAccess(entity: Product, context: RequestContext): Promise<boolean> {
  if (!context.userId) return false;
  if (context.userRole === 'admin') return true;
  return entity.ownerId === context.userId;
}
```

---

## Service-to-Service Calls

Services can be injected into other services. Pass repositories/services via constructor:

```typescript
export class OrderService extends BaseService<Order> {
  protected entityName = 'Order';

  constructor(
    private orderRepo: OrderRepository,
    private productService: ProductService,
    private emailConnector: EmailConnector,
  ) {
    super(orderRepo);
  }

  protected async beforeCreate(data: Partial<Order>, context: RequestContext): Promise<void> {
    // Check product availability via ProductService
    const productResult = await this.productService.findById(data.productId!, context);
    if (!productResult.success || !productResult.data) {
      throw new Error('Product not found or unavailable');
    }
    if (productResult.data.status !== 'active') {
      throw new Error('Product is not available for purchase');
    }
  }
}
```

---

## Custom Service Methods

Add domain-specific methods beyond CRUD:

```typescript
export class ProductService extends BaseService<Product> {
  protected entityName = 'Product';

  // Domain-specific action
  async archiveProduct(id: string, context: RequestContext): Promise<ServiceResult<Product>> {
    try {
      const existing = await this.repository.findById(id);
      if (!existing) {
        return { success: false, error: { code: 'NOT_FOUND', message: 'Product not found' } };
      }

      if (context.userRole !== 'admin') {
        return { success: false, error: { code: 'FORBIDDEN', message: 'Admins only' } };
      }

      existing.status = 'archived';
      const updated = await this.repository.update(existing);

      eventBus.publish(EventType.PRODUCT_ARCHIVED, {
        productUID: id,
        archivedBy: context.userId!,
      });

      return { success: true, data: updated };
    } catch (error) {
      return { success: false, error: this.handleError(error) };
    }
  }
}
```

---

## Anti-Examples

```typescript
// ❌ Don't put HTTP logic in services
async createProduct(req: Request, res: Response) {  // ← this belongs in controller
  const product = ...;
  res.status(201).json(product);
}

// ❌ Don't bypass ServiceResult — always return it
async createProduct(data, context): Promise<Product> {  // ← wrong return type
  return this.repository.create(...);
}

// ✅ Always return ServiceResult
async createProduct(data, context): Promise<ServiceResult<Product>> {
  try {
    const entity = await this.buildEntity(data);
    const created = await this.repository.create(entity);
    return { success: true, data: created };
  } catch (error) {
    return { success: false, error: this.handleError(error) };
  }
}

// ❌ Don't call Firestore directly in a service
const snap = await this.db.collection('products').get();  // ← use repository

// ❌ Don't throw from access control methods — return false
protected async checkUpdateAccess(entity, context): Promise<boolean> {
  throw new Error('Forbidden');  // ← wrong; return false instead
}

// ✅ Return false from access control
protected async checkUpdateAccess(entity, context): Promise<boolean> {
  return context.userRole === 'admin';
}
```
