import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { githubOutboundService } from './test/helpers/outbound';

export default defineConfig({
  plugins: [
    cloudflareTest(async ({ inject }) => {
      // Generated once in test/global-setup.ts and read here via the injected
      // `inject`, not the plain `vitest` import — only this reference is
      // guaranteed to resolve provide()d values from the plugin-options callback.
      const oidcJwk = inject('oidcTestPublicJwk');
      return {
        wrangler: { configPath: './wrangler.json' },
        miniflare: {
          // fetchMock isn't exported by cloudflare:test in this pool version, so GitHub
          // API + JWKS calls made by the worker under test are intercepted here instead.
          outboundService: (request: Request) => githubOutboundService(request, oidcJwk),
        },
      };
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
