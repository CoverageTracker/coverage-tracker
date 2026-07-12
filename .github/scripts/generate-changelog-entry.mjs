#!/usr/bin/env node
// Builds a Keep a Changelog section from conventional-commit subjects since the
// previous tag. Used by .github/workflows/release.yml — not part of the app.
import { execFileSync } from 'node:child_process';

const [, , prevTag, version] = process.argv;
if (!version) {
  console.error('Usage: generate-changelog-entry.mjs <prevTag|""> <version>');
  process.exit(1);
}

const RS = '\x1e';
const FS = '\x1f';
const range = prevTag ? `${prevTag}..HEAD` : 'HEAD';

const raw = execFileSync('git', ['log', range, '--no-merges', `--pretty=%H${FS}%s${FS}%b${RS}`], {
  encoding: 'utf8',
  maxBuffer: 1024 * 1024 * 32,
});

const commits = raw
  .split(RS)
  .map((r) => r.trim())
  .filter(Boolean)
  .map((r) => {
    const [hash, subject, body] = r.split(FS);
    return { hash: hash.slice(0, 7), subject, body: body ?? '' };
  });

const TYPE_TO_SECTION = {
  feat: 'Added',
  fix: 'Fixed',
  perf: 'Changed',
  refactor: 'Changed',
  revert: 'Removed',
};
const INTERNAL_TYPES = new Set(['docs', 'style', 'test', 'build', 'ci', 'chore']);
const CONVENTIONAL_RE = /^(\w+)(\([^)]*\))?(!)?:\s*(.+)$/;

const sections = { Added: [], Changed: [], Fixed: [], Removed: [] };
const breaking = [];

for (const { hash, subject, body } of commits) {
  const match = subject.match(CONVENTIONAL_RE);
  const isBreaking = Boolean(match?.[3]) || /BREAKING CHANGE:/.test(body);
  const description = match ? match[4] : subject;

  if (isBreaking) {
    breaking.push(`- ${description} (${hash})`);
    continue;
  }

  if (match && INTERNAL_TYPES.has(match[1])) continue;

  const section = (match && TYPE_TO_SECTION[match[1]]) || 'Changed';
  sections[section].push(`- ${description} (${hash})`);
}

const date = new Date().toISOString().slice(0, 10);
const lines = [`## [${version}] — ${date}`, ''];

if (breaking.length) {
  lines.push('### ⚠️ Breaking changes', '', ...breaking, '');
}
for (const name of ['Added', 'Changed', 'Fixed', 'Removed']) {
  if (sections[name].length) {
    lines.push(`### ${name}`, '', ...sections[name], '');
  }
}
if (!breaking.length && Object.values(sections).every((s) => s.length === 0)) {
  lines.push('_No user-facing changes recorded since the previous release._', '');
}

process.stdout.write(lines.join('\n').trimEnd() + '\n');
