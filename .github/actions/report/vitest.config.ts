import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      // 'lcov' emits coverage/lcov.info — the zero-config probe target the
      // dogfood self-test (action-test.yml) consumes end-to-end.
      reporter: ['json-summary', 'lcov', 'text'],
      reportsDirectory: 'coverage',
    },
  },
});
