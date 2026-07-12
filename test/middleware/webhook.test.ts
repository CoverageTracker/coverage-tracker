import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import worker from '../../src/index';
import { signWebhookBody } from '../helpers/crypto';
import type { Bindings } from '../../src/types';

// @ts-expect-error cloudflare:test injects env at runtime
const testEnv = env as Bindings;

// .dev.vars ships GITHUB_WEBHOOK_SECRET blank; crypto.subtle.importKey rejects a
// zero-length HMAC key, so tests need a real value.
beforeEach(() => {
  testEnv.GITHUB_WEBHOOK_SECRET = 'test-webhook-secret';
});

const BODY = JSON.stringify({ action: 'ping' });

async function postWebhook(opts: {
  body?: string;
  signature?: string | null;
  deliveryId?: string | null;
  event?: string;
}): Promise<Response> {
  const body = opts.body ?? BODY;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.event !== undefined) headers['X-GitHub-Event'] = opts.event;
  if (opts.deliveryId !== null) headers['X-GitHub-Delivery'] = opts.deliveryId ?? 'delivery-1';
  if (opts.signature !== null) {
    headers['X-Hub-Signature-256'] =
      opts.signature ?? (await signWebhookBody(testEnv.GITHUB_WEBHOOK_SECRET, body));
  }
  return worker.fetch(
    new Request('http://localhost/api/webhooks/github', { method: 'POST', headers, body }),
    testEnv as never,
  );
}

describe('requireWebhookHmac', () => {
  it('returns 400 when X-Hub-Signature-256 is missing', async () => {
    const res = await postWebhook({ signature: null, deliveryId: 'd-missing-sig' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when X-GitHub-Delivery is missing', async () => {
    const res = await postWebhook({ deliveryId: null });
    expect(res.status).toBe(400);
  });

  it('returns 400 when the signature is missing the sha256= prefix', async () => {
    const res = await postWebhook({ signature: 'deadbeef', deliveryId: 'd-bad-prefix' });
    expect(res.status).toBe(400);
  });

  it('returns 401 when the signature does not match', async () => {
    const res = await postWebhook({
      signature: `sha256=${'0'.repeat(64)}`,
      deliveryId: 'd-bad-sig',
    });
    expect(res.status).toBe(401);
  });

  it('passes through on a valid signature and records the delivery id', async () => {
    const res = await postWebhook({ deliveryId: 'd-valid-1' });
    expect(res.status).toBe(200);

    const row = await testEnv.DB.prepare(
      'SELECT delivery_id FROM webhook_deliveries WHERE delivery_id = ?',
    )
      .bind('d-valid-1')
      .first();
    expect(row).not.toBeNull();
  });

  it('rejects a replayed delivery id with 409', async () => {
    const first = await postWebhook({ deliveryId: 'd-replay' });
    expect(first.status).toBe(200);

    const replay = await postWebhook({ deliveryId: 'd-replay' });
    expect(replay.status).toBe(409);
  });
});
