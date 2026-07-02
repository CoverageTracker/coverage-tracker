// jscpd duplication parser.
//
// The Action no longer runs jscpd — consumers produce the report themselves
// (breaking change, Plan A Phase 6). We read the JSON report's headline number:
//   statistics.total.percentage → duplication_pct

export interface DuplicationResult {
  duplication_pct: number;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

export function parseJscpd(content: string): DuplicationResult {
  const data = JSON.parse(content) as {
    statistics?: { total?: { percentage?: unknown } };
  };
  const pct = Number(data.statistics?.total?.percentage);
  return { duplication_pct: Number.isFinite(pct) ? round(pct) : 0 };
}
