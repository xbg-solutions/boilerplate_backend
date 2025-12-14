# Backend Boilerplate Documentation (MCP)

> Comprehensive documentation for the Node.js/TypeScript AI-compatible backend boilerplate

## Overview

This documentation is structured for AI agents and developers working with the boilerplate_backend project. The backend provides a production-ready foundation with a layered architecture, code generation from declarative models, and comprehensive utilities for building APIs.

## Documentation Structure

### 📚 Getting Started

- **[Getting Started Guide](docs/getting-started.md)** - Complete setup, configuration, and first API guide
- **[Communications Guide](docs/communications-guide.md)** - Email, SMS, Push, CRM, and other communication integrations
- **[Test Suite Documentation](docs/test_suite_improvements.md)** - Testing philosophy, statistics, and improvements

### 🏗️ Core Architecture

#### Base Classes
**Location:** [base/README.md](base/README.md)

Foundation classes for the layered architecture:
- **BaseEntity** - Domain models with validation
- **BaseRepository** - Database operations (CRUD, queries, pagination)
- **BaseService** - Business logic orchestration with lifecycle hooks
- **BaseController** - HTTP request/response handling

All generated and custom code extends these base classes.

#### Code Generator
**Location:** [generator/README.md](generator/README.md)

Automated code generation from declarative data models:
- Entity generation with validation
- Repository generation with database operations
- Service generation with business logic hooks
- Controller generation with REST endpoints
- Relationship handling (one-to-one, one-to-many, many-to-many)
- Template-based using Handlebars

#### Middleware
**Location:** [middleware/README.md](middleware/README.md)

Express middleware pipeline:
- Authentication (JWT verification)
- Authorization (role-based access)
- Error handling
- Rate limiting
- Request validation
- CORS configuration

### 🔧 Utilities

All utilities are located in the `utilities/` directory. Each provides specific functionality with comprehensive documentation.

#### Core Infrastructure

- **[Events](utilities/events/README.md)** - Internal event bus for loose coupling and domain events
- **[Logger](utilities/logger/README.md)** - Structured logging with PII sanitization and correlation IDs
- **[Firestore Connector](utilities/firestore-connector/README.md)** - Multi-database Firestore connection management
- **[Firebase Event Bridge](utilities/firebase-event-bridge/README.md)** - Bridge between Firebase and internal event system
- **[Realtime Connector](utilities/realtime-connector/README.md)** - Real-time database operations

#### Security & Data Protection

- **[Hashing](utilities/hashing/README.md)** - PII encryption using AES-256-GCM
- **[Token Handler](utilities/token-handler/README.md)** - JWT token generation, verification, and blacklisting
- **[Validation](utilities/validation/README.md)** - Input validation utilities
- **[Errors](utilities/errors/README.md)** - Standardized error handling and custom error types

#### Communication Connectors

- **[Email Connector](utilities/email-connector/README.md)** - Transactional emails (Mailjet, SendGrid, AWS SES)
- **[SMS Connector](utilities/sms-connector/README.md)** - SMS messaging (Twilio, MessageBird, AWS SNS)
- **[Push Notifications](utilities/push-notifications-connector/README.md)** - Push notifications via Firebase Cloud Messaging
- **[CRM Connector](utilities/crm-connector/README.md)** - CRM integration (HubSpot, Salesforce, Attio)
- **[Journey Connector](utilities/journey-connector/README.md)** - Marketing automation (Ortto, HubSpot, Segment)
- **[Survey Connector](utilities/survey-connector/README.md)** - Survey management (Typeform, SurveyMonkey)

#### Business Integrations

- **[Document Connector](utilities/document-connector/README.md)** - E-signature workflows (PandaDoc, DocuSign, HelloSign)
- **[Work Management Connector](utilities/work-mgmt-connector/README.md)** - Task/project management (ClickUp, Notion, Linear)
- **[ERP Connector](utilities/erp-connector/README.md)** - HR and finance (BambooHR, Gusto, Workday)

#### AI & External Services

- **[LLM Connector](utilities/llm-connector/README.md)** - AI/LLM integration (Claude, OpenAI, Gemini)
  - [API Keys Setup Guide](utilities/llm-connector/API_KEYS_SETUP.md)
- **[Address Validation](utilities/address-validation/README.md)** - Google Maps address validation

#### Other Utilities

- **[Timezone](utilities/timezone/README.md)** - Timezone handling and conversions

### 🧪 Testing

**Location:** [tests/README.md](tests/README.md)

- Testing philosophy: "Test WHAT, not HOW"
- Behavioral testing principles
- 807 passing tests across 25 test suites
- Test coverage statistics and breakdown

## Key Concepts

### Layered Architecture

```
Request → Controller → Service → Repository → Database
                ↓
           Event Bus → Subscribers
```

1. **Controller Layer**: Handles HTTP requests/responses
2. **Service Layer**: Orchestrates business logic, validation, and authorization
3. **Repository Layer**: Database operations and queries
4. **Event Layer**: Publishes domain events for loose coupling

### Declarative Data Models

The boilerplate uses declarative TypeScript models that AI agents can parse to generate complete CRUD APIs:

```typescript
export const Model: DataModelSpecification = {
  entities: {
    EntityName: {
      fields: { /* field definitions */ },
      relationships: { /* entity relationships */ },
      access: { /* access control rules */ },
      validation: { /* validation rules */ },
      indexes: [ /* database indexes */ ],
      businessRules: [ /* business logic documentation */ ],
    },
  },
};
```

### Event-Driven Architecture

Services publish events that other components can subscribe to:

```typescript
// Publishing
eventBus.publish('entity.created', { entity, context });

// Subscribing
eventBus.subscribe('entity.created', async (event) => {
  // Handle event
});
```

## Common Workflows

### Adding a New Entity

1. Define entity in data model specification
2. Run code generator: `npm run generate path/to/model.ts`
3. Register controller in `index.ts`
4. Build and deploy

### Customizing Generated Code

1. Generated code extends base classes
2. Override lifecycle hooks in services
3. Add custom routes to controllers
4. Add custom methods to repositories

### Implementing Security

1. Use `authMiddleware` for protected routes
2. Implement `can*` methods in services for authorization
3. Use token blacklisting for logout/password changes
4. Encrypt PII using hashing utility

### Working with Multiple Databases

1. Configure databases in `database.config.ts`
2. Use `firestoreConnector.getDb(dbName)` in repositories
3. Each repository specifies its database and collection

## Project File Locations

### Configuration
- `/functions/src/config/` - All centralized configuration
- `/functions/.env` - Environment variables

### Source Code
- `/functions/src/base/` - Base classes
- `/functions/src/generator/` - Code generation engine
- `/functions/src/middleware/` - Express middleware
- `/functions/src/utilities/` - Reusable utilities
- `/functions/src/generated/` - Generated code (gitignored)

### Examples & Templates
- `/__examples__/` - Example data models
- `/functions/src/templates/` - Handlebars templates

### Tests
- `/functions/src/__tests__/` - All test files

## Technology Stack

- **Runtime**: Node.js 18+
- **Language**: TypeScript (strict mode)
- **Framework**: Express.js
- **Database**: Cloud Firestore
- **Hosting**: Firebase Functions
- **Testing**: Jest
- **Authentication**: Firebase Auth + JWT
- **Logging**: Winston

## Development Commands

```bash
# Setup
npm run setup              # Interactive setup wizard
npm run validate           # Validate configuration

# Development
npm start                  # Start local server
npm run build              # Build TypeScript
npm run build:watch        # Watch mode

# Code Generation
npm run generate <model>   # Generate code from data model

# Testing
npm test                   # Run all tests
npm run test:coverage      # Coverage report
npm run test:watch         # Watch mode

# Deployment
npm run deploy             # Deploy to Firebase
npm run logs               # View Firebase logs
```

## Best Practices

1. **Always extend base classes** - Don't create entities/services from scratch
2. **Use lifecycle hooks** - Implement business logic in service hooks
3. **Validate in entities** - Keep validation close to data
4. **Authorize in services** - Implement access control in service layer
5. **Keep controllers thin** - Delegate logic to services
6. **Publish events** - Use event bus for cross-service communication
7. **Test behaviors** - Focus on what code does, not how it does it

## Support & Resources

- **GitHub Repository**: [boilerplate_backend](https://github.com/xbg-solutions/boilerplate_backend)
- **Sister Project**: [boilerplate_frontend](https://github.com/xbg-solutions/boilerplate_frontend)
- **Website**: [XBG Solutions](https://xbg.solutions)

---

**For AI Agents**: This documentation provides context for understanding and working with the boilerplate_backend project. Use the declarative data model format to generate new entities, extend base classes for custom functionality, and leverage the event bus for loose coupling.
