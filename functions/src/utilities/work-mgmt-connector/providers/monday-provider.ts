/**
 * Monday.com Provider for Work Management Connector
 * https://developer.monday.com/api-reference/docs
 */

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
  private baseURL: string;
  private headers: Record<string, string>;

  constructor(config: MondayProviderConfig) {
    this.baseURL = 'https://api.monday.com/v2';
    this.headers = {
      'Authorization': config.apiKey,
      'Content-Type': 'application/json',
    };
  }

  private async request<T = any>(path: string, options: {
    method?: string;
    body?: any;
    params?: Record<string, any>;
  } = {}): Promise<{ data: T }> {
    const { method = 'GET', body, params } = options;
    let url = `${this.baseURL}${path}`;
    if (params) {
      const query = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null) query.append(key, String(value));
      }
      const qs = query.toString();
      if (qs) url += `?${qs}`;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: this.headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
    if (!res.ok) {
      const errorData = await res.json().catch(() => undefined);
      const error: any = new Error(`HTTP ${res.status}: ${res.statusText}`);
      error.response = { status: res.status, data: errorData };
      throw error;
    }
    const data = await res.json();
    return { data };
  }

  private async query(query: string, variables?: any): Promise<any> {
    const response = await this.request('', { method: 'POST', body: { query, variables } });
    if (response.data.errors) {
      throw new Error(response.data.errors[0].message);
    }
    return response.data.data;
  }

  async getTask(taskId: string): Promise<WorkTask> {
    const query = `query ($ids: [ID!]) { items(ids: $ids) { id name column_values { id text } state group { title } created_at updated_at } }`;
    const data = await this.query(query, { ids: [taskId] });
    return this.mapMondayItemToTask(data.items[0]);
  }

  async getTasks(listId: string, options?: WorkQueryOptions): Promise<WorkTask[]> {
    const query = `query ($ids: [ID!], $limit: Int) { boards(ids: $ids) { items(limit: $limit) { id name column_values { id text } state group { title } created_at updated_at } } }`;
    const data = await this.query(query, { ids: [listId], limit: options?.limit || 100 });
    return data.boards[0].items.map((item: any) => this.mapMondayItemToTask(item));
  }

  async createTask(request: CreateTaskRequest): Promise<WorkTask> {
    const mutation = `mutation ($boardId: ID!, $itemName: String!) { create_item(board_id: $boardId, item_name: $itemName) { id name created_at } }`;
    const data = await this.query(mutation, { boardId: request.listId, itemName: request.title });
    return this.mapMondayItemToTask(data.create_item);
  }

  async updateTask(taskId: string, updates: UpdateTaskRequest): Promise<WorkTask> {
    const columnValues = JSON.stringify({});
    const mutation = `mutation ($itemId: ID!, $boardId: ID!, $columnValues: JSON!) { change_multiple_column_values(item_id: $itemId, board_id: $boardId, column_values: $columnValues) { id name } }`;
    const data = await this.query(mutation, { itemId: taskId, boardId: 0, columnValues });
    return this.mapMondayItemToTask(data.change_multiple_column_values);
  }

  async deleteTask(taskId: string): Promise<void> {
    const mutation = `mutation ($itemId: ID!) { delete_item(item_id: $itemId) { id } }`;
    await this.query(mutation, { itemId: taskId });
  }

  // Monday.com uses Docs for articles
  async getArticle(articleId: string): Promise<WorkArticle> {
    const query = `query ($ids: [ID!]) { docs(ids: $ids) { id name content created_at updated_at url } }`;
    const data = await this.query(query, { ids: [articleId] });
    return this.mapMondayDocToArticle(data.docs[0]);
  }

  async getArticles(parentId?: string, options?: WorkQueryOptions): Promise<WorkArticle[]> {
    const query = `query ($limit: Int) { docs(limit: $limit) { id name content created_at updated_at url } }`;
    const data = await this.query(query, { limit: options?.limit || 100 });
    return data.docs.map((doc: any) => this.mapMondayDocToArticle(doc));
  }

  async createArticle(request: CreateArticleRequest): Promise<WorkArticle> {
    const mutation = `mutation ($workspaceId: ID!) { create_doc(location: { workspace: $workspaceId }, doc_kind: wiki) { id name url } }`;
    const data = await this.query(mutation, { workspaceId: request.parentId || 0 });
    // Update content separately
    const updateMutation = `mutation ($docId: ID!, $content: String!) { update_doc(doc_id: $docId, content: $content) { id } }`;
    await this.query(updateMutation, { docId: data.create_doc.id, content: request.content });
    return this.mapMondayDocToArticle(data.create_doc);
  }

  async updateArticle(articleId: string, updates: UpdateArticleRequest): Promise<WorkArticle> {
    if (updates.content) {
      const mutation = `mutation ($docId: ID!, $content: String!) { update_doc(doc_id: $docId, content: $content) { id name content } }`;
      const data = await this.query(mutation, { docId: articleId, content: updates.content });
      return this.mapMondayDocToArticle(data.update_doc);
    }
    return this.getArticle(articleId);
  }

  async deleteArticle(articleId: string): Promise<void> {
    const mutation = `mutation ($docId: ID!) { delete_doc(doc_id: $docId) { id } }`;
    await this.query(mutation, { docId: articleId });
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
    const query = `query ($ids: [ID!]) { workspaces(ids: $ids) { id name description } }`;
    const data = await this.query(query, { ids: [workspaceId] });
    return {
      id: data.workspaces[0].id,
      name: data.workspaces[0].name,
      description: data.workspaces[0].description,
    };
  }

  async getLists(workspaceId: string): Promise<WorkList[]> {
    const query = `query ($workspaceIds: [ID!]) { boards(workspace_ids: $workspaceIds) { id name description } }`;
    const data = await this.query(query, { workspaceIds: [workspaceId] });
    return data.boards.map((board: any) => ({
      id: board.id,
      name: board.name,
      workspaceId,
      description: board.description,
    }));
  }

  async getList(listId: string): Promise<WorkList> {
    const query = `query ($ids: [ID!]) { boards(ids: $ids) { id name description } }`;
    const data = await this.query(query, { ids: [listId] });
    return {
      id: data.boards[0].id,
      name: data.boards[0].name,
      description: data.boards[0].description,
    };
  }

  async getComments(targetId: string): Promise<WorkComment[]> {
    const query = `query ($ids: [ID!]) { items(ids: $ids) { updates { id body creator { id name } created_at } } }`;
    const data = await this.query(query, { ids: [targetId] });
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
    const mutation = `mutation ($itemId: ID!, $body: String!) { create_update(item_id: $itemId, body: $body) { id body creator { id name } created_at } }`;
    const data = await this.query(mutation, { itemId: request.targetId, body: request.text });
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
