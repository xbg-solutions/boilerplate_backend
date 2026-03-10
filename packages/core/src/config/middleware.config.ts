/**
 * Middleware Configuration
 * Pipeline setup and ordering
 */

export interface MiddlewareConfig {
  cors: {
    enabled: boolean;
    credentials: boolean;
    maxAge: number;
  };

  helmet: {
    enabled: boolean;
    contentSecurityPolicy: boolean;
    crossOriginEmbedderPolicy: boolean;
  };

  rateLimit: {
    enabled: boolean;
    windowMs: number;
    max: number;
    skipSuccessfulRequests: boolean;
    skipFailedRequests: boolean;
  };

  compression: {
    enabled: boolean;
    level: number;
    threshold: number;
  };

  bodyParser: {
    json: {
      limit: string;
      strict: boolean;
    };
    urlencoded: {
      limit: string;
      extended: boolean;
      parameterLimit: number;
    };
  };

  requestId: {
    enabled: boolean;
    headerName: string;
  };

  logging: {
    enabled: boolean;
    logBody: boolean;
    logHeaders: boolean;
    sensitiveHeaders: string[];
  };
}

export const MIDDLEWARE_CONFIG: MiddlewareConfig = {
  cors: {
    enabled: true,
    credentials: true,
    maxAge: parseInt(process.env.CORS_MAX_AGE || '86400', 10), // 24 hours
  },

  helmet: {
    enabled: process.env.NODE_ENV === 'production',
    contentSecurityPolicy: process.env.NODE_ENV === 'production',
    crossOriginEmbedderPolicy: false,
  },

  rateLimit: {
    enabled: process.env.RATE_LIMIT_ENABLED !== 'false',
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10), // 15 minutes
    max: parseInt(process.env.RATE_LIMIT_MAX || '100', 10),
    skipSuccessfulRequests: false,
    skipFailedRequests: false,
  },

  compression: {
    enabled: process.env.COMPRESSION_ENABLED !== 'false',
    level: parseInt(process.env.COMPRESSION_LEVEL || '6', 10),
    threshold: parseInt(process.env.COMPRESSION_THRESHOLD || '1024', 10), // 1KB
  },

  bodyParser: {
    json: {
      limit: process.env.JSON_BODY_LIMIT || '10mb',
      strict: true,
    },
    urlencoded: {
      limit: process.env.URLENCODED_BODY_LIMIT || '10mb',
      extended: true,
      parameterLimit: parseInt(process.env.PARAMETER_LIMIT || '1000', 10),
    },
  },

  requestId: {
    enabled: true,
    headerName: 'X-Request-ID',
  },

  logging: {
    enabled: true,
    logBody: process.env.NODE_ENV === 'development',
    logHeaders: process.env.NODE_ENV === 'development',
    sensitiveHeaders: ['authorization', 'cookie', 'x-api-key'],
  },
};

/**
 * Middleware execution order
 * Order matters! Earlier middleware run first
 */
export const MIDDLEWARE_ORDER = [
  'helmet',
  'cors',
  'requestId',
  'logging',
  'compression',
  'bodyParser',
  'rateLimit',
  'authentication',
  'validation',
] as const;

export type MiddlewareType = typeof MIDDLEWARE_ORDER[number];
