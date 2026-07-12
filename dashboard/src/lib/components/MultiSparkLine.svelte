<script lang="ts">
  import uPlot from 'uplot';
  import 'uplot/dist/uPlot.min.css';
  import { gradientFill } from '../chartFill';

  let {
    series,
  }: {
    series: { category: string; timestamps: number[]; values: number[]; color: string }[];
  } = $props();

  let container: HTMLDivElement;
  let chart: uPlot | null = null;

  function buildChart() {
    chart?.destroy();
    chart = null;
    if (!container || series.length === 0) return;

    const tables = series.map((s) => [s.timestamps, s.values]) as uPlot.AlignedData[];
    const joined = series.length > 1 ? uPlot.join(tables) : tables[0];
    if ((joined[0] as number[]).length < 2) return;

    chart = new uPlot(
      {
        width: container.clientWidth,
        height: 44,
        padding: [4, 0, 4, 0],
        axes: [
          { show: false, size: 0 },
          { show: false, size: 0 },
        ],
        scales: { x: { time: true } },
        legend: { show: false },
        cursor: { show: false },
        select: { show: false },
        series: [
          {},
          ...series.map((s) => ({
            stroke: s.color,
            fill: gradientFill(s.color, 0.16, 0.01),
            width: 1.5,
            points: { show: false },
          })),
        ],
      },
      joined,
      container,
    );
  }

  $effect(() => {
    void series;
    buildChart();

    if (!container) return;
    const observer = new ResizeObserver(() => {
      if (chart && container) {
        chart.setSize({ width: container.clientWidth, height: 44 });
      }
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
      chart?.destroy();
      chart = null;
    };
  });
</script>

<div bind:this={container} class="multi-sparkline"></div>

<style>
  .multi-sparkline {
    width: 100%;
  }
  .multi-sparkline :global(.u-wrap) {
    overflow: visible;
  }
  .multi-sparkline :global(.u-title),
  .multi-sparkline :global(.u-legend) {
    display: none;
  }
</style>
