import { type ProviderJob, runProvider } from "./sandbox.ts";

/** Runs one provider call and gives up after `timeoutMs`. */
export type Runner = (job: ProviderJob, timeoutMs: number) => Promise<unknown[]>;

interface WorkerLike {
  onmessage: ((e: MessageEvent) => void) | null;
  onerror: ((e: ErrorEvent) => void) | null;
  postMessage(m: unknown): void;
  terminate(): void;
}

/** One Worker per call, terminated when it answers or overruns, so a provider that hangs costs nothing after. */
export function workerRunner(makeWorker: () => WorkerLike): Runner {
  return (job, timeoutMs) =>
    new Promise((resolve, reject) => {
      const w = makeWorker();
      const done = (fn: () => void) => {
        clearTimeout(timer);
        w.terminate();
        fn();
      };
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
  return (job, timeoutMs) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timed out")), timeoutMs);
      runProvider(job, f).then(
        (r) => (clearTimeout(timer), resolve(r)),
        (e) => (clearTimeout(timer), reject(e)),
      );
    });
}
