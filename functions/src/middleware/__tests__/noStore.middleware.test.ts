import { noStoreMiddleware } from '../noStore.middleware';

function run(existing?: string) {
  const headers: Record<string, string> = {};
  if (existing) headers['Cache-Control'] = existing;
  const res: any = {
    getHeader: (k: string) => headers[k],
    setHeader: (k: string, v: string) => { headers[k] = v; },
  };
  const next = jest.fn();
  noStoreMiddleware()({} as any, res, next);
  return { headers, next };
}

describe('noStoreMiddleware', () => {
  it('sets Cache-Control: no-store when nothing set it', () => {
    const { headers, next } = run();
    expect(headers['Cache-Control']).toBe('no-store');
    expect(next).toHaveBeenCalled();
  });

  it('leaves an explicit Cache-Control alone', () => {
    const { headers } = run('public, max-age=60');
    expect(headers['Cache-Control']).toBe('public, max-age=60');
  });
});
