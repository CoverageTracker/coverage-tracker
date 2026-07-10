import type uPlot from 'uplot';

export function hexAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** Top-to-bottom fading fill, used by every uPlot line series in the dashboard. */
export function gradientFill(color: string, topAlpha = 0.28, bottomAlpha = 0.02) {
  return (u: uPlot) => {
    const grad = u.ctx.createLinearGradient(0, u.bbox.top, 0, u.bbox.top + u.bbox.height);
    grad.addColorStop(0, hexAlpha(color, topAlpha));
    grad.addColorStop(1, hexAlpha(color, bottomAlpha));
    return grad;
  };
}
