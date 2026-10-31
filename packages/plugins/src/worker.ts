// Worker entry: one provider call per Worker, which the page terminates when it overruns.
import { type ProviderJob, runProvider } from "./sandbox.ts";

const scope = self as unknown as { onmessage: ((e: MessageEvent<ProviderJob>) => void) | null; postMessage(m: unknown): void };

scope.onmessage = (e) => {
  runProvider(e.data, fetch).then(
    (results) => scope.postMessage({ ok: true, results }),
    (err) => scope.postMessage({ ok: false, error: String((err as Error)?.message ?? err) }),
  );
};
