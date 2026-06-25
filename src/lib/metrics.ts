/**
 * Maps dashboard metric names (used in URL params + the metrics file) to typed
 * columns in coverage_runs / coverage_daily and their display unit.
 *
 * "complexity" maps to cyclomatic — the most widely understood complexity metric.
 */
export const METRIC_COLUMN_MAP = {
  coverage: { column: 'line_coverage' as const, unit: '%' },
  branch_coverage: { column: 'branch_coverage' as const, unit: '%' },
  complexity: { column: 'cyclomatic' as const, unit: '' },
  cyclomatic: { column: 'cyclomatic' as const, unit: '' },
  cognitive: { column: 'cognitive' as const, unit: '' },
  duplication: { column: 'duplication_pct' as const, unit: '%' },
  maintainability: { column: 'maintainability' as const, unit: '' },
} as const;

export type DashboardMetric = keyof typeof METRIC_COLUMN_MAP;

export type CoverageColumn =
  | 'line_coverage'
  | 'branch_coverage'
  | 'cyclomatic'
  | 'cognitive'
  | 'duplication_pct'
  | 'maintainability';

export function metricToColumn(metric: string): { column: CoverageColumn; unit: string } | null {
  return (METRIC_COLUMN_MAP as Record<string, { column: CoverageColumn; unit: string }>)[metric] ?? null;
}

/** Read the right column value from a typed coverage row. */
export function pickMetricValue(
  row: Partial<Record<CoverageColumn, number | null>>,
  column: CoverageColumn,
): number | null {
  const v = row[column];
  return v != null ? v : null;
}
