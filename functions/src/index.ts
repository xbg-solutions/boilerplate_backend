/**
 * Firebase Functions Entry Point
 * Exports HTTP functions for Firebase deployment
 */

import * as functions from 'firebase-functions';
import { createApp } from './app';
import { logger } from './utilities/logger';

// Import controllers here as they are created
// import { UserController } from './generated/controllers/UserController';

/**
 * Initialize controllers
 * Add your generated or custom controllers here
 */
function initializeControllers(): Array<{ getRouter: () => any; getBasePath: () => string }> {
  const controllers: Array<{ getRouter: () => any; getBasePath: () => string }> = [];

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

logger.info('Firebase Functions initialized', {
  environment: process.env.NODE_ENV || 'development',
});
