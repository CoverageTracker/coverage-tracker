// Content-based coverage format sniffer.
//
// Four formats are recognized (Plan A, Phase 1 — coverage formats: four, not three):
//   - Go native coverage profile (`go test -coverprofile`)
//   - LCOV
//   - Cobertura XML
//   - JaCoCo XML
//
// Detection is by content shape alone; file extensions are never trusted.

export type CoverageFormat = 'go' | 'lcov' | 'cobertura' | 'jacoco';

/** Normalized coverage numbers. `branch_coverage`/`cyclomatic` are only present
 *  when the source format carries them (JaCoCo derives `cyclomatic`). */
export interface CoverageResult {
  line_coverage: number;
  branch_coverage?: number;
  cyclomatic?: number;
}

/**
 * Identify the coverage format from file content.
 * Returns null when nothing matches (caller should fail with an actionable error).
 */
export function sniffCoverageFormat(content: string): CoverageFormat | null {
  // Go profile: the very first non-empty line is `mode: set|count|atomic`.
  if (/^\s*mode:\s*(set|count|atomic)\b/.test(content)) {
    return 'go';
  }

  // LCOV: line-oriented records keyed by `TN:` (test name) / `SF:` (source file).
  if (/(^|\n)\s*(TN:|SF:)/.test(content)) {
    return 'lcov';
  }

  // XML formats: inspect the first element name, skipping the XML declaration,
  // comments, and any DOCTYPE.
  const root = firstElementName(content);
  if (root === 'coverage') return 'cobertura';
  if (root === 'report') return 'jacoco';

  return null;
}

/** Return the tag name of the first XML element, or null if the content is not XML. */
function firstElementName(content: string): string | null {
  const withoutDecl = content
    .replace(/<\?[\s\S]*?\?>/g, '') // <?xml ... ?>
    .replace(/<!--[\s\S]*?-->/g, '') // comments
    .replace(/<!DOCTYPE[\s\S]*?>/gi, ''); // DOCTYPE
  const match = withoutDecl.match(/<\s*([A-Za-z_][\w.-]*)/);
  return match ? match[1].toLowerCase() : null;
}
