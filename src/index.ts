import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import type { Bindings, Variables } from './types';
import { rollupAndPrune } from './db/rollup';

import ci from './routes/ci';
import baseline from './routes/baseline';
import api from './routes/api';
import badge from './routes/badge';
import webhooks from './routes/webhooks';
import admin from './routes/admin';

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

app.use('*', secureHeaders());

app.route('/api/ci', ci);
app.route('/api/baseline', baseline);
app.route('/api', api);
app.route('/api/badge', badge);
app.route('/api/webhooks', webhooks);
app.route('/api/admin', admin);

app.get('/api/health', (c) => c.json({ name: 'coverage-tracker', status: 'ok' }));

// Static SPA assets — must be last; handles all non-/api/* paths.
app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw));

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledEvent, env: Bindings, ctx: ExecutionContext) {
    ctx.waitUntil(rollupAndPrune(env));
  },
};
