import { readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { exportJWK, exportPKCS8, generateKeyPair, type JWK } from 'jose';
import type { GlobalSetupContext } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    migrations: Array<{ name: string; queries: string[] }>;
    // A fresh RSA keypair generated once per test run (never written to disk),
    // shared between the outboundService callback in vitest.config.mts (which
    // runs in this Node host process) and test files (which run inside a
    // separate workerd isolate) via vitest's provide/inject bridge. See
    // test/helpers/crypto.ts.
    oidcTestPrivateKeyPem: string;
    oidcTestPublicJwk: JWK;
  }
}

export default async function ({ provide }: GlobalSetupContext) {
  const migrations = await readD1Migrations('./migrations');
  provide('migrations', migrations);

  const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
  provide('oidcTestPrivateKeyPem', await exportPKCS8(privateKey));
  provide('oidcTestPublicJwk', await exportJWK(publicKey));
}
