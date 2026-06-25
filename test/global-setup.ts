import { readD1Migrations } from '@cloudflare/vitest-pool-workers';
import type { GlobalSetupContext } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    migrations: Array<{ name: string; queries: string[] }>;
  }
}

export default async function ({ provide }: GlobalSetupContext) {
  const migrations = await readD1Migrations('./migrations');
  provide('migrations', migrations);
}
