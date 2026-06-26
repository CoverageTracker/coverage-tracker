<script lang="ts">
  import '../app.css';
  import { onMount } from 'svelte';
  import { theme, THEME_FAMILIES } from '$lib/theme.svelte';

  let { children } = $props();

  onMount(() => {
    theme.init();
    theme.applyVars();
  });

  $effect(() => {
    // Re-apply whenever familyId or mode changes (reactive dependency)
    theme.familyId;
    theme.mode;
    theme.applyVars();
  });

  function swatchColors(familyId: string, mode: 'light' | 'dark') {
    const fam = THEME_FAMILIES.find((f) => f.id === familyId);
    if (!fam) return ['#000', '#000', '#000', '#000'];
    const v = fam.variants[mode] ?? fam.variants.dark ?? fam.variants.light;
    if (!v) return ['#000', '#000', '#000', '#000'];
    return [v.bg, v.primary, v.chart[0], v.chart[1]];
  }
</script>

<div class="shell">
  <header>
    <a href="/" class="brand">
      <span class="brand-icon" aria-hidden="true"></span>
      Coverage Tracker
    </a>

    <div class="header-right">
      <!-- Theme picker -->
      <div class="theme-picker-wrap">
        <button
          class="theme-btn"
          onclick={() => (theme.menuOpen = !theme.menuOpen)}
          aria-haspopup="listbox"
          aria-expanded={theme.menuOpen}
          aria-label="Choose color scheme"
        >
          <span class="swatch-row" aria-hidden="true">
            {#each swatchColors(theme.familyId, theme.mode) as color}
              <span class="swatch-dot" style="background:{color}"></span>
            {/each}
          </span>
          <span class="theme-label">{theme.family.label}</span>
          <span class="theme-variant">{theme.variantLabel}</span>
        </button>

        {#if theme.menuOpen}
          <!-- Backdrop to catch outside clicks -->
          <button
            class="backdrop"
            aria-hidden="true"
            tabindex="-1"
            onclick={() => (theme.menuOpen = false)}
          ></button>

          <div class="theme-dropdown" role="listbox" aria-label="Color scheme">
            <div class="dropdown-section-label">COLOR SCHEME</div>
            {#each THEME_FAMILIES as fam}
              {@const activeFamMode = fam.variants[theme.mode] ? theme.mode : (fam.variants.dark ? 'dark' : 'light')}
              {@const isActive = theme.familyId === fam.id}
              <button
                class="dropdown-row"
                class:active={isActive}
                role="option"
                aria-selected={isActive}
                onclick={() => theme.setFamily(fam.id)}
              >
                <span class="swatch-row" aria-hidden="true">
                  {#each swatchColors(fam.id, activeFamMode) as color}
                    <span class="swatch-dot" style="background:{color}"></span>
                  {/each}
                </span>
                <span class="dropdown-row-text">
                  <span class="dropdown-family">{fam.label}</span>
                  <span class="dropdown-variant">
                    {theme.variantNameFor(fam.id, activeFamMode)}
                  </span>
                </span>
                {#if isActive}
                  <span class="check-mark" aria-hidden="true">✓</span>
                {/if}
              </button>
            {/each}
          </div>
        {/if}
      </div>

      <!-- Light / dark toggle -->
      <button
        class="icon-btn"
        onclick={() => theme.toggleMode()}
        disabled={!theme.canToggleMode}
        aria-label={theme.mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        title={theme.canToggleMode
          ? (theme.mode === 'dark' ? 'Light mode' : 'Dark mode')
          : 'This theme is dark-only'}
      >
        {#if theme.mode === 'dark'}
          <!-- Moon icon -->
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
          </svg>
        {:else}
          <!-- Sun icon -->
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="5"/>
            <line x1="12" y1="1" x2="12" y2="3"/>
            <line x1="12" y1="21" x2="12" y2="23"/>
            <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
            <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
            <line x1="1" y1="12" x2="3" y2="12"/>
            <line x1="21" y1="12" x2="23" y2="12"/>
            <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
            <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
          </svg>
        {/if}
      </button>
    </div>
  </header>

  <main>
    {@render children()}
  </main>
</div>

<style>
  .shell {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
  }

  header {
    position: sticky;
    top: 0;
    height: 56px;
    padding: 0 24px;
    background: var(--bg);
    border-bottom: 1px solid var(--border);
    display: flex;
    align-items: center;
    justify-content: space-between;
    z-index: 40;
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 8px;
    font-family: var(--font-mono);
    font-weight: 700;
    font-size: 15px;
    color: var(--text);
    text-decoration: none;
  }

  .brand-icon {
    width: 18px;
    height: 18px;
    border-radius: 4px;
    background: var(--primary);
    flex-shrink: 0;
  }

  .header-right {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  /* Theme picker button */
  .theme-btn {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 36px;
    padding: 0 12px;
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    cursor: pointer;
    color: var(--text);
    font-family: var(--font-body);
    font-size: 13px;
  }

  .theme-btn:hover {
    border-color: var(--primary);
  }

  .swatch-row {
    display: flex;
    gap: 3px;
    align-items: center;
  }

  .swatch-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .theme-label {
    font-weight: 500;
    color: var(--text);
  }

  .theme-variant {
    font-size: 12px;
    color: var(--muted);
  }

  /* Dropdown */
  .theme-picker-wrap {
    position: relative;
  }

  .backdrop {
    position: fixed;
    inset: 0;
    background: transparent;
    border: none;
    cursor: default;
    z-index: 48;
  }

  .theme-dropdown {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    min-width: 252px;
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: 0 16px 44px rgba(0, 0, 0, 0.38);
    padding: 6px;
    z-index: 49;
    animation: dropdown-in 0.12s ease;
    transform-origin: top right;
  }

  @keyframes dropdown-in {
    from {
      opacity: 0;
      transform: translateY(-4px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .dropdown-section-label {
    font-size: 11px;
    font-weight: 500;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--muted);
    padding: 4px 8px 6px;
  }

  .dropdown-row {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 7px 8px;
    background: transparent;
    border: none;
    border-radius: calc(var(--radius) - 2px);
    cursor: pointer;
    color: var(--text);
    font-family: var(--font-body);
    font-size: 13px;
    text-align: left;
  }

  .dropdown-row:hover {
    background: var(--elevated);
  }

  .dropdown-row-text {
    flex: 1;
    display: flex;
    align-items: baseline;
    gap: 6px;
  }

  .dropdown-family {
    font-weight: 500;
  }

  .dropdown-variant {
    font-size: 12px;
    color: var(--muted);
  }

  .check-mark {
    color: var(--primary);
    font-size: 13px;
    font-weight: 600;
  }

  /* Icon button (light/dark toggle) */
  .icon-btn {
    width: 36px;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    cursor: pointer;
    color: var(--text);
  }

  .icon-btn:hover:not(:disabled) {
    border-color: var(--primary);
    color: var(--primary);
  }

  .icon-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  main {
    flex: 1;
  }
</style>
