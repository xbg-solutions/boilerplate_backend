/**
 * Express Application Setup
 * Configures middleware pipeline and route registration
 */

import express, { Express, Router } from 'express';
import helmet from 'helmet';
import { APP_CONFIG, MIDDLEWARE_CONFIG, validateAllConfig } from './config';
import { resolveTrustProxy, TrustProxySetting } from './config/trust-proxy';
import {
  createCorsMiddleware,
  createRateLimiter,
  RateLimiterOptions,
  noStoreMiddleware,
  requestIdMiddleware,
  requestLoggingMiddleware,
  sanitizeBody,
  errorHandler,
  notFoundHandler,
} from './middleware';
import { logger } from '@xbg.solutions/utils-logger';

export interface AppOptions {
  tokenHandler?: any;
  controllers?: Array<{ getRouter: () => Router; getBasePath: () => string }>;
  /**
   * Global rate limiter. Omit for the default Firestore-backed store on the
   * `(default)` database; pass `{ databaseId }` (or `{ firestore }` /
   * `{ store }`) when the project uses named databases; pass `false` to not
   * mount one. Also honours `RATE_LIMIT_ENABLED=false`. Never mounted in
   * `development`.
   */
  rateLimit?: RateLimiterOptions | false;
  /**
   * Express `trust proxy` setting. Omit to read TRUST_PROXY from the
   * environment (default 1, which is right for the Cloud Run URL; use 2
   * behind Firebase Hosting). See config/trust-proxy.ts.
   */
  trustProxy?: TrustProxySetting;
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

  // Proxy hops between client and process: 1 for the Cloud Run URL, 2 behind
  // Firebase Hosting. Set TRUST_PROXY per deployment (or pass trustProxy).
  // `true` trusts ALL proxies, allowing X-Forwarded-For spoofing — avoid it.
  app.set('trust proxy', options.trustProxy ?? resolveTrustProxy());

  // ===== SECURITY MIDDLEWARE =====
  // Helmet for security headers (all environments)
  app.use(helmet({
    contentSecurityPolicy: false, // Disable CSP for API
    crossOriginEmbedderPolicy: false,
  }));

  // Never let Firebase Hosting's CDN cache an API response by default (it
  // applies max-age=600 when the function sets nothing). Handlers may still
  // set their own Cache-Control afterwards.
  app.use(noStoreMiddleware());

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
  if (
    options.rateLimit !== false &&
    MIDDLEWARE_CONFIG.rateLimit.enabled &&
    APP_CONFIG.app.environment !== 'development'
  ) {
    app.use(createRateLimiter(options.rateLimit ?? {}));
  }

  // ===== HEALTH CHECK =====
  app.get('/health', (_req, res) => {
    const data: Record<string, any> = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
    };

    // Only expose version/environment in non-production
    if (APP_CONFIG.app.environment !== 'production') {
      data.version = APP_CONFIG.app.version;
      data.environment = APP_CONFIG.app.environment;
    }

    res.json({ success: true, data });
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
