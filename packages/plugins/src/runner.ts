import { type ProviderJob, runProvider } from "./sandbox.ts";

/** Runs one provider call and gives up after `timeoutMs`, or as soon as `signal` aborts (the page was left). */
export type Runner = (job: ProviderJob, timeoutMs: number, signal?: AbortSignal) => Promise<unknown[]>;

const cancelled = () => new Error("cancelled");

interface WorkerLike {
  onmessage: ((e: MessageEvent) => void) | null;
  onerror: ((e: ErrorEvent) => void) | null;
  postMessage(m: unknown): void;
  terminate(): void;
}

/** One Worker per call, terminated when it answers or overruns, so a provider that hangs costs nothing after. */
export function workerRunner(makeWorker: () => WorkerLike): Runner {
  return (job, timeoutMs, signal) =>
    new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(cancelled());
      const w = makeWorker();
      // Aborted, the Worker is terminated at once: its fetches and parsing stop with it.
      const abort = () => done(() => reject(cancelled()));
      const done = (fn: () => void) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        w.terminate();
        fn();
      };
      signal?.addEventListener("abort", abort);
      const timer = setTimeout(() => done(() => reject(new Error("timed out"))), timeoutMs);
      w.onmessage = (e) => {
        const m = e.data as { ok: boolean; results?: unknown[]; error?: string };
        done(() => (m.ok ? resolve(m.results ?? []) : reject(new Error(m.error ?? "failed"))));
      };
      w.onerror = (e) => done(() => reject(new Error(e.message || "worker error")));
      w.postMessage(job);
    });
}

/** In the page itself: for tests and hosts without Workers. A hung provider is abandoned, not stopped. */
export function inlineRunner(f: typeof fetch = fetch): Runner {
  return (job, timeoutMs, signal) =>
    new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(cancelled());
      signal?.addEventListener("abort", () => reject(cancelled()));
      const timer = setTimeout(() => reject(new Error("timed out")), timeoutMs);
      runProvider(job, f).then(
        (r) => (clearTimeout(timer), resolve(r)),
        (e) => (clearTimeout(timer), reject(e)),
      );
    });
}
