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
    coverage: {
      // v8 native coverage is unsupported under workerd; the Workers pool
      // requires the instrumented Istanbul provider.
      provider: 'istanbul',
      // 'lcov' emits coverage/lcov.info — the zero-config probe path the
      // report Action auto-detects.
      reporter: ['lcov', 'text', 'json-summary'],
      reportsDirectory: 'coverage',
      include: ['src/**'],
    },
  },
});
