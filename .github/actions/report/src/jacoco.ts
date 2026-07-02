// JaCoCo XML parser.
//
// Reads the report-level <counter> elements (direct children of the root
// <report>), which summarize the whole run:
//   LINE       → line_coverage
//   BRANCH     → branch_coverage (optional)
//   COMPLEXITY → total cyclomatic complexity across all methods
//   METHOD     → number of methods
//
// JaCoCo complexity is free: cyclomatic = COMPLEXITY(total) / METHOD(total),
// i.e. average cyclomatic complexity per method. A caller that has an explicit
// or probed complexity file overrides this derived value.

import { XMLParser } from 'fast-xml-parser';
import type { CoverageResult } from './format';

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

interface Counter {
  covered: number;
  missed: number;
}

function toArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

export function parseJacoco(content: string): CoverageResult {
  const parsed = parser.parse(content) as {
    report?: { counter?: unknown };
  };

  const counters = new Map<string, Counter>();
  for (const raw of toArray(parsed.report?.counter as Record<string, unknown>[] | undefined)) {
    const type = String(raw['@_type'] ?? '');
    const covered = Number(raw['@_covered'] ?? 0);
    const missed = Number(raw['@_missed'] ?? 0);
    if (type) counters.set(type, { covered, missed });
  }

  const line = counters.get('LINE');
  const lineTotal = line ? line.covered + line.missed : 0;
  const lineCoverage = lineTotal > 0 ? round((line!.covered / lineTotal) * 100) : 0;

  const result: CoverageResult = { line_coverage: lineCoverage };

  const branch = counters.get('BRANCH');
  if (branch) {
    const branchTotal = branch.covered + branch.missed;
    if (branchTotal > 0) {
      result.branch_coverage = round((branch.covered / branchTotal) * 100);
    }
  }

  const complexity = counters.get('COMPLEXITY');
  const method = counters.get('METHOD');
  if (complexity && method) {
    const methodTotal = method.covered + method.missed;
    const complexityTotal = complexity.covered + complexity.missed;
    if (methodTotal > 0) {
      result.cyclomatic = round(complexityTotal / methodTotal);
    }
  }

  return result;
}
