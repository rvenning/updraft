// Shared loader for the suites.
//
// Updraft ships plain <script> files with top-level `const` and no bundler, so
// the suites run the real sources in a vm sandbox with just enough of a browser
// stubbed out. `browser: true` because the terrain profile comes from gamekit's
// GK.Corridor and every gk-* module opens with `window.GK = window.GK || {}` —
// a pre-seeded GK in `globals` survives that line, which is the hook for
// stubbing the UI layer.
//
// Concatenation order must match index.html's, or a file that reads another's
// top-level const crashes on load.

const path = require("node:path");
const { loadScripts } = require("../lib/tools/test-harness.js");

const ROOT = path.join(__dirname, "..");
const noop = () => {};

const S = loadScripts({
  baseDir: ROOT,
  files: [
    "lib/gk-util.js",
    "lib/gk-path.js",
    "js/sky.js",
    "js/pickups.js",
    "js/birds.js",
    "js/flights.js",
    "js/rng.js",
    "js/drift.js",
    "js/upgrades.js",
    "js/game.js",
  ],
  exports: [
    "GK",
    "LW", "LH", "TAU", "BANDS", "BAND_H", "THIN_BAND", "THIN_FUEL", "THIN_COOL", "SHEAR", "Sky",
    "PICKUPS", "PICKUP_KINDS", "isCargo", "pickupColor", "makePickups",
    "BIRD_KINDS", "makeBirds", "birdPos", "birdSpan",
    "REGIONS", "FLIGHTS_RAW", "FLIGHTS", "flightsOfRegion",
    "RNG", "SEG", "DRIFT_SHEAR", "Drift",
    "UPGRADES", "upgradeValue",
    "BALLOON", "RULES", "Game",
  ],
  browser: true,
  globals: {
    GK: { UI: { showScreen: noop, openModal: noop, closeModal: noop, toast: noop } },
    Sfx: new Proxy({}, { get: () => noop }),
    Storage: { getProgress: () => ({ upgrades: {} }) },
    App: { flightOver: noop },
    document: { addEventListener: noop, getElementById: () => null, querySelector: () => null },
    performance: { now: () => 0 },
    requestAnimationFrame: noop,
  },
});

module.exports = S;
