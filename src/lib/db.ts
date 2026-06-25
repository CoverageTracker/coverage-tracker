import type { Project, Owner, CoverageRun } from '../types';
import type { CoverageColumn } from './metrics';

/**
 * Look up a project by its full_slug (e.g. "owner/repo").
 * full_slug is denormalized from the OIDC `repository` claim for fast lookup.
 * All path params that flow into SQL use .bind() — never string interpolation (A10).
 */
export async function getProjectBySlug(db: D1Database, fullSlug: string): Promise<Project | null> {
  const row = await db
    .prepare('SELECT * FROM projects WHERE full_slug = ?')
    .bind(fullSlug)
    .first<Project>();
  return row ?? null;
}

export async function getProjectById(db: D1Database, id: number): Promise<Project | null> {
  const row = await db
    .prepare('SELECT * FROM projects WHERE id = ?')
    .bind(id)
    .first<Project>();
  return row ?? null;
}

export async function listProjectsWithOwners(
  db: D1Database,
): Promise<Array<Project & { owner_login: string; owner_type: string; owner_avatar_url: string | null }>> {
  const { results } = await db
    .prepare(
      `SELECT p.*, o.login AS owner_login, o.type AS owner_type, o.avatar_url AS owner_avatar_url
       FROM projects p
       JOIN owners o ON o.id = p.owner_id
       ORDER BY o.login, p.repo_name`,
    )
    .all();
  return results as unknown as Array<Project & { owner_login: string; owner_type: string; owner_avatar_url: string | null }>;
}

export async function getMetricsTrend(
  db: D1Database,
  projectId: number,
  branch: string,
  metricName: string,
  limit: number,
): Promise<Array<{ commit_sha: string; value: number; unit: string; recorded_at: string }>> {
  const { results } = await db
    .prepare(
      `SELECT commit_sha, value, unit, recorded_at
       FROM metrics
       WHERE project_id = ? AND branch = ? AND metric_name = ?
       ORDER BY recorded_at DESC
       LIMIT ?`,
    )
    .bind(projectId, branch, metricName, limit)
    .all();
  return results as Array<{ commit_sha: string; value: number; unit: string; recorded_at: string }>;
}

export async function getLatestMetric(
  db: D1Database,
  projectId: number,
  branch: string,
  metricName: string,
): Promise<{ value: number; unit: string; commit_sha: string } | null> {
  const row = await db
    .prepare(
      `SELECT value, unit, commit_sha
       FROM metrics
       WHERE project_id = ? AND branch = ? AND metric_name = ?
       ORDER BY recorded_at DESC
       LIMIT 1`,
    )
    .bind(projectId, branch, metricName)
    .first<{ value: number; unit: string; commit_sha: string }>();
  return row ?? null;
}

export async function insertMetric(
  db: D1Database,
  projectId: number,
  branch: string,
  commitSha: string,
  metricName: string,
  value: number,
  unit: string,
): Promise<void> {
  // INSERT OR IGNORE: re-ingesting the same commit+metric is a silent no-op (A11)
  await db
    .prepare(
      `INSERT OR IGNORE INTO metrics(project_id, branch, commit_sha, metric_name, value, unit)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(projectId, branch, commitSha, metricName, value, unit)
    .run();
}

export async function upsertOwner(
  db: D1Database,
  githubId: number,
  login: string,
  type: 'User' | 'Organization',
  avatarUrl: string | null,
): Promise<number> {
  await db
    .prepare(
      `INSERT INTO owners(github_id, login, type, avatar_url)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(github_id) DO UPDATE SET
         login = excluded.login,
         type = excluded.type,
         avatar_url = excluded.avatar_url`,
    )
    .bind(githubId, login, type, avatarUrl)
    .run();

  const row = await db
    .prepare('SELECT id FROM owners WHERE github_id = ?')
    .bind(githubId)
    .first<{ id: number }>();

  return row!.id;
}

export async function upsertProject(
  db: D1Database,
  ownerId: number,
  githubRepoId: number,
  repoName: string,
  fullSlug: string,
  installationId: number,
  defaultBranch: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO projects(owner_id, github_repo_id, repo_name, full_slug, installation_id, default_branch)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(github_repo_id) DO UPDATE SET
         owner_id = excluded.owner_id,
         repo_name = excluded.repo_name,
         full_slug = excluded.full_slug,
         installation_id = excluded.installation_id,
         default_branch = excluded.default_branch`,
    )
    .bind(ownerId, githubRepoId, repoName, fullSlug, installationId, defaultBranch)
    .run();
}

export async function deleteProjectsByInstallation(
  db: D1Database,
  installationId: number,
): Promise<void> {
  await db
    .prepare('DELETE FROM projects WHERE installation_id = ?')
    .bind(installationId)
    .run();
}

export async function deleteProjectByRepoId(db: D1Database, githubRepoId: number): Promise<void> {
  await db
    .prepare('DELETE FROM projects WHERE github_repo_id = ?')
    .bind(githubRepoId)
    .run();
}

export async function getOwnerByGithubId(db: D1Database, githubId: number): Promise<Owner | null> {
  const row = await db
    .prepare('SELECT * FROM owners WHERE github_id = ?')
    .bind(githubId)
    .first<Owner>();
  return row ?? null;
}

export async function getProjectsByInstallation(
  db: D1Database,
  installationId: number,
): Promise<Project[]> {
  const { results } = await db
    .prepare('SELECT * FROM projects WHERE installation_id = ?')
    .bind(installationId)
    .all<Project>();
  return results;
}

export async function setBadgeEnabled(
  db: D1Database,
  projectId: number,
  enabled: boolean,
): Promise<void> {
  await db
    .prepare('UPDATE projects SET badge_enabled = ? WHERE id = ?')
    .bind(enabled ? 1 : 0, projectId)
    .run();
}

// ── coverage_runs / coverage_daily helpers ────────────────────────────────

export async function upsertCoverageRun(
  db: D1Database,
  projectId: number,
  commitSha: string,
  branch: string,
  ranAt: number,
  fields: {
    line_coverage: number;
    branch_coverage?: number | null;
    cyclomatic?: number | null;
    cognitive?: number | null;
    duplication_pct?: number | null;
    maintainability?: number | null;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO coverage_runs
         (project_id, commit_sha, branch, ran_at, line_coverage, branch_coverage,
          cyclomatic, cognitive, duplication_pct, maintainability)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(project_id, commit_sha) DO UPDATE SET
         branch          = excluded.branch,
         ran_at          = excluded.ran_at,
         line_coverage   = excluded.line_coverage,
         branch_coverage = excluded.branch_coverage,
         cyclomatic      = excluded.cyclomatic,
         cognitive       = excluded.cognitive,
         duplication_pct = excluded.duplication_pct,
         maintainability = excluded.maintainability`,
    )
    .bind(
      projectId,
      commitSha,
      branch,
      ranAt,
      fields.line_coverage,
      fields.branch_coverage ?? null,
      fields.cyclomatic ?? null,
      fields.cognitive ?? null,
      fields.duplication_pct ?? null,
      fields.maintainability ?? null,
    )
    .run();
}

export async function getLatestCoverageRun(
  db: D1Database,
  projectId: number,
  branch: string,
): Promise<CoverageRun | null> {
  const row = await db
    .prepare(
      `SELECT * FROM coverage_runs
       WHERE project_id = ? AND branch = ?
       ORDER BY ran_at DESC
       LIMIT 1`,
    )
    .bind(projectId, branch)
    .first<CoverageRun>();
  return row ?? null;
}

type LatestCoverage = Pick<
  CoverageRun,
  'commit_sha' | 'line_coverage' | 'branch_coverage' | 'cyclomatic' | 'cognitive' | 'duplication_pct' | 'maintainability'
>;

/**
 * Returns the most recent coverage values for a project/branch.
 * Checks coverage_runs first; falls back to coverage_daily for dormant repos
 * whose raw runs have been pruned by the daily rollup cron.
 */
export async function getLatestCoverage(
  db: D1Database,
  projectId: number,
  branch: string,
): Promise<LatestCoverage | null> {
  const run = await getLatestCoverageRun(db, projectId, branch);
  if (run) return run;

  const daily = await db
    .prepare(
      `SELECT 'aggregated' AS commit_sha,
              line_coverage, branch_coverage, cyclomatic, cognitive, duplication_pct, maintainability
       FROM coverage_daily
       WHERE project_id = ?
       ORDER BY day DESC
       LIMIT 1`,
    )
    .bind(projectId)
    .first<LatestCoverage>();
  return daily ?? null;
}

export interface CoverageTrendPoint {
  commit_sha: string;
  recorded_at: string;
  line_coverage: number;
  branch_coverage: number | null;
  cyclomatic: number | null;
  cognitive: number | null;
  duplication_pct: number | null;
  maintainability: number | null;
}

export async function getCoverageTrend(
  db: D1Database,
  projectId: number,
  branch: string,
  limit: number,
): Promise<CoverageTrendPoint[]> {
  // Take the most-recent `limit` days across both tables, then reverse to ASC for display.
  const { results } = await db
    .prepare(
      `SELECT commit_sha, recorded_at,
              line_coverage, branch_coverage, cyclomatic, cognitive, duplication_pct, maintainability
       FROM (
         SELECT 'aggregated' AS commit_sha,
                day AS recorded_at,
                line_coverage, branch_coverage, cyclomatic, cognitive, duplication_pct, maintainability
         FROM coverage_daily
         WHERE project_id = ?1
           AND day NOT IN (
             SELECT DISTINCT strftime('%Y-%m-%d', ran_at, 'unixepoch')
             FROM coverage_runs
             WHERE project_id = ?1 AND branch = ?2
           )

         UNION ALL

         SELECT commit_sha,
                strftime('%Y-%m-%d', ran_at, 'unixepoch') AS recorded_at,
                line_coverage, branch_coverage, cyclomatic, cognitive, duplication_pct, maintainability
         FROM (
           SELECT *,
                  ROW_NUMBER() OVER (
                    PARTITION BY strftime('%Y-%m-%d', ran_at, 'unixepoch')
                    ORDER BY ran_at DESC
                  ) AS rn
           FROM coverage_runs
           WHERE project_id = ?1 AND branch = ?2
         )
         WHERE rn = 1

         ORDER BY recorded_at DESC
         LIMIT ?3
       )
       ORDER BY recorded_at ASC`,
    )
    .bind(projectId, branch, limit)
    .all<CoverageTrendPoint>();
  return results;
}

/** Extract the right numeric value from a coverage trend point by column name. */
export function pickColumnValue(point: CoverageTrendPoint, column: CoverageColumn): number | null {
  const v = point[column];
  return v != null ? v : null;
}
