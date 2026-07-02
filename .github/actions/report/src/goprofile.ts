// Native Go coverage profile parser (`go test -coverprofile=<path>`).
//
// The profile is never converted to LCOV/Cobertura — it is parsed directly.
// Format (after the `mode:` header line):
//   <file>:<startLine>.<startCol>,<endLine>.<endCol> <numStatements> <count>
//
// Go reports *statement* coverage; we treat that as the `line_coverage`
// equivalent per the ingest contract. Branch coverage is never emitted for Go.

import type { CoverageResult } from './format';

const BLOCK_RE = /:\d+\.\d+,\d+\.\d+\s+(\d+)\s+(\d+)\s*$/;

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

export function parseGoProfile(content: string): CoverageResult {
  let totalStatements = 0;
  let coveredStatements = 0;

  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('mode:')) continue;

    const match = line.match(BLOCK_RE);
    if (!match) continue;

    const numStatements = parseInt(match[1], 10);
    const count = parseInt(match[2], 10);
    if (!Number.isFinite(numStatements)) continue;

    totalStatements += numStatements;
    if (count > 0) coveredStatements += numStatements;
  }

  const lineCoverage =
    totalStatements > 0 ? round((coveredStatements / totalStatements) * 100) : 0;

  return { line_coverage: lineCoverage };
}
