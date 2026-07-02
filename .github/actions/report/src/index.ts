// Entrypoint for the Coverage Tracker report action (node24).
//
// Replaces the old collect.sh composite step. Reads consumer-produced report
// files, parses coverage / complexity / duplication in-process, then hands the
// resulting metrics to the shared report flow in run.ts (branch/OIDC gating,
// threshold checks, Check Run, ingest POST — all unchanged).

import * as core from '@actions/core';
import * as fs from 'fs';

import { report, parseThreshold, type Metric } from './run';
import { sniffCoverageFormat, type CoverageResult } from './format';
import { parseLcov } from './lcov';
import { parseGoProfile } from './goprofile';
import { parseCobertura } from './cobertura';
import { parseJacoco } from './jacoco';
import { parseComplexity } from './complexity/detect';
import { parseJscpd } from './duplication';
import {
  resolveCoveragePath,
  resolveOptionalPath,
  COMPLEXITY_PROBES,
  DUPLICATION_PROBES,
} from './paths';

// Cobertura producers documented in the quirks table (generating-coverage-reports).
// Naming one of these silences the "trusting the data" warning.
const KNOWN_COBERTURA_TOOLS = new Set([
  'gocover-cobertura',
  'kcov',
  'covertool',
  'phpunit',
  'gcovr',
]);

/** Copy an action input into an UPPER_CASE env var the run.ts flow reads. */
function bridgeEnv(envName: string, inputName: string): void {
  process.env[envName] = core.getInput(inputName);
}

export async function main(): Promise<void> {
  const workerUrl = core.getInput('worker-url');
  if (!workerUrl) {
    core.setFailed('worker-url input is required.');
    return;
  }

  // A node24 action receives INPUT_* vars, not the composite step's UPPER_CASE
  // env. Bridge the threshold + token inputs the shared flow reads internally.
  bridgeEnv('MIN_COVERAGE', 'min-coverage');
  bridgeEnv('MAX_COVERAGE_DROP', 'max-coverage-drop');
  bridgeEnv('MAX_COMPLEXITY', 'max-complexity');
  bridgeEnv('MAX_DUPLICATION', 'max-duplication');
  bridgeEnv('GITHUB_TOKEN', 'github-token');

  // ── 1. Resolve + parse coverage (required) ────────────────────────────────
  const coveragePath = resolveCoveragePath(core.getInput('coverage-path') || undefined);
  const coverageContent = fs.readFileSync(coveragePath, 'utf8');
  const format = sniffCoverageFormat(coverageContent);
  if (!format) {
    throw new Error(
      `Could not determine the coverage format of "${coveragePath}". ` +
        'Expected a Go coverage profile, LCOV, Cobertura XML, or JaCoCo XML.',
    );
  }

  let coverage: CoverageResult;
  switch (format) {
    case 'go':
      coverage = parseGoProfile(coverageContent);
      break;
    case 'lcov':
      coverage = parseLcov(coverageContent);
      break;
    case 'cobertura':
      coverage = parseCobertura(coverageContent);
      warnCoberturaTool();
      break;
    case 'jacoco':
      coverage = parseJacoco(coverageContent);
      break;
  }
  core.info(
    `Coverage (${format}) from ${coveragePath}: ${coverage.line_coverage}% lines` +
      (coverage.branch_coverage !== undefined
        ? `, ${coverage.branch_coverage}% branches`
        : ''),
  );

  // ── 2. Resolve optional complexity + duplication reports ──────────────────
  const maxComplexity = parseThreshold(core.getInput('max-complexity'));
  const maxDuplication = parseThreshold(core.getInput('max-duplication'));

  const complexityPath = resolveOptionalPath({
    input: core.getInput('complexity-path') || undefined,
    probes: COMPLEXITY_PROBES,
    thresholdConfigured: maxComplexity !== null,
    kind: 'complexity',
    thresholdInputName: 'max-complexity',
  });

  const duplicationPath = resolveOptionalPath({
    input: core.getInput('duplication-path') || undefined,
    probes: DUPLICATION_PROBES,
    thresholdConfigured: maxDuplication !== null,
    kind: 'duplication',
    thresholdInputName: 'max-duplication',
  });

  // ── 3. Assemble metrics ───────────────────────────────────────────────────
  // NOTE: metric names/units are the interface run.ts branches on:
  //   coverage/%, branch_coverage/%, complexity/score, duplication/%.
  const metrics: Metric[] = [{ name: 'coverage', value: coverage.line_coverage, unit: '%' }];

  if (coverage.branch_coverage !== undefined) {
    metrics.push({ name: 'branch_coverage', value: coverage.branch_coverage, unit: '%' });
  }

  // Complexity precedence: an explicit/probed report overrides JaCoCo-derived.
  let cyclomatic: number | undefined;
  if (complexityPath) {
    cyclomatic = parseComplexity(fs.readFileSync(complexityPath, 'utf8')).cyclomatic;
    core.info(`Complexity from ${complexityPath}: ${cyclomatic}`);
  } else if (coverage.cyclomatic !== undefined) {
    cyclomatic = coverage.cyclomatic;
    core.info(`Complexity (JaCoCo-derived): ${cyclomatic}`);
  }
  if (cyclomatic !== undefined) {
    metrics.push({ name: 'complexity', value: cyclomatic, unit: 'score' });
  }

  if (duplicationPath) {
    const dup = parseJscpd(fs.readFileSync(duplicationPath, 'utf8'));
    metrics.push({ name: 'duplication', value: dup.duplication_pct, unit: '%' });
    core.info(`Duplication from ${duplicationPath}: ${dup.duplication_pct}%`);
  }

  // ── 4. Threshold checks → Check Run → ingest (shared flow) ────────────────
  await report(workerUrl, metrics);
}

function warnCoberturaTool(): void {
  const tool = core.getInput('coverage-tool').trim().toLowerCase();
  if (!tool || !KNOWN_COBERTURA_TOOLS.has(tool)) {
    core.warning(
      'Cobertura report detected without a recognized `coverage-tool`. ' +
        'Branch-coverage semantics vary between producers; trusting the reported values. ' +
        'Set `coverage-tool` to silence this warning.',
    );
  }
}

// Guarded so tests can import main() without triggering execution.
if (require.main === module) {
  main().catch((err) => {
    core.setFailed(err instanceof Error ? err.message : String(err));
  });
}
