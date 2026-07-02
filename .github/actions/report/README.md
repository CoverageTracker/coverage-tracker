# Coverage Tracker Report Action

Reads consumer-produced code-quality reports (coverage, complexity, duplication)
and reports them to a self-hosted [coverage-tracker](../../../README.md) Worker.

**This Action does not run your tests or coverage tools.** Run those first, then
point the Action at the report file — or let it auto-detect the report from the
documented default paths. On push to the default branch the metrics are
persisted; on `pull_request` a Check Run is posted and the job fails if a
configured threshold is breached.

## Usage

```yaml
permissions:
  id-token: write   # mint OIDC token for Worker auth
  checks: write     # post Check Run on PRs

steps:
  - uses: actions/checkout@v4
  - run: npm test -- --coverage        # your tests write coverage/lcov.info
  - uses: CoverageTracker/coverage-tracker/.github/actions/report@v0.2.0
    with:
      worker-url: https://coverage-tracker.yourdomain.com
```

## Inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `worker-url` | **yes** | — | Base URL of your coverage-tracker Worker. |
| `coverage-path` | no | *(probed)* | Path to the coverage report. When unset, the documented per-language default paths are probed in a fixed order; the first hit wins. **Missing coverage is always a hard failure** (the error lists every probed path). An explicit path always wins. |
| `coverage-tool` | no | `''` | Only relevant for Cobertura, whose branch semantics vary by producer (`gocover-cobertura`, `kcov`, `covertool`, `phpunit`, `gcovr`). Naming it silences the "trusting the data" warning. Ignored for LCOV / JaCoCo / Go. |
| `complexity-path` | no | *(probed)* | Radon JSON, gocyclo text, or Lizard XML. When unset, probes `radon.json` → `gocyclo.txt` → `lizard-report.xml`. |
| `duplication-path` | no | *(probed)* | jscpd JSON. When unset, probes `jscpd-report/jscpd-report.json`. The Action no longer runs jscpd — run it yourself. |
| `min-coverage` | no | `''` | Absolute coverage floor (%). |
| `max-coverage-drop` | no | `''` | Max allowed drop (pp) from the default-branch baseline (PR checks only). |
| `max-complexity` | no | `''` | Max allowed average cyclomatic complexity. |
| `max-duplication` | no | `''` | Max allowed duplication (%). |
| `github-token` | no | `${{ github.token }}` | Token used to post the PR Check Run. |

## Coverage formats (auto-detected by content)

| Signal | Format | Parsed as |
|---|---|---|
| First line `mode: set\|count\|atomic` | Go coverage profile | statement coverage |
| Starts with `TN:` / `SF:` | LCOV | line + branch (if present) |
| XML root `<coverage>` | Cobertura | line + branch (per quirks) |
| XML root `<report>` | JaCoCo | line + branch + cyclomatic (free) |

For per-language commands and the full default-path table, see
[docs/generating-coverage-reports.md](../../../docs/generating-coverage-reports.md).

## Fail vs. skip semantics

Complexity and duplication are optional end-to-end **unless a threshold is
configured for them**:

- **Coverage** is always required. If no report is found (explicit path or
  probe), the Action fails and lists every path it probed.
- **Complexity / duplication** are skipped silently when the metric is *both*
  unconfigured and absent. But if `max-complexity` / `max-duplication` is set
  and no matching report is found, the Action **fails** with an actionable
  error — a configured threshold with no data is treated as a mistake, not a
  pass.
- An explicit `*-path` that points at a non-existent file is always a hard
  failure, regardless of thresholds.

## Complexity precedence

When multiple complexity signals exist:

1. An explicit `complexity-path` overrides everything.
2. Otherwise a probed complexity file (`radon.json` → `gocyclo.txt` →
   `lizard-report.xml`) is used.
3. Otherwise, for JaCoCo coverage reports, complexity is derived for free from
   the `COMPLEXITY` / `METHOD` counters.
