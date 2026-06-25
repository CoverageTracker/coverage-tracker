-- Typed-column coverage schema — replaces EAV metrics table for new ingest.
-- The metrics table is preserved for backward-compatibility; new data writes here.

CREATE TABLE IF NOT EXISTS coverage_runs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id      INTEGER NOT NULL,
  commit_sha      TEXT    NOT NULL,
  branch          TEXT    NOT NULL,
  ran_at          INTEGER NOT NULL,   -- unix epoch seconds
  line_coverage   REAL    NOT NULL,
  branch_coverage REAL,
  cyclomatic      REAL,
  cognitive       REAL,
  duplication_pct REAL,
  maintainability REAL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- Upsert guard: re-ingesting the same commit is an idempotent update
CREATE UNIQUE INDEX IF NOT EXISTS idx_runs_project_commit
  ON coverage_runs (project_id, commit_sha);

CREATE INDEX IF NOT EXISTS idx_runs_project_time
  ON coverage_runs (project_id, branch, ran_at);

-- Daily rollup: one row per (project, day) — populated by the cron job
CREATE TABLE IF NOT EXISTS coverage_daily (
  project_id      INTEGER NOT NULL,
  day             TEXT    NOT NULL,   -- YYYY-MM-DD
  line_coverage   REAL    NOT NULL,
  branch_coverage REAL,
  cyclomatic      REAL,
  cognitive       REAL,
  duplication_pct REAL,
  maintainability REAL,
  run_count       INTEGER NOT NULL,
  PRIMARY KEY (project_id, day),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
