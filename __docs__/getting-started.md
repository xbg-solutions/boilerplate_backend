# Getting Started Guide

## Prerequisites

Before you begin, ensure you have:

- **Node.js 18+** installed
- **npm** or **yarn** package manager
- **Firebase CLI** installed globally: `npm install -g firebase-tools`
- A **Firebase project** (create one at [console.firebase.google.com](https://console.firebase.google.com))

## Step 1: Initial Setup

### 1.1 Install Dependencies

```bash
cd functions
npm install
```

### 1.2 Run Setup Wizard

```bash
npm run setup
```

The setup wizard will ask you for:
- Project name
- Firebase project ID
- Environment (development/staging/production)
- CORS origins
- Feature flags

This creates a `.env` file with your configuration.

### 1.3 Configure Firebase

```bash
firebase login
firebase use <your-project-id>
```

## Step 2: Define Your Data Model

Create a new file in `examples/` directory (or copy the example):

```typescript
// examples/blog.model.ts
import { DataModelSpecification } from '../functions/src/generator/types';

export const BlogModel: DataModelSpecification = {
  entities: {
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
        authorId: {
          type: 'reference',
          required: true,
        },
        published: {
          type: 'boolean',
          default: false,
        },
        publishedAt: {
          type: 'timestamp',
          nullable: true,
        },
      },
      access: {
        create: ['authenticated'],
        read: ['public'],
        update: ['owner', 'admin'],
        delete: ['owner', 'admin'],
      },
      indexes: [
        { fields: ['authorId'] },
        { fields: ['published', 'publishedAt'] },
      ],
    },
  },
};
```

## Step 3: Generate Code

```bash
npm run generate examples/blog.model.ts
```

This generates:
- `generated/entities/Post.ts` - Entity class with validation
- `generated/repositories/PostRepository.ts` - Database operations
- `generated/services/PostService.ts` - Business logic
- `generated/controllers/PostController.ts` - REST API endpoints

## Step 4: Register Controllers

Edit `functions/src/index.ts`:

```typescript
import { createApp } from './app';
import { PostController } from './generated/controllers/PostController';
import { PostService } from './generated/services/PostService';
import { PostRepository } from './generated/repositories/PostRepository';
import { getFirestore } from 'firebase-admin/firestore';
import * as admin from 'firebase-admin';

// Initialize Firebase Admin
admin.initializeApp();

const db = getFirestore();

// Initialize Post components
const postRepo = new PostRepository(db);
const postService = new PostService(postRepo);
const postController = new PostController(postService, '/posts');

// Create app with controllers
const expressApp = createApp({
  controllers: [postController],
});

export const api = functions.https.onRequest(expressApp);
```

## Step 5: Build and Run Locally

```bash
# Build TypeScript
npm run build

# Start local server
npm start
```

Your API is now running at `http://localhost:5001`!

## Step 6: Test Your API

### Health Check
```bash
curl http://localhost:5001/health
```

### Create a Post
```bash
curl -X POST http://localhost:5001/api/v1/posts \
  -H "Content-Type: application/json" \
  -d '{
    "title": "My First Post",
    "content": "Hello, world!",
    "authorId": "user123"
  }'
```

### Get All Posts
```bash
curl http://localhost:5001/api/v1/posts
```

### Get Single Post
```bash
curl http://localhost:5001/api/v1/posts/<post-id>
```

## Step 7: Deploy to Firebase

```bash
npm run deploy
```

This will:
1. Run linter
2. Build TypeScript
3. Run tests (if available)
4. Deploy to Firebase Functions

Your API will be available at:
```
https://<region>-<project-id>.cloudfunctions.net/api
```

## Next Steps

- **Add Authentication**: Implement JWT token verification
- **Custom Business Logic**: Add methods to service classes
- **Custom Routes**: Add endpoints to controller classes
- **Event Handlers**: Subscribe to events in the event bus
- **Relationships**: Define entity relationships in your model

## Common Tasks

### Adding a New Entity

1. Add entity to your data model specification
2. Run `npm run generate examples/your-model.ts`
3. Register controller in `index.ts`
4. Build and test

### Customizing Generated Code

Generated code is meant to be customized. Feel free to:
- Add custom methods to services
- Add custom routes to controllers
- Extend validation logic
- Add computed properties to entities

### Working with Events

Subscribe to entity events in your workflow:

```typescript
import { eventBus } from './utilities/events';

eventBus.subscribe('POST_CREATED', async (payload) => {
  // Handle post creation
  console.log('New post created:', payload.entityId);
});
```

## Troubleshooting

### Build Errors

```bash
# Clean and rebuild
rm -rf lib/
npm run build
```

### Port Already in Use

Change the port in `.env`:
```
PORT=5002
```

### Firebase Permissions

Ensure your Firebase service account has the necessary permissions:
- Cloud Functions Developer
- Cloud Datastore User

See [Firebase documentation](https://firebase.google.com/docs/functions) for more details.
