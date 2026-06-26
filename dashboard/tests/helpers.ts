import type { Page } from '@playwright/test';

export const MOCK_PROJECT = {
  id: 1,
  owner_id: 1,
  github_repo_id: 1,
  repo_name: 'repo',
  full_slug: 'testorg/repo',
  installation_id: 1,
  default_branch: 'main',
  badge_enabled: 0,
  created_at: '2026-01-01T00:00:00Z',
  owner_login: 'testorg',
  owner_type: 'Organization',
  owner_avatar_url: null, // null avoids external image requests in tests
};

export const MOCK_TREND_EMPTY = {
  project: 'testorg/repo',
  branch: 'main',
  metric: 'coverage',
  data: [],
};

/**
 * Intercepts all /api/* requests so tests run without a live Worker backend.
 * Register this before page.goto() so routes are in place before any fetch fires.
 *
 * Playwright matches routes in LIFO order — the last-registered handler has the
 * highest priority. Register the catch-all first so specific routes registered
 * afterwards take precedence over it.
 */
export async function mockApi(page: Page): Promise<void> {
  // Catch-all registered first = lowest priority; absorbs unmocked /api/* requests
  await page.route('**/api/**', (route) =>
    route.fulfill({ status: 404, body: 'Not found' }),
  );
  // Specific routes registered last = highest priority (override the catch-all)
  await page.route('**/api/projects/testorg/repo/metrics*', (route) =>
    route.fulfill({ json: MOCK_TREND_EMPTY }),
  );
  await page.route('**/api/projects', (route) =>
    route.fulfill({ json: [MOCK_PROJECT] }),
  );
}
