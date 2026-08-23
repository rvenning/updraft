"use strict";
// Content linter for the twenty campaign flights and the Long Drift generator.
//
// Everything here is geometry, and every check exists because a hand-authored
// sky can break it silently: a balloon inside a hillside looks fine in the data
// and is simply uncollectable in play, and a sky with no westerly is a sky you
// can overshoot the field in and never get back to.
//
//   cd updraft && node --test
//   CD_REPORT=1 node --test tests/flights.test.js    # the per-flight table

const test = require("node:test");
const assert = require("node:assert");
const S = require("./load.js");

const { GK, LH, BANDS, BAND_H, THIN_BAND, Sky, FLIGHTS, REGIONS, PICKUPS, isCargo,
        makePickups, makeBirds, birdPos, birdSpan, BALLOON, RULES, RNG, SEG, Drift } = S;

// A pickup has to be reachable by a balloon, which hangs a basket below it.
const CLEAR = BALLOON.R + BALLOON.BASKET + 12;
const EAST = 20;      // a band this fast is a way to the field
const WEST = -14;     // ...and this one is a way back from overshooting it

/* ---------------------------------------------------------------- helpers */

const fails = [];
const bad = (msg) => fails.push(msg);
const label = (f) => `${f.idx + 1}. ${f.name}`;

// Free vertical lanes at an x, once every bird's patrol is subtracted. Deliberately
// conservative: a bird blocks its whole vertical sweep across its whole span, for
// all time. If a lane survives that, one survives in play.
function freeLanes(f, x) {
  const g = Sky.groundAt(f.cor, x);
  let acc = [[BALLOON.R, g - BALLOON.R - BALLOON.BASKET]];
  for (const b of f.birdObjs) {
    if (x < b.x - b.spec.r || x > b.x + b.span + b.spec.r) continue;
    const [top, bot] = birdSpan(b);
    const lo = top - BALLOON.R, hi = bot + BALLOON.R;
    const out = [];
    for (const [a, z] of acc) {
      if (hi <= a || lo >= z) { out.push([a, z]); continue; }
      if (lo > a) out.push([a, lo]);
      if (hi < z) out.push([hi, z]);
    }
    acc = out;
  }
  return acc;
}

// FLIGHTS already holds the constructed objects the engine flies through, so
// the linter reads exactly what the game reads rather than a rebuild of it.
for (const f of FLIGHTS) { f.pickupObjs = f.pickups; f.birdObjs = f.birds; }

/* ----------------------------------------------------------------- report */

if (process.env.CD_REPORT) {
  console.log("\n  #  flight              region        len  dusk  cargo  quota  birds  east  west  min-lane");
  for (const f of FLIGHTS) {
    let minLane = Infinity;
    for (let x = 0; x <= f.len; x += 40) {
      const best = freeLanes(f, x).reduce((m, [a, z]) => Math.max(m, z - a), 0);
      minLane = Math.min(minLane, best);
    }
    const east = Math.max(...f.winds), west = Math.min(...f.winds);
    console.log(
      ` ${String(f.idx + 1).padStart(2)}  ${f.name.padEnd(19)}${REGIONS[f.region].name.padEnd(14)}` +
      `${String(f.len).padEnd(5)}${String(f.dusk).padEnd(6)}${String(f.cargo).padEnd(7)}` +
      `${String(Math.ceil(f.cargo * RULES.QUOTA)).padEnd(7)}${String(f.birds.length).padEnd(7)}` +
      `${String(east).padEnd(6)}${String(west).padEnd(6)}${minLane.toFixed(0)}`);
  }
  console.log("");
}

/* -------------------------------------------------------------- the sky -- */

test("the wind model is continuous across every band boundary", () => {
  const winds = [10, -30, 45, -12, 60, -22];
  for (let i = 1; i < BANDS; i++) {
    const y = Sky.bandY(i, 0);                 // exactly the boundary
    const above = Sky.windAt(winds, y - 0.05);
    const below = Sky.windAt(winds, y + 0.05);
    assert.ok(Math.abs(above - below) < 0.6,
      `band ${i} boundary jumps ${above.toFixed(1)} -> ${below.toFixed(1)}`);
    // ...and a boundary really is the mean of the two bands, which is what makes
    // straddling a shear a legitimate (slow) way to travel.
    assert.ok(Math.abs(Sky.windAt(winds, y) - (winds[i] + winds[i - 1]) / 2) < 0.5,
      `band ${i} boundary is not the mean of its neighbours`);
  }
});

test("a band's centre carries that band's wind, undiluted", () => {
  const winds = [10, -30, 45, -12, 60, -22];
  for (let i = 0; i < BANDS; i++) {
    assert.equal(Sky.windAt(winds, Sky.bandY(i, 0.5)), winds[i],
      `band ${i} centre is not pure — reading the sky stops being a skill`);
  }
});

test("bandAt and bandY agree in both directions", () => {
  for (let i = 0; i < BANDS; i++) {
    for (const t of [0.1, 0.5, 0.9]) {
      assert.equal(Sky.bandAt(Sky.bandY(i, t)), i, `band ${i} at t=${t} round-trips wrong`);
    }
  }
});

/* ------------------------------------------------------- campaign shape -- */

test("every flight's terrain is a legal, flat-ended profile", () => {
  const out = [];
  for (const f of FLIGHTS) {
    out.push(...GK.Corridor.lint(Sky.stations(f.terrain), {
      label: label(f), bounds: [0, LH], minWidth: 260, maxSlope: 0.45, step: 20,
    }));
    // The sky has to exist a screen either side of the whole flight, or the
    // corridor holds its end station and the ground goes flat by accident.
    if (f.terrain[0][0] > -300) out.push(`${label(f)}: terrain starts at ${f.terrain[0][0]}`);
    const last = f.terrain[f.terrain.length - 1][0];
    if (last < f.len + 300) out.push(`${label(f)}: terrain ends at ${last}, before len+300`);
    // The meadow does not have to be dead level — you land against whatever is
    // under you — but it must not be a cliff, or one end of it is a different
    // job from the other.
    let lo = Infinity, hi = -Infinity;
    for (let x = f.len - RULES.FIELD_W; x <= f.len + RULES.FIELD_W; x += 20) {
      const gy = Sky.groundAt(f.cor, x);
      lo = Math.min(lo, gy); hi = Math.max(hi, gy);
    }
    if (hi - lo > 34) out.push(`${label(f)}: the landing meadow drops ${(hi - lo).toFixed(0)}px across its width`);
  }
  assert.deepEqual(out, []);
});

test("every flight has a way east AND a way back", () => {
  const out = [];
  for (const f of FLIGHTS) {
    if (!f.winds.some((w) => w >= EAST)) out.push(`${label(f)}: no band reaches the field`);
    // Without a westerly, overshooting the landing field is unrecoverable —
    // and being STUCK is the one thing that outranks difficulty.
    if (!f.winds.some((w) => w <= WEST)) out.push(`${label(f)}: no way back from an overshoot`);
    if (f.winds.length !== BANDS) out.push(`${label(f)}: ${f.winds.length} winds, expected ${BANDS}`);
  }
  assert.deepEqual(out, []);
});

// Contents lift themselves clear of the ground by construction, so this is not
// "did anything land inside a hill" — it cannot. It is the question that
// construction can't answer: was the authored band SO wrong that the sky put the
// thing somewhere else entirely? A ridge nudging a balloon up is the mechanism
// working; a balloon moved more than a band is a mistake in the data.
test("nothing was authored so far into a hillside that the sky had to move it", () => {
  const out = [];
  for (const f of FLIGHTS) {
    for (const p of f.pickupObjs) {
      if (p.lift > BAND_H) {
        out.push(`${label(f)}: ${p.kind} at x=${p.x} authored in band ${p.band} but lifted ${p.lift.toFixed(0)}px clear of a hill`);
      }
      const g = Sky.groundAt(f.cor, p.x);
      if (p.y + CLEAR > g + 0.5) out.push(`${label(f)}: ${p.kind} at x=${p.x} is still inside the ground`);
      if (p.y < BALLOON.R + 4) out.push(`${label(f)}: ${p.kind} at x=${p.x} is above the roof`);
      if (p.x < 120 || p.x > f.len + 260) out.push(`${label(f)}: ${p.kind} at x=${p.x} is outside the flight`);
      if (!PICKUPS[p.kind]) out.push(`${label(f)}: unknown pickup kind "${p.kind}"`);
    }
    for (const b of f.birdObjs) {
      const [top, bot] = birdSpan(b);
      if (Math.abs(b.lift) > BAND_H) {
        out.push(`${label(f)}: ${b.kind} at x=${b.x} authored in band ${b.band} but moved ${Math.abs(b.lift).toFixed(0)}px to fit`);
      }
      // A sweep squeezed to nothing means a hawk has quietly become a gull —
      // the level lost a mechanic and nothing would otherwise say so.
      if (b.spec.sweep > 0.5 && b.half < BAND_H * 0.35) {
        out.push(`${label(f)}: ${b.kind} at x=${b.x} squeezed its sweep to ${b.half.toFixed(0)}px — no room to patrol`);
      }
      if (top < 0) out.push(`${label(f)}: ${b.kind} at x=${b.x} sweeps above the roof`);
      for (let x = b.x; x <= b.x + b.span; x += 30) {
        if (bot > Sky.groundAt(f.cor, x) + 0.5) {
          out.push(`${label(f)}: ${b.kind} at x=${b.x} still flies through the ground at x=${x}`);
          break;
        }
      }
    }
  }
  assert.deepEqual(out, []);
});

test("a bird patrol never seals the sky", () => {
  const out = [];
  for (const f of FLIGHTS) {
    for (let x = 0; x <= f.len + 200; x += 40) {
      const best = freeLanes(f, x).reduce((m, [a, z]) => Math.max(m, z - a), 0);
      // A lane the balloon can actually hold: wider than the envelope, with
      // room for the vertical overshoot of a control that lags by design.
      if (best < 68) { out.push(`${label(f)}@${x}: widest bird-free lane is ${best.toFixed(0)}px`); break; }
    }
  }
  assert.deepEqual(out, []);
});

test("there is enough daylight to physically cross the flight", () => {
  const out = [];
  for (const f of FLIGHTS) {
    // Pure geometry, not a balance claim: at the fastest eastward band with no
    // detours at all, how long is the crossing? The bots do the real tuning.
    const floor = (f.len / Math.max(...f.winds)) * 1.5;
    if (f.dusk < floor) out.push(`${label(f)}: ${f.dusk}s of daylight for a ${floor.toFixed(0)}s minimum crossing`);
  }
  assert.deepEqual(out, []);
});

test("the campaign has enough cargo to be worth flying, and a fair quota", () => {
  const out = [];
  for (const f of FLIGHTS) {
    if (f.cargo < 5) out.push(`${label(f)}: only ${f.cargo} pieces of cargo`);
    const quota = Math.ceil(f.cargo * RULES.QUOTA);
    if (quota >= f.cargo) out.push(`${label(f)}: quota ${quota} of ${f.cargo} leaves no slack at all`);
    if (!f.note || f.note.length < 12) out.push(`${label(f)}: no briefing note`);
  }
  assert.deepEqual(out, []);
});

test("the campaign gets harder, region by region", () => {
  const per = REGIONS.map((r) => FLIGHTS.filter((f) => f.region === r.id));
  assert.ok(per.every((g) => g.length === 5), "regions are not five flights each");
  const mean = (g, fn) => g.reduce((s, f) => s + fn(f), 0) / g.length;
  for (let i = 1; i < per.length; i++) {
    assert.ok(mean(per[i], (f) => f.birds.length) >= mean(per[i - 1], (f) => f.birds.length),
      `region ${i + 1} has fewer birds on average than region ${i}`);
    assert.ok(mean(per[i], (f) => f.len) > mean(per[i - 1], (f) => f.len),
      `region ${i + 1} is not longer than region ${i}`);
    // Pressure, not just size: how much daylight you get per pixel of crossing.
    assert.ok(mean(per[i], (f) => f.dusk / f.len) < mean(per[i - 1], (f) => f.dusk / f.len),
      `region ${i + 1} is not tighter on daylight than region ${i}`);
  }
});

/* ------------------------------------------------------------ the drift -- */

test("the Long Drift is identical for the same seed and different for another", () => {
  const a = Drift.create("2026-08-23");
  const b = Drift.create("2026-08-23");
  const c = Drift.create("2026-08-24");
  Drift.ensure(a, SEG * 8); Drift.ensure(b, SEG * 8); Drift.ensure(c, SEG * 8);
  assert.deepEqual(a.terrain, b.terrain, "the same date generated two different skies");
  assert.deepEqual(a.pickups.map((p) => [p.x, p.band, p.kind]),
                   b.pickups.map((p) => [p.x, p.band, p.kind]));
  assert.notDeepEqual(a.terrain, c.terrain, "two dates generated the same sky");
});

test("a drift built lazily equals one built all at once", () => {
  // The whole point of seeding from COORDINATES: segment 7 must not depend on
  // whether segments 0-6 were generated first.
  const whole = Drift.create("lazy-check");
  Drift.ensure(whole, SEG * 9);
  const bit = Drift.create("lazy-check");
  for (let i = 1; i <= 9; i++) Drift.ensure(bit, SEG * i);
  assert.deepEqual(bit.terrain, whole.terrain);
  assert.deepEqual(bit.pickups.map((p) => p.x), whole.pickups.map((p) => p.x));
});

// Asked of the sky the balloon FLIES — windsAt(x), swept across the whole drift
// — and not of windsOf(n), the per-segment table it is built from.
//
// That distinction is the entire test. Both are "the wind", the per-segment
// version is far easier to check, and it passed cleanly while the blended sky it
// feeds cancelled itself to nothing at x=4881 and left the best pilot becalmed
// for four hundred seconds. A guarantee has to be asserted where the player
// meets it.
test("the drift always has a way east, at every point of every sky", () => {
  const out = [];
  for (const day of ["2026-08-23", "2026-09-01", "2026-09-14", "2027-01-14", "seed-x", "seed-y"]) {
    const f = Drift.create(day);
    Drift.ensure(f, SEG * 26);
    for (let x = 0; x < SEG * 25; x += 40) {
      const w = f.windsAt(x);
      if (!w.some((v) => v >= 22)) {
        out.push(`${day}@${x}: nothing blows east (${w.map((v) => v.toFixed(0)).join(",")})`);
        break;
      }
    }
    // ...and it is the same level all day, which is a thing worth knowing about
    // today's sky rather than a fact about the generator.
    const trade = Drift.tradeBand(f);
    for (let n = 0; n < 26; n++) {
      if (Drift.windsOf(f, n)[trade] < 26) out.push(`${day}/${n}: the trade wind failed`);
    }
  }
  assert.deepEqual(out, []);
});

test("gas runs out: the drift's supply curve has no floor", () => {
  const f = Drift.create("2026-08-23");
  Drift.ensure(f, SEG * 30);
  const cans = [];
  for (let n = 0; n < 30; n++) {
    cans.push(f.pickups.filter((p) => p.kind === "canister" &&
      p.x >= n * SEG && p.x < (n + 1) * SEG).length);
  }
  assert.ok(cans[0] >= 2, `the drift opens with only ${cans[0]} canisters`);
  const dry = cans.findIndex((c, i) => i > 3 && cans.slice(i).every((v) => v === 0));
  assert.ok(dry > 0 && dry < 20,
    `gas never dries up (first dry segment: ${dry}) — an endless mode with a floor never ends`);
});

// Found by the preview, not by a bot: a balloon blown west of the origin in the
// first few seconds asks for the region at a negative x, and an unclamped
// floor() hands back REGIONS[-1]. The renderer then dies on the first frame.
test("the drift has a region everywhere the balloon can reach", () => {
  const f = Drift.create("2026-08-23");
  Drift.ensure(f, SEG * 30);
  for (let x = -1200; x < SEG * 30; x += 137) {
    assert.ok(f.regionAt(x), `no region at x=${x}`);
  }
});

test("drift terrain always leaves sky to fly in", () => {
  const out = [];
  for (const day of ["2026-08-23", "seed-q"]) {
    const f = Drift.create(day);
    Drift.ensure(f, SEG * 20);
    for (let x = 0; x < SEG * 19; x += 50) {
      const g = Sky.groundAt(f.cor, x);
      if (g < 290) out.push(`${day}@${x}: ground reaches ${g.toFixed(0)}`);
    }
  }
  assert.deepEqual(out.slice(0, 5), []);
});
