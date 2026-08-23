// The Updraft engine.
//
// You fly a hot-air balloon. Your ONLY control is heat: burn to rise, vent to
// sink. Where you go sideways is decided entirely by which wind band you are
// sitting in, so the whole game is reading the stack and committing to a layer.
//
// This file is simulation ONLY — no canvas, no DOM, no audio, no Math.random.
// Everything in the world is either a pure function of position (the wind, the
// ground, the thermals) or a pure function of the level clock (the birds), so
// the headless bots in tests/ drive the real engine with none of the above and
// a replayed flight is the same flight every time. Drawing, input and the frame
// loop live in render.js.

/* ------------------------------------------------------------- physics -- */
// Heat is the state; vertical speed is what heat does to you, one lag behind.
// That lag is the whole feel of the thing: you commit to a climb three seconds
// before you get one, which is what makes reading the sky ahead worth doing.
const BALLOON = {
  R: BALLOON_R,         // envelope radius (also the catch origin) — sky.js owns
  BASKET: BASKET_H,     // it, because the content placers need it before this file loads
  SHELL_MASS: 1.0,
  SAND_MASS: 0.11,      // per sandbag
  NEUTRAL: 100,         // heat per unit of mass needed to hold altitude
  HEAT_MAX: 250,
  BURN: 74,             // heat/s the burner puts in
  VENT: 96,             // heat/s the vent dumps
  COOL_K: 0.12,         // the envelope always loses heat, proportionally
  AMBIENT: 0.6,         // ...but only down to this fraction of neutral, so an
                        // unattended balloon sinks gently rather than dropping
  RISE: 0.8,            // px/s of vy per unit of surplus heat, per unit mass
  VY_DAMP: 2.4,         // the lag
  VX_DAMP: 3.2,         // how fast you take up a new band's wind — crossing a
                        // shear line is a moment, not a switch
  V_SINK: 56,           // terminal sink at shell mass...
  V_SINK_EXP: 1.6,      // ...growing with mass. THE reason ballast is two-edged:
                        // drop sand and you climb far better and dive far worse.
  V_RISE_MAX: 120,
  SAND_KICK: 38,        // the jolt of shedding a bag, on top of the mass change
};

const RULES = {
  FUEL: 132,
  BURN_FUEL: 2.25,      // gas per second of burner
  // The catch is an ELLIPSE, wide and shallow, and that asymmetry is the whole
  // ergonomics of the game.
  //
  // You steer one axis, through a three-second lag, and the other is decided by
  // the wind. A round catch therefore asks you to arrange a coincidence you
  // half-control: at a 40px/s band a 28px circle is a 1.4-second window you have
  // to hit by choosing an altitude four seconds earlier. The bots reported the
  // whole campaign as unflyable and they were right to.
  //
  // So be generous along x, where the pilot has no say, and tight along y, where
  // the pilot has all of it. Vertically this is still barely a third of a band —
  // picking the right altitude remains the skill, which is what the game is.
  CATCH_X: 34,
  CATCH_Y: 17,
  // Half the cargo, not more. The quota sets how long the WINNING route is —
  // the one a pilot who is behind on daylight actually flies — and at 0.6 the
  // late flights needed four minutes of sun to be winnable at all.
  QUOTA: 0.5,

  TEAR_COOL: 0.24,      // each tear ADDS this much to the cooling rate — the
                        // penalty compounds, so a bad flight gets worse
  TEAR_HEAT: 34,
  IFRAMES: 1.5,
  // A scrape costs HEAT, which costs gas to put back. Charging gas directly on
  // top of that made the penalty compound against itself: low on gas you sink,
  // sinking you scrape, scraping takes gas, and there is no way out of the
  // spiral. An ordinary pilot lost 56 gas to eight scrapes in twenty seconds
  // and the flight was over. Bounce firmly and charge once.
  SCRAPE_HEAT: 30,
  SCRAPE_FUEL: 3,
  SCRAPE_BOUNCE: -46,
  SCRAPE_IFRAMES: 1.3,
  // Touches allowed before the basket is simply down. Three, so clipping a
  // ridge is a mistake and bumping along one is a landing.
  MAX_DRAGS: 3,
  DRAG_CLEAR: 70,       // altitude that proves you got away with it

  // Half-width of the landing field. It has to be measured in SECONDS, not
  // pixels: the wind decides how long you are over it, and after the sky was
  // sped up a 78px field was a one-second window you had to hit by starting a
  // four-second descent. A landing field is a big meadow; make it one.
  FIELD_W: 240,
  LAND_SLOP: 10,

  // Gas and daylight left over are worth SOMETHING, never much. At 4 and 6 the
  // bonuses for finishing early outweighed the entire cargo hold, and the bot
  // that banked the quota and ran for the field outscored the one that emptied
  // the sky by forty per cent — a score that pays you to stop playing.
  SCORE_FUEL: 2,
  SCORE_TIME: 3,
  SCORE_CLEAN: 600,
  SCORE_LAND: 300,
  RIBBON_STAR: 30,
  PX_PER_M: 16,
  DRIFT_SCORE_M: 4,
};

const Game = {
  running: false, paused: false, mode: "flight",
  speed: 1,                       // 1x or 2x — a wall-clock convenience only
  input: { burn: false, vent: false },
  on: {},                         // { end, catch, tear, scrape, sand, gas, land }

  emit(name, a, b) { const f = this.on[name]; if (f) f(a, b); },

  /* ============================== lifecycle ============================== */
  startFlight(profile, idx) {
    this.profile = profile;
    this.progress = profile && typeof Storage !== "undefined"
      ? Storage.getProgress(profile.id) : { upgrades: {} };
    this.reset("flight", FLIGHTS[idx], idx);
  },

  startDrift(profile, seedStr) {
    this.profile = profile;
    this.progress = profile && typeof Storage !== "undefined"
      ? Storage.getProgress(profile.id) : { upgrades: {} };
    this.reset("drift", Drift.create(seedStr), -1);
  },

  // Deliberately free of profile, canvas and DOM: a bot drives a whole campaign
  // with none of them.
  reset(mode, flight, idx) {
    const up = (this.progress && this.progress.upgrades) || {};
    this.mode = mode;
    this.flight = flight;
    this.flightIdx = idx;

    this.burnRate = BALLOON.BURN * upgradeValue(up, "burner", 1);
    this.ventRate = BALLOON.VENT * upgradeValue(up, "vent", 1);
    this.fuelRate = RULES.BURN_FUEL * upgradeValue(up, "regulator", 1);
    const net = upgradeValue(up, "net", 0);
    this.catchX = BALLOON.R + RULES.CATCH_X + net;
    this.catchY = BALLOON.R + RULES.CATCH_Y + net;
    this.tearCost = RULES.TEAR_COOL * upgradeValue(up, "silk", 1);
    this.fuelMax = RULES.FUEL + upgradeValue(up, "tank", 0);
    this.sand = flight.sand + upgradeValue(up, "sand", 0);
    this.sandMax = this.sand;

    this.pickups = flight.pickups;
    this.birds = flight.birds;
    for (const p of this.pickups) p.got = false;
    this.total = this.pickups.filter((p) => isCargo(p.kind)).length;
    this.quota = flight.endless ? 0 : Math.ceil(flight.cargo * RULES.QUOTA);

    this.T = 0;
    this.timeLeft = flight.endless ? Infinity : flight.dusk;
    this.fuel = this.fuelMax;
    this.mass = BALLOON.SHELL_MASS + this.sand * BALLOON.SAND_MASS;

    const startX = 90;
    this.pos = { x: startX, y: Sky.bandY(2, 0.5), vx: 0, vy: 0 };
    this.heat = this.neutral();
    this.maxX = startX;

    this.cargo = 0;
    this.points = 0;
    this.ribbons = 0;
    this.tears = 0;
    this.scrapes = 0;
    this.gasTaken = 0;
    this.drags = 0;
    this.iframes = 0;
    this.hintT = 6;
    this.result = null;
    this.running = true;
    this.paused = false;
    this.input.burn = false;
    this.input.vent = false;
  },

  /* ============================== the balloon ============================ */
  neutral() { return this.mass * BALLOON.NEUTRAL; },

  // How fast this balloon can be made to fall. Grows with mass, which is what
  // makes dropping a sandbag a decision rather than a free win.
  sinkCap() {
    return BALLOON.V_SINK * Math.pow(this.mass / BALLOON.SHELL_MASS, BALLOON.V_SINK_EXP);
  },

  inThinAir() { return Sky.bandAt(this.pos.y) >= THIN_BAND; },

  windHere() { return Sky.windAt(this.flight.windsAt(this.pos.x), this.pos.y); },

  groundHere(x = this.pos.x) { return Sky.groundAt(this.flight.cor, x); },

  // The one place that decides whether you are over the field. The renderer,
  // the landing check and the bots all ask it, so they cannot disagree.
  overField(x = this.pos.x) {
    return !this.flight.endless && Math.abs(x - this.flight.len) <= RULES.FIELD_W;
  },

  dropSand() {
    if (!this.running || this.paused || this.sand <= 0) return false;
    this.sand--;
    this.mass = BALLOON.SHELL_MASS + this.sand * BALLOON.SAND_MASS;
    this.pos.vy -= BALLOON.SAND_KICK;
    this.emit("sand", this.sand);
    return true;
  },

  /* ================================ update =============================== */
  // Sub-stepped so that a 2x speed toggle, a long frame or a bot feeding a
  // whole second all integrate identically. The engine is only ever advanced in
  // 1/60 slices.
  update(dt) {
    if (!this.running || this.paused) return;
    let left = Math.min(dt, 0.25);
    while (left > 1e-6 && this.running && !this.paused) {
      const s = Math.min(left, 1 / 60);
      this.step(s);
      left -= s;
    }
  },

  step(dt) {
    this.T += dt;
    if (this.hintT > 0) this.hintT -= dt;
    if (this.iframes > 0) this.iframes -= dt;

    // Losing is checked before anything else can turn into a win: dusk and a
    // landing can both fall inside one step, and the wrong order ships a clear
    // nobody earned.
    if (!this.flight.endless) {
      this.timeLeft -= dt;
      if (this.timeLeft <= 0) { this.timeLeft = 0; return this.finish(false, "dark"); }
    }

    // The Long Drift ends when the gas does. Letting it play out to a landing
    // reads better on paper and does not survive contact with a thermal: a
    // balloon pinned against the western edge inside a column of rising air
    // simply never comes down, and the best bot sat there for five minutes with
    // an empty tank and a finished score.
    if (this.flight.endless && this.fuel <= 0) return this.finish(false, "dry");
    this.fly(dt);
    this.catchThings();
    this.meetBirds();
    this.meetGround();

    if (this.flight.endless && this.running) {
      Drift.ensure(this.flight, this.pos.x + LW * 3);
      Drift.prune(this.flight, this.pos.x - LW * 2);
    }
  },

  fly(dt) {
    const p = this.pos;
    const thin = this.inThinAir();

    // Heat in, heat out. The vent is free; the burner is the whole economy.
    if (this.input.burn && this.fuel > 0) {
      this.heat += this.burnRate * dt;
      this.fuel -= this.fuelRate * (thin ? THIN_FUEL : 1) * dt;
      if (this.fuel < 0) this.fuel = 0;
    }
    if (this.input.vent) this.heat -= this.ventRate * dt;

    // Cooling toward ambient rather than toward zero, so a balloon nobody is
    // flying sinks gently instead of falling. Tears raise the rate, and they
    // stack — the punishment for a bird compounds rather than washing out.
    const cool = BALLOON.COOL_K * (thin ? THIN_COOL : 1) * (1 + this.tears * this.tearCost);
    const amb = this.neutral() * BALLOON.AMBIENT;
    this.heat += (amb - this.heat) * Math.min(1, cool * dt);
    if (this.heat < 0) this.heat = 0;
    if (this.heat > BALLOON.HEAT_MAX) this.heat = BALLOON.HEAT_MAX;

    // Surplus heat lifts; the air the balloon is sitting in does the rest.
    let target = -(this.heat - this.neutral()) * BALLOON.RISE / this.mass;
    target += Sky.airVy(this.flight.cols, p.x, p.y);
    const cap = this.sinkCap();
    if (target > cap) target = cap;
    if (target < -BALLOON.V_RISE_MAX) target = -BALLOON.V_RISE_MAX;
    p.vy += (target - p.vy) * Math.min(1, BALLOON.VY_DAMP * dt);

    // Sideways is not steering — it is whatever band you are in, taken up over
    // a moment rather than instantly.
    const wind = this.windHere();
    p.vx += (wind - p.vx) * Math.min(1, BALLOON.VX_DAMP * dt);

    p.x += p.vx * dt;
    p.y += p.vy * dt;

    // The roof of the sky. Bumping it costs nothing but the climb you wasted.
    if (p.y < BALLOON.R) { p.y = BALLOON.R; if (p.vy < 0) p.vy = 0; }

    const westEdge = this.flight.endless ? this.maxX - LW * 1.6 : -40;
    if (p.x < westEdge) { p.x = westEdge; if (p.vx < 0) p.vx = 0; }
    if (!this.flight.endless) {
      const eastEdge = this.flight.len + 340;
      if (p.x > eastEdge) { p.x = eastEdge; if (p.vx > 0) p.vx = 0; }
    }
    if (p.x > this.maxX) this.maxX = p.x;
  },

  /* ============================== collisions ============================= */
  catchThings() {
    const p = this.pos;
    for (const item of this.pickups) {
      if (item.got) continue;
      const dx = (item.x - p.x) / this.catchX;
      if (dx < -1 || dx > 1) continue;
      const dy = (item.y - p.y) / this.catchY;
      if (dx * dx + dy * dy > 1) continue;
      item.got = true;
      const spec = PICKUPS[item.kind];
      this.points += spec.score;
      this.ribbons += spec.ribbons;
      if (spec.fuel) {
        this.fuel = Math.min(this.fuelMax, this.fuel + spec.fuel);
        this.gasTaken++;
        this.emit("gas", item);
      } else {
        this.cargo += spec.counts;
        this.emit("catch", item);
      }
    }
  },

  meetBirds() {
    if (this.iframes > 0) return;
    const p = this.pos;
    for (const b of this.birds) {
      const bp = birdPos(b, this.T);
      const dx = bp.x - p.x, dy = bp.y - p.y;
      const rr = bp.r + BALLOON.R;
      if (dx * dx + dy * dy > rr * rr) continue;
      this.tears++;
      this.heat = Math.max(0, this.heat - RULES.TEAR_HEAT);
      this.iframes = RULES.IFRAMES;
      this.emit("tear", bp);
      return;
    }
  },

  meetGround() {
    const p = this.pos;
    const g = this.groundHere();
    const belly = p.y + BALLOON.R + BALLOON.BASKET;

    if (this.overField() && belly >= this.groundHere(this.flight.len) - RULES.LAND_SLOP) {
      return this.finish(this.cargo >= this.quota, "landed");
    }
    // Climbing properly clear forgives the touches: a pilot who saves it has
    // saved it, however close the ridge was.
    if (belly <= g - RULES.DRAG_CLEAR) this.drags = 0;
    if (belly <= g) return;

    // What ends a flight on the deck is DRAGGING, not one bad touch.
    //
    // The distinction cannot be made from the balloon's state: a pilot who is
    // deliberately coming down is cold and sinking, and so is a balloon nobody
    // is flying. What separates them is what happens next — a pilot climbs back
    // clear, and an abandoned balloon bumps along the hilltops. So count the
    // touches and forgive them the moment real altitude is regained.
    //
    // Both failures this rule has already caught: with the gas cost of a scrape
    // removed, an untouched balloon skipped along a ridge line and was carried
    // into the landing field — the do-nothing bot cleared a flight by being left
    // alone. Ending it on a cold envelope instead grounded the good pilots too,
    // because a controlled descent is cold by definition.
    p.y = g - BALLOON.R - BALLOON.BASKET;
    if (this.iframes <= 0) {
      this.drags++;
      if (this.drags >= RULES.MAX_DRAGS) { p.vy = 0; return this.finish(false, "grounded"); }
    }
    if (this.iframes <= 0) {
      this.scrapes++;
      this.fuel = Math.max(0, this.fuel - RULES.SCRAPE_FUEL);
      this.heat = Math.max(0, this.heat - RULES.SCRAPE_HEAT);
      this.iframes = RULES.SCRAPE_IFRAMES;
      this.emit("scrape", { x: p.x, y: g });
    }
    if (p.vy > 0) p.vy = RULES.SCRAPE_BOUNCE;
  },

  /* ================================ ending =============================== */
  metres() { return Math.max(0, Math.round(this.maxX / RULES.PX_PER_M)); },

  buildResult(win, reason) {
    const clean = this.scrapes === 0 && this.tears === 0;
    const all = this.total > 0 && this.cargo >= this.total;
    const stars = !win ? 0 : clean && all ? 3 : all ? 2 : 1;
    let score = this.points;
    if (this.mode === "drift") {
      score += this.metres() * RULES.DRIFT_SCORE_M;
    } else if (win) {
      score += Math.round(this.fuel) * RULES.SCORE_FUEL
             + Math.round(this.timeLeft) * RULES.SCORE_TIME
             + RULES.SCORE_LAND + (clean ? RULES.SCORE_CLEAN : 0);
    }
    return {
      mode: this.mode, flightIdx: this.flightIdx,
      win, reason, stars, score,
      cargo: this.cargo, total: this.total, quota: this.quota,
      fuel: Math.round(this.fuel), timeLeft: Math.round(Math.max(0, this.timeLeft)),
      scrapes: this.scrapes, tears: this.tears, clean,
      sandUsed: this.sandMax - this.sand, gasTaken: this.gasTaken,
      metres: this.metres(),
      ribbons: this.ribbons + (win ? stars * RULES.RIBBON_STAR : 0),
    };
  },

  finish(win, reason) {
    if (!this.running) return;
    this.running = false;
    this.result = this.buildResult(win, reason);
    this.emit("end", this.result);
  },

  abandon() {
    if (!this.running) return;
    this.running = false;
    this.result = this.buildResult(false, "quit");
  },
};

if (typeof window === "undefined") Object.assign(globalThis, { BALLOON, RULES, Game });
