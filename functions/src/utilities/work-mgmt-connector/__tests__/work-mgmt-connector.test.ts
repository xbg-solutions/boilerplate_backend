/**
 * Work Management Connector - Unit Tests
 *
 * Testing WHAT the work management connector does, not HOW it works internally:
 * - Manages tasks with status, priority, and assignments
 * - Creates and manages articles/documentation
 * - Organizes work in workspaces and lists
 * - Handles comments on tasks and articles
 * - Provides provider abstraction for work platforms (ClickUp, Notion, Linear, etc.)
 */

import { WorkManagementConnector, WorkManagementProvider } from '../work-mgmt-connector';
import {
  WorkTask,
  CreateTaskRequest,
  UpdateTaskRequest,
  WorkArticle,
  CreateArticleRequest,
  UpdateArticleRequest,
  Workspace,
  WorkList,
  WorkComment,
  CreateCommentRequest,
  WorkQueryOptions,
} from '../types';
import { logger } from '../../logger';

// Mock logger
jest.mock('../../logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

describe('Work Management Connector', () => {
  let mockProvider: jest.Mocked<WorkManagementProvider>;
  let connector: WorkManagementConnector;

  beforeEach(() => {
    jest.clearAllMocks();

    mockProvider = {
      getTask: jest.fn(),
      getTasks: jest.fn(),
      createTask: jest.fn(),
      updateTask: jest.fn(),
      deleteTask: jest.fn(),
      getArticle: jest.fn(),
      getArticles: jest.fn(),
      createArticle: jest.fn(),
      updateArticle: jest.fn(),
      deleteArticle: jest.fn(),
      getWorkspaces: jest.fn(),
      getWorkspace: jest.fn(),
      getLists: jest.fn(),
      getList: jest.fn(),
      getComments: jest.fn(),
      createComment: jest.fn(),
    };

    connector = new WorkManagementConnector(mockProvider);
  });

  describe('getTask', () => {
    it('retrieves task by ID', async () => {
      const task: WorkTask = {
        id: 'task-123',
        title: 'Implement user authentication',
        description: 'Add OAuth 2.0 support',
        status: 'in_progress',
        priority: 'high',
        assignees: [
          {
            id: 'user-1',
            name: 'John Doe',
            email: 'john@example.com',
          },
        ],
        dueDate: new Date('2025-11-01'),
        tags: ['backend', 'security'],
        createdAt: new Date(),
      };

      mockProvider.getTask.mockResolvedValue(task);

      const response = await connector.getTask('task-123');

      expect(mockProvider.getTask).toHaveBeenCalledWith('task-123');
      expect(response.success).toBe(true);
      expect(response.data?.id).toBe('task-123');
      expect(response.data?.title).toBe('Implement user authentication');
    });

    it('logs task fetch', async () => {
      const task: WorkTask = {
        id: 'task-456',
        title: 'Write documentation',
        status: 'todo',
      };

      mockProvider.getTask.mockResolvedValue(task);

      await connector.getTask('task-456');

      expect(logger.info).toHaveBeenCalledWith(
        'Fetching task',
        expect.objectContaining({
          taskId: 'task-456',
        })
      );
    });

    it('handles task not found', async () => {
      mockProvider.getTask.mockRejectedValue(new Error('Task not found'));

      const response = await connector.getTask('nonexistent');

      expect(response.success).toBe(false);
      expect(response.error?.code).toBe('FETCH_ERROR');
    });
  });

  describe('getTasks', () => {
    it('retrieves tasks from list', async () => {
      const tasks: WorkTask[] = [
        {
          id: 'task-1',
          title: 'Task One',
          status: 'todo',
        },
        {
          id: 'task-2',
          title: 'Task Two',
          status: 'in_progress',
        },
      ];

      mockProvider.getTasks.mockResolvedValue(tasks);

      const response = await connector.getTasks('list-123');

      expect(mockProvider.getTasks).toHaveBeenCalledWith('list-123', undefined);
      expect(response.success).toBe(true);
      expect(response.data).toHaveLength(2);
    });

    it('filters tasks with options', async () => {
      const options: WorkQueryOptions = {
        filters: { status: 'in_progress' },
        limit: 20,
      };

      mockProvider.getTasks.mockResolvedValue([]);

      await connector.getTasks('list-456', options);

      expect(mockProvider.getTasks).toHaveBeenCalledWith('list-456', options);
    });

    it('handles fetch errors', async () => {
      mockProvider.getTasks.mockRejectedValue(new Error('List not found'));

      const response = await connector.getTasks('invalid-list');

      expect(response.success).toBe(false);
      expect(response.error?.code).toBe('FETCH_ERROR');
    });
  });

  describe('createTask', () => {
    it('creates task successfully', async () => {
      const request: CreateTaskRequest = {
        listId: 'list-123',
        title: 'New Feature Request',
        description: 'Add dark mode support',
        status: 'todo',
        priority: 'medium',
        assigneeIds: ['user-1', 'user-2'],
        dueDate: new Date('2025-12-01'),
        tags: ['feature', 'ui'],
        customFields: {
          estimate: '5 days',
        },
      };

      const task: WorkTask = {
        id: 'task-new',
        title: 'New Feature Request',
        description: 'Add dark mode support',
        status: 'todo',
        priority: 'medium',
        assignees: [
          { id: 'user-1', name: 'User One' },
          { id: 'user-2', name: 'User Two' },
        ],
        dueDate: new Date('2025-12-01'),
        tags: ['feature', 'ui'],
        customFields: {
          estimate: '5 days',
        },
        createdAt: new Date(),
      };

      mockProvider.createTask.mockResolvedValue(task);

      const response = await connector.createTask(request);

      expect(mockProvider.createTask).toHaveBeenCalledWith(request);
      expect(response.success).toBe(true);
      expect(response.data?.id).toBe('task-new');
    });

    it('logs task creation', async () => {
      const request: CreateTaskRequest = {
        listId: 'list-789',
        title: 'Test Task',
      };

      const task: WorkTask = {
        id: 'task-test',
        title: 'Test Task',
        status: 'todo',
      };

      mockProvider.createTask.mockResolvedValue(task);

      await connector.createTask(request);

      expect(logger.info).toHaveBeenCalledWith(
        'Creating task',
        expect.objectContaining({
          listId: 'list-789',
          title: 'Test Task',
        })
      );
    });

    it('handles creation errors', async () => {
      const request: CreateTaskRequest = {
        listId: 'invalid-list',
        title: 'Test',
      };

      mockProvider.createTask.mockRejectedValue(new Error('List not found'));

      const response = await connector.createTask(request);

      expect(response.success).toBe(false);
      expect(response.error?.code).toBe('CREATE_ERROR');
    });
  });

  describe('updateTask', () => {
    it('updates task successfully', async () => {
      const updates: UpdateTaskRequest = {
        status: 'completed',
        priority: 'low',
      };

      const task: WorkTask = {
        id: 'task-123',
        title: 'Updated Task',
        status: 'completed',
        priority: 'low',
      };

      mockProvider.updateTask.mockResolvedValue(task);

      const response = await connector.updateTask('task-123', updates);

      expect(mockProvider.updateTask).toHaveBeenCalledWith('task-123', updates);
      expect(response.success).toBe(true);
      expect(response.data?.status).toBe('completed');
    });

    it('logs task update', async () => {
      const updates: UpdateTaskRequest = {
        title: 'New Title',
      };

      const task: WorkTask = {
        id: 'task-456',
        title: 'New Title',
        status: 'todo',
      };

      mockProvider.updateTask.mockResolvedValue(task);

      await connector.updateTask('task-456', updates);

      expect(logger.info).toHaveBeenCalledWith(
        'Updating task',
        expect.objectContaining({
          taskId: 'task-456',
          updates,
        })
      );
    });

    it('handles update errors', async () => {
      mockProvider.updateTask.mockRejectedValue(new Error('Task not found'));

      const response = await connector.updateTask('nonexistent', { status: 'done' });

      expect(response.success).toBe(false);
      expect(response.error?.code).toBe('UPDATE_ERROR');
    });
  });

  describe('deleteTask', () => {
    it('deletes task successfully', async () => {
      mockProvider.deleteTask.mockResolvedValue(undefined);

      const response = await connector.deleteTask('task-123');

      expect(mockProvider.deleteTask).toHaveBeenCalledWith('task-123');
      expect(response.success).toBe(true);
    });

    it('logs task deletion', async () => {
      mockProvider.deleteTask.mockResolvedValue(undefined);

      await connector.deleteTask('task-789');

      expect(logger.info).toHaveBeenCalledWith(
        'Deleting task',
        expect.objectContaining({
          taskId: 'task-789',
        })
      );
    });

    it('handles deletion errors', async () => {
      mockProvider.deleteTask.mockRejectedValue(new Error('Cannot delete completed task'));

      const response = await connector.deleteTask('task-completed');

      expect(response.success).toBe(false);
      expect(response.error?.code).toBe('DELETE_ERROR');
    });
  });

  describe('getArticle', () => {
    it('retrieves article by ID', async () => {
      const article: WorkArticle = {
        id: 'article-123',
        title: 'API Documentation',
        content: '# API Guide\n\nDetailed API documentation...',
        author: {
          id: 'user-1',
          name: 'Jane Doe',
        },
        status: 'published',
        tags: ['documentation', 'api'],
        createdAt: new Date(),
      };

      mockProvider.getArticle.mockResolvedValue(article);

      const response = await connector.getArticle('article-123');

      expect(mockProvider.getArticle).toHaveBeenCalledWith('article-123');
      expect(response.success).toBe(true);
      expect(response.data?.id).toBe('article-123');
      expect(response.data?.title).toBe('API Documentation');
    });

    it('logs article fetch', async () => {
      const article: WorkArticle = {
        id: 'article-456',
        title: 'Guide',
        content: 'Content',
      };

      mockProvider.getArticle.mockResolvedValue(article);

      await connector.getArticle('article-456');

      expect(logger.info).toHaveBeenCalledWith(
        'Fetching article',
        expect.objectContaining({
          articleId: 'article-456',
        })
      );
    });

    it('handles article not found', async () => {
      mockProvider.getArticle.mockRejectedValue(new Error('Article not found'));

      const response = await connector.getArticle('nonexistent');

      expect(response.success).toBe(false);
      expect(response.error?.code).toBe('FETCH_ERROR');
    });
  });

  describe('getArticles', () => {
    it('retrieves all articles', async () => {
      const articles: WorkArticle[] = [
        {
          id: 'article-1',
          title: 'Article One',
          content: 'Content 1',
        },
        {
          id: 'article-2',
          title: 'Article Two',
          content: 'Content 2',
        },
      ];

      mockProvider.getArticles.mockResolvedValue(articles);

      const response = await connector.getArticles();

      expect(mockProvider.getArticles).toHaveBeenCalledWith(undefined, undefined);
      expect(response.success).toBe(true);
      expect(response.data).toHaveLength(2);
    });

    it('retrieves articles by parent', async () => {
      const articles: WorkArticle[] = [
        {
          id: 'article-child',
          title: 'Child Article',
          content: 'Nested content',
        },
      ];

      mockProvider.getArticles.mockResolvedValue(articles);

      const response = await connector.getArticles('parent-123');

      expect(mockProvider.getArticles).toHaveBeenCalledWith('parent-123', undefined);
      expect(response.success).toBe(true);
    });

    it('handles fetch errors', async () => {
      mockProvider.getArticles.mockRejectedValue(new Error('API error'));

      const response = await connector.getArticles();

      expect(response.success).toBe(false);
      expect(response.error?.code).toBe('FETCH_ERROR');
    });
  });

  describe('createArticle', () => {
    it('creates article successfully', async () => {
      const request: CreateArticleRequest = {
        parentId: 'space-123',
        title: 'Getting Started Guide',
        content: '# Getting Started\n\nWelcome to our platform...',
        status: 'published',
        tags: ['guide', 'onboarding'],
      };

      const article: WorkArticle = {
        id: 'article-new',
        title: 'Getting Started Guide',
        content: '# Getting Started\n\nWelcome to our platform...',
        status: 'published',
        tags: ['guide', 'onboarding'],
        createdAt: new Date(),
      };

      mockProvider.createArticle.mockResolvedValue(article);

      const response = await connector.createArticle(request);

      expect(mockProvider.createArticle).toHaveBeenCalledWith(request);
      expect(response.success).toBe(true);
      expect(response.data?.id).toBe('article-new');
    });

    it('logs article creation', async () => {
      const request: CreateArticleRequest = {
        parentId: 'space-456',
        title: 'Test Article',
        content: 'Test content',
      };

      const article: WorkArticle = {
        id: 'article-test',
        title: 'Test Article',
        content: 'Test content',
      };

      mockProvider.createArticle.mockResolvedValue(article);

      await connector.createArticle(request);

      expect(logger.info).toHaveBeenCalledWith(
        'Creating article',
        expect.objectContaining({
          parentId: 'space-456',
          title: 'Test Article',
        })
      );
    });

    it('handles creation errors', async () => {
      const request: CreateArticleRequest = {
        title: 'Invalid Article',
        content: '',
      };

      mockProvider.createArticle.mockRejectedValue(new Error('Content cannot be empty'));

      const response = await connector.createArticle(request);

      expect(response.success).toBe(false);
      expect(response.error?.code).toBe('CREATE_ERROR');
    });
  });

  describe('updateArticle', () => {
    it('updates article successfully', async () => {
      const updates: UpdateArticleRequest = {
        title: 'Updated Guide',
        status: 'archived',
      };

      const article: WorkArticle = {
        id: 'article-123',
        title: 'Updated Guide',
        content: 'Original content',
        status: 'archived',
      };

      mockProvider.updateArticle.mockResolvedValue(article);

      const response = await connector.updateArticle('article-123', updates);

      expect(mockProvider.updateArticle).toHaveBeenCalledWith('article-123', updates);
      expect(response.success).toBe(true);
      expect(response.data?.title).toBe('Updated Guide');
    });

    it('logs article update', async () => {
      const updates: UpdateArticleRequest = {
        content: 'New content',
      };

      const article: WorkArticle = {
        id: 'article-456',
        title: 'Article',
        content: 'New content',
      };

      mockProvider.updateArticle.mockResolvedValue(article);

      await connector.updateArticle('article-456', updates);

      expect(logger.info).toHaveBeenCalledWith(
        'Updating article',
        expect.objectContaining({
          articleId: 'article-456',
          updates,
        })
      );
    });

    it('handles update errors', async () => {
      mockProvider.updateArticle.mockRejectedValue(new Error('Article not found'));

      const response = await connector.updateArticle('nonexistent', { title: 'New' });

      expect(response.success).toBe(false);
      expect(response.error?.code).toBe('UPDATE_ERROR');
    });
  });

  describe('deleteArticle', () => {
    it('deletes article successfully', async () => {
      mockProvider.deleteArticle.mockResolvedValue(undefined);

      const response = await connector.deleteArticle('article-123');

      expect(mockProvider.deleteArticle).toHaveBeenCalledWith('article-123');
      expect(response.success).toBe(true);
    });

    it('logs article deletion', async () => {
      mockProvider.deleteArticle.mockResolvedValue(undefined);

      await connector.deleteArticle('article-789');

      expect(logger.info).toHaveBeenCalledWith(
        'Deleting article',
        expect.objectContaining({
          articleId: 'article-789',
        })
      );
    });

    it('handles deletion errors', async () => {
      mockProvider.deleteArticle.mockRejectedValue(new Error('Article has child pages'));

      const response = await connector.deleteArticle('article-parent');

      expect(response.success).toBe(false);
      expect(response.error?.code).toBe('DELETE_ERROR');
    });
  });

  describe('getWorkspaces', () => {
    it('retrieves all workspaces', async () => {
      const workspaces: Workspace[] = [
        {
          id: 'workspace-1',
          name: 'Engineering',
          description: 'Engineering team workspace',
          members: [
            { id: 'user-1', name: 'John', role: 'admin' },
            { id: 'user-2', name: 'Jane', role: 'member' },
          ],
        },
        {
          id: 'workspace-2',
          name: 'Marketing',
          description: 'Marketing team workspace',
        },
      ];

      mockProvider.getWorkspaces.mockResolvedValue(workspaces);

      const response = await connector.getWorkspaces();

      expect(mockProvider.getWorkspaces).toHaveBeenCalled();
      expect(response.success).toBe(true);
      expect(response.data).toHaveLength(2);
      expect(response.data?.[0].name).toBe('Engineering');
    });

    it('logs workspace fetch', async () => {
      mockProvider.getWorkspaces.mockResolvedValue([]);

      await connector.getWorkspaces();

      expect(logger.info).toHaveBeenCalledWith('Fetching workspaces');
    });

    it('handles fetch errors', async () => {
      mockProvider.getWorkspaces.mockRejectedValue(new Error('API error'));

      const response = await connector.getWorkspaces();

      expect(response.success).toBe(false);
      expect(response.error?.code).toBe('FETCH_ERROR');
    });
  });

  describe('getLists', () => {
    it('retrieves lists for workspace', async () => {
      const lists: WorkList[] = [
        {
          id: 'list-1',
          name: 'Sprint 1',
          workspaceId: 'workspace-123',
          taskCount: 15,
        },
        {
          id: 'list-2',
          name: 'Backlog',
          workspaceId: 'workspace-123',
          taskCount: 42,
        },
      ];

      mockProvider.getLists.mockResolvedValue(lists);

      const response = await connector.getLists('workspace-123');

      expect(mockProvider.getLists).toHaveBeenCalledWith('workspace-123');
      expect(response.success).toBe(true);
      expect(response.data).toHaveLength(2);
    });

    it('logs list fetch', async () => {
      mockProvider.getLists.mockResolvedValue([]);

      await connector.getLists('workspace-456');

      expect(logger.info).toHaveBeenCalledWith(
        'Fetching lists',
        expect.objectContaining({
          workspaceId: 'workspace-456',
        })
      );
    });

    it('handles fetch errors', async () => {
      mockProvider.getLists.mockRejectedValue(new Error('Workspace not found'));

      const response = await connector.getLists('invalid');

      expect(response.success).toBe(false);
      expect(response.error?.code).toBe('FETCH_ERROR');
    });
  });

  describe('getComments', () => {
    it('retrieves comments for target', async () => {
      const comments: WorkComment[] = [
        {
          id: 'comment-1',
          text: 'Great work on this!',
          author: {
            id: 'user-1',
            name: 'John Doe',
          },
          createdAt: new Date(),
        },
        {
          id: 'comment-2',
          text: 'Updated the description',
          author: {
            id: 'user-2',
            name: 'Jane Smith',
          },
          createdAt: new Date(),
        },
      ];

      mockProvider.getComments.mockResolvedValue(comments);

      const response = await connector.getComments('task-123');

      expect(mockProvider.getComments).toHaveBeenCalledWith('task-123');
      expect(response.success).toBe(true);
      expect(response.data).toHaveLength(2);
    });

    it('logs comment fetch', async () => {
      mockProvider.getComments.mockResolvedValue([]);

      await connector.getComments('article-456');

      expect(logger.info).toHaveBeenCalledWith(
        'Fetching comments',
        expect.objectContaining({
          targetId: 'article-456',
        })
      );
    });

    it('handles fetch errors', async () => {
      mockProvider.getComments.mockRejectedValue(new Error('Target not found'));

      const response = await connector.getComments('invalid');

      expect(response.success).toBe(false);
      expect(response.error?.code).toBe('FETCH_ERROR');
    });
  });

  describe('createComment', () => {
    it('creates comment successfully', async () => {
      const request: CreateCommentRequest = {
        targetId: 'task-123',
        text: 'This looks good to me!',
      };

      const comment: WorkComment = {
        id: 'comment-new',
        text: 'This looks good to me!',
        author: {
          id: 'user-1',
          name: 'Reviewer',
        },
        createdAt: new Date(),
      };

      mockProvider.createComment.mockResolvedValue(comment);

      const response = await connector.createComment(request);

      expect(mockProvider.createComment).toHaveBeenCalledWith(request);
      expect(response.success).toBe(true);
      expect(response.data?.id).toBe('comment-new');
    });

    it('logs comment creation', async () => {
      const request: CreateCommentRequest = {
        targetId: 'article-789',
        text: 'Test comment',
      };

      const comment: WorkComment = {
        id: 'comment-test',
        text: 'Test comment',
        author: { id: 'user-1', name: 'User' },
        createdAt: new Date(),
      };

      mockProvider.createComment.mockResolvedValue(comment);

      await connector.createComment(request);

      expect(logger.info).toHaveBeenCalledWith(
        'Creating comment',
        expect.objectContaining({
          targetId: 'article-789',
        })
      );
    });

    it('handles creation errors', async () => {
      const request: CreateCommentRequest = {
        targetId: 'invalid',
        text: 'Test',
      };

      mockProvider.createComment.mockRejectedValue(new Error('Target not found'));

      const response = await connector.createComment(request);

      expect(response.success).toBe(false);
      expect(response.error?.code).toBe('CREATE_ERROR');
    });
  });

  describe('error handling', () => {
    it('handles non-Error exceptions', async () => {
      mockProvider.getTask.mockRejectedValue('String error');

      const response = await connector.getTask('task-123');

      expect(response.success).toBe(false);
      expect(logger.error).toHaveBeenCalled();
    });

    it('logs all errors appropriately', async () => {
      mockProvider.createTask.mockRejectedValue(new Error('Test error'));

      await connector.createTask({
        listId: 'list-123',
        title: 'Test',
      });

      expect(logger.error).toHaveBeenCalledWith(
        'Error creating task',
        expect.any(Error)
      );
    });
  });
});
