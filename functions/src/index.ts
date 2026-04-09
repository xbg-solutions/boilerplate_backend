/**
 * Firebase Functions Entry Point
 * Exports HTTP functions for Firebase deployment
 */

import * as functions from 'firebase-functions';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { createApp } from './app';
import { logger } from './utilities/logger';

import { NotificationInboxController } from './api/controllers/NotificationInboxController';
import { getNotificationInboxConnector } from './utilities/notification-inbox-connector';

// Import controllers here as they are created
// import { UserController } from './generated/controllers/UserController';

/**
 * Initialize controllers
 * Add your generated or custom controllers here
 */
function initializeControllers(): Array<{ getRouter: () => any; getBasePath: () => string }> {
  const controllers: Array<{ getRouter: () => any; getBasePath: () => string }> = [];

  // Notification Inbox (enabled via NOTIFICATION_INBOX_ENABLED=true)
  const inboxConnector = getNotificationInboxConnector();
  if (inboxConnector) {
    controllers.push(new NotificationInboxController(inboxConnector));
  }

  // Example:
  // const userController = new UserController(userService, '/users');
  // controllers.push(userController);

  return controllers;
}

/**
 * Create Express app with controllers
 */
const expressApp = createApp({
  controllers: initializeControllers(),
});

/**
 * Export as Firebase HTTPS Function
 */
export const api = functions.https.onRequest(expressApp);

/**
 * Export for local development
 */
export { expressApp };

/**
 * Scheduled cleanup of expired notification inbox records.
 * Runs daily. Only active when notification inbox is enabled.
 */
export const cleanupExpiredNotifications = onSchedule('every 24 hours', async () => {
  const connector = getNotificationInboxConnector();
  if (!connector) {
    return;
  }

  try {
    const result = await connector.deleteExpired();
    logger.info('Scheduled notification cleanup complete', {
      deletedCount: result.deletedCount,
    });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error('Scheduled notification cleanup failed', err);
  }
});

logger.info('Firebase Functions initialized', {
  environment: process.env.NODE_ENV || 'development',
});
