/**
 * Local Development Server
 * Run this file directly for local development without Firebase emulator
 */

import dotenv from 'dotenv';
import { createApp, startServer } from './app';
import { logger } from './utilities/logger';

// Load environment variables
dotenv.config();

/**
 * Initialize controllers for local development
 */
function initializeControllers(): Array<{ getRouter: () => any; getBasePath: () => string }> {
  const controllers: Array<{ getRouter: () => any; getBasePath: () => string }> = [];

  // Add controllers here as they are generated
  // Example:
  // const userController = new UserController(userService, '/users');
  // controllers.push(userController);

  return controllers;
}

/**
 * Start local development server
 */
try {
  const app = createApp({
    controllers: initializeControllers(),
  });

  startServer(app);
} catch (error) {
  const err = error instanceof Error ? error : new Error(String(error));
  logger.error('Failed to start server', err);
  process.exit(1);
}

/**
 * Graceful shutdown
 */
process.on('SIGTERM', () => {
  logger.info('SIGTERM signal received: closing server');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT signal received: closing server');
  process.exit(0);
});
