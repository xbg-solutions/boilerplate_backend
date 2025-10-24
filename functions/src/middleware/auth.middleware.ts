/**
 * Authentication Middleware
 * Integrates with the token handler utility
 */

import { Request, Response, NextFunction } from 'express';
import { logger } from '../utilities/logger';
import { AUTH_CONFIG } from '../config/auth.config';

export interface AuthenticatedRequest extends Request {
  user?: {
    uid: string;
    email?: string;
    role?: string;
    customClaims?: Record<string, any>;
  };
}

/**
 * Authentication middleware factory
 * Verifies JWT tokens and attaches user to request
 */
export function createAuthMiddleware(options: {
  tokenHandler: any;
  required?: boolean;
  roles?: string[];
}) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const token = extractTokenFromHeader(req);

      if (!token) {
        if (options.required !== false) {
          return res.status(401).json({
            success: false,
            error: {
              code: 'UNAUTHORIZED',
              message: 'Authentication required',
            },
          });
        }
        return next();
      }

      // Verify token using token handler
      const verificationResult = await options.tokenHandler.verifyToken(token);

      if (!verificationResult.valid) {
        return res.status(401).json({
          success: false,
          error: {
            code: 'INVALID_TOKEN',
            message: verificationResult.error || 'Invalid or expired token',
          },
        });
      }

      // Attach user to request
      (req as AuthenticatedRequest).user = {
        uid: verificationResult.token.uid,
        email: verificationResult.token.email,
        role: verificationResult.customClaims?.role || 'user',
        customClaims: verificationResult.customClaims,
      };

      // Check role requirements
      if (options.roles && options.roles.length > 0) {
        const userRole = (req as AuthenticatedRequest).user?.role;
        if (!userRole || !options.roles.includes(userRole)) {
          return res.status(403).json({
            success: false,
            error: {
              code: 'FORBIDDEN',
              message: 'Insufficient permissions',
            },
          });
        }
      }

      logger.debug('User authenticated', {
        uid: (req as AuthenticatedRequest).user?.uid,
        role: (req as AuthenticatedRequest).user?.role,
      });

      next();
    } catch (error) {
      logger.error('Authentication error', {
        error: error instanceof Error ? error.message : String(error),
      });

      return res.status(500).json({
        success: false,
        error: {
          code: 'AUTH_ERROR',
          message: 'Authentication failed',
        },
      });
    }
  };
}

/**
 * Extract token from Authorization header
 */
function extractTokenFromHeader(req: Request): string | null {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return null;
  }

  const parts = authHeader.split(' ');

  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return null;
  }

  return parts[1];
}

/**
 * Optional authentication middleware
 * Attaches user if token is present but doesn't require it
 */
export function optionalAuth(tokenHandler: any) {
  return createAuthMiddleware({ tokenHandler, required: false });
}

/**
 * Required authentication middleware
 * Requires valid token
 */
export function requiredAuth(tokenHandler: any) {
  return createAuthMiddleware({ tokenHandler, required: true });
}

/**
 * Role-based authentication middleware
 * Requires valid token and specific roles
 */
export function requireRoles(tokenHandler: any, roles: string[]) {
  return createAuthMiddleware({ tokenHandler, required: true, roles });
}

/**
 * Admin-only middleware
 */
export function requireAdmin(tokenHandler: any) {
  return requireRoles(tokenHandler, ['admin']);
}

/**
 * Check if user owns resource
 */
export function requireOwnership(getUserIdFromResource: (req: Request) => string | undefined) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?.uid;
      const resourceUserId = getUserIdFromResource(req);

      if (!userId || !resourceUserId || userId !== resourceUserId) {
        // Allow if user is admin
        if (req.user?.role === 'admin') {
          return next();
        }

        return res.status(403).json({
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: 'Access denied to this resource',
          },
        });
      }

      next();
    } catch (error) {
      logger.error('Ownership check error', {
        error: error instanceof Error ? error.message : String(error),
      });

      return res.status(500).json({
        success: false,
        error: {
          code: 'AUTHORIZATION_ERROR',
          message: 'Failed to verify resource ownership',
        },
      });
    }
  };
}

/**
 * API Key authentication middleware
 * For service-to-service communication
 */
export function requireApiKey(validApiKeys: string[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const apiKey = req.headers['x-api-key'] as string;

      if (!apiKey || !validApiKeys.includes(apiKey)) {
        return res.status(401).json({
          success: false,
          error: {
            code: 'INVALID_API_KEY',
            message: 'Invalid or missing API key',
          },
        });
      }

      next();
    } catch (error) {
      logger.error('API key validation error', {
        error: error instanceof Error ? error.message : String(error),
      });

      return res.status(500).json({
        success: false,
        error: {
          code: 'AUTH_ERROR',
          message: 'API key validation failed',
        },
      });
    }
  };
}
