# Example Data Models

This directory contains complete, production-ready data models for common application types. These examples demonstrate best practices for defining entities, relationships, access control, and business rules.

---

## 📚 Available Models

### 1. Blog Platform (`blog-platform.model.ts`)

A complete content management system with social features.

**Entities:** 8 entities, 3 junction tables
- User, Post, Comment, Category, Tag
- PostLike, UserFollow, PostTag

**Features:**
- User authentication and profiles
- Posts with rich content
- Nested comments (3 levels deep)
- Categories and tags
- Social features (likes, follows)
- Content moderation workflow

**Use Cases:**
- Blog platforms
- News sites
- Content communities
- Knowledge bases

**To use:**
```bash
npm run generate __examples__/blog-platform.model.ts
```

---

### 2. E-commerce Store (`ecommerce-store.model.ts`)

A complete online store with inventory, orders, and payments.

**Entities:** 17 entities, 2 junction tables
- Customer, Address, Product, ProductVariant, Category, Brand
- Cart, CartItem, Order, OrderItem, Shipment
- Review, Collection, ProductImage
- ProductCollection

**Features:**
- Product catalog with variants (size, color, etc.)
- Shopping cart and checkout
- Order management with status tracking
- Inventory management
- Customer reviews and ratings
- Payment integration (Stripe)
- Shipping and delivery tracking

**Use Cases:**
- E-commerce stores
- Marketplaces
- Physical product sales
- Digital product sales

**To use:**
```bash
npm run generate __examples__/ecommerce-store.model.ts
```

---

### 3. SaaS Multi-Tenant (`saas-multi-tenant.model.ts`)

A B2B SaaS application with workspaces and team collaboration.

**Entities:** 12 entities
- User, Organization, OrganizationMember
- Workspace, WorkspaceMember, Project
- Invitation, ApiKey
- UsageLog, AuditLog

**Features:**
- Multi-tenant workspace architecture
- Hierarchical permissions (Org → Workspace → Project)
- Team collaboration
- Subscription management (Stripe)
- Usage tracking and billing
- API key management
- Audit logging

**Use Cases:**
- B2B SaaS platforms
- Project management tools
- Collaboration software
- Team productivity apps

**To use:**
```bash
npm run generate __examples__/saas-multi-tenant.model.ts
```

---

## 🎯 How to Use These Models

### Step 1: Choose a Model

Pick the model that closest matches your application type. You can:
- Use it as-is
- Modify it for your needs
- Combine multiple models
- Use as a learning reference

### Step 2: Generate Code

```bash
cd functions
npm run generate __examples__/<model-file>.ts
```

This generates:
- **Entities**: TypeScript interfaces in `src/entities/`
- **Repositories**: Data access layer in `src/repositories/`
- **Services**: Business logic in `src/services/`
- **Controllers**: HTTP endpoints in `src/controllers/`

### Step 3: Register Controllers

Edit `functions/src/app.ts` to register your routes:

```typescript
import { PostController } from './controllers/PostController';
import { PostService } from './services/PostService';
import { PostRepository } from './repositories/PostRepository';

// Initialize
const postRepository = new PostRepository();
const postService = new PostService(postRepository);
const postController = new PostController(postService, '/api/v1/posts');

// Register routes
postController.registerRoutes(app);
```

### Step 4: Customize Business Logic

The generated code provides CRUD operations. Add custom methods:

```typescript
// functions/src/services/PostService.ts
export class PostService extends BaseService<Post> {
  // Generated CRUD methods are here

  // Add your custom business logic
  async publishPost(postId: string, authorId: string): Promise<Post> {
    const post = await this.repository.findById(postId);

    if (post.authorId !== authorId) {
      throw new Error('Unauthorized');
    }

    const updated = await this.repository.update(postId, {
      published: true,
      publishedAt: new Date(),
    });

    // Notify followers
    this.eventBus.publish('post.published', { post: updated });

    return updated;
  }
}
```

### Step 5: Add Event Subscribers

Create event handlers for side effects:

```typescript
// functions/src/subscribers/post-subscribers.ts
import { eventBus } from '../utilities/events';
import { emailConnector } from '../utilities/email-connector';

eventBus.subscribe('post.published', async (event) => {
  const { post } = event.payload;

  // Send notifications to followers
  await notifyFollowers(post);

  // Update analytics
  await trackPublish(post);
});
```

### Step 6: Write Tests

```typescript
// functions/src/services/__tests__/PostService.test.ts
describe('PostService', () => {
  it('prevents users from liking their own posts', async () => {
    const post = await createTestPost({ authorId: 'user-123' });

    await expect(
      postService.likePost(post.id, 'user-123')
    ).rejects.toThrow('You cannot like your own post');
  });
});
```

### Step 7: Deploy

```bash
npm run build
npm run validate
npm run deploy
```

---

## 📖 Understanding the Data Model Format

### Entity Definition

```typescript
EntityName: {
  fields: {
    fieldName: {
      type: 'string' | 'email' | 'number' | 'boolean' | 'timestamp' | etc.,
      required: true | false,
      unique: true | false,
      default: value,
    },
  },
  relationships: {
    relationName: {
      type: 'one-to-one' | 'one-to-many' | 'many-to-one' | 'many-to-many',
      entity: 'TargetEntity',
      foreignKey: 'fieldName', // For one-to-many
      through: 'JunctionTable', // For many-to-many
    },
  },
  access: {
    create: ['role1', 'role2'],
    read: ['public' | 'role'],
    update: ['self', 'admin'],
    delete: ['admin'],
  },
  validation: {
    fieldName: 'Validation message',
  },
  businessRules: [
    'Rule description 1',
    'Rule description 2',
  ],
  indexes: [
    { fields: ['field1'], unique: true },
    { fields: ['field1', 'field2'] },
  ],
}
```

### Field Types

- `string` - Short text (up to 255 chars)
- `text` - Long text (unlimited)
- `email` - Email address with validation
- `url` - URL with validation
- `phone` - Phone number
- `number` - Integer or decimal
- `boolean` - True/false
- `timestamp` - Date and time
- `enum` - Predefined values
- `reference` - Foreign key to another entity
- `array` - Array of values
- `json` - Arbitrary JSON data

### Relationship Types

**One-to-Many:**
```typescript
User: {
  relationships: {
    posts: {
      type: 'one-to-many',
      entity: 'Post',
      foreignKey: 'authorId',
    },
  },
}
```

**Many-to-One:**
```typescript
Post: {
  relationships: {
    author: {
      type: 'many-to-one',
      entity: 'User',
    },
  },
}
```

**Many-to-Many:**
```typescript
Post: {
  relationships: {
    tags: {
      type: 'many-to-many',
      entity: 'Tag',
      through: 'PostTag', // Junction table
    },
  },
}
```

### Access Control

- `public` - Anyone (unauthenticated)
- `authenticated` - Any logged-in user
- `self` - Owner of the resource
- `admin` - Admin users
- `moderator` - Moderator users
- Custom roles defined in your app

---

## 🔧 Customization Tips

### Combining Models

You can combine entities from multiple models:

```typescript
import { BlogPlatformModel } from './blog-platform.model';
import { EcommerceStoreModel } from './ecommerce-store.model';

export const MyModel: DataModelSpecification = {
  entities: {
    // Blog entities
    ...BlogPlatformModel.entities,

    // E-commerce entities
    ...EcommerceStoreModel.entities,

    // Your custom entities
    MyCustomEntity: {
      // ...
    },
  },
};
```

### Adding Fields

```typescript
User: {
  fields: {
    // ...existing fields
    customField: {
      type: 'string',
      required: false,
    },
  },
}
```

### Modifying Relationships

```typescript
Post: {
  relationships: {
    // Add new relationship
    attachments: {
      type: 'one-to-many',
      entity: 'Attachment',
      foreignKey: 'postId',
    },
  },
}
```

### Adding Business Rules

```typescript
Product: {
  businessRules: [
    'Products with pending orders cannot be deleted',
    'Price changes require approval',
    'Out-of-stock products are hidden from catalog',
  ],
}
```

---

## 🎓 Learning Resources

- **[Building with AI Agents](__docs__/building-with-ai-agents.md)**: Complete guide for AI-assisted development
- **[Testing Philosophy](../functions/src/__tests__/README.md)**: How to write effective tests
- **[Main README](../README.md)**: Project overview and setup

---

## 💡 Best Practices

### 1. Start Simple

Begin with a minimal model and add complexity as needed:

```typescript
// Start with this
User: {
  fields: {
    email: { type: 'email', unique: true, required: true },
    name: { type: 'string', required: true },
  },
}

// Add features incrementally
User: {
  fields: {
    email: { type: 'email', unique: true, required: true },
    name: { type: 'string', required: true },
    avatarUrl: { type: 'url', required: false }, // Added
    bio: { type: 'text', required: false }, // Added
  },
}
```

### 2. Use Descriptive Names

```typescript
// ❌ Bad
u: { type: 'reference', entity: 'U' }

// ✅ Good
authorId: { type: 'reference', entity: 'User' }
```

### 3. Define Access Control Early

```typescript
Post: {
  access: {
    create: ['authenticated'], // Who can create
    read: ['public'], // Who can read
    update: ['self', 'admin'], // Who can update
    delete: ['admin'], // Who can delete
  },
}
```

### 4. Document Business Rules

```typescript
Order: {
  businessRules: [
    'Orders cannot be deleted, only cancelled',
    'Cancelled orders release inventory',
    'Order total must include tax and shipping',
  ],
}
```

### 5. Plan for Scale

```typescript
Post: {
  indexes: [
    { fields: ['authorId', 'published'] }, // For listing user's published posts
    { fields: ['categoryId', 'publishedAt'] }, // For category pages
    { fields: ['published', 'isFeatured'] }, // For homepage
  ],
}
```

---

## 🐛 Common Issues

### Issue: Circular Dependencies

**Problem:** Entity A references Entity B, which references Entity A.

**Solution:** Use one-way references or junction tables:

```typescript
// ❌ Circular
User: { relationships: { follows: { type: 'many-to-many', entity: 'User' } } }

// ✅ Better - Use junction table
UserFollow: {
  fields: {
    followerId: { type: 'reference', entity: 'User' },
    followingId: { type: 'reference', entity: 'User' },
  },
}
```

### Issue: Missing Foreign Keys

**Problem:** One-to-many relationship without foreignKey specified.

**Solution:** Always specify foreignKey:

```typescript
User: {
  relationships: {
    posts: {
      type: 'one-to-many',
      entity: 'Post',
      foreignKey: 'authorId', // Required!
    },
  },
}
```

### Issue: Many-to-Many Without Junction

**Problem:** Many-to-many relationship missing `through` table.

**Solution:** Create a junction table:

```typescript
// Define the junction table
PostTag: {
  fields: {
    postId: { type: 'reference', entity: 'Post', required: true },
    tagId: { type: 'reference', entity: 'Tag', required: true },
  },
  indexes: [
    { fields: ['postId', 'tagId'], unique: true },
  ],
}

// Reference it in the many-to-many
Post: {
  relationships: {
    tags: {
      type: 'many-to-many',
      entity: 'Tag',
      through: 'PostTag', // Junction table
    },
  },
}
```

---

## 📞 Getting Help

- **Questions**: Open a [GitHub Discussion](https://github.com/xbg-solutions/boilerplate_backend/discussions)
- **Issues**: Report bugs via [GitHub Issues](https://github.com/xbg-solutions/boilerplate_backend/issues)
- **Documentation**: See [__docs__/](__docs__/) directory

---

**Happy modeling!** 🚀

These examples are production-ready starting points. Customize them for your needs, and remember: start simple, iterate, and let AI help you build.
