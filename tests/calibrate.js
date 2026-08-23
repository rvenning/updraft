"use strict";
// The gas calibrator.
//
// Difficulty in Updraft is not the length of a flight, it is whether the tank
// covers the ROUTE the flight asks for — and the route is set by how much
// climbing the cargo is spread across, which is content, not a constant. So the
// number to tune against is `want`: how much gas the ace would spend if it never
// ran out, measured by flying with the tank temporarily bottomless.
//
// `have` is what the flight actually offers. The ratio is the real difficulty
// dial, and it is the only view in which twenty flights can be compared.
//
//   node tests/calibrate.js [bot]

const S = require("./load.js");
const { Sky, BAND_H, FLIGHTS, PICKUPS, RULES, Game } = S;
const bots = require("./botlib.js");

const which = process.argv[2] || "ace";
const FPS = 60;

function measure(idx, bottomless, quotaOnly) {
  const f = FLIGHTS[idx];
  Game.progress = { upgrades: {} };
  Game.on = {};
  let end = null;
  Game.on.end = (r) => { end = r; };
  Game.reset("flight", f, idx);
  // The route that WINS, not the route that empties the sky. A pilot who has
  // the quota goes and lands; telling the bot the quota IS the total makes it
  // fly that route, and its duration is the number dusk has to be set from.
  if (quotaOnly) Game.total = Game.quota;
  // Bottomless in GAS only, never in daylight.
  //
  // Lifting the clock as well seemed like the way to measure a pure route, and
  // it measured nothing at all: with no sunset there is no reason to land, so
  // the bot chased the last balloon until the frame cap and every flight
  // reported the cap as its route time. The question worth asking is the one a
  // pilot asks — "in the daylight I have, what does this flight cost?" — so the
  // day stays exactly as authored and only the tank is opened up.
  if (bottomless) { Game.fuelMax = 1e6; Game.fuel = 1e6; }

  const act = bots.makeBot({ seed: 5, ...bots.BOTS[which] });
  let burnT = 0, climb = 0, lastY = Game.pos.y, fr = 0, gasFound = 0;
  Game.on.gas = () => { gasFound++; };
  while (Game.running && fr < FPS * 420) {
    act(Game, 1 / FPS);
    if (Game.input.burn) burnT += 1 / FPS * (Game.inThinAir() ? S.THIN_FUEL : 1);
    Game.update(1 / FPS);
    const dy = Game.pos.y - lastY;
    if (dy < 0) climb -= dy;
    lastY = Game.pos.y;
    fr++;
  }
  const r = end || Game.result;
  // A bottomless run that hits the cap has not measured a route, it has measured
  // a bot going round in circles. Say so rather than reporting the cap as data.
  return { r, t: fr / FPS, burnT, climb, gasFound, capped: fr >= FPS * 420 };
}

console.log(`\n  #  flight              want  have  ratio  burn%  climb  win-t  dusk  need  all   outcome`);
let over = 0, tight = 0;
for (let i = 0; i < FLIGHTS.length; i++) {
  const f = FLIGHTS[i];
  const free = measure(i, true);
  const quota = measure(i, true, true);
  const real = measure(i, false);
  // Dusk has to cover the winning route with room for a pilot who is not a bot.
  const winT = quota.r.win ? quota.t : null;
  const need = winT ? Math.ceil(winT * 1.5 / 2) * 2 : null;
  if (need && need > f.dusk) tight++;
  // What the route costs, and what the flight hands you for it.
  const want = free.burnT * RULES.BURN_FUEL;
  const cans = f.pickups.filter((p) => p.kind === "canister").length;
  const have = RULES.FUEL + cans * PICKUPS.canister.fuel;
  const ratio = want / have;
  const flag = free.capped ? " NEVER-LANDED" : "";
  if (ratio > 1) over++;
  console.log(
    ` ${String(i + 1).padStart(2)}  ${f.name.padEnd(19)}` +
    `${want.toFixed(0).padEnd(6)}${String(have).padEnd(6)}${ratio.toFixed(2).padEnd(7)}` +
    `${(100 * free.burnT / free.t).toFixed(0).padEnd(7)}` +
    `${(free.climb / BAND_H).toFixed(1).padEnd(7)}` +
    `${(winT ? winT.toFixed(0) : "----").padEnd(7)}${String(f.dusk).padEnd(6)}` +
    `${String(need || "----").padEnd(6)}${`${free.r.cargo}/${free.r.total}`.padEnd(6)}` +
    `${real.r.win ? `${real.r.stars}★ ${real.r.cargo}/${real.r.total} gas ${real.r.fuel}` : `LOST ${real.r.reason} ${real.r.cargo}/${real.r.total}`}${flag}`);
}
console.log(`\n  want  = gas the route costs, flown with a bottomless tank`);
console.log(`  have  = tank + every canister on the flight; ratio over 1.00 means the flight cannot be flown`);
console.log(`  win-t = seconds to reach the QUOTA and land — the route that actually wins`);
console.log(`  need  = the dusk that route deserves (win-t x1.5, for a pilot who is not a bot)`);
console.log(`  all   = cargo an unlimited tank collects inside the authored dusk`);
console.log(`  ${over}/${FLIGHTS.length} over gas budget · ${tight}/${FLIGHTS.length} short of daylight\n`);
