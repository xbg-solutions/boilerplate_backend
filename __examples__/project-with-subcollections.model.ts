/**
 * Project Management Model — Subcollection Example
 *
 * Demonstrates the subcollection storage pattern:
 * - Project is a top-level collection
 * - ProjectMember is a subcollection under each Project document
 * - ProjectTask is a subcollection under each Project document
 *
 * Firestore structure:
 *   projects/{projectId}
 *   projects/{projectId}/members/{memberId}
 *   projects/{projectId}/tasks/{taskId}
 */

import { DataModelSpecification } from '@xbg.solutions/backend-core';

export const ProjectWithSubcollectionsModel: DataModelSpecification = {
  entities: {
    Project: {
      description: 'A project with members and tasks stored as subcollections',
      storage: { type: 'collection', collectionName: 'projects' },
      fields: {
        id: { type: 'uuid', required: true, unique: true },
        name: { type: 'string', required: true, minLength: 1, maxLength: 200 },
        description: { type: 'string', maxLength: 2000 },
        status: {
          type: 'enum',
          required: true,
          values: ['draft', 'active', 'paused', 'completed', 'archived'],
          default: 'draft',
        },
        ownerId: { type: 'string', required: true, description: 'User ID of the project owner' },
        createdAt: { type: 'timestamp' },
        updatedAt: { type: 'timestamp' },
        deletedAt: { type: 'timestamp', nullable: true },
      },
      access: {
        read: ['admin', 'member', 'self'],
        create: ['admin', 'authenticated'],
        update: ['admin', 'self'],
        delete: ['admin'],
      },
      indexes: [
        { fields: ['ownerId', 'status'] },
        { fields: ['status', 'createdAt'] },
      ],
      businessRules: [
        'Only project owner or admin can modify project settings',
        'Completed projects cannot be modified without reactivating first',
      ],
    },

    ProjectMember: {
      description: 'A member of a project, stored as a subcollection under the project',
      storage: {
        type: 'subcollection',
        collectionName: 'members',
        parent: {
          entity: 'Project',
          collectionName: 'projects',
          foreignKey: 'projectId',
        },
      },
      fields: {
        id: { type: 'uuid', required: true, unique: true },
        userId: { type: 'string', required: true, description: 'Reference to the user' },
        role: {
          type: 'enum',
          required: true,
          values: ['owner', 'admin', 'editor', 'viewer'],
          default: 'viewer',
        },
        joinedAt: { type: 'timestamp' },
        createdAt: { type: 'timestamp' },
        updatedAt: { type: 'timestamp' },
        deletedAt: { type: 'timestamp', nullable: true },
      },
      access: {
        read: ['admin', 'member'],
        create: ['admin', 'owner'],
        update: ['admin', 'owner'],
        delete: ['admin', 'owner'],
      },
      businessRules: [
        'A project must always have at least one owner',
        'Cannot remove the last owner without transferring ownership',
      ],
    },

    ProjectTask: {
      description: 'A task within a project, stored as a subcollection under the project',
      storage: {
        type: 'subcollection',
        collectionName: 'tasks',
        parent: {
          entity: 'Project',
          collectionName: 'projects',
          foreignKey: 'projectId',
        },
      },
      fields: {
        id: { type: 'uuid', required: true, unique: true },
        title: { type: 'string', required: true, minLength: 1, maxLength: 500 },
        description: { type: 'string', maxLength: 5000 },
        status: {
          type: 'enum',
          required: true,
          values: ['todo', 'in_progress', 'review', 'done', 'cancelled'],
          default: 'todo',
        },
        priority: {
          type: 'enum',
          values: ['low', 'medium', 'high', 'urgent'],
          default: 'medium',
        },
        assigneeId: { type: 'string', description: 'User ID of the assignee' },
        dueDate: { type: 'timestamp' },
        createdAt: { type: 'timestamp' },
        updatedAt: { type: 'timestamp' },
        deletedAt: { type: 'timestamp', nullable: true },
      },
      access: {
        read: ['admin', 'member'],
        create: ['admin', 'editor', 'owner'],
        update: ['admin', 'editor', 'owner'],
        delete: ['admin', 'owner'],
      },
      indexes: [
        { fields: ['status', 'priority'] },
        { fields: ['assigneeId', 'status'] },
      ],
      businessRules: [
        'Tasks can only be assigned to project members',
        'Cancelled tasks cannot be reassigned without reactivating',
      ],
    },
  },
};
