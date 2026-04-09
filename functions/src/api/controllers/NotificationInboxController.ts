/**
 * Notification Inbox Controller
 *
 * REST endpoints for querying and managing notification inbox records.
 * All routes require authentication — userId is always derived from the token.
 *
 * Routes:
 *   GET    /notifications              — list notifications for authenticated user
 *   GET    /notifications/unread-count — get unread count
 *   PATCH  /notifications/:id/read    — mark one as read
 *   PATCH  /notifications/read        — mark multiple as read
 *   PATCH  /notifications/read-all    — mark all as read
 *   DELETE /notifications/:id         — delete one notification
 */

import { Request, Response, NextFunction, Router } from 'express';
import { NotificationInboxConnector } from '../../utilities/notification-inbox-connector';
import { NotificationFilter, NotificationPriority } from '../../utilities/notification-inbox-connector/types';
import { requiredAuth } from '../../middleware';
import { tokenHandler } from '../../utilities/token-handler';

export class NotificationInboxController {
  private router: Router;
  private basePath: string;
  private connector: NotificationInboxConnector;

  constructor(connector: NotificationInboxConnector, basePath = '/notifications') {
    this.connector = connector;
    this.basePath = basePath;
    this.router = Router();
    this.registerRoutes();
  }

  private registerRoutes(): void {
    const auth = requiredAuth(tokenHandler);

    this.router.get('/', auth, this.handleGetNotifications.bind(this));
    this.router.get('/unread-count', auth, this.handleGetUnreadCount.bind(this));
    this.router.patch('/read', auth, this.handleMarkMultipleAsRead.bind(this));
    this.router.patch('/read-all', auth, this.handleMarkAllAsRead.bind(this));
    this.router.patch('/:id/read', auth, this.handleMarkAsRead.bind(this));
    this.router.delete('/:id', auth, this.handleDelete.bind(this));
  }

  getRouter(): Router {
    return this.router;
  }

  getBasePath(): string {
    return this.basePath;
  }

  private getUserId(req: Request): string | undefined {
    return (req as any).user?.uid || (req as any).user?.id;
  }

  private async handleGetNotifications(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = this.getUserId(req);
      if (!userId) {
        res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'User not authenticated' } });
        return;
      }

      const filters: NotificationFilter = {};

      if (req.query.read !== undefined) {
        filters.read = req.query.read === 'true';
      }
      if (req.query.type) {
        filters.type = req.query.type as string;
      }
      if (req.query.types) {
        filters.types = (req.query.types as string).split(',');
      }
      if (req.query.priority) {
        filters.priority = req.query.priority as NotificationPriority;
      }
      if (req.query.groupKey) {
        filters.groupKey = req.query.groupKey as string;
      }
      if (req.query.since) {
        filters.since = new Date(req.query.since as string);
      }
      if (req.query.before) {
        filters.before = new Date(req.query.before as string);
      }
      if (req.query.limit) {
        filters.limit = parseInt(req.query.limit as string, 10);
      }
      if (req.query.offset) {
        filters.offset = parseInt(req.query.offset as string, 10);
      }
      if (req.query.orderBy) {
        filters.orderBy = req.query.orderBy as 'createdAt' | 'priority';
      }
      if (req.query.orderDirection) {
        filters.orderDirection = req.query.orderDirection as 'asc' | 'desc';
      }

      const result = await this.connector.getNotifications(userId, filters);

      res.json({
        success: true,
        data: result.notifications,
        pagination: {
          total: result.total,
          hasMore: result.hasMore,
          limit: filters.limit ?? 50,
          offset: filters.offset ?? 0,
        },
        metadata: {
          requestId: req.headers['x-request-id'] || 'unknown',
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      next(error);
    }
  }

  private async handleGetUnreadCount(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = this.getUserId(req);
      if (!userId) {
        res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'User not authenticated' } });
        return;
      }

      const result = await this.connector.getUnreadCount(userId);

      res.json({
        success: true,
        data: result,
        metadata: {
          requestId: req.headers['x-request-id'] || 'unknown',
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      next(error);
    }
  }

  private async handleMarkAsRead(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = this.getUserId(req);
      if (!userId) {
        res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'User not authenticated' } });
        return;
      }

      const { id } = req.params;
      const result = await this.connector.markAsRead(id);

      if (result.success) {
        res.json({
          success: true,
          data: { modifiedCount: result.modifiedCount },
          metadata: {
            requestId: req.headers['x-request-id'] || 'unknown',
            timestamp: new Date().toISOString(),
          },
        });
      } else {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: result.error || 'Notification not found' },
        });
      }
    } catch (error) {
      next(error);
    }
  }

  private async handleMarkMultipleAsRead(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = this.getUserId(req);
      if (!userId) {
        res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'User not authenticated' } });
        return;
      }

      const { ids } = req.body;
      if (!Array.isArray(ids) || ids.length === 0) {
        res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Request body must include a non-empty "ids" array' },
        });
        return;
      }

      const result = await this.connector.markMultipleAsRead(ids);

      res.json({
        success: true,
        data: { modifiedCount: result.modifiedCount },
        metadata: {
          requestId: req.headers['x-request-id'] || 'unknown',
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      next(error);
    }
  }

  private async handleMarkAllAsRead(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = this.getUserId(req);
      if (!userId) {
        res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'User not authenticated' } });
        return;
      }

      const result = await this.connector.markAllAsRead(userId);

      res.json({
        success: true,
        data: { modifiedCount: result.modifiedCount },
        metadata: {
          requestId: req.headers['x-request-id'] || 'unknown',
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      next(error);
    }
  }

  private async handleDelete(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = this.getUserId(req);
      if (!userId) {
        res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'User not authenticated' } });
        return;
      }

      const { id } = req.params;
      const result = await this.connector.deleteNotification(id);

      if (result.success) {
        res.json({
          success: true,
          data: { message: 'Notification deleted' },
          metadata: {
            requestId: req.headers['x-request-id'] || 'unknown',
            timestamp: new Date().toISOString(),
          },
        });
      } else {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: result.error || 'Notification not found' },
        });
      }
    } catch (error) {
      next(error);
    }
  }
}
