/**
 * Application Configuration - Single Source of Truth
 * All application-wide settings are centralized here
 */

export interface AppConfig {
  app: {
    name: string;
    version: string;
    environment: 'development' | 'staging' | 'production';
    port: number;
  };

  api: {
    basePath: string;
    corsOrigins: string[];
    rateLimits: {
      windowMs: number;
      max: number;
      standardHeaders: boolean;
      legacyHeaders: boolean;
    };
    requestSizeLimit: string;
    enableSwagger: boolean;
  };

  features: {
    authentication: boolean;
    multiTenant: boolean;
    fileUploads: boolean;
    notifications: boolean;
    analytics: boolean;
    realtime: boolean;
  };

  integrations: {
    sendgrid?: {
      enabled: boolean;
      apiKey?: string;
      fromEmail?: string;
    };
    stripe?: {
      enabled: boolean;
      secretKey?: string;
      webhookSecret?: string;
    };
  };

  logging: {
    level: 'debug' | 'info' | 'warn' | 'error';
    prettyPrint: boolean;
    redactPII: boolean;
  };
}

/**
 * Load and validate application configuration
 */
export const APP_CONFIG: AppConfig = {
  app: {
    name: process.env.APP_NAME || 'Backend Boilerplate API',
    version: process.env.APP_VERSION || '1.0.0',
    environment: (process.env.NODE_ENV as AppConfig['app']['environment']) || 'development',
    port: parseInt(process.env.PORT || '5001', 10),
  },

  api: {
    basePath: process.env.API_BASE_PATH || '/api/v1',
    corsOrigins: process.env.CORS_ORIGINS?.split(',') || ['http://localhost:5173', 'http://localhost:3000'],
    rateLimits: {
      windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10), // 15 minutes
      max: parseInt(process.env.RATE_LIMIT_MAX || '100', 10),
      standardHeaders: true,
      legacyHeaders: false,
    },
    requestSizeLimit: process.env.REQUEST_SIZE_LIMIT || '10mb',
    enableSwagger: process.env.ENABLE_SWAGGER === 'true' || process.env.NODE_ENV === 'development',
  },

  features: {
    authentication: process.env.FEATURE_AUTHENTICATION !== 'false',
    multiTenant: process.env.FEATURE_MULTI_TENANT === 'true',
    fileUploads: process.env.FEATURE_FILE_UPLOADS !== 'false',
    notifications: process.env.FEATURE_NOTIFICATIONS !== 'false',
    analytics: process.env.FEATURE_ANALYTICS === 'true',
    realtime: process.env.FEATURE_REALTIME !== 'false',
  },

  integrations: {
    sendgrid: {
      enabled: !!process.env.SENDGRID_API_KEY,
      apiKey: process.env.SENDGRID_API_KEY,
      fromEmail: process.env.SENDGRID_FROM_EMAIL,
    },
    stripe: {
      enabled: !!process.env.STRIPE_SECRET_KEY,
      secretKey: process.env.STRIPE_SECRET_KEY,
      webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
    },
  },

  logging: {
    level: (process.env.LOG_LEVEL as AppConfig['logging']['level']) || 'info',
    prettyPrint: process.env.NODE_ENV === 'development',
    redactPII: process.env.NODE_ENV === 'production',
  },
};

/**
 * Validate configuration on startup
 */
export function validateAppConfig(): void {
  const errors: string[] = [];

  // Validate required fields
  if (!APP_CONFIG.app.name) {
    errors.push('APP_NAME is required');
  }

  if (!['development', 'staging', 'production'].includes(APP_CONFIG.app.environment)) {
    errors.push('NODE_ENV must be development, staging, or production');
  }

  if (APP_CONFIG.app.port < 1 || APP_CONFIG.app.port > 65535) {
    errors.push('PORT must be between 1 and 65535');
  }

  // Validate integrations
  if (APP_CONFIG.integrations.sendgrid?.enabled && !APP_CONFIG.integrations.sendgrid.apiKey) {
    errors.push('SENDGRID_API_KEY is required when SendGrid is enabled');
  }

  if (APP_CONFIG.integrations.stripe?.enabled && !APP_CONFIG.integrations.stripe.secretKey) {
    errors.push('STRIPE_SECRET_KEY is required when Stripe is enabled');
  }

  if (errors.length > 0) {
    throw new Error(`Configuration validation failed:\n${errors.join('\n')}`);
  }
}

/**
 * Check if running in production environment
 */
export function isProduction(): boolean {
  return APP_CONFIG.app.environment === 'production';
}

/**
 * Check if running in development environment
 */
export function isDevelopment(): boolean {
  return APP_CONFIG.app.environment === 'development';
}

/**
 * Check if a feature is enabled
 */
export function isFeatureEnabled(feature: keyof AppConfig['features']): boolean {
  return APP_CONFIG.features[feature];
}
