import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import istanbul from 'vite-plugin-istanbul';

export default defineConfig({
  plugins: [
    sveltekit(),
    // Instruments src/ for line-coverage collection during Playwright e2e runs
    // (npm run test:e2e:coverage). Gated behind VITE_COVERAGE so plain `vite dev`
    // and `test:e2e` stay uninstrumented.
    istanbul({
      include: 'src/*',
      exclude: ['node_modules', 'tests/'],
      extension: ['.js', '.ts', '.svelte'],
      requireEnv: true,
    }),
  ],
});
