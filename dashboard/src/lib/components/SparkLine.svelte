<script lang="ts">
  import uPlot from 'uplot';
  import 'uplot/dist/uPlot.min.css';

  let {
    timestamps,
    values,
    color,
  }: { timestamps: number[]; values: number[]; color: string } = $props();

  let container: HTMLDivElement;
  let chart: uPlot | null = null;

  function hexAlpha(hex: string, alpha: number): string {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  function buildChart(c: string) {
    chart?.destroy();
    if (timestamps.length < 2 || !container) { chart = null; return; }

    chart = new uPlot(
      {
        width: 150,
        height: 44,
        padding: [4, 0, 4, 0],
        axes: [{ show: false, size: 0 }, { show: false, size: 0 }],
        scales: { x: { time: true } },
        legend: { show: false },
        cursor: { show: false },
        select: { show: false },
        series: [
          {},
          {
            stroke: c,
            fill: hexAlpha(c, 0.2),
            width: 1.5,
            points: { show: false },
          },
        ],
      },
      [timestamps, values],
      container,
    );
  }

  $effect(() => {
    buildChart(color);
    return () => { chart?.destroy(); chart = null; };
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
