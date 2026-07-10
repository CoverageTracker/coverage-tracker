<script lang="ts">
  import { untrack } from 'svelte';
  import { invalidateAll } from '$app/navigation';
  import { fetchTrendByCategory } from '$lib/api';

  let {
    owner,
    repo,
    projectId,
    badgeEnabled,
    defaultBranch,
    onclose,
  }: {
    owner: string;
    repo: string;
    projectId: number;
    badgeEnabled: number;
    defaultBranch: string;
    onclose: () => void;
  } = $props();

  const BADGE_METRICS = [
    { value: 'coverage', label: 'Coverage' },
    { value: 'branch_coverage', label: 'Branch Coverage' },
    { value: 'complexity', label: 'Complexity' },
    { value: 'cognitive', label: 'Cognitive' },
    { value: 'duplication', label: 'Duplication' },
    { value: 'maintainability', label: 'Maintainability' },
  ];

  let selectedMetric = $state('coverage');
  let categories = $state<string[]>(['default']);
  let selectedCategory = $state('default');
  let localBadgeEnabled = $state(untrack(() => badgeEnabled));
  let toggling = $state(false);

  $effect(() => {
    const metric = selectedMetric;
    (async () => {
      let next = ['default'];
      try {
        const result = await fetchTrendByCategory(owner, repo, metric, defaultBranch, { limit: 1 });
        if (result.categories.length > 0) {
          next = result.categories.map((c) => c.category);
        }
      } catch {
        // fall back to ['default']
      }
      categories = next;
      if (!next.includes(selectedCategory)) {
        selectedCategory = next[0] ?? 'default';
      }
    })();
  });

  const badgeEndpointUrl = $derived(
    `${window.location.origin}/api/badge/${owner}/${repo}/${selectedMetric}.json${
      selectedCategory !== 'default' ? `?category=${encodeURIComponent(selectedCategory)}` : ''
    }`,
  );
  const shieldsUrl = $derived(
    `https://img.shields.io/endpoint?url=${encodeURIComponent(badgeEndpointUrl)}`,
  );
  const badgeAltText = $derived(
    `${selectedMetric}${selectedCategory !== 'default' ? ` (${selectedCategory})` : ''} badge`,
  );
  const markdownSnippet = $derived(`![${badgeAltText}](${shieldsUrl})`);
  const rstSnippet = $derived(`.. image:: ${shieldsUrl}`);

  let copiedField: string | null = $state(null);
  let copyTimer: ReturnType<typeof setTimeout> | null = null;

  async function copy(field: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      if (copyTimer) clearTimeout(copyTimer);
      copiedField = field;
      copyTimer = setTimeout(() => {
        copiedField = null;
      }, 2000);
    } catch {
      // clipboard unavailable in insecure context
    }
  }

  async function toggleBadge(enabled: boolean) {
    toggling = true;
    try {
      const res = await fetch(`/api/admin/projects/${projectId}/badge`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      if (res.ok) {
        localBadgeEnabled = enabled ? 1 : 0;
        invalidateAll();
      }
    } finally {
      toggling = false;
    }
  }

  let modalEl: HTMLDivElement;

  $effect(() => {
    const opener = document.activeElement as HTMLElement | null;

    const focusableSelector =
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

    const first = modalEl?.querySelector<HTMLElement>(focusableSelector);
    first?.focus();

    function handleKeydown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onclose();
        return;
      }

      if (e.key === 'Tab') {
        const focusable = Array.from(
          modalEl.querySelectorAll<HTMLElement>(focusableSelector),
        );
        if (focusable.length === 0) return;

        const firstEl = focusable[0];
        const lastEl = focusable[focusable.length - 1];

        if (e.shiftKey && document.activeElement === firstEl) {
          e.preventDefault();
          lastEl.focus();
        } else if (!e.shiftKey && document.activeElement === lastEl) {
          e.preventDefault();
          firstEl.focus();
        }
      }
    }

    document.addEventListener('keydown', handleKeydown);

    return () => {
      document.removeEventListener('keydown', handleKeydown);
      opener?.focus();
    };
  });
</script>

<button class="modal-backdrop" onclick={onclose} aria-label="Close modal" tabindex="-1"></button>

<div class="modal-wrapper">
  <div
    class="modal"
    bind:this={modalEl}
    role="dialog"
    aria-modal="true"
    aria-labelledby="badge-modal-title"
  >
    <div class="modal-header">
      <h2 id="badge-modal-title" class="modal-title">Status Badge</h2>
      <button class="close-btn" onclick={onclose} aria-label="Close modal">
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>

    <div class="modal-body">
      <div class="metric-row">
        <label for="badge-metric-select" class="metric-label">Metric</label>
        <select id="badge-metric-select" class="metric-select" bind:value={selectedMetric}>
          {#each BADGE_METRICS as m (m.value)}
            <option value={m.value}>{m.label}</option>
          {/each}
        </select>

        <label for="badge-category-select" class="metric-label">Category</label>
        <select id="badge-category-select" class="metric-select" bind:value={selectedCategory}>
          {#each categories as cat (cat)}
            <option value={cat}>{cat}</option>
          {/each}
        </select>
      </div>

      <div class="badge-preview">
        {#if localBadgeEnabled}
          <img src={shieldsUrl} alt="{badgeAltText} status badge" />
        {:else}
          <span class="badge-placeholder">badge preview unavailable</span>
        {/if}
      </div>

      {#if !localBadgeEnabled}
        <div class="badge-notice">
          <span>Public badge serving is disabled — the badge won't load until enabled.</span>
          <button
            class="enable-btn"
            onclick={() => toggleBadge(true)}
            disabled={toggling}
          >
            {toggling ? 'Enabling…' : 'Enable public badge'}
          </button>
        </div>
      {:else}
        <div class="badge-status">
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
          <span>Public badge enabled</span>
          <button
            class="disable-link"
            onclick={() => toggleBadge(false)}
            disabled={toggling}
          >
            {toggling ? 'Disabling…' : 'Disable'}
          </button>
        </div>
      {/if}

      {#each [
        { key: 'url', label: 'Shields.io URL', value: shieldsUrl },
        { key: 'md', label: 'Markdown', value: markdownSnippet },
        { key: 'rst', label: 'reStructuredText', value: rstSnippet },
      ] as snippet (snippet.key)}
        <div class="snippet-group">
          <label class="snippet-label" for="snippet-{snippet.key}">
            {snippet.label}
          </label>
          <div class="copy-container">
            <textarea
              id="snippet-{snippet.key}"
              class="snippet-textarea"
              readonly
              rows="2"
              value={snippet.value}
              onclick={(e) => (e.currentTarget as HTMLTextAreaElement).select()}
            ></textarea>
            <button
              class="copy-btn"
              class:copied={copiedField === snippet.key}
              onclick={() => copy(snippet.key, snippet.value)}
              aria-label="Copy {snippet.label} to clipboard"
              title={copiedField === snippet.key ? 'Copied!' : 'Copy to clipboard'}
            >
              {#if copiedField === snippet.key}
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  aria-hidden="true"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <span class="copy-label">Copied!</span>
              {:else}
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  aria-hidden="true"
                >
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              {/if}
            </button>
          </div>
        </div>
      {/each}
    </div>
  </div>
</div>

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    z-index: 100;
    border: none;
    padding: 0;
    cursor: default;
  }

  .modal-wrapper {
    position: fixed;
    inset: 0;
    z-index: 101;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    pointer-events: none;
  }

  .modal {
    pointer-events: auto;
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.4);
    width: 100%;
    max-width: 520px;
    max-height: 90vh;
    overflow-y: auto;
    animation: modal-in 0.15s ease;
    transform-origin: top center;
  }

  @keyframes modal-in {
    from {
      opacity: 0;
      transform: scale(0.97) translateY(-6px);
    }
    to {
      opacity: 1;
      transform: scale(1) translateY(0);
    }
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 18px 20px 14px;
    border-bottom: 1px solid var(--border);
  }

  .modal-title {
    margin: 0;
    font-family: var(--font-mono);
    font-size: 15px;
    font-weight: 600;
    color: var(--text);
  }

  .close-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    background: transparent;
    border: none;
    border-radius: calc(var(--radius) - 4px);
    cursor: pointer;
    color: var(--muted);
  }

  .close-btn:hover {
    background: var(--elevated);
    color: var(--text);
  }

  .modal-body {
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .metric-row {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }

  .metric-label {
    font-size: 13px;
    font-weight: 500;
    color: var(--muted);
    white-space: nowrap;
  }

  .metric-select {
    padding: 7px 10px;
    border: 1px solid var(--border);
    border-radius: calc(var(--radius) - 2px);
    font-family: var(--font-body);
    font-size: 13px;
    background: var(--bg);
    color: var(--text);
    outline: none;
    cursor: pointer;
  }

  .metric-select:focus {
    border-color: var(--primary);
    box-shadow: 0 0 0 2px var(--ring);
  }

  .badge-preview {
    display: flex;
    align-items: center;
    min-height: 28px;
  }

  .badge-preview img {
    max-height: 28px;
  }

  .badge-placeholder {
    font-size: 11px;
    color: var(--muted);
    font-style: italic;
  }

  .badge-notice {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
    font-size: 12.5px;
    color: var(--muted);
    background: var(--elevated);
    border: 1px solid var(--border);
    border-radius: calc(var(--radius) - 2px);
    padding: 8px 12px;
    line-height: 1.5;
  }

  .enable-btn {
    padding: 4px 10px;
    border: 1px solid var(--primary);
    border-radius: calc(var(--radius) - 3px);
    background: transparent;
    color: var(--primary);
    cursor: pointer;
    font-family: var(--font-body);
    font-size: 12px;
    font-weight: 600;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .enable-btn:hover:not(:disabled) {
    background: var(--primary);
    color: var(--primary-fg);
  }

  .enable-btn:disabled {
    opacity: 0.6;
    cursor: default;
  }

  .badge-status {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12.5px;
    color: var(--muted);
  }

  .badge-status svg {
    color: var(--primary);
    flex-shrink: 0;
  }

  .disable-link {
    margin-left: auto;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    font-family: var(--font-body);
    font-size: 12px;
    text-decoration: underline;
  }

  .disable-link:hover:not(:disabled) {
    color: var(--text);
  }

  .disable-link:disabled {
    opacity: 0.6;
    cursor: default;
  }

  .snippet-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .snippet-label {
    font-size: 11px;
    font-weight: 500;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--muted);
  }

  .copy-container {
    position: relative;
  }

  .snippet-textarea {
    width: 100%;
    box-sizing: border-box;
    padding: 8px 70px 8px 10px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: calc(var(--radius) - 2px);
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text);
    resize: none;
    outline: none;
    line-height: 1.5;
  }

  .snippet-textarea:focus {
    border-color: var(--primary);
    box-shadow: 0 0 0 2px var(--ring);
  }

  .copy-btn {
    position: absolute;
    top: 6px;
    right: 6px;
    display: flex;
    align-items: center;
    gap: 4px;
    height: 26px;
    padding: 0 8px;
    background: var(--elevated);
    border: 1px solid var(--border);
    border-radius: calc(var(--radius) - 4px);
    cursor: pointer;
    color: var(--muted);
    font-family: var(--font-body);
    font-size: 11px;
    font-weight: 500;
    white-space: nowrap;
  }

  .copy-btn:hover {
    border-color: var(--primary);
    color: var(--primary);
  }

  .copy-btn.copied {
    border-color: var(--primary);
    color: var(--primary);
  }

  .copy-label {
    font-size: 11px;
    font-weight: 500;
  }
</style>
