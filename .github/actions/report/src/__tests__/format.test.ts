import { describe, it, expect } from 'vitest';
import { sniffCoverageFormat } from '../format';

describe('sniffCoverageFormat', () => {
  it('detects a Go coverage profile from the mode header', () => {
    expect(sniffCoverageFormat('mode: set\ngithub.com/x/a.go:1.2,3.4 1 1\n')).toBe('go');
    expect(sniffCoverageFormat('mode: count\n')).toBe('go');
    expect(sniffCoverageFormat('mode: atomic\n')).toBe('go');
  });

  it('detects LCOV from TN:/SF: records', () => {
    expect(sniffCoverageFormat('TN:\nSF:src/a.ts\nLF:1\nLH:1\nend_of_record\n')).toBe('lcov');
    expect(sniffCoverageFormat('SF:src/a.ts\nDA:1,1\n')).toBe('lcov');
  });

  it('detects Cobertura from the <coverage> root', () => {
    expect(sniffCoverageFormat('<?xml version="1.0"?>\n<coverage line-rate="0.8"></coverage>')).toBe(
      'cobertura',
    );
  });

  it('detects JaCoCo from the <report> root', () => {
    expect(
      sniffCoverageFormat('<?xml version="1.0"?>\n<!DOCTYPE report>\n<report name="x"></report>'),
    ).toBe('jacoco');
  });

  it('returns null for unrecognized content', () => {
    expect(sniffCoverageFormat('hello world')).toBeNull();
    expect(sniffCoverageFormat('<unknown></unknown>')).toBeNull();
  });
});
