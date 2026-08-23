// The Long Drift — one seeded sky that never ends, and the family leaderboard.
//
// There is no sunset out here. GAS is the clock: canisters thin out
// geometrically with distance and there is no floor under that curve, so even a
// faultless pilot eventually runs dry and settles. tests/bot.test.js asserts
// exactly that against the best bot, because an endless mode bounded only by
// mistakes never ends for someone who does not make any.
//
// The rule the generator must never break, because it is what stops the drift
// becoming a place to park: SOME band always blows east, at every x.
//
// "Every x" is the hard part, and the first version got it wrong in a way that
// only a bot found. Each segment's six-band table was generated with the
// guarantee baked in — but the sky the balloon actually flies is a BLEND of two
// tables, cross-faded over the last stretch of each segment so a front arrives
// gradually. Where a segment and its successor are near mirrors of each other,
// that blend takes every band through zero at once: at x=4881 of the 14th of
// September the whole sky read -6.6, -47.2, -0.1, -55.8, 1.2, -3.4, and the best
// pilot sat in dead air for four hundred seconds waiting for the gas to run out.
//
// So one band is a TRADE WIND, chosen once per seed and eastward in every
// segment. Both ends of every blend are positive there, so it can never cancel —
// and "which level is the trade wind on today" is a thing worth knowing about a
// daily challenge rather than a patch over a bug.

const SEG = 1000;                 // one generated slab of sky, in px
const DRIFT_SHEAR = 240;          // how far a front takes to blow through

const Drift = {
  create(seedStr) {
    const seed = RNG.seedFrom(seedStr);
    const f = {
      endless: true, seedStr, seed,
      name: "The Long Drift", region: 0, sand: 4,
      len: Infinity, dusk: 0,
      terrain: [], cols: [], pickups: [], birds: [],
      cargo: 0,
      built: 0,                   // content segments generated so far
      terrainBuilt: 0,            // ...and ground, which always runs one ahead
      windCache: new Map(),
      cor: null,
      windsAt: (x) => Drift.windsAt(f, x),
      // Clamped at BOTH ends: the drift's western edge sits a screen and a half
      // behind the furthest point reached, so a balloon blown backwards early on
      // is at a negative x and floor() hands back -1.
      regionAt: (x) => REGIONS[Math.max(0, Math.min(REGIONS.length - 1, Math.floor(x / (SEG * 3))))],
    };
    Drift.ensure(f, SEG * 3);
    return f;
  },

  /* ------------------------------- the wind ------------------------------ */
  // One six-band table per segment, cached because it is asked for every frame
  // and by every bot probe.
  // Which level today's trade wind runs on. Seeded from the day alone, so it
  // holds for the whole drift and every blend has it eastward at both ends.
  tradeBand(f) {
    if (f.trade === undefined) f.trade = RNG.sub(f.seed, "trade").int(1, BANDS - 2);
    return f.trade;
  },

  windsOf(f, n) {
    if (f.windCache.has(n)) return f.windCache.get(n);
    const r = RNG.sub(f.seed, "wind", n);
    const d = Math.min(1, n / 12);              // 0 -> 1 across the first twelve
    const trade = Drift.tradeBand(f);
    const w = [];
    for (let i = 0; i < BANDS; i++) {
      const mag = 16 + r.range(0, 24) + i * 4.5 + d * 24;
      const dir = i === trade ? 1 : r.chance(0.44 + d * 0.12) ? -1 : 1;
      w.push(dir * Math.max(i === trade ? 30 + d * 22 : 15, mag));
    }
    f.windCache.set(n, w);
    return w;
  },

  // Blended across the last stretch of each segment, so the sky changes like a
  // front passing rather than switching on a line.
  windsAt(f, x) {
    const n = Math.floor(x / SEG);
    const into = x - n * SEG;
    const a = Drift.windsOf(f, Math.max(0, n));
    if (into < SEG - DRIFT_SHEAR) return a;
    const b = Drift.windsOf(f, Math.max(0, n) + 1);
    const u = (into - (SEG - DRIFT_SHEAR)) / DRIFT_SHEAR;
    const t = u * u * (3 - 2 * u);
    return a.map((v, i) => v + (b[i] - v) * t);
  },

  /* ---------------------------- generation ------------------------------- */
  // Ground for one segment: four stations, climbing as the drift goes on and
  // clamped well clear of the third band so there is always sky to fly in.
  terrainSeg(f, n) {
    const d = Math.min(1, n / 12);
    const x0 = n * SEG;
    const rg = RNG.sub(f.seed, "ground", n);
    for (let i = 0; i < 4; i++) {
      f.terrain.push([x0 + i * (SEG / 4),
        Math.round(Math.max(304, 492 - d * 120 - rg.range(0, 110 + d * 70)))]);
    }
  },

  // Everything that hangs in the air above that ground. Authored as the same
  // [x, band, t, kind] tuples the campaign uses and handed to the same
  // constructors, so one code path decides where a thing actually sits — and
  // generated content fits itself to the hills exactly as authored content does.
  contentSeg(f, n) {
    const d = Math.min(1, n / 12);
    const x0 = n * SEG;

    // Lift in front of the high ground, sink behind it — the shape the
    // campaign's ridges have, so what the pilot learned there transfers.
    const ra = RNG.sub(f.seed, "air", n);
    for (let i = 0; i < 2; i++) {
      const ax = x0 + ra.range(120, SEG - 120);
      f.cols.push({ x: ax, w: 170, v: -(44 + d * 22), top: 170 });
      f.cols.push({ x: ax + 300, w: 150, v: 34 + d * 12, top: 300 });
    }

    const raw = [];
    const rp = RNG.sub(f.seed, "cargo", n);
    const count = 4 + rp.int(0, 2);
    for (let i = 0; i < count; i++) {
      raw.push([x0 + (i + 0.5) * (SEG / count) + rp.range(-60, 60),
                rp.int(1, BANDS - 1), rp.range(0.3, 0.7),
                rp.chance(0.16 + d * 0.1) ? "lantern" : "balloon"]);
    }

    // Gas, thinning geometrically with NO floor under the curve: this is the
    // line that ends a run, so nothing may put a minimum on it.
    const rc = RNG.sub(f.seed, "gas", n);
    const cans = Math.max(0, Math.round(2.7 * Math.pow(0.8, n)));
    for (let i = 0; i < cans; i++) {
      raw.push([x0 + (i + 0.5) * (SEG / Math.max(1, cans)) + rc.range(-80, 80),
                rc.int(1, BANDS - 2), rc.range(0.35, 0.65), "canister"]);
    }
    f.pickups.push(...makePickups(raw, f.cor));

    // Birds, thickening the other way.
    const rb = RNG.sub(f.seed, "birds", n);
    const flocks = 1 + Math.floor(d * 3.4);
    const braw = [];
    for (let i = 0; i < flocks; i++) {
      braw.push([x0 + rb.range(60, SEG - 60), 380 + rb.range(0, 340 + d * 260),
                 rb.int(1, BANDS - 2), 0.5,
                 rb.chance(0.24 + d * 0.34) ? "crane" : rb.chance(0.45) ? "hawk" : "gull",
                 rb()]);
    }
    f.birds.push(...makeBirds(braw, f.cor));
  },

  // Build out to `upTo`. Terrain always runs ONE segment ahead of its contents,
  // so a bird patrolling to the far edge of a segment fits itself against the
  // hill that is really there rather than against a flat end station.
  //
  // Corridor.make snapshots its stations, so a grown terrain array needs a
  // fresh corridor rather than a poke at the old one.
  ensure(f, upTo) {
    const need = Math.ceil(Math.max(upTo, SEG) / SEG);
    let grew = false;
    while (f.terrainBuilt <= need) { Drift.terrainSeg(f, f.terrainBuilt); f.terrainBuilt++; grew = true; }
    if (grew) {
      const t = f.terrain.slice();
      // Hold both ends flat so sampling outside the built range is safe.
      t.unshift([t[0][0] - 400, t[0][1]]);
      t.push([t[t.length - 1][0] + 400, t[t.length - 1][1]]);
      f.cor = Sky.corridor(t);
    }
    while (f.built < need) { Drift.contentSeg(f, f.built); f.built++; }
  },

  // Drop what is far enough behind that the balloon cannot drift back to it,
  // so a long run stays a fixed size. The terrain is left alone: it is cheap,
  // and pruning it would move the corridor under the balloon.
  prune(f, behind) {
    f.pickups = f.pickups.filter((p) => p.x > behind);
    f.cols = f.cols.filter((c) => c.x + c.w > behind);
    f.birds = f.birds.filter((b) => b.x + b.span > behind);
  },
};

if (typeof window === "undefined") Object.assign(globalThis, { SEG, Drift });
