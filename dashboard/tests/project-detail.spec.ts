import AxeBuilder from '@axe-core/playwright';
import { test, expect } from './coverage-fixture.js';
import { mockApi } from './helpers.js';

const MOCK_GROUPED_TREND_TWO_CATEGORIES = {
  project: 'testorg/repo',
  branch: 'main',
  metric: 'coverage',
  categories: [
    {
      category: 'backend',
      data: [
        { commit_sha: 'aaa1', value: 88, unit: '%', recorded_at: '2026-01-01' },
        { commit_sha: 'aaa2', value: 92, unit: '%', recorded_at: '2026-01-02' },
      ],
    },
    {
      category: 'frontend',
      data: [
        { commit_sha: 'bbb1', value: 40, unit: '%', recorded_at: '2026-01-01' },
        { commit_sha: 'bbb2', value: 45, unit: '%', recorded_at: '2026-01-02' },
      ],
    },
  ],
};

test.describe('project detail page — multiple categories', () => {
  test.beforeEach(async ({ page }) => {
    await mockApi(page);
    // Override the categories mock registered by mockApi() with a two-category
    // fixture — Playwright's LIFO route priority means this registration (made
    // after mockApi()'s) wins.
    await page.route('**/api/projects/testorg/repo/metrics/categories*', (route) =>
      route.fulfill({ json: MOCK_GROUPED_TREND_TWO_CATEGORIES }),
    );
    await page.goto('/testorg/repo');
    await page.waitForSelector('[role="tablist"]');
  });

  test('renders one stacked chart card per category', async ({ page }) => {
    const cards = page.locator('.trend-card');
    await expect(cards).toHaveCount(2);

    await expect(cards.nth(0)).toContainText('backend');
    await expect(cards.nth(1)).toContainText('frontend');

    // Each card's latest value reflects its own series, not a shared one.
    await expect(cards.nth(0)).toContainText('92.0%');
    await expect(cards.nth(1)).toContainText('45.0%');
  });

  test('stacks cards vertically, not side by side', async ({ page }) => {
    const cards = page.locator('.trend-card');
    const [firstBox, secondBox] = await Promise.all([
      cards.nth(0).boundingBox(),
      cards.nth(1).boundingBox(),
    ]);
    expect(firstBox).not.toBeNull();
    expect(secondBox).not.toBeNull();
    // Second card starts below where the first one ends -> vertical stack.
    expect(secondBox!.y).toBeGreaterThanOrEqual(firstBox!.y + firstBox!.height);
  });

  test('has no WCAG 2.0 AA violations with two stacked category charts rendered', async ({ page }) => {
    await expect(page.locator('.trend-card')).toHaveCount(2);
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      // Theme palette colors are intentional; color-contrast is excluded (matches tests/a11y/axe.spec.ts)
      .disableRules(['color-contrast'])
      .analyze();
    expect(results.violations).toEqual([]);
  });
});
