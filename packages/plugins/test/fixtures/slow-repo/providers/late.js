// Fixture provider for timing checks (docs/legacy-port-plan.md, phase 1): fixed results after a fixed delay. The
// links point at 192.0.2.0/24, an address range reserved for documentation, so nothing is ever played or resolved.
function getStreams(tmdbId, mediaType, season, episode) {
  return new Promise(function (resolve) {
    setTimeout(function () {
      resolve([
        { name: "Late 2160p HDR", title: "Fixture.2160p.HEVC.HDR.mkv\n22 GB", url: "https://192.0.2.10/fixture/late/" + tmdbId + ".mkv", quality: "2160p" },
      ]);
    }, 12000);
  });
}
module.exports = { getStreams: getStreams };
