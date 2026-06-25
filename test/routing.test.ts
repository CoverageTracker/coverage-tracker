import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:test';
import worker from '../src/index';

describe('routing', () => {
  it('GET /api/health returns 200', async () => {
    const res = await worker.fetch(new Request('http://localhost/api/health'), env as never);
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string };
    expect(body.status).toBe('ok');
  });

  it('GET /api/projects without Access token returns 401', async () => {
    const res = await worker.fetch(new Request('http://localhost/api/projects'), env as never);
    expect(res.status).toBe(401);
  });

  it('POST /api/ci/coverage without OIDC token returns 401', async () => {
    const res = await worker.fetch(
      new Request('http://localhost/api/ci/coverage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ line_coverage: 95 }),
      }),
      env as never,
    );
    expect(res.status).toBe(401);
  });
});
