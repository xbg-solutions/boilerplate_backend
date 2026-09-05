/**
 * How many proxy hops sit between the client and this process — Express's
 * `trust proxy` setting — from the TRUST_PROXY environment variable.
 *
 * Why it is configurable: the right value depends on where the app is
 * mounted, not on the code. A caller hitting the Cloud Run URL directly is
 * one hop away (Google's front end); the same request through Firebase
 * Hosting is two (Hosting edge, then the front end). With the count one
 * short, `req.ip` is the varying edge address, so anything keyed on the
 * client IP — the rate limiter above all — is spread across edge nodes and
 * never trips.
 *
 * Accepted values: an integer hop count (`2`), `true`/`false`, or any string
 * Express accepts (`loopback`, a CSV of addresses/subnets). Unset → 1.
 */
export type TrustProxySetting = number | boolean | string;

export const DEFAULT_TRUST_PROXY = 1;

export function resolveTrustProxy(raw: string | undefined = process.env.TRUST_PROXY): TrustProxySetting {
  const value = (raw ?? '').trim();
  if (value === '') return DEFAULT_TRUST_PROXY;
  if (/^\d+$/.test(value)) return Number(value);
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}
