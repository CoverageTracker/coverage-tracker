import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mockApi } from '../helpers.js';

for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(`projects listing — ${colorScheme} mode`, () => {
    test.beforeEach(async ({ page }) => {
      await mockApi(page);
      await page.emulateMedia({ colorScheme });
      await page.goto('/');
      // Wait for the async load function to resolve and a project card to render
      await page.waitForSelector('.card');
    });

    test('has no WCAG 2.0 AA violations', async ({ page }) => {
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa'])
        .analyze();
      expect(results.violations).toEqual([]);
    });
  });

  test.describe(`project detail page — ${colorScheme} mode`, () => {
    test.beforeEach(async ({ page }) => {
      await mockApi(page);
      await page.emulateMedia({ colorScheme });
      await page.goto('/testorg/repo');
      // The tablist is part of the page template and appears once the load function resolves
      await page.waitForSelector('[role="tablist"]');
    });

    test('has no WCAG 2.0 AA violations', async ({ page }) => {
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa'])
        .analyze();
      expect(results.violations).toEqual([]);
    });
  });
}
