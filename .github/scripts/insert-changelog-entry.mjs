#!/usr/bin/env node
// Splices a generated section (see generate-changelog-entry.mjs) into
// CHANGELOG.md above the most recent existing entry, and adds its link
// reference above the previous one. Used by .github/workflows/release.yml.
import { readFileSync, writeFileSync } from 'node:fs';

const [, , changelogPath, sectionPath, version, repo] = process.argv;
if (!changelogPath || !sectionPath || !version || !repo) {
  console.error(
    'Usage: insert-changelog-entry.mjs <CHANGELOG.md> <section.md> <version> <owner/repo>',
  );
  process.exit(1);
}

const changelog = readFileSync(changelogPath, 'utf8');
const section = readFileSync(sectionPath, 'utf8').trimEnd();
const lines = changelog.split('\n');

const headingIndex = lines.findIndex((l) => l.startsWith('## ['));
const linkIndex = lines.findIndex((l) => /^\[\d/.test(l));

if (headingIndex === -1 || linkIndex === -1) {
  console.error('Could not locate an existing "## [x.y.z]" heading or "[x.y.z]:" link line.');
  process.exit(1);
}

const before = lines.slice(0, headingIndex);
const middle = lines.slice(headingIndex, linkIndex);
const linksAndAfter = lines.slice(linkIndex);

const newLink = `[${version}]: https://github.com/${repo}/releases/tag/v${version}`;

const output = [...before, ...section.split('\n'), '', ...middle, newLink, ...linksAndAfter].join(
  '\n',
);

writeFileSync(changelogPath, output.endsWith('\n') ? output : output + '\n');
