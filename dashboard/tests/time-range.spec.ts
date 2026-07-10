import { test, expect } from './coverage-fixture.js';
import { mockApi } from './helpers.js';

const MOCK_GROUPED_TREND_ONE_CATEGORY = {
  project: 'testorg/repo',
  branch: 'main',
  metric: 'coverage',
  categories: [
    {
      category: 'default',
      data: [
        { commit_sha: 'aaa1', value: 88, unit: '%', recorded_at: '2026-01-01' },
        { commit_sha: 'aaa2', value: 92, unit: '%', recorded_at: '2026-01-02' },
      ],
    },
  ],
};

const RANGE_KEYS = ['15m', '1h', '12h', '1d', '7d', '30d'];

test.describe('project detail page — time range selector', () => {
  let requestedUrls: string[];

  test.beforeEach(async ({ page }) => {
    requestedUrls = [];
    await mockApi(page);
    // Overrides mockApi()'s categories route (LIFO — registered later wins) so we can
    // both serve real data and record every /metrics/categories request that fires.
    await page.route('**/api/projects/testorg/repo/metrics/categories*', (route) => {
      requestedUrls.push(route.request().url());
      return route.fulfill({ json: MOCK_GROUPED_TREND_ONE_CATEGORY });
    });
    await page.goto('/testorg/repo');
    await page.waitForSelector('[role="tablist"]');
  });

  test('defaults to the 7d button selected, with no range param in the URL', async ({ page }) => {
    const sevenDay = page.getByRole('tab', { name: '7d', exact: true });
    await expect(sevenDay).toHaveAttribute('aria-selected', 'true');
    expect(new URL(page.url()).searchParams.get('range')).toBeNull();
  });

  test('renders one button for every range key, none selected but 7d', async ({ page }) => {
    for (const key of RANGE_KEYS) {
      const tab = page.getByRole('tab', { name: key, exact: true });
      await expect(tab).toBeVisible();
      await expect(tab).toHaveAttribute('aria-selected', key === '7d' ? 'true' : 'false');
    }
  });

  test('clicking a range button selects it, updates the URL, and refetches with that range', async ({ page }) => {
    await page.getByRole('tab', { name: '30d', exact: true }).click();

    await expect(page.getByRole('tab', { name: '30d', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tab', { name: '7d', exact: true })).toHaveAttribute('aria-selected', 'false');
    expect(new URL(page.url()).searchParams.get('range')).toBe('30d');

    const last = requestedUrls.at(-1);
    expect(last).toBeTruthy();
    expect(new URL(last!).searchParams.get('range')).toBe('30d');
  });

  test('switching ranges updates the "Last {range}" label', async ({ page }) => {
    await expect(page.locator('.trend-desc')).toContainText('Last 7d');

    await page.getByRole('tab', { name: '1h', exact: true }).click();
    await expect(page.locator('.trend-desc')).toContainText('Last 1h');
  });

  test('selecting a range does not change the active metric tab', async ({ page }) => {
    await page.getByRole('tab', { name: '1d', exact: true }).click();
    await expect(page.getByRole('tab', { name: 'Coverage', exact: true })).toHaveAttribute('aria-selected', 'true');
  });
});

test.describe('project detail page — range URL param handling', () => {
  test.beforeEach(async ({ page }) => {
    await mockApi(page);
    await page.route('**/api/projects/testorg/repo/metrics/categories*', (route) =>
      route.fulfill({ json: MOCK_GROUPED_TREND_ONE_CATEGORY }),
    );
  });

  test('a valid range in the URL pre-selects the matching button', async ({ page }) => {
    await page.goto('/testorg/repo?range=12h');
    await page.waitForSelector('[role="tablist"]');
    await expect(page.getByRole('tab', { name: '12h', exact: true })).toHaveAttribute('aria-selected', 'true');
  });

  test('an unknown range in the URL falls back to the 7d default', async ({ page }) => {
    await page.goto('/testorg/repo?range=3weeks');
    await page.waitForSelector('[role="tablist"]');
    await expect(page.getByRole('tab', { name: '7d', exact: true })).toHaveAttribute('aria-selected', 'true');
  });
});
