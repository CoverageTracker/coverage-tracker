// gocyclo complexity parser (Go).
//
// Two shapes are accepted:
//   1. `gocyclo -avg` — includes a trailing `Average: <n>` line (used directly).
//   2. plain `gocyclo` — one line per function:
//        <complexity> <package> <function> <file>:<line>:<col>
//      (averaged over the first column).

import type { ComplexityResult } from './radon';

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

export function parseGocyclo(content: string): ComplexityResult {
  const avgLine = content.match(/^Average:\s*([\d.]+)/m);
  if (avgLine) {
    const avg = parseFloat(avgLine[1]);
    return { cyclomatic: round(Number.isFinite(avg) ? avg : 0) };
  }

  const values: number[] = [];
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const match = line.match(/^(\d+)\s+\S/);
    if (match) values.push(parseInt(match[1], 10));
  }

  const avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
  return { cyclomatic: round(avg) };
}
