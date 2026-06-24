import { Hono } from 'hono';
import { requireOidc } from '../middleware/oidc';
import { getProjectBySlug, getLatestMetric } from '../lib/db';
import type { Bindings, Variables } from '../types';

const baseline = new Hono<{ Bindings: Bindings; Variables: Variables }>();

/**
 * Latest metric value for a repo+branch — the baseline for threshold/PR checks.
 * OIDC-gated + project-scoped (mirrors /ingest — not behind Cloudflare Access).
 * The :owner/:repo path params are verified against the OIDC token as a sanity check.
 */
baseline.get('/:owner/:repo', requireOidc(), async (c) => {
  const claims = c.get('oidcClaims');

  // Use the OIDC-verified repository identity — URL params are informational only
  const project = await getProjectBySlug(c.env.DB, claims.repository);
  if (!project) return c.json({ error: 'Repository not registered' }, 403);

  // Verify the URL params match the token
  const urlSlug = `${c.req.param('owner')}/${c.req.param('repo')}`;
  if (urlSlug !== claims.repository) {
    return c.json({ error: 'URL path does not match OIDC token repository' }, 403);
  }

  const metric = c.req.query('metric') ?? 'coverage';
  const branch = c.req.query('branch') ?? project.default_branch;

  const row = await getLatestMetric(c.env.DB, project.id, branch, metric);
  if (!row) return c.json({ error: 'No data for this metric/branch' }, 404);

  return c.json({ project: claims.repository, branch, metric, ...row });
});

export default baseline;
