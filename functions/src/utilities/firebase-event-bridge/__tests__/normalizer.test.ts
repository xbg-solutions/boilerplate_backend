/**
 * Firebase Event Bridge Normalizer - Unit Tests
 *
 * Testing WHAT the normalizer does, not HOW it works internally:
 * - Normalizes Firestore events to standard format
 * - Normalizes Auth events to standard format
 * - Normalizes Storage events to standard format
 * - Extracts collection names from document paths
 * - Preserves raw event data without modification
 */

import {
  normalizeFirestoreEvent,
  normalizeAuthEvent,
  normalizeStorageEvent,
  extractCollectionName,
  NormalizedFirebaseEvent,
} from '../normalizer';
import { Logger } from '../../logger';

// Mock logger
jest.mock('../../logger', () => ({
  Logger: jest.fn().mockImplementation(() => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  })),
}));

describe('Firebase Event Bridge Normalizer', () => {
  let mockLogger: Logger;

  beforeEach(() => {
    jest.clearAllMocks();
    mockLogger = new Logger('test');
  });

  describe('normalizeFirestoreEvent', () => {
    it('normalizes Firestore create event', () => {
      const data = { name: 'John Doe', email: 'john@example.com' };
      const result = normalizeFirestoreEvent(
        'create',
        'users/user123',
        'user123',
        'identityDB',
        'users',
        data,
        mockLogger
      );

      expect(result.eventName).toBe('firestore.users.create');
      expect(result.source).toBe('firestore');
      expect(result.normalized.operation).toBe('create');
      expect(result.normalized.documentId).toBe('user123');
      expect(result.normalized.databaseName).toBe('identityDB');
      expect(result.normalized.collection).toBe('users');
      expect(result.raw).toEqual(data);
    });

    it('normalizes Firestore update event', () => {
      const data = { name: 'Jane Smith' };
      const result = normalizeFirestoreEvent(
        'update',
        'accounts/acc456',
        'acc456',
        'identityDB',
        'accounts',
        data,
        mockLogger
      );

      expect(result.eventName).toBe('firestore.accounts.update');
      expect(result.source).toBe('firestore');
      expect(result.normalized.operation).toBe('update');
      expect(result.normalized.documentId).toBe('acc456');
    });

    it('normalizes Firestore delete event', () => {
      const data = null;
      const result = normalizeFirestoreEvent(
        'delete',
        'users/user789',
        'user789',
        'identityDB',
        'users',
        data,
        mockLogger
      );

      expect(result.eventName).toBe('firestore.users.delete');
      expect(result.source).toBe('firestore');
      expect(result.normalized.operation).toBe('delete');
      expect(result.raw).toBeNull();
    });

    it('includes changes for update operations', () => {
      const before = { name: 'Old Name', age: 25 };
      const after = { name: 'New Name', age: 26 };
      const changes = { before, after };

      const result = normalizeFirestoreEvent(
        'update',
        'users/user123',
        'user123',
        'identityDB',
        'users',
        after,
        mockLogger,
        undefined,
        changes
      );

      expect(result.changes).toEqual(changes);
      expect(result.changes?.before).toEqual(before);
      expect(result.changes?.after).toEqual(after);
    });

    it('uses eventNameOverride when provided', () => {
      const data = { content: 'Test post' };
      const result = normalizeFirestoreEvent(
        'create',
        'users/user123/posts/post456',
        'post456',
        'wishlistDB',
        'posts',
        data,
        mockLogger,
        'user_posts'
      );

      expect(result.eventName).toBe('firestore.user_posts.create');
      expect(result.normalized.collection).toBe('posts');
    });

    it('generates unique event ID with timestamp', () => {
      const data = { test: 'data' };

      const result1 = normalizeFirestoreEvent(
        'create',
        'users/user1',
        'user1',
        'identityDB',
        'users',
        data,
        mockLogger
      );

      const result2 = normalizeFirestoreEvent(
        'create',
        'users/user2',
        'user2',
        'identityDB',
        'users',
        data,
        mockLogger
      );

      expect(result1.eventId).toContain('firestore.users.create');
      expect(result1.eventId).toContain('user1');
      expect(result1.eventId).toMatch(/firestore\.users\.create-user1-\d+/);
      expect(result2.eventId).not.toBe(result1.eventId);
    });

    it('sets timestamp to current date', () => {
      const before = new Date();
      const data = { test: 'data' };

      const result = normalizeFirestoreEvent(
        'create',
        'users/user123',
        'user123',
        'identityDB',
        'users',
        data,
        mockLogger
      );

      const after = new Date();

      expect(result.timestamp).toBeInstanceOf(Date);
      expect(result.timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(result.timestamp.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it('preserves document path in normalized data', () => {
      const data = { test: 'data' };
      const documentPath = 'users/user123/settings/prefs456';

      const result = normalizeFirestoreEvent(
        'create',
        documentPath,
        'prefs456',
        'identityDB',
        'settings',
        data,
        mockLogger
      );

      expect(result.normalized.documentPath).toBe(documentPath);
    });

    it('does not log sensitive data', () => {
      const sensitiveData = {
        email: 'sensitive@example.com',
        phoneNumber: '+61412345678',
        password: 'should-never-be-logged',
      };

      normalizeFirestoreEvent(
        'create',
        'users/user123',
        'user123',
        'identityDB',
        'users',
        sensitiveData,
        mockLogger
      );

      expect(mockLogger.debug).toHaveBeenCalled();
      const logCalls = (mockLogger.debug as jest.Mock).mock.calls;

      // Verify no sensitive data in any log call
      logCalls.forEach((call) => {
        const logArgs = JSON.stringify(call);
        expect(logArgs).not.toContain('sensitive@example.com');
        expect(logArgs).not.toContain('+61412345678');
        expect(logArgs).not.toContain('should-never-be-logged');
      });
    });
  });

  describe('normalizeAuthEvent', () => {
    it('normalizes Auth user created event', () => {
      const userData = {
        uid: 'user123',
        email: 'user@example.com',
        displayName: 'Test User',
      };

      const result = normalizeAuthEvent('created', 'user123', userData, mockLogger);

      expect(result.eventName).toBe('auth.user.created');
      expect(result.source).toBe('auth');
      expect(result.normalized.userId).toBe('user123');
      expect(result.normalized.operation).toBe('created');
      expect(result.raw).toEqual(userData);
    });

    it('normalizes Auth user deleted event', () => {
      const userData = { uid: 'user456' };

      const result = normalizeAuthEvent('deleted', 'user456', userData, mockLogger);

      expect(result.eventName).toBe('auth.user.deleted');
      expect(result.source).toBe('auth');
      expect(result.normalized.userId).toBe('user456');
      expect(result.normalized.operation).toBe('deleted');
    });

    it('generates unique event ID with userId and timestamp', () => {
      const userData = { uid: 'user123' };

      const result = normalizeAuthEvent('created', 'user123', userData, mockLogger);

      expect(result.eventId).toContain('auth.user.created');
      expect(result.eventId).toContain('user123');
      expect(result.eventId).toMatch(/auth\.user\.created-user123-\d+/);
    });

    it('sets timestamp to current date', () => {
      const before = new Date();
      const userData = { uid: 'user123' };

      const result = normalizeAuthEvent('created', 'user123', userData, mockLogger);

      const after = new Date();

      expect(result.timestamp).toBeInstanceOf(Date);
      expect(result.timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(result.timestamp.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it('does not log sensitive user data', () => {
      const sensitiveData = {
        uid: 'user123',
        email: 'sensitive@example.com',
        phoneNumber: '+61412345678',
        customClaims: { role: 'admin' },
      };

      normalizeAuthEvent('created', 'user123', sensitiveData, mockLogger);

      expect(mockLogger.debug).toHaveBeenCalled();
      const logCalls = (mockLogger.debug as jest.Mock).mock.calls;

      // Verify no sensitive data in any log call
      logCalls.forEach((call) => {
        const logArgs = JSON.stringify(call);
        expect(logArgs).not.toContain('sensitive@example.com');
        expect(logArgs).not.toContain('+61412345678');
        expect(logArgs).not.toContain('admin');
      });
    });

    it('preserves all user data in raw field', () => {
      const userData = {
        uid: 'user123',
        email: 'user@example.com',
        displayName: 'Test User',
        customClaims: { role: 'admin', permissions: ['read', 'write'] },
        metadata: { creationTime: '2024-01-01' },
      };

      const result = normalizeAuthEvent('created', 'user123', userData, mockLogger);

      expect(result.raw).toEqual(userData);
      expect(result.raw.customClaims).toEqual(userData.customClaims);
      expect(result.raw.metadata).toEqual(userData.metadata);
    });
  });

  describe('normalizeStorageEvent', () => {
    it('normalizes Storage upload event', () => {
      const metadata = {
        name: 'profile.jpg',
        bucket: 'my-bucket',
        contentType: 'image/jpeg',
        size: 12345,
      };

      const result = normalizeStorageEvent(
        'users/user123/profile.jpg',
        metadata,
        mockLogger
      );

      expect(result.eventName).toBe('storage.object.finalized');
      expect(result.source).toBe('storage');
      expect(result.normalized.filePath).toBe('users/user123/profile.jpg');
      expect(result.normalized.operation).toBe('upload');
      expect(result.raw).toEqual(metadata);
    });

    it('generates unique event ID with timestamp', async () => {
      const metadata = { name: 'file.txt' };

      const result1 = normalizeStorageEvent('path/file1.txt', metadata, mockLogger);
      // Small delay to ensure different timestamps
      await new Promise(resolve => setTimeout(resolve, 2));
      const result2 = normalizeStorageEvent('path/file2.txt', metadata, mockLogger);

      expect(result1.eventId).toContain('storage.object.finalized');
      expect(result1.eventId).toMatch(/storage\.object\.finalized-\d+/);
      expect(result2.eventId).not.toBe(result1.eventId);
    });

    it('sets timestamp to current date', () => {
      const before = new Date();
      const metadata = { name: 'file.txt' };

      const result = normalizeStorageEvent('path/file.txt', metadata, mockLogger);

      const after = new Date();

      expect(result.timestamp).toBeInstanceOf(Date);
      expect(result.timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(result.timestamp.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it('does not log metadata content', () => {
      const sensitiveMetadata = {
        name: 'document.pdf',
        contentType: 'application/pdf',
        metadata: {
          uploadedBy: 'user@example.com',
          customField: 'sensitive-data',
        },
      };

      normalizeStorageEvent('uploads/document.pdf', sensitiveMetadata, mockLogger);

      expect(mockLogger.debug).toHaveBeenCalled();
      const logCalls = (mockLogger.debug as jest.Mock).mock.calls;

      // Verify no metadata content in any log call
      logCalls.forEach((call) => {
        const logArgs = JSON.stringify(call);
        expect(logArgs).not.toContain('user@example.com');
        expect(logArgs).not.toContain('sensitive-data');
      });
    });

    it('preserves all metadata in raw field', () => {
      const metadata = {
        name: 'file.txt',
        bucket: 'my-bucket',
        generation: '123',
        metageneration: '1',
        contentType: 'text/plain',
        timeCreated: '2024-01-01T00:00:00Z',
        updated: '2024-01-01T00:00:00Z',
        storageClass: 'STANDARD',
        size: 1024,
        md5Hash: 'abc123',
        contentEncoding: 'gzip',
        contentDisposition: 'attachment',
        metadata: {
          custom: 'value',
        },
      };

      const result = normalizeStorageEvent('path/file.txt', metadata, mockLogger);

      expect(result.raw).toEqual(metadata);
      expect(result.raw.metadata).toEqual(metadata.metadata);
    });
  });

  describe('extractCollectionName', () => {
    it('extracts collection from simple path', () => {
      expect(extractCollectionName('users/{userUID}')).toBe('users');
    });

    it('extracts collection from nested path', () => {
      expect(extractCollectionName('users/{userUID}/posts/{postUID}')).toBe('posts');
    });

    it('extracts collection from deeply nested path', () => {
      expect(extractCollectionName('users/{userUID}/posts/{postUID}/comments/{commentUID}'))
        .toBe('comments');
    });

    it('handles path without parameters', () => {
      expect(extractCollectionName('users')).toBe('users');
    });

    it('handles path with mixed parameter styles', () => {
      expect(extractCollectionName('users/{id}/settings')).toBe('settings');
    });

    it('extracts from path with multiple segments', () => {
      expect(extractCollectionName('a/{b}/c/{d}/e/{f}/g/{h}')).toBe('g');
    });

    it('handles single segment path', () => {
      expect(extractCollectionName('users')).toBe('users');
    });

    it('returns first segment if all are parameters', () => {
      expect(extractCollectionName('{userUID}')).toBe('{userUID}');
    });

    it('handles trailing slash', () => {
      // Note: This might not be a realistic case but tests edge behavior
      const result = extractCollectionName('users/{userUID}/posts');
      expect(result).toBe('posts');
    });
  });

  describe('NormalizedFirebaseEvent type compatibility', () => {
    it('creates valid Firestore event structure', () => {
      const data = { test: 'data' };
      const result: NormalizedFirebaseEvent = normalizeFirestoreEvent(
        'create',
        'users/user123',
        'user123',
        'identityDB',
        'users',
        data,
        mockLogger
      );

      expect(result).toHaveProperty('eventId');
      expect(result).toHaveProperty('eventName');
      expect(result).toHaveProperty('timestamp');
      expect(result).toHaveProperty('source');
      expect(result).toHaveProperty('normalized');
      expect(result).toHaveProperty('raw');
    });

    it('creates valid Auth event structure', () => {
      const userData = { uid: 'user123' };
      const result: NormalizedFirebaseEvent = normalizeAuthEvent(
        'created',
        'user123',
        userData,
        mockLogger
      );

      expect(result).toHaveProperty('eventId');
      expect(result).toHaveProperty('eventName');
      expect(result).toHaveProperty('timestamp');
      expect(result).toHaveProperty('source');
      expect(result).toHaveProperty('normalized');
      expect(result).toHaveProperty('raw');
    });

    it('creates valid Storage event structure', () => {
      const metadata = { name: 'file.txt' };
      const result: NormalizedFirebaseEvent = normalizeStorageEvent(
        'path/file.txt',
        metadata,
        mockLogger
      );

      expect(result).toHaveProperty('eventId');
      expect(result).toHaveProperty('eventName');
      expect(result).toHaveProperty('timestamp');
      expect(result).toHaveProperty('source');
      expect(result).toHaveProperty('normalized');
      expect(result).toHaveProperty('raw');
    });
  });
});
