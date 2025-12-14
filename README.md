# Node.js/TypeScript AI-Compatible Backend Boilerplate

An experiment by [XBG Solutions](https://xbg.solutions) aided by [Claude Code](https://www.claude.com/product/claude-code).

**Production-ready backend foundation optimized for AI-assisted data-to-code workflows.**

Build and launch backend APIs in **days, not months** using modern AI-assisted development patterns.

[![TypeScript](https://img.shields.io/badge/TypeScript-Strict-blue)](https://www.typescriptlang.org/)
[![Tests](https://img.shields.io/badge/Tests-807%20Passing-green)](./functions/src/__tests__)
[![License](https://img.shields.io/badge/License-MIT-yellow)](./LICENSE)

**Sister Project:** [boilerplate_frontend](https://github.com/xbg-solutions/boilerplate_frontend) - SvelteKit 5 frontend boilerplate

---

## 🎯 What Makes This Different

This boilerplate is specifically designed for:
- **AI-Assisted Development**: Declarative data models that AI can understand and generate code from
- **Rapid API Development**: Define your data model, generate CRUD endpoints in seconds
- **Design-to-Production Pipeline**: MoSCoW requirements → Data Model → Generated API → Deployment
- **Production Readiness**: 807 passing tests, security-first architecture, deployment infrastructure
- **Developer Experience**: Type-safe, event-driven, following modern best practices

### The Modern Development Workflow

```
1. Define Requirements        →  2. AI Generates Code        →  3. Deploy
   (MoSCoW + data model)          (CRUD + business logic)         (Firebase/Cloud)
   ↓                              ↓                               ↓
   Declare entities               +Controller/Service layers      npm run deploy
   Define relationships           +Repositories + validation      Done!
   Set access rules               +Event handling
```

---

## ✨ Key Features

### Core Stack
- **Node.js 18+**: Modern JavaScript runtime with ES2022+ features
- **TypeScript**: Strict mode enabled with comprehensive type definitions
- **Express.js**: Battle-tested web framework with custom middleware pipeline
- **Firebase Functions**: Serverless deployment with automatic scaling
- **Firestore**: NoSQL database with real-time capabilities
- **Jest**: Modern testing framework with 807 passing tests

### AI-Optimized Architecture
- **Declarative Data Models**: Define entities, relationships, and rules in one place
- **Automatic Code Generation**: Controllers, Services, Repositories generated from models
- **Single Configuration Pattern**: Centralized config in `functions/src/config/`
- **Consistent Import Patterns**: Standardized utilities and services
- **Comprehensive Documentation**: AI-specific comments and patterns throughout
- **Predictable Structure**: Layered architecture for reliable code generation

### Production Features
- **807 Passing Tests**: Comprehensive behavioral testing with Jest
- **Security First**: JWT auth, token blacklisting, PII encryption, rate limiting
- **Event-Driven Architecture**: Internal event bus for loose coupling
- **Multi-Database Support**: Multiple Firestore databases with connection management
- **Observability**: Structured logging with PII sanitization and correlation IDs
- **Deployment Ready**: CI/CD pipelines, validation scripts, multiple hosting options

---

## 🚀 Quick Start

### Prerequisites

- Node.js 18+ ([Download](https://nodejs.org/))
- Firebase account ([Create free](https://firebase.google.com/))
- Firebase CLI (`npm install -g firebase-tools`)
- Git

### Setup (3 Minutes)

```bash
# 1. Clone and install
git clone https://github.com/xbg-solutions/boilerplate_backend.git
cd boilerplate_backend/functions
npm install

# 2. Run interactive setup wizard
npm run setup

# The wizard will:
#   • Ask questions about your project
#   • Generate your .env file automatically
#   • Configure Firebase settings
#   • Install dependencies

# 3. Validate setup (optional but recommended)
npm run validate

# 4. Create your data model
# Edit __examples__/user.model.ts or create your own

# 5. Generate code from your model
npm run generate __examples__/user.model.ts

# 6. Start developing!
npm run build
npm start
```

Visit `http://localhost:5001/health` - you're ready to build! 🎉

---

## 💡 Core Philosophy: Declarative Data Models

### What We Provide

**Infrastructure & Utilities:**
- BaseController, BaseService, BaseRepository (extensible base classes)
- Authentication, authorization, and token management
- Event bus, logging, error handling
- Database connectors, validation utilities
- Communication connectors (CRM, Email, SMS, Push, ERP, etc.)
- Testing infrastructure and deployment pipelines

### What We DON'T Provide

**Pre-built Business Logic:**
- ❌ Pre-built domain models (User, Product, Order, etc.)
- ❌ Opinionated business rules
- ❌ Specific API endpoints

### Why?

In modern AI-assisted workflows:
1. **You define your data model** using our declarative format
2. **AI generates the business logic** (Controllers, Services, Repositories)
3. **Our boilerplate provides the foundation** that AI builds upon

This gives you **maximum flexibility** while maintaining **architectural consistency**.

```typescript
// AI reads this declarative model
export const BlogModel: DataModelSpecification = {
  entities: {
    Post: {
      fields: {
        title: { type: 'string', required: true },
        content: { type: 'text', required: true },
        published: { type: 'boolean', default: false },
        authorId: { type: 'reference', entity: 'User', required: true }
      },
      relationships: {
        author: { type: 'many-to-one', entity: 'User' },
        comments: { type: 'one-to-many', entity: 'Comment', foreignKey: 'postId' }
      },
      access: {
        create: ['authenticated'],
        read: ['public'],
        update: ['self', 'admin'],
        delete: ['admin']
      },
      validation: {
        title: 'Must be 5-200 characters',
        content: 'Cannot be empty'
      }
    }
  }
};

// AI generates this (or you write it following the pattern)
export class PostService extends BaseService<Post> {
  async createPost(data: CreatePostDto): Promise<Post> {
    // Validation
    await this.validate(data);

    // Authorization
    await this.authorize('create', data);

    // Business logic
    const post = await this.repository.create(data);

    // Event publishing
    this.eventBus.publish('post.created', { post });

    return post;
  }
}
```

---

## 🏗️ Project Structure

```
boilerplate_backend/
├── functions/
│   ├── src/
│   │   ├── config/                      # 🎯 Centralized configuration
│   │   │   ├── app.config.ts            #    Application settings
│   │   │   ├── auth.config.ts           #    Authentication config
│   │   │   ├── database.config.ts       #    Multi-database setup
│   │   │   └── middleware.config.ts     #    Middleware pipeline
│   │   ├── base/                        # Base classes for generation
│   │   │   ├── BaseController.ts        #    HTTP request handling
│   │   │   ├── BaseService.ts           #    Business logic orchestration
│   │   │   └── BaseRepository.ts        #    Database operations
│   │   ├── middleware/                  # Express middleware
│   │   │   ├── auth.middleware.ts       #    JWT verification
│   │   │   ├── error.middleware.ts      #    Error handling
│   │   │   ├── rate-limit.middleware.ts #    Rate limiting
│   │   │   └── validation.middleware.ts #    Input validation
│   │   ├── utilities/                   # Reusable utilities
│   │   │   ├── hashing/                 #    PII encryption (AES-256-GCM)
│   │   │   ├── logger/                  #    Structured logging + PII sanitization
│   │   │   ├── events/                  #    Internal event bus
│   │   │   ├── token-handler/           #    JWT + blacklisting
│   │   │   ├── firestore-connector/     #    Multi-database management
│   │   │   ├── address-validation/      #    Google Maps integration
│   │   │   ├── llm-connector/           #    AI/LLM integration (Claude, OpenAI, Gemini)
│   │   │   ├── crm-connector/           #    CRM integration (HubSpot, etc.)
│   │   │   ├── email-connector/         #    Email (Mailjet, SendGrid, etc.)
│   │   │   ├── sms-connector/           #    SMS (Twilio, etc.)
│   │   │   ├── push-notifications-connector/  # Push notifications (FCM)
│   │   │   ├── document-connector/      #    E-signature (PandaDoc, DocuSign, etc.)
│   │   │   ├── journey-connector/       #    Marketing automation (Ortto, etc.)
│   │   │   ├── survey-connector/        #    Surveys (Typeform, SurveyMonkey, etc.)
│   │   │   ├── work-mgmt-connector/     #    Work management (ClickUp, Notion, etc.)
│   │   │   └── erp-connector/           #    HR/Finance (BambooHR, etc.)
│   │   ├── generator/                   # Code generation engine
│   │   │   ├── generator.ts             #    Main generator logic
│   │   │   ├── templates/               #    Handlebars templates
│   │   │   └── types.ts                 #    Data model types
│   │   ├── generated/                   # Generated code (gitignored)
│   │   ├── app.ts                       # Express app setup
│   │   ├── index.ts                     # Firebase Functions entry
│   │   └── server.ts                    # Local dev server
│   ├── scripts/                         # CLI tools and automation
│   │   ├── setup.js                     #    Interactive setup wizard
│   │   ├── validate.js                  #    Configuration validation
│   │   ├── generate.js                  #    Code generation CLI
│   │   └── deploy.js                    #    Deployment automation
│   ├── package.json
│   └── tsconfig.json
├── __examples__/
│   └── user.model.ts                    # Example data model
├── __docs__/
│   ├── getting-started.md               # Comprehensive getting started guide
│   ├── communications-guide.md          # Communication utilities guide
│   └── test_suite_improvements.md       # Testing philosophy and statistics
├── __scripts__/                         # Project-level scripts
│   ├── setup.js                         # Project setup
│   ├── generate.js                      # Code generation
│   └── deploy.js                        # Deployment
├── firebase.json                        # Firebase configuration
├── .firebaserc                          # Firebase project mapping
└── README.md                            # This file
```

---

## 🔐 Authentication & Authorization

Built-in Firebase authentication with JWT token management:

```typescript
import { authService } from '$lib/services/auth';

// Email/password authentication
const user = await authService.signInWithEmailAndPassword(email, password);

// Phone authentication
const user = await authService.signInWithPhoneNumber(phoneNumber);

// Token verification with blacklist checking
const tokenData = await tokenHandler.verifyAndUnpack(bearerToken);

// Token blacklisting
await tokenHandler.blacklistToken(token, 'user_logout');
await tokenHandler.blacklistAllUserTokens(userId, 'password_changed');
```

### Protected Endpoints

```typescript
// Protect routes with authentication middleware
app.use('/api/v1/admin', authMiddleware({ requiredRole: 'admin' }));

// In your controller
export class UserController extends BaseController<User> {
  async getProfile(req: AuthenticatedRequest, res: Response) {
    const userId = req.user.uid; // Available after authentication
    const user = await this.service.getUserById(userId);
    res.json(user);
  }
}
```

---

## 🤖 AI-Assisted Development

### Data Model Format

Define your entities in a declarative TypeScript format:

```typescript
import { DataModelSpecification } from '../functions/src/generator/types';

export const EcommerceModel: DataModelSpecification = {
  entities: {
    Product: {
      fields: {
        name: {
          type: 'string',
          required: true,
          unique: false,
        },
        description: {
          type: 'text',
          required: true,
        },
        price: {
          type: 'number',
          required: true,
          validation: 'Must be positive',
        },
        inStock: {
          type: 'boolean',
          default: true,
        },
        categoryId: {
          type: 'reference',
          entity: 'Category',
          required: true,
        },
      },

      relationships: {
        category: {
          type: 'many-to-one',
          entity: 'Category',
        },
        reviews: {
          type: 'one-to-many',
          entity: 'Review',
          foreignKey: 'productId',
        },
      },

      access: {
        create: ['admin'],
        read: ['public'],
        update: ['admin'],
        delete: ['admin'],
      },

      validation: {
        price: 'Must be greater than 0',
        name: 'Must be 3-100 characters',
      },

      indexes: [
        { fields: ['categoryId', 'inStock'] },
        { fields: ['name'], unique: false },
      ],

      businessRules: [
        'Products must belong to an active category',
        'Price cannot be changed if there are pending orders',
      ],
    },
  },
};
```

### Example Data Models

We provide three complete, production-ready data models to get you started:

#### 🎨 Blog Platform (`__examples__/blog-platform.model.ts`)
- **8 entities**: User, Post, Comment, Category, Tag, + junction tables
- **Features**: Social features (likes, follows), nested comments, content moderation
- **Perfect for**: Blog platforms, news sites, content communities

```bash
npm run generate __examples__/blog-platform.model.ts
```

#### 🛒 E-commerce Store (`__examples__/ecommerce-store.model.ts`)
- **17 entities**: Product, Cart, Order, Review, Shipment, + more
- **Features**: Product variants, inventory management, order tracking, payments
- **Perfect for**: Online stores, marketplaces, product sales

```bash
npm run generate __examples__/ecommerce-store.model.ts
```

#### 🏢 SaaS Multi-Tenant (`__examples__/saas-multi-tenant.model.ts`)
- **12 entities**: Organization, Workspace, Project, API Keys, + more
- **Features**: Multi-tenancy, team collaboration, subscriptions, usage tracking
- **Perfect for**: B2B SaaS, project management, collaboration tools

```bash
npm run generate __examples__/saas-multi-tenant.model.ts
```

**See [__examples__/README.md](__examples__/README.md) for detailed documentation on each model.**

### Code Generation

```bash
# Generate complete backend from data model
npm run generate __examples__/ecommerce-store.model.ts

# Generates:
# - functions/src/generated/entities/Product.ts
# - functions/src/generated/repositories/ProductRepository.ts
# - functions/src/generated/services/ProductService.ts
# - functions/src/generated/controllers/ProductController.ts
```

### AI Conversation Pattern

**Human:** "I need a blog platform with posts, comments, and categories. Posts should have tags, and users can like posts."

**AI (Claude/GPT-4):**
```typescript
// I'll create a data model for your blog platform:

export const BlogModel: DataModelSpecification = {
  entities: {
    Post: { /* ... */ },
    Comment: { /* ... */ },
    Category: { /* ... */ },
    Tag: { /* ... */ },
    PostLike: { /* many-to-many resolution table */ }
  }
};

// Run: npm run generate __examples__/blog.model.ts
// Then register the controllers in functions/src/index.ts
```

**Human:** "Great! Now add a feature where users can follow other users."

**AI:** (Updates the model, regenerates code)

---

## 🧪 Testing Philosophy

**"Test WHAT, Not HOW"** - Behavioral testing principles:

```typescript
// ✅ Good - Test behavior
test('creates user and returns user ID', async () => {
  const userData = { email: 'user@example.com', name: 'Test User' };

  const result = await userService.createUser(userData);

  expect(result.success).toBe(true);
  expect(result.userId).toBeDefined();
});

// ❌ Bad - Test implementation
test('calls repository.insert with transformed data', async () => {
  const spy = vi.spyOn(repository, 'insert');
  await userService.createUser(userData);
  expect(spy).toHaveBeenCalled();
});
```

### Test Commands

```bash
npm test                      # Run all 807 tests
npm run test:coverage         # Run with coverage report
npm run test:watch            # Watch mode
```

### Current Test Statistics

- **Test Suites**: 25 passed, 25 total
- **Tests**: 807 passed, 807 total
- **Execution Time**: ~35 seconds
- **Coverage**: Core utilities 80%+, security utilities 100%

**Test Breakdown:**
- Core Utilities: 175 tests (hashing), 54 tests (logger), 30 tests (events)
- Security: 72 tests (token handler), 28 tests (address validation)
- Infrastructure: 44 tests (Firestore), 32 tests (Firebase bridge), 25 tests (realtime), 24 tests (LLM)
- Communication: 24 tests (SMS), 27 tests (push notifications)
- Business Connectors: 26 tests (CRM), 28 tests (document), 34 tests (journey), 28 tests (survey), 44 tests (work mgmt), 42 tests (ERP)

See [functions/src/__tests__/README.md](functions/src/__tests__/README.md) for detailed testing philosophy.

---

## ⚙️ Configuration

### Interactive Setup (Recommended)

```bash
cd functions
npm run setup
```

The wizard will guide you through configuration and automatically:
- Generate your `.env` file
- Configure Firebase settings
- Set up feature flags
- Install dependencies

### Validation

```bash
npm run validate        # Full validation (includes build and tests)
npm run validate:quick  # Quick validation (skips slow checks)
```

The validator checks:
- ✅ Node.js and Firebase CLI installed
- ✅ Project structure correct
- ✅ Environment variables configured
- ✅ Dependencies installed
- ✅ TypeScript compilation succeeds
- ✅ Tests passing
- ⚠️ Warns about placeholder values

### Manual Configuration

All configuration lives in `functions/src/config/`:

```typescript
// functions/src/config/app.config.ts
export const APP_CONFIG = {
  app: {
    name: process.env.APP_NAME,
    version: process.env.APP_VERSION,
    environment: process.env.NODE_ENV,
  },

  api: {
    basePath: process.env.API_BASE_PATH || '/api/v1',
    corsOrigins: process.env.CORS_ORIGINS?.split(',') || [],
    requestSizeLimit: process.env.REQUEST_SIZE_LIMIT || '10mb',
  },

  features: {
    authentication: process.env.FEATURE_AUTHENTICATION === 'true',
    multiTenant: process.env.FEATURE_MULTI_TENANT === 'true',
    analytics: process.env.FEATURE_ANALYTICS === 'true',
  },

  rateLimit: {
    enabled: process.env.RATE_LIMIT_ENABLED === 'true',
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000'),
    max: parseInt(process.env.RATE_LIMIT_MAX || '100'),
  },
};
```

---

## 🔌 Communication Utilities

The boilerplate includes comprehensive communication connectors:

### CRM Integration
```typescript
import { crmConnector } from './utilities/crm-connector';

// Create contact
await crmConnector.createContact({
  email: 'contact@example.com',
  firstName: 'John',
  lastName: 'Doe',
  company: 'Acme Corp'
});

// Providers: HubSpot, Salesforce, Attio
```

### Email Integration
```typescript
import { emailConnector } from './utilities/email-connector';

// Send transactional email
await emailConnector.sendEmail({
  to: 'user@example.com',
  subject: 'Welcome!',
  html: '<h1>Welcome to our platform</h1>'
});

// Providers: Mailjet, SendGrid, AWS SES
```

### SMS Integration
```typescript
import { smsConnector } from './utilities/sms-connector';

// Send SMS
await smsConnector.sendMessage({
  to: '+1234567890',
  body: 'Your verification code is: 123456'
});

// Providers: Twilio, MessageBird, AWS SNS
```

### Push Notifications
```typescript
import { pushNotificationsConnector } from './utilities/push-notifications-connector';

// Send push notification
await pushNotificationsConnector.send({
  token: deviceToken,
  notification: {
    title: 'New Message',
    body: 'You have a new message from John'
  }
});

// Provider: Firebase Cloud Messaging (FCM)
```

### Additional Connectors

- **Document Connector**: E-signature workflows (PandaDoc, DocuSign, HelloSign)
- **Journey Connector**: Marketing automation (Ortto, HubSpot, Segment)
- **Survey Connector**: Survey management (Typeform, SurveyMonkey)
- **Work Management Connector**: Task/project management (ClickUp, Notion, Linear)
- **ERP Connector**: HR and finance operations (BambooHR, Gusto, Workday)

See [__docs__/communications-guide.md](__docs__/communications-guide.md) for detailed usage.

---

## 🚀 Deployment

### Firebase Hosting (Recommended)

```bash
# Build and deploy
cd functions
npm run build
firebase deploy --only functions

# Or use the deploy script
npm run deploy
```

### Environment-Specific Deployment

```bash
# Deploy to staging
firebase use staging
firebase deploy --only functions

# Deploy to production
firebase use production
firebase deploy --only functions
```

### Other Platforms

**Google Cloud Run:**
```bash
npm run build
gcloud run deploy --source .
```

**AWS Lambda:**
```bash
# Use Serverless Framework
serverless deploy
```

**Docker:**
```bash
docker build -t my-api .
docker run -p 5001:5001 my-api
```

---

## 🔧 Development Tools

```bash
# Code quality
npm run lint              # ESLint
npm run lint:fix          # Auto-fix linting issues
npm run build             # TypeScript compilation
npm run build:watch       # Watch mode compilation

# Testing
npm test                  # All tests
npm run test:coverage     # Coverage report
npm run test:watch        # Watch mode

# Setup & Validation
npm run setup             # Interactive setup wizard
npm run validate          # Validate configuration
npm run validate:quick    # Quick validation (skip slow checks)

# Code Generation
npm run generate <model-file>  # Generate code from data model

# Development
npm start                 # Start local server
npm run serve             # Start Firebase emulators

# Deployment
npm run deploy            # Deploy to Firebase
npm run logs              # View Firebase logs
```

---

## 📚 Documentation

### For Developers
- **[Getting Started](__docs__/getting-started.md)**: Comprehensive setup and development guide
- **[Communications Guide](__docs__/communications-guide.md)**: All communication utilities
- **[Test Suite Documentation](functions/src/__tests__/README.md)**: Testing philosophy and examples
- **[Test Suite Improvements](__docs__/test_suite_improvements.md)**: Detailed test statistics

### For AI Systems & Agentic Development

**MCP (Model Context Protocol) Documentation**: Complete backend documentation optimized for AI agents is available via MCP at:
- **URL**: https://xbg.solutions/mcp/config.json
- **Local**: [mcp/backend/README.md](mcp/backend/README.md)

The MCP provides structured documentation covering:
- **Declarative Models**: Clear entity/relationship definitions in TypeScript
- **Consistent Patterns**: BaseController → BaseService → BaseRepository
- **Type Exports**: All interfaces exported for AI code generation
- **Predictable Structure**: Follow established layered architecture
- **Complete API Reference**: All utilities, connectors, and core components

---

## 🎯 AI Integration Patterns

### Quick Customization

1. **Define your data model** in `__examples__/your-model.ts`
2. **Generate code**: `npm run generate __examples__/your-model.ts`
3. **Register controllers** in `functions/src/index.ts`
4. **Deploy**: `npm run deploy`

### Finding Customization Points

```bash
# All configuration in one place
ls functions/src/config/

# Common patterns for AI systems
import { APP_CONFIG } from './config/app.config';
import { BaseController } from './base/BaseController';
import { eventBus } from './utilities/events';
```

### Service Generation Pattern

```typescript
// AI-friendly service pattern
import { BaseService } from '../base/BaseService';
import { Product } from '../entities/Product';

export class ProductService extends BaseService<Product> {
  constructor(repository: ProductRepository) {
    super(repository);
  }

  async createProduct(data: CreateProductDto): Promise<Product> {
    // 1. Validation
    await this.validateData(data);

    // 2. Authorization
    await this.checkPermission('create', data);

    // 3. Business logic
    const product = await this.repository.create(data);

    // 4. Event publishing
    this.eventBus.publish('product.created', { product });

    return product;
  }
}
```

---

## 🗺️ Roadmap

### Architecture & Infrastructure
- [ ] OpenAPI/Swagger documentation generation
- [ ] GraphQL support
- [ ] Database migration system
- [ ] Docker support with multi-stage builds
- [ ] Kubernetes deployment templates
- [ ] Background job queue with retry logic
- [ ] Circuit breaker pattern for external services
- [ ] Distributed tracing (OpenTelemetry)

### Testing & Quality
- [ ] Integration test generation
- [ ] E2E test framework
- [ ] Load testing suite
- [ ] Security scanning automation
- [ ] Performance benchmarking
- [ ] Contract testing for APIs

### Communication Connectors
- [ ] **CRM**: Salesforce and Attio provider implementations
- [ ] **Email**: SendGrid, AWS SES, and Postmark providers
- [ ] **SMS**: AWS SNS SMS and Vonage providers
- [ ] **Push Notifications**: APNs provider implementation
- [ ] **Document**: DocuSign and HelloSign providers
- [ ] **ERP**: QuickBooks, Xero, and NetSuite providers
- [ ] **Work Management**: Monday.com, ClickUp, and Wrike providers
- [ ] **Survey**: Google Forms provider
- [ ] **Journey**: Segment and Mixpanel providers
- [ ] Message templating system with versioning
- [ ] Delivery status tracking and webhooks
- [ ] Bounce and complaint handling
- [ ] A/B testing for communications

### Utilities & Features
- [ ] File upload/download utilities
- [ ] Image processing utilities
- [ ] PDF generation utilities
- [ ] CSV import/export utilities
- [ ] Data export compliance (GDPR)
- [ ] Audit logging
- [ ] Feature flags system
- [ ] Scheduled tasks/cron jobs

### Security Enhancements
- [ ] Two-factor authentication
- [ ] OAuth2 provider integration
- [ ] API key management
- [ ] IP whitelisting
- [ ] DDoS protection
- [ ] Secrets rotation

### Developer Experience
- [ ] CLI tool for common tasks
- [ ] Development containers
- [ ] Code scaffolding improvements
- [ ] Database seeding utilities
- [ ] Mock data generation
- [ ] API client generation
- [ ] Webhook testing tools

---

## 📊 Project Status

- **807 Tests Passing**: Comprehensive test coverage ✅
- **100% TypeScript**: Strict mode with full type safety ✅
- **Security First**: PII encryption, JWT auth, token blacklisting ✅
- **Production Ready**: Deployment infrastructure complete ✅
- **Event-Driven**: Internal event bus for loose coupling ✅
- **Multi-Database**: Support for multiple Firestore databases ✅

---

## 🤝 Contributing

1. Follow existing patterns and conventions
2. Add tests for new functionality (behavioral testing principles)
3. Update documentation for any new features
4. Ensure all tests pass (`npm run validate`)
5. Follow the commit message format

---

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

---

## 🆘 Support

- **Issues**: Report bugs and request features via [GitHub Issues](https://github.com/xbg-solutions/boilerplate_backend/issues)
- **Discussions**: Community support via [GitHub Discussions](https://github.com/xbg-solutions/boilerplate_backend/discussions)
- **Documentation**: Comprehensive docs in `__docs__/` directory
- **Website**: [https://xbg.solutions](https://xbg.solutions)

---

**Built with ❤️ by [XBG Solutions](https://xbg.solutions) for rapid API development and AI-assisted coding**

If this project helps you, please consider buying us a beer or two!
https://xbg.solutions/donations

---
