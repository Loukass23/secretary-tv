// Fixture provider (docs/legacy-port-plan.md, phase 6c): answers at once with a provider's message in a source's place,
// which the app must list but never autoplay.
function getStreams() {
  return Promise.resolve([
    { name: "Configure this addon", title: "Open the addon's settings to add your key", url: "https://192.0.2.10/fixture/configure" },
  ]);
}
module.exports = { getStreams: getStreams };
