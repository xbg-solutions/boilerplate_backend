/**
 * ClickUp Provider for Work Management Connector
 * https://clickup.com/api
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

export interface ClickUpProviderConfig {
  apiKey: string;
}

export class ClickUpProvider implements WorkManagementProvider {
  private baseURL: string;
  private headers: Record<string, string>;

  constructor(config: ClickUpProviderConfig) {
    this.baseURL = 'https://api.clickup.com/api/v2';
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
    const res = await fetch(url, {
      method,
      headers: this.headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const errorData = await res.json().catch(() => undefined);
      const error: any = new Error(`HTTP ${res.status}: ${res.statusText}`);
      error.response = { status: res.status, data: errorData };
      throw error;
    }
    const data = await res.json();
    return { data };
  }

  async getTask(taskId: string): Promise<WorkTask> {
    const response = await this.request(`/task/${taskId}`);
    return this.mapClickUpTaskToWorkTask(response.data);
  }

  async getTasks(listId: string, options?: WorkQueryOptions): Promise<WorkTask[]> {
    const response = await this.request(`/list/${listId}/task`, {
      params: {
        page: options?.page || 0,
        order_by: options?.sort?.field,
        reverse: options?.sort?.order === 'desc',
      },
    });
    return response.data.tasks.map((task: any) => this.mapClickUpTaskToWorkTask(task));
  }

  async createTask(request: CreateTaskRequest): Promise<WorkTask> {
    const response = await this.request(`/list/${request.listId}/task`, {
      method: 'POST',
      body: {
        name: request.title,
        description: request.description,
        status: request.status,
        priority: this.mapPriorityToClickUp(request.priority),
        assignees: request.assigneeIds,
        due_date: request.dueDate?.getTime(),
        tags: request.tags,
      },
    });
    return this.mapClickUpTaskToWorkTask(response.data);
  }

  async updateTask(taskId: string, updates: UpdateTaskRequest): Promise<WorkTask> {
    const payload: any = {};
    if (updates.title) payload.name = updates.title;
    if (updates.description) payload.description = updates.description;
    if (updates.status) payload.status = updates.status;
    if (updates.priority) payload.priority = this.mapPriorityToClickUp(updates.priority);
    if (updates.assigneeIds) payload.assignees = { add: updates.assigneeIds };
    if (updates.dueDate) payload.due_date = updates.dueDate.getTime();

    const response = await this.request(`/task/${taskId}`, { method: 'PUT', body: payload });
    return this.mapClickUpTaskToWorkTask(response.data);
  }

  async deleteTask(taskId: string): Promise<void> {
    await this.request(`/task/${taskId}`, { method: 'DELETE' });
  }

  // ClickUp doesn't have native "article" support, so we use Docs API or tasks with rich descriptions
  async getArticle(articleId: string): Promise<WorkArticle> {
    const response = await this.request(`/task/${articleId}`);
    return this.mapClickUpTaskToArticle(response.data);
  }

  async getArticles(parentId?: string, options?: WorkQueryOptions): Promise<WorkArticle[]> {
    if (!parentId) throw new Error('Parent list ID required for ClickUp');
    const response = await this.request(`/list/${parentId}/task`);
    return response.data.tasks.map((task: any) => this.mapClickUpTaskToArticle(task));
  }

  async createArticle(request: CreateArticleRequest): Promise<WorkArticle> {
    if (!request.parentId) throw new Error('Parent list ID required for ClickUp');
    const response = await this.request(`/list/${request.parentId}/task`, {
      method: 'POST',
      body: {
        name: request.title,
        description: request.content,
        tags: request.tags,
      },
    });
    return this.mapClickUpTaskToArticle(response.data);
  }

  async updateArticle(articleId: string, updates: UpdateArticleRequest): Promise<WorkArticle> {
    const payload: any = {};
    if (updates.title) payload.name = updates.title;
    if (updates.content) payload.description = updates.content;
    const response = await this.request(`/task/${articleId}`, { method: 'PUT', body: payload });
    return this.mapClickUpTaskToArticle(response.data);
  }

  async deleteArticle(articleId: string): Promise<void> {
    await this.request(`/task/${articleId}`, { method: 'DELETE' });
  }

  async getWorkspaces(): Promise<Workspace[]> {
    const response = await this.request('/team');
    return response.data.teams.map((team: any) => ({
      id: team.id,
      name: team.name,
      members: team.members?.map((m: any) => ({
        id: m.user.id.toString(),
        name: m.user.username,
        role: m.user.role,
      })),
    }));
  }

  async getWorkspace(workspaceId: string): Promise<Workspace> {
    const workspaces = await this.getWorkspaces();
    const workspace = workspaces.find(w => w.id === workspaceId);
    if (!workspace) throw new Error('Workspace not found');
    return workspace;
  }

  async getLists(workspaceId: string): Promise<WorkList[]> {
    const response = await this.request(`/team/${workspaceId}/space`);
    const lists: WorkList[] = [];
    for (const space of response.data.spaces) {
      const spaceResponse = await this.request(`/space/${space.id}/list`);
      lists.push(...spaceResponse.data.lists.map((list: any) => ({
        id: list.id,
        name: list.name,
        workspaceId,
        taskCount: list.task_count,
      })));
    }
    return lists;
  }

  async getList(listId: string): Promise<WorkList> {
    const response = await this.request(`/list/${listId}`);
    return {
      id: response.data.id,
      name: response.data.name,
      taskCount: response.data.task_count,
    };
  }

  async getComments(targetId: string): Promise<WorkComment[]> {
    const response = await this.request(`/task/${targetId}/comment`);
    return response.data.comments.map((comment: any) => ({
      id: comment.id,
      text: comment.comment_text,
      author: {
        id: comment.user.id.toString(),
        name: comment.user.username,
      },
      createdAt: new Date(parseInt(comment.date)),
    }));
  }

  async createComment(request: CreateCommentRequest): Promise<WorkComment> {
    const response = await this.request(`/task/${request.targetId}/comment`, {
      method: 'POST',
      body: {
        comment_text: request.text,
      },
    });
    return {
      id: response.data.id,
      text: request.text,
      author: {
        id: response.data.user.id.toString(),
        name: response.data.user.username,
      },
      createdAt: new Date(parseInt(response.data.date)),
    };
  }

  private mapClickUpTaskToWorkTask(task: any): WorkTask {
    return {
      id: task.id,
      title: task.name,
      description: task.description,
      status: task.status.status,
      priority: this.mapClickUpPriority(task.priority),
      assignees: task.assignees?.map((a: any) => ({
        id: a.id.toString(),
        name: a.username,
        email: a.email,
      })),
      dueDate: task.due_date ? new Date(parseInt(task.due_date)) : undefined,
      tags: task.tags?.map((t: any) => t.name),
      createdAt: new Date(parseInt(task.date_created)),
      updatedAt: new Date(parseInt(task.date_updated)),
      url: task.url,
    };
  }

  private mapClickUpTaskToArticle(task: any): WorkArticle {
    return {
      id: task.id,
      title: task.name,
      content: task.description || '',
      tags: task.tags?.map((t: any) => t.name),
      createdAt: new Date(parseInt(task.date_created)),
      updatedAt: new Date(parseInt(task.date_updated)),
      url: task.url,
    };
  }

  private mapPriorityToClickUp(priority?: string): number | null {
    const map: Record<string, number> = { urgent: 1, high: 2, medium: 3, low: 4 };
    return priority ? map[priority] : null;
  }

  private mapClickUpPriority(priority: any): 'low' | 'medium' | 'high' | 'urgent' | undefined {
    if (!priority) return undefined;
    const map: Record<number, any> = { 1: 'urgent', 2: 'high', 3: 'medium', 4: 'low' };
    return map[priority.priority];
  }
}
