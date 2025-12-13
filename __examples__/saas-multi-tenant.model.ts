/**
 * SaaS Multi-Tenant Application Data Model
 *
 * A complete B2B SaaS platform with:
 * - Multi-tenant workspace architecture
 * - Team collaboration features
 * - Role-based access control
 * - Subscription management
 * - Usage tracking and billing
 * - API key management
 *
 * Features demonstrated:
 * - Multi-tenancy patterns
 * - Hierarchical permissions (Organization → Workspace → Project)
 * - Subscription and billing
 * - Usage metering
 * - Invitations and team management
 * - API authentication
 *
 * To use this model:
 * 1. Copy to your project
 * 2. Run: npm run generate __examples__/saas-multi-tenant.model.ts
 * 3. Integrate payment provider (Stripe subscriptions)
 * 4. Set up usage tracking
 * 5. Configure billing webhooks
 */

import { DataModelSpecification } from '../functions/src/generator/types';

export const SaaSMultiTenantModel: DataModelSpecification = {
  entities: {
    User: {
      fields: {
        email: {
          type: 'email',
          unique: true,
          required: true,
        },
        firstName: {
          type: 'string',
          required: true,
        },
        lastName: {
          type: 'string',
          required: true,
        },
        avatarUrl: {
          type: 'url',
          required: false,
        },
        timezone: {
          type: 'string',
          default: 'UTC',
        },
        language: {
          type: 'string',
          default: 'en',
        },
        isVerified: {
          type: 'boolean',
          default: false,
        },
        lastActiveAt: {
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
        memberships: {
          type: 'one-to-many',
          entity: 'OrganizationMember',
          foreignKey: 'userId',
        },
        createdOrganizations: {
          type: 'one-to-many',
          entity: 'Organization',
          foreignKey: 'ownerId',
        },
      },
      access: {
        create: ['public'],
        read: ['self', 'team', 'admin'],
        update: ['self', 'admin'],
        delete: ['self', 'admin'],
      },
      validation: {
        email: 'Must be a valid email',
      },
      businessRules: [
        'Email must be verified before joining organizations',
        'Users can belong to multiple organizations',
      ],
      indexes: [
        { fields: ['email'], unique: true },
        { fields: ['lastActiveAt'] },
      ],
    },

    Organization: {
      fields: {
        name: {
          type: 'string',
          required: true,
        },
        slug: {
          type: 'string',
          unique: true,
          required: true,
        },
        logoUrl: {
          type: 'url',
          required: false,
        },
        websiteUrl: {
          type: 'url',
          required: false,
        },
        ownerId: {
          type: 'reference',
          entity: 'User',
          required: true,
        },
        subscriptionPlan: {
          type: 'enum',
          values: ['free', 'starter', 'professional', 'enterprise'],
          default: 'free',
        },
        subscriptionStatus: {
          type: 'enum',
          values: ['trial', 'active', 'past_due', 'cancelled', 'suspended'],
          default: 'trial',
        },
        stripeCustomerId: {
          type: 'string',
          required: false,
        },
        stripeSubscriptionId: {
          type: 'string',
          required: false,
        },
        trialEndsAt: {
          type: 'timestamp',
          required: false,
        },
        subscriptionEndsAt: {
          type: 'timestamp',
          required: false,
        },
        memberCount: {
          type: 'number',
          default: 1,
        },
        maxMembers: {
          type: 'number',
          default: 5,
        },
        workspaceCount: {
          type: 'number',
          default: 0,
        },
        maxWorkspaces: {
          type: 'number',
          default: 1,
        },
        apiCallsThisMonth: {
          type: 'number',
          default: 0,
        },
        apiCallsLimit: {
          type: 'number',
          default: 1000,
        },
        storageUsedGB: {
          type: 'number',
          default: 0,
        },
        storageLimit GB: {
          type: 'number',
          default: 5,
        },
        settings: {
          type: 'json',
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
        owner: {
          type: 'many-to-one',
          entity: 'User',
        },
        members: {
          type: 'one-to-many',
          entity: 'OrganizationMember',
          foreignKey: 'organizationId',
        },
        workspaces: {
          type: 'one-to-many',
          entity: 'Workspace',
          foreignKey: 'organizationId',
        },
        apiKeys: {
          type: 'one-to-many',
          entity: 'ApiKey',
          foreignKey: 'organizationId',
        },
        usageLogs: {
          type: 'one-to-many',
          entity: 'UsageLog',
          foreignKey: 'organizationId',
        },
      },
      access: {
        create: ['authenticated'],
        read: ['member', 'admin'],
        update: ['owner', 'admin'],
        delete: ['owner', 'admin'],
      },
      validation: {
        name: 'Must be 2-100 characters',
        slug: 'Must be URL-safe and unique',
      },
      businessRules: [
        'Free plan limited to 5 members, 1 workspace',
        'Trial lasts 14 days',
        'Exceeding limits suspends account',
        'Owner cannot leave organization',
      ],
      indexes: [
        { fields: ['slug'], unique: true },
        { fields: ['ownerId'] },
        { fields: ['subscriptionStatus'] },
        { fields: ['stripeCustomerId'], unique: true },
      ],
    },

    OrganizationMember: {
      fields: {
        organizationId: {
          type: 'reference',
          entity: 'Organization',
          required: true,
        },
        userId: {
          type: 'reference',
          entity: 'User',
          required: true,
        },
        role: {
          type: 'enum',
          values: ['owner', 'admin', 'member', 'guest'],
          required: true,
        },
        invitedBy: {
          type: 'reference',
          entity: 'User',
          required: false,
        },
        invitedAt: {
          type: 'timestamp',
          required: false,
        },
        joinedAt: {
          type: 'timestamp',
          required: true,
        },
      },
      relationships: {
        organization: {
          type: 'many-to-one',
          entity: 'Organization',
        },
        user: {
          type: 'many-to-one',
          entity: 'User',
        },
      },
      access: {
        create: ['admin', 'owner'],
        read: ['member'],
        update: ['admin', 'owner'],
        delete: ['admin', 'owner', 'self'],
      },
      businessRules: [
        'Each user can only be a member once per organization',
        'Owner role is unique per organization',
        'Removing last owner is prevented',
      ],
      indexes: [
        { fields: ['organizationId', 'userId'], unique: true },
        { fields: ['userId'] },
      ],
    },

    Workspace: {
      fields: {
        name: {
          type: 'string',
          required: true,
        },
        slug: {
          type: 'string',
          required: true,
        },
        description: {
          type: 'text',
          required: false,
        },
        organizationId: {
          type: 'reference',
          entity: 'Organization',
          required: true,
        },
        createdById: {
          type: 'reference',
          entity: 'User',
          required: true,
        },
        isArchived: {
          type: 'boolean',
          default: false,
        },
        projectCount: {
          type: 'number',
          default: 0,
        },
        settings: {
          type: 'json',
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
        organization: {
          type: 'many-to-one',
          entity: 'Organization',
        },
        createdBy: {
          type: 'many-to-one',
          entity: 'User',
        },
        projects: {
          type: 'one-to-many',
          entity: 'Project',
          foreignKey: 'workspaceId',
        },
        members: {
          type: 'one-to-many',
          entity: 'WorkspaceMember',
          foreignKey: 'workspaceId',
        },
      },
      access: {
        create: ['member'],
        read: ['member'],
        update: ['admin', 'workspace_admin'],
        delete: ['admin', 'workspace_admin'],
      },
      validation: {
        name: 'Must be 2-100 characters',
      },
      businessRules: [
        'Workspace slug must be unique within organization',
        'Archived workspaces are read-only',
      ],
      indexes: [
        { fields: ['organizationId', 'slug'], unique: true },
        { fields: ['createdById'] },
      ],
    },

    WorkspaceMember: {
      fields: {
        workspaceId: {
          type: 'reference',
          entity: 'Workspace',
          required: true,
        },
        userId: {
          type: 'reference',
          entity: 'User',
          required: true,
        },
        role: {
          type: 'enum',
          values: ['admin', 'member', 'viewer'],
          required: true,
        },
        addedAt: {
          type: 'timestamp',
          required: true,
        },
      },
      relationships: {
        workspace: {
          type: 'many-to-one',
          entity: 'Workspace',
        },
        user: {
          type: 'many-to-one',
          entity: 'User',
        },
      },
      access: {
        create: ['workspace_admin'],
        read: ['workspace_member'],
        update: ['workspace_admin'],
        delete: ['workspace_admin', 'self'],
      },
      businessRules: [
        'User must be organization member to join workspace',
      ],
      indexes: [
        { fields: ['workspaceId', 'userId'], unique: true },
      ],
    },

    Project: {
      fields: {
        name: {
          type: 'string',
          required: true,
        },
        description: {
          type: 'text',
          required: false,
        },
        workspaceId: {
          type: 'reference',
          entity: 'Workspace',
          required: true,
        },
        status: {
          type: 'enum',
          values: ['active', 'paused', 'completed', 'archived'],
          default: 'active',
        },
        priority: {
          type: 'enum',
          values: ['low', 'medium', 'high', 'urgent'],
          default: 'medium',
        },
        startDate: {
          type: 'timestamp',
          required: false,
        },
        dueDate: {
          type: 'timestamp',
          required: false,
        },
        createdById: {
          type: 'reference',
          entity: 'User',
          required: true,
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
        workspace: {
          type: 'many-to-one',
          entity: 'Workspace',
        },
        createdBy: {
          type: 'many-to-one',
          entity: 'User',
        },
      },
      access: {
        create: ['workspace_member'],
        read: ['workspace_member'],
        update: ['workspace_admin', 'workspace_member'],
        delete: ['workspace_admin'],
      },
      indexes: [
        { fields: ['workspaceId'] },
        { fields: ['status'] },
      ],
    },

    Invitation: {
      fields: {
        email: {
          type: 'email',
          required: true,
        },
        organizationId: {
          type: 'reference',
          entity: 'Organization',
          required: true,
        },
        role: {
          type: 'enum',
          values: ['admin', 'member', 'guest'],
          required: true,
        },
        token: {
          type: 'string',
          unique: true,
          required: true,
        },
        invitedById: {
          type: 'reference',
          entity: 'User',
          required: true,
        },
        status: {
          type: 'enum',
          values: ['pending', 'accepted', 'expired', 'cancelled'],
          default: 'pending',
        },
        expiresAt: {
          type: 'timestamp',
          required: true,
        },
        acceptedAt: {
          type: 'timestamp',
          required: false,
        },
        createdAt: {
          type: 'timestamp',
          required: true,
        },
      },
      relationships: {
        organization: {
          type: 'many-to-one',
          entity: 'Organization',
        },
        invitedBy: {
          type: 'many-to-one',
          entity: 'User',
        },
      },
      access: {
        create: ['admin'],
        read: ['public'], // Public can read to accept invitation
        update: ['admin'],
        delete: ['admin'],
      },
      businessRules: [
        'Invitations expire after 7 days',
        'Email can only have one pending invitation per organization',
      ],
      indexes: [
        { fields: ['token'], unique: true },
        { fields: ['organizationId', 'email', 'status'] },
        { fields: ['expiresAt'] },
      ],
    },

    ApiKey: {
      fields: {
        name: {
          type: 'string',
          required: true,
        },
        organizationId: {
          type: 'reference',
          entity: 'Organization',
          required: true,
        },
        key: {
          type: 'string',
          unique: true,
          required: true,
        },
        keyPrefix: {
          type: 'string',
          required: true,
        },
        keyHash: {
          type: 'string',
          required: true,
        },
        scopes: {
          type: 'array',
          required: true,
        },
        isActive: {
          type: 'boolean',
          default: true,
        },
        lastUsedAt: {
          type: 'timestamp',
          required: false,
        },
        expiresAt: {
          type: 'timestamp',
          required: false,
        },
        createdById: {
          type: 'reference',
          entity: 'User',
          required: true,
        },
        createdAt: {
          type: 'timestamp',
          required: true,
        },
      },
      relationships: {
        organization: {
          type: 'many-to-one',
          entity: 'Organization',
        },
        createdBy: {
          type: 'many-to-one',
          entity: 'User',
        },
      },
      access: {
        create: ['admin'],
        read: ['admin'],
        update: ['admin'],
        delete: ['admin'],
      },
      businessRules: [
        'API key is shown once at creation',
        'Keys are hashed before storage',
        'Expired keys are automatically deactivated',
      ],
      indexes: [
        { fields: ['keyHash'], unique: true },
        { fields: ['organizationId'] },
        { fields: ['keyPrefix'] },
      ],
    },

    UsageLog: {
      fields: {
        organizationId: {
          type: 'reference',
          entity: 'Organization',
          required: true,
        },
        userId: {
          type: 'reference',
          entity: 'User',
          required: false,
        },
        apiKeyId: {
          type: 'reference',
          entity: 'ApiKey',
          required: false,
        },
        endpoint: {
          type: 'string',
          required: true,
        },
        method: {
          type: 'enum',
          values: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
          required: true,
        },
        statusCode: {
          type: 'number',
          required: true,
        },
        responseTime: {
          type: 'number',
          required: true,
        },
        timestamp: {
          type: 'timestamp',
          required: true,
        },
      },
      relationships: {
        organization: {
          type: 'many-to-one',
          entity: 'Organization',
        },
        user: {
          type: 'many-to-one',
          entity: 'User',
          optional: true,
        },
        apiKey: {
          type: 'many-to-one',
          entity: 'ApiKey',
          optional: true,
        },
      },
      access: {
        create: ['system'],
        read: ['admin'],
        update: ['system'],
        delete: ['admin'],
      },
      businessRules: [
        'Usage logs are aggregated for billing',
        'Logs older than 90 days are archived',
      ],
      indexes: [
        { fields: ['organizationId', 'timestamp'] },
        { fields: ['apiKeyId', 'timestamp'] },
      ],
    },

    AuditLog: {
      fields: {
        organizationId: {
          type: 'reference',
          entity: 'Organization',
          required: true,
        },
        userId: {
          type: 'reference',
          entity: 'User',
          required: true,
        },
        action: {
          type: 'string',
          required: true,
        },
        resourceType: {
          type: 'string',
          required: true,
        },
        resourceId: {
          type: 'string',
          required: false,
        },
        changes: {
          type: 'json',
          required: false,
        },
        ipAddress: {
          type: 'string',
          required: false,
        },
        userAgent: {
          type: 'string',
          required: false,
        },
        timestamp: {
          type: 'timestamp',
          required: true,
        },
      },
      relationships: {
        organization: {
          type: 'many-to-one',
          entity: 'Organization',
        },
        user: {
          type: 'many-to-one',
          entity: 'User',
        },
      },
      access: {
        create: ['system'],
        read: ['admin'],
        update: ['system'],
        delete: ['admin'],
      },
      businessRules: [
        'All sensitive actions are logged',
        'Audit logs are immutable',
        'Logs retained for compliance (7 years)',
      ],
      indexes: [
        { fields: ['organizationId', 'timestamp'] },
        { fields: ['userId', 'timestamp'] },
        { fields: ['resourceType', 'resourceId'] },
      ],
    },
  },
};
