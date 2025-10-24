/**
 * Work Management Connector
 * Task and article management across platforms
 */

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
  WorkResponse,
} from './types';
import { logger } from '../logger';

/**
 * Work Management Provider Interface
 */
export interface WorkManagementProvider {
  // Task operations
  getTask(taskId: string): Promise<WorkTask>;
  getTasks(listId: string, options?: WorkQueryOptions): Promise<WorkTask[]>;
  createTask(request: CreateTaskRequest): Promise<WorkTask>;
  updateTask(taskId: string, updates: UpdateTaskRequest): Promise<WorkTask>;
  deleteTask(taskId: string): Promise<void>;

  // Article/Document operations
  getArticle(articleId: string): Promise<WorkArticle>;
  getArticles(parentId?: string, options?: WorkQueryOptions): Promise<WorkArticle[]>;
  createArticle(request: CreateArticleRequest): Promise<WorkArticle>;
  updateArticle(articleId: string, updates: UpdateArticleRequest): Promise<WorkArticle>;
  deleteArticle(articleId: string): Promise<void>;

  // Workspace/Space operations
  getWorkspaces(): Promise<Workspace[]>;
  getWorkspace(workspaceId: string): Promise<Workspace>;

  // List/Board operations
  getLists(workspaceId: string): Promise<WorkList[]>;
  getList(listId: string): Promise<WorkList>;

  // Comment operations
  getComments(targetId: string): Promise<WorkComment[]>;
  createComment(request: CreateCommentRequest): Promise<WorkComment>;
}

/**
 * Work Management Connector
 * Unified interface for task and article management platforms
 */
export class WorkManagementConnector {
  private provider: WorkManagementProvider;

  constructor(provider: WorkManagementProvider) {
    this.provider = provider;
  }

  /**
   * Get task by ID
   */
  async getTask(taskId: string): Promise<WorkResponse<WorkTask>> {
    logger.info('Fetching task', { taskId });

    try {
      const task = await this.provider.getTask(taskId);
      return { success: true, data: task };
    } catch (error) {
      logger.error('Error fetching task', {
        taskId,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        success: false,
        error: {
          code: 'FETCH_ERROR',
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  /**
   * Get tasks from list
   */
  async getTasks(listId: string, options?: WorkQueryOptions): Promise<WorkResponse<WorkTask[]>> {
    logger.info('Fetching tasks', { listId, options });

    try {
      const tasks = await this.provider.getTasks(listId, options);
      return { success: true, data: tasks };
    } catch (error) {
      logger.error('Error fetching tasks', {
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        success: false,
        error: {
          code: 'FETCH_ERROR',
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  /**
   * Create new task
   */
  async createTask(request: CreateTaskRequest): Promise<WorkResponse<WorkTask>> {
    logger.info('Creating task', {
      listId: request.listId,
      title: request.title,
    });

    try {
      const task = await this.provider.createTask(request);
      return { success: true, data: task };
    } catch (error) {
      logger.error('Error creating task', {
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        success: false,
        error: {
          code: 'CREATE_ERROR',
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  /**
   * Update task
   */
  async updateTask(taskId: string, updates: UpdateTaskRequest): Promise<WorkResponse<WorkTask>> {
    logger.info('Updating task', { taskId, updates });

    try {
      const task = await this.provider.updateTask(taskId, updates);
      return { success: true, data: task };
    } catch (error) {
      logger.error('Error updating task', {
        taskId,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        success: false,
        error: {
          code: 'UPDATE_ERROR',
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  /**
   * Delete task
   */
  async deleteTask(taskId: string): Promise<WorkResponse<void>> {
    logger.info('Deleting task', { taskId });

    try {
      await this.provider.deleteTask(taskId);
      return { success: true };
    } catch (error) {
      logger.error('Error deleting task', {
        taskId,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        success: false,
        error: {
          code: 'DELETE_ERROR',
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  /**
   * Get article by ID
   */
  async getArticle(articleId: string): Promise<WorkResponse<WorkArticle>> {
    logger.info('Fetching article', { articleId });

    try {
      const article = await this.provider.getArticle(articleId);
      return { success: true, data: article };
    } catch (error) {
      logger.error('Error fetching article', {
        articleId,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        success: false,
        error: {
          code: 'FETCH_ERROR',
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  /**
   * Get articles
   */
  async getArticles(parentId?: string, options?: WorkQueryOptions): Promise<WorkResponse<WorkArticle[]>> {
    logger.info('Fetching articles', { parentId, options });

    try {
      const articles = await this.provider.getArticles(parentId, options);
      return { success: true, data: articles };
    } catch (error) {
      logger.error('Error fetching articles', {
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        success: false,
        error: {
          code: 'FETCH_ERROR',
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  /**
   * Create article
   */
  async createArticle(request: CreateArticleRequest): Promise<WorkResponse<WorkArticle>> {
    logger.info('Creating article', {
      parentId: request.parentId,
      title: request.title,
    });

    try {
      const article = await this.provider.createArticle(request);
      return { success: true, data: article };
    } catch (error) {
      logger.error('Error creating article', {
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        success: false,
        error: {
          code: 'CREATE_ERROR',
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  /**
   * Update article
   */
  async updateArticle(articleId: string, updates: UpdateArticleRequest): Promise<WorkResponse<WorkArticle>> {
    logger.info('Updating article', { articleId, updates });

    try {
      const article = await this.provider.updateArticle(articleId, updates);
      return { success: true, data: article };
    } catch (error) {
      logger.error('Error updating article', {
        articleId,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        success: false,
        error: {
          code: 'UPDATE_ERROR',
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  /**
   * Delete article
   */
  async deleteArticle(articleId: string): Promise<WorkResponse<void>> {
    logger.info('Deleting article', { articleId });

    try {
      await this.provider.deleteArticle(articleId);
      return { success: true };
    } catch (error) {
      logger.error('Error deleting article', {
        articleId,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        success: false,
        error: {
          code: 'DELETE_ERROR',
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  /**
   * Get workspaces
   */
  async getWorkspaces(): Promise<WorkResponse<Workspace[]>> {
    logger.info('Fetching workspaces');

    try {
      const workspaces = await this.provider.getWorkspaces();
      return { success: true, data: workspaces };
    } catch (error) {
      logger.error('Error fetching workspaces', {
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        success: false,
        error: {
          code: 'FETCH_ERROR',
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  /**
   * Get lists
   */
  async getLists(workspaceId: string): Promise<WorkResponse<WorkList[]>> {
    logger.info('Fetching lists', { workspaceId });

    try {
      const lists = await this.provider.getLists(workspaceId);
      return { success: true, data: lists };
    } catch (error) {
      logger.error('Error fetching lists', {
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        success: false,
        error: {
          code: 'FETCH_ERROR',
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  /**
   * Get comments
   */
  async getComments(targetId: string): Promise<WorkResponse<WorkComment[]>> {
    logger.info('Fetching comments', { targetId });

    try {
      const comments = await this.provider.getComments(targetId);
      return { success: true, data: comments };
    } catch (error) {
      logger.error('Error fetching comments', {
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        success: false,
        error: {
          code: 'FETCH_ERROR',
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  /**
   * Create comment
   */
  async createComment(request: CreateCommentRequest): Promise<WorkResponse<WorkComment>> {
    logger.info('Creating comment', {
      targetId: request.targetId,
    });

    try {
      const comment = await this.provider.createComment(request);
      return { success: true, data: comment };
    } catch (error) {
      logger.error('Error creating comment', {
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        success: false,
        error: {
          code: 'CREATE_ERROR',
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }
}
