/**
 * Work Management Connector Types
 * Task and article management across platforms
 */

/**
 * Task/Item in work management system
 */
export interface WorkTask {
  id: string;
  title: string;
  description?: string;
  status: string;
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  assignees?: Array<{
    id: string;
    name: string;
    email?: string;
  }>;
  dueDate?: Date;
  tags?: string[];
  customFields?: Record<string, any>;
  createdAt?: Date;
  updatedAt?: Date;
  url?: string;
}

/**
 * Create task request
 */
export interface CreateTaskRequest {
  listId: string;
  title: string;
  description?: string;
  status?: string;
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  assigneeIds?: string[];
  dueDate?: Date;
  tags?: string[];
  customFields?: Record<string, any>;
}

/**
 * Update task request
 */
export interface UpdateTaskRequest {
  title?: string;
  description?: string;
  status?: string;
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  assigneeIds?: string[];
  dueDate?: Date;
  tags?: string[];
  customFields?: Record<string, any>;
}

/**
 * Article/Document/Page
 */
export interface WorkArticle {
  id: string;
  title: string;
  content: string;
  author?: {
    id: string;
    name: string;
  };
  status?: 'draft' | 'published' | 'archived';
  tags?: string[];
  createdAt?: Date;
  updatedAt?: Date;
  url?: string;
}

/**
 * Create article request
 */
export interface CreateArticleRequest {
  parentId?: string; // Parent page/space/folder
  title: string;
  content: string;
  status?: 'draft' | 'published';
  tags?: string[];
}

/**
 * Update article request
 */
export interface UpdateArticleRequest {
  title?: string;
  content?: string;
  status?: 'draft' | 'published' | 'archived';
  tags?: string[];
}

/**
 * Workspace/Space/Team
 */
export interface Workspace {
  id: string;
  name: string;
  description?: string;
  members?: Array<{
    id: string;
    name: string;
    role?: string;
  }>;
}

/**
 * List/Board/Database
 */
export interface WorkList {
  id: string;
  name: string;
  workspaceId?: string;
  description?: string;
  taskCount?: number;
}

/**
 * Comment on task or article
 */
export interface WorkComment {
  id: string;
  text: string;
  author: {
    id: string;
    name: string;
  };
  createdAt: Date;
  updatedAt?: Date;
}

/**
 * Create comment request
 */
export interface CreateCommentRequest {
  targetId: string; // Task or Article ID
  text: string;
}

/**
 * Query options
 */
export interface WorkQueryOptions {
  page?: number;
  limit?: number;
  filters?: Record<string, any>;
  sort?: {
    field: string;
    order: 'asc' | 'desc';
  };
}

/**
 * Response wrapper
 */
export interface WorkResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
}
