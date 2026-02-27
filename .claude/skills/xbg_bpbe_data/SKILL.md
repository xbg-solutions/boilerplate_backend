---
description: "Data layer for the XBG boilerplate backend: defining entities with BaseEntity, writing repositories with BaseRepository, declaring DataModelSpecification, and using the code generator."
---

# XBG Boilerplate Backend — Data Layer

Covers: `BaseEntity`, `BaseRepository`, `DataModelSpecification`, the generator, and Firestore patterns.

---

## BaseEntity — All Entities Extend This

**File:** `functions/src/base/BaseEntity.ts`

Every domain entity extends `BaseEntity`, which provides timestamps, soft-delete, versioning, and validation scaffolding.

### Implementing an Entity

```typescript
import { BaseEntity, BaseEntityData, ValidationHelper, ValidationResult } from '../base/BaseEntity';
import { Timestamp } from 'firebase-admin/firestore';

interface ProductData extends BaseEntityData {
  name?: string;
  price?: number;
  status?: 'active' | 'archived';
  categoryId?: string;
}

export class Product extends BaseEntity {
  name: string;
  price: number;
  status: 'active' | 'archived';
  categoryId: string;

  constructor(data: ProductData) {
    super(data);
    this.name = data.name ?? '';
    this.price = data.price ?? 0;
    this.status = data.status ?? 'active';
    this.categoryId = data.categoryId ?? '';
  }

  // REQUIRED: serialize domain fields for Firestore
  protected getEntityData(): Record<string, any> {
    return {
      name: this.name,
      price: this.price,
      status: this.status,
      categoryId: this.categoryId,
    };
  }

  // REQUIRED: validate entity state before save
  validate(): ValidationResult {
    const errors = ValidationHelper.collectErrors(
      ValidationHelper.required(this.name, 'name'),
      ValidationHelper.minLength(this.name, 3, 'name'),
      ValidationHelper.maxLength(this.name, 100, 'name'),
      ValidationHelper.required(this.price, 'price'),
      ValidationHelper.range(this.price, 0.01, 1_000_000, 'price'),
      ValidationHelper.required(this.categoryId, 'categoryId'),
      ValidationHelper.oneOf(this.status, ['active', 'archived'], 'status'),
    );
    return ValidationHelper.isValidResult(errors);
  }
}
```

### BaseEntity Fields (Always Present)

| Field | Type | Description |
|---|---|---|
| `id` | `string \| undefined` | Firestore doc ID (set on create) |
| `createdAt` | `Timestamp \| FieldValue` | Server-set on first write |
| `updatedAt` | `Timestamp \| FieldValue` | Server-set on every write |
| `deletedAt` | `Timestamp \| null` | Non-null = soft deleted |
| `version` | `number` | Increments on each update (optimistic lock) |

### ValidationHelper Reference

```typescript
ValidationHelper.required(value, 'fieldName')           // must be non-null/empty
ValidationHelper.minLength(str, 3, 'fieldName')          // string min chars
ValidationHelper.maxLength(str, 100, 'fieldName')        // string max chars
ValidationHelper.email(str, 'fieldName')                 // valid email format
ValidationHelper.range(num, 0, 1000, 'fieldName')        // numeric range
ValidationHelper.oneOf(val, ['a', 'b'], 'fieldName')     // enum membership
ValidationHelper.pattern(str, /regex/, 'fieldName')      // regex match
ValidationHelper.collectErrors(err1, err2, ...)          // filter nulls
ValidationHelper.isValidResult(errors)                   // { valid, errors }
```

---

## BaseRepository — Data Access Layer

**File:** `functions/src/base/BaseRepository.ts`

### Implementing a Repository

```typescript
import { Firestore, DocumentData } from 'firebase-admin/firestore';
import { BaseRepository } from '../base/BaseRepository';
import { Product } from '../entities/Product';

export class ProductRepository extends BaseRepository<Product> {
  protected collectionName = 'products';

  constructor(db: Firestore) {
    super(db);
  }

  // REQUIRED: deserialize Firestore doc → entity
  protected fromFirestore(id: string, data: DocumentData): Product {
    return new Product({
      id,
      name: data.name,
      price: data.price,
      status: data.status,
      categoryId: data.categoryId,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
      deletedAt: data.deletedAt ?? null,
      version: data.version,
    });
  }
}
```

### Built-In CRUD Methods

```typescript
// CREATE
const product = await repo.create(new Product({ name: 'Widget', price: 9.99, ... }));

// READ
const product = await repo.findById('product-id');           // null if not found
const product = await repo.findByIdCached('product-id');     // with cache layer
const products = await repo.findAll({ limit: 20 });
const exists = await repo.exists('product-id');
const count = await repo.count();

// UPDATE — always takes full entity, not a patch
product.price = 12.99;
const updated = await repo.update(product);  // auto-increments version

// DELETE
await repo.delete('product-id');               // soft delete (sets deletedAt)
await repo.delete('product-id', true);         // hard delete (permanent)

// BATCH
await repo.batchCreate([product1, product2, product3]);
```

### QueryOptions — Filtering and Sorting

```typescript
import { QueryOptions } from '../base/BaseRepository';

const options: QueryOptions = {
  limit: 20,
  offset: 0,
  orderBy: [
    { field: 'price', direction: 'asc' },
    { field: 'name', direction: 'asc' },
  ],
  where: [
    { field: 'status', operator: '==', value: 'active' },
    { field: 'price', operator: '<=', value: 100 },
    { field: 'categoryId', operator: '==', value: 'cat-123' },
  ],
  includeSoftDeleted: false,  // default false — exclude deletedAt != null
};

const products = await repo.findAll(options);
```

**Supported operators:** `==`, `!=`, `<`, `<=`, `>`, `>=`, `in`, `not-in`, `array-contains`, `array-contains-any`

### Pagination

```typescript
const page = await repo.findPaginated(1, 20, {
  where: [{ field: 'status', operator: '==', value: 'active' }],
  orderBy: [{ field: 'createdAt', direction: 'desc' }],
});
// page.data: Product[]
// page.total: number
// page.hasMore: boolean
// page.page: number
// page.pageSize: number
```

### Caching (opt-in per repository)

```typescript
export class ProductRepository extends BaseRepository<Product> {
  protected collectionName = 'products';

  // Opt into caching
  protected cacheConfig = {
    enabled: true,           // must also set CACHE_ENABLED=true in .env
    provider: 'memory' as const,  // 'memory' | 'firestore' | 'redis'
    ttl: 300,                // seconds
    keyPrefix: 'product',
    tags: ['products'],      // for bulk invalidation
  };

  // ...fromFirestore...
}

// Usage
const product = await repo.findByIdCached('p-123');
const fresh = await repo.findByIdCached('p-123', { forceRefresh: true });
```

Mutations (`create`, `update`, `delete`) automatically invalidate the cache. You never need to do this manually.

### Custom Query Methods

Add domain-specific finders to the repository:

```typescript
export class ProductRepository extends BaseRepository<Product> {
  protected collectionName = 'products';

  // Custom finder by category
  async findByCategory(categoryId: string): Promise<Product[]> {
    return this.findAll({
      where: [{ field: 'categoryId', operator: '==', value: categoryId }],
      orderBy: [{ field: 'name', direction: 'asc' }],
    });
  }

  // Custom finder for price range
  async findByPriceRange(min: number, max: number): Promise<Product[]> {
    return this.findAll({
      where: [
        { field: 'price', operator: '>=', value: min },
        { field: 'price', operator: '<=', value: max },
        { field: 'status', operator: '==', value: 'active' },
      ],
    });
  }

  protected fromFirestore(id: string, data: DocumentData): Product { ... }
}
```

---

## DataModelSpecification — Generator Input Format

**File:** `functions/src/generator/types.ts`

The generator takes a `DataModelSpecification` and produces Entity/Repository/Service/Controller files.

### Complete Example

```typescript
import { DataModelSpecification } from '../functions/src/generator/types';

export const EcommerceModel: DataModelSpecification = {
  entities: {
    Product: {
      description: 'A product available for purchase',

      fields: {
        name:        { type: 'string',  required: true,  minLength: 3, maxLength: 100 },
        description: { type: 'string',  required: false },
        price:       { type: 'number',  required: true,  min: 0.01 },
        status:      { type: 'enum',    values: ['active', 'archived'], default: 'active' },
        categoryId:  { type: 'reference', entity: 'Category', required: true },
        imageUrl:    { type: 'url',     required: false },
        inStock:     { type: 'boolean', default: true },
        tags:        { type: 'array' },
      },

      relationships: {
        category: { type: 'many-to-one', entity: 'Category', foreignKey: 'categoryId' },
        reviews:  { type: 'one-to-many', entity: 'Review',   foreignKey: 'productId' },
      },

      access: {
        create: ['admin'],
        read:   ['public'],
        update: ['admin'],
        delete: ['admin'],
      },

      validation: {
        price: 'Must be greater than 0',
        name:  'Must be unique within category',
      },

      indexes: [
        { fields: ['categoryId', 'status'] },
        { fields: ['name'], unique: true },
      ],

      businessRules: [
        'Products with active orders cannot be archived',
        'Price changes trigger a price-history event',
      ],
    },
  },
};
```

### Field Types

| Type | TypeScript | Notes |
|---|---|---|
| `string` | `string` | General text |
| `number` | `number` | Integer or float |
| `boolean` | `boolean` | |
| `timestamp` | `Timestamp` | Firestore timestamp |
| `date` | `string` | ISO date string |
| `email` | `string` | Validated format |
| `url` | `string` | Validated URL |
| `uuid` | `string` | |
| `enum` | `string` | Requires `values: [...]` |
| `array` | `any[]` | |
| `reference` | `string` | Requires `entity: 'EntityName'` |
| `json` | `Record<string, any>` | Arbitrary object |

### Relationship Types

| Type | Usage |
|---|---|
| `one-to-one` | `foreignKey` on either side |
| `one-to-many` | `foreignKey` on the child entity |
| `many-to-one` | `foreignKey` on this entity (common join) |
| `many-to-many` | Requires a junction entity (e.g., `PostTag`) |

### Access Control Values

```
'public'        → unauthenticated users
'authenticated' → any logged-in user
'self'          → only the resource owner (userId == entity.userId)
'admin'         → users with role 'admin'
'custom-role'   → any string role you define
```

### Running the Generator

```bash
# From project root:
npm run generate __examples__/ecommerce.model.ts

# Generates into functions/src/generated/:
# ├── entities/Product.ts
# ├── repositories/ProductRepository.ts
# ├── services/ProductService.ts
# └── controllers/ProductController.ts
```

Generated files are a **starting point**. Copy to your own directory (e.g., `src/products/`) and modify. Don't edit in `src/generated/` — that's overwritten on re-generation.

---

## Firestore-Specific Patterns

### Soft Delete Query Requirement

`BaseRepository.findAll()` always adds `where('deletedAt', '==', null)`. If you add other `where` clauses on different fields, Firestore requires a **composite index**:

```
Collection: products
Fields: deletedAt ASC, categoryId ASC, price ASC
```

Create via Firebase Console or `firestore.indexes.json`.

### Multi-Database Setup

The project supports multiple Firestore databases. Configure in `functions/src/config/database.config.ts`:

```typescript
export const DATABASE_CONFIG = {
  databases: {
    main:      { projectId: '...', databaseId: '(default)' },
    analytics: { projectId: '...', databaseId: 'analytics' },
  },
  collections: {
    products:  { database: 'main', name: 'products' },
    pageViews: { database: 'analytics', name: 'page_views' },
  },
};
```

Then pass the right `db` instance to the repository:

```typescript
import { getFirestoreDb } from './config/database.config';

const mainDb = getFirestoreDb('main');
const productRepo = new ProductRepository(mainDb);
```

### Timestamps — Always Use ServerTimestamp

```typescript
// ✅ Correct — server-authoritative timestamp
createdAt: FieldValue.serverTimestamp()

// ❌ Wrong — client clock can drift
createdAt: new Date()
createdAt: Timestamp.now()
```

`BaseEntity` handles this automatically in `toFirestore()` — `updatedAt` is always server timestamp on write.

---

## Anti-Examples

```typescript
// ❌ Don't put Firestore logic directly in a service
class ProductService extends BaseService<Product> {
  async getByCategory(categoryId: string) {
    const db = getFirestore();  // ← wrong layer
    const snap = await db.collection('products').where(...).get();
    // ...
  }
}

// ✅ Put it in the repository
class ProductRepository extends BaseRepository<Product> {
  async findByCategory(categoryId: string): Promise<Product[]> {
    return this.findAll({ where: [{ field: 'categoryId', operator: '==', value: categoryId }] });
  }
}

// ❌ Don't skip validate() before saving
const product = new Product(data);
await repo.create(product);  // BaseRepository.create() calls validate() automatically — fine
// But if you call getCollection().doc().set() directly, you bypass validation

// ❌ Don't use hard delete by default
await repo.delete(id, true);  // Only use when legally required (GDPR right to erasure)
// Soft delete is the default and preserves audit trail

// ❌ Don't forget to handle null from findById
const product = await repo.findById(id);
product.name;  // ← TypeError if null!

// ✅ Always guard
const product = await repo.findById(id);
if (!product) {
  return { success: false, error: { code: 'NOT_FOUND', message: 'Product not found' } };
}
```
