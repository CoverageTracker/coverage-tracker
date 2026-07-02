// Report-path resolution: explicit input always wins; otherwise probe the
// documented default paths in a fixed order and use the first hit.
//
// Fail-vs-skip rule (Plan A, Phase 1):
//   - Coverage: always required. Missing → fail with the full probed-path list.
//   - Complexity / duplication: optional. Missing → fail ONLY if the matching
//     threshold (max-complexity / max-duplication) is configured; otherwise
//     skip silently.
//   - An explicit -path that does not exist is always a hard failure.

import * as fs from 'fs';

export const DOCS_URL =
  'https://github.com/CoverageTracker/coverage-tracker/blob/main/docs/generating-coverage-reports.md';

/** Coverage probe order — first hit wins. */
export const COVERAGE_PROBES = [
  'coverage.out', // go tool cover
  'coverage/lcov.info', // Istanbul/vitest/jest, SimpleCov, Dart/Flutter
  'lcov.info', // cargo-llvm-cov, hpc-codecov
  'coverage.lcov', // coverage.py, gcovr, perl2lcov
  'coverage.info', // coverlet
  'cover/lcov.info', // ExCoveralls
  'target/coverage/lcov.info', // Cloverage
  'target/site/jacoco/jacoco.xml', // JaCoCo (Maven)
  'build/reports/jacoco/test/jacocoTestReport.xml', // JaCoCo (Gradle)
  'coverage.xml', // PHPUnit (Cobertura)
  'luacov.report.out', // LuaCov lcov reporter
];

/** Complexity probe order — native tool beats Lizard. */
export const COMPLEXITY_PROBES = ['radon.json', 'gocyclo.txt', 'lizard-report.xml'];

/** Duplication probe (single default path). */
export const DUPLICATION_PROBES = ['jscpd-report/jscpd-report.json'];

type Exists = (path: string) => boolean;

const defaultExists: Exists = (p) => fs.existsSync(p);

function probe(probes: string[], exists: Exists): string | null {
  for (const p of probes) {
    if (exists(p)) return p;
  }
  return null;
}

/**
 * Resolve the coverage report path. Always required.
 * @throws if an explicit path is missing, or if probing finds nothing.
 */
export function resolveCoveragePath(input: string | undefined, exists: Exists = defaultExists): string {
  const trimmed = input?.trim();
  if (trimmed) {
    if (!exists(trimmed)) {
      throw new Error(`coverage-path "${trimmed}" was set but the file does not exist.`);
    }
    return trimmed;
  }

  const hit = probe(COVERAGE_PROBES, exists);
  if (hit) return hit;

  throw new Error(
    'No coverage report found. Set the `coverage-path` input, or write your ' +
      'report to one of the auto-detected default paths:\n' +
      COVERAGE_PROBES.map((p) => `  - ${p}`).join('\n') +
      `\nSee ${DOCS_URL}`,
  );
}

/**
 * Resolve an optional report path (complexity or duplication).
 * @returns the path, or null when nothing is found and no threshold requires it.
 * @throws if an explicit path is missing, or if a threshold is configured but
 *         no report is found.
 */
export function resolveOptionalPath(opts: {
  input: string | undefined;
  probes: string[];
  thresholdConfigured: boolean;
  kind: string; // e.g. 'complexity'
  thresholdInputName: string; // e.g. 'max-complexity'
  exists?: Exists;
}): string | null {
  const { input, probes, thresholdConfigured, kind, thresholdInputName } = opts;
  const exists = opts.exists ?? defaultExists;

  const trimmed = input?.trim();
  if (trimmed) {
    if (!exists(trimmed)) {
      throw new Error(`${kind}-path "${trimmed}" was set but the file does not exist.`);
    }
    return trimmed;
  }

  const hit = probe(probes, exists);
  if (hit) return hit;

  if (thresholdConfigured) {
    throw new Error(
      `${thresholdInputName} is configured but no ${kind} report was found. ` +
        `Set the \`${kind}-path\` input, or write your report to one of:\n` +
        probes.map((p) => `  - ${p}`).join('\n') +
        `\nSee ${DOCS_URL}`,
    );
  }

  return null;
}
