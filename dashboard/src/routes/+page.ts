import type { PageLoad } from './$types';
import { fetchProjects, fetchTrendByCategory } from '$lib/api';
import type { ProjectRow, CategoryTrend } from '$lib/types';

interface ProjectWithTrend extends ProjectRow {
  categories: CategoryTrend[];
}

export const load: PageLoad = async ({ fetch }) => {
  const projects = await fetchProjects(fetch);

  const projectsWithTrend: ProjectWithTrend[] = await Promise.all(
    projects.map(async (p) => {
      const [owner, repo] = p.full_slug.split('/');
      try {
        const trend = await fetchTrendByCategory(
          owner,
          repo,
          'coverage',
          p.default_branch,
          { range: '30d', align: true },
          fetch,
        );
        return { ...p, categories: trend.categories };
      } catch {
        return { ...p, categories: [] };
      }
    }),
  );

  return { projects: projectsWithTrend };
};
