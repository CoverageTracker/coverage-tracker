import type { ProjectRow, GroupedTrendResponse, RangeKey } from './types';

export async function fetchProjects(fetchFn: typeof fetch = fetch): Promise<ProjectRow[]> {
  const res = await fetchFn('/api/projects', { redirect: 'manual' });
  if (!res.ok) throw new Error(`Failed to fetch projects: HTTP ${res.status}`);
  return res.json() as Promise<ProjectRow[]>;
}

export interface TrendOptions {
  /** Row-count cap for the legacy (unwindowed) fetch — ignored when `range` is set. */
  limit?: number;
  /** Relative time window; when set, the backend returns an edge-anchored, windowed series. */
  range?: RangeKey;
  /** Align all categories to a shared right edge, carrying stale series forward. Requires `range`. */
  align?: boolean;
}

export async function fetchTrendByCategory(
  owner: string,
  repo: string,
  metric: string,
  branch: string,
  options: TrendOptions,
  fetchFn: typeof fetch = fetch,
): Promise<GroupedTrendResponse> {
  const params = new URLSearchParams({ metric, branch });
  if (options.range) {
    params.set('range', options.range);
    if (options.align) params.set('align', 'true');
  } else {
    params.set('limit', String(options.limit ?? 100));
  }
  const res = await fetchFn(`/api/projects/${owner}/${repo}/metrics/categories?${params}`, {
    redirect: 'manual',
  });
  if (!res.ok) throw new Error(`Failed to fetch trend: HTTP ${res.status}`);
  return res.json() as Promise<GroupedTrendResponse>;
}
