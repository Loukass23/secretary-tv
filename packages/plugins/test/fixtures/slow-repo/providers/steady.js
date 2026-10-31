// Fixture provider for timing checks (docs/legacy-port-plan.md, phase 1): fixed results after a fixed delay. The
// links point at 192.0.2.0/24, an address range reserved for documentation, so nothing is ever played or resolved.
function getStreams(tmdbId, mediaType, season, episode) {
  return new Promise(function (resolve) {
    setTimeout(function () {
      resolve([
        { name: "Steady 2160p", title: "Fixture.2160p.HEVC.mkv\n14 GB", url: "https://192.0.2.10/fixture/steady/" + tmdbId + ".mkv", quality: "2160p" },
      ]);
    }, 4000);
  });
}
module.exports = { getStreams: getStreams };
