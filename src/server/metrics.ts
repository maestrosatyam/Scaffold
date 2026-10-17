// In-process tool latency metrics (server-side handler time, not network time).
// Alexa+ add-on guidance asks for < 500 ms round trips; the UI shows p50/p95 against that budget.

export class Metrics {
  private samples = new Map<string, number[]>();
  private readonly max: number;

  constructor(max = 500) {
    this.max = max;
  }

  record(tool: string, ms: number): void {
    const arr = this.samples.get(tool) ?? [];
    arr.push(ms);
    if (arr.length > this.max) arr.shift();
    this.samples.set(tool, arr);
  }

  private static pct(sorted: number[], p: number): number {
    if (!sorted.length) return 0;
    const i = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
    return sorted[Math.max(0, i)]!;
  }

  snapshot(): { total: { count: number; p50: number; p95: number; max: number }; tools: Record<string, { count: number; p50: number; p95: number }> } {
    const all: number[] = [];
    const tools: Record<string, { count: number; p50: number; p95: number }> = {};
    for (const [name, arr] of this.samples) {
      const s = [...arr].sort((a, b) => a - b);
      all.push(...s);
      tools[name] = { count: s.length, p50: round(Metrics.pct(s, 50)), p95: round(Metrics.pct(s, 95)) };
    }
    all.sort((a, b) => a - b);
    return {
      total: { count: all.length, p50: round(Metrics.pct(all, 50)), p95: round(Metrics.pct(all, 95)), max: round(all.at(-1) ?? 0) },
      tools,
    };
  }
}

const round = (n: number) => Math.round(n * 100) / 100;
