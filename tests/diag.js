"use strict";
// Per-flight diagnostic: where does the gas actually go?
//
// Built the moment the bots first disagreed with the design, rather than after
// three tuning passes. A clear time says a flight is too hard; this says WHY —
// how much of the tank goes on holding altitude versus changing it, how long
// the pilot spends on the burner, and what the balloon was doing when it came
// down.
//
//   node tests/diag.js [flightIndex] [bot]

const S = require("./load.js");
const { Sky, BANDS, BAND_H, THIN_BAND, FLIGHTS, BALLOON, RULES, Game, Drift } = S;
const bots = require("./botlib.js");

const idx = Number(process.argv[2] || 0);
const which = process.argv[3] || "ace";
const FPS = 60;

const flight = FLIGHTS[idx];
Game.progress = { upgrades: {} };
Game.on = {};
let end = null;
Game.on.end = (r) => { end = r; };
Game.reset("flight", flight, idx);

const act = bots.makeBot({ seed: 5, ...bots.BOTS[which] });
let burnT = 0, ventT = 0, thinBurnT = 0, fuel0 = Game.fuel;
let climbPx = 0, sinkPx = 0, lastY = Game.pos.y;
const bandT = new Array(BANDS).fill(0);
const marks = [];
let fr = 0;

while (Game.running && fr < FPS * 420) {
  act(Game, 1 / FPS);
  const wasBurn = Game.input.burn, wasVent = Game.input.vent;
  const thin = Game.inThinAir();
  Game.update(1 / FPS);
  if (wasBurn) { burnT += 1 / FPS; if (thin) thinBurnT += 1 / FPS; }
  if (wasVent) ventT += 1 / FPS;
  const dy = Game.pos.y - lastY;
  if (dy < 0) climbPx -= dy; else sinkPx += dy;
  lastY = Game.pos.y;
  bandT[Sky.bandAt(Game.pos.y)] += 1 / FPS;
  if (fr % (FPS * 10) === 0) {
    marks.push(`${(fr / FPS).toFixed(0)}s x=${Game.pos.x.toFixed(0)} y=${Game.pos.y.toFixed(0)} ` +
      `b${Sky.bandAt(Game.pos.y)} gas=${Game.fuel.toFixed(0)} cargo=${Game.cargo}`);
  }
  fr++;
}
const r = end || Game.result || { reason: "timeout" };
const t = fr / FPS;

console.log(`\n${idx + 1}. ${flight.name} — ${which}`);
console.log(`  ${r.win ? "LANDED" : "LOST"} (${r.reason}) after ${t.toFixed(0)}s of ${flight.dusk}s daylight`);
console.log(`  cargo ${r.cargo}/${r.total} (quota ${r.quota}) · scrapes ${r.scrapes} · tears ${r.tears} · sand used ${r.sandUsed}/${Game.sandMax}`);
console.log(`  gas: ${fuel0.toFixed(0)} start, +${(Game.gasTaken * PICKUPS_FUEL()) } picked up, ${r.fuel} left`);
console.log(`  burner held ${burnT.toFixed(1)}s (${(100 * burnT / t).toFixed(0)}% of the flight), ` +
  `${thinBurnT.toFixed(1)}s of it in thin air at ${RULES.BURN_FUEL * S.THIN_FUEL}/s`);
console.log(`  vent held ${ventT.toFixed(1)}s · climbed ${climbPx.toFixed(0)}px, sank ${sinkPx.toFixed(0)}px ` +
  `(${(climbPx / BAND_H).toFixed(1)} bands up)`);
console.log(`  gas per second of flight: ${((fuel0 + Game.gasTaken * PICKUPS_FUEL() - r.fuel) / t).toFixed(2)}`);
console.log(`  time per band: ${bandT.map((v, i) => `${i}:${v.toFixed(0)}s`).join(" ")}`);
console.log(`  x reached ${Game.pos.x.toFixed(0)} of ${flight.len}`);
console.log("  " + marks.join("\n  ") + "\n");

function PICKUPS_FUEL() { return S.PICKUPS.canister.fuel; }
