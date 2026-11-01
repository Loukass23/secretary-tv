import { installBackAdapter, registerMediaKeys, runBootAnimation } from "@secretary/tv-kit";
import { render } from "preact";
import { App } from "./app.tsx";

try {
  installBackAdapter(window);
  registerMediaKeys();
} catch (err) {
  console.warn("[boot] platform install failed", err);
}

render(<App />, document.getElementById("root")!);

runBootAnimation();
