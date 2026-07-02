import { describe, it, expect } from 'vitest';
import { parseLcov } from '../lcov';

describe('parseLcov', () => {
  it('aggregates LF/LH across sections and computes line coverage', () => {
    const lcov = [
      'TN:',
      'SF:src/a.ts',
      'LF:2',
      'LH:1',
      'end_of_record',
      'SF:src/b.ts',
      'LF:2',
      'LH:2',
      'end_of_record',
    ].join('\n');
    // (1 + 2) / (2 + 2) = 75%
    expect(parseLcov(lcov)).toEqual({ line_coverage: 75 });
  });

  it('computes branch coverage when BRF/BRH are present', () => {
    const lcov = 'SF:x\nLF:4\nLH:2\nBRF:4\nBRH:1\nend_of_record\n';
    expect(parseLcov(lcov)).toEqual({ line_coverage: 50, branch_coverage: 25 });
  });

  it('omits branch coverage when BRF is zero/absent', () => {
    expect(parseLcov('SF:x\nLF:2\nLH:1\nend_of_record\n')).toEqual({ line_coverage: 50 });
  });

  it('falls back to DA records when LF/LH are absent', () => {
    const lcov = 'SF:x\nDA:1,1\nDA:2,0\nDA:3,5\nend_of_record\n';
    // 2 of 3 lines hit
    expect(parseLcov(lcov)).toEqual({ line_coverage: 66.67 });
  });
});
