// The birds. The only things in this sky that ignore the wind, which is exactly
// why they are the hazard: everything else can be solved by picking the right
// band, and a bird has to be *timed*.
//
// A bird's position is a pure function of the level clock and nothing else — no
// integration, no state, no random — so a replayed flight meets the same birds
// in the same places, the linter can sweep a whole patrol, and the bots can
// solve for where a bird will be rather than sampling for it.

const BIRD_KINDS = {
  // Back and forth along its span, dead level. Read it once and you own it.
  gull: { icon: "🕊️", r: 11, body: "#f2f5fb", wing: "#c3ccdd", speed: 46, sweep: 0 },
  // Patrols a span AND rides up and down through a band and a half, so it
  // guards a shear line rather than an altitude. The answer to a hawk is
  // usually to change band entirely, not to squeeze past.
  hawk: { icon: "🦅", r: 13, body: "#8b6b4a", wing: "#5d452c", speed: 34, sweep: 1.05 },
  // One way, fast, wrapping — a conveyor rather than a pendulum. You cannot
  // wait for it to come back to you; you wait for the gap.
  crane: { icon: "🦢", r: 12, body: "#e8e2f2", wing: "#a99ec4", speed: 82, sweep: 0.25, loop: true },
};

// Authored as [x, span, band, t, kind, phase] — a start, how far it ranges, and
// where in the stack it lives. Same band/fraction language as the pickups.
//
// A bird FITS ITSELF to the air it patrols. Its authored altitude is a
// preference: the constructed bird shrinks its vertical sweep and then slides
// its centre until the whole patrol sits between the roof of the sky and the
// highest ground anywhere along its span. So the authored sweep is a MAXIMUM,
// and no bird can be authored flying through a hill — which is the same rule the
// pickups follow, for the same reason.
const BIRD_MARGIN = 16;         // air between the lowest wingtip and the ground
// The narrowest slice of sky a balloon can be asked to hold. Its own height,
// the basket under it, and room for a vertical control that lags by design —
// squeezing through a gap you can only hit by being lucky is not a skill test.
const MIN_LANE = 68;
const LANE_STEP = 12;           // how finely a bird hunts for somewhere to sit

// Free vertical lanes at one x, given the terrain and the birds already placed.
// Everything is inflated by the balloon's own radius, so a "lane" is room for
// the balloon's CENTRE — which is the same thing the linter measures, and the
// two disagreeing by a balloon-width is exactly how a sealed sky ships.
function lanesAt(cor, placed, x) {
  let acc = [[ROOF_CLEAR, Sky.groundAt(cor, x) - BIRD_MARGIN - BASKET_H]];
  for (const p of placed) {
    if (x < p.x - p.spec.r || x > p.x + p.span + p.spec.r) continue;
    const lo = p.cy - p.half - p.spec.r - BALLOON_R, hi = p.cy + p.half + p.spec.r + BALLOON_R;
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

// Would a bird sitting at `cy` still leave somewhere to fly, everywhere along
// its patrol?
function leavesALane(cor, placed, b, cy) {
  const lo = cy - b.half - b.spec.r - BALLOON_R, hi = cy + b.half + b.spec.r + BALLOON_R;
  for (let x = b.x - b.spec.r; x <= b.x + b.span + b.spec.r; x += 24) {
    let best = 0;
    for (const [a, z] of lanesAt(cor, placed, x)) {
      if (hi <= a || lo >= z) { best = Math.max(best, z - a); continue; }
      if (lo > a) best = Math.max(best, lo - a);
      if (hi < z) best = Math.max(best, z - hi);
    }
    if (best < MIN_LANE) return false;
  }
  return true;
}

function makeBirds(raw, cor) {
  const placed = [];
  for (const [x, span, band, t = 0.5, kind = "gull", phase = 0] of raw) {
    const spec = BIRD_KINDS[kind];
    // The tightest the air gets anywhere this bird can reach.
    let floor = Infinity;
    for (let px = x - spec.r; px <= x + span + spec.r; px += 24) {
      floor = Math.min(floor, Sky.groundAt(cor, px));
    }
    floor -= BIRD_MARGIN + spec.r;
    const roof = ROOF_CLEAR + spec.r;
    const want = Sky.bandY(band, t);

    const b = { x, span, band, t, kind, phase, spec, want, half: 0, cy: want, lift: 0 };
    const authoredHalf = spec.sweep ? spec.sweep * BAND_H * 0.5 : 4;

    // Try to sit where the author asked, then hunt outward in even steps, then
    // give up sweep and hunt again. Sweep yields before position does, because
    // "which shear line does this hawk guard" is the level design and "how far
    // does it range vertically" is only the flavour of it.
    let done = false;
    for (const shrink of [1, 0.7, 0.45, 0.2, 0]) {
      b.half = Math.min(authoredHalf * shrink, Math.max(0, (floor - roof) / 2));
      const lo = roof + b.half, hi = floor - b.half;
      if (hi < lo) continue;
      for (let off = 0; off <= floor - roof; off += LANE_STEP) {
        for (const cy of off === 0 ? [want] : [want - off, want + off]) {
          const c = Math.max(lo, Math.min(hi, cy));
          if (!leavesALane(cor, placed, b, c)) continue;
          b.cy = c; done = true; break;
        }
        if (done) break;
      }
      if (done) break;
    }
    // Nowhere at all: leave it where it was authored. That is a genuinely
    // over-stuffed level, and tests/flights.test.js is where it should surface.
    if (!done) { b.half = Math.min(authoredHalf, Math.max(0, (floor - roof) / 2)); b.cy = Math.max(roof + b.half, Math.min(want, floor - b.half)); }
    b.lift = want - b.cy;
    placed.push(b);
  }
  return placed;
}

// Where a bird is at level time T — a pure function of the clock and nothing
// else, so a replayed flight meets the same birds and the bots can SOLVE for
// where one will be rather than sampling for it.
function birdPos(b, T) {
  const s = b.spec;
  const d = T * s.speed + b.phase * b.span;
  let u;
  if (s.loop) {
    u = ((d % b.span) + b.span) % b.span / b.span;
  } else {
    const cycle = ((d % (2 * b.span)) + 2 * b.span) % (2 * b.span);
    u = cycle <= b.span ? cycle / b.span : 2 - cycle / b.span;
  }
  const bob = s.sweep
    ? Math.sin(T * 0.9 + b.phase * TAU) * b.half
    : Math.sin(T * 1.7 + b.phase * TAU) * b.half;
  return { x: b.x + u * b.span, y: b.cy + bob, r: s.r };
}

// The vertical band a bird can EVER occupy — [top, bottom] in absolute y. Used
// by the linter (is there still a lane past this patrol?) and by the bots.
function birdSpan(b) {
  return [b.cy - b.half - b.spec.r, b.cy + b.half + b.spec.r];
}
