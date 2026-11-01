// GET /music/player: the page Secretary Music frames to play YouTube (docs/music.md). The TV app runs from file://
// and sends no Referer, which YouTube's embed refuses with error 153; this page is served over http, so the embed
// inside it has one. It only hosts the IFrame player and relays it over postMessage: the protocol's other half is
// packages/app-music/src/bridge.ts. No key and no state; the page loads YouTube's script and nothing else.
export const MUSIC_PLAYER_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="referrer" content="strict-origin-when-cross-origin">
<title>Secretary Music player</title>
<style>html,body,#p{margin:0;width:100%;height:100%;background:#000;overflow:hidden}</style>
</head>
<body>
<div id="p"></div>
<script>
(function () {
  var SRC = "secretary-music";
  var player = null, ready = false, pending = null, ticker = 0;
  function up(m) { m.src = SRC; parent.postMessage(JSON.stringify(m), "*"); }
  function times() { return { t: player.getCurrentTime() || 0, d: player.getDuration() || 0 }; }
  function tick(on) {
    clearInterval(ticker);
    if (on) ticker = setInterval(function () { var x = times(); up({ ev: "time", t: x.t, d: x.d }); }, 1000);
  }
  function run(c) {
    if (!ready) { if (c.cmd === "load") pending = c; return; }
    if (c.cmd === "load") player.loadVideoById({ videoId: c.id, startSeconds: c.start || 0 });
    else if (c.cmd === "play") player.playVideo();
    else if (c.cmd === "pause") player.pauseVideo();
    else if (c.cmd === "seek") player.seekTo(c.t, true);
    else if (c.cmd === "stop") player.stopVideo();
  }
  window.addEventListener("message", function (e) {
    if (e.source !== parent) return;
    try { run(JSON.parse(e.data)); } catch (err) { /* not ours */ }
  });
  window.onYouTubeIframeAPIReady = function () {
    player = new YT.Player("p", {
      width: "100%",
      height: "100%",
      playerVars: { autoplay: 1, controls: 0, disablekb: 1, fs: 0, iv_load_policy: 3, playsinline: 1, rel: 0 },
      events: {
        onReady: function () { ready = true; up({ ev: "ready" }); if (pending) { run(pending); pending = null; } },
        onStateChange: function (e) { var x = times(); tick(e.data === 1); up({ ev: "state", state: e.data, t: x.t, d: x.d }); },
        onError: function (e) { tick(false); up({ ev: "error", code: e.data }); }
      }
    });
  };
})();
</script>
<script src="https://www.youtube.com/iframe_api"></script>
</body>
</html>
`;
