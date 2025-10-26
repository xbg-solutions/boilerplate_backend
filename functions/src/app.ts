/**
 * Express Application Setup
 * Configures middleware pipeline and route registration
 */

import express, { Express, Router } from 'express';
import helmet from 'helmet';
import { APP_CONFIG, validateAllConfig } from './config';
import {
  createCorsMiddleware,
  createRateLimiter,
  requestIdMiddleware,
  requestLoggingMiddleware,
  sanitizeBody,
  errorHandler,
  notFoundHandler,
} from './middleware';
import { logger } from './utilities/logger';

export interface AppOptions {
  tokenHandler?: any;
  controllers?: Array<{ getRouter: () => Router; getBasePath: () => string }>;
}

/**
 * Create and configure Express application
 */
export function createApp(options: AppOptions = {}): Express {
  // Validate configuration
  try {
    validateAllConfig();
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error('Configuration validation failed', err);
    throw error;
  }

  const app = express();

  // Trust proxy for accurate IP addresses when behind load balancer
  app.set('trust proxy', true);

  // ===== SECURITY MIDDLEWARE =====
  // Helmet for security headers (production only)
  if (APP_CONFIG.app.environment === 'production') {
    app.use(helmet({
      contentSecurityPolicy: false, // Disable CSP for API
      crossOriginEmbedderPolicy: false,
    }));
  }

  // CORS
  app.use(createCorsMiddleware());

  // ===== TRACKING MIDDLEWARE =====
  // Request ID
  app.use(requestIdMiddleware());

  // Request logging
  app.use(requestLoggingMiddleware());

  // ===== PARSING MIDDLEWARE =====
  // Body parsing
  app.use(express.json({ limit: APP_CONFIG.api.requestSizeLimit }));
  app.use(express.urlencoded({ extended: true, limit: APP_CONFIG.api.requestSizeLimit }));

  // Input sanitization
  app.use(sanitizeBody());

  // ===== RATE LIMITING =====
  if (APP_CONFIG.app.environment !== 'development') {
    app.use(createRateLimiter());
  }

  // ===== HEALTH CHECK =====
  app.get('/health', (_req, res) => {
    res.json({
      success: true,
      data: {
        status: 'healthy',
        version: APP_CONFIG.app.version,
        environment: APP_CONFIG.app.environment,
        timestamp: new Date().toISOString(),
      },
    });
  });

  app.get('/health/ready', (_req, res) => {
    // Add database connectivity check here
    res.json({
      success: true,
      data: {
        status: 'ready',
        checks: {
          database: 'ok',
        },
      },
    });
  });

  // ===== API ROUTES =====
  const apiRouter = Router();

  // Register controllers
  if (options.controllers && options.controllers.length > 0) {
    for (const controller of options.controllers) {
      const basePath = controller.getBasePath();
      const router = controller.getRouter();

      apiRouter.use(basePath, router);

      logger.info('Controller registered', {
        basePath: `${APP_CONFIG.api.basePath}${basePath}`,
      });
    }
  }

  // Mount API router
  app.use(APP_CONFIG.api.basePath, apiRouter);

  // ===== ERROR HANDLING =====
  // 404 handler for unmatched routes
  app.use(notFoundHandler());

  // Global error handler (must be last)
  app.use(errorHandler());

  logger.info('Express application configured', {
    environment: APP_CONFIG.app.environment,
    basePath: APP_CONFIG.api.basePath,
    controllers: options.controllers?.length || 0,
  });

  return app;
}

/**
 * Register controllers dynamically
 */
export function registerControllers(
  app: Express,
  controllers: Array<{ getRouter: () => Router; getBasePath: () => string }>
): void {
  const apiRouter = Router();

  for (const controller of controllers) {
    const basePath = controller.getBasePath();
    const router = controller.getRouter();

    apiRouter.use(basePath, router);

    logger.info('Controller registered', {
      basePath: `${APP_CONFIG.api.basePath}${basePath}`,
    });
  }

  // Mount API router
  app.use(APP_CONFIG.api.basePath, apiRouter);
}

/**
 * Start Express server (for local development)
 */
export function startServer(app: Express): void {
  const port = APP_CONFIG.app.port;

  app.listen(port, () => {
    logger.info('Server started', {
      port,
      environment: APP_CONFIG.app.environment,
      basePath: APP_CONFIG.api.basePath,
    });

    console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   🚀 ${APP_CONFIG.app.name.padEnd(48)} ║
║                                                           ║
║   Environment: ${APP_CONFIG.app.environment.padEnd(43)} ║
║   Version:     ${APP_CONFIG.app.version.padEnd(43)} ║
║   Port:        ${String(port).padEnd(43)} ║
║   API Path:    ${APP_CONFIG.api.basePath.padEnd(43)} ║
║                                                           ║
║   Health:      http://localhost:${port}/health${' '.repeat(21)} ║
║   API Docs:    http://localhost:${port}${APP_CONFIG.api.basePath}${' '.repeat(11)} ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
    `);
  });
}
