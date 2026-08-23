"use strict";
// The pilots. Shared by tests/bot.test.js (balance) and tests/diag.js (where
// the gas goes), so the thing being measured and the thing being asserted on
// are the same pilot.
//
// The engine contains no randomness whatsoever — the wind and the ground are
// functions of position, the birds are functions of the clock — so the ONLY
// randomness anywhere is the ordinary pilot's own sloppiness, seeded here in
// the test's realm. A changed clear time is a genuine balance change.

const S = require("./load.js");
const { LH, BANDS, BAND_H, THIN_BAND, Sky, isCargo, birdPos, BALLOON, RULES } = S;

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// One decision: where do I want to be, vertically, right now?
//
// Everything in Updraft reduces to that. A band is chosen for where its wind
// takes you, an altitude within it for what is hanging there, and the burner is
// only ever a means of arriving at the answer.
function chooseTarget(G, o, rnd, st) {
  const p = G.pos, f = G.flight;
  const winds = f.windsAt(p.x);
  const fieldY = f.endless ? 0 : G.groundHere(f.len) - BALLOON.R - BALLOON.BASKET - 4;

  /* ---- 1. how long would getting home actually take, from here? ---- */
  //
  // Not "distance over the fastest wind in the sky". That band may be four
  // climbs away, and it ignores the descent entirely — with it, the ace held on
  // for one last balloon with fifty seconds left, spent them shuttling back and
  // forth over the same three hundred pixels, and never landed at all.
  const tDrop = Math.max(0, fieldY - p.y) / (G.sinkCap() * 0.7);
  const homeSpeed = (fromX) => {
    const away = f.len - fromX;
    const usable = winds.filter((w) => w * away > 0 && Math.abs(w) > 10);
    return usable.length ? Math.max(...usable.map(Math.abs)) : 14;
  };
  const timeHome = (fromX) => Math.abs(f.len - fromX) / homeSpeed(fromX) + tDrop + 8;

  let goal = null;
  if (!f.endless && (G.cargo >= G.total || G.timeLeft < timeHome(p.x) * o.reserve)) {
    goal = { x: f.len, y: fieldY, land: true };
  }

  /* ---- 2. otherwise, the cheapest thing still hanging in the sky ---- */
  if (!goal) {
    const wantGas = G.fuel < G.fuelMax * 0.45;
    const price = (it) => {
      const dx = it.x - p.x;
      // The wind that would actually carry you there, not the crow's distance.
      const carry = Math.max(12, Math.abs(Sky.windAt(winds, it.y)));
      let cost = Math.abs(dx) / carry + Math.abs(it.y - p.y) / 55;
      if (!f.endless && dx < -40) cost += 6;           // going back costs daylight
      if (f.endless && dx < 0) cost += 10;             // and in the drift, score
      if (!isCargo(it.kind)) cost *= 0.35;
      return cost;
    };
    // Can I get it AND still get home? The judgement that separates a pilot
    // from a vacuum cleaner, and the thing that stops one unreachable balloon
    // costing a whole flight.
    const affordable = (it) =>
      f.endless || price(it) + timeHome(it.x) < G.timeLeft * o.chase;
    let best = null;
    for (const it of G.pickups) {
      if (it.got) continue;
      if (!isCargo(it.kind) && !wantGas) continue;
      if (o.skip && rnd() < o.skip) continue;          // a person misses one
      // Once the delivery is aboard, only take what is on the way. Turning
      // back for one more balloon is how a pilot who had already won ends up
      // out of gas in the wrong county — the estimates that say it is affordable
      // do not price the climb back out, and no amount of tuning them will.
      // In the Long Drift, distance IS the score, so nothing behind you is ever
      // worth turning round for. Without this the ace crawled 4500px in ten
      // minutes, averaging 7px/s in a sky where the slowest band blows 15.
      if (f.endless && it.x < p.x - 20) continue;
      if (o.forward && G.cargo >= G.quota && it.x < p.x + 60) continue;
      if (st.given.has(it) || !affordable(it)) continue;
      const cost = price(it);
      if (!best || cost < best.cost) best = { cost, it };
    }
    // Stick with what you were already going for. Re-choosing every fifth of a
    // second is not decisiveness — with a control that lags, the balloon spends
    // the whole approach a fraction of the way toward a goal that keeps moving,
    // and it arrives at none of them. Switching costs a climb, so only a much
    // cheaper prize is worth it.
    const stale = st.goal && G.T - st.since > 26;
    if (stale) { st.given.add(st.goal); st.goal = null; }   // enough of that one
    if (st.goal && !st.goal.got && affordable(st.goal) &&
        (!best || best.cost > price(st.goal) * 0.62)) best = { it: st.goal };
    if (best) {
      if (best.it !== st.goal) { st.goal = best.it; st.since = G.T; }
      goal = { x: best.it.x, y: best.it.y, land: false };
    }
    else if (!f.endless) goal = { x: f.len, y: fieldY, land: true };
    else goal = { x: p.x + 900, y: p.y, land: false };  // the drift: just go east
  }

  /* ---- 3. close enough to reach for, or still choosing a band? ---- */

  // The landing.
  //
  // Coming down is not a vertical move — it is a traverse of every band between
  // here and the ground, and some of them blow the other way. Assuming the
  // current band's speed holds all the way down (which is what this used to do)
  // puts you over the field at four hundred feet and then hands you to a
  // westerly that carries you back off it: on The Reach the ace reached the
  // field at 59 seconds, started down, and was still 400px short of it when the
  // sun set two minutes later.
  //
  // Integrate the drop instead. The answer comes back SIGNED, and when it is
  // negative the correct approach is to overfly the field and let the descent
  // bring you back to it — which is a real piece of piloting, not a bot trick.
  if (goal.land) {
    // Over the meadow already? Put it down. Working out where to BEGIN the
    // descent is only interesting while you are still short of the field — ask
    // it while standing on the doorstep and a thirty-pixel rounding sends you
    // back up into a westerly. The careful pilot spent a hundred seconds doing
    // that with the delivery aboard and the field underneath it.
    if (G.overField()) return { ty: dodge(G, fieldY, o, 1, true), goal };
    let drift = 0, y = p.y;
    const sink = G.sinkCap() * 0.8, step = 0.2;
    for (let i = 0; i < 200 && y < fieldY; i++) {
      drift += Sky.windAt(winds, y) * step;
      y += sink * step;
    }
    const startAt = f.len - drift;
    if (p.x >= startAt - 30) return { ty: dodge(G, fieldY, o, 1, true), goal };
    goal = { x: startAt, y: fieldY, land: true };
  }
  const dx = goal.x - p.x;

  // WHERE do you have to be before you drop onto it?
  //
  // A balloon hanging in a westerly cannot be reached from the west: descend to
  // its altitude and the wind carries you away from it. You have to get past it
  // first and let the wind bring it to you. The ace spent a hundred and thirty
  // seconds oscillating over this — diving at a target, being blown back,
  // climbing, diving again — and reported the flight as unwinnable.
  //
  // So aim at a point UPWIND of the cargo, and only commit to its altitude once
  // you are there. That is not a bot heuristic; it is how the game is played.
  const wGoal = Sky.windAt(winds, goal.y);
  const still = Math.abs(wGoal) < 9;
  // How far upwind depends on how hard the wind blows there — enough to arrive
  // on the right side and be carried on, not so far that you fly the flight
  // twice.
  const lead = Math.max(60, Math.min(190, Math.abs(wGoal) * 2.4));
  const approachX = still ? goal.x : goal.x - Math.sign(wGoal) * lead;
  const adx = approachX - p.x;

  // The test for "drop in now" is not "am I at the approach point" — that point
  // is a gate, not a destination, and treating it as one is a trap: you arrive,
  // descend, and the wind you came for immediately carries you past it, so the
  // planner turns you round to go back. The ace shuttled between x=345 and
  // x=519 for a hundred and sixty seconds doing exactly that.
  //
  // The real test is whether the wind AT THE CARGO'S ALTITUDE points at the
  // cargo. If it does, go down and let it bring you together. If it does not,
  // you are downwind: stay up, cross over the top of it, and ask again.
  const carried = (goal.x - p.x) * wGoal > 0;

  let ty;
  if ((carried && Math.abs(dx) < 440) || (still && Math.abs(dx) < 130)) {
    ty = goal.y;
  } else {
    const dir = Math.sign(adx) || 1;
    // Score candidate ALTITUDES, never bands.
    //
    // The first version of this picked a band by the wind at its centre and then
    // flew somewhere else — a blend of that centre with the goal's altitude, to
    // save a second climb later. Between an easterly and a westerly that blend
    // lands on the shear line, where the two cancel and the wind is zero: the
    // ace parked at x=110 for a hundred and thirty seconds and reported the
    // flight as too hard. Station-keeping on a null is a real tactic and the sky
    // should allow it — but a pilot has to choose it, not arrive at it.
    const cands = [goal.y];
    for (let i = 0; i < BANDS; i++) cands.push(Sky.bandY(i, 0.5));
    let best = null;
    for (const y of cands) {
      const w = Sky.windAt(winds, y);
      const approach = w * dir;                        // px/s toward the goal
      // The roof is fast and drinks gas. Weighing it down here is the whole
      // reason a bot does not simply live up there.
      const thin = Sky.bandAt(y) >= THIN_BAND ? (G.fuel > G.fuelMax * 0.5 ? 0.5 : 0.18) : 1;
      const stalled = Math.abs(w) < 9 ? 26 : 0;        // going nowhere is not an option
      const score = approach * thin - stalled
        - Math.abs(y - p.y) * 0.09 - Math.abs(y - goal.y) * 0.05;
      if (!best || score > best.score) best = { score, y };
    }
    ty = best.y;
  }

  /* ---- 4. is anything already flying there? ---- */
  return { ty: dodge(G, ty, o, Math.sign(adx) || Math.sign(dx) || 1), goal };
}

// Shift a target altitude out of any bird's patrol. Conservative on purpose: a
// bird blocks its whole vertical sweep for the whole time it is nearby, which
// is a claim that does not depend on getting the timing right.
//
// Which WAY it dodges matters as much as that it dodges. The first version
// stepped to the nearer edge of the bird, which on a crane patrolling the
// easterly meant dropping — onto the shear line below it, where an easterly of
// +40 meets a westerly of -18 and the two cancel. The ace sank onto that null
// and sat on it for a hundred seconds, burning gas to hold an altitude that was
// taking it nowhere. So weigh the free lanes by the wind in them: an altitude
// you cannot travel in is not an escape.
// How much trouble is an altitude, over the next few seconds?
//
// SOLVED, not sampled as a wall. A bird's position is a pure function of the
// clock, and the balloon's is a pure function of the wind at the altitude being
// considered, so "will these two meet" is arithmetic. Treating a bird's whole
// patrol as blocked instead — which is right for the level linter, whose job is
// to promise a lane exists for all time — makes a bot refuse the band its cargo
// is in: Gullrock hangs two cranes along the easterly the first leg lives in,
// and the ace answered by never entering that band at all, collecting 1 of 13
// and reporting the flight as unwinnable. The content was asking it to time a
// bird. It could not even see one move.
function birdRisk(G, ty, horizon) {
  const p = G.pos;
  const w = Sky.windAt(G.flight.windsAt(p.x), ty);
  let risk = 0;
  for (let t = 0.25; t <= horizon; t += 0.25) {
    const x = p.x + w * t;
    for (const b of G.birds) {
      if (x < b.x - 120 || x > b.x + b.span + 120) continue;
      const bp = birdPos(b, G.T + t);
      const rr = bp.r + BALLOON.R + 5;
      if (Math.abs(bp.x - x) < rr && Math.abs(bp.y - ty) < rr) { risk++; break; }
    }
  }
  return risk;
}

function dodge(G, ty, o, dir, landing) {
  const p = G.pos;
  const roof = BALLOON.R + 4;
  // The ground AHEAD, not the ground below: a pilot can see the ridge coming,
  // and over rising terrain "stay above where I am" flies straight into it.
  let ground = G.groundHere();
  const ahead = p.vx * 3.5;
  for (let s = 0.15; s <= 1; s += 0.15) ground = Math.min(ground, G.groundHere(p.x + ahead * s));
  // Clearance has to cover the basket PLUS how far a control that lags by
  // design sails past its target. At 8px the careful pilot aimed two pixels
  // above a ridge, overshot, and dragged itself down with 75 gas in the tank.
  // ...except when you are deliberately putting it down, which is the one time
  // the ground is the target rather than the hazard.
  const floor = ground - BALLOON.R - BALLOON.BASKET - (landing ? -6 : 30);
  const clamp = (v) => Math.max(roof, Math.min(v, floor));
  ty = clamp(ty);
  if (!o.dodge) return ty;
  if (!birdRisk(G, ty, o.horizon || 5)) return ty;

  // Step outward from where you wanted to be. Dodging into dead air is not a
  // dodge — you stop, and the sun keeps going — so an altitude with no usable
  // wind is charged for as heavily as a near miss.
  const winds = G.flight.windsAt(p.x);
  let best = null;
  for (let off = 0; off <= LH; off += 13) {
    for (const cand of off === 0 ? [ty] : [ty - off, ty + off]) {
      const y = clamp(cand);
      if (y !== cand && off) continue;
      const w = Sky.windAt(winds, y);
      const stalled = dir && Math.abs(w) < 11 ? 3 : 0;
      const backwards = dir && w * dir < 0 ? 1.5 : 0;
      const score = birdRisk(G, y, o.horizon || 5) + stalled + backwards + off / 90;
      if (!best || score < best.score) best = { score, y };
      if (best.score === 0) return best.y;
    }
  }
  return best ? best.y : ty;
}

// Fly to the target.
//
// Steering on ALTITUDE oscillates, because the burner does not move the balloon
// — it moves the balloon's acceleration, one lag later. Steering on vertical
// SPEED oscillates too, and worse: by the time the speed is right the envelope
// is carrying a surplus that keeps pushing for another second, so the balloon
// sails past, gets vented, sinks, and is burned at again. The first version of
// this bot held the burner for 52% of every flight and climbed ten bands' worth
// to end up where it started.
//
// A real pilot anticipates. Ask what HEAT holds the speed you want — the
// engine's own relation, inverted — and pulse the burner toward that. The duty
// cycle then falls out of the physics instead of out of a feedback loop.
function makeBot(o) {
  const rnd = mulberry32(o.seed || 1);
  const st = { goal: null, since: 0, given: new Set() };
  let ty = LH / 2, since = 1e9, fumble = 0;
  return function act(G, dt) {
    if (o.idle) { G.input.burn = false; G.input.vent = false; return; }
    if (o.roof) {
      // One idea, held stubbornly: get to the top and stay there.
      const f = G.flight;
      const land = !f.endless && f.len - G.pos.x < 420;
      ty = land ? G.groundHere(f.len) - BALLOON.R - BALLOON.BASKET - 4 : Sky.bandY(BANDS - 1, 0.5);
    } else {
      since += dt;
      if (since >= o.think) {
        since = 0;
        ty = chooseTarget(G, o, rnd, st).ty;
        if (o.aimErr) ty += (rnd() * 2 - 1) * o.aimErr;
        if (o.fumble && rnd() < o.fumble) fumble = 0.35;   // a wrong-way pull
      }
    }
    if (fumble > 0) { fumble -= dt; G.input.burn = !G.input.burn; G.input.vent = false; return; }

    const p = G.pos;
    const wantVy = Math.max(-96, Math.min(82, (ty - p.y) * 1.5));
    const air = Sky.airVy(G.flight.cols, p.x, p.y);
    // Invert the engine: target = -(heat - neutral) * RISE / mass + air.
    const wantHeat = Math.max(0, Math.min(BALLOON.HEAT_MAX,
      G.neutral() - (wantVy - air) * G.mass / BALLOON.RISE));
    const dead = o.dead || 6;
    // Gas discipline: with the tank nearly dry, only burn to avoid the ground.
    const desperate = G.fuel < 8 && p.y < G.groundHere() - 140;
    G.input.burn = G.heat < wantHeat - dead && !desperate;
    // Venting is free but wasteful — it throws away gas already paid for — so
    // the pilot lets the envelope cool on its own unless it is really too hot.
    G.input.vent = G.heat > wantHeat + dead * 2.6;
  };
}

const BOTS = {
  // A better pilot can afford to reach further, because it actually gets there.
  // The deadband is 6, not 4: holding an altitude to within four units of heat
  // is not precision, it is cycling the burner, and in the Long Drift — where
  // gas is the only clock — the tighter bot flew markedly SHORTER than the
  // sloppy one. Over-controlling a balloon costs you the sky.
  ace:   { think: 0.3, reserve: 1.6, chase: 0.62, dodge: true, dead: 6, horizon: 3.2 },
  pilot: { think: 0.42, reserve: 1.9, chase: 0.5, dodge: true, dead: 7, horizon: 2.6, aimErr: 16, skip: 0.07, fumble: 0.035 },
  // The pilot who is trying to FINISH rather than to collect: banks the win,
  // leaves more daylight in hand, and does not go back for a balloon it has
  // passed. The "never stuck" guarantee is a claim about this player, not about
  // one chasing a third star.
  careful: { think: 0.42, reserve: 2.2, chase: 0.46, forward: true, dodge: true, dead: 7, horizon: 2.6,
             aimErr: 16, skip: 0.07, fumble: 0.035 },
  roof:  { roof: true, dead: 6 },
  drift: { idle: true },
};

module.exports = { makeBot, chooseTarget, BOTS, mulberry32 };
