import { describe, it, expect, beforeEach } from 'vitest';
import { env, createExecutionContext, waitOnExecutionContext, createScheduledController } from 'cloudflare:test';
import worker from '../src/index';
import type { Bindings } from '../src/types';

// @ts-expect-error cloudflare:test injects env at runtime
const testEnv = env as Bindings;

beforeEach(async () => {
  await testEnv.DB.prepare(
    `INSERT OR IGNORE INTO owners (id, github_id, login, type) VALUES (1, 1, 'testorg', 'Organization')`,
  ).run();
  await testEnv.DB.prepare(
    `INSERT OR IGNORE INTO projects (id, owner_id, github_repo_id, repo_name, full_slug, installation_id, default_branch)
     VALUES (1, 1, 1, 'repo', 'testorg/repo', 1, 'main')`,
  ).run();
  await testEnv.DB.prepare('DELETE FROM coverage_daily').run();
  await testEnv.DB.prepare('DELETE FROM coverage_runs').run();
});

describe('scheduled() cron entry point', () => {
  it('runs rollupAndPrune via ctx.waitUntil and prunes old runs into coverage_daily', async () => {
    const now = Math.floor(Date.now() / 1000);
    const old = now - 15 * 86400; // beyond the 14-day retention window

    await testEnv.DB.prepare(
      `INSERT INTO coverage_runs (project_id, commit_sha, branch, ran_at, line_coverage)
       VALUES (1, 'sha-old', 'main', ?1, 82.0),
              (1, 'sha-new', 'main', ?2, 91.0)`,
    ).bind(old, now).run();

    const ctx = createExecutionContext();
    const controller = createScheduledController();
    // index.ts's scheduled() handler never reads its first argument — it exists
    // only to satisfy the ScheduledExportedHandler signature.
    await worker.scheduled(controller as never, testEnv, ctx);
    // scheduled() fires ctx.waitUntil(rollupAndPrune(env)) as a background promise;
    // without this, D1 assertions below would race that unawaited promise.
    await waitOnExecutionContext(ctx);

    const remaining = await testEnv.DB.prepare('SELECT commit_sha FROM coverage_runs').all<{ commit_sha: string }>();
    expect(remaining.results.map((r) => r.commit_sha)).toEqual(['sha-new']);

    const daily = await testEnv.DB.prepare(
      'SELECT line_coverage FROM coverage_daily WHERE project_id = 1',
    ).first<{ line_coverage: number }>();
    expect(daily?.line_coverage).toBe(82.0);
  });
});
