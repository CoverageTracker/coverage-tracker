import { test as base, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

// Drop-in replacement for `@playwright/test`'s `test` — auto-dumps each test's
// browser-side Istanbul coverage (window.__coverage__, populated by
// vite-plugin-istanbul when VITE_COVERAGE=true) to .nyc_output/ so
// `nyc report` can turn it into coverage/lcov.info afterwards. A no-op when
// the app wasn't instrumented (plain `npm run test:e2e`).
export const test = base.extend<{ collectCoverage: void }>({
  collectCoverage: [
    async ({ page }, use, testInfo) => {
      await use();

      const coverage = await page
        .evaluate(() => (window as unknown as { __coverage__?: unknown }).__coverage__)
        .catch(() => undefined);
      if (!coverage) return;

      const dir = path.join(process.cwd(), '.nyc_output');
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `${testInfo.testId}-${Date.now()}.json`);
      fs.writeFileSync(file, JSON.stringify(coverage));
    },
    { auto: true },
  ],
});

export { expect };
