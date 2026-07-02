import { describe, it, expect } from 'vitest';
import {
  resolveCoveragePath,
  resolveOptionalPath,
  COVERAGE_PROBES,
  COMPLEXITY_PROBES,
  DUPLICATION_PROBES,
} from '../paths';

/** Build an `exists` predicate backed by a fixed set of present paths. */
const existsIn = (present: string[]) => (p: string) => present.includes(p);

describe('resolveCoveragePath', () => {
  it('returns an explicit path when it exists', () => {
    expect(resolveCoveragePath('custom/cov.info', existsIn(['custom/cov.info']))).toBe(
      'custom/cov.info',
    );
  });

  it('throws when an explicit path does not exist', () => {
    expect(() => resolveCoveragePath('missing.info', existsIn([]))).toThrow(/does not exist/);
  });

  it('probes defaults and returns the first hit in order', () => {
    // Both present; coverage.out (index 0) wins over coverage/lcov.info (index 1).
    expect(resolveCoveragePath(undefined, existsIn(['coverage/lcov.info', 'coverage.out']))).toBe(
      'coverage.out',
    );
  });

  it('honors probe order for a later-only hit', () => {
    expect(resolveCoveragePath(undefined, existsIn(['coverage.xml']))).toBe('coverage.xml');
  });

  it('fails listing every probed path when nothing is found', () => {
    try {
      resolveCoveragePath(undefined, existsIn([]));
      throw new Error('expected to throw');
    } catch (err) {
      const msg = (err as Error).message;
      for (const p of COVERAGE_PROBES) expect(msg).toContain(p);
      expect(msg).toContain('generating-coverage-reports');
    }
  });
});

describe('resolveOptionalPath — complexity precedence', () => {
  const call = (present: string[], thresholdConfigured = false) =>
    resolveOptionalPath({
      input: undefined,
      probes: COMPLEXITY_PROBES,
      thresholdConfigured,
      kind: 'complexity',
      thresholdInputName: 'max-complexity',
      exists: existsIn(present),
    });

  it('prefers radon.json over gocyclo.txt over lizard-report.xml', () => {
    expect(call(['gocyclo.txt', 'radon.json', 'lizard-report.xml'])).toBe('radon.json');
    expect(call(['gocyclo.txt', 'lizard-report.xml'])).toBe('gocyclo.txt');
    expect(call(['lizard-report.xml'])).toBe('lizard-report.xml');
  });

  it('returns null when nothing is found and no threshold is set', () => {
    expect(call([])).toBeNull();
  });

  it('fails when a threshold is set but no report is found', () => {
    expect(() => call([], true)).toThrow(/max-complexity is configured/);
  });
});

describe('resolveOptionalPath — duplication', () => {
  const call = (present: string[], thresholdConfigured = false) =>
    resolveOptionalPath({
      input: undefined,
      probes: DUPLICATION_PROBES,
      thresholdConfigured,
      kind: 'duplication',
      thresholdInputName: 'max-duplication',
      exists: existsIn(present),
    });

  it('skips silently when unconfigured and absent', () => {
    expect(call([])).toBeNull();
  });

  it('fails when max-duplication is set but the report is missing', () => {
    expect(() => call([], true)).toThrow(/max-duplication is configured/);
  });

  it('throws when an explicit path is missing regardless of threshold', () => {
    expect(() =>
      resolveOptionalPath({
        input: 'nope.json',
        probes: DUPLICATION_PROBES,
        thresholdConfigured: false,
        kind: 'duplication',
        thresholdInputName: 'max-duplication',
        exists: existsIn([]),
      }),
    ).toThrow(/does not exist/);
  });
});
