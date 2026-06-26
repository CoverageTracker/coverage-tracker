<script lang="ts">
  import { page } from '$app/stores';
</script>

<svelte:head>
  <title>Error {$page.status} — Coverage Tracker</title>
</svelte:head>

<div class="error-page">
  <p class="status">{$page.status}</p>
  <h1>{$page.error?.message ?? 'Something went wrong'}</h1>
  <a href="/">Back to dashboard</a>
</div>

<style>
  .error-page {
    max-width: 1180px;
    margin: 0 auto;
    padding: 60px 24px 72px;
  }

  .status {
    font-family: var(--font-mono);
    font-size: 13px;
    font-weight: 600;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    margin: 0 0 12px;
  }

  h1 {
    font-family: var(--font-mono);
    font-size: 22px;
    font-weight: 700;
    color: var(--text);
    margin: 0 0 24px;
    letter-spacing: -0.01em;
  }

  a {
    font-size: 13px;
    color: var(--link);
    text-decoration: none;
  }

  a:hover {
    text-decoration: underline;
  }
</style>
