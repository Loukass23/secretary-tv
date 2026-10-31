// Named timestamps for the handover: "ok" when the viewer presses play,
// "frame" when the first video frame is reported. Read over CDP via window.__sectv.
const marks: Record<string, number> = {};
const results: Record<string, number> = {};

export function mark(name: string): void {
  marks[name] = performance.now();
}

/** Records a duration measured elsewhere, such as time since navigation start. */
export function record(label: string, ms: number): void {
  results[label] = Math.round(ms);
  console.info(`[perf] ${label} ${Math.round(ms)}ms`);
}

export function measure(label: string, from: string, to: string): number | null {
  if (marks[from] == null || marks[to] == null) return null;
  const ms = Math.round(marks[to] - marks[from]);
  results[label] = ms;
  console.info(`[perf] ${label} ${ms}ms`);
  return ms;
}

(globalThis as { __sectv?: unknown }).__sectv = { marks, results };
