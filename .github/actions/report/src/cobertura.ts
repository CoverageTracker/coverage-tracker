// Cobertura XML parser.
//
// The root <coverage> element carries the summary attributes we need. Different
// producers populate them inconsistently, hence the quirks handling below.
//
// ── Quirks table ────────────────────────────────────────────────────────────
// | Producer signal                     | Behavior                              |
// |-------------------------------------|---------------------------------------|
// | `lines-covered`/`lines-valid` present | Prefer exact counts over `line-rate`  |
// |                                     | (line-rate is rounded to 4 dp).       |
// | `branches-valid == 0`               | Project has no branches → OMIT        |
// |                                     | branch_coverage (never report 0%).    |
// | `branch-rate == 0`, no branch counts| Ambiguous (0% vs. no branches) →      |
// |                                     | OMIT to avoid a spurious 0%.          |
// | `branch-rate` absent                | OMIT branch_coverage.                 |
//
// The `coverage-tool` input only affects the *warning* emitted by the caller
// (unrecognized/omitted → warn, trust the data); parsing itself is tool-agnostic.

import { XMLParser } from 'fast-xml-parser';
import type { CoverageResult } from './format';

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

function num(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function parseCobertura(content: string): CoverageResult {
  const parsed = parser.parse(content) as {
    coverage?: Record<string, unknown>;
  };
  const cov = parsed.coverage ?? {};

  const lineRate = num(cov['@_line-rate']);
  const linesCovered = num(cov['@_lines-covered']);
  const linesValid = num(cov['@_lines-valid']);
  const branchRate = num(cov['@_branch-rate']);
  const branchesCovered = num(cov['@_branches-covered']);
  const branchesValid = num(cov['@_branches-valid']);

  // Line coverage: prefer exact counts, fall back to the (rounded) rate.
  let lineCoverage: number;
  if (linesCovered !== null && linesValid !== null && linesValid > 0) {
    lineCoverage = round((linesCovered / linesValid) * 100);
  } else if (lineRate !== null) {
    lineCoverage = round(lineRate * 100);
  } else {
    lineCoverage = 0;
  }

  const result: CoverageResult = { line_coverage: lineCoverage };

  // Branch coverage — apply the quirks above.
  if (branchesValid !== null) {
    if (branchesValid > 0) {
      const bc =
        branchesCovered !== null
          ? (branchesCovered / branchesValid) * 100
          : (branchRate ?? 0) * 100;
      result.branch_coverage = round(bc);
    }
    // branchesValid === 0 → no branches → omit.
  } else if (branchRate !== null && branchRate > 0) {
    result.branch_coverage = round(branchRate * 100);
  }
  // branch-rate absent, or 0 with no branch counts → omit.

  return result;
}
