<script lang="ts">
  import { browser } from '$app/environment';
  import SparkLine from '$lib/components/SparkLine.svelte';
  import { theme } from '$lib/theme.svelte';
  import type { MetricPoint } from '$lib/types';

  let { data } = $props();

  function sparklineData(trend: MetricPoint[]): { timestamps: number[]; values: number[] } {
    return {
      timestamps: trend.map((p) => new Date(p.recorded_at).getTime() / 1000),
      values: trend.map((p) => p.value),
    };
  }

  function avatarLetter(slug: string): string {
    return (slug.match(/[a-z0-9]/i)?.[0] ?? '?').toUpperCase();
  }

  // Derive owner name for subtitle
  const ownerName = $derived(
    data.projects.length > 0
      ? data.projects[0].full_slug.split('/')[0]
      : null,
  );
</script>

<svelte:head>
  <title>Coverage Tracker</title>
</svelte:head>

<div class="page">
  <div class="page-header">
    <h1>Projects</h1>
    {#if data.projects.length > 0}
      <p class="subtitle">{data.projects.length} {data.projects.length === 1 ? 'repository' : 'repositories'}{ownerName ? ` · ${ownerName}` : ''}</p>
    {/if}
  </div>

  {#if data.projects.length === 0}
    <p class="empty">
      No projects registered yet. Install the GitHub App on your repos to start tracking.
    </p>
  {:else}
    <div class="grid">
      {#each data.projects as project (project.id)}
        {@const [owner, repo] = project.full_slug.split('/')}
        <a href="/{owner}/{repo}" class="card">
          <div class="card-header">
            {#if project.owner_avatar_url}
              <img src={project.owner_avatar_url} alt={project.owner_login} class="avatar" />
            {:else}
              <span class="avatar avatar-fallback" aria-hidden="true">
                {avatarLetter(project.full_slug)}
              </span>
            {/if}
            <div class="card-title">
              <div class="slug">{project.full_slug}</div>
              <div class="branch">{project.default_branch}</div>
            </div>
          </div>
          <div class="card-body">
            {#if project.latestCoverage}
              <div class="metric">
                <span class="metric-value">{project.latestCoverage.value.toFixed(1)}%</span>
                <span class="metric-label">Coverage</span>
              </div>
            {:else}
              <span class="no-data">no data yet</span>
            {/if}
            {#if browser && project.coverageTrend.length > 1}
              {@const sd = sparklineData(project.coverageTrend)}
              <SparkLine timestamps={sd.timestamps} values={sd.values} color={theme.tokens.chart[0]} />
            {/if}
          </div>
        </a>
      {/each}
    </div>
  {/if}
</div>

<style>
  .page {
    max-width: 1180px;
    margin: 0 auto;
    padding: 30px 24px 72px;
  }

  .page-header {
    margin-bottom: 24px;
  }

  h1 {
    margin: 0 0 4px;
    font-family: var(--font-mono);
    font-size: 26px;
    font-weight: 700;
    color: var(--text);
    letter-spacing: -0.01em;
  }

  .subtitle {
    margin: 0;
    font-size: 13px;
    color: var(--muted);
  }

  .empty {
    color: var(--muted);
    margin: 0;
    font-size: 13px;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: 16px;
  }

  .card {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 16px;
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    text-decoration: none;
    color: inherit;
    transition:
      border-color 0.12s,
      box-shadow 0.12s;
  }

  .card:hover {
    border-color: var(--primary);
    box-shadow: 0 0 0 3px var(--ring);
  }

  .card-header {
    display: flex;
    align-items: center;
    gap: 11px;
  }

  .avatar {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .avatar-fallback {
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--accent-fill);
    color: var(--primary);
    border: 1px solid var(--border);
    font-family: var(--font-mono);
    font-weight: 700;
    font-size: 14px;
  }

  .card-title {
    min-width: 0;
  }

  .slug {
    font-family: var(--font-mono);
    font-weight: 600;
    font-size: 13.5px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text);
  }

  .branch {
    font-family: var(--font-mono);
    font-size: 11.5px;
    color: var(--muted);
    margin-top: 2px;
  }

  .card-body {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 48px;
  }

  .metric {
    display: flex;
    flex-direction: column;
  }

  .metric-value {
    font-family: var(--font-mono);
    font-size: 26px;
    font-weight: 700;
    color: var(--primary);
    line-height: 1;
  }

  .metric-label {
    font-size: 10.5px;
    font-weight: 500;
    color: var(--muted);
    margin-top: 3px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .no-data {
    font-size: 13px;
    color: var(--muted);
    font-style: italic;
  }
</style>
