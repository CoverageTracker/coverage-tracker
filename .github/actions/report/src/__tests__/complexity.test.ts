import { describe, it, expect } from 'vitest';
import { parseRadon } from '../complexity/radon';
import { parseGocyclo } from '../complexity/gocyclo';
import { parseLizard } from '../complexity/lizard';
import { detectComplexityShape, parseComplexity } from '../complexity/detect';

describe('parseRadon', () => {
  it('averages standalone functions and class methods', () => {
    const json = JSON.stringify({
      'a.py': [
        { type: 'function', complexity: 3 },
        {
          type: 'class',
          complexity: 5,
          methods: [
            { type: 'method', complexity: 7 },
            { type: 'method', complexity: 1 },
          ],
        },
      ],
    });
    // (3 + 7 + 1) / 3 = 3.67
    expect(parseRadon(json)).toEqual({ cyclomatic: 3.67 });
  });

  it('returns 0 for an empty report', () => {
    expect(parseRadon('{}')).toEqual({ cyclomatic: 0 });
  });
});

describe('parseGocyclo', () => {
  it('averages the complexity column of plain output', () => {
    const text = '5 pkg funcA file.go:1:1\n3 pkg funcB file.go:5:1\n';
    expect(parseGocyclo(text)).toEqual({ cyclomatic: 4 });
  });

  it('uses the Average line from -avg output when present', () => {
    const text = '5 pkg funcA file.go:1:1\n3 pkg funcB file.go:5:1\nAverage: 4.00\n';
    expect(parseGocyclo(text)).toEqual({ cyclomatic: 4 });
  });
});

const lizardXml = (averages: string) =>
  `<?xml version="1.0"?><cppncss><measure type="Function">` +
  `<labels><label>Nr.</label><label>NCSS</label><label>CCN</label></labels>` +
  `<item name="foo"><value>1</value><value>10</value><value>4</value></item>` +
  `<item name="bar"><value>2</value><value>5</value><value>2</value></item>` +
  `${averages}</measure></cppncss>`;

describe('parseLizard', () => {
  it('uses the reported CCN average', () => {
    expect(parseLizard(lizardXml('<average label="CCN" value="3"/>'))).toEqual({ cyclomatic: 3 });
  });

  it('falls back to the mean of per-item CCN when no average is present', () => {
    // CCN column values are 4 and 2 → mean 3
    expect(parseLizard(lizardXml('')).cyclomatic).toBe(3);
  });

  it('handles the attributed <value label="CCN" value="N"/> item shape', () => {
    const xml =
      '<?xml version="1.0"?><cppncss><measure type="Function">' +
      '<item name="foo"><value label="CCN" value="4"/><value label="NCSS" value="12"/></item>' +
      '<item name="bar"><value label="CCN" value="2"/><value label="NCSS" value="8"/></item>' +
      '<item name="baz"><value label="CCN" value="6"/><value label="NCSS" value="20"/></item>' +
      '</measure></cppncss>';
    // (4 + 2 + 6) / 3 = 4
    expect(parseLizard(xml)).toEqual({ cyclomatic: 4 });
  });
});

describe('detectComplexityShape', () => {
  it('detects radon from JSON', () => expect(detectComplexityShape('{"a":[]}')).toBe('radon'));
  it('detects lizard from XML', () =>
    expect(detectComplexityShape('<?xml?><cppncss/>')).toBe('lizard'));
  it('detects gocyclo from plain text', () =>
    expect(detectComplexityShape('5 pkg fn file.go:1:1')).toBe('gocyclo'));

  it('parseComplexity dispatches on shape', () => {
    expect(parseComplexity('{"a.py":[{"type":"function","complexity":2}]}')).toEqual({
      cyclomatic: 2,
    });
    expect(parseComplexity('2 pkg fn file.go:1:1\n4 pkg gn file.go:2:1')).toEqual({ cyclomatic: 3 });
  });
});
