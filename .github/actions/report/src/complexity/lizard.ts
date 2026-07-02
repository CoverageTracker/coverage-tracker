// Lizard complexity parser (fallback for all other languages, incl. C/C++).
//
// `lizard --xml` emits CPPNCSS format:
//   <cppncss>
//     <measure type="Function">
//       <labels><label>Nr.</label><label>NCSS</label><label>CCN</label></labels>
//       <item name="..."><value>1</value><value>5</value><value>2</value></item>
//       ...
//       <average label="CCN" value="2"/>
//     </measure>
//   </cppncss>
//
// cyclomatic = the reported CCN average; if absent, the mean of per-item CCN.

import { XMLParser } from 'fast-xml-parser';
import type { ComplexityResult } from './radon';

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

function toArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

export function parseLizard(content: string): ComplexityResult {
  const parsed = parser.parse(content) as { cppncss?: { measure?: unknown } };
  const measures = toArray(parsed.cppncss?.measure as Record<string, unknown>[] | undefined);
  const fn = measures.find((m) => m['@_type'] === 'Function');
  if (!fn) return { cyclomatic: 0 };

  // Preferred: the tool-computed CCN average.
  const averages = toArray(fn.average as Record<string, unknown>[] | undefined);
  const ccnAverage = averages.find((a) => a['@_label'] === 'CCN');
  if (ccnAverage) {
    const v = Number(ccnAverage['@_value']);
    if (Number.isFinite(v)) return { cyclomatic: round(v) };
  }

  // Fallback: mean of per-item CCN values. Two item shapes exist across
  // lizard versions:
  //   positional:  <value>1</value><value>10</value><value>4</value>  (CCN by column)
  //   attributed:  <value label="CCN" value="4"/>
  const labels = toArray(fn.labels as { label?: unknown } | undefined)
    .flatMap((l) => toArray(l.label as unknown[]))
    .map((l) => String(l));
  const ccnIndex = labels.indexOf('CCN');
  const items = toArray(fn.item as Record<string, unknown>[] | undefined);
  const values: number[] = [];
  for (const item of items) {
    const cells = toArray(item.value as unknown[]);
    // Attributed shape: an object carrying @_label / @_value.
    const attributed = cells.find(
      (c): c is Record<string, unknown> =>
        typeof c === 'object' && c !== null && (c as Record<string, unknown>)['@_label'] === 'CCN',
    );
    if (attributed) {
      const v = Number(attributed['@_value']);
      if (Number.isFinite(v)) values.push(v);
      continue;
    }
    // Positional shape: index into the columns declared by <labels>.
    if (ccnIndex >= 0 && ccnIndex < cells.length) {
      const v = Number(cells[ccnIndex]);
      if (Number.isFinite(v)) values.push(v);
    }
  }

  const avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
  return { cyclomatic: round(avg) };
}
