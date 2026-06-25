import { env, applyD1Migrations } from 'cloudflare:test';
import { beforeAll, inject } from 'vitest';
import type { Bindings } from '../src/types';

beforeAll(async () => {
  const migrations = inject('migrations');
  // @ts-expect-error env cast
  await applyD1Migrations((env as unknown as Bindings).DB, migrations);
});
