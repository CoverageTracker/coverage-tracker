<script lang="ts">
  import '../app.css';

  let { children } = $props();
</script>

<div class="shell">
  <header>
    <a href="/" class="brand">Coverage Tracker</a>
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
    padding: 0.75rem 1.5rem;
    border-bottom: 1px solid var(--color-border);
    display: flex;
    align-items: center;
  }

  .brand {
    font-weight: 600;
    font-size: 1rem;
    color: var(--color-text);
    text-decoration: none;
    letter-spacing: -0.01em;
  }

  .brand:hover {
    color: var(--color-accent);
  }

  main {
    flex: 1;
    padding: 1.5rem;
    max-width: 1200px;
    margin: 0 auto;
    width: 100%;
  }
</style>
