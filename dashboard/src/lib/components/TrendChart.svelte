<script lang="ts">
  import { onMount } from 'svelte';
  import uPlot from 'uplot';
  import 'uplot/dist/uPlot.min.css';
  import type { MetricPoint } from '../types';

  let { data, metric, unit }: { data: MetricPoint[]; metric: string; unit: string } = $props();
  let container: HTMLDivElement;

  onMount(() => {
    if (data.length === 0) return;

    const timestamps = data.map((p) => new Date(p.recorded_at).getTime() / 1000);
    const values = data.map((p) => p.value);
    const yLabel = unit === '%' ? `${metric} (%)` : metric;

    const chart = new uPlot(
      {
        width: container.clientWidth,
        height: 280,
        scales: { x: { time: true } },
        axes: [
          { label: 'Date', size: 36 },
          { label: yLabel, size: 48 },
        ],
        series: [
          {},
          {
            label: metric,
            stroke: 'var(--color-accent)',
            fill: 'var(--color-accent-faint)',
            width: 2,
          },
        ],
        legend: { show: true },
        cursor: { show: true },
      },
      [timestamps, values],
      container,
    );

    const observer = new ResizeObserver(() => {
      chart.setSize({ width: container.clientWidth, height: 280 });
    });
    observer.observe(container);

    return () => {
      chart.destroy();
      observer.disconnect();
    };
  });
</script>

<div bind:this={container} class="trend-chart"></div>

<style>
  .trend-chart {
    width: 100%;
  }
</style>
