// What is floating out there to be caught, and what a catch is worth.
//
// Everything in the sky is authored as [x, band, t] — an x, a wind band, and a
// fraction of the way up that band — never as a raw y. A pickup therefore
// cannot be placed inside a hillside or outside the sky, and retuning a band's
// height carries its contents with it. It also means a level's contents read
// the way a pilot would describe them: "two in the easterly, one right at the
// top of the shear".

const PICKUPS = {
  balloon: {
    icon: "🎈", label: "balloon",
    score: 130, ribbons: 9, counts: 1,
    colors: ["#ff5d73", "#ffc93c", "#4ecdc4", "#c77dff", "#5ab7ff", "#7bd88f"],
  },
  // Worth double and almost always authored somewhere awkward — hard up under
  // the roof, or low over a ridge. The reason to take a risk.
  lantern: {
    icon: "🏮", label: "sky lantern",
    score: 340, ribbons: 22, counts: 1,
    colors: ["#ff8f4d", "#ffd166"],
  },
  // Not cargo: gas. Doesn't count toward the quota, so a level cannot be
  // cleared by refuelling.
  canister: {
    icon: "🛢️", label: "gas",
    score: 0, ribbons: 3, counts: 0,
    fuel: 30,
    colors: ["#9bb4c9"],
  },
};

const PICKUP_KINDS = Object.keys(PICKUPS);

// Cargo vs consumables. The quota, the "all of them" star and the HUD all count
// CARGO — three separate places that must agree, so they ask one function.
const isCargo = (kind) => PICKUPS[kind].counts > 0;

// A stable colour per item, so the same balloon is the same colour every flight
// (and on every device) without storing one.
function pickupColor(kind, x, band) {
  const c = PICKUPS[kind].colors;
  return c[Math.floor(GK.util.hash2(Math.round(x), band) * 997) % c.length];
}

// How much air a balloon needs under a thing to be able to reach it: the
// envelope, the basket hanging below it, and a little room for a control that
// lags by design.
const REACH_CLEAR = BALLOON_R + BASKET_H + 12;
// Nothing hangs right against the roof either — you would have to pin yourself
// to the ceiling to reach it.
const ROOF_CLEAR = BALLOON_R + 5;

// Build the live list for a flight. `raw` is the authored [x, band, t, kind]
// tuples; kind defaults to "balloon" so the common case is three numbers.
//
// A pickup LIFTS ITSELF clear of the ground rather than being authored and then
// checked. The band is a preference, and where a ridge intrudes into it the
// item hangs just above the ridge instead of inside it — so retuning terrain
// moves the contents with it instead of invalidating them. The linter still
// reads `lift` and fails anything shifted more than a band, because that is no
// longer a ridge nudging a balloon, it is an authoring mistake.
function makePickups(raw, cor) {
  return raw.map(([x, band, t = 0.5, kind = "balloon"]) => {
    const want = Sky.bandY(band, t);
    const floor = Sky.groundAt(cor, x) - REACH_CLEAR;
    const y = Math.max(ROOF_CLEAR, Math.min(want, floor));
    return { x, band, t, kind, y, want, lift: want - y,
             color: pickupColor(kind, x, band), got: false };
  });
}
