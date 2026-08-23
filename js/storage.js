// Persistence — gamekit storage configured for Updraft.
// upd_* localStorage keys, "updraft" Firestore collection.
//
// Ribbons are SPENT in the shop, so a plain max() merge would resurrect spent
// ones the next time two devices met. Both sides of the ledger are monotonic
// counters instead — ribbonsEarned and ribbonsSpent only ever grow — and the
// balance is derived, which makes max() safe again.
//
// blank/merge are declared as a named object before being handed to
// createStorage, because createStorage keeps them in a closure and never
// exposes them — and mergeProgress is the one function in the game that can
// permanently destroy a save, so tests/storage.test.js has to be able to call it.

const PROGRESS = {
  blank: () => ({
    ribbonsEarned: 0, ribbonsSpent: 0,
    flights: {},        // { [flightIdx]: { score, stars } } — best result per flight
    upgrades: {},       // { [upgradeId]: level }
    best: 0,            // best Long Drift score — the leaderboard headline
    bestMetres: 0,
    cargo: 0,           // LIFETIME balloons and lanterns brought home
    runs: 0,
    updated: 0,
  }),

  merge: (a, b) => {
    const flights = { ...(a.flights || {}) };
    for (const [idx, f] of Object.entries(b.flights || {})) {
      const cur = flights[idx];
      if (!cur) { flights[idx] = f; continue; }
      flights[idx] = {
        score: Math.max(cur.score || 0, f.score || 0),
        stars: Math.max(cur.stars || 0, f.stars || 0),
      };
    }
    const upgrades = { ...(a.upgrades || {}) };
    for (const [id, lvl] of Object.entries(b.upgrades || {}))
      upgrades[id] = Math.max(upgrades[id] || 0, lvl);
    return {
      // Spread first, so a field a newer client added survives an older
      // client's merge, then pin the fields we know how to reconcile.
      ...a, ...b,
      ribbonsEarned: Math.max(a.ribbonsEarned || 0, b.ribbonsEarned || 0),
      ribbonsSpent: Math.max(a.ribbonsSpent || 0, b.ribbonsSpent || 0),
      best: Math.max(a.best || 0, b.best || 0),
      bestMetres: Math.max(a.bestMetres || 0, b.bestMetres || 0),
      cargo: Math.max(a.cargo || 0, b.cargo || 0),
      runs: Math.max(a.runs || 0, b.runs || 0),
      flights, upgrades,
    };
  },
};

const Storage = GK.createStorage({
  prefix: "upd",
  collection: "updraft",
  firebaseConfig: window.FIREBASE_CONFIG,
  blankProgress: PROGRESS.blank,
  mergeProgress: PROGRESS.merge,
});

Object.assign(Storage, {
  ribbons(progress) {
    return Math.max(0, (progress.ribbonsEarned || 0) - (progress.ribbonsSpent || 0));
  },

  totalStars(progress) {
    return Object.values(progress.flights || {}).reduce((s, f) => s + (f.stars || 0), 0);
  },

  // Flights unlock in order: the one after the furthest cleared.
  unlockedFlight(progress) {
    let max = -1;
    for (const k of Object.keys(progress.flights || {})) max = Math.max(max, Number(k));
    return Math.min(max + 1, FLIGHTS.length - 1);
  },

  campaignDone(progress) {
    return Object.keys(progress.flights || {}).length >= FLIGHTS.length;
  },

  driftUnlocked(progress) {
    return (progress.flights && progress.flights[1] !== undefined) || false;
  },

  // Fold one finished flight into the profile. Only a WIN records the flight —
  // recording a loss would unlock the next one — but the ribbons and the
  // lifetime cargo count are banked either way, so a failed attempt still moves
  // the pilot forward.
  recordFlight(profileId, idx, res) {
    const prog = this.getProgress(profileId);
    if (res.win) {
      const cur = prog.flights[idx];
      if (!cur) prog.flights[idx] = { score: res.score, stars: res.stars };
      else {
        cur.score = Math.max(cur.score || 0, res.score || 0);
        cur.stars = Math.max(cur.stars || 0, res.stars || 0);
      }
    }
    prog.ribbonsEarned = (prog.ribbonsEarned || 0) + (res.ribbons || 0);
    prog.cargo = (prog.cargo || 0) + (res.cargo || 0);
    prog.runs = (prog.runs || 0) + 1;
    this.saveProgress(profileId, prog);
    return prog;
  },

  recordDrift(profileId, res) {
    const prog = this.getProgress(profileId);
    prog.best = Math.max(prog.best || 0, res.score || 0);
    prog.bestMetres = Math.max(prog.bestMetres || 0, res.metres || 0);
    prog.ribbonsEarned = (prog.ribbonsEarned || 0) + (res.ribbons || 0);
    prog.cargo = (prog.cargo || 0) + (res.cargo || 0);
    prog.runs = (prog.runs || 0) + 1;
    this.saveProgress(profileId, prog);
    return prog;
  },

  buyUpgrade(profileId, upgradeId) {
    const prog = this.getProgress(profileId);
    const def = UPGRADES.find((u) => u.id === upgradeId);
    const lvl = (prog.upgrades && prog.upgrades[upgradeId]) || 0;
    if (!def || lvl >= def.costs.length) return { ok: false, reason: "maxed" };
    const cost = def.costs[lvl];
    if (this.ribbons(prog) < cost) return { ok: false, reason: "ribbons" };
    prog.ribbonsSpent = (prog.ribbonsSpent || 0) + cost;
    prog.upgrades = prog.upgrades || {};
    prog.upgrades[upgradeId] = lvl + 1;
    this.saveProgress(profileId, prog);
    return { ok: true, progress: prog };
  },
});
