import { resolveTrustProxy, DEFAULT_TRUST_PROXY } from '../trust-proxy';

describe('resolveTrustProxy', () => {
  it('defaults to one hop when unset or blank', () => {
    expect(resolveTrustProxy(undefined)).toBe(DEFAULT_TRUST_PROXY);
    expect(resolveTrustProxy('')).toBe(1);
    expect(resolveTrustProxy('   ')).toBe(1);
  });

  it('reads an integer hop count (2 behind Firebase Hosting)', () => {
    expect(resolveTrustProxy('2')).toBe(2);
    expect(resolveTrustProxy(' 3 ')).toBe(3);
  });

  it('reads booleans', () => {
    expect(resolveTrustProxy('true')).toBe(true);
    expect(resolveTrustProxy('false')).toBe(false);
  });

  it('passes any other Express-accepted string through', () => {
    expect(resolveTrustProxy('loopback')).toBe('loopback');
    expect(resolveTrustProxy('10.0.0.0/8, 172.16.0.0/12')).toBe('10.0.0.0/8, 172.16.0.0/12');
  });
});
