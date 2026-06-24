<script lang="ts">
  import { onMount } from 'svelte';
  import uPlot from 'uplot';
  import 'uplot/dist/uPlot.min.css';

  let { timestamps, values }: { timestamps: number[]; values: number[] } = $props();
  let container: HTMLDivElement;

  onMount(() => {
    if (timestamps.length < 2) return;

    const chart = new uPlot(
      {
        width: 160,
        height: 48,
        padding: [4, 0, 4, 0],
        axes: [],
        scales: { x: { time: true } },
        legend: { show: false },
        cursor: { show: false },
        select: { show: false },
        series: [
          {},
          {
            stroke: 'var(--color-accent)',
            fill: 'var(--color-accent-faint)',
            width: 1.5,
          },
        ],
      },
      [timestamps, values],
      container,
    );

    return () => chart.destroy();
  });
</script>

<div bind:this={container} class="sparkline"></div>

<style>
  .sparkline :global(.u-wrap) {
    overflow: visible;
  }
  .sparkline :global(.u-title),
  .sparkline :global(.u-legend) {
    display: none;
  }
</style>
