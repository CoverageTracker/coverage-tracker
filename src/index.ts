import { Hono } from 'hono';
import type { Bindings, Variables } from './types';

import ingest from './routes/ingest';
import baseline from './routes/baseline';
import api from './routes/api';
import badge from './routes/badge';
import webhooks from './routes/webhooks';
import admin from './routes/admin';

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

app.route('/ingest', ingest);
app.route('/baseline', baseline);
app.route('/api', api);
app.route('/badge', badge);
app.route('/webhooks', webhooks);
app.route('/admin', admin);

app.get('/', (c) => c.json({ name: 'coverage-tracker', status: 'ok' }));

export default app;
