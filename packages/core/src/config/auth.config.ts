/**
 * Authentication Configuration
 * JWT and auth provider settings
 */

export interface AuthConfig {
  jwt: {
    issuer: string;
    audience: string;
    expiresIn: string;
    refreshTokenExpiresIn: string;
  };

  providers: {
    firebase: {
      enabled: boolean;
      projectId?: string;
    };
    auth0?: {
      enabled: boolean;
      domain?: string;
      clientId?: string;
      clientSecret?: string;
    };
    clerk?: {
      enabled: boolean;
      apiKey?: string;
    };
  };

  blacklist: {
    enabled: boolean;
    cleanupIntervalMs: number;
    retentionDays: number;
  };

  session: {
    maxConcurrentSessions: number;
    slidingExpiration: boolean;
  };

  security: {
    requireEmailVerification: boolean;
    requireMFA: boolean;
    passwordMinLength: number;
    maxLoginAttempts: number;
    lockoutDurationMinutes: number;
  };
}

export const AUTH_CONFIG: AuthConfig = {
  jwt: {
    issuer: process.env.JWT_ISSUER || 'backend-boilerplate',
    audience: process.env.JWT_AUDIENCE || 'backend-boilerplate-api',
    expiresIn: process.env.JWT_EXPIRES_IN || '1h',
    refreshTokenExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  },

  providers: {
    firebase: {
      enabled: true,
      projectId: process.env.FIREBASE_PROJECT_ID,
    },
    auth0: {
      enabled: !!process.env.AUTH0_DOMAIN,
      domain: process.env.AUTH0_DOMAIN,
      clientId: process.env.AUTH0_CLIENT_ID,
      clientSecret: process.env.AUTH0_CLIENT_SECRET,
    },
    clerk: {
      enabled: !!process.env.CLERK_API_KEY,
      apiKey: process.env.CLERK_API_KEY,
    },
  },

  blacklist: {
    enabled: process.env.TOKEN_BLACKLIST_ENABLED !== 'false',
    cleanupIntervalMs: parseInt(process.env.TOKEN_BLACKLIST_CLEANUP_INTERVAL || '3600000', 10), // 1 hour
    retentionDays: parseInt(process.env.TOKEN_BLACKLIST_RETENTION_DAYS || '30', 10),
  },

  session: {
    maxConcurrentSessions: parseInt(process.env.MAX_CONCURRENT_SESSIONS || '5', 10),
    slidingExpiration: process.env.SLIDING_EXPIRATION !== 'false',
  },

  security: {
    requireEmailVerification: process.env.REQUIRE_EMAIL_VERIFICATION === 'true',
    requireMFA: process.env.REQUIRE_MFA === 'true',
    passwordMinLength: parseInt(process.env.PASSWORD_MIN_LENGTH || '8', 10),
    maxLoginAttempts: parseInt(process.env.MAX_LOGIN_ATTEMPTS || '5', 10),
    lockoutDurationMinutes: parseInt(process.env.LOCKOUT_DURATION_MINUTES || '15', 10),
  },
};

/**
 * Get enabled auth provider
 */
export function getEnabledAuthProvider(): 'firebase' | 'auth0' | 'clerk' | null {
  if (AUTH_CONFIG.providers.firebase.enabled) return 'firebase';
  if (AUTH_CONFIG.providers.auth0?.enabled) return 'auth0';
  if (AUTH_CONFIG.providers.clerk?.enabled) return 'clerk';
  return null;
}

/**
 * Validate auth configuration
 */
export function validateAuthConfig(): void {
  const errors: string[] = [];

  const enabledProvider = getEnabledAuthProvider();
  if (!enabledProvider) {
    errors.push('At least one auth provider must be enabled');
  }

  if (AUTH_CONFIG.providers.firebase.enabled && !AUTH_CONFIG.providers.firebase.projectId) {
    errors.push('FIREBASE_PROJECT_ID is required when Firebase auth is enabled');
  }

  if (AUTH_CONFIG.providers.auth0?.enabled) {
    if (!AUTH_CONFIG.providers.auth0.domain) {
      errors.push('AUTH0_DOMAIN is required when Auth0 is enabled');
    }
    if (!AUTH_CONFIG.providers.auth0.clientId) {
      errors.push('AUTH0_CLIENT_ID is required when Auth0 is enabled');
    }
  }

  if (errors.length > 0) {
    throw new Error(`Auth configuration validation failed:\n${errors.join('\n')}`);
  }
}
