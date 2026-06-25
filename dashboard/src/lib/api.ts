import type { ProjectRow, TrendResponse } from './types';

export async function fetchProjects(fetchFn: typeof fetch = fetch): Promise<ProjectRow[]> {
  const res = await fetchFn('/api/projects', { redirect: 'manual' });
  if (!res.ok) throw new Error(`Failed to fetch projects: HTTP ${res.status}`);
  return res.json() as Promise<ProjectRow[]>;
}

export async function fetchTrend(
  owner: string,
  repo: string,
  metric: string,
  branch: string,
  limit: number,
  fetchFn: typeof fetch = fetch,
): Promise<TrendResponse> {
  const params = new URLSearchParams({ metric, branch, limit: String(limit) });
  const res = await fetchFn(`/api/projects/${owner}/${repo}/metrics?${params}`, {
    redirect: 'manual',
  });
  if (!res.ok) throw new Error(`Failed to fetch trend: HTTP ${res.status}`);
  return res.json() as Promise<TrendResponse>;
}
