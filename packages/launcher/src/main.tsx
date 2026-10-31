import { installBackAdapter, registerMediaKeys, runBootAnimation } from "@secretary/tv-kit";
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
  render(<App />, root);
}

runBootAnimation();
