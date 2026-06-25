import { Hono } from 'hono';
import { z } from 'zod';
import { requireOidc } from '../middleware/oidc';
import { getProjectBySlug, upsertCoverageRun } from '../lib/db';
import type { Bindings, Variables } from '../types';

const ci = new Hono<{ Bindings: Bindings; Variables: Variables }>();

const CoverageReport = z.object({
  line_coverage: z.number().min(0).max(100),
  branch_coverage: z.number().min(0).max(100).optional(),
  cyclomatic: z.number().min(0).optional(),
  cognitive: z.number().min(0).optional(),
  duplication_pct: z.number().min(0).max(100).optional(),
  maintainability: z.number().min(0).max(100).optional(),
});

ci.post('/coverage', requireOidc(), async (c) => {
  const claims = c.get('oidcClaims');
  const { repository, ref, sha, ref_type } = claims;

  if (ref_type !== 'branch') {
    return c.json({ error: 'CI ingest only allowed from branch refs' }, 422);
  }

  const branch = ref.replace(/^refs\/heads\//, '');

  const project = await getProjectBySlug(c.env.DB, repository);
  if (!project) return c.json({ error: 'Repository not registered' }, 403);

  if (branch !== project.default_branch) {
    return c.json({ error: 'Ingest only accepted on the default branch' }, 422);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const result = CoverageReport.safeParse(body);
  if (!result.success) {
    return c.json({ error: 'Validation failed', issues: result.error.issues }, 422);
  }

  const data = result.data;
  await upsertCoverageRun(c.env.DB, project.id, sha, branch, Math.floor(Date.now() / 1000), {
    line_coverage: data.line_coverage,
    branch_coverage: data.branch_coverage ?? null,
    cyclomatic: data.cyclomatic ?? null,
    cognitive: data.cognitive ?? null,
    duplication_pct: data.duplication_pct ?? null,
    maintainability: data.maintainability ?? null,
  });

  return c.json({ ok: true }, 202);
});

export default ci;
