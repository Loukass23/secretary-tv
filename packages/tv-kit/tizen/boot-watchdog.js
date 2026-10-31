// Classic script that src-tizen/vite.config.ts inlines at the top of <head>.
// It runs before any module, so it still reports when the bundle fails to load
// or parse, which otherwise leaves the TV on the boot splash with no clue why.
(function () {
  var TIMEOUT_MS = 30000;
  var errors = [];

  function record(message) {
    errors.push(message);
    console.error("[boot] " + message);
  }

  // Capture phase: a failed <script> or <link> load does not bubble to window.
  function onError(event) {
    if (!(event instanceof ErrorEvent)) {
      var target = event.target;
      record("failed to load " + ((target && (target.src || target.href)) || "resource"));
      return;
    }
    record(
      (event.message || "error") +
        (event.filename ? " at " + event.filename + ":" + event.lineno : ""),
    );
  }

  function onRejection(event) {
    var reason = event.reason;
    record("unhandled rejection: " + (reason && reason.message ? reason.message : String(reason)));
  }

  window.addEventListener("error", onError, true);
  window.addEventListener("unhandledrejection", onRejection);

  // The app takes #boot down once it has painted. #root is not a signal: Big
  // Picture renders through portals next to it and leaves it empty.
  function booted() {
    var splash = document.getElementById("boot");
    return !splash || splash.dataset.leaving === "true";
  }

  var poll = setInterval(function () {
    if (!booted()) return;
    clearInterval(poll);
    clearTimeout(timeout);
    window.removeEventListener("error", onError, true);
    window.removeEventListener("unhandledrejection", onRejection);
    console.info("[boot] ready in " + Math.round(performance.now()) + "ms");
  }, 250);

  var timeout = setTimeout(function () {
    clearInterval(poll);
    record("boot splash still up after " + TIMEOUT_MS / 1000 + "s");
    var splash = document.getElementById("boot");
    if (!splash) return;
    var panel = document.createElement("pre");
    panel.style.cssText =
      "margin:0;max-width:80vw;color:#f3f3f3;font:20px/1.5 monospace;white-space:pre-wrap";
    panel.textContent = "The app failed to start\n\n" + errors.slice(0, 8).join("\n");
    splash.textContent = "";
    splash.appendChild(panel);
  }, TIMEOUT_MS);
})();
