import * as core from '@actions/core';
import * as github from '@actions/github';
import * as fs from 'fs';

export interface Metric {
  name: string;
  value: number;
  unit: string;
}

interface MetricsFile {
  metrics: Metric[];
}

interface BaselineResponse {
  value: number;
  unit: string;
  commit_sha: string;
}

export interface ThresholdResult {
  metric: string;
  current: number;
  baseline: number | null;
  unit: string;
  status: 'pass' | 'fail' | 'info';
  reason: string;
}

/** Maps metrics-file metric names to typed fields in the new /api/ci/coverage payload. */
const METRIC_TO_FIELD: Record<string, string> = {
  coverage: 'line_coverage',
  branch_coverage: 'branch_coverage',
  complexity: 'cyclomatic',
  cyclomatic: 'cyclomatic',
  cognitive: 'cognitive',
  duplication: 'duplication_pct',
  maintainability: 'maintainability',
};

export async function run(): Promise<void> {
  const workerUrl = (process.env.WORKER_URL ?? '').replace(/\/$/, '');
  const metricsFile = process.env.METRICS_FILE ?? '';

  if (!workerUrl) {
    core.setFailed('WORKER_URL is not set.');
    return;
  }

  if (!metricsFile || !fs.existsSync(metricsFile)) {
    core.setFailed(`Metrics file not found: ${metricsFile}`);
    return;
  }

  const { metrics }: MetricsFile = JSON.parse(fs.readFileSync(metricsFile, 'utf8'));

  if (metrics.length === 0) {
    core.warning('No metrics collected — skipping report.');
    return;
  }

  core.info(`Reporting ${metrics.length} metric(s): ${metrics.map((m) => m.name).join(', ')}`);

  const eventName = process.env.GITHUB_EVENT_NAME ?? '';
  const isPR = eventName === 'pull_request' || eventName === 'pull_request_target';

  // Non-default branch pushes are expected — the Worker only persists default-branch data.
  // Skip before the token mint to avoid a 422 that would fail the job.
  if (!isPR) {
    const defaultBranch = (
      github.context.payload as { repository?: { default_branch?: string } }
    ).repository?.default_branch;
    const currentBranch = process.env.GITHUB_REF_NAME ?? '';
    if (defaultBranch && currentBranch !== defaultBranch) {
      core.info(`Not on default branch (${currentBranch} ≠ ${defaultBranch}) — skipping ingest.`);
      return;
    }
  }

  // Mint OIDC token with the fixed audience expected by the Worker (Appendix B.1)
  let oidcToken: string;
  if (!process.env.ACTIONS_ID_TOKEN_REQUEST_URL) {
    // ACTIONS_ID_TOKEN_REQUEST_URL is only set when id-token: write is granted.
    // Fork pull_requests are silently denied this permission by GitHub; non-fork
    // workflows simply need to add the permission to the job block.
    if (isPR) {
      core.warning(
        'OIDC token unavailable (ACTIONS_ID_TOKEN_REQUEST_URL not set). ' +
          'For fork pull requests this is a GitHub platform restriction. ' +
          'For non-fork workflows, add `id-token: write` to the job permissions. Skipping report.',
      );
    } else {
      core.setFailed(
        'OIDC token unavailable (ACTIONS_ID_TOKEN_REQUEST_URL not set). ' +
          'Add `id-token: write` to the job permissions block.',
      );
    }
    return;
  }
  try {
    oidcToken = await core.getIDToken('coverage-tracker');
  } catch (err) {
    core.warning(
      `Could not mint OIDC token (${err}). ` +
        'This is expected for fork pull requests. Skipping report.',
    );
    return;
  }

  if (isPR) {
    const [owner, repo] = (process.env.GITHUB_REPOSITORY ?? '').split('/');
    await runPRCheck(workerUrl, oidcToken, metrics, owner, repo);
  } else {
    await runIngest(workerUrl, oidcToken, metrics);
  }
}

// ── Push path: ingest metrics ─────────────────────────────────────────────

export async function runIngest(workerUrl: string, oidcToken: string, metrics: Metric[]): Promise<void> {
  // Map legacy metrics array to typed coverage fields
  const body: Record<string, number> = {};
  for (const m of metrics) {
    const field = METRIC_TO_FIELD[m.name];
    if (field) body[field] = m.value;
  }

  const res = await fetch(`${workerUrl}/api/ci/coverage`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${oidcToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    core.setFailed(`Ingest failed (HTTP ${res.status}): ${text}`);
    return;
  }

  core.info('Coverage report submitted.');
}

// ── PR path: fetch baselines, check thresholds, post Check Run ─────────────

export async function runPRCheck(
  workerUrl: string,
  oidcToken: string,
  metrics: Metric[],
  owner: string,
  repo: string,
): Promise<void> {
  const minCoverage = parseThreshold(process.env.MIN_COVERAGE);
  const maxCoverageDrop = parseThreshold(process.env.MAX_COVERAGE_DROP);
  const maxComplexity = parseThreshold(process.env.MAX_COMPLEXITY);
  const maxDuplication = parseThreshold(process.env.MAX_DUPLICATION);

  // Fetch baselines for all collected metrics
  const baselines: Record<string, number> = {};
  for (const m of metrics) {
    const url = `${workerUrl}/api/baseline/${owner}/${repo}?metric=${encodeURIComponent(m.name)}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${oidcToken}` } });
    if (res.ok) {
      try {
        const data = (await res.json()) as BaselineResponse;
        baselines[m.name] = data.value;
      } catch {
        core.warning(`Baseline fetch for "${m.name}" returned non-JSON body (HTTP ${res.status}) — skipping baseline.`);
      }
    } else if (res.status !== 404) {
      core.warning(`Baseline fetch for "${m.name}" returned HTTP ${res.status}.`);
    }
  }

  // Evaluate thresholds
  const results: ThresholdResult[] = [];
  let anyFailed = false;

  for (const m of metrics) {
    const baseline = baselines[m.name] ?? null;
    const reasons: string[] = [];

    if (m.name === 'coverage') {
      if (minCoverage !== null && m.value < minCoverage) {
        reasons.push(`below min-coverage of ${minCoverage}${m.unit}`);
      }
      if (maxCoverageDrop !== null && baseline !== null) {
        const drop = baseline - m.value;
        if (drop > maxCoverageDrop) {
          reasons.push(
            `dropped ${drop.toFixed(1)}${m.unit} from baseline (max allowed: ${maxCoverageDrop}${m.unit})`,
          );
        }
      }
    }

    if (m.name === 'complexity' && maxComplexity !== null && m.value > maxComplexity) {
      reasons.push(`exceeds max-complexity of ${maxComplexity}`);
    }

    if (m.name === 'duplication' && maxDuplication !== null && m.value > maxDuplication) {
      reasons.push(`exceeds max-duplication of ${maxDuplication}${m.unit}`);
    }

    const failed = reasons.length > 0;
    if (failed) anyFailed = true;

    const hasThreshold = thresholdConfigured(m.name, minCoverage, maxCoverageDrop, maxComplexity, maxDuplication);

    results.push({
      metric: m.name,
      current: m.value,
      baseline,
      unit: m.unit,
      status: failed ? 'fail' : hasThreshold ? 'pass' : 'info',
      reason: reasons.join('; '),
    });
  }

  // Post Check Run using GITHUB_TOKEN (Option A — Appendix B.3)
  const githubToken = process.env.GITHUB_TOKEN ?? '';
  if (githubToken) {
    await postCheckRun(githubToken, owner, repo, results, anyFailed);
  } else {
    core.warning('GITHUB_TOKEN not available — cannot post Check Run.');
  }

  if (anyFailed) {
    core.setFailed('One or more coverage thresholds were not met.');
  }
}

export async function postCheckRun(
  githubToken: string,
  owner: string,
  repo: string,
  results: ThresholdResult[],
  failed: boolean,
): Promise<void> {
  const octokit = github.getOctokit(githubToken);

  // Use the PR head SHA, not the synthetic merge-commit SHA
  const headSha =
    (github.context.payload as { pull_request?: { head?: { sha?: string } } }).pull_request?.head
      ?.sha ?? github.context.sha;

  const summary = buildSummary(results);
  const conclusion = failed ? 'failure' : 'success';
  const title = failed ? 'Coverage thresholds not met' : 'All coverage thresholds passed';

  try {
    await octokit.rest.checks.create({
      owner,
      repo,
      name: 'Coverage Tracker',
      head_sha: headSha,
      status: 'completed',
      conclusion,
      output: { title, summary },
    });
    core.info(`Check Run posted: ${conclusion}`);
  } catch (err) {
    // Fork PRs have read-only GITHUB_TOKEN — degrade gracefully (Appendix B.3)
    core.warning(`Could not post Check Run (fork PR?): ${err}`);
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

export function parseThreshold(raw: string | undefined): number | null {
  if (!raw || raw.trim() === '') return null;
  const n = parseFloat(raw);
  return isNaN(n) ? null : n;
}

export function thresholdConfigured(
  name: string,
  minCoverage: number | null,
  maxCoverageDrop: number | null,
  maxComplexity: number | null,
  maxDuplication: number | null,
): boolean {
  if (name === 'coverage') return minCoverage !== null || maxCoverageDrop !== null;
  if (name === 'complexity') return maxComplexity !== null;
  if (name === 'duplication') return maxDuplication !== null;
  return false;
}

export function formatValue(value: number, unit: string): string {
  return unit === '%' ? `${value.toFixed(1)}%` : value.toFixed(2);
}

export function formatDelta(delta: number, unit: string): string {
  const sign = delta > 0 ? '+' : '';
  return unit === '%' ? `${sign}${delta.toFixed(1)}%` : `${sign}${delta.toFixed(2)}`;
}

export function buildSummary(results: ThresholdResult[]): string {
  const rows = results
    .map((r) => {
      const current = formatValue(r.current, r.unit);
      const baseline = r.baseline !== null ? formatValue(r.baseline, r.unit) : '—';
      const change = r.baseline !== null ? formatDelta(r.current - r.baseline, r.unit) : '—';
      const statusIcon =
        r.status === 'fail' ? `❌ ${r.reason}` : r.status === 'pass' ? '✅' : 'ℹ️ no threshold set';
      return `| ${r.metric} | ${current} | ${baseline} | ${change} | ${statusIcon} |`;
    })
    .join('\n');

  return [
    '## Coverage Tracker',
    '',
    '| Metric | Current | Baseline | Change | Status |',
    '|--------|---------|----------|--------|--------|',
    rows,
  ].join('\n');
}

if (require.main === module) {
  run().catch((err) => {
    core.setFailed(err instanceof Error ? err.message : String(err));
  });
}
