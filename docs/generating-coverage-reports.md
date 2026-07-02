<!-- GENERATED from coveragetracker.dev src/lib/docs-content/12-generating-coverage-reports.svx — do not edit here -->

# Generating coverage reports

The reporting Action does not run your tests or install coverage tools. Your CI step produces a report file (LCOV, Cobertura XML, JaCoCo XML, or Go's native coverage profile); the Action reads it. This page shows the command for each supported language. Coverage Tracker not deployed yet? Start with the [Installation Guide](https://github.com/CoverageTracker/coverage-tracker/blob/main/docs/INSTALLATION.md).

Format is detected automatically from file content — you don't set it explicitly:

- First line `mode: set|count|atomic` → Go coverage profile
- Starts with `TN:` / `SF:` → LCOV
- XML root `<coverage>` → Cobertura
- XML root `<report>` → JaCoCo

`coverage-tool` is only required when the format resolves to Cobertura — it's the generator name, used to correct for known differences between Cobertura writers (see the Cobertura quirks table below).

## Coverage

| Language | Tool | Format | Command | Default path |
|---|---|---|---|---|
| Go | `go tool cover` | native profile | `go test -coverprofile=coverage.out ./...` | `coverage.out` |
| Python | coverage.py | LCOV | `coverage run -m pytest && coverage lcov -o coverage.lcov` | `coverage.lcov` |
| JS/TS | Istanbul (nyc / vitest / jest) | LCOV | `vitest run --coverage --coverage.reporter=lcov` | `coverage/lcov.info` |
| Rust | cargo-llvm-cov | LCOV | `cargo llvm-cov --lcov --output-path lcov.info` | `lcov.info` |
| C/C++ | gcovr | LCOV | `gcovr --lcov -o coverage.lcov` | `coverage.lcov` |
| C# | coverlet | LCOV | `dotnet test /p:CollectCoverage=true /p:CoverletOutputFormat=lcov` | `coverage.info` |
| Java | JaCoCo | JaCoCo XML | `mvn test jacoco:report` (Maven) or `./gradlew jacocoTestReport` (Gradle) | `target/site/jacoco/jacoco.xml` / `build/reports/jacoco/test/jacocoTestReport.xml` |
| Bash | kcov | Cobertura | `kcov --include-path=. coverage/ ./script.sh` | *dynamic — set `coverage-path`* |
| Clojure | Cloverage | LCOV | `lein cloverage --lcov` | `target/coverage/lcov.info` |
| Dart | Flutter test / `coverage` pkg | LCOV | `flutter test --coverage` | `coverage/lcov.info` |
| Elixir | ExCoveralls | LCOV | `mix coveralls.lcov` | `cover/lcov.info` |
| Erlang | covertool | Cobertura | `rebar3 do eunit, cover, covertool generate` | *dynamic — set `coverage-path`* |
| Haskell | hpc + hpc-codecov | LCOV | `cabal test --enable-coverage && hpc-codecov cabal:all -f lcov -o lcov.info` | `lcov.info` |
| Lua | LuaCov + `luacov-reporter-lcov` | LCOV | `luacov -r lcov` | `luacov.report.out` |
| Perl | Devel::Cover + lcov's `perl2lcov` | LCOV | `cover -test && perl2lcov -o coverage.lcov` | `coverage.lcov` |
| PHP | PHPUnit | Cobertura | `XDEBUG_MODE=coverage vendor/bin/phpunit --coverage-cobertura=coverage.xml` | `coverage.xml` |
| Ruby | SimpleCov + `simplecov-lcov` | LCOV | (configure `SimpleCov::Formatter::LcovFormatter` in `spec_helper.rb`) then `rspec` | `coverage/lcov.info` |

> [!NOTE]
> **Go is parsed directly**
> Go is read from its native coverage profile — no LCOV/Cobertura conversion, so no accuracy loss.

> [!WARNING]
> **JaCoCo isn't Cobertura**
> Java's JaCoCo XML is a different schema, not a dialect of Cobertura XML. It's parsed with its own module in the reporter, not the Cobertura path.

## Automatic report discovery

The "Default path" columns on this page are real probe targets, not just conventions. When `coverage-path` is unset, the Action probes these paths in a fixed order and uses the first hit:

1. `coverage.out`
2. `coverage/lcov.info`
3. `lcov.info`
4. `coverage.lcov`
5. `coverage.info`
6. `cover/lcov.info`
7. `target/coverage/lcov.info`
8. `target/site/jacoco/jacoco.xml`
9. `build/reports/jacoco/test/jacocoTestReport.xml`
10. `coverage.xml`
11. `luacov.report.out`

If nothing is found, the Action fails with an error that lists every path it probed. An explicit `coverage-path` input always wins over probing.

> [!NOTE]
> **kcov and covertool need an explicit path**
> Their default output paths contain dynamic segments (the script name, the app name) — write the file wherever the tool puts it and point `coverage-path` at it.

## Complexity and duplication (optional)

Only coverage is required. Complexity and duplication are opt-in: set the path explicitly (`complexity-path` / `duplication-path`), or write the report to the default location below and the Action picks it up automatically.

| Metric | Tool | Command | Default path |
|---|---|---|---|
| Complexity — Go | gocyclo | `gocyclo -avg ./... > gocyclo.txt` | `gocyclo.txt` |
| Complexity — Python | Radon | `radon cc -j . > radon.json` | `radon.json` |
| Complexity — everything else | [Lizard](https://github.com/terryyin/lizard) | `lizard --xml > lizard-report.xml` | `lizard-report.xml` |
| Duplication — any language | [jscpd](https://github.com/kucherenko/jscpd) | `npx jscpd . --reporters json --output ./jscpd-report` | `jscpd-report/jscpd-report.json` |

There is no `complexity-tool` input — Radon (JSON), gocyclo (plain text), and Lizard (XML) are recognized by content shape. When probing finds more than one complexity file, precedence is `radon.json` → `gocyclo.txt` → `lizard-report.xml`; an explicit `complexity-path` overrides probing entirely.

> [!WARNING]
> **Thresholds make reports mandatory**
> If `max-complexity` or `max-duplication` is configured and no report file for that metric is found — neither at the input path nor at a default location — the Action **fails** with an actionable error. A metric is skipped silently only when it is both unconfigured and absent.

> [!NOTE]
> **Java gets complexity for free**
> JaCoCo's `COMPLEXITY` counter is already in the coverage report — no separate step needed for Java. An explicit `complexity-path` (or a probed complexity file) overrides the JaCoCo-derived value.

## Cobertura quirks

Cobertura XML is a shared DTD, not an enforced spec — generators disagree on two things the reporter corrects for based on `coverage-tool`:

| `coverage-tool` | Trust `branch-rate`? | Notes |
|---|---|---|
| `gocover-cobertura` | No — always `0` | Go's block-based coverage can't map to branches |
| `kcov` | Yes | |
| `covertool` | Yes | |
| `phpunit` | Yes | |
| `gcovr` | Yes | |

If your `coverage-tool` isn't listed, the reporter treats `branch-rate` as trustworthy by default — open an issue if that's wrong for your generator.
