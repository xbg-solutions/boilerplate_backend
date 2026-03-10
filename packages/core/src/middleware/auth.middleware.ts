/**
 * Authentication Middleware
 * Integrates with the token handler utility
 */

import * as crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { logger } from '@xbg/utils-logger';
import { AuthError } from '../types/errors';
import type { ITokenHandler } from '@xbg/utils-token-handler';

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
  tokenHandler: ITokenHandler;
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

      // Verify token using token handler (includes blacklist check)
      const verificationResult = await options.tokenHandler.verifyAndUnpack(token, logger);

      if (!verificationResult.isValid) {
        return res.status(401).json({
          success: false,
          error: {
            code: verificationResult.isBlacklisted ? 'TOKEN_REVOKED' : 'INVALID_TOKEN',
            message: verificationResult.error || 'Invalid or expired token',
          },
        });
      }

      // Attach user to request
      (req as AuthenticatedRequest).user = {
        uid: verificationResult.token!.authUID,
        email: verificationResult.token!.email || undefined,
        role: verificationResult.token!.customClaims?.role || 'user',
        customClaims: verificationResult.token!.customClaims,
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

      return next();
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      const authError = new AuthError('Authentication failed', error);
      logger.error(authError.message, err);

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
export function optionalAuth(tokenHandler: ITokenHandler) {
  return createAuthMiddleware({ tokenHandler, required: false });
}

/**
 * Required authentication middleware
 * Requires valid token
 */
export function requiredAuth(tokenHandler: ITokenHandler) {
  return createAuthMiddleware({ tokenHandler, required: true });
}

/**
 * Role-based authentication middleware
 * Requires valid token and specific roles
 */
export function requireRoles(tokenHandler: ITokenHandler, roles: string[]) {
  return createAuthMiddleware({ tokenHandler, required: true, roles });
}

/**
 * Admin-only middleware
 * Pass custom admin roles array to match your project's role names.
 * Default: ['admin']
 */
export function requireAdmin(tokenHandler: ITokenHandler, adminRoles: string[] = ['admin']) {
  return requireRoles(tokenHandler, adminRoles);
}

/**
 * Check if user owns resource
 * Pass adminRoles to configure which roles bypass the ownership check.
 * Default: ['admin']
 */
export function requireOwnership(
  getUserIdFromResource: (req: Request) => string | undefined,
  adminRoles: string[] = ['admin']
) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?.uid;
      const resourceUserId = getUserIdFromResource(req);

      if (!userId || !resourceUserId || userId !== resourceUserId) {
        // Allow if user has an admin role
        if (req.user?.role && adminRoles.includes(req.user.role)) {
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

      return next();
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      const authError = new AuthError('Failed to verify resource ownership', error);
      logger.error(authError.message, err);

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
 * For service-to-service communication.
 * Uses timing-safe comparison to prevent timing attacks.
 */
export function requireApiKey(validApiKeys: string[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const apiKey = req.headers['x-api-key'] as string;

      if (!apiKey || !timingSafeIncludes(validApiKeys, apiKey)) {
        return res.status(401).json({
          success: false,
          error: {
            code: 'INVALID_API_KEY',
            message: 'Invalid or missing API key',
          },
        });
      }

      return next();
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      const authError = new AuthError('API key validation failed', error);
      logger.error(authError.message, err);

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

/**
 * Timing-safe comparison of an API key against a list of valid keys.
 * Prevents timing side-channel attacks that could leak key information.
 */
function timingSafeIncludes(validKeys: string[], candidate: string): boolean {
  const candidateBuffer = Buffer.from(candidate);
  let found = false;

  for (const key of validKeys) {
    const keyBuffer = Buffer.from(key);
    if (candidateBuffer.length === keyBuffer.length) {
      if (crypto.timingSafeEqual(candidateBuffer, keyBuffer)) {
        found = true;
      }
    }
  }

  return found;
}
