"use strict";
// Updraft — headless balance bots. These drive the REAL engine (js/game.js has
// no DOM, canvas or audio) through all twenty flights and the Long Drift, so
// the numbers below are what a pilot actually meets.
//
// The engine contains no randomness whatsoever — the wind and the ground are
// functions of position, the birds are functions of the clock — so the ONLY
// randomness anywhere is the ordinary pilot's own sloppiness, which is seeded
// here in the test's own realm. A changed clear time is therefore a genuine
// balance change rather than a bad roll.
//
// Five bots, because one is never enough:
//
//   ace         the guardrail. Flies the best plan it can see, with no
//               hesitation and no error. Nothing may be unwinnable by it.
//   pilot       the tuning target: a competent person. Reacts slowly, aims
//               imprecisely, and occasionally ignores a balloon. Must clear the
//               campaign and must NOT three-star all of it.
//   roof        climbs to the top band and rides it everywhere. If this wins,
//               thin air is decoration and there is no sky to read.
//   drift       never touches the burner or the vent. The control. The controls
//               here are IMPULSES, so doing nothing really is doing nothing:
//               the envelope cools, the balloon sinks, and it grounds out.
//   progression each flight once, in order, spending the ribbons earned so far.
//               The honest campaign, and where "an ordinary pilot is stuck" is a
//               real claim rather than an artefact of the harness.
//
//   cd updraft && node --test
//   CD_REPORT=1 node --test tests/bot.test.js     # the per-flight table

const test = require("node:test");
const assert = require("node:assert");
const S = require("./load.js");
const { makeBot, BOTS } = require("./botlib.js");

const { LH, BANDS, BAND_H, THIN_BAND, Sky, FLIGHTS, PICKUPS, isCargo, birdSpan,
        BALLOON, RULES, UPGRADES, upgradeValue, RNG, SEG, Drift, Game } = S;

const FPS = 60;

/* ============================================================ harness ==== */

function fly(cfg, o) {
  const flight = cfg.mode === "drift" ? Drift.create(cfg.seed) : FLIGHTS[cfg.idx];
  Game.progress = { upgrades: cfg.upgrades || {} };
  Game.on = {};
  let done = null;
  Game.on.end = (r) => { done = r; };
  Game.reset(cfg.mode === "drift" ? "drift" : "flight", flight, cfg.mode === "drift" ? -1 : cfg.idx);

  const act = makeBot(o);
  const cap = FPS * (o.maxSeconds || 420);
  let fr = 0;
  while (Game.running && fr < cap) {
    act(Game, 1 / FPS);
    Game.update(1 / FPS);
    fr++;
  }
  if (!done) { Game.abandon(); return { ...Game.result, timedOut: true }; }
  return { ...done, time: fr / FPS };
}

const campaign = (bot, extra = {}) =>
  FLIGHTS.map((f, i) => fly({ mode: "flight", idx: i, ...extra }, { seed: 7 + i * 13, ...BOTS[bot], ...extra }));

/* ------------------------------ progression ------------------------------
   Playing every flight with NO outfitting is not a run anybody makes: by the
   time you unlock flight eleven you have flown ten and been paid for all of
   them. Playing with a FULL shop is not one either. The run that matters is the
   progression — each flight once, in order, spending what has been earned. */

const balance = (p) => p.earned - p.spent;

// Buy the cheapest thing available, repeatedly. A pessimistic model of a real
// shopper (nobody saves 900 ribbons for Copper Burner III), which is what makes
// it a safe floor to assert against.
function greedyBuy(prog) {
  for (;;) {
    let best = null;
    for (const u of UPGRADES) {
      const lvl = prog.upgrades[u.id] || 0;
      if (lvl >= u.costs.length) continue;
      if (u.costs[lvl] > balance(prog)) continue;
      if (!best || u.costs[lvl] < best.cost) best = { u, cost: u.costs[lvl], lvl };
    }
    if (!best) return;
    prog.spent += best.cost;
    prog.upgrades[best.u.id] = best.lvl + 1;
  }
}

const MAX_TRIES = 3;

function runProgression(bot = "careful") {
  const prog = { earned: 0, spent: 0, upgrades: {} };
  const results = [];
  let attempts = 0;
  for (let i = 0; i < FLIGHTS.length; i++) {
    let r = null, tries = 0;
    // A failed flight is retried with a different sloppiness, because that is
    // what a person does. Being stuck means every try fails.
    while (tries < MAX_TRIES) {
      tries++; attempts++;
      r = fly({ mode: "flight", idx: i, upgrades: { ...prog.upgrades } },
              { seed: 101 + i * 37 + tries * 911, ...BOTS[bot] });
      prog.earned += r.ribbons;
      if (r.win) break;
    }
    r.tries = tries;
    r.kit = { ...prog.upgrades };
    r.bank = balance(prog);
    results.push(r);
    greedyBuy(prog);
    if (!r.win) break;                    // stuck: nothing past here is real
  }
  return { results, prog, attempts };
}

/* ------------------------------- the report ------------------------------ */

function report() {
  const prog = runProgression();
  const bots = { ace: campaign("ace"), pilot: campaign("pilot"), roof: campaign("roof"), drift: campaign("drift") };
  const cell = (r) => (!r ? "        " : r.timedOut ? "TIMEOUT " : r.win
    ? `${r.stars}★ ${Math.round(r.time)}s` : `  ${r.reason.slice(0, 6).padEnd(6)}`);

  console.log("\n  #  flight              progression  try  bank  gas  ace        pilot      roof       drift");
  FLIGHTS.forEach((f, i) => {
    const p = prog.results[i];
    console.log(
      ` ${String(i + 1).padStart(2)}  ${f.name.padEnd(19)}${cell(p).padEnd(13)}` +
      `${String(p ? p.tries : "-").padEnd(5)}${String(p ? p.bank : "-").padEnd(6)}` +
      `${String(p ? p.fuel : "-").padEnd(5)}` +
      `${cell(bots.ace[i]).padEnd(11)}${cell(bots.pilot[i]).padEnd(11)}` +
      `${cell(bots.roof[i]).padEnd(11)}${cell(bots.drift[i])}`);
  });

  const sum = (rs, k) => rs.reduce((s, r) => s + (r[k] || 0), 0);
  const wins = (rs) => rs.filter((r) => r.win).length;
  console.log(`\n stars:  progression ${sum(prog.results, "stars")}/60 · ace ${sum(bots.ace, "stars")}/60 ` +
    `· pilot ${sum(bots.pilot, "stars")}/60 · roof ${sum(bots.roof, "stars")}/60 · drift ${sum(bots.drift, "stars")}/60`);
  console.log(` wins:   ace ${wins(bots.ace)}/20 · pilot ${wins(bots.pilot)}/20 · roof ${wins(bots.roof)}/20 · drift ${wins(bots.drift)}/20`);
  console.log(` cargo:  ace ${sum(bots.ace, "cargo")} · pilot ${sum(bots.pilot, "cargo")} of ${sum(bots.ace, "total")}`);
  console.log(` score:  ace ${sum(bots.ace, "score").toLocaleString()} · pilot ${sum(bots.pilot, "score").toLocaleString()} · progression ${sum(prog.results, "score").toLocaleString()}`);
  console.log(` scrapes ${sum(bots.pilot, "scrapes")} · tears ${sum(bots.pilot, "tears")} (pilot)`);
  console.log(` shop at the end: ${JSON.stringify(prog.prog.upgrades)} (${balance(prog.prog)} ribbons spare, ` +
    `${prog.attempts} flights for ${FLIGHTS.length} levels)`);

  for (const day of ["2026-08-23", "2026-09-14"]) {
    const d = fly({ mode: "drift", seed: day }, { seed: 5, ...BOTS.ace, maxSeconds: 900 });
    const dp = fly({ mode: "drift", seed: day }, { seed: 5, ...BOTS.pilot, maxSeconds: 900 });
    console.log(` drift ${day}: ace ${d.metres}m / ${d.score} in ${Math.round(d.time)}s${d.timedOut ? " (NEVER ENDED)" : ""}` +
      ` · pilot ${dp.metres}m / ${dp.score} in ${Math.round(dp.time)}s`);
  }
  console.log("");
}

if (process.env.CD_REPORT) { report(); process.exit(0); }

/* ------------------------------ assertions ------------------------------- */

// The kindness guarantee, and the one that outranks difficulty: flying each
// flight in order and buying what the ribbons so far can afford, you are never
// stopped. Losing a flight is fine. Being unable to get past one is not.
test("an ordinary pilot is never stuck", () => {
  const { results, attempts } = runProgression();
  assert.equal(results.length, FLIGHTS.length,
    `stuck at flight ${results.length} (${FLIGHTS[results.length - 1].name}): ` +
    `${results[results.length - 1].reason}, ` +
    `${results[results.length - 1].cargo}/${results[results.length - 1].total} aboard`);
  results.forEach((r, i) => {
    assert.ok(!r.timedOut, `${i + 1}. ${FLIGHTS[i].name}: never ended`);
    assert.ok(r.win, `${i + 1}. ${FLIGHTS[i].name}: an ordinary pilot is STUCK here`);
  });
  // A flight you have to re-fly is fine; one you might re-fly six times is a grind.
  assert.ok(attempts / FLIGHTS.length < 1.4,
    `${(attempts / FLIGHTS.length).toFixed(2)} attempts per flight — the campaign is a grind`);
});

// A stricter, narrower guarantee than the progression one, and note WHICH pilot
// it is asked of. The greedy bots lose flights on purpose — they hold on for one
// more balloon and miss the sunset, which is a choice rather than a wall — so
// this asks the pilot who is trying to get home, flying with NOTHING bought.
//
// The answer is not "all twenty", and that is the design rather than a failure:
// by the High Passes the balloon is expected to have been outfitted, and the
// progression test above is what proves you always can afford to. What must hold
// is that the early campaign never depends on the shop, and that any flight which
// does is one of the last few.
test("nothing before the High Passes needs a single ribbon spent", () => {
  const runs = campaign("careful");
  const lost = runs.map((r, i) => [i, r]).filter(([, r]) => !r.win || r.timedOut);
  const early = lost.filter(([i]) => FLIGHTS[i].region < 3);
  assert.deepEqual(
    early.map(([i, r]) => `${i + 1}. ${FLIGHTS[i].name}: ${r.timedOut ? "timed out" : r.reason}`), [],
    "a bare balloon cannot clear these, and they are not late enough to ask for a shop");
  assert.ok(lost.length <= 3,
    `${lost.length} flights need outfitting — the shop has stopped being optional`);
  runs.forEach((r, i) => assert.ok(!r.timedOut, `${i + 1}. ${FLIGHTS[i].name}: never ended`));
});

test("but the stars are still worth chasing", () => {
  const prog = runProgression().results;
  const stars = prog.reduce((s, r) => s + r.stars, 0);
  const max = FLIGHTS.length * 3;
  assert.ok(stars < max * 0.6,
    `an ordinary first-try pilot earned ${stars} of ${max} stars — nothing left to come back for`);
  assert.ok(stars >= FLIGHTS.length, `only ${stars} stars — landing at all should be worth something`);
  // ...and specifically, the top grade is never a first-try accident.
  assert.equal(prog.filter((r) => r.stars === 3).length, 0,
    "a pilot who was only trying to get home three-starred a flight");
});

test("a better pilot really is better", () => {
  const ace = campaign("ace"), pilot = campaign("pilot");
  const sum = (rs, k) => rs.reduce((s, r) => s + (r[k] || 0), 0);
  // Aggregates across the whole campaign, never a per-flight comparison: one
  // flight swings on a single missed balloon.
  assert.ok(sum(ace, "cargo") > sum(pilot, "cargo") * 1.03,
    `flying well gathers no more cargo (${sum(ace, "cargo")} vs ${sum(pilot, "cargo")})`);
  assert.ok(sum(ace, "score") > sum(pilot, "score") * 1.05,
    `flying well scores no better (${sum(ace, "score")} vs ${sum(pilot, "score")})`);
});

test("doing nothing lands nothing", () => {
  const runs = campaign("drift");
  runs.forEach((r, i) => {
    assert.ok(!r.win, `${i + 1}. ${FLIGHTS[i].name}: won by NOT TOUCHING THE BURNER`);
    assert.equal(r.stars, 0, `${i + 1}. ${FLIGHTS[i].name}: an untouched balloon earned ${r.stars} stars`);
  });
  // ...and it does not merely run the clock out: an envelope nobody heats cools,
  // sinks, and drags itself down, which is the mechanic saying so out loud.
  const grounded = runs.filter((r) => r.reason === "grounded").length;
  assert.ok(grounded >= FLIGHTS.length * 0.8,
    `only ${grounded}/${FLIGHTS.length} untouched balloons actually came down`);
});

test("living on the roof is not the whole game", () => {
  const won = campaign("roof").filter((r) => r.win).length;
  assert.ok(won <= 2,
    `a pilot who only ever climbs to the top band cleared ${won}/${FLIGHTS.length} flights — ` +
    "the sky below the roof is decoration and there is nothing to read");
});

// Test a claim at the layer the claim lives at. "The roof is expensive" is a
// statement about the burner, not about whether a bot that lives up there wins —
// that bot loses for a much duller reason (there is no cargo at the top).
test("thin air really does drink gas", () => {
  const burnFor = (y) => {
    Game.progress = { upgrades: {} };
    Game.on = {};
    Game.reset("flight", FLIGHTS[0], 0);
    Game.heat = BALLOON.HEAT_MAX;
    const before = Game.fuel;
    Game.input.burn = true;
    for (let i = 0; i < FPS * 4; i++) { Game.pos.y = y; Game.update(1 / FPS); }
    return before - Game.fuel;
  };
  const roof = burnFor(Sky.bandY(BANDS - 1, 0.5));
  const mid = burnFor(Sky.bandY(2, 0.5));
  assert.ok(roof > mid * 1.8,
    `four seconds on the burner costs ${roof.toFixed(0)} at the roof and ` +
    `${mid.toFixed(0)} mid-stack — thin air is free`);
});

test("the shop is worth buying and does not erase the campaign", () => {
  const bare = campaign("pilot");
  const full = { tank: 3, burner: 3, regulator: 2, net: 3, sand: 2, vent: 2, silk: 1 };
  const kitted = FLIGHTS.map((f, i) =>
    fly({ mode: "flight", idx: i, upgrades: full }, { seed: 7 + i * 13, ...BOTS.pilot }));
  const sum = (rs, k) => rs.reduce((s, r) => s + (r[k] || 0), 0);
  assert.ok(sum(kitted, "cargo") > sum(bare, "cargo"),
    `a full shop gathers no more cargo (${sum(kitted, "cargo")} vs ${sum(bare, "cargo")})`);
  assert.ok(sum(kitted, "stars") < FLIGHTS.length * 3,
    "a full shop three-stars the entire campaign — the rewards erase the game");
});

test("the ribbon economy pays for the shop without buying it outright", () => {
  const { prog } = runProgression();
  const total = UPGRADES.reduce((s, u) => s + u.costs.reduce((a, c) => a + c, 0), 0);
  assert.ok(prog.earned > total * 0.2,
    `a whole campaign earned ${prog.earned} ribbons against a ${total}-ribbon shop — nothing is affordable`);
  // A big unspent purse at the end means the shop ran out halfway and the
  // currency died with it.
  assert.ok(balance(prog) < total * 0.25,
    `${balance(prog)} ribbons left unspent — the shop empties before the campaign does`);
});

/* -------------------------------- the drift ------------------------------ */

test("the Long Drift ends, even for the best pilot", () => {
  for (const day of ["2026-08-23", "2026-09-14", "2027-03-02", "2027-07-19"]) {
    const r = fly({ mode: "drift", seed: day }, { seed: 5, ...BOTS.ace, maxSeconds: 900 });
    assert.ok(!r.timedOut,
      `${day}: the drift never ended — an endless mode with no ceiling has no score to compare`);
    assert.equal(r.reason, "dry", `${day}: the drift ended with "${r.reason}", not by running out of gas`);
    assert.ok(r.metres > 60, `${day}: the drift ended after only ${r.metres}m`);
    assert.ok(r.score > 0, `${day}: the drift scored nothing`);
  }
});

// Deliberately NOT "the ace out-flies the pilot" — out here it does not, and the
// reason is worth writing down rather than tuning away. Gas is the only clock in
// the drift, so holding an altitude tightly is a COST rather than a skill: the
// bot with the narrower burner deadband cycles it more, burns more, and settles
// sooner. Over-controlling a balloon costs you the sky. What is true, and what
// this asserts, is that every seed makes a real run and no seed makes a trivial
// one.
test("every day's drift is worth flying", () => {
  const runs = ["2026-08-23", "2026-09-14", "2027-03-02", "2027-07-19", "2027-11-30"]
    .map((day) => fly({ mode: "drift", seed: day }, { seed: 5, ...BOTS.pilot, maxSeconds: 900 }));
  runs.forEach((r, i) => {
    assert.ok(r.metres > 80, `seed ${i}: only ${r.metres}m — that day's sky goes nowhere`);
    assert.ok(r.cargo > 3, `seed ${i}: only ${r.cargo} aboard`);
    assert.ok(r.time < 600, `seed ${i}: ${r.time.toFixed(0)}s is too long for one run`);
  });
});

/* ------------------------------ the mechanics ---------------------------- */

test("ballast is a real trade: lighter climbs better and dives worse", () => {
  Game.progress = { upgrades: {} };
  Game.on = {};
  Game.reset("flight", FLIGHTS[0], 0);
  const heavy = Game.sinkCap();
  Game.heat = BALLOON.HEAT_MAX;
  const heavyClimb = -(Game.heat - Game.neutral()) * BALLOON.RISE / Game.mass;
  while (Game.sand > 0) Game.dropSand();
  const light = Game.sinkCap();
  const lightClimb = -(Game.heat - Game.neutral()) * BALLOON.RISE / Game.mass;
  assert.ok(light < heavy * 0.85,
    `dropping every sandbag barely slowed the dive (${light.toFixed(0)} vs ${heavy.toFixed(0)})`);
  assert.ok(lightClimb < heavyClimb * 1.15,
    `dropping every sandbag barely helped the climb (${lightClimb.toFixed(0)} vs ${heavyClimb.toFixed(0)})`);
});

test("a torn envelope really costs something, and the tears stack", () => {
  const sinkIn6s = (tears) => {
    Game.progress = { upgrades: {} };
    Game.on = {};
    Game.reset("flight", FLIGHTS[0], 0);
    Game.tears = tears;
    Game.input.burn = false; Game.input.vent = false;
    const y0 = Game.pos.y;
    for (let i = 0; i < FPS * 6; i++) Game.update(1 / FPS);
    return Game.pos.y - y0;
  };
  const [none, one, three] = [sinkIn6s(0), sinkIn6s(1), sinkIn6s(3)];
  assert.ok(one > none * 1.05, `one tear costs nothing (${none.toFixed(0)} vs ${one.toFixed(0)}px of sink)`);
  assert.ok(three > one * 1.05,
    `three tears are no worse than one (${one.toFixed(0)} vs ${three.toFixed(0)}px) — the penalty does not stack`);
});

test("the engine survives a monstrous frame without teleporting", () => {
  Game.progress = { upgrades: {} };
  Game.on = {};
  Game.reset("flight", FLIGHTS[3], 3);
  const before = { ...Game.pos };
  Game.update(60);                       // a tab that was hidden for a minute
  assert.ok(Math.abs(Game.pos.x - before.x) < 400 && Math.abs(Game.pos.y - before.y) < 400,
    `a 60-second frame moved the balloon to ${Game.pos.x.toFixed(0)},${Game.pos.y.toFixed(0)}`);
});

test("a finished flight cannot be flown on", () => {
  Game.progress = { upgrades: {} };
  Game.on = {};
  Game.reset("flight", FLIGHTS[0], 0);
  Game.finish(true, "landed");
  const snap = { ...Game.pos, fuel: Game.fuel };
  for (let i = 0; i < 120; i++) Game.update(1 / FPS);
  assert.deepEqual({ ...Game.pos, fuel: Game.fuel }, snap, "the engine kept simulating a landed balloon");
});

// The 2x toggle is a wall-clock convenience for an adult playing a long flight,
// and it must not be a difficulty setting. update() sub-steps, so a doubled
// frame integrates in the same 1/60 slices a normal one does.
test("2x speed changes the wall clock and nothing else", () => {
  const run = (slice) => {
    Game.progress = { upgrades: {} };
    Game.on = {};
    Game.reset("flight", FLIGHTS[2], 2);
    const act = makeBot({ seed: 3, ...BOTS.careful });
    for (let t = 0; t < 40; t += slice) { act(Game, slice); Game.update(slice); }
    return { x: Game.pos.x, y: Game.pos.y, fuel: Game.fuel };
  };
  const one = run(1 / 60), two = run(2 / 60);
  // The bot's own reaction times differ slightly at a coarser slice, so compare
  // positions within a tolerance rather than pinning them.
  assert.ok(Math.abs(one.x - two.x) < 80 && Math.abs(one.y - two.y) < 80,
    `2x flew a different flight (${one.x.toFixed(0)},${one.y.toFixed(0)} vs ${two.x.toFixed(0)},${two.y.toFixed(0)})`);
  assert.ok(Math.abs(one.fuel - two.fuel) < 14,
    `2x burned a different amount of gas (${one.fuel.toFixed(0)} vs ${two.fuel.toFixed(0)})`);
});
