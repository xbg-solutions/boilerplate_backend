import { Request, Response, NextFunction } from 'express';

/**
 * `Cache-Control: no-store` on every response.
 *
 * Firebase Hosting gives a rewritten function response that carries no
 * Cache-Control a default of `max-age=600` and will serve it from its CDN to
 * the next caller of the same URL — seen on morph and sf-mapper 2026-09-05
 * (`x-cache: HIT` on API 404s). Hosting's own `headers` config does not
 * apply to rewrites, so the API has to say it itself. A handler that wants
 * caching sets its own header afterwards; this only fills in the default.
 */
export function noStoreMiddleware() {
  return (_req: Request, res: Response, next: NextFunction): void => {
    if (!res.getHeader('Cache-Control')) res.setHeader('Cache-Control', 'no-store');
    next();
  };
}
