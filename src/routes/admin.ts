import { Hono } from 'hono';
import { requireAccess } from '../middleware/access';
import { getProjectById, setBadgeEnabled } from '../lib/db';
import { performResync } from '../lib/resync';
import type { Bindings, Variables } from '../types';

const admin = new Hono<{ Bindings: Bindings; Variables: Variables }>();

/**
 * Trigger a full resync of one installation against GitHub's source of truth.
 * Access-gated. Prepared for Phase 5 dashboard button (same function, new entry point).
 */
admin.post('/resync', requireAccess(), async (c) => {
  let body: { installationId?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const installationId = Number(body.installationId);
  if (!Number.isInteger(installationId) || installationId <= 0) {
    return c.json({ error: 'installationId must be a positive integer' }, 400);
  }

  try {
    await performResync(installationId, c.env);
  } catch (err) {
    console.error('Resync failed:', err);
    return c.json({ error: 'Resync failed' }, 502);
  }

  return c.json({ ok: true });
});

/**
 * Toggle the public badge for a project.
 * Default is off (badge_enabled=0). Must be explicitly opted in per project (A12).
 */
admin.patch('/projects/:id/badge', requireAccess(), async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) {
    return c.json({ error: 'Invalid project id' }, 400);
  }

  const project = await getProjectById(c.env.DB, id);
  if (!project) return c.json({ error: 'Project not found' }, 404);

  let body: { enabled?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  if (typeof body.enabled !== 'boolean') {
    return c.json({ error: 'enabled must be a boolean' }, 400);
  }

  await setBadgeEnabled(c.env.DB, id, body.enabled);
  return c.json({ ok: true, badge_enabled: body.enabled });
});

export default admin;
