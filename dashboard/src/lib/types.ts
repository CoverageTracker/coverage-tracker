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
}

export interface TrendResponse {
  project: string;
  branch: string;
  metric: string;
  data: MetricPoint[];
}

export type MetricName = 'coverage' | 'complexity' | 'duplication';

export const METRICS: MetricName[] = ['coverage', 'complexity', 'duplication'];
