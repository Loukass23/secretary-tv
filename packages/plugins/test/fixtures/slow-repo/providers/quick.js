// Fixture provider for timing checks (docs/legacy-port-plan.md, phase 1): fixed results after a fixed delay. The
// links point at 192.0.2.0/24, an address range reserved for documentation, so nothing is ever played or resolved.
function getStreams(tmdbId, mediaType, season, episode) {
  return new Promise(function (resolve) {
    setTimeout(function () {
      resolve([
        { name: "Quick 1080p", title: "Fixture.1080p.x264.mkv\n2.1 GB", url: "https://192.0.2.10/fixture/quick/" + tmdbId + ".mkv", quality: "1080p" },
      ]);
    }, 300);
  });
}
module.exports = { getStreams: getStreams };
