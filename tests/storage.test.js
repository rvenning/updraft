// Progress and cross-device reconciliation.
//
// mergeProgress is the one function in the game that can permanently destroy a
// save — it runs on every sync, on every device, and a bad merge is not a bug
// you notice, it is a child's campaign quietly rolling backwards. It lives in a
// closure inside createStorage, so js/storage.js declares it as a named PROGRESS
// object first purely so this file can reach it.

const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const { loadScripts } = require("../lib/tools/test-harness.js");

const ROOT = path.join(__dirname, "..");

const S = loadScripts({
  baseDir: ROOT,
  files: [
    "lib/gk-util.js",
    "lib/gk-storage.js",
    "lib/gk-path.js",
    "js/sky.js",
    "js/pickups.js",
    "js/birds.js",
    "js/flights.js",
    "js/rng.js",
    "js/drift.js",
    "js/upgrades.js",
    "js/storage.js",
  ],
  // browser:true, unlike tests/load.js — gk-storage needs window, localStorage
  // and a document. The `exports` list is what gets the bindings back out.
  exports: ["PROGRESS", "Storage", "FLIGHTS", "UPGRADES"],
  browser: true,
});

const { PROGRESS, Storage, FLIGHTS, UPGRADES } = S;
const blank = () => PROGRESS.blank();

/* ------------------------------------------------------ the ribbon ledger */

test("ribbons are a two-sided ledger, so a sync cannot refund what was spent", () => {
  // Device A earns 500 and spends 400 in the loft. Device B is a stale copy
  // that only ever saw the 500 earned. A max() merge of a plain BALANCE would
  // hand the 400 straight back — which is exactly why there is no balance field.
  const a = { ...blank(), ribbonsEarned: 500, ribbonsSpent: 400, upgrades: { net: 1 } };
  const b = { ...blank(), ribbonsEarned: 500, ribbonsSpent: 0 };
  for (const [x, y] of [[a, b], [b, a]]) {
    const m = PROGRESS.merge(x, y);
    assert.equal(Storage.ribbons(m), 100, "a stale device refunded a purchase");
    assert.equal(m.upgrades.net, 1, "the thing that was bought went missing");
  }
});

test("both halves of the ledger only ever grow", () => {
  const a = { ...blank(), ribbonsEarned: 900, ribbonsSpent: 700 };
  const b = { ...blank(), ribbonsEarned: 400, ribbonsSpent: 250 };
  const m = PROGRESS.merge(a, b);
  assert.equal(m.ribbonsEarned, 900);
  assert.equal(m.ribbonsSpent, 700);
});

/* ------------------------------------------------------------- the flights */

test("merging keeps the best result for every flight, from either side", () => {
  const a = { ...blank(), flights: { 0: { score: 900, stars: 3 }, 2: { score: 400, stars: 1 } } };
  const b = { ...blank(), flights: { 0: { score: 1200, stars: 1 }, 5: { score: 700, stars: 2 } } };
  const m = PROGRESS.merge(a, b);
  // Best of EACH FIELD, not the better-looking record: a higher score on a
  // one-star run must not throw away a three-star clear of the same flight.
  assert.deepEqual(m.flights[0], { score: 1200, stars: 3 });
  assert.deepEqual(m.flights[2], { score: 400, stars: 1 });
  assert.deepEqual(m.flights[5], { score: 700, stars: 2 });
});

test("the merge is symmetric — whichever device syncs first", () => {
  const a = {
    ...blank(), ribbonsEarned: 610, ribbonsSpent: 400, best: 5200, bestMetres: 310,
    cargo: 88, runs: 19, flights: { 0: { score: 900, stars: 3 }, 1: { score: 300, stars: 1 } },
    upgrades: { net: 2, tank: 1 },
  };
  const b = {
    ...blank(), ribbonsEarned: 480, ribbonsSpent: 480, best: 6100, bestMetres: 280,
    cargo: 74, runs: 25, flights: { 1: { score: 800, stars: 2 }, 4: { score: 250, stars: 1 } },
    upgrades: { net: 1, burner: 3 },
  };
  const ab = PROGRESS.merge(a, b), ba = PROGRESS.merge(b, a);
  for (const k of ["ribbonsEarned", "ribbonsSpent", "best", "bestMetres", "cargo", "runs"]) {
    assert.equal(ab[k], ba[k], `${k} depends on which device synced first`);
  }
  assert.deepEqual(ab.flights, ba.flights);
  assert.deepEqual(ab.upgrades, ba.upgrades);
  assert.equal(ab.best, 6100);
  assert.equal(ab.upgrades.net, 2);
  assert.equal(ab.upgrades.burner, 3);
});

test("a field a newer build added survives an older build's merge", () => {
  // The spread comes first in merge() for exactly this reason: an iPad running
  // last month's build must not delete a key it has never heard of.
  const newer = { ...blank(), somethingNew: 42 };
  const older = blank();
  assert.equal(PROGRESS.merge(older, newer).somethingNew, 42);
  assert.equal(PROGRESS.merge(newer, older).somethingNew, 42);
});

test("nothing in the save is allowed to go DOWN", () => {
  // Every field here is monotonic by design, which is what makes max() a safe
  // merge at all. If one ever legitimately falls, this test is the reminder
  // that max() will silently revert it and the symptom will be a feature
  // switching itself off.
  const rich = {
    ...blank(), ribbonsEarned: 1000, ribbonsSpent: 900, best: 9000, bestMetres: 500,
    cargo: 200, runs: 60, flights: { 0: { score: 900, stars: 3 } }, upgrades: { net: 3 },
  };
  const m = PROGRESS.merge(rich, blank());
  for (const k of ["ribbonsEarned", "ribbonsSpent", "best", "bestMetres", "cargo", "runs"]) {
    assert.ok(m[k] >= rich[k], `${k} fell when an empty save merged in`);
  }
  assert.deepEqual(m.flights[0], { score: 900, stars: 3 });
  assert.equal(m.upgrades.net, 3);
});

/* --------------------------------------------------------------- unlocking */

test("flights unlock in order, and only a WIN unlocks the next", () => {
  const p = blank();
  assert.equal(Storage.unlockedFlight(p), 0, "a fresh pilot cannot start at flight one");
  p.flights[0] = { score: 100, stars: 1 };
  assert.equal(Storage.unlockedFlight(p), 1);
  // Skipping ahead is not possible through the UI, but a synced save from a
  // further-on device must not lock a pilot BACK.
  p.flights[7] = { score: 100, stars: 1 };
  assert.equal(Storage.unlockedFlight(p), 8);
  p.flights[FLIGHTS.length - 1] = { score: 100, stars: 1 };
  assert.equal(Storage.unlockedFlight(p), FLIGHTS.length - 1, "unlocking ran off the end of the campaign");
});

test("the loft cannot be shopped in with ribbons you do not have", () => {
  const p = blank();
  const cheapest = UPGRADES.reduce((a, u) => Math.min(a, u.costs[0]), Infinity);
  assert.ok(Storage.ribbons(p) < cheapest, "a fresh pilot can already afford something");
  assert.equal(Storage.totalStars(p), 0);
});

test("star totals count every flight, capped at three each", () => {
  const p = blank();
  for (let i = 0; i < FLIGHTS.length; i++) p.flights[i] = { score: 1, stars: 3 };
  assert.equal(Storage.totalStars(p), FLIGHTS.length * 3);
});
