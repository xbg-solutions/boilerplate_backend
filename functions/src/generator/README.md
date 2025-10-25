# Code Generator

> Automated code generation from declarative data models

## Overview

The Code Generator transforms declarative data model specifications into production-ready TypeScript code. It generates entities, repositories, services, and controllers with full CRUD operations, validation, access control, and event handling.

## Features

- **Entity generation** with validation
- **Repository generation** with database operations
- **Service generation** with business logic hooks
- **Controller generation** with REST endpoints
- **Relationship handling** (one-to-one, one-to-many, many-to-many)
- **Access control** rule generation
- **Input validation** from field definitions
- **Business rules** documentation in generated code
- **Template-based** using Handlebars
- **Type-safe** TypeScript output

## Architecture

```
Data Model (TypeScript) → Parser → Generator → Templates → Generated Code
```

### Components

1. **types.ts** - Type definitions for data models
2. **parser.ts** - Parses and validates data model specifications
3. **generator.ts** - Orchestrates code generation
4. **templates/** - Handlebars templates for code output

## Data Model Format

### Basic Structure

```typescript
import { DataModelSpecification } from './generator/types';

export const MyModel: DataModelSpecification = {
  entities: {
    EntityName: {
      fields: { /* field definitions */ },
      relationships: { /* relationship definitions */ },
      access: { /* access control rules */ },
      validation: { /* validation rules */ },
      indexes: [ /* database indexes */ ],
      businessRules: [ /* business rule documentation */ ],
    },
  },
};
```

### Field Types

```typescript
fields: {
  // String fields
  name: {
    type: 'string',
    required: true,
    minLength: 2,
    maxLength: 100,
  },

  // Email fields (with validation)
  email: {
    type: 'email',
    unique: true,
    required: true,
  },

  // Enum fields
  status: {
    type: 'enum',
    values: ['pending', 'active', 'archived'],
    default: 'pending',
  },

  // Number fields
  age: {
    type: 'number',
    min: 18,
    max: 120,
  },

  // Boolean fields
  isActive: {
    type: 'boolean',
    default: true,
  },

  // Date fields
  birthDate: {
    type: 'date',
  },

  // Reference to another entity
  authorId: {
    type: 'reference',
    entity: 'User',
    required: true,
  },

  // Array fields
  tags: {
    type: 'array',
    items: 'string',
  },

  // Object fields
  address: {
    type: 'object',
    properties: {
      street: { type: 'string' },
      city: { type: 'string' },
      country: { type: 'string' },
    },
  },
}
```

### Relationships

```typescript
relationships: {
  // One-to-many
  posts: {
    type: 'one-to-many',
    entity: 'Post',
    foreignKey: 'authorId',
    cascadeDelete: true,
  },

  // Many-to-one
  author: {
    type: 'many-to-one',
    entity: 'User',
    foreignKey: 'authorId',
  },

  // Many-to-many
  tags: {
    type: 'many-to-many',
    entity: 'Tag',
    junctionTable: 'post_tags',
  },

  // One-to-one
  profile: {
    type: 'one-to-one',
    entity: 'UserProfile',
    foreignKey: 'userId',
  },
}
```

### Access Control

```typescript
access: {
  create: ['public'],              // Anyone can create
  read: ['self', 'admin'],         // Owner or admin can read
  update: ['self', 'admin'],       // Owner or admin can update
  delete: ['admin'],               // Only admin can delete
  list: ['authenticated'],         // Authenticated users can list
}
```

### Validation Rules

```typescript
validation: {
  email: 'Must be unique valid email',
  age: 'Must be 18 or older',
  phone: 'Must be valid E.164 format',
}
```

### Database Indexes

```typescript
indexes: [
  { fields: ['email'], unique: true },
  { fields: ['createdAt', 'status'] },
  { fields: ['authorId', 'publishedAt'] },
]
```

### Business Rules

```typescript
businessRules: [
  'Email must be verified before activation',
  'Users can only have one active subscription',
  'Admins cannot delete themselves',
  'Posts must be approved before publishing',
]
```

## Complete Example

```typescript
export const BlogModel: DataModelSpecification = {
  entities: {
    User: {
      fields: {
        email: {
          type: 'email',
          unique: true,
          required: true,
        },
        name: {
          type: 'string',
          required: true,
          minLength: 2,
          maxLength: 100,
        },
        role: {
          type: 'enum',
          values: ['admin', 'author', 'reader'],
          default: 'reader',
        },
        isActive: {
          type: 'boolean',
          default: true,
        },
      },
      relationships: {
        posts: {
          type: 'one-to-many',
          entity: 'Post',
          foreignKey: 'authorId',
        },
      },
      access: {
        create: ['public'],
        read: ['self', 'admin'],
        update: ['self', 'admin'],
        delete: ['admin'],
      },
      indexes: [
        { fields: ['email'], unique: true },
      ],
      businessRules: [
        'Email must be verified within 24 hours',
        'Inactive users cannot create posts',
      ],
    },

    Post: {
      fields: {
        title: {
          type: 'string',
          required: true,
          minLength: 5,
          maxLength: 200,
        },
        content: {
          type: 'string',
          required: true,
        },
        status: {
          type: 'enum',
          values: ['draft', 'published', 'archived'],
          default: 'draft',
        },
        authorId: {
          type: 'reference',
          entity: 'User',
          required: true,
        },
        publishedAt: {
          type: 'date',
        },
        tags: {
          type: 'array',
          items: 'string',
        },
      },
      relationships: {
        author: {
          type: 'many-to-one',
          entity: 'User',
          foreignKey: 'authorId',
        },
      },
      access: {
        create: ['authenticated'],
        read: ['public'],
        update: ['self', 'admin'],
        delete: ['self', 'admin'],
      },
      indexes: [
        { fields: ['authorId'] },
        { fields: ['status', 'publishedAt'] },
      ],
      businessRules: [
        'Only published posts are visible to readers',
        'Authors can edit their own posts',
      ],
    },
  },
};
```

## Generated Code Structure

For each entity, the generator creates:

```
functions/src/generated/
├── entities/
│   ├── User.ts
│   └── Post.ts
├── repositories/
│   ├── UserRepository.ts
│   └── PostRepository.ts
├── services/
│   ├── UserService.ts
│   └── PostService.ts
└── controllers/
    ├── UserController.ts
    └── PostController.ts
```

### Generated Entity

```typescript
export class User extends BaseEntity {
  constructor(
    public email: string,
    public name: string,
    public role: 'admin' | 'author' | 'reader',
    public isActive: boolean = true,
    id?: string
  ) {
    super(id);
  }

  validate(): ValidationResult {
    // Generated validation logic
  }

  toFirestore(): Record<string, any> {
    // Generated serialization
  }
}
```

### Generated Repository

```typescript
export class UserRepository extends BaseRepository<User> {
  protected collectionName = 'users';

  protected fromFirestore(data: any): User {
    // Generated deserialization
  }

  // Custom query methods
  async findByEmail(email: string): Promise<User | null> {
    // Generated implementation
  }
}
```

### Generated Service

```typescript
export class UserService extends BaseService<User> {
  protected entityName = 'User';

  // Access control
  protected canCreate(data: Partial<User>, context: RequestContext): boolean {
    return true; // public
  }

  protected canRead(entity: User, context: RequestContext): boolean {
    return entity.id === context.userId || context.userRole === 'admin';
  }

  // Business logic hooks
  protected async beforeCreate(data: Partial<User>, context: RequestContext) {
    // Custom validation
  }
}
```

### Generated Controller

```typescript
export class UserController extends BaseController<User> {
  // Standard REST routes automatically registered
  // GET /users
  // GET /users/:id
  // POST /users
  // PUT /users/:id
  // PATCH /users/:id
  // DELETE /users/:id
}
```

## Usage

### 1. Create Data Model

```bash
# Create model file
touch examples/my-model.ts
```

### 2. Define Entities

```typescript
// examples/my-model.ts
export const MyModel: DataModelSpecification = {
  entities: {
    // Define your entities here
  },
};
```

### 3. Generate Code

```bash
npm run generate examples/my-model.ts
```

### 4. Register Controllers

```typescript
// functions/src/index.ts
import { UserController } from './generated/controllers/UserController';
import { UserService } from './generated/services/UserService';
import { UserRepository } from './generated/repositories/UserRepository';

const db = getFirestore();
const userRepo = new UserRepository(db);
const userService = new UserService(userRepo);
const userController = new UserController(userService, '/users');

export const controllers = [userController];
```

### 5. Mount Routes

```typescript
// functions/src/app.ts
controllers.forEach(controller => {
  app.use(controller.getBasePath(), controller.getRouter());
});
```

## Templates

Templates are in `functions/src/templates/` using Handlebars:

- `entity.hbs` - Entity class template
- `repository.hbs` - Repository class template
- `service.hbs` - Service class template
- `controller.hbs` - Controller class template

### Custom Templates

You can modify templates to change generated code:

```handlebars
{{!-- entity.hbs --}}
export class {{entityName}} extends BaseEntity {
  constructor(
    {{#each fields}}
    public {{name}}: {{type}},
    {{/each}}
    id?: string
  ) {
    super(id);
  }

  // ... rest of template
}
```

## Known Gaps & Future Enhancements

### Missing Features
- [ ] **Incremental generation** (update existing code)
- [ ] **Custom templates** per entity
- [ ] **Template inheritance** and composition
- [ ] **Code merging** for manual changes
- [ ] **Migration generation** for schema changes
- [ ] **Validation** of data model format
- [ ] **Relationship validation** (ensure referenced entities exist)
- [ ] **Circular dependency** detection
- [ ] **Integration test** generation
- [ ] **API documentation** generation (OpenAPI/Swagger)
- [ ] **GraphQL schema** generation
- [ ] **Database migration** scripts
- [ ] **Seed data** generation

### Field Type Gaps
- [ ] **JSON** field type
- [ ] **UUID** field type
- [ ] **URL** field type
- [ ] **Color** field type
- [ ] **Currency** field type
- [ ] **Geolocation** field type (lat/lng)
- [ ] **File upload** field type
- [ ] **Rich text** field type

### Relationship Gaps
- [ ] Self-referential relationships
- [ ] Polymorphic relationships
- [ ] Through relationships (many-to-many with extra data)
- [ ] Conditional relationships

### Access Control Gaps
- [ ] **Custom roles** definition
- [ ] **Permission-based** access (beyond roles)
- [ ] **Field-level** access control
- [ ] **Dynamic** access rules

### Code Quality Gaps
- [ ] ESLint configuration for generated code
- [ ] Prettier formatting for generated code
- [ ] JSDoc comments generation
- [ ] Type safety improvements
- [ ] Null safety handling

## Best Practices

1. **Version control models**: Commit data model files to git
2. **Review generated code**: Always review before committing
3. **Don't edit generated code**: Make changes in the model instead
4. **Use business rules**: Document logic in businessRules array
5. **Test thoroughly**: Generated code needs testing too
6. **Keep models simple**: Start simple, add complexity as needed

## Troubleshooting

### Generation Fails

```bash
# Ensure TypeScript is built
npm run build

# Check model file syntax
# Verify entity references are correct
```

### Missing Dependencies

```bash
# Install all dependencies
npm install
```

### Code Doesn't Compile

```bash
# Check generated code for syntax errors
# Verify base classes are imported correctly
# Ensure all entity references exist
```

## Related Components

- **base/**: Base classes that generated code extends
- **templates/**: Handlebars templates for code generation
- **scripts/generate.js**: Generation script
- **examples/**: Example data models

## References

- [Handlebars Documentation](https://handlebarsjs.com/)
- [Code Generation Patterns](https://martinfowler.com/articles/codeGeneration.html)
- [Domain-Driven Design](https://martinfowler.com/bliki/DomainDrivenDesign.html)
