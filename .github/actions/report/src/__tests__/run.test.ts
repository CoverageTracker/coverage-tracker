import { describe, it, expect } from 'vitest';
import {
  parseThreshold,
  thresholdConfigured,
  formatValue,
  formatDelta,
  buildSummary,
  type ThresholdResult,
} from '../run.js';

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
    metric: 'coverage',
    current: 85,
    baseline: 80,
    unit: '%',
    status: 'pass',
    reason: '',
  };
  const fail: ThresholdResult = {
    metric: 'complexity',
    current: 12,
    baseline: 8,
    unit: 'score',
    status: 'fail',
    reason: 'exceeds max-complexity of 10',
  };
  const info: ThresholdResult = {
    metric: 'duplication',
    current: 2.5,
    baseline: null,
    unit: '%',
    status: 'info',
    reason: '',
  };

  it('contains the markdown table header', () => {
    const out = buildSummary([pass]);
    expect(out).toContain('| Metric | Current | Baseline | Change | Status |');
  });

  it('contains the table separator row', () => {
    const out = buildSummary([pass]);
    expect(out).toContain('|--------|---------|----------|--------|--------|');
  });

  it('shows ✅ for a passing result', () => expect(buildSummary([pass])).toContain('✅'));

  it('shows ❌ and the reason for a failing result', () => {
    const out = buildSummary([fail]);
    expect(out).toContain('❌');
    expect(out).toContain('exceeds max-complexity of 10');
  });

  it('shows ℹ️ for an info result', () => expect(buildSummary([info])).toContain('ℹ️'));

  it('uses — for baseline and change when baseline is null', () => {
    const out = buildSummary([info]);
    expect(out).toContain('| — | — |');
  });

  it('handles multiple results in one table', () => {
    const out = buildSummary([pass, fail, info]);
    expect(out).toContain('coverage');
    expect(out).toContain('complexity');
    expect(out).toContain('duplication');
  });
});
