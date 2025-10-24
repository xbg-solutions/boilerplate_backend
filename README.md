# Backend Boilerplate

> Production-ready backend scaffolding system with intelligent code generation via Claude Code CLI

## 🚀 Overview

This backend boilerplate enables rapid MVP development through automated code generation. Define your data models in a declarative format, and the system generates:

- ✅ **Type-safe entities** with validation
- ✅ **Repository layer** for database operations
- ✅ **Service layer** with business logic orchestration
- ✅ **Controller layer** with REST API endpoints
- ✅ **Event-driven architecture** with built-in event bus
- ✅ **Security-first design** with authentication, authorization, and rate limiting
- ✅ **Production-ready middleware** stack

## 📋 Features

### Core Infrastructure
- **Express application** with configurable middleware pipeline
- **Firebase Functions** integration for serverless deployment
- **Multi-database support** via Firestore connector
- **JWT authentication** with token blacklisting
- **Structured logging** with PII protection
- **Event-driven choreography** for loose coupling

### Code Generation
- **Declarative data models** in TypeScript
- **Automatic CRUD generation** for entities
- **Relationship handling** (one-to-one, one-to-many, many-to-many)
- **Access control rules** generation
- **Input validation** from field definitions
- **Business rule documentation** in generated code

### Security & Middleware
- **CORS** configuration (environment-aware)
- **Rate limiting** (per-IP and per-user)
- **Request ID tracking** for correlation
- **Input sanitization** and validation
- **Error handling** with standardized responses
- **Helmet.js** security headers (production)

### Developer Experience
- **Interactive setup wizard** for project configuration
- **Hot reloading** for local development
- **Comprehensive examples** and documentation
- **Type safety** throughout (100% TypeScript)
- **Deployment automation** with safety checks

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    HTTP Request                             │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│              Middleware Pipeline                            │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐      │
│  │  CORS    │→│   Auth   │→│   Rate   │→│Validation│      │
│  │          │ │          │ │  Limit   │ │          │      │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘      │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                   Controller Layer                          │
│              (HTTP Request/Response)                        │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                    Service Layer                            │
│            (Business Logic Orchestration)                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │ Validation   │  │ Authorization│  │ Event Pub    │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                 Repository Layer                            │
│               (Database Abstraction)                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │   Queries    │  │ Transactions │  │    Cache     │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                    Firestore                                │
└─────────────────────────────────────────────────────────────┘

                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                    Event Bus                                │
│            (Asynchronous Event Handling)                    │
└─────────────────────────────────────────────────────────────┘
```

## 🚦 Quick Start

### Prerequisites
- Node.js 18+
- Firebase CLI (`npm install -g firebase-tools`)
- Firebase project

### Installation

1. **Clone the repository**
```bash
git clone <repository-url>
cd boilerplate_backend
```

2. **Run setup wizard**
```bash
cd functions
npm install
npm run setup
```

3. **Create a data model** (or use example)
```bash
# Use the example model
cp examples/user.model.ts examples/my-model.ts
# Edit examples/my-model.ts to define your entities
```

4. **Generate code**
```bash
npm run generate examples/my-model.ts
```

5. **Register controllers**
Edit `functions/src/index.ts`:
```typescript
import { UserController } from './generated/controllers/UserController';
import { UserService } from './generated/services/UserService';
import { UserRepository } from './generated/repositories/UserRepository';
import { getFirestore } from 'firebase-admin/firestore';

const db = getFirestore();
const userRepo = new UserRepository(db);
const userService = new UserService(userRepo);
const userController = new UserController(userService, '/users');

const controllers = [userController];
```

6. **Build and run locally**
```bash
npm run build
npm start
```

7. **Test your API**
```bash
curl http://localhost:5001/health
curl http://localhost:5001/api/v1/users
```

## 📖 Data Model Format

Define your entities in a declarative TypeScript format:

```typescript
import { DataModelSpecification } from '../functions/src/generator/types';

export const MyModel: DataModelSpecification = {
  entities: {
    User: {
      fields: {
        email: {
          type: 'email',
          unique: true,
          required: true,
        },
        role: {
          type: 'enum',
          values: ['admin', 'member', 'guest'],
          default: 'member',
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
          cascadeDelete: true,
        },
      },

      access: {
        create: ['public'],
        read: ['self', 'admin'],
        update: ['self', 'admin'],
        delete: ['admin'],
      },

      validation: {
        email: 'Must be unique valid email',
      },

      indexes: [
        { fields: ['email'], unique: true },
      ],

      businessRules: [
        'Email must be verified before activation',
        'Admins cannot delete themselves',
      ],
    },
  },
};
```

See `examples/user.model.ts` for a complete example.

## 🛠️ Configuration

All configuration is centralized in `functions/src/config/`:

### app.config.ts
- Application name, version, environment
- API base path and CORS origins
- Feature flags
- Integration settings

### database.config.ts
- Multi-database configuration
- Connection pooling
- Collection mappings

### auth.config.ts
- JWT settings
- Auth provider configuration
- Session management
- Security rules

### middleware.config.ts
- Middleware pipeline ordering
- Rate limiting settings
- Body parser limits
- Logging configuration

## 📚 Documentation

- [Architecture Overview](docs/architecture-overview.md)
- [Development Guide](docs/development-guide.md)
- [Deployment Guide](docs/deployment-guide.md)
- [API Documentation](docs/api-documentation.md)

## 🧪 Testing

```bash
# Run unit tests
npm test

# Run tests with coverage
npm run test:coverage

# Run tests in watch mode
npm run test:watch
```

## 🚀 Deployment

```bash
# Deploy to Firebase
npm run deploy

# Deploy with force (skip tests)
npm run deploy -- --force

# View logs
npm run logs
```

## 📁 Project Structure

```
boilerplate_backend/
├── functions/
│   ├── src/
│   │   ├── config/              # Centralized configuration
│   │   ├── base/                # Base classes
│   │   ├── middleware/          # Express middleware
│   │   ├── utilities/           # Utility functions
│   │   ├── generator/           # Code generation engine
│   │   ├── templates/           # Handlebars templates
│   │   ├── generated/           # Generated code (gitignored)
│   │   ├── app.ts               # Express app setup
│   │   ├── index.ts             # Firebase Functions entry
│   │   └── server.ts            # Local dev server
│   ├── package.json
│   └── tsconfig.json
├── scripts/
│   ├── setup.js                 # Interactive setup
│   ├── generate.js              # Code generation
│   └── deploy.js                # Deployment automation
├── examples/
│   └── user.model.ts            # Example data model
├── docs/
│   └── ...                      # Documentation
└── README.md
```

## 🔧 Available Scripts

```bash
npm run setup      # Interactive project setup
npm run generate   # Generate code from data model
npm run build      # Compile TypeScript
npm start          # Start local development server
npm test           # Run tests
npm run lint       # Run linter
npm run deploy     # Deploy to Firebase
npm run logs       # View Firebase logs
```

## 🎯 Roadmap

- [ ] OpenAPI/Swagger documentation generation
- [ ] GraphQL support
- [ ] Database migration system
- [ ] Integration test generation
- [ ] Docker support
- [ ] Kubernetes deployment templates
- [ ] WebSocket support
- [ ] Background job queue

## 🤝 Contributing

Contributions are welcome! Please read the contributing guidelines first.

## 📄 License

MIT License - see LICENSE file for details

## 💡 Support

- **Documentation**: See `docs/` directory
- **Examples**: See `examples/` directory
- **Issues**: GitHub Issues

## 🎉 Acknowledgments

Built with:
- Express.js
- Firebase Functions
- TypeScript
- Handlebars
- And many other great open-source projects

---

**Happy coding!** 🚀
