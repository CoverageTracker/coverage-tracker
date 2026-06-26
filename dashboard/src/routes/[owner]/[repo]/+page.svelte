<script lang="ts">
  import { browser } from '$app/environment';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import TrendChart from '$lib/components/TrendChart.svelte';
  import { METRICS } from '$lib/types';

  let { data } = $props();

  let branchInput = $state('');

  function updateParams(updates: Record<string, string>) {
    const params = new URLSearchParams($page.url.searchParams);
    for (const [k, v] of Object.entries(updates)) params.set(k, v);
    goto(`?${params.toString()}`, { keepFocus: true, invalidateAll: true });
  }

  function applyBranch(e: SubmitEvent) {
    e.preventDefault();
    updateParams({ branch: branchInput });
  }

  $effect(() => {
    branchInput = data.branch;
  });
</script>

<svelte:head>
  <title>{data.project.full_slug} — Coverage Tracker</title>
</svelte:head>

<nav class="breadcrumb">
  <a href="/">Projects</a>
  <span aria-hidden="true">›</span>
  <span>{data.project.full_slug}</span>
</nav>

<h1>{data.project.repo_name}</h1>
<p class="meta">
  <span>{data.project.owner_login}</span>
  <span class="dot" aria-hidden="true">·</span>
  <code>{data.project.full_slug}</code>
</p>

<div class="controls">
  <div class="metric-tabs" role="tablist" aria-label="Metric">
    {#each METRICS as m}
      <button
        role="tab"
        aria-selected={data.metric === m}
        class:active={data.metric === m}
        onclick={() => updateParams({ metric: m })}
      >{m}</button>
    {/each}
  </div>

  <form class="branch-form" onsubmit={applyBranch}>
    <label for="branch-input">Branch</label>
    <input
      id="branch-input"
      type="text"
      bind:value={branchInput}
      placeholder={data.project.default_branch}
      spellcheck={false}
    />
    <button type="submit">Go</button>
  </form>
</div>

{#if data.trend.data.length === 0}
  <p class="empty">
    No data for <code>{data.metric}</code> on branch <code>{data.branch}</code>.
  </p>
{:else if browser}
  <TrendChart
    data={data.trend.data}
    metric={data.metric}
    unit={data.trend.data[0]?.unit ?? ''}
  />
{/if}

<style>
  .breadcrumb {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    font-size: 0.85rem;
    margin-bottom: 1rem;
    color: var(--color-muted);
  }

  .breadcrumb a {
    color: var(--color-link);
    text-decoration: none;
  }

  .breadcrumb a:hover {
    text-decoration: underline;
  }

  h1 {
    margin: 0 0 0.25rem;
    font-size: 1.5rem;
    font-weight: 700;
    letter-spacing: -0.02em;
  }

  .meta {
    margin: 0 0 1.5rem;
    color: var(--color-muted);
    font-size: 0.85rem;
    display: flex;
    align-items: center;
    gap: 0.375rem;
  }

  .dot {
    color: var(--color-border);
  }

  .controls {
    display: flex;
    align-items: center;
    gap: 1.5rem;
    margin-bottom: 1.5rem;
    flex-wrap: wrap;
  }

  .metric-tabs {
    display: flex;
    gap: 0.25rem;
  }

  .metric-tabs button {
    padding: 0.35rem 0.75rem;
    border: 1px solid var(--color-border);
    border-radius: 0.375rem;
    background: transparent;
    cursor: pointer;
    font-size: 0.85rem;
    color: var(--color-text);
    transition:
      background 0.1s,
      border-color 0.1s,
      color 0.1s;
  }

  .metric-tabs button.active {
    background: var(--color-accent);
    border-color: var(--color-accent);
    color: #0f172a;  /* near-black: 4.7:1 on blue-500, 6.6:1 on blue-400 — WCAG AA both modes */
  }

  .metric-tabs button:not(.active):hover {
    border-color: var(--color-accent);
    color: var(--color-accent);
  }

  .branch-form {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.85rem;
  }

  .branch-form label {
    color: var(--color-muted);
  }

  .branch-form input {
    padding: 0.3rem 0.5rem;
    border: 1px solid var(--color-border);
    border-radius: 0.375rem;
    font-family: var(--font-mono);
    font-size: 0.85rem;
    background: var(--color-bg);
    color: var(--color-text);
    width: 12rem;
    outline: none;
  }

  .branch-form input:focus {
    border-color: var(--color-accent);
    box-shadow: 0 0 0 2px var(--color-accent-faint);
  }

  .branch-form button {
    padding: 0.3rem 0.625rem;
    border: 1px solid var(--color-border);
    border-radius: 0.375rem;
    background: transparent;
    cursor: pointer;
    font-size: 0.85rem;
    color: var(--color-text);
    transition:
      border-color 0.1s,
      color 0.1s;
  }

  .branch-form button:hover {
    border-color: var(--color-accent);
    color: var(--color-accent);
  }

  .empty {
    color: var(--color-muted);
    margin: 0;
  }
</style>
