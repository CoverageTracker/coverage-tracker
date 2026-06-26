import { Hono } from 'hono';
import { requireAccess } from '../middleware/access';
import { listProjectsWithOwners, getProjectBySlug, getCoverageTrend, pickColumnValue } from '../lib/db';
import { metricToColumn } from '../lib/metrics';
import type { Bindings, Variables } from '../types';

const api = new Hono<{ Bindings: Bindings; Variables: Variables }>();

/** List all tracked projects, grouped with owner metadata. Access-gated. */
api.get('/projects', requireAccess(), async (c) => {
  const rows = await listProjectsWithOwners(c.env.DB);
  return c.json(rows);
});

/** Trend data for one repo+branch+metric. Access-gated. */
api.get('/projects/:owner/:repo/metrics', requireAccess(), async (c) => {
  const fullSlug = `${c.req.param('owner')}/${c.req.param('repo')}`;
  const project = await getProjectBySlug(c.env.DB, fullSlug);
  if (!project) return c.json({ error: 'Not found' }, 404);

  const metric = c.req.query('metric') ?? 'coverage';
  const branch = c.req.query('branch') ?? project.default_branch;
  if (branch.length > 255) return c.json({ error: 'Invalid branch' }, 400);
  const limit = Math.min(Number(c.req.query('limit') ?? '100'), 1000);

  const mapping = metricToColumn(metric);
  if (!mapping) return c.json({ error: `Unknown metric: ${metric}` }, 400);

  const points = await getCoverageTrend(c.env.DB, project.id, branch, limit);
  const data = points
    .map((p) => {
      const value = pickColumnValue(p, mapping.column);
      if (value === null) return null;
      return {
        commit_sha: p.commit_sha,
        value,
        unit: mapping.unit,
        recorded_at: p.recorded_at,
      };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null);

  return c.json({ project: fullSlug, branch, metric, data });
});

export default api;
