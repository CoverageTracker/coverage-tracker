import type { ProjectRow, TrendResponse } from './types';

export async function fetchProjects(
  workerUrl: string,
  jwt: string,
  fetchFn: typeof fetch = fetch,
  extraHeaders: Record<string, string> = {},
): Promise<ProjectRow[]> {
  const res = await fetchFn(`${workerUrl}/api/projects`, {
    headers: { 'Cf-Access-Jwt-Assertion': jwt, ...extraHeaders },
    redirect: 'manual',
  });
  if (!res.ok) throw new Error(`Failed to fetch projects: HTTP ${res.status}`);
  return res.json() as Promise<ProjectRow[]>;
}

export async function fetchTrend(
  workerUrl: string,
  jwt: string,
  owner: string,
  repo: string,
  metric: string,
  branch: string,
  limit: number,
  fetchFn: typeof fetch = fetch,
  extraHeaders: Record<string, string> = {},
): Promise<TrendResponse> {
  const url = new URL(`${workerUrl}/api/projects/${owner}/${repo}/metrics`);
  url.searchParams.set('metric', metric);
  url.searchParams.set('branch', branch);
  url.searchParams.set('limit', String(limit));
  const res = await fetchFn(url.toString(), {
    headers: { 'Cf-Access-Jwt-Assertion': jwt, ...extraHeaders },
    redirect: 'manual',
  });
  if (!res.ok) throw new Error(`Failed to fetch trend: HTTP ${res.status}`);
  return res.json() as Promise<TrendResponse>;
}
