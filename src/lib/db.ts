import type { Project, Owner, CoverageRun } from '../types';
import type { CoverageColumn } from './metrics';
import { SUB_DAY_THRESHOLD_SECONDS } from './timeRanges';

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
  const row = await db.prepare('SELECT * FROM projects WHERE id = ?').bind(id).first<Project>();
  return row ?? null;
}

export async function listProjectsWithOwners(
  db: D1Database,
): Promise<
  Array<Project & { owner_login: string; owner_type: string; owner_avatar_url: string | null }>
> {
  const { results } = await db
    .prepare(
      `SELECT p.*, o.login AS owner_login, o.type AS owner_type, o.avatar_url AS owner_avatar_url
       FROM projects p
       JOIN owners o ON o.id = p.owner_id
       ORDER BY o.login, p.repo_name`,
    )
    .all();
  return results as unknown as Array<
    Project & { owner_login: string; owner_type: string; owner_avatar_url: string | null }
  >;
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
  await db.prepare('DELETE FROM projects WHERE installation_id = ?').bind(installationId).run();
}

export async function deleteProjectByRepoId(db: D1Database, githubRepoId: number): Promise<void> {
  await db.prepare('DELETE FROM projects WHERE github_repo_id = ?').bind(githubRepoId).run();
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
    category?: string;
    line_coverage: number;
    branch_coverage?: number | null;
    cyclomatic?: number | null;
    cognitive?: number | null;
    duplication_pct?: number | null;
    maintainability?: number | null;
  },
): Promise<void> {
  const category = fields.category ?? 'default';
  await db
    .prepare(
      `INSERT INTO coverage_runs
         (project_id, commit_sha, branch, category, ran_at, line_coverage, branch_coverage,
          cyclomatic, cognitive, duplication_pct, maintainability)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(project_id, category, commit_sha) DO UPDATE SET
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
      category,
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
  category: string = 'default',
): Promise<CoverageRun | null> {
  const row = await db
    .prepare(
      `SELECT * FROM coverage_runs
       WHERE project_id = ? AND branch = ? AND category = ?
       ORDER BY ran_at DESC
       LIMIT 1`,
    )
    .bind(projectId, branch, category)
    .first<CoverageRun>();
  return row ?? null;
}

type LatestCoverage = Pick<
  CoverageRun,
  | 'commit_sha'
  | 'line_coverage'
  | 'branch_coverage'
  | 'cyclomatic'
  | 'cognitive'
  | 'duplication_pct'
  | 'maintainability'
>;

/**
 * Returns the most recent coverage values for a project/branch/category.
 * Checks coverage_runs first; falls back to coverage_daily for dormant repos
 * whose raw runs have been pruned by the daily rollup cron.
 */
export async function getLatestCoverage(
  db: D1Database,
  projectId: number,
  branch: string,
  category: string = 'default',
): Promise<LatestCoverage | null> {
  const run = await getLatestCoverageRun(db, projectId, branch, category);
  if (run) return run;

  const daily = await db
    .prepare(
      `SELECT 'aggregated' AS commit_sha,
              line_coverage, branch_coverage, cyclomatic, cognitive, duplication_pct, maintainability
       FROM coverage_daily
       WHERE project_id = ? AND category = ?
       ORDER BY day DESC
       LIMIT 1`,
    )
    .bind(projectId, category)
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
  /** True for a point synthesized to anchor/carry a line to a window boundary — not a real run. */
  synthetic?: boolean;
}

export async function getCoverageTrend(
  db: D1Database,
  projectId: number,
  branch: string,
  limit: number,
  category: string = 'default',
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
         WHERE project_id = ?1 AND category = ?4
           AND day NOT IN (
             SELECT DISTINCT strftime('%Y-%m-%d', ran_at, 'unixepoch')
             FROM coverage_runs
             WHERE project_id = ?1 AND branch = ?2 AND category = ?4
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
           WHERE project_id = ?1 AND branch = ?2 AND category = ?4
         )
         WHERE rn = 1

         ORDER BY recorded_at DESC
         LIMIT ?3
       )
       ORDER BY recorded_at ASC`,
    )
    .bind(projectId, branch, limit, category)
    .all<CoverageTrendPoint>();
  return results;
}

export interface CoverageTrendPointWithCategory extends CoverageTrendPoint {
  category: string;
}

/**
 * Like getCoverageTrend, but returns every category's series in one query,
 * each capped independently at `limit` (not a flat limit split across
 * categories). Doubles as category discovery — whichever categories have
 * data for this project/branch simply appear in the result.
 */
export async function getCoverageTrendGrouped(
  db: D1Database,
  projectId: number,
  branch: string,
  limit: number,
): Promise<CoverageTrendPointWithCategory[]> {
  const { results } = await db
    .prepare(
      `SELECT category, commit_sha, recorded_at,
              line_coverage, branch_coverage, cyclomatic, cognitive, duplication_pct, maintainability
       FROM (
         SELECT *,
                ROW_NUMBER() OVER (
                  PARTITION BY category ORDER BY recorded_at DESC
                ) AS rn2
         FROM (
           SELECT cd.category AS category, 'aggregated' AS commit_sha, cd.day AS recorded_at,
                  cd.line_coverage, cd.branch_coverage, cd.cyclomatic, cd.cognitive, cd.duplication_pct, cd.maintainability
           FROM coverage_daily cd
           WHERE cd.project_id = ?1
             AND cd.day NOT IN (
               SELECT DISTINCT strftime('%Y-%m-%d', ran_at, 'unixepoch')
               FROM coverage_runs
               WHERE project_id = ?1 AND branch = ?2 AND category = cd.category
             )

           UNION ALL

           SELECT category, commit_sha,
                  strftime('%Y-%m-%d', ran_at, 'unixepoch') AS recorded_at,
                  line_coverage, branch_coverage, cyclomatic, cognitive, duplication_pct, maintainability
           FROM (
             SELECT *,
                    ROW_NUMBER() OVER (
                      PARTITION BY category, strftime('%Y-%m-%d', ran_at, 'unixepoch')
                      ORDER BY ran_at DESC
                    ) AS rn
             FROM coverage_runs
             WHERE project_id = ?1 AND branch = ?2
           )
           WHERE rn = 1
         )
       )
       WHERE rn2 <= ?3
       ORDER BY category ASC, recorded_at ASC`,
    )
    .bind(projectId, branch, limit)
    .all<CoverageTrendPointWithCategory>();
  return results;
}

/** Extract the right numeric value from a coverage trend point by column name. */
export function pickColumnValue(point: CoverageTrendPoint, column: CoverageColumn): number | null {
  const v = point[column];
  return v != null ? v : null;
}

// ── Windowed + anchored trend queries (relative time-range charts) ────────
//
// Right edge = the latest known point (own latest, or a shared max across
// categories when aligning). Window start = right edge − rangeSeconds. A
// synthetic "anchor" point is emitted at the window start using the closest
// real row at-or-before it (or the earliest available row as a fallback), so
// the chart always draws full-width instead of leaving empty space or a lone
// dot. Windows < 1 day use raw coverage_runs at full timestamp precision
// (coverage_daily's `recorded_at` is a YYYY-MM-DD day string — reusing it for
// sub-day windows would collapse the anchor and latest points onto the same
// x position). Windows >= 1 day keep the existing day-collapsed semantics.

interface WindowRow {
  commit_sha: string;
  recorded_at: string;
  line_coverage: number;
  branch_coverage: number | null;
  cyclomatic: number | null;
  cognitive: number | null;
  duplication_pct: number | null;
  maintainability: number | null;
}

const WINDOW_SELECT_COLUMNS =
  'commit_sha, line_coverage, branch_coverage, cyclomatic, cognitive, duplication_pct, maintainability';

function dayString(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toISOString().slice(0, 10);
}

function epochToIso(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toISOString();
}

async function getOwnLatestTimestamp(
  db: D1Database,
  projectId: number,
  branch: string,
  category: string,
): Promise<number | null> {
  const run = await getLatestCoverageRun(db, projectId, branch, category);
  if (run) return run.ran_at;

  const daily = await db
    .prepare(
      `SELECT day FROM coverage_daily WHERE project_id = ?1 AND category = ?2 ORDER BY day DESC LIMIT 1`,
    )
    .bind(projectId, category)
    .first<{ day: string }>();
  if (!daily) return null;
  return Math.floor(Date.parse(`${daily.day}T00:00:00Z`) / 1000);
}

async function subDayInWindowRows(
  db: D1Database,
  projectId: number,
  branch: string,
  category: string,
  windowStart: number,
  rightEdge: number,
): Promise<WindowRow[]> {
  const { results } = await db
    .prepare(
      `SELECT ${WINDOW_SELECT_COLUMNS}, strftime('%Y-%m-%dT%H:%M:%SZ', ran_at, 'unixepoch') AS recorded_at
       FROM coverage_runs
       WHERE project_id = ?1 AND branch = ?2 AND category = ?3 AND ran_at BETWEEN ?4 AND ?5
       ORDER BY ran_at ASC`,
    )
    .bind(projectId, branch, category, windowStart, rightEdge)
    .all<WindowRow>();
  return results;
}

async function subDayAnchorRow(
  db: D1Database,
  projectId: number,
  branch: string,
  category: string,
  windowStart: number,
): Promise<WindowRow | null> {
  const row = await db
    .prepare(
      `SELECT ${WINDOW_SELECT_COLUMNS}, strftime('%Y-%m-%dT%H:%M:%SZ', ran_at, 'unixepoch') AS recorded_at
       FROM coverage_runs
       WHERE project_id = ?1 AND branch = ?2 AND category = ?3 AND ran_at <= ?4
       ORDER BY ran_at DESC LIMIT 1`,
    )
    .bind(projectId, branch, category, windowStart)
    .first<WindowRow>();
  return row ?? null;
}

async function subDayEarliestRow(
  db: D1Database,
  projectId: number,
  branch: string,
  category: string,
): Promise<WindowRow | null> {
  const row = await db
    .prepare(
      `SELECT ${WINDOW_SELECT_COLUMNS}, strftime('%Y-%m-%dT%H:%M:%SZ', ran_at, 'unixepoch') AS recorded_at
       FROM coverage_runs
       WHERE project_id = ?1 AND branch = ?2 AND category = ?3
       ORDER BY ran_at ASC LIMIT 1`,
    )
    .bind(projectId, branch, category)
    .first<WindowRow>();
  return row ?? null;
}

/** Shared day-collapsed union of coverage_daily + last-of-day coverage_runs, as a subquery. */
function dayUnionSql(): string {
  return `
    SELECT 'aggregated' AS commit_sha, day AS recorded_at,
           line_coverage, branch_coverage, cyclomatic, cognitive, duplication_pct, maintainability
    FROM coverage_daily
    WHERE project_id = ?1 AND category = ?3
      AND day NOT IN (
        SELECT DISTINCT strftime('%Y-%m-%d', ran_at, 'unixepoch')
        FROM coverage_runs
        WHERE project_id = ?1 AND branch = ?2 AND category = ?3
      )

    UNION ALL

    SELECT commit_sha, strftime('%Y-%m-%d', ran_at, 'unixepoch') AS recorded_at,
           line_coverage, branch_coverage, cyclomatic, cognitive, duplication_pct, maintainability
    FROM (
      SELECT *,
             ROW_NUMBER() OVER (
               PARTITION BY strftime('%Y-%m-%d', ran_at, 'unixepoch')
               ORDER BY ran_at DESC
             ) AS rn
      FROM coverage_runs
      WHERE project_id = ?1 AND branch = ?2 AND category = ?3
    )
    WHERE rn = 1
  `;
}

async function dayInWindowRows(
  db: D1Database,
  projectId: number,
  branch: string,
  category: string,
  windowStartDay: string,
  rightEdgeDay: string,
): Promise<WindowRow[]> {
  const { results } = await db
    .prepare(
      `SELECT commit_sha, recorded_at, line_coverage, branch_coverage, cyclomatic, cognitive, duplication_pct, maintainability
       FROM (${dayUnionSql()})
       WHERE recorded_at BETWEEN ?4 AND ?5
       ORDER BY recorded_at ASC`,
    )
    .bind(projectId, branch, category, windowStartDay, rightEdgeDay)
    .all<WindowRow>();
  return results;
}

async function dayAnchorRow(
  db: D1Database,
  projectId: number,
  branch: string,
  category: string,
  windowStartDay: string,
): Promise<WindowRow | null> {
  const row = await db
    .prepare(
      `SELECT commit_sha, recorded_at, line_coverage, branch_coverage, cyclomatic, cognitive, duplication_pct, maintainability
       FROM (${dayUnionSql()})
       WHERE recorded_at < ?4
       ORDER BY recorded_at DESC LIMIT 1`,
    )
    .bind(projectId, branch, category, windowStartDay)
    .first<WindowRow>();
  return row ?? null;
}

async function dayEarliestRow(
  db: D1Database,
  projectId: number,
  branch: string,
  category: string,
): Promise<WindowRow | null> {
  const row = await db
    .prepare(
      `SELECT commit_sha, recorded_at, line_coverage, branch_coverage, cyclomatic, cognitive, duplication_pct, maintainability
       FROM (${dayUnionSql()})
       ORDER BY recorded_at ASC LIMIT 1`,
    )
    .bind(projectId, branch, category)
    .first<WindowRow>();
  return row ?? null;
}

export interface WindowedTrendOptions {
  /** Use this instead of the category's own latest point as the right edge — for cross-category alignment. */
  rightEdge?: number;
  /** If the series' last point sits before the right edge, append a synthetic point carrying its value forward. */
  forwardCarry?: boolean;
}

/**
 * Windowed + edge-anchored trend for one category. See the block comment above
 * this section for the overall strategy.
 */
export async function getCoverageTrendWindowed(
  db: D1Database,
  projectId: number,
  branch: string,
  category: string,
  rangeSeconds: number,
  options: WindowedTrendOptions = {},
): Promise<CoverageTrendPoint[]> {
  let rightEdge = options.rightEdge;
  if (rightEdge === undefined) {
    const own = await getOwnLatestTimestamp(db, projectId, branch, category);
    if (own === null) return [];
    rightEdge = own;
  }

  const windowStart = rightEdge - rangeSeconds;
  const subDay = rangeSeconds < SUB_DAY_THRESHOLD_SECONDS;

  let rows: WindowRow[];
  let anchor: WindowRow | null;
  let earliest: WindowRow | null = null;

  if (subDay) {
    rows = await subDayInWindowRows(db, projectId, branch, category, windowStart, rightEdge);
    anchor = await subDayAnchorRow(db, projectId, branch, category, windowStart);
    if (!anchor) earliest = rows[0] ?? (await subDayEarliestRow(db, projectId, branch, category));
  } else {
    const windowStartDay = dayString(windowStart);
    const rightEdgeDay = dayString(rightEdge);
    rows = await dayInWindowRows(db, projectId, branch, category, windowStartDay, rightEdgeDay);
    anchor = await dayAnchorRow(db, projectId, branch, category, windowStartDay);
    if (!anchor) earliest = rows[0] ?? (await dayEarliestRow(db, projectId, branch, category));
  }

  if (!anchor && !earliest) return [];

  const anchorValue = (anchor ?? earliest)!;
  const anchorRecordedAt = subDay ? epochToIso(windowStart) : dayString(windowStart);

  const points: CoverageTrendPoint[] = [];
  if (rows.length === 0 || rows[0].recorded_at !== anchorRecordedAt) {
    points.push({ ...anchorValue, recorded_at: anchorRecordedAt, synthetic: true });
  }
  points.push(...rows);

  if (options.forwardCarry && points.length > 0) {
    const rightEdgeRecordedAt = subDay ? epochToIso(rightEdge) : dayString(rightEdge);
    const last = points[points.length - 1];
    if (last.recorded_at !== rightEdgeRecordedAt) {
      points.push({ ...last, recorded_at: rightEdgeRecordedAt, synthetic: true });
    }
  }

  return points;
}

async function getProjectCategories(
  db: D1Database,
  projectId: number,
  branch: string,
): Promise<string[]> {
  const { results } = await db
    .prepare(
      `SELECT DISTINCT category FROM (
         SELECT category FROM coverage_runs WHERE project_id = ?1 AND branch = ?2
         UNION
         SELECT category FROM coverage_daily WHERE project_id = ?1
       )
       ORDER BY category ASC`,
    )
    .bind(projectId, branch)
    .all<{ category: string }>();
  return results.map((r) => r.category);
}

/**
 * Windowed + edge-anchored trend for every category with data on this project/branch.
 * When `align` is true (list-page overlay), all categories share one right edge — the
 * max of each category's own latest point — and a stale category's line is forward-carried
 * to that shared edge so every series spans the identical domain.
 */
export async function getCoverageTrendGroupedWindowed(
  db: D1Database,
  projectId: number,
  branch: string,
  rangeSeconds: number,
  align: boolean = false,
): Promise<CoverageTrendPointWithCategory[]> {
  const categories = await getProjectCategories(db, projectId, branch);
  if (categories.length === 0) return [];

  let sharedRightEdge: number | undefined;
  if (align) {
    const edges = await Promise.all(
      categories.map((c) => getOwnLatestTimestamp(db, projectId, branch, c)),
    );
    const known = edges.filter((e): e is number => e !== null);
    if (known.length === 0) return [];
    sharedRightEdge = Math.max(...known);
  }

  const perCategory = await Promise.all(
    categories.map(async (category) => {
      const points = await getCoverageTrendWindowed(db, projectId, branch, category, rangeSeconds, {
        rightEdge: sharedRightEdge,
        forwardCarry: align,
      });
      return points.map((p) => ({ ...p, category }));
    }),
  );

  return perCategory.flat();
}
