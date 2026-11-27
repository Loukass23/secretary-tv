import { installBackAdapter, record, registerMediaKeys, runBootAnimation } from "@secretary/tv-kit";
import { artCache } from "@secretary/tv-kit/src/art-cache.ts";
import { render } from "preact";
import { App } from "./app.tsx";
import "./style.css";

try {
  installBackAdapter(window);
  registerMediaKeys();
} catch (err) {
  console.warn("[boot] platform install failed", err);
}

const root = document.getElementById("root")!;
// The glass lab (src/lab) loads as its own chunk, only when asked for.
let lab: string | null = null;
try {
  lab = new URLSearchParams(location.search).get("lab") ?? localStorage.getItem("nest.lab");
} catch {
  // no storage: normal launcher
}
if (lab) {
  void import("./lab/lab.tsx").then(({ Lab, labMode }) => {
    const mode = labMode();
    render(mode ? <Lab initial={mode} /> : <App />, root);
  });
} else {
  // The home's pictures from the last visit (tv-kit art-cache.ts), read from IndexedDB before the first render so its
  // tiles draw them on their first frame; capped, so a slow store never holds the start.
  const t0 = performance.now();
  void artCache()
    .warm(80, 250)
    .then(
      (n) => {
        record("art.warm", performance.now() - t0);
        record("art.warmCount", n);
      },
      () => {},
    )
    .finally(() => render(<App />, root));
}

// With the splash on, the bird gets its time (any key skips it); off, the boot screen leaves as quickly as before.
runBootAnimation(document.documentElement.dataset.splash === "off" ? {} : { holdMs: 5200 });
