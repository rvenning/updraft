// The sky itself: the wind bands, the ground under them, and the moving air in
// between. Pure functions of position — no state, no DOM, no Math.random — so
// the engine, the renderer and the headless bots all read the same sky.
//
// The whole stack is on screen at once (the camera only ever scrolls in x), so
// every decision the player makes is visible without scrolling or remembering.
// That is the point of the design: choosing an altitude IS the game, and you
// cannot choose between things you cannot see.

const LW = 320;               // logical stage, portrait — the family plays on phones
const LH = 504;
const TAU = Math.PI * 2;

// How much room the balloon takes up. This lives here, with the geometry,
// rather than in game.js — the pickup placer, the bird placer, the linter and
// the engine all have to agree about the size of the thing flying between them,
// and two of those run before game.js is even loaded.
const BALLOON_R = 13;
const BASKET_H = 9;

const BANDS = 6;
const BAND_H = LH / BANDS;    // 84
// Band 0 sits on the deck, band 5 is the roof. Winds are authored bottom-up for
// the same reason a weather report reads bottom-up: you climb through them.
const THIN_BAND = BANDS - 1;  // the roof: fastest air, and the most expensive
const THIN_FUEL = 2.2;        // the burner drinks up here
const THIN_COOL = 1.5;        // ...and the envelope loses heat faster

// Half-width of the shear zone at a band boundary, as a fraction of a band.
// Straddling two bands really does give you the average of both, which is a
// legitimate way to creep along slowly — but it costs the precision of sitting
// squarely inside one, so it is a trade rather than a free lunch.
const SHEAR = 0.14;

const Sky = {
  // Absolute y of a point `t` of the way up band `i` (t=0 the floor of the
  // band, t=1 its ceiling). Authoring by band-and-fraction rather than by pixel
  // is what stops a balloon being placed inside a hill, and it means retuning a
  // band's height moves everything in it.
  bandY(i, t = 0.5) { return LH - (i + t) * BAND_H; },

  // Which band an altitude belongs to.
  bandAt(y) {
    const i = Math.floor((LH - y) / BAND_H);
    return i < 0 ? 0 : i > BANDS - 1 ? BANDS - 1 : i;
  },

  // Signed horizontal wind at an altitude, px/s. Positive blows east (right).
  //
  // Pure inside a band and blended only across the boundary, rather than
  // smoothly interpolated everywhere: a wind that varies continuously with
  // altitude gives the player nothing to aim at, and reading the sky stops
  // being a skill. The blend is continuous at both edges — at a boundary you
  // get exactly the mean of the two bands.
  windAt(winds, y) {
    const f = (LH - y) / BAND_H;
    let i = Math.floor(f);
    if (i < 0) i = 0; else if (i > BANDS - 1) i = BANDS - 1;
    const frac = Math.max(0, Math.min(1, f - i));
    if (frac < SHEAR && i > 0) {
      const u = 0.5 + frac / (2 * SHEAR);
      return winds[i - 1] + (winds[i] - winds[i - 1]) * u;
    }
    if (frac > 1 - SHEAR && i < BANDS - 1) {
      const u = (frac - (1 - SHEAR)) / (2 * SHEAR);
      return winds[i] + (winds[i + 1] - winds[i]) * u;
    }
    return winds[i];
  },

  /* ------------------------------- ground -------------------------------- */
  // Terrain is authored as [x, groundY] waypoints and turned into a
  // GK.Corridor: the flyable air is a passage whose low wall is the sky's roof
  // and whose high wall is the hillside. Smoothstepped, so a ridge is a ridge
  // rather than a row of ramps with kinks in it.
  corridor(terrain) {
    return GK.Corridor.make(terrain.map(([x, g]) => [x, g / 2, g]));
  },

  groundAt(cor, x) { return cor.sample(x).w; },

  // Terrain waypoints -> corridor stations, for the linter.
  stations(terrain) { return terrain.map(([x, g]) => [x, g / 2, g]); },

  /* ------------------------------ moving air ----------------------------- */
  // Thermals and sinks: { x, w, v, top } — v is px/s, negative lifts. The
  // strength tapers with a raised cosine so the edge of a thermal feels like
  // air rather than a doorway, and dies off above `top` for the same reason.
  airVy(cols, x, y) {
    let v = 0;
    for (const c of cols) {
      const dx = Math.abs(x - c.x);
      if (dx > c.w / 2) continue;
      const across = 0.5 + 0.5 * Math.cos((dx / (c.w / 2)) * Math.PI);
      // Fade out over the last 70px before the column's ceiling.
      const above = c.top - y;                  // >0 once you are above the top
      const up = above <= 0 ? 1 : above >= 70 ? 0 : 1 - above / 70;
      v += c.v * across * up;
    }
    return v;
  },
};
