import { describe, it, expect } from 'vitest';
import { parseJscpd } from '../duplication';

describe('parseJscpd', () => {
  it('reads statistics.total.percentage', () => {
    const json = JSON.stringify({ statistics: { total: { percentage: 4.2 } } });
    expect(parseJscpd(json)).toEqual({ duplication_pct: 4.2 });
  });

  it('returns 0 when the percentage is missing', () => {
    expect(parseJscpd('{"statistics":{}}')).toEqual({ duplication_pct: 0 });
  });
});
