import type { PageLoad } from './$types';
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

export const load: PageLoad = async ({ fetch }) => {
  const projects = await fetchProjects(fetch);

  const projectsWithTrend: ProjectWithTrend[] = await Promise.all(
    projects.map(async (p) => {
      const [owner, repo] = p.full_slug.split('/');
      try {
        const trend = await fetchTrend(owner, repo, 'coverage', p.default_branch, 20, fetch);
        const latest = trend.data.at(-1) ?? null;
        return { ...p, coverageTrend: trend.data, latestCoverage: latest };
      } catch {
        return { ...p, coverageTrend: [], latestCoverage: null };
      }
    }),
  );

  return { projects: projectsWithTrend };
};
