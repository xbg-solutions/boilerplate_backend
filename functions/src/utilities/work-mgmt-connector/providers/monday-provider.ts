/**
 * Monday.com Provider for Work Management Connector
 * https://developer.monday.com/api-reference/docs
 */

import axios, { AxiosInstance } from 'axios';
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

export interface MondayProviderConfig {
  apiKey: string;
}

export class MondayProvider implements WorkManagementProvider {
  private client: AxiosInstance;

  constructor(config: MondayProviderConfig) {
    this.client = axios.create({
      baseURL: 'https://api.monday.com/v2',
      headers: {
        'Authorization': config.apiKey,
        'Content-Type': 'application/json',
      },
    });
  }

  private async query(query: string, variables?: any): Promise<any> {
    const response = await this.client.post('', { query, variables });
    if (response.data.errors) {
      throw new Error(response.data.errors[0].message);
    }
    return response.data.data;
  }

  async getTask(taskId: string): Promise<WorkTask> {
    const query = `query { items(ids: [${taskId}]) { id name column_values { id text } state group { title } created_at updated_at } }`;
    const data = await this.query(query);
    return this.mapMondayItemToTask(data.items[0]);
  }

  async getTasks(listId: string, options?: WorkQueryOptions): Promise<WorkTask[]> {
    const query = `query { boards(ids: [${listId}]) { items(limit: ${options?.limit || 100}) { id name column_values { id text } state group { title } created_at updated_at } } }`;
    const data = await this.query(query);
    return data.boards[0].items.map((item: any) => this.mapMondayItemToTask(item));
  }

  async createTask(request: CreateTaskRequest): Promise<WorkTask> {
    const mutation = `mutation { create_item(board_id: ${request.listId}, item_name: "${request.title}") { id name created_at } }`;
    const data = await this.query(mutation);
    return this.mapMondayItemToTask(data.create_item);
  }

  async updateTask(taskId: string, updates: UpdateTaskRequest): Promise<WorkTask> {
    const columnValues = JSON.stringify({});
    const mutation = `mutation { change_multiple_column_values(item_id: ${taskId}, board_id: 0, column_values: "${columnValues.replace(/"/g, '\\"')}") { id name } }`;
    const data = await this.query(mutation);
    return this.mapMondayItemToTask(data.change_multiple_column_values);
  }

  async deleteTask(taskId: string): Promise<void> {
    const mutation = `mutation { delete_item(item_id: ${taskId}) { id } }`;
    await this.query(mutation);
  }

  // Monday.com uses Docs for articles
  async getArticle(articleId: string): Promise<WorkArticle> {
    const query = `query { docs(ids: [${articleId}]) { id name content created_at updated_at url } }`;
    const data = await this.query(query);
    return this.mapMondayDocToArticle(data.docs[0]);
  }

  async getArticles(parentId?: string, options?: WorkQueryOptions): Promise<WorkArticle[]> {
    const query = `query { docs(limit: ${options?.limit || 100}) { id name content created_at updated_at url } }`;
    const data = await this.query(query);
    return data.docs.map((doc: any) => this.mapMondayDocToArticle(doc));
  }

  async createArticle(request: CreateArticleRequest): Promise<WorkArticle> {
    const mutation = `mutation { create_doc(location: { workspace: ${request.parentId || 0} }, doc_kind: wiki) { id name url } }`;
    const data = await this.query(mutation);
    // Update content separately
    const updateMutation = `mutation { update_doc(doc_id: ${data.create_doc.id}, content: "${request.content.replace(/"/g, '\\"')}") { id } }`;
    await this.query(updateMutation);
    return this.mapMondayDocToArticle(data.create_doc);
  }

  async updateArticle(articleId: string, updates: UpdateArticleRequest): Promise<WorkArticle> {
    if (updates.content) {
      const mutation = `mutation { update_doc(doc_id: ${articleId}, content: "${updates.content.replace(/"/g, '\\"')}") { id name content } }`;
      const data = await this.query(mutation);
      return this.mapMondayDocToArticle(data.update_doc);
    }
    return this.getArticle(articleId);
  }

  async deleteArticle(articleId: string): Promise<void> {
    const mutation = `mutation { delete_doc(doc_id: ${articleId}) { id } }`;
    await this.query(mutation);
  }

  async getWorkspaces(): Promise<Workspace[]> {
    const query = `query { workspaces { id name description } }`;
    const data = await this.query(query);
    return data.workspaces.map((ws: any) => ({
      id: ws.id,
      name: ws.name,
      description: ws.description,
    }));
  }

  async getWorkspace(workspaceId: string): Promise<Workspace> {
    const query = `query { workspaces(ids: [${workspaceId}]) { id name description } }`;
    const data = await this.query(query);
    return {
      id: data.workspaces[0].id,
      name: data.workspaces[0].name,
      description: data.workspaces[0].description,
    };
  }

  async getLists(workspaceId: string): Promise<WorkList[]> {
    const query = `query { boards(workspace_ids: [${workspaceId}]) { id name description } }`;
    const data = await this.query(query);
    return data.boards.map((board: any) => ({
      id: board.id,
      name: board.name,
      workspaceId,
      description: board.description,
    }));
  }

  async getList(listId: string): Promise<WorkList> {
    const query = `query { boards(ids: [${listId}]) { id name description } }`;
    const data = await this.query(query);
    return {
      id: data.boards[0].id,
      name: data.boards[0].name,
      description: data.boards[0].description,
    };
  }

  async getComments(targetId: string): Promise<WorkComment[]> {
    const query = `query { items(ids: [${targetId}]) { updates { id body creator { id name } created_at } } }`;
    const data = await this.query(query);
    return data.items[0].updates.map((update: any) => ({
      id: update.id,
      text: update.body,
      author: {
        id: update.creator.id,
        name: update.creator.name,
      },
      createdAt: new Date(update.created_at),
    }));
  }

  async createComment(request: CreateCommentRequest): Promise<WorkComment> {
    const mutation = `mutation { create_update(item_id: ${request.targetId}, body: "${request.text.replace(/"/g, '\\"')}") { id body creator { id name } created_at } }`;
    const data = await this.query(mutation);
    return {
      id: data.create_update.id,
      text: data.create_update.body,
      author: {
        id: data.create_update.creator.id,
        name: data.create_update.creator.name,
      },
      createdAt: new Date(data.create_update.created_at),
    };
  }

  private mapMondayItemToTask(item: any): WorkTask {
    return {
      id: item.id,
      title: item.name,
      status: item.state || item.group?.title || 'no status',
      createdAt: new Date(item.created_at),
      updatedAt: new Date(item.updated_at || item.created_at),
    };
  }

  private mapMondayDocToArticle(doc: any): WorkArticle {
    return {
      id: doc.id,
      title: doc.name,
      content: doc.content || '',
      createdAt: doc.created_at ? new Date(doc.created_at) : undefined,
      updatedAt: doc.updated_at ? new Date(doc.updated_at) : undefined,
      url: doc.url,
    };
  }
}
