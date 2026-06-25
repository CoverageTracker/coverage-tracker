import type { Bindings } from '../types';

const RETENTION_DAYS = 14;

/**
 * Daily cron job: snapshot last-of-day run into coverage_daily, then prune old runs.
 * Runs atomically as a D1 batch — both statements succeed or both roll back.
 */
export async function rollupAndPrune(env: Bindings): Promise<void> {
  const cutoff = Math.floor(Date.now() / 1000) - RETENTION_DAYS * 86400;

  await env.DB.batch([
    // Snapshot: for each (project, day) that will be pruned, insert/update coverage_daily
    // using the last run of that day (ROW_NUMBER window).
    env.DB.prepare(
      `INSERT INTO coverage_daily
         (project_id, day, line_coverage, branch_coverage, cyclomatic, cognitive, duplication_pct, maintainability, run_count)
       SELECT
         project_id,
         strftime('%Y-%m-%d', ran_at, 'unixepoch') AS day,
         line_coverage, branch_coverage, cyclomatic, cognitive, duplication_pct, maintainability,
         run_count
       FROM (
         SELECT *,
                ROW_NUMBER() OVER (
                  PARTITION BY project_id, strftime('%Y-%m-%d', ran_at, 'unixepoch')
                  ORDER BY ran_at DESC
                ) AS rn,
                COUNT(*) OVER (
                  PARTITION BY project_id, strftime('%Y-%m-%d', ran_at, 'unixepoch')
                ) AS run_count
         FROM coverage_runs
         WHERE ran_at < ?1
       )
       WHERE rn = 1
       ON CONFLICT(project_id, day) DO UPDATE SET
         line_coverage   = excluded.line_coverage,
         branch_coverage = excluded.branch_coverage,
         cyclomatic      = excluded.cyclomatic,
         cognitive       = excluded.cognitive,
         duplication_pct = excluded.duplication_pct,
         maintainability = excluded.maintainability,
         run_count       = coverage_daily.run_count + excluded.run_count`,
    ).bind(cutoff),

    // Prune: delete raw runs that have been snapshotted
    env.DB.prepare('DELETE FROM coverage_runs WHERE ran_at < ?1').bind(cutoff),
  ]);
}
