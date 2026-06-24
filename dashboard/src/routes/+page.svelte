<script lang="ts">
  import { browser } from '$app/environment';
  import SparkLine from '$lib/components/SparkLine.svelte';
  import type { MetricPoint } from '$lib/types';

  let { data } = $props();

  function sparklineData(trend: MetricPoint[]): { timestamps: number[]; values: number[] } {
    return {
      timestamps: trend.map((p) => new Date(p.recorded_at).getTime() / 1000),
      values: trend.map((p) => p.value),
    };
  }
</script>

<svelte:head>
  <title>Coverage Tracker</title>
</svelte:head>

<h1>Projects</h1>

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
              <span class="metric-label">coverage</span>
            </div>
          {:else}
            <span class="no-data">no data yet</span>
          {/if}
          {#if browser && project.coverageTrend.length > 1}
            {@const sd = sparklineData(project.coverageTrend)}
            <SparkLine timestamps={sd.timestamps} values={sd.values} />
          {/if}
        </div>
      </a>
    {/each}
  </div>
{/if}

<style>
  h1 {
    margin: 0 0 1.5rem;
    font-size: 1.5rem;
    font-weight: 700;
    letter-spacing: -0.02em;
  }

  .empty {
    color: var(--color-muted);
    margin: 0;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 1rem;
  }

  .card {
    display: flex;
    flex-direction: column;
    gap: 0.875rem;
    padding: 1rem;
    border: 1px solid var(--color-border);
    border-radius: 0.5rem;
    text-decoration: none;
    color: inherit;
    transition:
      border-color 0.15s,
      box-shadow 0.15s;
  }

  .card:hover {
    border-color: var(--color-accent);
    box-shadow: 0 0 0 3px var(--color-accent-faint);
  }

  .card-header {
    display: flex;
    align-items: center;
    gap: 0.625rem;
  }

  .avatar {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .card-title {
    min-width: 0;
  }

  .slug {
    font-weight: 600;
    font-size: 0.875rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .branch {
    font-size: 0.75rem;
    color: var(--color-muted);
    font-family: var(--font-mono);
    margin-top: 0.125rem;
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
    font-size: 1.5rem;
    font-weight: 700;
    color: var(--color-accent);
    line-height: 1;
  }

  .metric-label {
    font-size: 0.7rem;
    color: var(--color-muted);
    margin-top: 0.2rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .no-data {
    font-size: 0.8rem;
    color: var(--color-muted);
    font-style: italic;
  }
</style>
