// Drawing, input and the frame loop.
//
// js/game.js is a pure simulation and knows nothing about any of this, which is
// what lets the headless bots run the real engine with no canvas at all. Every
// event that needs a sound or a puff of particles arrives through Game.on,
// wired up here.
//
// The whole band stack is on screen at all times — the camera only ever scrolls
// in x. That is the design, not a shortcut: choosing an altitude IS the game,
// and you cannot choose between things you cannot see. Everything drawn in the
// sky is traced from the same functions the engine samples, so the wind you can
// read is the wind you are actually in.

const STREAK_W = 26;              // wind streaks, logical px
const MINI_H = 13;                // the horizon strip along the top

const Render = {
  canvas: null, ctx: null, DPR: 1, scale: 1,
  viewLW: LW, viewLH: LH, offX: 0, offY: 0,
  active: false, camX: 0, _last: 0, _wasPaused: false,
  hint: 0, flash: 0,

  /* ============================ boot / canvas ============================ */
  boot() {
    this.canvas = document.getElementById("cv");
    this.ctx = this.canvas.getContext("2d");
    this.resize();
    const re = () => this.resize();
    window.addEventListener("resize", re);
    // iOS settles its viewport lazily (toolbars, rotation, standalone launch),
    // so measure again well after the event as well as on it.
    window.addEventListener("orientationchange", () => setTimeout(re, 350));
    if (window.visualViewport) window.visualViewport.addEventListener("resize", re);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden && Game.running && !Game.paused) App.pause();
    });
    this.bindInput();
    this.wireEvents();
    this._last = performance.now();
    requestAnimationFrame((t) => this.loop(t));
  },

  resize() {
    const wrap = this.canvas.parentElement;
    const w = wrap.clientWidth, h = wrap.clientHeight;
    // The game screen is display:none until it is shown, which measures 0x0 —
    // retry rather than caching a broken layout.
    if (w < 50 || h < 50) { setTimeout(() => this.resize(), 200); return; }
    this.DPR = Math.min(window.devicePixelRatio || 1, 2);
    // A canvas is a replaced element: the width/height ATTRIBUTES are the
    // backing store. css/style.css pins the DISPLAY size to 100%/100% so it can
    // never disagree with the stage — setting an inline pixel size here would be
    // a snapshot that goes stale the moment anything reflows.
    this.canvas.width = Math.round(w * this.DPR);
    this.canvas.height = Math.round(h * this.DPR);
    this.scale = Math.min(w / LW, h / LH);
    this.viewLW = w / this.scale;
    this.viewLH = h / this.scale;
    this.offX = (this.viewLW - LW) / 2;
    this.offY = (this.viewLH - LH) / 2;
  },

  /* =============================== input ================================= */
  // Hold the TOP half to burn, the BOTTOM half to vent. No aiming, no gesture
  // to detect, and the mapping is the thing itself: up is up. Both halves are
  // holds rather than taps, so a thumb that lands slightly wrong still works.
  bindInput() {
    const stage = document.querySelector(".game-stage");
    const I = Game.input;
    const pointers = new Map();

    const apply = () => {
      let burn = false, vent = false;
      for (const half of pointers.values()) { if (half < 0) burn = true; else vent = true; }
      I.burn = burn; I.vent = vent;
    };
    const halfAt = (clientY) => {
      const r = stage.getBoundingClientRect();
      return (clientY - r.top) / r.height < 0.5 ? -1 : 1;
    };

    stage.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      Sfx.init();
      // Set the gesture state BEFORE capturing: setPointerCapture throws
      // NotFoundError whenever the browser does not consider the pointer active,
      // and `?.` does not protect you — the throw escapes and takes the rest of
      // this handler with it.
      pointers.set(e.pointerId, halfAt(e.clientY));
      apply();
      try { stage.setPointerCapture?.(e.pointerId); } catch (_) {}
    }, { passive: false });

    // PointerEvent.pressure is ZERO for ordinary touch on iOS, so a
    // `if (e.pressure > 0)` guard silently drops every move. Ask what KIND of
    // pointer it is instead — and let a finger slide between the halves.
    stage.addEventListener("pointermove", (e) => {
      if (!pointers.has(e.pointerId)) return;
      e.preventDefault();
      pointers.set(e.pointerId, halfAt(e.clientY));
      apply();
    }, { passive: false });

    // Some iOS builds are stingy with pointermove during a fast drag, so take
    // the raw touch stream too. Both paths end in the same call, which makes
    // the duplicate harmless.
    stage.addEventListener("touchmove", (e) => {
      if (!pointers.size || !e.touches.length) return;
      e.preventDefault();
      for (const t of e.touches) if (pointers.has(t.identifier)) pointers.set(t.identifier, halfAt(t.clientY));
      apply();
    }, { passive: false });

    const lift = (e) => { pointers.delete(e.pointerId); apply(); };
    stage.addEventListener("pointerup", lift);
    stage.addEventListener("pointercancel", lift);
    stage.addEventListener("pointerleave", lift);
    stage.addEventListener("contextmenu", (e) => e.preventDefault());

    window.addEventListener("keydown", (e) => {
      if (!this.active) return;
      if (e.code === "Escape" || e.code === "KeyP") { e.preventDefault(); App.togglePause(); return; }
      if (e.code === "Space") { e.preventDefault(); App.dropSand(); return; }
      if (e.code === "KeyF") { e.preventDefault(); App.toggleSpeed(); return; }
      if (["ArrowUp", "KeyW"].includes(e.code)) { e.preventDefault(); I.burn = true; }
      if (["ArrowDown", "KeyS"].includes(e.code)) { e.preventDefault(); I.vent = true; }
    });
    window.addEventListener("keyup", (e) => {
      if (["ArrowUp", "KeyW"].includes(e.code)) I.burn = false;
      if (["ArrowDown", "KeyS"].includes(e.code)) I.vent = false;
    });

    // iOS ignores user-scalable=no for pinch; block the gesture at the source.
    document.addEventListener("gesturestart", (e) => e.preventDefault());
    document.addEventListener("gesturechange", (e) => e.preventDefault());

    this.clearInput = () => { pointers.clear(); apply(); };
  },

  // Everything the simulation wants the world to hear about. Wiring it here
  // rather than inside game.js is what keeps the engine free of audio.
  wireEvents() {
    let run = 0, runT = 0;
    Game.on = {
      catch: (item) => {
        run = Game.T - runT < 2.6 ? run + 1 : 1;
        runT = Game.T;
        if (item.kind === "lantern") Sfx.lantern(); else Sfx.gather(run);
        Fx.burst(item.x - this.camX, item.y, item.color, 12, 130, 0.5, 2.6);
        Fx.text(item.x - this.camX, item.y, `+${PICKUPS[item.kind].score}`, { color: item.color });
      },
      gas: (item) => {
        Sfx.gas();
        Fx.burst(item.x - this.camX, item.y, "#cfe3f2", 10, 110, 0.45, 2.2);
        Fx.text(item.x - this.camX, item.y, `+${PICKUPS.canister.fuel} gas`, { color: "#cfe3f2" });
      },
      tear: (bp) => {
        Sfx.tear();
        Fx.addShake(7);
        Fx.addFlash(0.2, "#ff9c9c");
        Fx.burst(bp.x - this.camX, bp.y, "#ffffff", 16, 150, 0.5, 2.4);
        Fx.text(Game.pos.x - this.camX, Game.pos.y - 20, "TORN!", { color: "#ff8f8f" });
      },
      scrape: (p) => {
        Sfx.scrape();
        Fx.addShake(5);
        Fx.dust(p.x - this.camX, p.y, 12, "#c9b38a");
      },
      sand: () => {
        Sfx.sand();
        Fx.dust(Game.pos.x - this.camX, Game.pos.y + 22, 14, "#d8c69a");
        Fx.text(Game.pos.x - this.camX, Game.pos.y - 18, "BALLAST!", { color: "#ffe08a" });
      },
      end: (res) => App.flightOver(res),
    };
  },

  /* ================================ loop ================================= */
  // Driven by rAF in the browser and by hand from the verification harness —
  // which is why it takes a timestamp rather than reading the clock itself.
  //
  // The WHOLE frame is gated on pause, not just the simulation: leaving the rest
  // running means particles keep spawning, the burner keeps roaring and anything
  // keyed on the render clock keeps pulsing behind the pause sheet.
  loop(t) {
    requestAnimationFrame((tt) => this.loop(tt));
    const real = Math.min(0.05, (t - this._last) / 1000 || 0);
    this._last = t;
    if (!this.active) return;

    const paused = Game.paused || !Game.running;
    if (paused !== this._wasPaused) {
      // One edge detector covers the pause button, the keyboard shortcut and
      // quitting at once — and it keeps the audio dependency out of game.js.
      Burner.duck(paused);
      this._wasPaused = paused;
    }

    if (Game.running && !Game.paused) {
      Game.update(real * Game.speed);
      Fx.update(real);
      if (this.hint > 0) this.hint -= real;
      Burner.set(Game.input.burn && Game.fuel > 0);
      this.render(real);
      this.hud();
    } else {
      this.render(0);
    }
  },

  camTarget() {
    // Lead the camera the way the wind is taking you, so the sky you are about
    // to be in is the sky you can see.
    const lead = Math.max(-80, Math.min(80, Game.pos.vx * 0.85));
    return Game.pos.x - LW * 0.42 + lead;
  },

  /* =============================== render ================================ */
  render(dt) {
    const ctx = this.ctx;
    if (!ctx || !Game.flight) return;
    const want = this.camTarget();
    this.camX = dt > 0 ? this.camX + (want - this.camX) * Math.min(1, dt * 5) : want;

    const s = this.scale * this.DPR;
    ctx.setTransform(s, 0, 0, s, 0, 0);
    ctx.translate(this.offX, this.offY);

    const L = -this.offX, T = -this.offY;
    const R = LW + this.offX, B = LH + this.offY;
    const region = Game.flight.regionAt(Game.pos.x);
    const winds = Game.flight.windsAt(Game.pos.x);

    this.drawSky(ctx, region, L, T, R, B);
    this.drawBands(ctx, winds, L, R);
    this.drawGround(ctx, region, L, T, R, B);
    this.drawAir(ctx);
    this.drawField(ctx, region);
    this.drawPickups(ctx, L, R);
    this.drawBirds(ctx, L, R);

    const [shx, shy] = Fx.shakeOffset();
    ctx.save();
    ctx.translate(shx, shy);
    this.drawBalloon(ctx, region);
    ctx.restore();

    Fx.render(ctx);
    if (Fx.flash > 0) {
      ctx.globalAlpha = Math.min(1, Fx.flash);
      ctx.fillStyle = Fx.flashColor;
      ctx.fillRect(L, T, R - L, B - T);
      ctx.globalAlpha = 1;
    }

    this.drawLadder(ctx, winds, L);
    this.drawMini(ctx, L, T, R);
    this.drawHint(ctx, L, R, B);
  },

  /* -------------------------------- sky ---------------------------------- */
  drawSky(ctx, region, L, T, R, B) {
    const g = ctx.createLinearGradient(0, T, 0, LH);
    g.addColorStop(0, region.sky[0]);
    g.addColorStop(1, region.sky[1]);
    ctx.fillStyle = g;
    ctx.fillRect(L, T, R - L, B - T);

    // Above the roof: air too thin to fly in. Painting it rather than cropping
    // there is what tells the pilot the ceiling exists before they meet it.
    if (T < 0) {
      const h = ctx.createLinearGradient(0, T, 0, 0);
      h.addColorStop(0, "rgba(12,16,42,0.85)");
      h.addColorStop(1, "rgba(12,16,42,0)");
      ctx.fillStyle = h;
      ctx.fillRect(L, T, R - L, -T);
      ctx.strokeStyle = "rgba(255,255,255,0.22)";
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 6]);
      ctx.beginPath(); ctx.moveTo(L, 0.5); ctx.lineTo(R, 0.5); ctx.stroke();
      ctx.setLineDash([]);
    }
  },

  // Wind bands, drawn as streaks that move with the air itself. Their screen
  // position is (their own drift) minus (the camera), so a band running the
  // other way visibly streams past — which is the whole instrument.
  drawBands(ctx, winds, L, R) {
    const T = Game.T;
    for (let i = 0; i < BANDS; i++) {
      const top = Sky.bandY(i, 1), h = BAND_H;
      ctx.fillStyle = i % 2 ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.015)";
      ctx.fillRect(L, top, R - L, h);
      if (i === THIN_BAND) {
        ctx.fillStyle = "rgba(180,200,255,0.09)";
        ctx.fillRect(L, top, R - L, h);
      }

      const w = winds[i];
      const speed = Math.abs(w);
      const drift = w * T - this.camX;
      const gap = Math.max(58, 210 - speed * 1.1);
      const rows = 3;
      ctx.strokeStyle = `rgba(255,255,255,${0.1 + Math.min(0.2, speed / 420)})`;
      ctx.lineWidth = 1.4;
      ctx.lineCap = "round";
      for (let r = 0; r < rows; r++) {
        const y = top + h * (r + 0.5) / rows + (i % 2 ? 4 : 0);
        const phase = ((drift + r * gap * 0.37) % gap + gap) % gap;
        for (let x = L - gap + phase; x < R + gap; x += gap) {
          const len = STREAK_W * (0.5 + Math.min(1.4, speed / 70));
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x + (w >= 0 ? len : -len), y);
          ctx.stroke();
        }
      }
    }

    // Boundaries, faintly, so the stack reads as a stack.
    ctx.strokeStyle = "rgba(255,255,255,0.13)";
    ctx.lineWidth = 1;
    for (let i = 1; i < BANDS; i++) {
      const y = Math.round(Sky.bandY(i, 0)) + 0.5;
      ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(R, y); ctx.stroke();
    }
  },

  /* ------------------------------- ground -------------------------------- */
  drawGround(ctx, region, L, T, R, B) {
    const cor = Game.flight.cor, cam = this.camX;
    ctx.beginPath();
    ctx.moveTo(L - 4, B + 8);
    for (let x = L - 4; x <= R + 4; x += 5) ctx.lineTo(x, Sky.groundAt(cor, cam + x));
    ctx.lineTo(R + 4, B + 8);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, LH * 0.55, 0, B);
    g.addColorStop(0, region.ground);
    g.addColorStop(1, region.groundDark);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = region.edge;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (let x = L - 4; x <= R + 4; x += 5) {
      const y = Sky.groundAt(cor, cam + x);
      x === L - 4 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Trees and hedges along the skyline. Stable per world column, so they slide
    // past rather than shimmering.
    ctx.fillStyle = region.groundDark;
    const col = Math.floor((cam + L) / 34) - 1;
    for (let i = col; i <= Math.floor((cam + R) / 34) + 1; i++) {
      const h = Math.floor(GK.util.hash2(i, 3) * 997) % 100;
      if (h > 58) continue;
      const wx = i * 34 + (h % 13);
      const y = Sky.groundAt(cor, wx);
      const size = 5 + (h % 6);
      ctx.beginPath();
      ctx.moveTo(wx - cam - size * 0.6, y + 1);
      ctx.lineTo(wx - cam, y - size);
      ctx.lineTo(wx - cam + size * 0.6, y + 1);
      ctx.closePath();
      ctx.fill();
    }
  },

  // Thermals and sinks: what the air is doing where you cannot see it. Drawn as
  // motes streaming the way the column pushes, because a pilot who cannot see a
  // thermal cannot plan a fuel-free climb — and planning that is the game.
  drawAir(ctx) {
    const cam = this.camX, T = Game.T;
    for (const c of Game.flight.cols) {
      const x = c.x - cam;
      if (x < -this.offX - c.w || x > LW + this.offX + c.w) continue;
      const up = c.v < 0;
      ctx.globalAlpha = 0.24;
      ctx.fillStyle = up ? "#fff3c4" : "#9fb4c9";
      for (let i = 0; i < 16; i++) {
        const f = (GK.util.hash2(Math.round(c.x), i) * 997) % 1000 / 1000;
        const span = LH - c.top;
        const t = ((T * (up ? 0.24 : 0.18) + f) % 1);
        const my = up ? LH - t * span : c.top + t * span;
        const mx = x + (f - 0.5) * c.w * 0.86;
        ctx.beginPath();
        ctx.ellipse(mx, my, 1.6, up ? 4.5 : 3, 0, 0, TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  },

  /* ---------------------------- landing field ---------------------------- */
  drawField(ctx, region) {
    const f = Game.flight;
    if (f.endless) return;
    const cam = this.camX;
    const x0 = f.len - RULES.FIELD_W - cam, x1 = f.len + RULES.FIELD_W - cam;
    if (x1 < -this.offX - 40 || x0 > LW + this.offX + 40) return;
    ctx.fillStyle = "rgba(255,240,160,0.24)";
    ctx.beginPath();
    ctx.moveTo(x0, LH + this.offY);
    for (let x = x0; x <= x1; x += 6) ctx.lineTo(x, Sky.groundAt(f.cor, cam + x) - 3);
    ctx.lineTo(x1, LH + this.offY);
    ctx.closePath();
    ctx.fill();

    // Bunting on two poles, so the meadow reads as somewhere you are expected.
    for (const px of [x0 + 10, x1 - 10]) {
      const gy = Sky.groundAt(f.cor, cam + px);
      ctx.strokeStyle = "#f7f3e2";
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(px, gy); ctx.lineTo(px, gy - 40); ctx.stroke();
    }
    const ga = Sky.groundAt(f.cor, cam + x0 + 10) - 40;
    const gb = Sky.groundAt(f.cor, cam + x1 - 10) - 40;
    ctx.strokeStyle = "rgba(255,255,255,0.75)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(x0 + 10, ga);
    ctx.quadraticCurveTo((x0 + x1) / 2, (ga + gb) / 2 + 16, x1 - 10, gb);
    ctx.stroke();
    const flags = ["#ff5d73", "#ffc93c", "#4ecdc4", "#c77dff", "#7bd88f"];
    for (let i = 1; i < 9; i++) {
      const t = i / 9;
      const fx = x0 + 10 + (x1 - x0 - 20) * t;
      const fy = ga + (gb - ga) * t + Math.sin(Math.PI * t) * 16;
      ctx.fillStyle = flags[i % flags.length];
      ctx.beginPath();
      ctx.moveTo(fx - 3, fy); ctx.lineTo(fx + 3, fy); ctx.lineTo(fx, fy + 7);
      ctx.closePath(); ctx.fill();
    }
  },

  /* ------------------------------ pickups -------------------------------- */
  drawPickups(ctx, L, R) {
    const cam = this.camX, T = Game.T;
    for (const p of Game.pickups) {
      if (p.got) continue;
      const x = p.x - cam;
      if (x < L - 40 || x > R + 40) continue;
      const bob = Math.sin(T * 1.6 + p.x * 0.01) * 3;
      const y = p.y + bob;
      if (p.kind === "canister") {
        ctx.fillStyle = "#8ea6bb";
        this.roundRect(ctx, x - 6, y - 8, 12, 16, 3);
        ctx.fill();
        ctx.fillStyle = "#c8d8e6";
        this.roundRect(ctx, x - 6, y - 8, 12, 5, 2);
        ctx.fill();
        ctx.fillStyle = "#5c6f80";
        ctx.fillRect(x - 2, y - 11, 4, 4);
        ctx.fillStyle = "#ffd166";
        ctx.font = "bold 7px system-ui, sans-serif";
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText("GAS", x, y + 2);
        ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
      } else if (p.kind === "lantern") {
        ctx.globalAlpha = 0.3;
        ctx.fillStyle = "#ffd9a0";
        ctx.beginPath(); ctx.arc(x, y, 15, 0, TAU); ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = p.color;
        this.roundRect(ctx, x - 7, y - 9, 14, 17, 6);
        ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.55)";
        this.roundRect(ctx, x - 4, y - 6, 4, 9, 2);
        ctx.fill();
        ctx.fillStyle = "#7a4a20";
        ctx.fillRect(x - 8, y - 10, 16, 2);
        ctx.fillRect(x - 8, y + 7, 16, 2);
      } else {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.ellipse(x, y, 8, 9.5, 0, 0, TAU);
        ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.55)";
        ctx.beginPath(); ctx.ellipse(x - 2.6, y - 3, 2.4, 3.2, -0.4, 0, TAU); ctx.fill();
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.moveTo(x - 2.4, y + 8.6); ctx.lineTo(x + 2.4, y + 8.6); ctx.lineTo(x, y + 12);
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.4)";
        ctx.lineWidth = 0.9;
        ctx.beginPath();
        ctx.moveTo(x, y + 12);
        ctx.quadraticCurveTo(x + 3, y + 18, x - 1, y + 24);
        ctx.stroke();
      }
    }
  },

  /* -------------------------------- birds -------------------------------- */
  drawBirds(ctx, L, R) {
    const cam = this.camX, T = Game.T;
    for (const b of Game.birds) {
      const p = birdPos(b, T);
      const x = p.x - cam;
      if (x < L - 40 || x > R + 40) continue;
      const spec = b.spec;
      // Which way it is facing is the one thing a pilot must be able to read at
      // a glance, so the body is drawn from the direction of travel.
      const ahead = birdPos(b, T + 0.12);
      const dir = ahead.x >= p.x ? 1 : -1;
      const flap = Math.sin(T * 9 + b.phase * 12);

      ctx.save();
      ctx.translate(x, p.y);
      ctx.scale(dir, 1);
      ctx.fillStyle = spec.wing;
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(-spec.r * 0.5, side * spec.r * (0.5 + flap * 0.5),
                             -spec.r * 1.25, side * spec.r * (0.15 + flap * 0.75));
        ctx.quadraticCurveTo(-spec.r * 0.5, side * spec.r * 0.12, 0, 0);
        ctx.fill();
      }
      ctx.fillStyle = spec.body;
      ctx.beginPath();
      ctx.ellipse(0, 0, spec.r * 0.85, spec.r * 0.5, 0, 0, TAU);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(spec.r * 0.72, -spec.r * 0.16, spec.r * 0.36, 0, TAU);
      ctx.fill();
      ctx.fillStyle = "#ffb347";
      ctx.beginPath();
      ctx.moveTo(spec.r * 1.02, -spec.r * 0.2);
      ctx.lineTo(spec.r * 1.6, -spec.r * 0.06);
      ctx.lineTo(spec.r * 1.02, spec.r * 0.06);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#1a1420";
      ctx.beginPath(); ctx.arc(spec.r * 0.86, -spec.r * 0.26, spec.r * 0.11, 0, TAU); ctx.fill();
      ctx.restore();
    }
  },

  /* ------------------------------- balloon ------------------------------- */
  drawBalloon(ctx, region) {
    const p = Game.pos;
    const x = p.x - this.camX, y = p.y;
    const R = BALLOON.R;
    ctx.save();
    if (Game.iframes > 0 && Math.floor(Game.iframes * 16) % 2 === 0) ctx.globalAlpha = 0.45;
    // Tilt with the wind you are taking up, which reads as the basket swinging.
    ctx.translate(x, y);
    ctx.rotate(Math.max(-0.24, Math.min(0.24, (Game.windHere() - p.vx) / 260)));

    // Ropes and basket first, so the envelope overlaps their tops.
    ctx.strokeStyle = "#8a7250";
    ctx.lineWidth = 1;
    for (const dx of [-6, 6]) {
      ctx.beginPath();
      ctx.moveTo(dx * 0.9, R * 0.55);
      ctx.lineTo(dx * 0.7, R + 8);
      ctx.stroke();
    }
    ctx.fillStyle = "#8a5f34";
    this.roundRect(ctx, -7, R + 6, 14, 10, 2.5);
    ctx.fill();
    ctx.fillStyle = "#6d4826";
    ctx.fillRect(-7, R + 8.5, 14, 1.6);

    // Sandbags still aboard hang off the basket — the ballast you have left is
    // a thing you can see rather than a number to remember.
    ctx.fillStyle = "#c9ad78";
    for (let i = 0; i < Math.min(Game.sand, 6); i++) {
      const bx = -6 + (i % 3) * 6, by = R + 16 + Math.floor(i / 3) * 5;
      ctx.beginPath(); ctx.ellipse(bx, by, 2.6, 3.2, 0, 0, TAU); ctx.fill();
    }

    // The envelope, in gores.
    const gores = [region.edge, "#ffffff", region.ground, "#ffffff"];
    for (let i = 0; i < 6; i++) {
      const a0 = -Math.PI / 2 + (i / 6) * TAU, a1 = -Math.PI / 2 + ((i + 1) / 6) * TAU;
      ctx.fillStyle = gores[i % gores.length];
      ctx.beginPath();
      ctx.moveTo(0, R * 0.92);
      ctx.arc(0, -R * 0.12, R, a0, a1);
      ctx.closePath();
      ctx.fill();
    }
    ctx.strokeStyle = "rgba(0,0,0,0.22)";
    ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.arc(0, -R * 0.12, R, 0, TAU); ctx.stroke();
    // The skirt, tapering to the burner.
    ctx.fillStyle = "rgba(0,0,0,0.16)";
    ctx.beginPath();
    ctx.moveTo(-R * 0.62, R * 0.5);
    ctx.lineTo(R * 0.62, R * 0.5);
    ctx.lineTo(R * 0.3, R * 0.95);
    ctx.lineTo(-R * 0.3, R * 0.95);
    ctx.closePath(); ctx.fill();

    // Tears in the fabric: visible, and one per bird, so the compounding cost
    // has a face.
    ctx.strokeStyle = "rgba(40,20,20,0.75)";
    ctx.lineWidth = 1.3;
    for (let i = 0; i < Math.min(Game.tears, 5); i++) {
      const a = -2.2 + i * 0.9;
      const tx = Math.cos(a) * R * 0.72, ty = -R * 0.12 + Math.sin(a) * R * 0.72;
      ctx.beginPath();
      ctx.moveTo(tx - 2, ty - 2.6); ctx.lineTo(tx + 1.5, ty); ctx.lineTo(tx - 1, ty + 2.8);
      ctx.stroke();
    }

    // The flame. Its size is the surplus heat, so the instrument and the
    // physics are the same number.
    if (Game.input.burn && Game.fuel > 0) {
      const h = 7 + Math.abs(Math.sin(Game.T * 26)) * 4;
      ctx.fillStyle = "#ff9c3c";
      ctx.beginPath();
      ctx.moveTo(-3.4, R * 0.95); ctx.lineTo(0, R * 0.95 - h); ctx.lineTo(3.4, R * 0.95);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#ffe37a";
      ctx.beginPath();
      ctx.moveTo(-1.8, R * 0.95); ctx.lineTo(0, R * 0.95 - h * 0.6); ctx.lineTo(1.8, R * 0.95);
      ctx.closePath(); ctx.fill();
    }
    if (Game.input.vent) {
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = "#ffffff";
      for (let i = 0; i < 3; i++) {
        const t = (Game.T * 3 + i / 3) % 1;
        ctx.beginPath();
        ctx.arc((i - 1) * 5, -R - 4 - t * 14, 1.6 + t * 2.4, 0, TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  },

  /* ------------------------- the altitude ladder -------------------------- */
  // Six rungs down the left edge: which way each band blows, how hard, and
  // which one you are in. The single most important thing on the screen, and
  // the reason the whole stack is always visible.
  drawLadder(ctx, winds, L) {
    const here = Sky.bandAt(Game.pos.y);
    const x = L + 4, w = 46;
    for (let i = 0; i < BANDS; i++) {
      const top = Sky.bandY(i, 1) + 3, h = BAND_H - 6;
      const mine = i === here;
      ctx.fillStyle = mine ? "rgba(255,240,190,0.28)" : "rgba(10,14,30,0.3)";
      this.roundRect(ctx, x, top, w, h, 5);
      ctx.fill();
      if (mine) {
        ctx.strokeStyle = "rgba(255,240,190,0.8)";
        ctx.lineWidth = 1.2;
        this.roundRect(ctx, x, top, w, h, 5);
        ctx.stroke();
      }

      const wv = winds[i];
      const n = Math.min(3, Math.max(1, Math.round(Math.abs(wv) / 34)));
      const arrow = Math.abs(wv) < 9 ? "·" : (wv > 0 ? "▸" : "◂").repeat(n);
      ctx.fillStyle = Math.abs(wv) < 9 ? "rgba(255,255,255,0.5)"
        : wv > 0 ? "#c9f5a0" : "#ffc0c8";
      ctx.font = "bold 13px system-ui, sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(arrow, x + w / 2, top + h / 2 - 5);
      ctx.font = "bold 9px system-ui, sans-serif";
      ctx.fillStyle = "rgba(255,255,255,0.72)";
      ctx.fillText(`${Math.round(Math.abs(wv))}`, x + w / 2, top + h / 2 + 8);
      if (i === THIN_BAND) {
        ctx.font = "8px system-ui, sans-serif";
        ctx.fillStyle = "rgba(190,210,255,0.85)";
        ctx.fillText("THIN", x + w / 2, top + 8);
      }
      ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    }
  },

  /* --------------------------- the horizon strip -------------------------- */
  // Where everything is along the whole flight, because 320 logical pixels of
  // sky is about eight seconds of lookahead and routing needs more than that.
  drawMini(ctx, L, T, R) {
    const f = Game.flight;
    const y = T + 3, w = R - L - 8, x0 = L + 4;
    const span = f.endless ? Math.max(2400, Game.maxX + LW * 2) : f.len + 300;
    const at = (wx) => x0 + Math.max(0, Math.min(1, wx / span)) * w;

    ctx.fillStyle = "rgba(10,14,30,0.5)";
    this.roundRect(ctx, x0, y, w, MINI_H, 5);
    ctx.fill();

    if (!f.endless) {
      ctx.fillStyle = "rgba(255,240,160,0.75)";
      const fx = at(f.len - RULES.FIELD_W), fw = at(f.len + RULES.FIELD_W) - fx;
      this.roundRect(ctx, fx, y + 2, Math.max(4, fw), MINI_H - 4, 2);
      ctx.fill();
    }
    for (const p of Game.pickups) {
      if (p.got) continue;
      ctx.fillStyle = p.kind === "canister" ? "#9bb4c9" : p.color;
      ctx.beginPath();
      ctx.arc(at(p.x), y + MINI_H / 2, p.kind === "lantern" ? 2.6 : 2, 0, TAU);
      ctx.fill();
    }
    // The balloon, pointed the way the wind has it.
    const bx = at(Game.pos.x);
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.moveTo(bx, y - 1);
    ctx.lineTo(bx + 4, y + 5);
    ctx.lineTo(bx - 4, y + 5);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(bx - 0.8, y + 4, 1.6, MINI_H - 5);
  },

  drawHint(ctx, L, R, B) {
    if (this.hint <= 0) return;
    ctx.globalAlpha = Math.min(1, this.hint / 1.6) * 0.72;
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 11px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("HOLD THE TOP TO BURN · HOLD THE BOTTOM TO VENT", L + (R - L) / 2, B - 30);
    ctx.fillText("THE WIND DOES THE REST", L + (R - L) / 2, B - 16);
    ctx.textAlign = "left";
    ctx.globalAlpha = 1;
  },

  roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  },

  /* ================================= HUD ================================= */
  hud() {
    if (!this._hud) this._hud = {};
    const el = (id) => (this._hud[id] || (this._hud[id] = document.getElementById(id)));
    const gas = el("hud-gas"), sun = el("hud-sun"), cargo = el("hud-cargo"),
          sand = el("hud-sand"), alt = el("hud-alt");
    if (!gas) return;
    gas.style.width = `${Math.max(0, Math.min(100, (Game.fuel / Game.fuelMax) * 100)).toFixed(1)}%`;
    gas.classList.toggle("low", Game.fuel < Game.fuelMax * 0.22);
    if (Game.flight.endless) {
      sun.style.width = "100%";
      sun.parentElement.style.opacity = "0.25";
      cargo.textContent = `🎈 ${Game.cargo}`;
      cargo.classList.remove("short");
      alt.textContent = `${Game.metres()}m`;
    } else {
      sun.parentElement.style.opacity = "1";
      sun.style.width = `${Math.max(0, (Game.timeLeft / Game.flight.dusk) * 100).toFixed(1)}%`;
      sun.classList.toggle("low", Game.timeLeft < 25);
      cargo.textContent = `🎈 ${Game.cargo}/${Game.total}`;
      // Grey until the delivery is aboard, so "am I clearing this?" is
      // answerable at a glance without reading a number.
      cargo.classList.toggle("short", Game.cargo < Game.quota);
      alt.textContent = `${Math.round(Math.max(0, Game.flight.len - Game.pos.x) / 16)}m`;
    }
    sand.textContent = `🪨 ${Game.sand}`;
    sand.disabled = Game.sand <= 0;
  },
};
