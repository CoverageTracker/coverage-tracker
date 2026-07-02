import { describe, it, expect } from 'vitest';
import { parseJacoco } from '../jacoco';

const report = (counters: string) =>
  `<?xml version="1.0"?>\n<report name="x">${counters}</report>`;

describe('parseJacoco', () => {
  it('computes line and branch coverage from report-level counters', () => {
    const xml = report(
      '<counter type="LINE" missed="5" covered="15"/>' +
        '<counter type="BRANCH" missed="2" covered="6"/>',
    );
    expect(parseJacoco(xml)).toMatchObject({ line_coverage: 75, branch_coverage: 75 });
  });

  it('derives cyclomatic = COMPLEXITY total / METHOD total', () => {
    const xml = report(
      '<counter type="LINE" missed="0" covered="10"/>' +
        '<counter type="COMPLEXITY" missed="4" covered="12"/>' +
        '<counter type="METHOD" missed="1" covered="7"/>',
    );
    // (12 + 4) / (7 + 1) = 2
    expect(parseJacoco(xml).cyclomatic).toBe(2);
  });

  it('omits branch coverage when there are no branches', () => {
    const xml = report('<counter type="LINE" missed="0" covered="10"/>');
    const result = parseJacoco(xml);
    expect(result.line_coverage).toBe(100);
    expect(result).not.toHaveProperty('branch_coverage');
  });

  it('omits cyclomatic when COMPLEXITY/METHOD counters are absent', () => {
    const xml = report('<counter type="LINE" missed="0" covered="10"/>');
    expect(parseJacoco(xml)).not.toHaveProperty('cyclomatic');
  });
});
