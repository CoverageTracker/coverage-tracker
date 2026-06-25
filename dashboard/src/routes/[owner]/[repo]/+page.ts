import { error } from '@sveltejs/kit';
import type { PageLoad } from './$types';
import { fetchProjects, fetchTrend } from '$lib/api';

export const load: PageLoad = async ({ params, url, fetch }) => {
  const { owner, repo } = params;
  const fullSlug = `${owner}/${repo}`;
  const metric = url.searchParams.get('metric') ?? 'coverage';

  const projects = await fetchProjects(fetch);
  const project = projects.find((p) => p.full_slug === fullSlug);
  if (!project) throw error(404, `Project ${fullSlug} not found`);

  const branch = url.searchParams.get('branch') ?? project.default_branch;

  let trend;
  try {
    trend = await fetchTrend(owner, repo, metric, branch, 100, fetch);
  } catch {
    trend = { project: fullSlug, branch, metric, data: [] };
  }

  return { project, trend, metric, branch };
};
