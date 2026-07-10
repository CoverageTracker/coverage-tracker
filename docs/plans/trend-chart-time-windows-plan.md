# Time-windowed trend charts with edge-anchoring

## Context

Two visual bugs showed up once multi-category projects became common:

1. **Project detail page** (`[owner]/[repo]/+page.svelte`): a category with very little history
   (in the extreme, a single recorded point) renders as a lone dot near the left edge of an
   otherwise-empty chart, with the x-axis auto-ranging out to whatever `uPlot`'s default ranging
   picks (observed spanning *years* into the future on a single-point series). There's currently
   no way to bound the chart to a sensible window — it always fetches the last 100 rows
   (`+page.ts:18`, hardcoded `limit: 100`) with no time floor.
2. **Project list page** (homepage cards): the new multi-category overlay chart
   (`MultiSparkLine.svelte`) shares one x-axis across categories via `uPlot.join`. When two
   categories' real reporting histories don't overlap (e.g. `frontend` was added partway through
   `default`'s history), each line only occupies the portion of the shared axis where it actually
   has data — so both lines look short/squished instead of filling the card. Confirmed against
   local seed data: `default` spans day 0–14, `frontend` spans day 9–23 of a combined 23-day
   domain, exactly matching the partial-width lines seen in the screenshot.

Both are really the same root problem: chart x-domain is always the exact min/max of whatever
rows happen to be fetched, with no concept of "the window I want to show" vs "the data I have".
The fix is a **relative time-range window with edge-anchoring**, applied server-side:

- The detail page gets a relative time-range button group (**15m / 1h / 12h / 1d / 7d / 30d**,
  default **7d**) next to the existing metric tabs, so a user can pick a bounded window instead
  of "whatever the last 100 rows happen to cover."
- The list page's overlay sparkline always uses a fixed **30d** window, with lines aligned to a
  shared right edge so multi-category cards look consistent regardless of each category's actual
  reporting cadence.
- In both cases, when there's no real data at the window's start, the closest point *before* the
  window is used to synthesize a starting value at the window boundary, so a line is drawn across
  the full width instead of leaving empty space (down to the degenerate single-point case, which
  becomes a flat line spanning the whole window with the one real point pinned at the right edge).

**Key implementation insight:** none of `TrendChart.svelte`, `SparkLine.svelte`, or
`MultiSparkLine.svelte` need any x-domain/scaling logic changes. They already size the x-axis to
the exact min/max of whatever `[timestamps, values]` array they're given. The entire fix is about
*what data the backend returns* — inject a synthetic anchor point at the window boundary, and the
existing charts automatically render full-width. This keeps the chart components dumb and the
windowing/anchoring logic in one place (the DB layer), consistent with the "server-side" approach
already agreed on for D1 row-scan efficiency (see `idx_runs_project_time` usage below).

## Core mechanism: window + anchor

For a given category and a requested duration `D`:

- **Right edge** = that category's own latest recorded point (`latestTs`). Not wall-clock "now" —
  CI doesn't run continuously, and pinning to "now" would leave dead space if the last run was
  hours old.
- **Window start** = `latestTs - D`.
- **Anchor point**: the most recent row with `ran_at <= windowStart` (checking raw `coverage_runs`
  first, then `coverage_daily` for windows that reach past the 14-day `RETENTION_DAYS` cutoff in
  `src/db/rollup.ts:3`). Its value is re-emitted as a synthetic point *at* `windowStart` (i.e.
  `recorded_at` overridden to the window boundary, not its original timestamp). If no such row
  exists at all (window covers this category's entire history), fall back to the **earliest**
  available row's value as the anchor — for a category with exactly one point ever, this
  degenerates to anchor === latest, producing a flat line across the full window with the single
  real point pinned at the right edge. This exactly matches the desired behavior for the
  single-point case.
- Real in-window rows (`windowStart <= ran_at <= latestTs`) are returned normally, in between.

**List-page addition — shared alignment across categories:** the overlay chart needs every
category's line to span the same visual width, even if categories report on different cadences.
So for the list page only, compute a **shared right edge** = `MAX(latestTs)` across all of the
project's categories, and `windowStart = sharedRightEdge - 30d`. Each category is anchored on the
left as above (relative to the shared window), *and* if a category's own latest point is earlier
than the shared right edge, a second synthetic point is appended at the shared right edge
repeating its last known value (forward-carry), so every series' data spans the exact same
`[windowStart, sharedRightEdge]` domain and `uPlot.join` no longer produces partial-width lines.
The detail page does **not** use this alignment — each category already renders as its own
separate `TrendChart`, so cross-category alignment doesn't matter there.

## Backend changes

### The `recorded_at` trap (must be handled explicitly)

The existing raw-run branch of `getCoverageTrend`/`getCoverageTrendGrouped` emits `recorded_at`
as a **day-collapsed string** — `strftime('%Y-%m-%d', ran_at, 'unixepoch')`
(`src/lib/db.ts:335`, `:397`) — and the only frontend consumers parse it with `new Date(...)`
(`TrendChart.svelte:87`, `+page.svelte:12`, `:98` — confirmed via grep, no other `recorded_at`
consumers exist). If the new sub-day windows reused this day-collapsed format, an anchor point at
`windowStart` and the latest point at `latestTs` would frequently fall on the **same calendar
day** for 15m/1h/12h (and for 12h whenever the window doesn't cross midnight) — collapsing to
identical x values and reproducing the exact "single dot" bug this plan exists to fix.

Resolution — **granularity policy split by window size**:
- **`< 1 day` windows (15m, 1h, 12h)**: query raw `coverage_runs` only, with full-precision
  timestamps emitted as ISO 8601 datetimes (`strftime('%Y-%m-%dT%H:%M:%SZ', ran_at,
  'unixepoch')` — parses correctly with `new Date()`), filtered directly by
  `ran_at BETWEEN windowStart AND latestTs`. No day-collapsing, no `coverage_daily` involved
  under normal operation. The synthetic anchor's `recorded_at` is likewise stamped as a full ISO
  datetime derived from `windowStart`, not a day string.
  - Edge case: if the category is dormant enough that even its `latestTs` has already been
    pruned out of `coverage_runs` (rolled into `coverage_daily`, day precision only), a sub-day
    window around it necessarily degenerates to the flat single-point case anyway — acceptable,
    since no finer data exists to show.
- **`>= 1 day` windows (1d, 7d, 30d)**: keep the existing day-collapsed, one-point-per-day
  semantics (matches current chart behavior and avoids overly dense 7d/30d charts) — reuse the
  existing raw+daily union pattern from `getCoverageTrend` (`src/lib/db.ts:308–356`), just bounded
  by the window instead of a row-count `LIMIT`. `recorded_at` stays a day string here, which is
  safe because anchor and latest are expected to differ by at least a day in the normal case.
  30d is the only window that reaches past the 14-day `RETENTION_DAYS` cutoff
  (`src/db/rollup.ts:3`), so it's the one that actually needs the `coverage_daily` union for its
  older portion; 1d/7d stay within retention and could theoretically use raw `coverage_runs`
  exclusively, but reusing the existing union query keeps one code path for all three.

Assemble the anchor point **in TypeScript after fetching**, not in SQL: run the in-window range
query, plus a separate small query for "closest row with `ran_at <= windowStart`" (or
`day <= windowStart's date` for the day-granularity path), and fall back to the earliest
available row if that returns nothing. Expressing the fallback-to-earliest and (for the list
page) forward-carry entirely in SQL was judged not worth the complexity versus two lightweight
indexed queries per category plus straightforward TS.

### Implementation

- **New module `src/lib/timeRanges.ts`**: `RangeKey = '15m' | '1h' | '12h' | '1d' | '7d' | '30d'`
  and a `RANGE_SECONDS: Record<RangeKey, number>` map. Single source of truth shared by the DB
  layer and the API route's zod validation.
- **`src/lib/db.ts` additions** (alongside existing `getCoverageTrend` / `getCoverageTrendGrouped`,
  which stay as-is — they remain the fallback path for legacy `limit`-based callers like
  `BadgeModal`'s cheap `limit: 1` category-discovery fetch):
  - A single-category windowed+anchored query, used by the detail page (per-category, no forced
    cross-category alignment).
  - A grouped windowed+anchored query with an `align: boolean` option, used by:
    - detail page (`align: false` — independent per-category windows), and
    - list page (`align: true` — shared right edge + forward-carry, as described above).
  - Both build on the existing `idx_runs_project_time` index (`project_id, branch, category,
    ran_at` — `migrations/0003_categories.sql:17-19`), which fully covers the
    project+branch+category filter plus the `ran_at` range scan for the "in-window rows" and
    "anchor row" queries.
  - Reuse `pickMetricValue`/`metricToColumn` from `src/lib/metrics.ts` — unchanged.

## API changes (`src/routes/api.ts`)

- `GET /projects/:owner/:repo/metrics/categories` gains two optional query params:
  - `range` — one of `RangeKey`, zod-validated (422 on unknown value, matching the "validation at
    every write route" convention — this is a read route, but the same 422-on-bad-input pattern
    applies for consistency).
  - `align` — boolean flag (`?align=true`), only meaningful with `range`.
  - When `range` is present, call the new windowed/grouped query instead of the existing
    `limit`-based `getCoverageTrendGrouped` path. When absent, behavior is unchanged (legacy
    `limit` param still works — no breaking change for existing callers).
- Response shape (`GroupedTrendResponse`) is unchanged — anchor/forward-carry points are just
  ordinary `MetricPoint` entries in the `data` array. Add an optional `synthetic?: boolean` field
  to `MetricPoint` purely so tests can assert exactly which points were synthesized; rendering
  code ignores it.

## Frontend changes

- `dashboard/src/lib/types.ts`: add `RangeKey`/`RANGES` (key + display label, e.g. `7d` → "7 days")
  for the button group, and the optional `synthetic?: boolean` on `MetricPoint`.
- `dashboard/src/lib/api.ts`: change `fetchTrendByCategory`'s trailing params from a bare
  `limit: number` to an options object `{ limit?: number; range?: RangeKey; align?: boolean }`,
  and update all three call sites:
  - `BadgeModal.svelte` → `{ limit: 1 }` (unchanged behavior, category discovery only).
  - `[owner]/[repo]/+page.ts` → `{ range }` (from the new URL param, default `'7d'`).
  - `+page.ts` (homepage) → `{ range: '30d', align: true }`, replacing the current hardcoded
    `fetchTrendByCategory(owner, repo, 'coverage', p.default_branch, 20, fetch)` call
    (`+page.ts:16`).
- `dashboard/src/routes/[owner]/[repo]/+page.ts`: read `url.searchParams.get('range') ?? '7d'`
  (same pattern as the existing `metric`/`branch` reads at lines 8/14), pass through.
- `dashboard/src/routes/[owner]/[repo]/+page.svelte`: add a second segmented-control button group
  for range selection, cloning the existing `.metric-tabs` markup/CSS pattern (lines 56–65 for
  markup, 209–242 for styles) and wiring through the existing `updateParams()` helper
  (lines 15–19) exactly like the metric tabs do. Replace the hardcoded `"Last 30 days"` text
  (line 107) with a label derived from the selected range.
- `dashboard/src/routes/+page.svelte` / `MultiSparkLine.svelte` / `SparkLine.svelte`: no
  windowing logic changes needed (per the key insight above) — only a styling change:
  - Extract `hexAlpha` + `gradientFill` out of `TrendChart.svelte` (currently defined inline,
    `TrendChart.svelte:27-41`) into a small shared util, e.g.
    `dashboard/src/lib/chartFill.ts`, and use it from `SparkLine.svelte` and
    `MultiSparkLine.svelte` too, so list-page sparklines get the same gradient-fill treatment as
    the detail page's charts (per-series color, low alpha so overlapping fills in the multi-line
    case stay legible).

## Tests

Add cases (likely in `test/db.test.ts` for the windowing/anchoring logic directly, and
`test/api.test.ts` for the route-level `range`/`align` params — check existing structure in both
files first and follow their seeding conventions):

- A category with a single data point + a short window (`15m`) produces exactly two points
  (anchor + real), same value, `windowStart` and `latestTs` respectively — the flat-line
  degenerate case.
- A category with real history both inside and before the window: anchor value matches the
  closest prior row, not an average of multiple prior rows.
- A `30d` window that spans past the 14-day raw retention boundary correctly sources the older
  anchor from `coverage_daily` when `coverage_runs` has already been pruned.
- **Regression guard for the `recorded_at` trap**: for a `15m`/`1h`/`12h` window, assert the
  anchor point and the latest point have *distinct* timestamps (not just distinct values) — this
  is exactly the bug the day-collapsed format would silently reintroduce.
- `align: true` with two categories having non-overlapping recent history: both series end up
  spanning the identical `[windowStart, sharedRightEdge]` domain, with the staler category's
  final point being a forward-carried duplicate of its last real value.
- Invalid `range` value on the API route → `422`.
- Existing `npm test` suite stays green (currently 108/108).

## Verification

- `npm run dev` (worker + dashboard together, as in the previous session), reusing the existing
  local seed data (`ZeroStash/coverage-tracker`, `default` + `frontend` categories) which already
  demonstrates the non-overlapping-history case.
- Playwright screenshots (script pattern from the previous session, run from inside `dashboard/`
  for `node_modules` resolution) confirming:
  - Detail page: cycling through all six range buttons updates the chart and label; a
    genuinely single-point category (seed one if the current data doesn't have one) renders as a
    full-width flat line with the dot pinned at the right edge, not a lone dot with a
    years-wide empty axis.
  - List page: the two-category overlay card now shows both lines spanning the full card width,
    in distinct fill colors, ending at the same right edge.
- `npm test` (108/108 baseline + new cases) and `npm run typecheck` (both root and `dashboard/`)
  clean.
