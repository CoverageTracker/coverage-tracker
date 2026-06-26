<script lang="ts">
  import { browser } from '$app/environment';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import TrendChart from '$lib/components/TrendChart.svelte';
  import { theme } from '$lib/theme.svelte';
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

  // Delta badge: latest value vs. previous point
  const latestValue = $derived(
    data.trend.data.length > 0 ? data.trend.data[data.trend.data.length - 1].value : null,
  );
  const prevValue = $derived(
    data.trend.data.length > 1 ? data.trend.data[data.trend.data.length - 2].value : null,
  );
  const delta = $derived(
    latestValue !== null && prevValue !== null ? latestValue - prevValue : null,
  );
  const unit = $derived(data.trend.data[0]?.unit ?? '');

  // Chart color for the active metric
  const metricChartColor = $derived(
    theme.tokens.chart[METRICS.indexOf(data.metric as (typeof METRICS)[number])] ??
      theme.tokens.chart[0],
  );
</script>

<svelte:head>
  <title>{data.project.full_slug} — Coverage Tracker</title>
</svelte:head>

<div class="page">
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
        >{m.charAt(0).toUpperCase() + m.slice(1)}</button>
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
      No data for <code>{data.metric}</code> on branch <code>{data.branch}</code> yet.
    </p>
  {:else if browser}
    <div class="trend-card">
      <div class="trend-card-header">
        <div class="trend-card-meta">
          <span class="trend-title">{data.metric.charAt(0).toUpperCase() + data.metric.slice(1)} over time</span>
          <span class="trend-desc">Last 30 days · {data.branch}</span>
        </div>
        <div class="trend-card-value">
          {#if latestValue !== null}
            <span class="big-value">{latestValue.toFixed(1)}{unit}</span>
            {#if delta !== null}
              <span
                class="delta-badge"
                style="background:{metricChartColor}28; color:{metricChartColor}"
                aria-label="{delta >= 0 ? 'up' : 'down'} {Math.abs(delta).toFixed(1)}{unit}"
              >
                {delta >= 0 ? '▲' : '▼'} {delta >= 0 ? '+' : ''}{delta.toFixed(1)}{unit}
              </span>
            {/if}
          {/if}
        </div>
      </div>
      <TrendChart
        data={data.trend.data}
        metric={data.metric}
        unit={unit}
        color={metricChartColor}
        borderColor={theme.tokens.border}
        mutedColor={theme.tokens.muted}
        textColor={theme.tokens.text}
      />
    </div>
  {/if}
</div>

<style>
  .page {
    max-width: 1180px;
    margin: 0 auto;
    padding: 30px 24px 72px;
  }

  .breadcrumb {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    margin-bottom: 16px;
    color: var(--muted);
  }

  .breadcrumb a {
    color: var(--link);
    text-decoration: none;
  }

  .breadcrumb a:hover {
    text-decoration: underline;
  }

  h1 {
    margin: 0 0 4px;
    font-family: var(--font-mono);
    font-size: 26px;
    font-weight: 700;
    color: var(--text);
  }

  .meta {
    margin: 0 0 24px;
    color: var(--muted);
    font-size: 13px;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .dot {
    color: var(--border);
  }

  .controls {
    display: flex;
    align-items: center;
    gap: 20px;
    margin-bottom: 24px;
    flex-wrap: wrap;
  }

  /* Segmented control */
  .metric-tabs {
    display: flex;
    align-items: center;
    background: var(--elevated);
    padding: 4px;
    border-radius: calc(var(--radius) - 1px);
    gap: 4px;
  }

  .metric-tabs button {
    padding: 5px 12px;
    border: none;
    border-radius: calc(var(--radius) - 3px);
    background: transparent;
    cursor: pointer;
    font-family: var(--font-body);
    font-size: 13px;
    font-weight: 500;
    color: var(--muted);
    transition:
      background 0.12s,
      color 0.12s,
      box-shadow 0.12s;
  }

  .metric-tabs button.active {
    background: var(--card);
    color: var(--text);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.18);
  }

  .metric-tabs button:not(.active):hover {
    color: var(--text);
  }

  /* Branch form */
  .branch-form {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
  }

  .branch-form label {
    color: var(--muted);
    font-weight: 500;
  }

  .branch-form input {
    padding: 7px 10px;
    border: 1px solid var(--border);
    border-radius: calc(var(--radius) - 2px);
    font-family: var(--font-mono);
    font-size: 13px;
    background: var(--bg);
    color: var(--text);
    width: 170px;
    outline: none;
  }

  .branch-form input:focus {
    border-color: var(--primary);
    box-shadow: 0 0 0 2px var(--ring);
  }

  .branch-form button[type='submit'] {
    padding: 7px 14px;
    border: none;
    border-radius: calc(var(--radius) - 3px);
    background: var(--primary);
    color: var(--primary-fg);
    cursor: pointer;
    font-family: var(--font-body);
    font-size: 13px;
    font-weight: 600;
  }

  .branch-form button[type='submit']:hover {
    opacity: 0.9;
  }

  /* Trend card */
  .trend-card {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 20px 22px;
  }

  .trend-card-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    margin-bottom: 20px;
    gap: 16px;
    flex-wrap: wrap;
  }

  .trend-card-meta {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .trend-title {
    font-family: var(--font-mono);
    font-weight: 600;
    font-size: 15px;
    color: var(--text);
  }

  .trend-desc {
    font-size: 12.5px;
    color: var(--muted);
  }

  .trend-card-value {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-shrink: 0;
  }

  .big-value {
    font-family: var(--font-mono);
    font-weight: 700;
    font-size: 30px;
    color: var(--text);
    line-height: 1;
  }

  .delta-badge {
    padding: 3px 9px;
    border-radius: 999px;
    font-size: 12px;
    font-weight: 600;
  }

  .empty {
    color: var(--muted);
    margin: 0;
    font-size: 13px;
  }
</style>
