import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.json' },
    }),
  ],
  test: {
    globalSetup: ['./test/global-setup.ts'],
    setupFiles: ['./test/migrate.ts'],
    include: ['test/**/*.test.ts'],
  },
});
