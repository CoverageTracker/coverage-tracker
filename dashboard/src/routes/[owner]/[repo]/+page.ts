import { error } from '@sveltejs/kit';
import type { PageLoad } from './$types';
import { fetchProjects, fetchTrendByCategory } from '$lib/api';
import { isRangeKey, type RangeKey } from '$lib/types';

export const load: PageLoad = async ({ params, url, fetch }) => {
  const { owner, repo } = params;
  const fullSlug = `${owner}/${repo}`;
  const metric = url.searchParams.get('metric') ?? 'coverage';

  const projects = await fetchProjects(fetch);
  const project = projects.find((p) => p.full_slug === fullSlug);
  if (!project) throw error(404, `Project ${fullSlug} not found`);

  const branch = url.searchParams.get('branch') ?? project.default_branch;
  const rawRange = url.searchParams.get('range');
  const range: RangeKey = rawRange && isRangeKey(rawRange) ? rawRange : '7d';

  let trend;
  try {
    trend = await fetchTrendByCategory(owner, repo, metric, branch, { range }, fetch);
  } catch {
    trend = { project: fullSlug, branch, metric, categories: [] };
  }

  return { project, trend, metric, branch, range };
};
