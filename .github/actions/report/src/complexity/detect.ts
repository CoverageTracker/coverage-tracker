// Complexity report shape sniffer + dispatcher.
//
// Radon (JSON), gocyclo (plain text), and Lizard (XML) are distinguishable by
// content shape alone — no `complexity-tool` input is needed (Plan A, Phase 1).

import { parseRadon, type ComplexityResult } from './radon';
import { parseGocyclo } from './gocyclo';
import { parseLizard } from './lizard';

export type ComplexityShape = 'radon' | 'lizard' | 'gocyclo';

export function detectComplexityShape(content: string): ComplexityShape {
  const trimmed = content.replace(/^﻿/, '').trimStart();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return 'radon'; // JSON
  if (trimmed.startsWith('<')) return 'lizard'; // XML
  return 'gocyclo'; // plain text
}

export function parseComplexity(content: string): ComplexityResult {
  switch (detectComplexityShape(content)) {
    case 'radon':
      return parseRadon(content);
    case 'lizard':
      return parseLizard(content);
    case 'gocyclo':
      return parseGocyclo(content);
  }
}

export type { ComplexityResult };
