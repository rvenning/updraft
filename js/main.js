// App shell — splash, the profile roster, the region map, the ribbon loft,
// results and the family leaderboard. Profiles, PINs, sync and install all come
// from gamekit; this file only decides what goes on each screen.

const AVATARS = ["🎈", "🪁", "🐦", "🦉", "🌤️", "🧺", "🦊", "🐼", "🐸", "🦄", "🐙", "⭐"];

const App = {
  profile: null,
  token: 0,          // bumped on every screen change a delayed transition could outlive

  el(id) { return document.getElementById(id); },

  init() {
    const settings = Storage.getSettings();
    Sfx.enabled = settings.sound !== false;
    Music.enabled = settings.music !== false;
    Game.speed = settings.speed === 2 ? 2 : 1;

    GK.UI.onScreenChange = (name) => {
      Render.active = name === "game";
      if (name !== "game") { Music.stop(); Burner.stop(); }
      if (name === "splash") this.refreshSplash();
    };
    GK.UI.bindSoundToggle(Storage);

    GK.Profiles.init({
      storage: Storage,
      avatars: AVATARS,
      meta: (p, prog) =>
        `⭐ ${Storage.totalStars(prog)}/${FLIGHTS.length * 3} · 🎈 ${prog.cargo || 0} · 🏆 ${(prog.best || 0).toLocaleString()}`,
      onEnter: (p) => { this.profile = p; this.showMap(); },
      addLabel: "New Pilot",
    });

    GK.initPWA({ appName: "Updraft" });
    Render.boot();

    GK.Debug.init({ storage: Storage, title: "UPDRAFT" })
      .jump("flight", FLIGHTS.length, (n) => this.startFlight(n - 1))
      .action("the field", () => { if (Game.running) Game.pos.x = Game.flight.len - 40; })
      .action("+40 gas", () => { Game.fuel = Math.min(Game.fuelMax, Game.fuel + 40); })
      .action("fill the hold", () => { for (const p of Game.pickups) if (isCargo(p.kind)) { p.got = true; Game.cargo++; } });

    this.showScreen("splash");
    Storage.initFirebase().then((ok) => {
      this.el("sync-badge").textContent = ok ? "☁️ family sync on" : "📴 offline";
      if (ok && GK.UI.screen === "profiles") GK.Profiles.renderList();
      if (ok && GK.UI.screen === "splash") this.refreshSplash();
      if (ok && GK.UI.screen === "map") this.showMap();
      if (ok && GK.UI.screen === "leaderboard") this.showLeaderboard(true);
    });
  },

  showScreen(name) { this.token++; GK.UI.showScreen(name); },

  /* ------------------------------- splash -------------------------------- */
  refreshSplash() {
    const last = GK.Profiles.lastProfile();
    const cont = this.el("btn-continue-as"), start = this.el("btn-start");
    if (last) {
      cont.style.display = "";
      cont.textContent = `🎈 Continue as ${last.avatar} ${last.name}`;
      cont.onclick = () => { Sfx.init(); GK.Profiles.select(last); };
      start.className = "btn ghost";
      start.textContent = "👥 Switch Pilot";
    } else {
      cont.style.display = "none";
      start.className = "btn big green";
      start.textContent = "🎈 Start Flying";
    }
  },

  play() {
    Sfx.init(); Sfx.click();
    GK.Profiles.renderList();
    this.showScreen("profiles");
  },

  howTo() { Sfx.click(); GK.UI.openModal("modal-howto"); },
  closeHowTo() { Sfx.click(); GK.UI.closeModal("modal-howto"); },

  /* --------------------------------- map --------------------------------- */
  showMap() {
    if (!this.profile) return this.play();
    const prog = Storage.getProgress(this.profile.id);
    const unlocked = Storage.unlockedFlight(prog);

    this.el("map-player").innerHTML = `${this.profile.avatar} <b>${GK.util.esc(this.profile.name)}</b>`;
    this.el("map-stars").textContent = `⭐ ${Storage.totalStars(prog)}`;
    this.el("map-ribbons").textContent = `🎀 ${Storage.ribbons(prog)}`;

    const cont = this.el("btn-continue");
    cont.textContent = `▶️ ${FLIGHTS[unlocked].name}`;
    cont.onclick = () => this.startFlight(unlocked);

    const drift = this.el("btn-drift");
    if (Storage.driftUnlocked(prog)) {
      drift.style.display = "";
      drift.textContent = `🌬️ The Long Drift — best ${(prog.best || 0).toLocaleString()}`;
    } else {
      drift.style.display = "none";
    }

    this.el("region-list").innerHTML = REGIONS.map((r) => {
      const cells = FLIGHTS.filter((f) => f.region === r.id).map((f) => {
        const done = prog.flights && prog.flights[f.idx];
        const open = f.idx <= unlocked;
        const stars = done ? done.stars : 0;
        return `<button class="flight${open ? "" : " locked"}${f.idx === unlocked ? " next" : ""}"
          ${open ? `onclick="App.startFlight(${f.idx})"` : "disabled"}
          aria-label="${open ? `Flight ${f.idx + 1}, ${GK.util.esc(f.name)}, ${stars} of 3 stars` : `Flight ${f.idx + 1}, locked`}">
          <span class="flight-n">${open ? f.idx + 1 : "🔒"}</span>
          <span class="flight-name">${open ? GK.util.esc(f.name) : "???"}</span>
          <span class="flight-stars">${open ? "★".repeat(stars) + "☆".repeat(3 - stars) : ""}</span>
        </button>`;
      }).join("");
      return `<section class="region" style="--rc:${r.edge}">
        <h3>${r.icon} ${GK.util.esc(r.name)}</h3>
        <div class="flight-grid">${cells}</div>
      </section>`;
    }).join("");

    this.showScreen("map");
  },

  /* ------------------------------- flying -------------------------------- */
  begin(track) {
    this.showScreen("game");
    Render.resize();                  // the stage only has a size once visible
    Render.camX = Render.camTarget();
    Render.hint = 6;
    Render._wasPaused = false;
    Render._last = performance.now();
    Fx.reset(); Tween.clear();
    if (Render.clearInput) Render.clearInput();
    this.el("btn-speed").textContent = Game.speed === 2 ? "⏩ 2×" : "▶️ 1×";
    if (Music.enabled) Music.start(track);
  },

  startFlight(idx) {
    Sfx.init(); Sfx.click();
    Game.startFlight(this.profile, idx);
    this.begin(FLIGHTS[idx].region >= 2 ? "high" : "meadow");
    GK.UI.toast(FLIGHTS[idx].note);
  },

  startDrift() {
    Sfx.init(); Sfx.click();
    Game.startDrift(this.profile, RNG.today());
    this.begin("high");
    GK.UI.toast("No sunset out here. The gas is your clock.");
  },

  dropSand() { if (Game.dropSand()) Render.hud(); },

  toggleSpeed() {
    Game.speed = Game.speed === 2 ? 1 : 2;
    this.el("btn-speed").textContent = Game.speed === 2 ? "⏩ 2×" : "▶️ 1×";
    const s = Storage.getSettings(); s.speed = Game.speed; Storage.saveSettings(s);
    Sfx.click();
  },

  pause() {
    if (!Game.running || Game.paused) return;
    Game.paused = true;
    Music.stop();
    GK.UI.openModal("modal-pause");
  },
  resume() {
    GK.UI.closeModal("modal-pause");
    Game.paused = false;
    Render._last = performance.now();   // don't bill the pause to the next frame
    if (Render.clearInput) Render.clearInput();
    if (Music.enabled) Music.start(Game.flight.endless || Game.flight.region >= 2 ? "high" : "meadow");
    Sfx.click();
  },
  togglePause() { Game.paused ? this.resume() : this.pause(); },

  quit() {
    GK.UI.closeModal("modal-pause");
    Game.abandon();
    Burner.stop(); Music.stop();
    this.showMap();
  },

  toggleMusic() {
    const on = Music.toggle();
    this.el("btn-music").textContent = on ? "🎵 Music: On" : "🔇 Music: Off";
    const s = Storage.getSettings(); s.music = on; Storage.saveSettings(s);
    if (on && Game.running && !Game.paused) {
      Music.start(Game.flight.endless || Game.flight.region >= 2 ? "high" : "meadow");
    }
    Sfx.click();
  },

  /* ------------------------------- results ------------------------------- */
  flightOver(res) {
    Burner.stop(); Music.stop();
    if (res.reason === "quit") return;
    const prog = res.mode === "drift"
      ? Storage.recordDrift(this.profile.id, res)
      : Storage.recordFlight(this.profile.id, res.flightIdx, res);

    // A delayed transition has to check the token it was scheduled under, or a
    // player who quits inside the window is yanked into a screen belonging to a
    // flight they walked away from.
    const token = ++this.token;
    const later = (fn, ms) => setTimeout(() => { if (this.token === token) fn(); }, ms);

    if (res.win) Sfx.touchdown(); else if (res.reason === "dark") Sfx.dusk(); else Sfx.down();

    later(() => {
      const emoji = this.el("res-emoji"), title = this.el("res-title");
      const stars = this.el("res-stars"), stats = this.el("res-stats");
      const next = this.el("res-next"), retry = this.el("res-retry");

      if (res.mode === "drift") {
        const best = res.score >= (prog.best || 0) && res.score > 0;
        emoji.textContent = best ? "🏆" : "🌬️";
        title.textContent = best ? "NEW BEST!" : "Out of gas";
        stars.textContent = "";
        this.el("res-score").textContent = res.score.toLocaleString();
        stats.innerHTML = [`🎈 ${res.cargo} aboard`, `📏 ${res.metres}m`,
                           `🪶 ${res.tears} tears`, `🎀 ${res.ribbons} ribbons`]
          .map((b) => `<div>${b}</div>`).join("");
        next.style.display = "none";
        retry.style.display = "";
        retry.textContent = "↻ Drift Again";
        retry.onclick = () => this.startDrift();
        this.el("res-finished").style.display = "none";
        if (best) later(() => Sfx.newBest(), 300);
        this.showScreen("results");
        return;
      }

      emoji.textContent = res.win ? (res.stars === 3 ? "🌟" : "🧺")
        : res.reason === "dark" ? "🌒" : "🌾";
      title.textContent = res.win ? "Safely down!"
        : res.reason === "dark" ? "Night caught you"
        : res.reason === "landed" ? "Landed short"
        : "Down in the fields";
      stars.textContent = res.win ? "★".repeat(res.stars) + "☆".repeat(3 - res.stars) : "";
      this.el("res-score").textContent = res.score.toLocaleString();
      stats.innerHTML = [
        `🎈 ${res.cargo}/${res.total} aboard`,
        `⛽ ${res.fuel} gas left`,
        `🪶 ${res.tears} tears · ${res.scrapes} scrapes`,
        `🎀 ${res.ribbons} ribbons`,
      ].map((b) => `<div>${b}</div>`).join("");

      const note = this.el("res-note");
      // Win cases first: `landed` is the reason on a win as well, so testing it
      // before the win branch would tell a perfect flight it came up short.
      if (res.win) {
        note.textContent = res.stars === 3 ? "Not a scratch on her. 🌟"
          : res.cargo < res.total ? `Bring home all ${res.total} for two stars — and fly it clean for three.`
          : "Every balloon aboard. Now fly it without a tear or a scrape.";
      } else if (res.reason === "landed") {
        note.textContent = `You made the meadow, but a delivery needs ${res.quota} of the ${res.total}. You keep the ribbons — go again!`;
      } else if (res.reason === "dark") {
        note.textContent = "The sun went down before you reached the meadow. Pick a faster band next time.";
      } else {
        note.textContent = "The envelope went cold and the basket came down. You keep every ribbon you earned.";
      }

      retry.style.display = "";
      retry.textContent = res.win ? "↻ Fly Again" : "↻ Retry";
      retry.onclick = () => this.startFlight(res.flightIdx);

      const nextIdx = res.flightIdx + 1;
      if (res.win && nextIdx < FLIGHTS.length) {
        next.style.display = "";
        next.textContent = `▶️ ${FLIGHTS[nextIdx].name}`;
        next.onclick = () => this.startFlight(nextIdx);
      } else {
        next.style.display = "none";
      }
      this.el("res-finished").style.display = res.win && nextIdx >= FLIGHTS.length ? "" : "none";

      if (res.win) for (let i = 0; i < res.stars; i++) later(() => Sfx.star(i + 1), 420 + i * 260);
      this.showScreen("results");
    }, 700);
  },

  /* --------------------------------- shop -------------------------------- */
  showShop() {
    Sfx.click();
    const prog = Storage.getProgress(this.profile.id);
    this.el("shop-ribbons").textContent = `🎀 ${Storage.ribbons(prog)}`;
    this.el("shop-list").innerHTML = UPGRADES.map((u) => {
      const lvl = (prog.upgrades && prog.upgrades[u.id]) || 0;
      const maxed = lvl >= u.costs.length;
      const cost = maxed ? 0 : u.costs[lvl];
      const afford = Storage.ribbons(prog) >= cost;
      const pips = "●".repeat(lvl) + "○".repeat(u.costs.length - lvl);
      return `<div class="shop-card${maxed ? " maxed" : ""}">
        <span class="shop-icon">${u.icon}</span>
        <span class="shop-info">
          <span class="shop-name">${GK.util.esc(u.name)} <span class="shop-pips">${pips}</span></span>
          <span class="shop-desc">${GK.util.esc(u.desc)}${lvl ? ` — now ${GK.util.esc(String(u.fmt(u.value[lvl - 1])))}` : ""}</span>
        </span>
        ${maxed
          ? `<span class="shop-max">MAX</span>`
          : `<button class="btn small${afford ? " green" : " grey"}" ${afford ? "" : "disabled"}
               onclick="App.buy('${u.id}')" aria-label="Buy ${GK.util.esc(u.name)} for ${cost} ribbons">🎀 ${cost}</button>`}
      </div>`;
    }).join("");
    this.showScreen("shop");
  },

  buy(id) {
    const r = Storage.buyUpgrade(this.profile.id, id);
    if (!r.ok) { GK.UI.toast(r.reason === "ribbons" ? "Not enough ribbons" : "Already maxed"); Sfx.wrong(); return; }
    Sfx.lantern();
    GK.UI.toast("Fitted!");
    this.showShop();
  },

  /* ----------------------------- leaderboard ----------------------------- */
  showLeaderboard(silent) {
    if (!silent) Sfx.click();
    GK.Profiles.renderLeaderboard("lb-rows", {
      cols: (r) => `<span class="lb-stat">⭐ ${Storage.totalStars(r.progress)}</span>
        <span class="lb-stat">🎈 ${r.progress.cargo || 0}</span>
        <span class="lb-stat">🏆 ${(r.progress.best || 0).toLocaleString()}</span>`,
      sort: (a, b) => (b.progress.best || 0) - (a.progress.best || 0)
        || Storage.totalStars(b.progress) - Storage.totalStars(a.progress),
      meId: this.profile?.id,
      empty: "No pilots yet — tap Play!",
    });
    this.showScreen("leaderboard");
  },
};

// Run init on DOMContentLoaded, not inline at the bottom of <body>: rendering
// the first screen before layout settles resolves viewport-relative clamp()
// font sizes against the inherited value on that one render.
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => App.init());
else App.init();
