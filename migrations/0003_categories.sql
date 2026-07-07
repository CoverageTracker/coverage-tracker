-- Adds `category`: a free-form identifier for independently tracked report
-- series within one project (e.g. "backend", "frontend"). Existing rows
-- predate categories entirely -> backfill 'default', preserving current
-- single-series behavior for every project that never opts in.

ALTER TABLE coverage_runs ADD COLUMN category TEXT NOT NULL DEFAULT 'default';

-- Re-key the idempotent-ingest guard: the same commit may now legitimately
-- post once per category.
DROP INDEX IF EXISTS idx_runs_project_commit;
CREATE UNIQUE INDEX idx_runs_project_commit
  ON coverage_runs (project_id, category, commit_sha);

-- Read paths filter on project_id + branch first (single-category reads add
-- category = ?, the grouped read ranges over category) — keep that as a
-- contiguous, index-backed prefix.
DROP INDEX IF EXISTS idx_runs_project_time;
CREATE INDEX idx_runs_project_time
  ON coverage_runs (project_id, branch, category, ran_at);

-- coverage_daily: SQLite can't ALTER a PRIMARY KEY in place — rebuild.
CREATE TABLE coverage_daily_new (
  project_id      INTEGER NOT NULL,
  category        TEXT    NOT NULL DEFAULT 'default',
  day             TEXT    NOT NULL,   -- YYYY-MM-DD
  line_coverage   REAL    NOT NULL,
  branch_coverage REAL,
  cyclomatic      REAL,
  cognitive       REAL,
  duplication_pct REAL,
  maintainability REAL,
  run_count       INTEGER NOT NULL,
  PRIMARY KEY (project_id, category, day),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

INSERT INTO coverage_daily_new
  (project_id, category, day, line_coverage, branch_coverage, cyclomatic, cognitive, duplication_pct, maintainability, run_count)
SELECT project_id, 'default', day, line_coverage, branch_coverage, cyclomatic, cognitive, duplication_pct, maintainability, run_count
FROM coverage_daily;

DROP TABLE coverage_daily;
ALTER TABLE coverage_daily_new RENAME TO coverage_daily;
