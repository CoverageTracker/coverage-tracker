# Add category selection to the "Create status badge" modal

## Context

Coverage/complexity/duplication data can already be tracked per **category** — a free-form
label (`coverage_runs.category` / `coverage_daily.category`, migration `0003_categories.sql`)
that partitions independent report series within one project (e.g. "backend" vs "frontend").
The main project dashboard already renders one trend card per discovered category
(`dashboard/src/routes/[owner]/[repo]/+page.svelte`), and the PR-check/baseline endpoint
already reads a `?category=` query param (`src/routes/baseline.ts`).

The "Create status badge" modal (`BadgeModal.svelte`) and its backend
(`src/routes/badge.ts`) were never updated for this: the modal only lets a user pick a
**metric** (coverage, complexity, duplication, etc.) and always produces a badge URL with no
category, and the badge endpoint always reads the `'default'` category regardless of what's
requested. Users with categorized projects can't get a status badge for anything but the
implicit default series. This plan adds a category picker to the modal and wires it through
to the badge endpoint, including the generated badge's label, for all metric types.

## Backend: `src/routes/badge.ts`

`getLatestCoverage(db, projectId, branch, category)` already accepts a `category` param
(default `'default'`) — `src/lib/db.ts:274`. `badge.ts` just never passes it through. Change:

- Read `const category = c.req.query('category') ?? 'default';` (same pattern as
  `src/routes/api.ts:35` and `baseline.ts`).
- Pass it into `getLatestCoverage(c.env.DB, project.id, project.default_branch, category)`.
- Include the category in the returned `label` when it isn't the default, so the badge itself
  communicates which series it's showing:
  ```ts
  label: category === 'default' ? metricName : `${category} ${metricName}`,
  ```
- No new validation needed — an unknown/malformed category simply yields no matching row and
  `getLatestCoverage` returns `null`, which already 404s (consistent with how `baseline.ts`/
  `api.ts` treat category as an unvalidated read-side filter).

This applies uniformly to every metric type (`coverage`, `branch_coverage`, `complexity`,
`cognitive`, `duplication`, `maintainability`) since category is orthogonal to metric — one
category row carries all metric columns.

## Frontend: `dashboard/src/lib/components/BadgeModal.svelte`

1. Add a `defaultBranch: string` prop (needed to query categories for the right branch; the
   badge endpoint itself always uses the project's default branch, so the picker must match).
2. Add state:
   - `categories = $state<string[]>(['default'])`
   - `selectedCategory = $state('default')`
3. Fetch categories whenever the selected metric changes, reusing the existing helper
   `fetchTrendByCategory(owner, repo, selectedMetric, defaultBranch, 1)` from
   `dashboard/src/lib/api.ts:25` (already used by the project page to discover categories) —
   no new endpoint required. On response, take `result.categories.map(c => c.category)`;
   fall back to `['default']` on an empty list or fetch error. If the current
   `selectedCategory` isn't in the new list, reset it to `categories[0] ?? 'default'`.
   - Doing this per-metric (rather than once) is intentional: a category with no data for the
     currently selected metric wouldn't produce a working badge anyway (`getLatestCoverage`
     would return a null value for that column), so scoping the picker to
     metric+category combinations that actually have data avoids offering dead combinations.
4. Add a second `<select>` next to the existing metric select (mirroring its markup/styles at
   lines 151–158), labeled "Category", bound to `selectedCategory`, listing `categories`.
5. Update the derived badge URL (`badgeEndpointUrl`, lines 32–34) to append
   `?category=${selectedCategory}` only when `selectedCategory !== 'default'`, so existing
   badges for uncategorized projects keep their current clean URL.
6. Update the alt text / markdown snippet (line 38) to mention the category when non-default,
   e.g. `` `${selectedMetric}${selectedCategory !== 'default' ? ` (${selectedCategory})` : ''} badge` ``,
   matching the label convention used server-side.

## Wiring: `dashboard/src/routes/[owner]/[repo]/+page.svelte`

Pass the new prop at the existing `<BadgeModal ... />` call (lines 143–149):
```svelte
<BadgeModal
  owner={data.project.owner_login}
  repo={data.project.repo_name}
  projectId={data.project.id}
  badgeEnabled={data.project.badge_enabled}
  defaultBranch={data.project.default_branch}
  onclose={() => (badgeModalOpen = false)}
/>
```

## Tests: `test/badge.test.ts`

Extend the existing helpers and add cases:
- Extend `seedCoverage()` to accept a `category` field (default `'default'`), inserting into
  the `category` column.
- Extend `getBadge()` to accept an optional `category` and append it as a `?category=`
  query param.
- New cases:
  - A badge for a non-default category returns the correct value when that category has its
    own coverage row (distinct from the `'default'` row for the same project).
  - The label includes the category name when non-default (e.g. `"backend coverage"`), and
    stays as just the metric name when `category` is omitted/`'default'`.
  - Requesting a category with no data 404s even when the `'default'` category has data for
    that metric.
  - Do this for at least one non-coverage metric (e.g. `complexity`/`cyclomatic` or
    `duplication`) to confirm category plumbing isn't coverage-specific.

## Verification

- `npm test` (badge.test.ts additions) to confirm backend category filtering + label logic.
- `npm run dev` (dashboard + worker together): seed a project with two categories via the CI
  ingest endpoint (or local seed SQL), open "Create status badge", switch the category
  dropdown, and confirm:
  - The metric/category combinations with data render badge previews and correct shields.io
    URLs (`?category=` present only for non-default).
  - Switching metric re-fetches/re-scopes the category list appropriately.
  - Existing single-category (`'default'`) projects are unaffected — URL has no `category`
    query param and label is unchanged from current behavior.
