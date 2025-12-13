/**
 * Blog Platform Data Model
 *
 * A complete blog platform with:
 * - User authentication and profiles
 * - Posts with categories and tags
 * - Comments with threading
 * - Social features (likes, follows)
 * - Content moderation
 *
 * Features demonstrated:
 * - One-to-many relationships (User → Posts)
 * - Many-to-many relationships (Posts → Tags)
 * - Self-referencing relationships (Comment replies)
 * - Access control rules
 * - Business rules and validation
 * - Optimized indexes
 *
 * To use this model:
 * 1. Copy to your project
 * 2. Run: npm run generate __examples__/blog-platform.model.ts
 * 3. Register controllers in functions/src/app.ts
 * 4. Deploy: npm run deploy
 */

import { DataModelSpecification } from '../functions/src/generator/types';

export const BlogPlatformModel: DataModelSpecification = {
  entities: {
    User: {
      fields: {
        email: {
          type: 'email',
          unique: true,
          required: true,
        },
        username: {
          type: 'string',
          unique: true,
          required: true,
        },
        displayName: {
          type: 'string',
          required: true,
        },
        bio: {
          type: 'text',
          required: false,
        },
        avatarUrl: {
          type: 'url',
          required: false,
        },
        isVerified: {
          type: 'boolean',
          default: false,
        },
        role: {
          type: 'enum',
          values: ['reader', 'author', 'moderator', 'admin'],
          default: 'reader',
        },
        status: {
          type: 'enum',
          values: ['active', 'suspended', 'deleted'],
          default: 'active',
        },
        lastLoginAt: {
          type: 'timestamp',
          required: false,
        },
        createdAt: {
          type: 'timestamp',
          required: true,
        },
        updatedAt: {
          type: 'timestamp',
          required: true,
        },
      },
      relationships: {
        posts: {
          type: 'one-to-many',
          entity: 'Post',
          foreignKey: 'authorId',
          cascadeDelete: false, // Keep posts when user is deleted (anonymize instead)
        },
        comments: {
          type: 'one-to-many',
          entity: 'Comment',
          foreignKey: 'authorId',
          cascadeDelete: false,
        },
        likedPosts: {
          type: 'many-to-many',
          entity: 'Post',
          through: 'PostLike',
        },
        following: {
          type: 'many-to-many',
          entity: 'User',
          through: 'UserFollow',
          foreignKey: 'followerId',
          relatedKey: 'followingId',
        },
      },
      access: {
        create: ['public'], // Public registration
        read: ['public'],
        update: ['self', 'admin'],
        delete: ['self', 'admin'],
      },
      validation: {
        email: 'Must be a valid email address',
        username: 'Must be 3-30 characters, alphanumeric and underscores only',
        displayName: 'Must be 1-100 characters',
      },
      businessRules: [
        'Email must be verified before user can publish posts',
        'Suspended users cannot create posts or comments',
        'Deleted users have their personal data anonymized',
        'Users cannot follow themselves',
      ],
      indexes: [
        { fields: ['email'], unique: true },
        { fields: ['username'], unique: true },
        { fields: ['status'] },
        { fields: ['createdAt'] },
      ],
    },

    Post: {
      fields: {
        title: {
          type: 'string',
          required: true,
        },
        slug: {
          type: 'string',
          unique: true,
          required: true,
        },
        content: {
          type: 'text',
          required: true,
        },
        excerpt: {
          type: 'string',
          required: false,
        },
        coverImageUrl: {
          type: 'url',
          required: false,
        },
        status: {
          type: 'enum',
          values: ['draft', 'published', 'archived', 'flagged'],
          default: 'draft',
        },
        publishedAt: {
          type: 'timestamp',
          required: false,
        },
        authorId: {
          type: 'reference',
          entity: 'User',
          required: true,
        },
        categoryId: {
          type: 'reference',
          entity: 'Category',
          required: true,
        },
        viewCount: {
          type: 'number',
          default: 0,
        },
        likeCount: {
          type: 'number',
          default: 0,
        },
        commentCount: {
          type: 'number',
          default: 0,
        },
        readingTimeMinutes: {
          type: 'number',
          required: false,
        },
        isFeatured: {
          type: 'boolean',
          default: false,
        },
        createdAt: {
          type: 'timestamp',
          required: true,
        },
        updatedAt: {
          type: 'timestamp',
          required: true,
        },
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
          cascadeDelete: true,
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
        create: ['author', 'admin'],
        read: ['public'], // Anyone can read published posts
        update: ['self', 'admin'],
        delete: ['self', 'admin'],
      },
      validation: {
        title: 'Must be 5-200 characters',
        slug: 'Must be URL-safe and unique',
        content: 'Must not be empty',
      },
      businessRules: [
        'Slug is auto-generated from title',
        'Published posts cannot be unpublished (only archived)',
        'Posts must belong to an active category',
        'Reading time is calculated from content length',
        'Only verified users can publish posts',
      ],
      indexes: [
        { fields: ['slug'], unique: true },
        { fields: ['authorId', 'status'] },
        { fields: ['categoryId', 'status'] },
        { fields: ['status', 'publishedAt'] },
        { fields: ['isFeatured', 'publishedAt'] },
      ],
    },

    Comment: {
      fields: {
        content: {
          type: 'text',
          required: true,
        },
        postId: {
          type: 'reference',
          entity: 'Post',
          required: true,
        },
        authorId: {
          type: 'reference',
          entity: 'User',
          required: true,
        },
        parentId: {
          type: 'reference',
          entity: 'Comment',
          required: false,
        },
        status: {
          type: 'enum',
          values: ['visible', 'flagged', 'deleted'],
          default: 'visible',
        },
        isEdited: {
          type: 'boolean',
          default: false,
        },
        createdAt: {
          type: 'timestamp',
          required: true,
        },
        updatedAt: {
          type: 'timestamp',
          required: true,
        },
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
          cascadeDelete: true,
        },
      },
      access: {
        create: ['authenticated'],
        read: ['public'],
        update: ['self', 'moderator', 'admin'],
        delete: ['self', 'moderator', 'admin'],
      },
      validation: {
        content: 'Must be 1-2000 characters',
      },
      businessRules: [
        'Comments can be nested up to 3 levels deep',
        'Deleted comments show [deleted] placeholder',
        'Flagged comments are hidden from public view',
        'Users can edit comments within 5 minutes of posting',
      ],
      indexes: [
        { fields: ['postId', 'status', 'createdAt'] },
        { fields: ['authorId'] },
        { fields: ['parentId'] },
      ],
    },

    Category: {
      fields: {
        name: {
          type: 'string',
          unique: true,
          required: true,
        },
        slug: {
          type: 'string',
          unique: true,
          required: true,
        },
        description: {
          type: 'text',
          required: false,
        },
        color: {
          type: 'string',
          required: false,
        },
        icon: {
          type: 'string',
          required: false,
        },
        isActive: {
          type: 'boolean',
          default: true,
        },
        postCount: {
          type: 'number',
          default: 0,
        },
        order: {
          type: 'number',
          default: 0,
        },
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
      validation: {
        name: 'Must be 2-50 characters',
        slug: 'Must be URL-safe',
      },
      businessRules: [
        'Categories with posts cannot be deleted',
        'At least one category must exist',
      ],
      indexes: [
        { fields: ['slug'], unique: true },
        { fields: ['isActive', 'order'] },
      ],
    },

    Tag: {
      fields: {
        name: {
          type: 'string',
          unique: true,
          required: true,
        },
        slug: {
          type: 'string',
          unique: true,
          required: true,
        },
        postCount: {
          type: 'number',
          default: 0,
        },
      },
      relationships: {
        posts: {
          type: 'many-to-many',
          entity: 'Post',
          through: 'PostTag',
        },
      },
      access: {
        create: ['author', 'admin'],
        read: ['public'],
        update: ['admin'],
        delete: ['admin'],
      },
      validation: {
        name: 'Must be 2-30 characters',
      },
      businessRules: [
        'Tags are automatically created when used in posts',
        'Tags with zero posts are periodically cleaned up',
      ],
      indexes: [
        { fields: ['slug'], unique: true },
        { fields: ['postCount'] },
      ],
    },

    PostLike: {
      fields: {
        postId: {
          type: 'reference',
          entity: 'Post',
          required: true,
        },
        userId: {
          type: 'reference',
          entity: 'User',
          required: true,
        },
        createdAt: {
          type: 'timestamp',
          required: true,
        },
      },
      access: {
        create: ['authenticated'],
        read: ['public'],
        delete: ['self'],
      },
      businessRules: [
        'Users cannot like their own posts',
        'Users can only like a post once',
      ],
      indexes: [
        { fields: ['postId', 'userId'], unique: true },
        { fields: ['userId'] },
      ],
    },

    UserFollow: {
      fields: {
        followerId: {
          type: 'reference',
          entity: 'User',
          required: true,
        },
        followingId: {
          type: 'reference',
          entity: 'User',
          required: true,
        },
        createdAt: {
          type: 'timestamp',
          required: true,
        },
      },
      access: {
        create: ['authenticated'],
        read: ['public'],
        delete: ['self'],
      },
      businessRules: [
        'Users cannot follow themselves',
        'Users can only follow once (no duplicates)',
      ],
      indexes: [
        { fields: ['followerId', 'followingId'], unique: true },
        { fields: ['followingId'] },
      ],
    },

    PostTag: {
      fields: {
        postId: {
          type: 'reference',
          entity: 'Post',
          required: true,
        },
        tagId: {
          type: 'reference',
          entity: 'Tag',
          required: true,
        },
      },
      indexes: [
        { fields: ['postId', 'tagId'], unique: true },
        { fields: ['tagId'] },
      ],
    },
  },
};
