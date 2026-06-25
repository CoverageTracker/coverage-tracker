// Disable SSR and prerendering — this is a pure SPA served as static assets.
// Dynamic routes like /[owner]/[repo] cannot be enumerated at build time.
export const ssr = false;
export const prerender = false;
