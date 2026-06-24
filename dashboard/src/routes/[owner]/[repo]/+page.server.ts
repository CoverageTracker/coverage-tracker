import { error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { PageServerLoad } from './$types';
import { fetchProjects, fetchTrend } from '$lib/api';

export const load: PageServerLoad = async ({ params, url, fetch, request, platform }) => {
  const jwt = request.headers.get('Cf-Access-Jwt-Assertion') ?? '';
  const workerUrl = (env.WORKER_URL ?? '').replace(/\/$/, '');
  if (!workerUrl) throw error(500, 'WORKER_URL is not configured');

  const bypass = env.DEV_BYPASS_SECRET ?? '';
  const extraHeaders: Record<string, string> = bypass ? { 'x-dev-bypass': bypass } : {};

  const apiFetch = platform?.env?.WORKER?.fetch.bind(platform.env.WORKER) ?? fetch;

  const { owner, repo } = params;
  const fullSlug = `${owner}/${repo}`;
  const metric = url.searchParams.get('metric') ?? 'coverage';

  const projects = await fetchProjects(workerUrl, jwt, apiFetch, extraHeaders);
  const project = projects.find((p) => p.full_slug === fullSlug);
  if (!project) throw error(404, `Project ${fullSlug} not found`);

  const branch = url.searchParams.get('branch') ?? project.default_branch;

  let trend;
  try {
    trend = await fetchTrend(workerUrl, jwt, owner, repo, metric, branch, 100, apiFetch, extraHeaders);
  } catch {
    trend = { project: fullSlug, branch, metric, data: [] };
  }

  return { project, trend, metric, branch };
};
