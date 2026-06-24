#!/usr/bin/env bash
# Collect coverage, complexity, and duplication metrics.
#
# Coverage   – reads pre-generated reports (consumer runs tests first).
# Complexity – runs gocyclo (Go), radon (Python), or lizard (fallback) if present.
# Duplication – runs jscpd (auto-installed via npm if absent).
#
# Outputs GITHUB_OUTPUT: metrics-file=<path to JSON metrics file>
set -euo pipefail

METRICS_FILE="$(mktemp /tmp/coverage-tracker-XXXXXX.json)"
JSCPD_OUT="$(mktemp -d /tmp/jscpd-XXXXXX)"
declare -a METRICS=()

# ── Language detection ──────────────────────────────────────────────────────
HAS_GO=false
HAS_PYTHON=false
HAS_JS=false

[[ -f go.mod ]] && HAS_GO=true
[[ -f requirements.txt || -f setup.py || -f pyproject.toml ]] && HAS_PYTHON=true
[[ -f package.json || -f tsconfig.json ]] && HAS_JS=true

# ── Coverage (consumer-produced artifacts) ──────────────────────────────────
COVERAGE_FOUND=false

if $HAS_GO && [[ -f "${COVERAGE_REPORT_GO:-coverage.out}" ]]; then
  # go tool cover -func output: "total:   (statements)   82.4%"
  COVER_LINE=$(go tool cover -func="${COVERAGE_REPORT_GO:-coverage.out}" 2>/dev/null \
    | grep '^total:' || true)
  if [[ -n "$COVER_LINE" ]]; then
    COV_PCT=$(echo "$COVER_LINE" | awk '{gsub(/%/, "", $NF); print $NF}')
    METRICS+=("{\"name\":\"coverage\",\"value\":${COV_PCT},\"unit\":\"%\"}")
    echo "::notice::Go coverage: ${COV_PCT}%"
    COVERAGE_FOUND=true
  fi
fi

if ! $COVERAGE_FOUND && $HAS_PYTHON && [[ -f "${COVERAGE_REPORT_PYTHON:-coverage.json}" ]]; then
  # coverage.py JSON: {"totals": {"percent_covered": 82.4}}
  COV_PCT=$(python3 - <<'PYEOF' 2>/dev/null || true
import json, os
path = os.environ.get('COVERAGE_REPORT_PYTHON', 'coverage.json')
with open(path) as f:
    d = json.load(f)
print(f"{d['totals']['percent_covered']:.2f}")
PYEOF
)
  if [[ -n "$COV_PCT" ]]; then
    METRICS+=("{\"name\":\"coverage\",\"value\":${COV_PCT},\"unit\":\"%\"}")
    echo "::notice::Python coverage: ${COV_PCT}%"
    COVERAGE_FOUND=true
  fi
fi

if ! $COVERAGE_FOUND && $HAS_JS; then
  JS_REPORT="${COVERAGE_REPORT_JS:-coverage/coverage-summary.json}"
  if [[ -f "$JS_REPORT" ]]; then
    # Istanbul/Vitest coverage-summary.json: {"total": {"lines": {"pct": 82.4}}}
    COV_PCT=$(REPORT_PATH="$JS_REPORT" node -e '
const path = require("path");
const d = require(path.resolve(process.env.REPORT_PATH));
console.log(d.total.lines.pct);
' 2>/dev/null || true)
    if [[ -n "$COV_PCT" ]]; then
      METRICS+=("{\"name\":\"coverage\",\"value\":${COV_PCT},\"unit\":\"%\"}")
      echo "::notice::JS/TS coverage: ${COV_PCT}%"
      COVERAGE_FOUND=true
    fi
  fi
fi

if ! $COVERAGE_FOUND; then
  echo "::warning::No coverage report found. Ensure tests run and produce a coverage artifact before calling this action."
fi

# ── Complexity ──────────────────────────────────────────────────────────────
COMPLEXITY_FOUND=false

if $HAS_GO && command -v gocyclo &>/dev/null; then
  # gocyclo output: "<complexity> <pkg> <func> <file>:<line>:<col>"
  AVG=$(gocyclo . 2>/dev/null \
    | awk '{sum+=$1; count++} END {if(count>0) printf "%.2f", sum/count; else print ""}' \
    || true)
  if [[ -n "$AVG" ]]; then
    METRICS+=("{\"name\":\"complexity\",\"value\":${AVG},\"unit\":\"score\"}")
    echo "::notice::Go cyclomatic complexity (avg): ${AVG}"
    COMPLEXITY_FOUND=true
  fi
fi

if ! $COMPLEXITY_FOUND && $HAS_GO && command -v gocognit &>/dev/null; then
  # gocognit output format mirrors gocyclo
  AVG=$(gocognit . 2>/dev/null \
    | awk '{sum+=$1; count++} END {if(count>0) printf "%.2f", sum/count; else print ""}' \
    || true)
  if [[ -n "$AVG" ]]; then
    METRICS+=("{\"name\":\"complexity\",\"value\":${AVG},\"unit\":\"score\"}")
    echo "::notice::Go cognitive complexity (avg): ${AVG}"
    COMPLEXITY_FOUND=true
  fi
fi

if ! $COMPLEXITY_FOUND && $HAS_PYTHON && command -v radon &>/dev/null; then
  # radon cc --json outputs: {"file.py": [{"type":"function"|"class","complexity":N,"methods":[...]}]}
  # Capture first; piping + heredoc both claim stdin so they can't be combined.
  RADON_JSON=$(radon cc --json . 2>/dev/null || true)
  if [[ -n "$RADON_JSON" ]]; then
    AVG=$(echo "$RADON_JSON" | python3 -c '
import json, sys
data = json.load(sys.stdin)
values = []
for entries in data.values():
    for e in entries:
        if e.get("type") == "function":
            values.append(e["complexity"])
        elif e.get("type") == "class":
            for m in e.get("methods", []):
                values.append(m["complexity"])
print(f"{sum(values)/len(values):.2f}" if values else "")
' 2>/dev/null || true)
    if [[ -n "$AVG" ]]; then
      METRICS+=("{\"name\":\"complexity\",\"value\":${AVG},\"unit\":\"score\"}")
      echo "::notice::Python cyclomatic complexity (avg): ${AVG}"
      COMPLEXITY_FOUND=true
    fi
  fi
fi

if ! $COMPLEXITY_FOUND && command -v lizard &>/dev/null; then
  # lizard --xml outputs XML with <function_item cyclomatic_complexity="N" .../>
  # Capture first for the same pipe+heredoc reason.
  LIZARD_XML=$(lizard --xml . 2>/dev/null || true)
  if [[ -n "$LIZARD_XML" ]]; then
    AVG=$(echo "$LIZARD_XML" | python3 -c '
import sys
from xml.etree import ElementTree as ET
root = ET.fromstring(sys.stdin.read())
values = []
# lizard --xml uses CPPNCSS format: <measure type="Function"><item><value label="CCN" value="N"/></item>
for measure in root.findall("measure"):
    if measure.get("type") != "Function":
        continue
    for item in measure.findall("item"):
        for val in item.findall("value"):
            if val.get("label") == "CCN":
                try:
                    values.append(float(val.get("value", "0")))
                except (ValueError, TypeError):
                    pass
                break
print(f"{sum(values)/len(values):.2f}" if values else "")
' 2>/dev/null || true)
    if [[ -n "$AVG" ]]; then
      METRICS+=("{\"name\":\"complexity\",\"value\":${AVG},\"unit\":\"score\"}")
      echo "::notice::Complexity via lizard (avg): ${AVG}"
      COMPLEXITY_FOUND=true
    fi
  fi
fi

if ! $COMPLEXITY_FOUND; then
  echo "::notice::No complexity tool found (gocyclo, gocognit, radon, lizard). Skipping complexity metric."
fi

# ── Duplication (jscpd — install if absent) ─────────────────────────────────

if ! command -v jscpd &>/dev/null; then
  echo "::group::Installing jscpd"
  npm install -g jscpd --quiet 2>&1
  echo "::endgroup::"
fi

if command -v jscpd &>/dev/null; then
  jscpd . \
    --ignore "node_modules/**,dist/**,build/**,.git/**,vendor/**,__pycache__/**,*.min.js,*.min.css" \
    --reporters json \
    --output "$JSCPD_OUT" \
    --quiet \
    2>/dev/null || true

  JSCPD_REPORT="$JSCPD_OUT/jscpd-report.json"
  if [[ -f "$JSCPD_REPORT" ]]; then
    # Expand $JSCPD_REPORT into the heredoc (no single-quote on delimiter)
    DUP_PCT=$(python3 - <<PYEOF 2>/dev/null || echo "0"
import json
with open("$JSCPD_REPORT") as f:
    d = json.load(f)
try:
    val = float(d["statistics"]["total"]["percentage"])
except (KeyError, TypeError, ValueError):
    val = 0.0
print(f"{val:.2f}")
PYEOF
)
    METRICS+=("{\"name\":\"duplication\",\"value\":${DUP_PCT},\"unit\":\"%\"}")
    echo "::notice::Duplication: ${DUP_PCT}%"
  else
    echo "::warning::jscpd ran but produced no report. Skipping duplication metric."
  fi
else
  echo "::warning::jscpd could not be installed. Skipping duplication metric."
fi

# ── Write output ─────────────────────────────────────────────────────────────

if [[ ${#METRICS[@]} -eq 0 ]]; then
  echo "::warning::No metrics were collected."
  printf '{"metrics":[]}' > "$METRICS_FILE"
else
  JOINED=$(IFS=,; printf '%s' "${METRICS[*]}")
  printf '{"metrics":[%s]}' "$JOINED" > "$METRICS_FILE"
fi

echo "metrics-file=$METRICS_FILE" >> "$GITHUB_OUTPUT"
echo "Metrics collected:"
cat "$METRICS_FILE"
