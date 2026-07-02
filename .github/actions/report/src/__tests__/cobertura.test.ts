import { describe, it, expect } from 'vitest';
import { parseCobertura } from '../cobertura';

const cov = (attrs: string) => `<?xml version="1.0"?>\n<coverage ${attrs}></coverage>`;

describe('parseCobertura', () => {
  it('prefers exact line counts over the rounded line-rate', () => {
    const xml = cov('line-rate="0.5" lines-covered="3" lines-valid="4"');
    // 3/4 = 75, not 50 from line-rate
    expect(parseCobertura(xml).line_coverage).toBe(75);
  });

  it('falls back to line-rate when counts are absent', () => {
    expect(parseCobertura(cov('line-rate="0.9"')).line_coverage).toBe(90);
  });

  it('computes branch coverage from branch counts', () => {
    const xml = cov('line-rate="0.5" branches-covered="1" branches-valid="2"');
    expect(parseCobertura(xml)).toEqual({ line_coverage: 50, branch_coverage: 50 });
  });

  it('QUIRK: omits branch coverage when branches-valid is 0 (no branches)', () => {
    const xml = cov('line-rate="0.8" branch-rate="0" branches-valid="0"');
    const result = parseCobertura(xml);
    expect(result.line_coverage).toBe(80);
    expect(result).not.toHaveProperty('branch_coverage');
  });

  it('QUIRK: omits a spurious 0 branch-rate with no branch counts', () => {
    const result = parseCobertura(cov('line-rate="0.9" branch-rate="0"'));
    expect(result).not.toHaveProperty('branch_coverage');
  });

  it('uses branch-rate when it is non-zero and counts are absent', () => {
    expect(parseCobertura(cov('line-rate="0.9" branch-rate="0.75"')).branch_coverage).toBe(75);
  });
});
