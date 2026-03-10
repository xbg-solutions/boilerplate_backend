/**
 * Notion Provider for Work Management Connector
 * https://developers.notion.com/
 */

import { Client } from '@notionhq/client';
import { WorkManagementProvider } from '../work-mgmt-connector';
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

export interface NotionProviderConfig {
  apiKey: string;
}

export class NotionProvider implements WorkManagementProvider {
  private client: Client;

  constructor(config: NotionProviderConfig) {
    this.client = new Client({ auth: config.apiKey });
  }

  /**
   * Get task (database item) by ID
   */
  async getTask(taskId: string): Promise<WorkTask> {
    try {
      const page: any = await this.client.pages.retrieve({ page_id: taskId });
      return this.mapNotionPageToTask(page);
    } catch (error: any) {
      throw new Error(`Failed to get task: ${error.message}`);
    }
  }

  /**
   * Get tasks from database
   */
  async getTasks(listId: string, options?: WorkQueryOptions): Promise<WorkTask[]> {
    try {
      const response: any = await this.client.databases.query({
        database_id: listId,
        page_size: options?.limit || 100,
      });

      return response.results.map((page: any) => this.mapNotionPageToTask(page));
    } catch (error: any) {
      throw new Error(`Failed to get tasks: ${error.message}`);
    }
  }

  /**
   * Create task in database
   */
  async createTask(request: CreateTaskRequest): Promise<WorkTask> {
    try {
      const properties: any = {
        Name: { title: [{ text: { content: request.title } }] },
      };

      if (request.description) {
        properties.Description = { rich_text: [{ text: { content: request.description } }] };
      }

      if (request.status) {
        properties.Status = { select: { name: request.status } };
      }

      if (request.dueDate) {
        properties['Due Date'] = { date: { start: request.dueDate.toISOString() } };
      }

      const page: any = await this.client.pages.create({
        parent: { database_id: request.listId },
        properties,
      });

      return this.mapNotionPageToTask(page);
    } catch (error: any) {
      throw new Error(`Failed to create task: ${error.message}`);
    }
  }

  /**
   * Update task
   */
  async updateTask(taskId: string, updates: UpdateTaskRequest): Promise<WorkTask> {
    try {
      const properties: any = {};

      if (updates.title) {
        properties.Name = { title: [{ text: { content: updates.title } }] };
      }

      if (updates.description) {
        properties.Description = { rich_text: [{ text: { content: updates.description } }] };
      }

      if (updates.status) {
        properties.Status = { select: { name: updates.status } };
      }

      if (updates.dueDate) {
        properties['Due Date'] = { date: { start: updates.dueDate.toISOString() } };
      }

      const page: any = await this.client.pages.update({
        page_id: taskId,
        properties,
      });

      return this.mapNotionPageToTask(page);
    } catch (error: any) {
      throw new Error(`Failed to update task: ${error.message}`);
    }
  }

  /**
   * Delete task (archive in Notion)
   */
  async deleteTask(taskId: string): Promise<void> {
    try {
      await this.client.pages.update({
        page_id: taskId,
        archived: true,
      });
    } catch (error: any) {
      throw new Error(`Failed to delete task: ${error.message}`);
    }
  }

  /**
   * Get article (page) by ID
   */
  async getArticle(articleId: string): Promise<WorkArticle> {
    try {
      const page: any = await this.client.pages.retrieve({ page_id: articleId });
      const blocks: any = await this.client.blocks.children.list({ block_id: articleId });

      const content = blocks.results
        .map((block: any) => this.extractBlockText(block))
        .join('\n');

      return this.mapNotionPageToArticle(page, content);
    } catch (error: any) {
      throw new Error(`Failed to get article: ${error.message}`);
    }
  }

  /**
   * Get articles (pages) from parent
   */
  async getArticles(parentId?: string, options?: WorkQueryOptions): Promise<WorkArticle[]> {
    try {
      if (!parentId) {
        // Search all pages
        const response: any = await this.client.search({
          filter: { property: 'object', value: 'page' },
          page_size: options?.limit || 100,
        });

        return Promise.all(
          response.results.map(async (page: any) => {
            const blocks: any = await this.client.blocks.children.list({ block_id: page.id });
            const content = blocks.results
              .map((block: any) => this.extractBlockText(block))
              .join('\n');
            return this.mapNotionPageToArticle(page, content);
          })
        );
      } else {
        // Get child pages
        const blocks: any = await this.client.blocks.children.list({
          block_id: parentId,
        });

        const childPages = blocks.results.filter((block: any) => block.type === 'child_page');

        return Promise.all(
          childPages.map(async (child: any) => {
            const page: any = await this.client.pages.retrieve({ page_id: child.id });
            const pageBlocks: any = await this.client.blocks.children.list({ block_id: child.id });
            const content = pageBlocks.results
              .map((block: any) => this.extractBlockText(block))
              .join('\n');
            return this.mapNotionPageToArticle(page, content);
          })
        );
      }
    } catch (error: any) {
      throw new Error(`Failed to get articles: ${error.message}`);
    }
  }

  /**
   * Create article (page)
   */
  async createArticle(request: CreateArticleRequest): Promise<WorkArticle> {
    try {
      const parent = request.parentId
        ? { page_id: request.parentId }
        : { workspace: true };

      const page: any = await this.client.pages.create({
        parent: parent as any,
        properties: {
          title: { title: [{ text: { content: request.title } }] },
        },
        children: [
          {
            object: 'block',
            type: 'paragraph',
            paragraph: {
              rich_text: [{ type: 'text', text: { content: request.content } }],
            },
          },
        ] as any,
      });

      return this.mapNotionPageToArticle(page, request.content);
    } catch (error: any) {
      throw new Error(`Failed to create article: ${error.message}`);
    }
  }

  /**
   * Update article
   */
  async updateArticle(articleId: string, updates: UpdateArticleRequest): Promise<WorkArticle> {
    try {
      if (updates.title) {
        await this.client.pages.update({
          page_id: articleId,
          properties: {
            title: { title: [{ text: { content: updates.title } }] },
          },
        });
      }

      const page: any = await this.client.pages.retrieve({ page_id: articleId });
      const blocks: any = await this.client.blocks.children.list({ block_id: articleId });
      const content = blocks.results
        .map((block: any) => this.extractBlockText(block))
        .join('\n');

      return this.mapNotionPageToArticle(page, content);
    } catch (error: any) {
      throw new Error(`Failed to update article: ${error.message}`);
    }
  }

  /**
   * Delete article (archive)
   */
  async deleteArticle(articleId: string): Promise<void> {
    try {
      await this.client.pages.update({
        page_id: articleId,
        archived: true,
      });
    } catch (error: any) {
      throw new Error(`Failed to delete article: ${error.message}`);
    }
  }

  /**
   * Get workspaces (limited in Notion API)
   */
  async getWorkspaces(): Promise<Workspace[]> {
    // Notion API doesn't expose workspace list directly
    // Return empty array or implement custom logic
    return [];
  }

  /**
   * Get workspace
   */
  async getWorkspace(workspaceId: string): Promise<Workspace> {
    return {
      id: workspaceId,
      name: 'Notion Workspace',
    };
  }

  /**
   * Get lists (databases)
   */
  async getLists(workspaceId: string): Promise<WorkList[]> {
    try {
      const response: any = await this.client.search({
        filter: { property: 'object', value: 'database' },
      });

      return response.results.map((db: any) => ({
        id: db.id,
        name: this.extractTitle(db.title),
        workspaceId,
      }));
    } catch (error: any) {
      throw new Error(`Failed to get lists: ${error.message}`);
    }
  }

  /**
   * Get list (database)
   */
  async getList(listId: string): Promise<WorkList> {
    try {
      const db: any = await this.client.databases.retrieve({ database_id: listId });
      return {
        id: db.id,
        name: this.extractTitle(db.title),
      };
    } catch (error: any) {
      throw new Error(`Failed to get list: ${error.message}`);
    }
  }

  /**
   * Get comments
   */
  async getComments(targetId: string): Promise<WorkComment[]> {
    try {
      const response: any = await this.client.comments.list({ block_id: targetId });

      return response.results.map((comment: any) => ({
        id: comment.id,
        text: this.extractRichText(comment.rich_text),
        author: {
          id: comment.created_by.id,
          name: comment.created_by.name || 'Unknown',
        },
        createdAt: new Date(comment.created_time),
      }));
    } catch (error: any) {
      throw new Error(`Failed to get comments: ${error.message}`);
    }
  }

  /**
   * Create comment
   */
  async createComment(request: CreateCommentRequest): Promise<WorkComment> {
    try {
      const comment: any = await this.client.comments.create({
        parent: { page_id: request.targetId },
        rich_text: [{ type: 'text', text: { content: request.text } }],
      });

      return {
        id: comment.id,
        text: request.text,
        author: {
          id: comment.created_by.id,
          name: comment.created_by.name || 'Unknown',
        },
        createdAt: new Date(comment.created_time),
      };
    } catch (error: any) {
      throw new Error(`Failed to create comment: ${error.message}`);
    }
  }

  /**
   * Helper: Map Notion page to WorkTask
   */
  private mapNotionPageToTask(page: any): WorkTask {
    return {
      id: page.id,
      title: this.extractTitle(page.properties?.Name?.title || page.properties?.title?.title),
      description: this.extractRichText(page.properties?.Description?.rich_text),
      status: page.properties?.Status?.select?.name || 'no status',
      dueDate: page.properties?.['Due Date']?.date?.start
        ? new Date(page.properties['Due Date'].date.start)
        : undefined,
      createdAt: new Date(page.created_time),
      updatedAt: new Date(page.last_edited_time),
      url: page.url,
    };
  }

  /**
   * Helper: Map Notion page to WorkArticle
   */
  private mapNotionPageToArticle(page: any, content: string): WorkArticle {
    return {
      id: page.id,
      title: this.extractTitle(page.properties?.title?.title),
      content,
      createdAt: new Date(page.created_time),
      updatedAt: new Date(page.last_edited_time),
      url: page.url,
    };
  }

  /**
   * Helper: Extract title from Notion title array
   */
  private extractTitle(titleArray: any[]): string {
    if (!titleArray || titleArray.length === 0) return '';
    return titleArray.map((item: any) => item.plain_text || item.text?.content || '').join('');
  }

  /**
   * Helper: Extract text from Notion rich_text array
   */
  private extractRichText(richTextArray: any[]): string {
    if (!richTextArray || richTextArray.length === 0) return '';
    return richTextArray.map((item: any) => item.plain_text || item.text?.content || '').join('');
  }

  /**
   * Helper: Extract text from Notion block
   */
  private extractBlockText(block: any): string {
    const type = block.type;
    if (!block[type]?.rich_text) return '';
    return this.extractRichText(block[type].rich_text);
  }
}
