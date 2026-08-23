// Deterministic randomness, used only by the Long Drift.
//
// The rule: never draw from a running stream. Derive a fresh generator from
// COORDINATES — RNG.sub(seed, "band", segment, i) — so what segment 12 holds
// depends only on it being segment 12 of that seed, never on how far the pilot
// got or what was generated first. A drift can therefore be built lazily as the
// balloon reaches it and still be identical to one built all at once, and
// today's drift is genuinely the same sky for everyone in the family.

const RNG = {
  // FNV-1a: any string -> a 32-bit seed.
  seedFrom(str) {
    const s = String(str);
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  },

  make(seed = 0) {
    let a = seed >>> 0;
    const next = () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    next.range = (lo, hi) => lo + next() * (hi - lo);
    next.int = (lo, hi) => Math.floor(lo + next() * (hi - lo + 1));
    next.pick = (arr) => arr[Math.floor(next() * arr.length)];
    next.chance = (p) => next() < p;
    return next;
  },

  sub(seed, ...parts) {
    return RNG.make((seed ^ RNG.seedFrom(parts.join("|"))) >>> 0);
  },

  // Today's date in the pilot's own timezone — the date on their calendar is
  // the sky they fly.
  today(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  },
};

if (typeof window === "undefined") Object.assign(globalThis, { RNG });
