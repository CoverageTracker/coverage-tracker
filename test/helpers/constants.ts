// No vitest-context dependency (unlike crypto.ts, which calls inject()) so this
// is safe to import from vitest.config.mts's outboundService callback too.
export const OIDC_JWKS_URL = 'https://token.actions.githubusercontent.com/.well-known/jwks';
export const OIDC_KID = 'test-oidc-key';
