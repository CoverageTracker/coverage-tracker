import { error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { PageServerLoad } from './$types';
import { fetchProjects, fetchTrend } from '$lib/api';
import type { MetricPoint } from '$lib/types';

interface ProjectWithTrend {
  id: number;
  full_slug: string;
  repo_name: string;
  default_branch: string;
  badge_enabled: number;
  created_at: string;
  owner_login: string;
  owner_type: string;
  owner_avatar_url: string | null;
  coverageTrend: MetricPoint[];
  latestCoverage: MetricPoint | null;
}

export const load: PageServerLoad = async ({ fetch, request }) => {
  const jwt = request.headers.get('Cf-Access-Jwt-Assertion') ?? '';
  const workerUrl = (env.WORKER_URL ?? '').replace(/\/$/, '');
  if (!workerUrl) throw error(500, 'WORKER_URL is not configured');

  const bypass = env.DEV_BYPASS_SECRET ?? '';
  const extraHeaders: Record<string, string> = bypass ? { 'x-dev-bypass': bypass } : {};

  const projects = await fetchProjects(workerUrl, jwt, fetch, extraHeaders);

  const projectsWithTrend: ProjectWithTrend[] = await Promise.all(
    projects.map(async (p) => {
      const [owner, repo] = p.full_slug.split('/');
      try {
        const trend = await fetchTrend(
          workerUrl,
          jwt,
          owner,
          repo,
          'coverage',
          p.default_branch,
          20,
          fetch,
          extraHeaders,
        );
        const latest = trend.data.at(-1) ?? null;
        return { ...p, coverageTrend: trend.data, latestCoverage: latest };
      } catch {
        return { ...p, coverageTrend: [], latestCoverage: null };
      }
    }),
  );

  return { projects: projectsWithTrend };
};
