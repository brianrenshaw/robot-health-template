// Axis arithmetic for the charts: clean tick values and how a number is written on an axis.

/** Clean, evenly spaced values that cover min to max: 0, 500, 1,000 ... About `count` of them. */
export function niceTicks(min: number, max: number, count = 4): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  if (min === max) {
    const pad = Math.abs(min) * 0.05 || 1;
    min -= pad;
    max += pad;
  }
  const rough = (max - min) / Math.max(count, 1);
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => s >= rough) ?? 10 * power;
  const first = Math.floor(min / step) * step;
  const ticks: number[] = [];
  for (let v = first; v < max + step * 0.999; v += step) ticks.push(Number(v.toFixed(6)));
  return ticks;
}

/** An axis value: in full under 10,000 (2,500), compact from there (12K). One style per axis. */
export function axisFormat(ticks: number[]): (n: number) => string {
  const big = Math.max(...ticks.map(Math.abs)) >= 10000;
  const decimals = ticks.some((t) => !Number.isInteger(t)) ? 1 : 0;
  const full = new Intl.NumberFormat("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return (n) => (big ? `${Number((n / 1000).toFixed(1))}K` : full.format(n));
}
