// Radon complexity parser (Python).
//
// `radon cc --json .` emits:
//   { "path/to/file.py": [ { "type": "function", "complexity": N, ... },
//                          { "type": "class", "complexity": M,
//                            "methods": [ { "complexity": K, ... } ] } ] }
//
// cyclomatic = mean cyclomatic complexity over all blocks (standalone
// functions + methods inside classes).

export interface ComplexityResult {
  cyclomatic: number;
}

interface RadonBlock {
  type?: string;
  complexity?: number;
  methods?: RadonBlock[];
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

export function parseRadon(content: string): ComplexityResult {
  const data = JSON.parse(content) as Record<string, RadonBlock[]>;
  const values: number[] = [];

  for (const entries of Object.values(data)) {
    for (const entry of entries ?? []) {
      if (entry.type === 'class') {
        for (const method of entry.methods ?? []) {
          if (typeof method.complexity === 'number') values.push(method.complexity);
        }
      } else if (typeof entry.complexity === 'number') {
        // function / method blocks
        values.push(entry.complexity);
      }
    }
  }

  const avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
  return { cyclomatic: round(avg) };
}
