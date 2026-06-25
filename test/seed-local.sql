-- Local development seed data.
-- Run with: npm run db:seed:local
-- Safe to re-run (INSERT OR IGNORE / ON CONFLICT DO NOTHING).

INSERT OR IGNORE INTO owners (id, github_id, login, type, avatar_url)
VALUES (1, 1234567, 'ZeroStash', 'Organization', 'https://avatars.githubusercontent.com/u/1234567');

INSERT OR IGNORE INTO projects (id, owner_id, github_repo_id, repo_name, full_slug, installation_id, default_branch, badge_enabled)
VALUES (1, 1, 9876543, 'coverage-tracker', 'ZeroStash/coverage-tracker', 1, 'main', 1);

-- coverage_runs: 15 pushes over the past 2 weeks, rising from ~91% to 98%
INSERT OR IGNORE INTO coverage_runs
  (project_id, commit_sha, branch, ran_at, line_coverage, duplication_pct)
VALUES
  (1, 'aaa0001', 'main', strftime('%s', 'now', '-14 days'), 91.2, 0.0),
  (1, 'aaa0002', 'main', strftime('%s', 'now', '-13 days'), 91.8, 0.0),
  (1, 'aaa0003', 'main', strftime('%s', 'now', '-12 days'), 92.5, 0.0),
  (1, 'aaa0004', 'main', strftime('%s', 'now', '-11 days'), 91.9, 0.0),
  (1, 'aaa0005', 'main', strftime('%s', 'now', '-10 days'), 93.1, 0.0),
  (1, 'aaa0006', 'main', strftime('%s', 'now', '-9 days'),  94.0, 0.0),
  (1, 'aaa0007', 'main', strftime('%s', 'now', '-8 days'),  94.4, 0.0),
  (1, 'aaa0008', 'main', strftime('%s', 'now', '-7 days'),  95.2, 0.0),
  (1, 'aaa0009', 'main', strftime('%s', 'now', '-6 days'),  95.0, 0.0),
  (1, 'aaa0010', 'main', strftime('%s', 'now', '-5 days'),  96.1, 0.0),
  (1, 'aaa0011', 'main', strftime('%s', 'now', '-4 days'),  96.8, 0.0),
  (1, 'aaa0012', 'main', strftime('%s', 'now', '-3 days'),  97.3, 0.0),
  (1, 'aaa0013', 'main', strftime('%s', 'now', '-2 days'),  97.5, 0.0),
  (1, 'aaa0014', 'main', strftime('%s', 'now', '-1 day'),   98.0, 0.0),
  (1, 'aaa0015', 'main', strftime('%s', 'now'),             98.1, 0.0);
