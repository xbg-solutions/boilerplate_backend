# Building with AI Agents: Complete Guide

**A comprehensive guide for building backend APIs using this boilerplate with AI assistance.**

---

## 🎯 Philosophy: AI as Your Senior Developer

This boilerplate is designed for a specific workflow:

```
You (Product Owner) ←→ AI Agent (Senior Developer) ←→ Boilerplate (Infrastructure)
```

**You provide:**
- Business requirements (MoSCoW format)
- Data relationships and rules
- Feature priorities

**AI provides:**
- Data model definitions
- Service layer business logic
- Controller implementations
- Test generation

**Boilerplate provides:**
- Base classes and patterns
- Authentication & authorization
- Database connectors
- Event bus architecture
- Utilities and middleware
- Testing infrastructure

---

## 📋 Prerequisites

Before starting an AI-assisted development session:

1. **Run Setup**
   ```bash
   cd functions
   npm install
   npm run setup
   npm run validate
   ```

2. **Understand the Architecture**
   - Read this document fully
   - Review `__examples__/user.model.ts`
   - Understand the layered pattern: Controller → Service → Repository

3. **Prepare Your Requirements**
   - Use MoSCoW prioritization (Must, Should, Could, Won't)
   - Define entities and relationships
   - List business rules and validation requirements

---

## 🏗️ Mandated Project Structure

**This structure is non-negotiable.** AI agents MUST follow this exact pattern:

```
functions/src/
├── config/                          # Configuration only
│   ├── app.config.ts
│   ├── auth.config.ts
│   ├── database.config.ts
│   └── middleware.config.ts
│
├── base/                            # DO NOT MODIFY - Base classes
│   ├── BaseController.ts
│   ├── BaseService.ts
│   └── BaseRepository.ts
│
├── middleware/                      # DO NOT MODIFY - Middleware
│   ├── auth.middleware.ts
│   ├── error.middleware.ts
│   ├── rate-limit.middleware.ts
│   └── validation.middleware.ts
│
├── utilities/                       # DO NOT MODIFY - Reusable utilities
│   ├── hashing/
│   ├── logger/
│   ├── events/
│   ├── token-handler/
│   └── [various connectors]/
│
├── entities/                        # ✅ AI CREATES HERE
│   ├── User.ts                      #    Domain entities
│   ├── Post.ts                      #    TypeScript interfaces
│   └── Comment.ts                   #    Validation schemas
│
├── repositories/                    # ✅ AI CREATES HERE
│   ├── UserRepository.ts            #    Data access layer
│   ├── PostRepository.ts            #    Extends BaseRepository
│   └── CommentRepository.ts         #    Database operations
│
├── services/                        # ✅ AI CREATES HERE
│   ├── UserService.ts               #    Business logic
│   ├── PostService.ts               #    Extends BaseService
│   └── CommentService.ts            #    Event publishing
│
├── controllers/                     # ✅ AI CREATES HERE
│   ├── UserController.ts            #    HTTP endpoints
│   ├── PostController.ts            #    Extends BaseController
│   └── CommentController.ts         #    Request/response handling
│
├── dto/                             # ✅ AI CREATES HERE (optional but recommended)
│   ├── user.dto.ts                  #    Data transfer objects
│   ├── post.dto.ts                  #    Request/response types
│   └── comment.dto.ts               #    Validation schemas
│
├── subscribers/                     # ✅ AI CREATES HERE (if using events)
│   ├── user-subscribers.ts          #    Event handlers
│   ├── post-subscribers.ts          #    Side effects
│   └── notification-subscribers.ts  #    Async processing
│
├── app.ts                           # ✅ AI MODIFIES
│   └── Register new routes here
│
└── index.ts                         # ✅ AI MODIFIES
    └── Export Firebase Functions
```

### 🚨 Critical Rules

1. **NEVER modify files in `/base/`, `/middleware/`, or `/utilities/`**
   - These are the infrastructure provided by the boilerplate
   - Extend them, don't modify them

2. **ALWAYS extend base classes**
   ```typescript
   // ✅ CORRECT
   export class UserService extends BaseService<User> { }

   // ❌ WRONG
   export class UserService { }
   ```

3. **ALWAYS use the layered architecture**
   ```
   HTTP Request → Controller → Service → Repository → Database
                     ↓           ↓          ↓
                  Validation  Business   Data
                  & Auth      Logic      Access
   ```

4. **ALWAYS publish events for side effects**
   ```typescript
   // In your service
   await this.repository.create(user);
   this.eventBus.publish('user.created', { user });
   ```

5. **ALWAYS use existing utilities**
   ```typescript
   import { logger } from '../utilities/logger';
   import { eventBus } from '../utilities/events';
   import { hasher } from '../utilities/hashing';
   ```

---

## 🤖 AI Conversation Pattern

### Step 1: Requirement Gathering

**Your Message:**
```
I need to build a blog platform. Here are my requirements:

MUST HAVE (M):
- Users can create posts
- Posts can have comments
- Posts belong to categories
- Users can like posts

SHOULD HAVE (S):
- Posts can have multiple tags
- Users can follow other users
- Email notifications for new comments

COULD HAVE (C):
- Rich text editor support
- Image uploads
- Post scheduling

WON'T HAVE (for now):
- Video posts
- Monetization features
```

**AI Response Pattern:**
```
I'll create a data model for your blog platform. Let me break this down:

ENTITIES:
- User (authentication, profile)
- Post (content, author)
- Comment (on posts)
- Category (post organization)
- Tag (post metadata)
- PostLike (many-to-many resolution)
- UserFollow (many-to-many resolution)

RELATIONSHIPS:
- User → Posts (one-to-many)
- User → Comments (one-to-many)
- Post → Comments (one-to-many)
- Post → Category (many-to-one)
- Post → Tags (many-to-many)
- Post → Likes (many-to-many through PostLike)
- User → Followers (many-to-many through UserFollow)

Let me create the data model file...
```

### Step 2: Data Model Creation

**AI Creates:** `__examples__/blog.model.ts`

```typescript
import { DataModelSpecification } from '../functions/src/generator/types';

export const BlogModel: DataModelSpecification = {
  entities: {
    User: {
      fields: {
        email: { type: 'email', unique: true, required: true },
        username: { type: 'string', unique: true, required: true },
        displayName: { type: 'string', required: true },
        bio: { type: 'text', required: false },
        avatarUrl: { type: 'url', required: false },
        isVerified: { type: 'boolean', default: false },
        createdAt: { type: 'timestamp', required: true },
      },
      relationships: {
        posts: {
          type: 'one-to-many',
          entity: 'Post',
          foreignKey: 'authorId',
        },
        comments: {
          type: 'one-to-many',
          entity: 'Comment',
          foreignKey: 'authorId',
        },
        likedPosts: {
          type: 'many-to-many',
          entity: 'Post',
          through: 'PostLike',
        },
        followers: {
          type: 'many-to-many',
          entity: 'User',
          through: 'UserFollow',
          foreignKey: 'followingId',
          relatedKey: 'followerId',
        },
      },
      access: {
        create: ['public'],
        read: ['public'],
        update: ['self'],
        delete: ['self', 'admin'],
      },
      indexes: [
        { fields: ['email'], unique: true },
        { fields: ['username'], unique: true },
      ],
    },

    Post: {
      fields: {
        title: { type: 'string', required: true },
        slug: { type: 'string', unique: true, required: true },
        content: { type: 'text', required: true },
        excerpt: { type: 'string', required: false },
        coverImageUrl: { type: 'url', required: false },
        published: { type: 'boolean', default: false },
        publishedAt: { type: 'timestamp', required: false },
        authorId: { type: 'reference', entity: 'User', required: true },
        categoryId: { type: 'reference', entity: 'Category', required: true },
        viewCount: { type: 'number', default: 0 },
        createdAt: { type: 'timestamp', required: true },
        updatedAt: { type: 'timestamp', required: true },
      },
      relationships: {
        author: {
          type: 'many-to-one',
          entity: 'User',
        },
        category: {
          type: 'many-to-one',
          entity: 'Category',
        },
        comments: {
          type: 'one-to-many',
          entity: 'Comment',
          foreignKey: 'postId',
        },
        tags: {
          type: 'many-to-many',
          entity: 'Tag',
          through: 'PostTag',
        },
        likes: {
          type: 'many-to-many',
          entity: 'User',
          through: 'PostLike',
        },
      },
      access: {
        create: ['authenticated'],
        read: ['public'],
        update: ['self', 'admin'],
        delete: ['self', 'admin'],
      },
      validation: {
        title: 'Must be 5-200 characters',
        slug: 'Must be URL-safe',
        content: 'Cannot be empty',
      },
      businessRules: [
        'Slug must be unique',
        'Published posts cannot be unpublished',
        'Posts must have at least one category',
      ],
      indexes: [
        { fields: ['slug'], unique: true },
        { fields: ['authorId', 'published'] },
        { fields: ['categoryId', 'published'] },
        { fields: ['publishedAt'] },
      ],
    },

    Comment: {
      fields: {
        content: { type: 'text', required: true },
        postId: { type: 'reference', entity: 'Post', required: true },
        authorId: { type: 'reference', entity: 'User', required: true },
        parentId: { type: 'reference', entity: 'Comment', required: false },
        isEdited: { type: 'boolean', default: false },
        createdAt: { type: 'timestamp', required: true },
        updatedAt: { type: 'timestamp', required: true },
      },
      relationships: {
        post: {
          type: 'many-to-one',
          entity: 'Post',
        },
        author: {
          type: 'many-to-one',
          entity: 'User',
        },
        parent: {
          type: 'many-to-one',
          entity: 'Comment',
          optional: true,
        },
        replies: {
          type: 'one-to-many',
          entity: 'Comment',
          foreignKey: 'parentId',
        },
      },
      access: {
        create: ['authenticated'],
        read: ['public'],
        update: ['self'],
        delete: ['self', 'admin'],
      },
      indexes: [
        { fields: ['postId', 'createdAt'] },
        { fields: ['authorId'] },
        { fields: ['parentId'] },
      ],
    },

    Category: {
      fields: {
        name: { type: 'string', unique: true, required: true },
        slug: { type: 'string', unique: true, required: true },
        description: { type: 'text', required: false },
        color: { type: 'string', required: false },
      },
      relationships: {
        posts: {
          type: 'one-to-many',
          entity: 'Post',
          foreignKey: 'categoryId',
        },
      },
      access: {
        create: ['admin'],
        read: ['public'],
        update: ['admin'],
        delete: ['admin'],
      },
      indexes: [
        { fields: ['slug'], unique: true },
      ],
    },

    Tag: {
      fields: {
        name: { type: 'string', unique: true, required: true },
        slug: { type: 'string', unique: true, required: true },
      },
      relationships: {
        posts: {
          type: 'many-to-many',
          entity: 'Post',
          through: 'PostTag',
        },
      },
      access: {
        create: ['authenticated'],
        read: ['public'],
        update: ['admin'],
        delete: ['admin'],
      },
      indexes: [
        { fields: ['slug'], unique: true },
      ],
    },

    PostLike: {
      fields: {
        postId: { type: 'reference', entity: 'Post', required: true },
        userId: { type: 'reference', entity: 'User', required: true },
        createdAt: { type: 'timestamp', required: true },
      },
      access: {
        create: ['authenticated'],
        read: ['public'],
        delete: ['self'],
      },
      indexes: [
        { fields: ['postId', 'userId'], unique: true },
      ],
    },

    UserFollow: {
      fields: {
        followerId: { type: 'reference', entity: 'User', required: true },
        followingId: { type: 'reference', entity: 'User', required: true },
        createdAt: { type: 'timestamp', required: true },
      },
      access: {
        create: ['authenticated'],
        read: ['public'],
        delete: ['self'],
      },
      businessRules: [
        'Users cannot follow themselves',
      ],
      indexes: [
        { fields: ['followerId', 'followingId'], unique: true },
        { fields: ['followingId'] },
      ],
    },

    PostTag: {
      fields: {
        postId: { type: 'reference', entity: 'Post', required: true },
        tagId: { type: 'reference', entity: 'Tag', required: true },
      },
      indexes: [
        { fields: ['postId', 'tagId'], unique: true },
        { fields: ['tagId'] },
      ],
    },
  },
};
```

**Your Next Message:**
```
Perfect! Now generate the code from this model.
```

### Step 3: Code Generation

**AI Response:**
```bash
# Generate code from the data model
npm run generate __examples__/blog.model.ts

# This creates:
# - functions/src/entities/User.ts
# - functions/src/entities/Post.ts
# - functions/src/entities/Comment.ts
# - functions/src/entities/Category.ts
# - functions/src/entities/Tag.ts
# - functions/src/entities/PostLike.ts
# - functions/src/entities/UserFollow.ts
# - functions/src/entities/PostTag.ts
# - functions/src/repositories/UserRepository.ts
# - functions/src/repositories/PostRepository.ts
# - (and so on for all entities...)
# - functions/src/services/UserService.ts
# - functions/src/services/PostService.ts
# - (and so on...)
# - functions/src/controllers/UserController.ts
# - functions/src/controllers/PostController.ts
# - (and so on...)
```

### Step 4: Custom Business Logic

**Your Message:**
```
Now I need custom logic:
1. When a post is published, send email notifications to all followers
2. Automatically generate slug from title when creating posts
3. Prevent users from liking their own posts
```

**AI Creates Custom Service Methods:**

```typescript
// functions/src/services/PostService.ts
import { BaseService } from '../base/BaseService';
import { Post, CreatePostDto } from '../entities/Post';
import { PostRepository } from '../repositories/PostRepository';
import { eventBus } from '../utilities/events';
import { logger } from '../utilities/logger';

export class PostService extends BaseService<Post> {
  constructor(
    private postRepository: PostRepository
  ) {
    super(postRepository);
  }

  /**
   * Create a new post with auto-generated slug
   */
  async createPost(data: CreatePostDto, authorId: string): Promise<Post> {
    // 1. Generate slug from title
    const slug = this.generateSlug(data.title);

    // 2. Check slug uniqueness
    const existing = await this.postRepository.findBySlug(slug);
    if (existing) {
      throw new Error('A post with this title already exists');
    }

    // 3. Create post
    const post = await this.postRepository.create({
      ...data,
      slug,
      authorId,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // 4. Publish event
    eventBus.publish('post.created', { post });

    logger.info('Post created', { postId: post.id, authorId });

    return post;
  }

  /**
   * Publish a post and notify followers
   */
  async publishPost(postId: string, authorId: string): Promise<Post> {
    // 1. Get post
    const post = await this.postRepository.findById(postId);
    if (!post) {
      throw new Error('Post not found');
    }

    // 2. Check authorization
    if (post.authorId !== authorId) {
      throw new Error('Unauthorized: You can only publish your own posts');
    }

    // 3. Check if already published
    if (post.published) {
      throw new Error('Post is already published');
    }

    // 4. Update post
    const updatedPost = await this.postRepository.update(postId, {
      published: true,
      publishedAt: new Date(),
      updatedAt: new Date(),
    });

    // 5. Publish event (subscribers will handle notifications)
    eventBus.publish('post.published', {
      post: updatedPost,
      authorId,
    });

    logger.info('Post published', { postId, authorId });

    return updatedPost;
  }

  /**
   * Like a post
   */
  async likePost(postId: string, userId: string): Promise<void> {
    // 1. Get post
    const post = await this.postRepository.findById(postId);
    if (!post) {
      throw new Error('Post not found');
    }

    // 2. Prevent self-liking
    if (post.authorId === userId) {
      throw new Error('You cannot like your own post');
    }

    // 3. Check if already liked
    const existingLike = await this.postLikeRepository.findOne({
      postId,
      userId,
    });

    if (existingLike) {
      throw new Error('You have already liked this post');
    }

    // 4. Create like
    await this.postLikeRepository.create({
      postId,
      userId,
      createdAt: new Date(),
    });

    // 5. Publish event
    eventBus.publish('post.liked', { postId, userId });

    logger.info('Post liked', { postId, userId });
  }

  /**
   * Generate URL-safe slug from title
   */
  private generateSlug(title: string): string {
    return title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }
}
```

**AI Creates Event Subscriber:**

```typescript
// functions/src/subscribers/post-subscribers.ts
import { eventBus } from '../utilities/events';
import { logger } from '../utilities/logger';
import { emailConnector } from '../utilities/email-connector';
import { UserFollowRepository } from '../repositories/UserFollowRepository';
import { UserRepository } from '../repositories/UserRepository';

/**
 * Send email notifications when a post is published
 */
eventBus.subscribe('post.published', async (event) => {
  try {
    const { post, authorId } = event.payload;

    logger.info('Notifying followers about new post', {
      postId: post.id,
      authorId,
    });

    // 1. Get all followers
    const followRepository = new UserFollowRepository();
    const follows = await followRepository.findFollowersByUserId(authorId);

    if (follows.length === 0) {
      logger.info('No followers to notify', { authorId });
      return;
    }

    // 2. Get follower user data
    const userRepository = new UserRepository();
    const followerIds = follows.map(f => f.followerId);
    const followers = await userRepository.findByIds(followerIds);

    // 3. Send emails in batches
    const emailPromises = followers.map(follower =>
      emailConnector.sendEmail({
        to: follower.email,
        subject: `New post from ${post.author.displayName}`,
        html: `
          <h2>${post.title}</h2>
          <p>${post.excerpt}</p>
          <a href="https://yourdomain.com/posts/${post.slug}">Read more</a>
        `,
      })
    );

    await Promise.allSettled(emailPromises);

    logger.info('Follower notifications sent', {
      postId: post.id,
      notificationCount: followers.length,
    });
  } catch (error) {
    logger.error('Failed to send follower notifications', {
      error: error.message,
      event,
    });
  }
});

/**
 * Track post analytics when liked
 */
eventBus.subscribe('post.liked', async (event) => {
  try {
    const { postId, userId } = event.payload;

    // Update analytics, send notification to author, etc.
    logger.info('Post liked', { postId, userId });
  } catch (error) {
    logger.error('Failed to process post like', {
      error: error.message,
      event,
    });
  }
});
```

### Step 5: Register Routes

**AI Modifies:** `functions/src/app.ts`

```typescript
import express from 'express';
import { PostController } from './controllers/PostController';
import { PostService } from './services/PostService';
import { PostRepository } from './repositories/PostRepository';
import { UserController } from './controllers/UserController';
import { UserService } from './services/UserService';
import { UserRepository } from './repositories/UserRepository';
// ... other imports

// Import subscribers to register event handlers
import './subscribers/post-subscribers';
import './subscribers/user-subscribers';

const app = express();

// Middleware setup
app.use(express.json());
app.use(corsMiddleware);
app.use(requestIdMiddleware);

// Initialize repositories
const postRepository = new PostRepository();
const userRepository = new UserRepository();

// Initialize services
const postService = new PostService(postRepository);
const userService = new UserService(userRepository);

// Initialize controllers
const postController = new PostController(postService, '/api/v1/posts');
const userController = new UserController(userService, '/api/v1/users');

// Register routes
postController.registerRoutes(app);
userController.registerRoutes(app);

export { app };
```

### Step 6: Testing

**Your Message:**
```
Now write tests for the PostService, especially:
- Creating posts with auto-generated slugs
- Publishing posts
- Preventing self-likes
```

**AI Creates Tests:**

```typescript
// functions/src/services/__tests__/PostService.test.ts
import { PostService } from '../PostService';
import { PostRepository } from '../../repositories/PostRepository';
import { eventBus } from '../../utilities/events';

jest.mock('../../repositories/PostRepository');
jest.mock('../../utilities/events');

describe('PostService', () => {
  let postService: PostService;
  let mockPostRepository: jest.Mocked<PostRepository>;

  beforeEach(() => {
    mockPostRepository = new PostRepository() as jest.Mocked<PostRepository>;
    postService = new PostService(mockPostRepository);
    jest.clearAllMocks();
  });

  describe('createPost', () => {
    it('creates post with auto-generated slug from title', async () => {
      const postData = {
        title: 'Hello World Post!',
        content: 'This is my first post',
        categoryId: 'cat-123',
      };

      mockPostRepository.findBySlug.mockResolvedValue(null);
      mockPostRepository.create.mockResolvedValue({
        id: 'post-123',
        ...postData,
        slug: 'hello-world-post',
        authorId: 'user-123',
        published: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await postService.createPost(postData, 'user-123');

      expect(result.slug).toBe('hello-world-post');
      expect(mockPostRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          slug: 'hello-world-post',
          authorId: 'user-123',
        })
      );
      expect(eventBus.publish).toHaveBeenCalledWith('post.created', {
        post: result,
      });
    });

    it('throws error if slug already exists', async () => {
      const postData = {
        title: 'Existing Post',
        content: 'Content',
        categoryId: 'cat-123',
      };

      mockPostRepository.findBySlug.mockResolvedValue({
        id: 'existing-post',
        slug: 'existing-post',
      } as any);

      await expect(
        postService.createPost(postData, 'user-123')
      ).rejects.toThrow('A post with this title already exists');
    });
  });

  describe('publishPost', () => {
    it('publishes post and emits event', async () => {
      const existingPost = {
        id: 'post-123',
        title: 'Test Post',
        authorId: 'user-123',
        published: false,
      };

      mockPostRepository.findById.mockResolvedValue(existingPost as any);
      mockPostRepository.update.mockResolvedValue({
        ...existingPost,
        published: true,
        publishedAt: expect.any(Date),
      } as any);

      const result = await postService.publishPost('post-123', 'user-123');

      expect(result.published).toBe(true);
      expect(eventBus.publish).toHaveBeenCalledWith('post.published', {
        post: result,
        authorId: 'user-123',
      });
    });

    it('throws error if user is not author', async () => {
      mockPostRepository.findById.mockResolvedValue({
        id: 'post-123',
        authorId: 'user-456',
        published: false,
      } as any);

      await expect(
        postService.publishPost('post-123', 'user-123')
      ).rejects.toThrow('Unauthorized: You can only publish your own posts');
    });

    it('throws error if post already published', async () => {
      mockPostRepository.findById.mockResolvedValue({
        id: 'post-123',
        authorId: 'user-123',
        published: true,
      } as any);

      await expect(
        postService.publishPost('post-123', 'user-123')
      ).rejects.toThrow('Post is already published');
    });
  });

  describe('likePost', () => {
    it('allows user to like another users post', async () => {
      mockPostRepository.findById.mockResolvedValue({
        id: 'post-123',
        authorId: 'user-456',
      } as any);

      mockPostLikeRepository.findOne.mockResolvedValue(null);
      mockPostLikeRepository.create.mockResolvedValue({
        postId: 'post-123',
        userId: 'user-123',
      } as any);

      await postService.likePost('post-123', 'user-123');

      expect(mockPostLikeRepository.create).toHaveBeenCalledWith({
        postId: 'post-123',
        userId: 'user-123',
        createdAt: expect.any(Date),
      });
      expect(eventBus.publish).toHaveBeenCalledWith('post.liked', {
        postId: 'post-123',
        userId: 'user-123',
      });
    });

    it('prevents user from liking their own post', async () => {
      mockPostRepository.findById.mockResolvedValue({
        id: 'post-123',
        authorId: 'user-123',
      } as any);

      await expect(
        postService.likePost('post-123', 'user-123')
      ).rejects.toThrow('You cannot like your own post');

      expect(mockPostLikeRepository.create).not.toHaveBeenCalled();
    });

    it('prevents duplicate likes', async () => {
      mockPostRepository.findById.mockResolvedValue({
        id: 'post-123',
        authorId: 'user-456',
      } as any);

      mockPostLikeRepository.findOne.mockResolvedValue({
        postId: 'post-123',
        userId: 'user-123',
      } as any);

      await expect(
        postService.likePost('post-123', 'user-123')
      ).rejects.toThrow('You have already liked this post');
    });
  });
});
```

### Step 7: Deploy

**Your Message:**
```
Everything looks good! Let's deploy to staging.
```

**AI Response:**
```bash
# Build the project
npm run build

# Run tests
npm test

# Validate configuration
npm run validate

# Deploy to Firebase staging
firebase use staging
firebase deploy --only functions

# Verify deployment
curl https://staging-api.yourdomain.com/health
```

---

## 🎓 Best Practices for AI Agents

### DO ✅

1. **Always extend base classes**
   ```typescript
   export class ProductService extends BaseService<Product> { }
   ```

2. **Always use existing utilities**
   ```typescript
   import { logger } from '../utilities/logger';
   import { eventBus } from '../utilities/events';
   ```

3. **Always publish events for side effects**
   ```typescript
   await this.repository.create(entity);
   this.eventBus.publish('entity.created', { entity });
   ```

4. **Always validate and authorize**
   ```typescript
   async createEntity(data: CreateDto, userId: string) {
     // 1. Validate input
     await this.validate(data);

     // 2. Check authorization
     await this.authorize('create', userId);

     // 3. Business logic
     const entity = await this.repository.create(data);

     return entity;
   }
   ```

5. **Always use DTOs for API contracts**
   ```typescript
   export interface CreatePostDto {
     title: string;
     content: string;
     categoryId: string;
   }
   ```

6. **Always write behavioral tests**
   ```typescript
   it('prevents user from liking their own post', async () => {
     await expect(service.likePost(postId, authorId))
       .rejects.toThrow('You cannot like your own post');
   });
   ```

### DON'T ❌

1. **Don't modify base classes or utilities**
   ```typescript
   // ❌ NEVER DO THIS
   // Modifying: functions/src/base/BaseService.ts
   ```

2. **Don't bypass the layered architecture**
   ```typescript
   // ❌ WRONG - Controller directly accessing database
   const user = await db.collection('users').doc(id).get();

   // ✅ CORRECT - Controller → Service → Repository
   const user = await this.service.getUserById(id);
   ```

3. **Don't create custom infrastructure**
   ```typescript
   // ❌ WRONG - Creating custom auth middleware
   const myAuthMiddleware = (req, res, next) => { };

   // ✅ CORRECT - Use existing middleware
   import { authMiddleware } from './middleware/auth.middleware';
   ```

4. **Don't handle async operations in controllers**
   ```typescript
   // ❌ WRONG - Business logic in controller
   async createPost(req, res) {
     const post = await db.collection('posts').add(req.body);
     await emailService.sendNotification();
     res.json(post);
   }

   // ✅ CORRECT - Delegate to service
   async createPost(req, res) {
     const post = await this.service.createPost(req.body, req.user.uid);
     res.json(post);
   }
   ```

5. **Don't use console.log**
   ```typescript
   // ❌ WRONG
   console.log('User created', user);

   // ✅ CORRECT
   logger.info('User created', { userId: user.id });
   ```

---

## 🔍 Debugging with AI

### When Things Go Wrong

**Your Message:**
```
I'm getting this error when trying to create a post:
"TypeError: Cannot read property 'create' of undefined"
```

**AI Debugging Process:**

1. **Check the stack trace**
2. **Verify dependency injection**
3. **Check repository initialization**
4. **Review controller registration**

**AI Response:**
```
The error suggests that the repository is not properly initialized in your service.

Check functions/src/app.ts:

// ❌ WRONG - Repository not passed to service
const postService = new PostService();

// ✅ CORRECT - Repository passed to service
const postRepository = new PostRepository();
const postService = new PostService(postRepository);

Also ensure PostService constructor accepts the repository:

export class PostService extends BaseService<Post> {
  constructor(private postRepository: PostRepository) {
    super(postRepository);
  }
}
```

---

## 📊 Performance Considerations

### Query Optimization

**AI should create efficient queries:**

```typescript
// ❌ BAD - N+1 query problem
async getPostsWithAuthors() {
  const posts = await this.postRepository.findAll();
  for (const post of posts) {
    post.author = await this.userRepository.findById(post.authorId);
  }
  return posts;
}

// ✅ GOOD - Batch loading
async getPostsWithAuthors() {
  const posts = await this.postRepository.findAll();
  const authorIds = [...new Set(posts.map(p => p.authorId))];
  const authors = await this.userRepository.findByIds(authorIds);
  const authorMap = new Map(authors.map(a => [a.id, a]));

  return posts.map(post => ({
    ...post,
    author: authorMap.get(post.authorId),
  }));
}
```

### Caching Strategy

```typescript
// Add caching for frequently accessed data
import { cache } from '../utilities/cache';

async getCategoryById(id: string): Promise<Category> {
  const cacheKey = `category:${id}`;

  // Check cache first
  const cached = await cache.get(cacheKey);
  if (cached) {
    return cached;
  }

  // Fetch from database
  const category = await this.repository.findById(id);

  // Cache for 1 hour
  await cache.set(cacheKey, category, 3600);

  return category;
}
```

---

## 🎯 Success Checklist

Before considering a feature "done", ensure:

- [ ] Data model is defined and validated
- [ ] Code is generated and customized
- [ ] Custom business logic is implemented
- [ ] Event subscribers are created (if needed)
- [ ] Routes are registered in app.ts
- [ ] All tests pass (`npm test`)
- [ ] Type checking passes (`npm run build`)
- [ ] Linting passes (`npm run lint`)
- [ ] Validation passes (`npm run validate`)
- [ ] API endpoints are documented
- [ ] Error handling is comprehensive
- [ ] Logging is in place
- [ ] Security is considered (auth, validation, sanitization)
- [ ] Performance is optimized (queries, caching)
- [ ] Deployment is successful

---

## 📚 Additional Resources

- **Example Models**: See `__examples__/` directory
- **Base Classes**: Review `functions/src/base/` for patterns
- **Utilities**: Explore `functions/src/utilities/` for available tools
- **Testing**: Read `functions/src/__tests__/README.md`
- **Configuration**: Check `functions/src/config/`

---

## 🆘 Getting Help

If the AI agent gets stuck or confused:

1. **Review the data model** - Is it complete and valid?
2. **Check the logs** - What does `logger` say?
3. **Run validation** - Does `npm run validate` pass?
4. **Review this guide** - Are you following the mandated structure?
5. **Check examples** - Look at `__examples__/` for reference

---

**Remember:** The boilerplate provides the infrastructure. AI provides the business logic. You provide the requirements and oversight. Together, you can build production-ready APIs in days, not months.
