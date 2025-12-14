# Base Classes

> Foundation classes for entities, repositories, services, and controllers

## Overview

The base classes provide a consistent foundation for the application's layered architecture. All generated code and custom implementations extend these base classes, ensuring uniform patterns for CRUD operations, event handling, validation, and HTTP responses.

## Architecture Layers

```
┌─────────────────────────────────────┐
│    BaseController (HTTP Layer)     │ ← Handles HTTP requests/responses
├─────────────────────────────────────┤
│    BaseService (Business Logic)    │ ← Orchestrates business rules
├─────────────────────────────────────┤
│  BaseRepository (Data Access)      │ ← Database operations
├─────────────────────────────────────┤
│      BaseEntity (Domain Model)     │ ← Data validation & structure
└─────────────────────────────────────┘
```

## Base Classes

### BaseEntity

Abstract class for all domain entities.

**Features:**
- Validation framework
- Timestamp management (createdAt, updatedAt)
- Soft delete support (deletedAt)
- Firestore serialization
- Unique ID management

**Key Methods:**
```typescript
- validate(): ValidationResult
- toFirestore(): Record<string, any>
- fromFirestore(data): T
- getId(): string
- markDeleted(): void
```

**Usage:**
```typescript
export class User extends BaseEntity {
  constructor(
    public email: string,
    public name: string,
    public role: 'admin' | 'user',
    id?: string
  ) {
    super(id);
  }

  validate(): ValidationResult {
    const errors: string[] = [];

    if (!this.email || !validateEmail(this.email)) {
      errors.push('Invalid email');
    }

    if (!this.name || this.name.length < 2) {
      errors.push('Name must be at least 2 characters');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  toFirestore(): Record<string, any> {
    return {
      ...super.toFirestore(),
      email: this.email,
      name: this.name,
      role: this.role,
    };
  }
}
```

**Gaps:**
- [ ] Schema-based validation (JSON Schema, Zod)
- [ ] Field-level validation decorators
- [ ] Computed properties support
- [ ] Entity versioning
- [ ] Entity cloning/copying
- [ ] Dirty tracking (what fields changed)
- [ ] Entity events (onBeforeSave, onAfterLoad)

---

### BaseRepository

Abstract class for all repositories.

**Features:**
- CRUD operations (create, read, update, delete)
- Query building with filtering, sorting, pagination
- Soft delete support
- Transaction support
- Bulk operations
- Entity mapping (Firestore ↔ Entity)

**Key Methods:**
```typescript
- create(entity: T): Promise<T>
- findById(id: string): Promise<T | null>
- findAll(options?: QueryOptions): Promise<PaginationResult<T>>
- update(id: string, data: Partial<T>): Promise<T>
- delete(id: string, soft?: boolean): Promise<void>
- findByField(field: string, value: any): Promise<T[]>
- count(options?: QueryOptions): Promise<number>
- exists(id: string): Promise<boolean>
```

**QueryOptions:**
```typescript
interface QueryOptions {
  limit?: number;
  offset?: number;
  orderBy?: { field: string; direction: 'asc' | 'desc' }[];
  where?: WhereClause[];
  includeSoftDeleted?: boolean;
}
```

**Usage:**
```typescript
export class UserRepository extends BaseRepository<User> {
  protected collectionName = 'users';

  async findByEmail(email: string): Promise<User | null> {
    const results = await this.findByField('email', email);
    return results[0] || null;
  }

  protected fromFirestore(data: any): User {
    return new User(
      data.email,
      data.name,
      data.role,
      data.id
    );
  }
}
```

**Gaps:**
- [ ] Caching layer
- [ ] Connection pooling
- [ ] Query performance optimization
- [ ] Full-text search support
- [ ] Geospatial queries
- [ ] Aggregation queries
- [ ] Batch operations optimization
- [ ] Cross-collection joins
- [ ] Database migration support

---

### BaseService

Abstract class for all services.

**Features:**
- Business logic orchestration
- CRUD operations with validation
- Event publishing (domain events)
- Request context tracking
- Authorization checks
- Lifecycle hooks (before/after operations)

**Key Methods:**
```typescript
- create(data, context): Promise<ServiceResult<T>>
- findById(id, context): Promise<ServiceResult<T>>
- findAll(options, context): Promise<ServiceResult<PaginationResult<T>>>
- update(id, data, context): Promise<ServiceResult<T>>
- delete(id, context): Promise<ServiceResult<void>>
```

**Lifecycle Hooks:**
```typescript
- beforeCreate(data, context): Promise<void>
- afterCreate(entity, context): Promise<void>
- beforeUpdate(id, data, context): Promise<void>
- afterUpdate(entity, context): Promise<void>
- beforeDelete(id, context): Promise<void>
- afterDelete(id, context): Promise<void>
```

**RequestContext:**
```typescript
interface RequestContext {
  requestId: string;
  userId?: string;
  userRole?: string;
  timestamp: Date;
  metadata?: Record<string, any>;
}
```

**Usage:**
```typescript
export class UserService extends BaseService<User> {
  protected entityName = 'User';

  protected async beforeCreate(data: Partial<User>, context: RequestContext) {
    // Check if email already exists
    const existing = await this.repository.findByEmail(data.email!);
    if (existing) {
      throw new ConflictError('Email already exists');
    }
  }

  protected async afterCreate(user: User, context: RequestContext) {
    // Send welcome email
    await emailService.sendWelcome(user.email);
  }

  protected buildEntity(data: Partial<User>): User {
    return new User(
      data.email!,
      data.name!,
      data.role || 'user'
    );
  }

  protected canCreate(data: Partial<User>, context: RequestContext): boolean {
    return true; // Public registration
  }

  protected canRead(entity: User, context: RequestContext): boolean {
    return entity.id === context.userId || context.userRole === 'admin';
  }

  protected canUpdate(entity: User, context: RequestContext): boolean {
    return entity.id === context.userId || context.userRole === 'admin';
  }

  protected canDelete(entity: User, context: RequestContext): boolean {
    return context.userRole === 'admin';
  }
}
```

**Gaps:**
- [ ] Transaction support across services
- [ ] Saga pattern for distributed transactions
- [ ] Command pattern for operations
- [ ] Business rule engine
- [ ] Workflow orchestration
- [ ] Service-to-service authorization
- [ ] Audit trail automation
- [ ] Compensation logic for rollbacks

---

### BaseController

Abstract class for all controllers.

**Features:**
- HTTP request/response handling
- Standard REST endpoints (POST, GET, PUT, PATCH, DELETE)
- Request context creation
- Error handling
- Response formatting
- Pagination support

**Key Methods:**
```typescript
- handleCreate(req, res, next): Promise<void>
- handleFindAll(req, res, next): Promise<void>
- handleFindById(req, res, next): Promise<void>
- handleUpdate(req, res, next): Promise<void>
- handleDelete(req, res, next): Promise<void>
```

**Standard Routes:**
- `POST /` - Create entity
- `GET /` - List entities (with pagination)
- `GET /:id` - Get entity by ID
- `PUT /:id` - Full update
- `PATCH /:id` - Partial update
- `DELETE /:id` - Delete entity

**Response Format:**
```typescript
interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: Record<string, any>;
  };
  metadata?: {
    requestId: string;
    timestamp: string;
    version: string;
  };
}

interface PaginatedApiResponse<T> extends ApiResponse<T[]> {
  pagination?: {
    page: number;
    pageSize: number;
    total: number;
    hasMore: boolean;
  };
}
```

**Usage:**
```typescript
export class UserController extends BaseController<User> {
  protected registerRoutes(): void {
    // Call parent to register standard routes
    super.registerRoutes();

    // Add custom routes
    this.router.post('/:id/reset-password', this.handleResetPassword.bind(this));
    this.router.get('/:id/orders', this.handleGetUserOrders.bind(this));
  }

  private async handleResetPassword(req: Request, res: Response, next: NextFunction) {
    try {
      const context = this.createContext(req);
      const result = await this.service.resetPassword(req.params.id, context);

      if (!result.success) {
        return res.status(400).json(this.formatError(result.error!));
      }

      res.json(this.formatSuccess(result.data));
    } catch (error) {
      next(error);
    }
  }
}
```

**Gaps:**
- [ ] GraphQL support
- [ ] WebSocket handlers
- [ ] File upload handling
- [ ] Response caching
- [ ] Content negotiation (JSON, XML, etc.)
- [ ] HATEOAS links in responses
- [ ] Batch operations endpoints
- [ ] Streaming responses

---

## Common Patterns

### Event-Driven Service

```typescript
export class OrderService extends BaseService<Order> {
  protected async afterCreate(order: Order, context: RequestContext) {
    // Event will be picked up by other services/subscribers
    this.publishEvent('CREATED', order, context);
  }
}

// In another service or subscriber
eventBus.subscribe('order.created', async (event) => {
  await emailService.sendOrderConfirmation(event.payload);
  await inventoryService.reserveItems(event.payload.items);
});
```

### Access Control

```typescript
protected canRead(entity: User, context: RequestContext): boolean {
  // Users can read their own data
  if (entity.id === context.userId) {
    return true;
  }

  // Admins can read all data
  if (context.userRole === 'admin') {
    return true;
  }

  // Managers can read their team members
  if (context.userRole === 'manager') {
    return entity.managerId === context.userId;
  }

  return false;
}
```

### Soft Delete

```typescript
// Repository automatically handles soft deletes
await repository.delete(id, true); // soft delete

// Query excludes soft deleted by default
const users = await repository.findAll();

// Include soft deleted if needed
const allUsers = await repository.findAll({ includeSoftDeleted: true });
```

## Known Gaps & Future Enhancements

### Architecture Patterns
- [ ] **CQRS** (Command Query Responsibility Segregation)
- [ ] **Event Sourcing** for audit trail
- [ ] **Repository patterns** beyond CRUD
- [ ] **Unit of Work** pattern
- [ ] **Specification** pattern for queries
- [ ] **Strategy** pattern for business rules

### Features
- [ ] Multi-tenancy support in base classes
- [ ] Data encryption at rest
- [ ] Field-level encryption
- [ ] Change data capture (CDC)
- [ ] Time-travel queries (historical data)
- [ ] Optimistic locking
- [ ] Pessimistic locking

### Testing Gaps
- [ ] Base class unit tests
- [ ] Mock repositories for testing
- [ ] Test data builders
- [ ] Integration test helpers

## Best Practices

1. **Always extend base classes**: Don't create entities/repositories from scratch
2. **Override hooks**: Use lifecycle hooks for business logic
3. **Validate in entities**: Keep validation close to data
4. **Authorize in services**: Implement access control in service layer
5. **Keep controllers thin**: Delegate logic to services
6. **Publish events**: Use event bus for cross-service communication

## Related Components

- **generator/**: Code generation from data models
- **templates/**: Handlebars templates for generated code
- **utilities/events**: Event bus for domain events
- **utilities/logger**: Structured logging
- **middleware/**: HTTP middleware pipeline

## References

- [Domain-Driven Design](https://martinfowler.com/bliki/DomainDrivenDesign.html)
- [Repository Pattern](https://martinfowler.com/eaaCatalog/repository.html)
- [Service Layer Pattern](https://martinfowler.com/eaaCatalog/serviceLayer.html)
