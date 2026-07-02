// LCOV parser.
//
// Aggregates the summary counters across every source-file (SF) section:
//   LF / LH  → lines found / hit          → line_coverage
//   BRF / BRH → branches found / hit       → branch_coverage (optional)
//
// If a report omits the LF/LH summary lines (rare), we fall back to counting
// DA:<line>,<hits> records so line coverage is still derived.

import type { CoverageResult } from './format';

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

export function parseLcov(content: string): CoverageResult {
  let lf = 0;
  let lh = 0;
  let brf = 0;
  let brh = 0;
  let daTotal = 0;
  let daHit = 0;

  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('LF:')) lf += intAfterColon(line);
    else if (line.startsWith('LH:')) lh += intAfterColon(line);
    else if (line.startsWith('BRF:')) brf += intAfterColon(line);
    else if (line.startsWith('BRH:')) brh += intAfterColon(line);
    else if (line.startsWith('DA:')) {
      // DA:<line number>,<execution count>
      const parts = line.slice(3).split(',');
      if (parts.length >= 2) {
        daTotal += 1;
        if (Number(parts[1]) > 0) daHit += 1;
      }
    }
  }

  let lineCoverage: number;
  if (lf > 0) {
    lineCoverage = round((lh / lf) * 100);
  } else if (daTotal > 0) {
    lineCoverage = round((daHit / daTotal) * 100);
  } else {
    lineCoverage = 0;
  }

  const result: CoverageResult = { line_coverage: lineCoverage };
  if (brf > 0) {
    result.branch_coverage = round((brh / brf) * 100);
  }
  return result;
}

function intAfterColon(line: string): number {
  const n = parseInt(line.slice(line.indexOf(':') + 1), 10);
  return Number.isFinite(n) ? n : 0;
}
