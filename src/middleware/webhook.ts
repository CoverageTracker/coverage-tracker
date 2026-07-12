import { createMiddleware } from 'hono/factory';
import type { Bindings, Variables } from '../types';

/**
 * Verifies the GitHub webhook HMAC-SHA256 signature using constant-time comparison (A5),
 * then deduplicates on X-GitHub-Delivery to prevent replay attacks.
 *
 * Attaches the raw body text to context as 'rawBody' for downstream handlers.
 */

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export function requireWebhookHmac() {
  return createMiddleware<{ Bindings: Bindings; Variables: Variables }>(async (c, next) => {
    const sigHeader = c.req.header('X-Hub-Signature-256');
    const deliveryId = c.req.header('X-GitHub-Delivery');

    if (!sigHeader || !deliveryId) {
      return c.json({ error: 'Missing webhook headers' }, 400);
    }

    const rawBody = await c.req.text();

    // Constant-time HMAC verification (A5)
    const key = await importHmacKey(c.env.GITHUB_WEBHOOK_SECRET);
    const expectedPrefix = 'sha256=';
    if (!sigHeader.startsWith(expectedPrefix)) {
      return c.json({ error: 'Invalid signature format' }, 400);
    }

    const sigBytes = hexToBytes(sigHeader.slice(expectedPrefix.length));
    const bodyBytes = new TextEncoder().encode(rawBody);
    const valid = await crypto.subtle.verify('HMAC', key, sigBytes, bodyBytes);

    if (!valid) {
      return c.json({ error: 'Invalid webhook signature' }, 401);
    }

    // Replay protection: reject duplicate delivery IDs (A5)
    const result = await c.env.DB.prepare(
      'INSERT OR IGNORE INTO webhook_deliveries(delivery_id) VALUES (?)',
    )
      .bind(deliveryId)
      .run();

    if (result.meta.changes === 0) {
      return c.json({ error: 'Duplicate delivery' }, 409);
    }

    // Make raw body available to route handlers without re-reading the stream
    c.set('rawBody', rawBody);
    await next();
  });
}
