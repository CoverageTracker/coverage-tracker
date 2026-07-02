# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] — Unreleased

### Consumer-generated reports (breaking change)

The reporting Action moved from **"the Action runs the tool"** to **"the
consumer runs the tool, the Action reads the file."** You now run your tests,
coverage tools, and (optionally) complexity/duplication tools yourself; the
Action parses the report they produce and reports the numbers.

Coverage formats are auto-detected by content: **LCOV, Cobertura XML, JaCoCo
XML, and the native Go coverage profile** (`go test -coverprofile`). `go` is
parsed directly — never converted. `coverage-path` is optional; when unset, the
Action probes documented default paths and uses the first hit (an explicit path
always wins). See `docs/generating-coverage-reports.md`.

#### ⚠️ Breaking changes — read before upgrading

- **(a) The Action no longer runs your tests or coverage tools.** It previously
  detected the language and ran `go tool cover`, `coverage.py`, Istanbul, etc.
  Now you must produce the coverage report yourself *before* the Action step.
  The `coverage-report-go` / `coverage-report-python` / `coverage-report-js`
  inputs are removed; use `coverage-path` (or rely on auto-detection).
- **(b) jscpd is no longer auto-installed.** Duplication silently disappears for
  consumers who relied on the Action installing jscpd — unless you add a jscpd
  step yourself, or set `max-duplication` (which now **fails loudly** when no
  jscpd report is found, rather than skipping). The same fail-when-configured
  rule applies to `max-complexity`.
- **(c) The bundle moved: `dist/run.js` → `dist/index.js`.** The action entry is
  now a `node20` action (`main: dist/index.js`) instead of a composite step that
  invoked `collect.sh`. `collect.sh` and `test/collect-parsers.sh` are removed.

#### Before

```yaml
# The Action detected the language, ran the tools, and auto-installed jscpd.
- uses: CoverageTracker/coverage-tracker/.github/actions/report@v0.1.2
  with:
    worker-url: https://coverage-tracker.example.com
    coverage-report-js: coverage/coverage-summary.json
    max-duplication: '5'
```

#### After

```yaml
# You run the tools; the Action reads the report (auto-detected).
- run: npm test -- --coverage        # writes coverage/lcov.info
- run: npx jscpd . --reporters json --output ./jscpd-report   # only if you want duplication
- uses: CoverageTracker/coverage-tracker/.github/actions/report@v0.2.0
  with:
    worker-url: https://coverage-tracker.example.com
    # coverage-path is auto-detected; complexity/duplication are optional
    max-duplication: '5'                                        # now requires a jscpd report
```

### Added

- Content-based coverage format sniffer supporting LCOV, Cobertura, JaCoCo, and
  the Go coverage profile.
- Optional complexity reports (Radon JSON, gocyclo text, Lizard XML) and jscpd
  duplication reports, resolved via explicit `*-path` inputs or default-path
  probing. JaCoCo coverage reports derive cyclomatic complexity for free.
- New inputs: `coverage-path`, `coverage-tool` (Cobertura only), `complexity-path`,
  `duplication-path`, `github-token`.
- `fast-xml-parser` as the single bundled XML dependency.

### Changed

- `action.yml` is now a `node20` action (`main: dist/index.js`).
- `src/run.ts` is now a pure helper module (threshold/summary/Check-Run logic);
  orchestration lives in the new `src/index.ts`.

### Removed

- `collect.sh` and its inline parsers; `test/collect-parsers.sh`.
- `coverage-report-go` / `coverage-report-python` / `coverage-report-js` inputs.
- `dist/run.js` (replaced by `dist/index.js`).

[0.2.0]: https://github.com/CoverageTracker/coverage-tracker/releases/tag/v0.2.0
