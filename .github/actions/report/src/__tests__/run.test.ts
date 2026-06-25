import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as core from '@actions/core';
import * as fs from 'fs';
import { run, runIngest, runPRCheck, postCheckRun, type Metric, type ThresholdResult } from '../run.js';
// Pure helper tests still live here too
import { parseThreshold, thresholdConfigured, formatValue, formatDelta, buildSummary } from '../run.js';

// ── Hoisted mutable state for module mocks ────────────────────────────────────
// vi.hoisted runs during the hoisting phase so these variables are available
// inside the vi.mock factory functions below.
const { mockPayload, mockChecksCreate } = vi.hoisted(() => ({
  mockPayload: {} as Record<string, unknown>,
  mockChecksCreate: vi.fn(),
}));

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('@actions/core', () => ({
  setFailed: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
  getIDToken: vi.fn(),
}));

vi.mock('@actions/github', () => ({
  context: {
    // payload is a live reference to the mutable mockPayload object so that
    // individual tests can set/clear properties without re-importing the module.
    get payload() {
      return mockPayload;
    },
    sha: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
  },
  getOctokit: vi.fn(() => ({
    rest: { checks: { create: mockChecksCreate } },
  })),
}));

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ── Fixture helpers ───────────────────────────────────────────────────────────

const METRICS_ONE = JSON.stringify({ metrics: [{ name: 'coverage', value: 85, unit: '%' }] });
const METRICS_EMPTY = JSON.stringify({ metrics: [] });

function okFetchResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(''),
  };
}

function errFetchResponse(status: number, body = '') {
  return {
    ok: false,
    status,
    json: vi.fn().mockResolvedValue({}),
    text: vi.fn().mockResolvedValue(body),
  };
}

// ── Pure helper tests (kept alongside I/O tests) ─────────────────────────────

describe('parseThreshold', () => {
  it('returns null for undefined', () => expect(parseThreshold(undefined)).toBeNull());
  it('returns null for empty string', () => expect(parseThreshold('')).toBeNull());
  it('returns null for whitespace-only string', () => expect(parseThreshold('  ')).toBeNull());
  it('parses an integer string', () => expect(parseThreshold('80')).toBe(80));
  it('parses a decimal string', () => expect(parseThreshold('80.5')).toBe(80.5));
  it('returns null for a non-numeric string', () => expect(parseThreshold('abc')).toBeNull());
  it('parses zero', () => expect(parseThreshold('0')).toBe(0));
});

describe('thresholdConfigured', () => {
  it('returns true for coverage when minCoverage is set', () =>
    expect(thresholdConfigured('coverage', 80, null, null, null)).toBe(true));
  it('returns true for coverage when maxCoverageDrop is set', () =>
    expect(thresholdConfigured('coverage', null, 5, null, null)).toBe(true));
  it('returns false for coverage when both coverage thresholds are null', () =>
    expect(thresholdConfigured('coverage', null, null, null, null)).toBe(false));
  it('returns true for complexity when maxComplexity is set', () =>
    expect(thresholdConfigured('complexity', null, null, 10, null)).toBe(true));
  it('returns false for complexity when maxComplexity is null', () =>
    expect(thresholdConfigured('complexity', null, null, null, null)).toBe(false));
  it('returns true for duplication when maxDuplication is set', () =>
    expect(thresholdConfigured('duplication', null, null, null, 5)).toBe(true));
  it('returns false for duplication when maxDuplication is null', () =>
    expect(thresholdConfigured('duplication', null, null, null, null)).toBe(false));
  it('returns false for an unknown metric name', () =>
    expect(thresholdConfigured('unknown', 80, 5, 10, 5)).toBe(false));
});

describe('formatValue', () => {
  it('formats a percentage to one decimal place', () =>
    expect(formatValue(82.4, '%')).toBe('82.4%'));
  it('formats a score to two decimal places', () =>
    expect(formatValue(4.2, 'score')).toBe('4.20'));
  it('formats 100% correctly', () => expect(formatValue(100, '%')).toBe('100.0%'));
  it('formats an integer score to two decimal places', () =>
    expect(formatValue(5, 'score')).toBe('5.00'));
});

describe('formatDelta', () => {
  it('adds a + prefix for a positive percentage delta', () =>
    expect(formatDelta(1.5, '%')).toBe('+1.5%'));
  it('uses no extra prefix for a negative percentage delta', () =>
    expect(formatDelta(-1.5, '%')).toBe('-1.5%'));
  it('uses no + prefix for zero delta', () => expect(formatDelta(0, '%')).toBe('0.0%'));
  it('formats a positive score delta to two decimal places', () =>
    expect(formatDelta(1.5, 'score')).toBe('+1.50'));
  it('formats a negative score delta to two decimal places', () =>
    expect(formatDelta(-1.5, 'score')).toBe('-1.50'));
});

describe('buildSummary', () => {
  const pass: ThresholdResult = {
    metric: 'coverage', current: 85, baseline: 80, unit: '%', status: 'pass', reason: '',
  };
  const fail: ThresholdResult = {
    metric: 'complexity', current: 12, baseline: 8, unit: 'score', status: 'fail',
    reason: 'exceeds max-complexity of 10',
  };
  const info: ThresholdResult = {
    metric: 'duplication', current: 2.5, baseline: null, unit: '%', status: 'info', reason: '',
  };

  it('contains the markdown table header', () => {
    expect(buildSummary([pass])).toContain('| Metric | Current | Baseline | Change | Status |');
  });
  it('shows ✅ for a passing result', () => expect(buildSummary([pass])).toContain('✅'));
  it('shows ❌ and the reason for a failing result', () => {
    const out = buildSummary([fail]);
    expect(out).toContain('❌');
    expect(out).toContain('exceeds max-complexity of 10');
  });
  it('shows ℹ️ for an info result', () => expect(buildSummary([info])).toContain('ℹ️'));
  it('uses — for baseline and change when baseline is null', () => {
    expect(buildSummary([info])).toContain('| — | — |');
  });
  it('handles multiple results in one table', () => {
    const out = buildSummary([pass, fail, info]);
    expect(out).toContain('coverage');
    expect(out).toContain('complexity');
    expect(out).toContain('duplication');
  });
});

// ── run() ─────────────────────────────────────────────────────────────────────

describe('run()', () => {
  beforeEach(() => {
    vi.mocked(core.getIDToken).mockResolvedValue('mock-oidc-token');
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(METRICS_ONE as unknown as Buffer);
    mockPayload.repository = { default_branch: 'main' };
    mockChecksCreate.mockResolvedValue({});
    mockFetch.mockResolvedValue(okFetchResponse({ ok: true, inserted: 1 }));
    vi.stubEnv('WORKER_URL', 'https://worker.example.com');
    vi.stubEnv('METRICS_FILE', '/tmp/metrics.json');
    vi.stubEnv('GITHUB_EVENT_NAME', 'push');
    vi.stubEnv('GITHUB_REF_NAME', 'main');
    vi.stubEnv('GITHUB_REPOSITORY', 'owner/repo');
    vi.stubEnv('GITHUB_TOKEN', 'ghs_mock');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    for (const k of Object.keys(mockPayload)) delete mockPayload[k];
  });

  it('calls setFailed when WORKER_URL is not set', async () => {
    vi.stubEnv('WORKER_URL', '');
    await run();
    expect(vi.mocked(core.setFailed)).toHaveBeenCalledWith('WORKER_URL is not set.');
  });

  it('calls setFailed when METRICS_FILE does not exist', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    await run();
    expect(vi.mocked(core.setFailed)).toHaveBeenCalledWith(
      expect.stringContaining('Metrics file not found'),
    );
  });

  it('warns and returns early when metrics array is empty', async () => {
    vi.mocked(fs.readFileSync).mockReturnValue(METRICS_EMPTY as unknown as Buffer);
    await run();
    expect(vi.mocked(core.warning)).toHaveBeenCalledWith(
      'No metrics collected — skipping report.',
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('skips ingest on a non-default branch push', async () => {
    vi.stubEnv('GITHUB_REF_NAME', 'feature/my-branch');
    await run();
    expect(vi.mocked(core.info)).toHaveBeenCalledWith(
      expect.stringContaining('Not on default branch'),
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('warns and returns when OIDC token cannot be minted', async () => {
    vi.mocked(core.getIDToken).mockRejectedValue(new Error('OIDC unavailable'));
    await run();
    expect(vi.mocked(core.warning)).toHaveBeenCalledWith(
      expect.stringContaining('Could not mint OIDC token'),
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('calls /api/ci/coverage on a push to the default branch', async () => {
    await run();
    expect(mockFetch).toHaveBeenCalledWith(
      'https://worker.example.com/api/ci/coverage',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('calls the baseline endpoint on a pull_request event', async () => {
    vi.stubEnv('GITHUB_EVENT_NAME', 'pull_request');
    mockPayload.pull_request = { head: { sha: 'pr-head-sha' } };
    mockFetch.mockResolvedValue(errFetchResponse(404));
    await run();
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/baseline/owner/repo'),
      expect.any(Object),
    );
  });
});

// ── runIngest() ───────────────────────────────────────────────────────────────

describe('runIngest()', () => {
  const metrics: Metric[] = [
    { name: 'coverage', value: 85, unit: '%' },
    { name: 'duplication', value: 0, unit: '%' },
  ];

  afterEach(() => vi.clearAllMocks());

  it('calls core.info with a success message on 2xx', async () => {
    mockFetch.mockResolvedValue(okFetchResponse({}));
    await runIngest('https://worker.example.com', 'mock-token', metrics);
    expect(vi.mocked(core.info)).toHaveBeenCalledWith('Coverage report submitted.');
  });

  it('calls core.setFailed on a non-OK HTTP response', async () => {
    mockFetch.mockResolvedValue(errFetchResponse(422, 'Unprocessable entity'));
    await runIngest('https://worker.example.com', 'mock-token', metrics);
    expect(vi.mocked(core.setFailed)).toHaveBeenCalledWith(
      expect.stringContaining('HTTP 422'),
    );
  });

  it('sends typed coverage fields (not a metrics array) in the request body', async () => {
    mockFetch.mockResolvedValue(okFetchResponse({}));
    await runIngest('https://worker.example.com', 'mock-token', metrics);
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    // coverage → line_coverage, duplication → duplication_pct
    expect(body).toEqual({ line_coverage: 85, duplication_pct: 0 });
    expect(body).not.toHaveProperty('metrics');
    expect(body).not.toHaveProperty('repository');
  });
});

// ── runPRCheck() ──────────────────────────────────────────────────────────────

describe('runPRCheck()', () => {
  const WORKER = 'https://worker.example.com';
  const TOKEN = 'mock-oidc';
  const coverageMetric: Metric[] = [{ name: 'coverage', value: 75, unit: '%' }];

  beforeEach(() => {
    vi.stubEnv('MIN_COVERAGE', '');
    vi.stubEnv('MAX_COVERAGE_DROP', '');
    vi.stubEnv('MAX_COMPLEXITY', '');
    vi.stubEnv('MAX_DUPLICATION', '');
    vi.stubEnv('GITHUB_TOKEN', 'ghs_mock');
    mockChecksCreate.mockResolvedValue({});
    mockPayload.pull_request = { head: { sha: 'pr-head-sha' } };
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    for (const k of Object.keys(mockPayload)) delete mockPayload[k];
  });

  it('posts a success Check Run when no thresholds are configured', async () => {
    mockFetch.mockResolvedValue(errFetchResponse(404)); // no baseline
    await runPRCheck(WORKER, TOKEN, coverageMetric, 'owner', 'repo');
    expect(mockChecksCreate).toHaveBeenCalledWith(
      expect.objectContaining({ conclusion: 'success' }),
    );
    expect(vi.mocked(core.setFailed)).not.toHaveBeenCalled();
  });

  it('posts a failure Check Run when coverage is below min-coverage', async () => {
    vi.stubEnv('MIN_COVERAGE', '80'); // 75 < 80
    mockFetch.mockResolvedValue(errFetchResponse(404));
    await runPRCheck(WORKER, TOKEN, coverageMetric, 'owner', 'repo');
    expect(mockChecksCreate).toHaveBeenCalledWith(
      expect.objectContaining({ conclusion: 'failure' }),
    );
    expect(vi.mocked(core.setFailed)).toHaveBeenCalledWith(
      'One or more coverage thresholds were not met.',
    );
  });

  it('fails when coverage drop exceeds max-coverage-drop', async () => {
    vi.stubEnv('MAX_COVERAGE_DROP', '3'); // baseline=80, current=75, drop=5 > 3
    mockFetch.mockResolvedValue(
      okFetchResponse({ value: 80, unit: '%', commit_sha: 'abc' }),
    );
    await runPRCheck(WORKER, TOKEN, coverageMetric, 'owner', 'repo');
    expect(vi.mocked(core.setFailed)).toHaveBeenCalled();
  });

  it('passes when coverage drop is within max-coverage-drop', async () => {
    vi.stubEnv('MAX_COVERAGE_DROP', '10'); // baseline=80, current=75, drop=5 <= 10
    mockFetch.mockResolvedValue(
      okFetchResponse({ value: 80, unit: '%', commit_sha: 'abc' }),
    );
    await runPRCheck(WORKER, TOKEN, coverageMetric, 'owner', 'repo');
    expect(vi.mocked(core.setFailed)).not.toHaveBeenCalled();
  });

  it('fails when complexity exceeds max-complexity', async () => {
    vi.stubEnv('MAX_COMPLEXITY', '10'); // current=15 > 10
    mockFetch.mockResolvedValue(errFetchResponse(404));
    await runPRCheck(WORKER, TOKEN, [{ name: 'complexity', value: 15, unit: 'score' }], 'owner', 'repo');
    expect(vi.mocked(core.setFailed)).toHaveBeenCalled();
  });

  it('fails when duplication exceeds max-duplication', async () => {
    vi.stubEnv('MAX_DUPLICATION', '5'); // current=8 > 5
    mockFetch.mockResolvedValue(errFetchResponse(404));
    await runPRCheck(WORKER, TOKEN, [{ name: 'duplication', value: 8, unit: '%' }], 'owner', 'repo');
    expect(vi.mocked(core.setFailed)).toHaveBeenCalled();
  });

  it('warns but does not fail when GITHUB_TOKEN is missing', async () => {
    vi.stubEnv('GITHUB_TOKEN', '');
    mockFetch.mockResolvedValue(errFetchResponse(404));
    await runPRCheck(WORKER, TOKEN, coverageMetric, 'owner', 'repo');
    expect(vi.mocked(core.warning)).toHaveBeenCalledWith(
      expect.stringContaining('GITHUB_TOKEN not available'),
    );
    expect(mockChecksCreate).not.toHaveBeenCalled();
    expect(vi.mocked(core.setFailed)).not.toHaveBeenCalled();
  });

  it('warns when a baseline fetch returns an unexpected error status', async () => {
    mockFetch.mockResolvedValue(errFetchResponse(500));
    await runPRCheck(WORKER, TOKEN, coverageMetric, 'owner', 'repo');
    expect(vi.mocked(core.warning)).toHaveBeenCalledWith(
      expect.stringContaining('Baseline fetch for "coverage" returned HTTP 500'),
    );
  });
});

// ── postCheckRun() ────────────────────────────────────────────────────────────

describe('postCheckRun()', () => {
  const results: ThresholdResult[] = [
    { metric: 'coverage', current: 85, baseline: 80, unit: '%', status: 'pass', reason: '' },
  ];

  beforeEach(() => {
    mockChecksCreate.mockResolvedValue({});
    mockPayload.pull_request = { head: { sha: 'pr-head-sha' } };
  });

  afterEach(() => {
    vi.clearAllMocks();
    for (const k of Object.keys(mockPayload)) delete mockPayload[k];
  });

  it('creates a success Check Run and logs it', async () => {
    await postCheckRun('ghs_mock', 'owner', 'repo', results, false);
    expect(mockChecksCreate).toHaveBeenCalledWith(
      expect.objectContaining({ conclusion: 'success', name: 'Coverage Tracker' }),
    );
    expect(vi.mocked(core.info)).toHaveBeenCalledWith('Check Run posted: success');
  });

  it('creates a failure Check Run when failed=true', async () => {
    await postCheckRun('ghs_mock', 'owner', 'repo', results, true);
    expect(mockChecksCreate).toHaveBeenCalledWith(
      expect.objectContaining({ conclusion: 'failure' }),
    );
    expect(vi.mocked(core.info)).toHaveBeenCalledWith('Check Run posted: failure');
  });

  it('uses the PR head SHA, not the context sha', async () => {
    mockPayload.pull_request = { head: { sha: 'pr-specific-sha' } };
    await postCheckRun('ghs_mock', 'owner', 'repo', results, false);
    expect(mockChecksCreate).toHaveBeenCalledWith(
      expect.objectContaining({ head_sha: 'pr-specific-sha' }),
    );
  });

  it('warns instead of failing when the Check Run post throws (fork PR)', async () => {
    mockChecksCreate.mockRejectedValue(new Error('Resource not accessible by integration'));
    await postCheckRun('ghs_mock', 'owner', 'repo', results, false);
    expect(vi.mocked(core.warning)).toHaveBeenCalledWith(
      expect.stringContaining('Could not post Check Run'),
    );
    expect(vi.mocked(core.setFailed)).not.toHaveBeenCalled();
  });
});
