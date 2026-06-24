#!/usr/bin/env bash
# Parser fixture tests for collect.sh inline parsers.
# Creates minimal fixture files and runs the same parse logic used in collect.sh,
# asserting the extracted value matches the expected output.
set -euo pipefail

PASS=0
FAIL=0
TMPDIR_FIXTURES="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_FIXTURES"' EXIT

assert_eq() {
  local label="$1" expected="$2" actual="$3"
  if [[ "$actual" == "$expected" ]]; then
    echo "  PASS  $label"
    (( ++PASS ))
  else
    echo "  FAIL  $label"
    echo "        expected: $expected"
    echo "        actual:   $actual"
    (( ++FAIL ))
  fi
}

echo "=== collect.sh parser fixture tests ==="
echo ""

# ── Istanbul / Vitest coverage-summary.json ─────────────────────────────────
echo "Istanbul/Vitest coverage-summary.json"

ISTANBUL_FILE="$TMPDIR_FIXTURES/coverage-summary.json"
cat > "$ISTANBUL_FILE" <<'EOF'
{
  "total": {
    "lines":      { "total": 200, "covered": 166, "skipped": 0, "pct": 83.0 },
    "statements": { "total": 210, "covered": 173, "skipped": 0, "pct": 82.4 },
    "functions":  { "total":  50, "covered":  41, "skipped": 0, "pct": 82.0 },
    "branches":   { "total":  80, "covered":  64, "skipped": 0, "pct": 80.0 }
  }
}
EOF

RESULT=$(REPORT_PATH="$ISTANBUL_FILE" node -e '
const path = require("path");
const d = require(path.resolve(process.env.REPORT_PATH));
console.log(d.total.lines.pct);
' 2>/dev/null)
assert_eq "lines.pct extracted" "83" "$RESULT"

# ── coverage.py JSON ─────────────────────────────────────────────────────────
echo "coverage.py JSON"

COVPY_FILE="$TMPDIR_FIXTURES/coverage.json"
cat > "$COVPY_FILE" <<'EOF'
{
  "meta": { "version": "7.3.0" },
  "totals": {
    "covered_lines": 166,
    "num_statements": 200,
    "percent_covered": 73.55,
    "percent_covered_display": "74"
  }
}
EOF

RESULT=$(COVERAGE_REPORT_PYTHON="$COVPY_FILE" python3 - <<'PYEOF' 2>/dev/null
import json, os
path = os.environ.get('COVERAGE_REPORT_PYTHON', 'coverage.json')
with open(path) as f:
    d = json.load(f)
print(f"{d['totals']['percent_covered']:.2f}")
PYEOF
)
assert_eq "percent_covered extracted" "73.55" "$RESULT"

# ── go tool cover -func text ─────────────────────────────────────────────────
echo "go tool cover -func"

GO_COVER_LINE="total:	(statements)	82.40%"
RESULT=$(echo "$GO_COVER_LINE" | awk '{gsub(/%/, "", $NF); print $NF}')
assert_eq "go coverage % extracted" "82.40" "$RESULT"

# ── radon cc --json ──────────────────────────────────────────────────────────
echo "radon cc --json"

RADON_JSON='{
  "src/main.py": [
    {"type": "function", "name": "foo", "complexity": 3},
    {"type": "function", "name": "bar", "complexity": 5}
  ],
  "src/utils.py": [
    {
      "type": "class",
      "name": "MyClass",
      "methods": [
        {"complexity": 2},
        {"complexity": 4}
      ]
    }
  ]
}'
RESULT=$(echo "$RADON_JSON" | python3 -c '
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
' 2>/dev/null)
assert_eq "radon avg complexity" "3.50" "$RESULT"

# ── jscpd-report.json ────────────────────────────────────────────────────────
echo "jscpd-report.json"

JSCPD_FILE="$TMPDIR_FIXTURES/jscpd-report.json"
cat > "$JSCPD_FILE" <<'EOF'
{
  "statistics": {
    "total": {
      "lines": 1000,
      "duplicatedLines": 18,
      "percentage": 1.80,
      "clones": 3
    }
  }
}
EOF

RESULT=$(python3 -c '
import json, sys
d = json.load(sys.stdin)
try:
    val = float(d["statistics"]["total"]["percentage"])
except (KeyError, TypeError, ValueError):
    val = 0.0
print(f"{val:.2f}")
' < "$JSCPD_FILE" 2>/dev/null)
assert_eq "jscpd duplication %" "1.80" "$RESULT"

# ── lizard --xml CPPNCSS format ──────────────────────────────────────────────
echo "lizard --xml CPPNCSS"

LIZARD_XML='<?xml version="1.0" ?>
<cppncss>
  <measure type="Function">
    <item name="foo()" filename="src/a.py" line="1">
      <value label="CCN" value="4"/>
      <value label="NCSS" value="12"/>
    </item>
    <item name="bar()" filename="src/a.py" line="20">
      <value label="CCN" value="2"/>
      <value label="NCSS" value="8"/>
    </item>
    <item name="baz()" filename="src/b.py" line="5">
      <value label="CCN" value="6"/>
      <value label="NCSS" value="20"/>
    </item>
  </measure>
</cppncss>'

RESULT=$(echo "$LIZARD_XML" | python3 -c '
import sys
from xml.etree import ElementTree as ET
root = ET.fromstring(sys.stdin.read())
values = []
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
' 2>/dev/null)
assert_eq "lizard avg CCN" "4.00" "$RESULT"

# ── Summary ──────────────────────────────────────────────────────────────────
echo ""
echo "Results: $PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]] && exit 0 || exit 1
