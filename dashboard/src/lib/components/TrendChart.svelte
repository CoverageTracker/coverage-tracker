<script lang="ts">
  import uPlot from 'uplot';
  import 'uplot/dist/uPlot.min.css';
  import type { MetricPoint } from '../types';

  let {
    data,
    metric,
    unit,
    color,
    borderColor,
    mutedColor,
    textColor,
  }: {
    data: MetricPoint[];
    metric: string;
    unit: string;
    color: string;
    borderColor: string;
    mutedColor: string;
    textColor: string;
  } = $props();

  let container: HTMLDivElement;
  let chart: uPlot | null = null;

  function hexAlpha(hex: string, alpha: number): string {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  function gradientFill(c: string) {
    return (u: uPlot) => {
      const grad = u.ctx.createLinearGradient(0, u.bbox.top, 0, u.bbox.top + u.bbox.height);
      grad.addColorStop(0, hexAlpha(c, 0.28));
      grad.addColorStop(1, hexAlpha(c, 0.02));
      return grad;
    };
  }

  // Draw a dot + vertical dashed guide at the last data point
  function lastPointPlugin(c: string, bc: string) {
    return {
      hooks: {
        draw: [
          (u: uPlot) => {
            const { ctx, data: d } = u;
            const lastIdx = (d[0] as number[]).length - 1;
            if (lastIdx < 0) return;

            const cx = Math.round(u.valToPos((d[0] as number[])[lastIdx], 'x', true));
            const cy = Math.round(u.valToPos((d[1] as (number | null)[])[lastIdx]!, 'y', true));

            // Dashed vertical guide
            ctx.save();
            ctx.setLineDash([4, 4]);
            ctx.strokeStyle = hexAlpha(bc, 0.6);
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(cx, u.bbox.top);
            ctx.lineTo(cx, u.bbox.top + u.bbox.height);
            ctx.stroke();
            ctx.restore();

            // Dot
            ctx.save();
            ctx.beginPath();
            ctx.arc(cx, cy, 4, 0, Math.PI * 2);
            ctx.fillStyle = c;
            ctx.fill();
            ctx.strokeStyle = hexAlpha(c, 0.3);
            ctx.lineWidth = 3;
            ctx.stroke();
            ctx.restore();
          },
        ],
      },
    };
  }

  function buildChart() {
    chart?.destroy();
    if (data.length === 0 || !container) { chart = null; return; }

    const timestamps = data.map((p) => new Date(p.recorded_at).getTime() / 1000);
    const values = data.map((p) => p.value);

    chart = new uPlot(
      {
        width: container.clientWidth,
        height: 220,
        padding: [12, 12, 0, 0],
        scales: { x: { time: true } },
        axes: [
          {
            stroke: mutedColor,
            ticks: { stroke: borderColor, width: 1, size: 4 },
            border: { show: false },
            grid: { show: false },
            font: `12px 'JetBrains Mono', monospace`,
          },
          {
            stroke: mutedColor,
            ticks: { show: false },
            border: { show: false },
            grid: { stroke: borderColor, width: 1, dash: [] },
            size: 52,
            font: `12px 'JetBrains Mono', monospace`,
            values: (_u: uPlot, vals: number[]) =>
              vals.map((v) => (v !== null ? `${v.toFixed(1)}${unit}` : '')),
          },
        ],
        series: [
          {},
          {
            label: metric,
            stroke: color,
            fill: gradientFill(color),
            width: 2,
            points: { show: false },
          },
        ],
        legend: { show: false },
        cursor: { show: false },
        plugins: [lastPointPlugin(color, borderColor)],
      },
      [timestamps, values],
      container,
    );
  }

  $effect(() => {
    // React to any of these changing; also depends on container via buildChart()
    void data;
    void color;
    void borderColor;
    void mutedColor;
    void textColor;
    buildChart();

    if (!container) return;
    const observer = new ResizeObserver(() => {
      if (chart && container) {
        chart.setSize({ width: container.clientWidth, height: 220 });
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

<div bind:this={container} class="trend-chart"></div>

<style>
  .trend-chart {
    width: 100%;
  }

  /* Override uPlot default white background */
  .trend-chart :global(.u-wrap) {
    background: transparent;
  }
</style>
