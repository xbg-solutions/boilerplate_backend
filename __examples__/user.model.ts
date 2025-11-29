/**
 * Example Data Model: User Management
 * This demonstrates how to define entities for code generation
 */

import { DataModelSpecification } from '../functions/src/generator/types';

export const UserManagementModel: DataModelSpecification = {
  entities: {
    User: {
      description: 'Application user with authentication and profile',

      fields: {
        userUID: {
          type: 'uuid',
          primaryKey: true,
          generated: true,
          description: 'Unique user identifier',
        },
        email: {
          type: 'email',
          unique: true,
          required: true,
          description: 'User email address',
        },
        displayName: {
          type: 'string',
          required: false,
          maxLength: 100,
          description: 'User display name',
        },
        role: {
          type: 'enum',
          values: ['admin', 'member', 'guest'],
          default: 'member',
          required: true,
          description: 'User role for access control',
        },
        isActive: {
          type: 'boolean',
          default: true,
          required: true,
          description: 'Whether user account is active',
        },
        emailVerified: {
          type: 'boolean',
          default: false,
          required: true,
          description: 'Whether email has been verified',
        },
        lastLoginAt: {
          type: 'timestamp',
          nullable: true,
          description: 'Last login timestamp',
        },
        profileImageUrl: {
          type: 'url',
          nullable: true,
          description: 'URL to profile image',
        },
      },

      relationships: {
        organizations: {
          type: 'many-to-many',
          entity: 'Organization',
          through: 'UserOrganization',
          cascadeDelete: false,
          description: 'Organizations the user belongs to',
        },
        createdLists: {
          type: 'one-to-many',
          entity: 'List',
          foreignKey: 'ownerUID',
          cascadeDelete: true,
          description: 'Lists created by the user',
        },
      },

      access: {
        create: ['public'], // Anyone can register
        read: ['self', 'admin', 'organization-member'],
        update: ['self', 'admin'],
        delete: ['admin'],
      },

      validation: {
        email: 'Must be unique valid email address',
        role: 'Members cannot promote themselves to admin',
        displayName: 'Must be alphanumeric with spaces, max 100 characters',
      },

      indexes: [
        { fields: ['email'], unique: true },
        { fields: ['role', 'isActive'] },
        { fields: ['createdAt'] },
      ],

      businessRules: [
        'Email must be verified before account activation',
        'Deleted users retain data for 30 days (soft delete)',
        'Admin role requires two-factor authentication',
        'Users must have at least one active organization',
      ],
    },

    Organization: {
      description: 'Organization or team entity',

      fields: {
        organizationUID: {
          type: 'uuid',
          primaryKey: true,
          generated: true,
        },
        name: {
          type: 'string',
          required: true,
          minLength: 2,
          maxLength: 100,
        },
        slug: {
          type: 'string',
          unique: true,
          required: true,
          pattern: '^[a-z0-9-]+$',
        },
        description: {
          type: 'string',
          nullable: true,
          maxLength: 500,
        },
        ownerUID: {
          type: 'reference',
          required: true,
          description: 'Reference to User who owns this organization',
        },
        isActive: {
          type: 'boolean',
          default: true,
        },
      },

      relationships: {
        members: {
          type: 'many-to-many',
          entity: 'User',
          through: 'UserOrganization',
          cascadeDelete: false,
        },
        owner: {
          type: 'many-to-one',
          entity: 'User',
          foreignKey: 'ownerUID',
        },
      },

      access: {
        create: ['authenticated'],
        read: ['member', 'admin'],
        update: ['owner', 'admin'],
        delete: ['owner', 'admin'],
      },

      validation: {
        slug: 'Must be unique URL-safe identifier',
        name: 'Must be unique within user account',
      },

      indexes: [
        { fields: ['slug'], unique: true },
        { fields: ['ownerUID'] },
        { fields: ['isActive'] },
      ],

      businessRules: [
        'Organization slug must be unique globally',
        'Owner cannot leave their own organization',
        'Deleting organization removes all member associations',
      ],
    },
  },

  workflows: {
    userRegistration: {
      trigger: 'USER_CREATED',
      description: 'Handle new user registration',
      steps: [
        'sendVerificationEmail',
        'createDefaultPreferences',
        'trackRegistrationEvent',
        'assignDefaultRole',
      ],
      conditions: {
        sendVerificationEmail: 'email is not verified',
      },
    },

    organizationCreation: {
      trigger: 'ORGANIZATION_CREATED',
      description: 'Handle new organization creation',
      steps: [
        'addOwnerAsMember',
        'createDefaultSettings',
        'sendWelcomeEmail',
      ],
    },

    accountDeletion: {
      trigger: 'manual',
      description: 'Handle user account deletion',
      steps: [
        'validatePermissions',
        'exportUserData',
        'softDeleteAccount',
        'scheduleDataPurge',
        'notifyAdministrators',
      ],
    },
  },
};
