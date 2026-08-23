// Permanent outfitting for the balloon, bought with ribbons. Pure data: the
// shop screen, the price curve and the in-game effect all read this table, so
// adding one is a single entry plus an `upgradeValue(upgrades, id, fallback)`
// lookup wherever it applies.
//
//   costs  ribbon price per level (length = max level)
//   value  effect per level (value[level - 1])
//
// Nothing here buys altitude, cargo or time directly. Every item makes an
// existing decision cheaper — which is what keeps a fully-outfitted balloon
// from erasing the campaign (tests/bot.test.js asserts exactly that).

const UPGRADES = [
  { id: "tank", name: "Bigger Tank", icon: "⛽",
    desc: "Carry more gas on every flight",
    costs: [150, 400, 900], value: [26, 58, 98], fmt: (v) => `+${v} gas` },

  { id: "burner", name: "Copper Burner", icon: "🔥",
    desc: "The burner puts heat in faster, so you climb harder",
    costs: [170, 430, 940], value: [1.16, 1.33, 1.52], fmt: (v) => `×${v} heat` },

  { id: "regulator", name: "Brass Regulator", icon: "🎛️",
    desc: "The same heat for less gas",
    costs: [200, 520], value: [0.86, 0.74], fmt: (v) => `×${v} gas used` },

  // Deliberately small numbers against 84px bands: a reach that covers most of
  // a band collects a level by flying through it, and a catch you did not aim
  // for is not a catch.
  { id: "net", name: "Long Net", icon: "🥅",
    desc: "Gather balloons from a little further away",
    costs: [140, 360, 800], value: [4, 8, 13], fmt: (v) => `+${v} reach` },

  { id: "sand", name: "Extra Ballast", icon: "🪨",
    desc: "One more sandbag to drop on every flight",
    costs: [280, 720], value: [1, 2], fmt: (v) => `+${v} sandbag${v > 1 ? "s" : ""}` },

  { id: "vent", name: "Quick Vent", icon: "💨",
    desc: "Dump heat faster when you need to get down",
    costs: [240, 600], value: [1.3, 1.62], fmt: (v) => `×${v} vent` },

  { id: "silk", name: "Kite Silk", icon: "🪡",
    desc: "A torn envelope loses heat far more slowly",
    costs: [660], value: [0.45], fmt: (v) => `×${v} tear cost` },
];

function upgradeValue(upgrades, id, fallback) {
  const def = UPGRADES.find((u) => u.id === id);
  const lvl = (upgrades && upgrades[id]) || 0;
  if (!def || lvl <= 0) return fallback;
  return def.value[Math.min(lvl, def.value.length) - 1];
}

if (typeof window === "undefined") Object.assign(globalThis, { UPGRADES, upgradeValue });
