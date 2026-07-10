export interface ProjectRow {
  id: number;
  full_slug: string;
  repo_name: string;
  default_branch: string;
  badge_enabled: number;
  created_at: string;
  owner_login: string;
  owner_type: string;
  owner_avatar_url: string | null;
}

export interface MetricPoint {
  commit_sha: string;
  value: number;
  unit: string;
  recorded_at: string;
  /** True for a point synthesized to anchor/carry a line to a window boundary — not a real run. */
  synthetic?: boolean;
}

export interface CategoryTrend {
  category: string;
  data: MetricPoint[];
}

export interface GroupedTrendResponse {
  project: string;
  branch: string;
  metric: string;
  categories: CategoryTrend[];
}

export type MetricName = 'coverage' | 'complexity' | 'duplication';

export const METRICS: MetricName[] = ['coverage', 'complexity', 'duplication'];

export type RangeKey = '15m' | '1h' | '12h' | '1d' | '7d' | '30d';

export const RANGES: { key: RangeKey; label: string }[] = [
  { key: '15m', label: '15m' },
  { key: '1h', label: '1h' },
  { key: '12h', label: '12h' },
  { key: '1d', label: '1d' },
  { key: '7d', label: '7d' },
  { key: '30d', label: '30d' },
];

export function isRangeKey(value: string): value is RangeKey {
  return RANGES.some((r) => r.key === value);
}
