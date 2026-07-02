import { describe, it, expect } from 'vitest';
import { parseGoProfile } from '../goprofile';

describe('parseGoProfile', () => {
  it('computes statement coverage from covered vs total statements', () => {
    const profile = [
      'mode: set',
      'github.com/x/pkg/a.go:1.2,3.4 2 1',
      'github.com/x/pkg/a.go:5.2,6.4 3 0',
    ].join('\n');
    // 2 of 5 statements covered
    expect(parseGoProfile(profile)).toEqual({ line_coverage: 40 });
  });

  it('treats any non-zero count as covered (count mode)', () => {
    const profile = 'mode: count\ngithub.com/x/a.go:1.1,2.2 4 7\n';
    expect(parseGoProfile(profile)).toEqual({ line_coverage: 100 });
  });

  it('returns 0 when there are no statements', () => {
    expect(parseGoProfile('mode: set\n')).toEqual({ line_coverage: 0 });
  });

  it('never emits branch coverage', () => {
    const result = parseGoProfile('mode: set\ngithub.com/x/a.go:1.1,2.2 1 1\n');
    expect(result).not.toHaveProperty('branch_coverage');
  });
});
