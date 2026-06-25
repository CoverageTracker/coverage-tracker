import { Hono } from 'hono';
import { getProjectBySlug, getLatestCoverage } from '../lib/db';
import { metricToColumn, pickMetricValue } from '../lib/metrics';
import type { Bindings, Variables } from '../types';

const badge = new Hono<{ Bindings: Bindings; Variables: Variables }>();

/**
 * Public shields.io endpoint format.
 * Returns 404 (not 403) for projects with badge_enabled=0 to avoid confirming existence (A12).
 */
badge.get('/:owner/:repo/:metric{.+\\.json}', async (c) => {
  const owner = c.req.param('owner');
  const repo = c.req.param('repo');
  const metricParam = c.req.param('metric');
  const metricName = metricParam.replace(/\.json$/, '');

  const project = await getProjectBySlug(c.env.DB, `${owner}/${repo}`);
  if (!project || project.badge_enabled === 0) return c.notFound();

  const mapping = metricToColumn(metricName);
  if (!mapping) return c.notFound();

  const run = await getLatestCoverage(c.env.DB, project.id, project.default_branch);
  if (!run) return c.notFound();

  const value = pickMetricValue(run, mapping.column);
  if (value === null) return c.notFound();

  const message = mapping.unit === '%' ? `${value.toFixed(1)}%` : `${value}`;
  const color = badgeColor(metricName, value);

  return c.json({
    schemaVersion: 1,
    label: metricName,
    message,
    color,
  });
});

function badgeColor(metricName: string, value: number): string {
  if (metricName === 'coverage') {
    if (value >= 80) return 'brightgreen';
    if (value >= 60) return 'yellow';
    return 'red';
  }
  if (metricName === 'duplication') {
    if (value <= 3) return 'brightgreen';
    if (value <= 10) return 'yellow';
    return 'red';
  }
  return 'blue';
}

export default badge;
