# Migration plan: consumer-generated reports (v2)

Moves coverage, complexity, and duplication from "the Action runs the tool" to
"the consumer runs the tool, the Action reads the file." LCOV is accepted
wherever a language's tooling produces it; Cobertura and JaCoCo are supported,
never required; Go is parsed directly from its native `go tool cover` profile.
Complexity and duplication are optional end-to-end — **unless a threshold is
configured for them, in which case a missing report is a hard failure**
(see Phase 1, "Threshold vs. missing report").

`collect.sh` is retired entirely, not renamed — see Plan A, Phase 2.

Design goal: this project replaces Codecov / Code Climate / Coveralls for its
consumers. Minimize adoption barriers — zero-config where possible, explicit
config always available.

---

## Plan A — `coverage-tracker` repo

### Phase 1 — Design decisions (all resolved — do not revisit)

- [x] **Coverage formats: four, not three.** LCOV, Cobertura XML, JaCoCo XML,
      and the **Go native coverage profile** (`go test -coverprofile`). Go is
      never converted to LCOV/Cobertura.
- [x] **Ingested metric semantics** (fixed contract with the Worker —
      `POST /api/ci/coverage`, schema in `src/routes/ci.ts`):
      | Ingest field | Definition | Source per format |
      |---|---|---|
      | `line_coverage` (required) | Line coverage % | LCOV `LF`/`LH`; Cobertura `line-rate`; JaCoCo `LINE` counter; Go profile statement coverage (equivalent for Go) |
      | `branch_coverage` (optional) | Branch coverage % | LCOV `BRF`/`BRH` (if present); Cobertura `branch-rate` **subject to quirks table**; JaCoCo `BRANCH` counter; Go native: never emitted |
      | `cyclomatic` (optional) | Average cyclomatic complexity per function/method | Radon (mean over blocks); gocyclo `-avg` output; Lizard XML average; JaCoCo `COMPLEXITY` counter ÷ `METHOD` counter |
      | `duplication_pct` (optional) | Duplicated-lines % | jscpd JSON `statistics.total.percentage` |
      `cognitive` and `maintainability` exist in the Worker schema but are
      **out of scope for the Action in this migration** — do not emit them.
      **No Worker changes are required**; the existing contract is satisfied.
- [x] **`coverage-path` is optional with default-path probing.** If unset,
      probe the documented per-language default paths (table in
      `docs/generating-coverage-reports.md`) in a fixed order and use the
      first hit. If nothing is found, **fail** with an error that lists every
      path probed and links to the docs page. This is the zero-config path
      for Codecov-style adoption; explicit `coverage-path` always wins.
- [x] **Complexity tools: Radon (Python), gocyclo (Go), Lizard (fallback for
      everything else, including C/C++).** No further per-language research.
- [x] **Native complexity tool beats Lizard.** When probing default paths and
      multiple complexity files exist, precedence is: `radon.json` →
      `gocyclo.txt` → `lizard-report.xml`. An explicit `complexity-path`
      input overrides probing entirely.
- [x] **JaCoCo complexity is free.** When the coverage format is JaCoCo, the
      parser also emits `cyclomatic` from the `COMPLEXITY`/`METHOD` counters.
      Precedence: an explicit `complexity-path` (or a probed complexity file)
      **overrides** the JaCoCo-derived value.
- [x] **Duplication: jscpd only**, cross-language. The Action **no longer
      auto-installs jscpd** — consumers run it themselves. This is a breaking
      change; see Phase 6.
- [x] **No `complexity-tool` input needed.** Radon (JSON), gocyclo (plain
      text), and Lizard (XML) are distinguishable by content shape alone.
- [x] **Threshold vs. missing report:** if a threshold input is configured
      for a metric (`max-complexity`, `max-duplication`) and no report file
      for that metric is found (input path or default probe), the Action
      **fails** with an actionable error. Silent skip applies only when the
      metric is both unconfigured and absent.
- [x] **Cobertura fallback UX unchanged:** unrecognized/omitted
      `coverage-tool` for Cobertura → warn, default to trusting the data.
- [x] **XML parsing: `fast-xml-parser`** (Cobertura, JaCoCo, Lizard). Add as
      a bundled dependency; do not introduce a second XML library.
- [x] **Version bump confirmed** — breaking change, major version.
- [x] **Dogfood self-test is back in scope** (previously deferred): vitest's
      `lcov` reporter emits `coverage/lcov.info`, which the new architecture
      consumes directly — the self-test exercises the most common consumer
      path (LCOV) end-to-end. See Phase 4.

### Phase 2 — Eliminate `collect.sh`; move fully into the TypeScript action

No shell script. `action.yml`'s `runs:` block changes from a bash-invoking
composite to a plain Node action:

```yaml
runs:
  using: 'node20'
  main: 'dist/index.js'
```

This also removes the old "invoke `collect.sh` via `bash`" workaround.

- [ ] Delete `collect.sh` and all inline Python parsers
- [ ] New entrypoint `src/index.ts` does, in order:
  1. Resolve coverage file: `coverage-path` input if set, else probe the
     documented default paths in a fixed, documented order; **fail with the
     probed-path list** if nothing is found
  2. Resolve `complexity-path` (input, else probe `radon.json` →
     `gocyclo.txt` → `lizard-report.xml`) — optional; **fail if
     `max-complexity` is set and nothing is found**, else skip silently
  3. Resolve `duplication-path` (input, else probe
     `jscpd-report/jscpd-report.json`) — optional; **fail if
     `max-duplication` is set and nothing is found**, else skip silently
  4. Sniff coverage format from content: `mode: set|count|atomic` first
     line → **Go profile**; `TN:`/`SF:` → LCOV; XML root `<coverage>` →
     Cobertura; XML root `<report>` → JaCoCo. Parse; apply Cobertura quirks
     table when applicable
  5. If format is JaCoCo, derive `cyclomatic` from its counters (overridden
     by step-2 result if one exists)
  6. If a complexity file was found, sniff shape (JSON → Radon, XML →
     Lizard, else → gocyclo) and parse
  7. If a duplication file was found, parse jscpd JSON
  8. Threshold checks → Check Run → ingest POST (existing OIDC / branch /
     baseline flow unchanged)

#### Default path probes

Coverage (in probe order — first hit wins):

| Path | Produced by |
|---|---|
| `coverage.out` | `go tool cover` |
| `coverage/lcov.info` | Istanbul/vitest/jest, SimpleCov, Dart/Flutter |
| `lcov.info` | cargo-llvm-cov, hpc-codecov |
| `coverage.lcov` | coverage.py, gcovr, perl2lcov |
| `coverage.info` | coverlet |
| `cover/lcov.info` | ExCoveralls |
| `target/coverage/lcov.info` | Cloverage |
| `target/site/jacoco/jacoco.xml` | JaCoCo (Maven) |
| `build/reports/jacoco/test/jacocoTestReport.xml` | JaCoCo (Gradle) |
| `coverage.xml` | PHPUnit (Cobertura) |
| `luacov.report.out` | LuaCov lcov reporter |

(kcov and covertool default paths contain glob/dynamic segments — those
consumers set `coverage-path` explicitly; document this.)

Complexity and duplication:

| Signal | Tool | Default path |
|---|---|---|
| Complexity | Radon | `radon.json` |
| Complexity | gocyclo | `gocyclo.txt` |
| Complexity | Lizard | `lizard-report.xml` |
| Duplication | jscpd | `jscpd-report/jscpd-report.json` |

Document all of the above as the convention consumers write to for
auto-detection.

### Phase 3 — TypeScript modules

Entrypoint strategy: **keep `src/run.ts` and its exported helpers**
(`parseThreshold`, `buildSummary`, `formatValue`, `formatDelta`,
`thresholdConfigured`, `ThresholdResult`) — the 52 existing tests stay green
untouched. `src/index.ts` is the new entrypoint; it imports run.ts's helpers
for threshold/summary/Check-Run logic and replaces the collect.sh invocation
with the parser pipeline. Strip the collect.sh spawn path (and its
`require.main` guard trigger) out of run.ts; run.ts becomes a pure helper
module.

- [ ] `src/index.ts` — new entrypoint (orchestration per Phase 2)
- [ ] `src/format.ts` — coverage format sniffer (4 formats incl. Go profile)
- [ ] `src/lcov.ts`
- [ ] `src/goprofile.ts` — native `go tool cover` profile parser
- [ ] `src/cobertura.ts` + quirks table (uses fast-xml-parser)
- [ ] `src/jacoco.ts` (already written) — extend to emit `cyclomatic` from
      `COMPLEXITY`/`METHOD` counters
- [ ] `src/complexity/radon.ts`, `src/complexity/gocyclo.ts`,
      `src/complexity/lizard.ts`, `src/complexity/detect.ts` (shape sniffer)
- [ ] `src/duplication.ts` (jscpd JSON)
- [ ] `src/paths.ts` — input-or-default-probe resolution for all three
      report kinds, incl. probe-order tables above and the
      fail-vs-skip rule from Phase 1
- [ ] `src/run.ts` — remove collect.sh invocation; helpers only
- [ ] Add `fast-xml-parser` to dependencies
- [ ] Update `action.yml` inputs: `coverage-path` (optional, probed),
      `coverage-tool` (conditional, Cobertura only), `complexity-path`
      (optional), `duplication-path` (optional); remove anything tied to
      auto-run behavior
- [ ] Rebuild: commit `dist/index.js`; **delete `dist/run.js`**; update any
      reference to the old bundle path

### Phase 4 — Tests

- [ ] Layer 1 (vitest): keep the existing 52 run.ts tests as-is; add unit
      tests per new module, fixture-per-format (LCOV, Go profile, Cobertura
      per quirks entry, JaCoCo incl. complexity derivation, Radon, gocyclo,
      Lizard, jscpd); add tests for probe order/precedence and the
      threshold-configured-but-missing failure
- [ ] Layer 2 (`test/collect-parsers.sh`): retire entirely; fold remaining
      fixture checks into the vitest suite
- [ ] Re-enable `.github/workflows/action-test.yml` (dogfood): run vitest
      with the `lcov` coverage reporter, then invoke the local Action with
      no `coverage-path` — the probe finds `coverage/lcov.info`, closing the
      zero-config LCOV loop end-to-end. Keep the push-main / feature-branch /
      PR threshold matrix from the previous self-test
- [ ] Verify (no code change expected): Worker `POST /api/ci/coverage`
      accepts payloads with only `line_coverage` — complexity/duplication
      fields optional per existing zod schema

### Phase 5 — Markdown documentation

- [ ] `docs/generating-coverage-reports.md` — **generated file, do not edit
      directly.** Canonical source is `generating-coverage-reports.svx` in
      the coveragetracker.dev repo (see Plan B, Phase 2a). Author these
      changes there; the sync pipeline PRs them into this repo:
      - Clarify that the "Default path" columns are **real probe targets**
        (auto-detected when `-path` inputs are unset), and document the
        coverage probe order
      - Note kcov/covertool require explicit `coverage-path` (dynamic paths)
      - Complexity + duplication sections already present — add the
        fail-if-threshold-configured-but-missing rule
      - If the sync pipeline isn't live yet when Plan A reaches this phase,
        make the edits in the `.svx` and copy the exported output over
        manually once — never fork the content
- [ ] `.github/actions/report/README.md` — inputs table: `coverage-path` now
      optional (probed), `complexity-path` / `duplication-path` optional with
      probe fallback; document fail-vs-skip semantics
- [ ] `docs/PROGRESS.md` — new phase entry; mark superseded auto-run entries
      as superseded rather than deleting history
- [ ] `docs/INSTALLATION.md` — update the CI example under "Next steps":
      explicit test/coverage step, then the Action with zero config
      (complexity/duplication shown as optional additions)
- [ ] Root `README.md` — update quick-start snippet (zero-config example)

### Phase 6 — Release

- [ ] Major version tag
- [ ] `CHANGELOG.md`: before/after workflow example; **explicitly call out**:
      (a) the Action no longer runs tests or coverage tools, (b) jscpd is no
      longer auto-installed — duplication silently disappears for consumers
      who relied on it unless they add a jscpd step or set
      `max-duplication` (which now fails loudly when the report is missing),
      (c) `dist/run.js` → `dist/index.js`

---

## Plan B — `coveragetracker.dev` repo

Sidebar and content are both auto-generated from `.svx` frontmatter — no
Svelte component or manual navigation wiring needed. This repo is the
**origin of truth for shared docs content**; the coverage-tracker repo's
markdown copy is generated from here (Phase 2a).

### Phase 1 — Frontmatter schema

- [x] Confirmed: `id`, `kicker`, `title`, `group`. No `order`/`description`.
- [x] Confirmed: sidebar auto-generated from frontmatter.
- [x] Confirm `kicker`/`group` values against the site's existing taxonomy —
      resolved: no `guides` group needed; the page uses the existing
      `usage` kicker/group and slots after "Ingest from CI"

### Phase 2 — Content

- [x] `generating-coverage-reports.svx` drafted; full 17-language table
- [x] **Sourcing decision: coveragetracker.dev is the origin of truth.**
      The `.svx` is canonical; `docs/generating-coverage-reports.md` in the
      coverage-tracker repo is a generated artifact, synced via PR
      (Phase 2a). Direction matters: `.svx → .md` is a trivial emission
      (frontmatter `title` → H1, body verbatim — GFM alerts and tables
      render natively on GitHub, heading levels already align), whereas the
      reverse would need H1-stripping and anchor-rewriting heuristics.
- [x] Author the Plan A Phase 5 doc changes in the `.svx`: probe-order
      table, probe semantics, fail-vs-skip rule, kcov/covertool note
      (`src/lib/docs-content/12-generating-coverage-reports.svx`)

### Phase 2a — Docs export pipeline (`.svx → .md` PR sync)

- [x] `scripts/export-docs.ts` (TypeScript, run with the repo's existing
      Node toolchain): for each configured `.svx`, parse frontmatter, emit
      `# {title}` followed by the body verbatim, prefixed with an HTML
      comment header: `<!-- GENERATED from coveragetracker.dev
      src/lib/docs-content/<file>.svx — do not edit here -->`
      (extended: titled callouts are rewritten to GitHub-renderable alerts,
      `<!-- site-only -->` blocks are stripped, and multi-source targets
      compose several `.svx` into one doc — used for `docs/INSTALLATION.md`,
      which is now also a generated artifact per later scope decision)
- [x] Config is an explicit list of `{ svx, targetPath }` pairs (two entries
      today: `12-generating-coverage-reports.svx` →
      `docs/generating-coverage-reports.md`, and the quick-start /
      installation / usage sections → `docs/INSTALLATION.md`) — no globbing,
      additions are deliberate
- [x] Workflow `.github/workflows/export-docs.yml`: trigger on push to main
      with a path filter on the configured `.svx` files; run the export;
      open/update a PR against `CoverageTracker/coverage-tracker` via
      `peter-evans/create-pull-request` (fixed branch name, e.g.
      `docs-sync`, so repeated runs update one PR); skip cleanly when
      there's no diff
- [x] Auth: fine-grained PAT scoped to the coverage-tracker repo only
      (Contents + Pull requests: write), stored as a repo secret
      (`COVERAGE_TRACKER_SYNC_TOKEN`). Do **not** widen the product GitHub
      App's permissions for docs plumbing. **Manual step remaining: generate
      the PAT and save the secret** — workflow and docs are in place.
- [x] Update `README.md` in this repo with a "Docs export pipeline" section
      documenting the PAT setup so the sync can be re-provisioned (token
      expiry, new fork, new maintainer):
      - GitHub → Settings → Developer settings → Personal access tokens →
        Fine-grained tokens → Generate new token
      - Resource owner: the `CoverageTracker` org; Repository access:
        Only select repositories → `coverage-tracker`
      - Repository permissions: Contents → Read and write, Pull requests →
        Read and write; everything else: No access
      - Set an expiration and note it — the workflow fails with an auth
        error when the token lapses
      - Save as repo secret `COVERAGE_TRACKER_SYNC_TOKEN` (Settings →
        Secrets and variables → Actions)
      - Briefly explain what the pipeline does (`.svx` → `.md` PR sync) and
        that `docs/generating-coverage-reports.md` downstream must never be
        edited directly
- [x] Ordering: land this pipeline **before or alongside** Plan A Phase 5 so
      those doc edits flow through it; if Plan A gets there first, do one
      manual export and note it in the PR description — pipeline landed
      first; Plan A Phase 5 doc content flows through it

### Phase 3 — Cross-linking

- [x] Link `docs/INSTALLATION.md` (coverage-tracker repo) and the
      coveragetracker.dev page to each other — both directions use absolute
      URLs so the links work on the site and on GitHub; the INSTALLATION.md
      side lands via the sync PR (10-verify and 11-ingest link to the page,
      the page links back to the GitHub INSTALLATION.md)
