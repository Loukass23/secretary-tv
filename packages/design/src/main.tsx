import { installBackAdapter } from "@secretary/tv-kit";
import { render } from "preact";
import { App } from "./app.tsx";
import { installDesktopRemote } from "./remote.tsx";
import "./design.css";

// As on the TV: the Back adapter first, so it is the first capture listener; then the desktop keys.
installBackAdapter(window);
installDesktopRemote(window);

render(<App />, document.getElementById("root")!);
