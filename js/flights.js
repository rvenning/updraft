// The campaign: twenty flights across four regions.
//
// AUTHORING LANGUAGE
//   winds     six signed speeds, px/s, BOTTOM-UP — winds[0] is the band on the
//             deck, winds[5] the roof. Positive blows east (toward the field).
//   terrain   [x, groundY] waypoints, smoothstepped. Bigger y is lower ground;
//             504 is sea level. Must span [-320, len+320] and be FLAT across
//             the landing field, which sits at x = len.
//   legs      the cargo, as [band, howMany] runs. A flight is a handful of
//             COMMITMENTS — "ride the easterly, climb to the jet, come back
//             down" — not a shopping list. The balloons of a leg are spread
//             along the flight in order, so the route sweeps west to east and
//             every band change is a decision the pilot made.
//
//             The first draft authored each balloon's band by hand and produced
//             a yo-yo: the calibrator measured routes taking 2.2 to 2.8 times
//             the available daylight, because collecting the cargo meant
//             crossing the whole stack eight times. Legs fixed that at the
//             source. Every leg's band must blow EAST (the linter checks), or
//             its own run of balloons walks backwards.
//   extras    [x, band, t, kind] — the lanterns and the gas, placed by hand.
//             This is where a westerly belongs: a lantern hanging in air that
//             blows the wrong way is a deliberate tack out of the leg and back,
//             which is exactly what a high-value optional prize should cost.
//   birds     [x, span, band, t, kind, phase]
//   air       thermals and sinks: { x, w, v, top }; v is px/s, negative lifts.
//   dusk      seconds of daylight. The only clock, and the only way to lose.
//
// Every one of these is checked by tests/flights.test.js, including the two
// rules that make a flight possible at all: some band must blow east (or you
// can never reach the field) and some band must blow west (or overshooting the
// field is unrecoverable — being stuck is the one thing that is not allowed).

const REGIONS = [
  { id: 0, name: "Meadowlight", icon: "🌾",
    sky: ["#7fc8f8", "#ffe7bd"], ground: "#6bbf72", groundDark: "#3f8a4d",
    edge: "#ffd166", haze: "rgba(255,231,189,0.55)" },
  { id: 1, name: "The Chalk Downs", icon: "⛰️",
    sky: ["#6cb9ef", "#e3f3ff"], ground: "#ded9c6", groundDark: "#a9a48c",
    edge: "#8fd0ff", haze: "rgba(227,243,255,0.5)" },
  { id: 2, name: "Stormcoast", icon: "🌊",
    sky: ["#3f556f", "#8fa8bd"], ground: "#40625a", groundDark: "#26413c",
    edge: "#7ef0c8", haze: "rgba(143,168,189,0.5)" },
  { id: 3, name: "The High Passes", icon: "🏔️",
    sky: ["#2f2d63", "#ff9f7a"], ground: "#6f6280", groundDark: "#3f3752",
    edge: "#ffb3d1", haze: "rgba(255,159,122,0.4)" },
];

const FLIGHTS_RAW = [
  /* ===================== 1 · Meadowlight — learn the stack ================ */
  {
    region: 0, name: "First Light", len: 1750, dusk: 138, sand: 3,
    note: "Band 2 runs east. Band 4 comes back. That is the whole trick.",
    winds: [12, 44, 6, -34, 62, 82],
    terrain: [[-320, 488], [520, 472], [1080, 486], [1610, 480], [2070, 480]],
    air: [{ x: 700, w: 180, v: -42, top: 150 }],
    legs: [[1,4], [4,2]],
    extras: [[880, 3, 0.5, "lantern"],
              [620, 2, 0.5, "canister"]],
    birds: [],
  },
  {
    region: 0, name: "Hedgerow Hop", len: 2000, dusk: 142, sand: 3,
    note: "Two bands go east now, and the one between them does not.",
    winds: [20, 42, -16, 54, -40, 78],
    terrain: [[-320, 486], [480, 462], [1060, 484], [1560, 458], [1860, 478], [2320, 478]],
    air: [{ x: 520, w: 170, v: -38, top: 170 }, { x: 1140, w: 150, v: 26, top: 300 }],
    legs: [[1,3], [3,3]],
    extras: [[1020, 4, 0.5, "lantern"],
              [1500, 1, 0.5, "canister"]],
    birds: [[620, 420, 1, 0.5, "gull", 0.2]],
  },
  {
    region: 0, name: "The Long Meadow", len: 2350, dusk: 150, sand: 3,
    note: "The fastest air is two bands up. It is also the emptiest.",
    winds: [8, 34, 58, -28, 42, 86],
    terrain: [[-320, 490], [640, 470], [1240, 490], [1780, 466], [2210, 482], [2670, 482]],
    air: [{ x: 860, w: 190, v: -44, top: 140 }],
    legs: [[2,3], [1,2], [4,2]],
    extras: [[1180, 5, 0.5, "lantern"],
              [1640, 3, 0.5, "canister"]],
    birds: [[520, 480, 2, 0.5, "gull", 0], [1480, 520, 1, 0.5, "gull", 0.55]],
  },
  {
    region: 0, name: "Kite Weather", len: 2450, dusk: 150, sand: 3,
    note: "A hawk works a shear line. Do not squeeze past — go around it.",
    winds: [-16, 48, 14, -40, 68, 92],
    terrain: [[-320, 486], [560, 452], [1080, 480], [1620, 446], [2050, 476], [2310, 480], [2770, 480]],
    air: [{ x: 600, w: 170, v: -46, top: 150 }, { x: 1660, w: 160, v: -40, top: 160 },
          { x: 1180, w: 150, v: 30, top: 300 }],
    legs: [[1,3], [4,3], [1,2]],
    extras: [[1240, 5, 0.5, "lantern"],
              [1820, 2, 0.5, "canister"]],
    birds: [[560, 460, 1, 0.5, "gull", 0], [1240, 520, 3, 0.5, "hawk", 0.35],
            [1880, 440, 1, 0.5, "gull", 0.7]],
  },
  {
    region: 0, name: "Harvest Gold", len: 2650, dusk: 156, sand: 3,
    note: "Only one band goes east, and something is already flying in it.",
    winds: [26, -30, 50, 16, -48, 84],
    terrain: [[-320, 484], [600, 458], [1140, 486], [1700, 450], [2280, 480], [2510, 482], [2970, 482]],
    air: [{ x: 640, w: 180, v: -44, top: 150 }, { x: 1740, w: 170, v: -42, top: 160 },
          { x: 1260, w: 160, v: 32, top: 290 }],
    legs: [[2,4], [5,2], [2,3]],
    extras: [[900, 1, 0.5, "lantern"],
              [1900, 4, 0.5, "lantern"],
              [1420, 2, 0.5, "canister"]],
    birds: [[560, 500, 2, 0.5, "gull", 0], [1180, 560, 2, 0.5, "gull", 0.5],
            [1820, 520, 3, 0.5, "hawk", 0.25], [2160, 420, 2, 0.5, "gull", 0.8]],
  },

  /* ================= 2 · The Chalk Downs — ridges and rotors ============== */
  {
    region: 1, name: "Chalk Rise", len: 2600, dusk: 152, sand: 3,
    note: "Ridges lift the air in front and swallow it behind. Ride the front.",
    winds: [14, 48, 8, -36, 62, 90],
    terrain: [[-320, 486], [700, 380], [980, 396], [1500, 470], [1900, 372], [2180, 400], [2460, 478], [2920, 478]],
    air: [{ x: 660, w: 170, v: -52, top: 200 }, { x: 900, w: 150, v: 38, top: 330 },
          { x: 1860, w: 170, v: -50, top: 190 }, { x: 2100, w: 150, v: 36, top: 330 }],
    legs: [[1,4], [4,3], [1,2]],
    extras: [[1300, 5, 0.5, "lantern"],
              [1900, 1, 0.5, "canister"]],
    birds: [[600, 480, 2, 0.5, "gull", 0.1], [1300, 540, 1, 0.5, "gull", 0.6],
            [1940, 500, 3, 0.5, "hawk", 0.4]],
  },
  {
    region: 1, name: "Windmill Row", len: 2750, dusk: 156, sand: 3,
    note: "Four sinks in a row. Cross them high or pay for it in gas.",
    winds: [-14, 42, 56, -30, 22, 86],
    terrain: [[-320, 484], [560, 404], [900, 470], [1320, 396], [1680, 468], [2080, 388], [2420, 472], [2610, 480], [3070, 480]],
    air: [{ x: 720, w: 150, v: 40, top: 320 }, { x: 1140, w: 150, v: 42, top: 320 },
          { x: 1900, w: 150, v: 42, top: 320 }, { x: 2260, w: 150, v: 40, top: 320 },
          { x: 520, w: 170, v: -50, top: 200 }, { x: 2040, w: 170, v: -50, top: 190 }],
    legs: [[2,4], [1,3], [2,2]],
    extras: [[1380, 5, 0.5, "lantern"],
              [2000, 4, 0.5, "canister"]],
    birds: [[640, 520, 2, 0.5, "gull", 0], [1420, 560, 2, 0.5, "hawk", 0.3],
            [2060, 500, 1, 0.5, "gull", 0.65]],
  },
  {
    region: 1, name: "The Escarpment", len: 2900, dusk: 160, sand: 4,
    note: "One long wall of chalk. There is no way round it, only over.",
    winds: [12, -34, 54, 20, -44, 92],
    terrain: [[-320, 488], [820, 470], [1180, 340], [1980, 336], [2340, 462], [2760, 480], [3220, 480]],
    air: [{ x: 1120, w: 200, v: -58, top: 180 }, { x: 2060, w: 180, v: 46, top: 300 },
          { x: 1600, w: 160, v: -34, top: 220 }],
    legs: [[2,4], [5,3], [2,3]],
    extras: [[1160, 1, 0.5, "lantern"],
              [2180, 4, 0.5, "lantern"],
              [880, 3, 0.5, "canister"],
              [1960, 3, 0.5, "canister"],
              [1620, 3, 0.5, "canister"]],
    birds: [[700, 520, 2, 0.5, "gull", 0.15], [1320, 620, 3, 0.5, "hawk", 0.4],
            [2000, 540, 2, 0.5, "gull", 0.7], [1700, 480, 4, 0.5, "gull", 0.25]],
  },
  {
    region: 1, name: "Shepherd's Gap", len: 3000, dusk: 162, sand: 4,
    note: "The only easterly is the roof, and the roof drinks gas.",
    winds: [16, -28, -8, 28, -42, 96],
    terrain: [[-320, 486], [640, 400], [1020, 464], [1480, 372], [1860, 458], [2320, 384], [2680, 470], [2860, 480], [3320, 480]],
    air: [{ x: 600, w: 170, v: -54, top: 190 }, { x: 1440, w: 170, v: -56, top: 180 },
          { x: 2280, w: 170, v: -54, top: 185 }, { x: 860, w: 150, v: 40, top: 320 },
          { x: 1700, w: 150, v: 42, top: 320 }],
    legs: [[3,4], [5,3], [3,3]],
    extras: [[1200, 1, 0.5, "lantern"],
              [2260, 4, 0.5, "lantern"],
              [900, 3, 0.5, "canister"],
              [2040, 3, 0.5, "canister"],
              [1680, 3, 0.5, "canister"]],
    birds: [[600, 540, 3, 0.5, "hawk", 0], [1340, 580, 2, 0.5, "gull", 0.45],
            [2020, 560, 3, 0.5, "hawk", 0.6], [2540, 460, 4, 0.5, "gull", 0.2]],
  },
  {
    region: 1, name: "Downland Dusk", len: 3150, dusk: 166, sand: 4,
    note: "Less daylight than the map deserves. Pick your detours.",
    winds: [-20, 44, 12, -40, 64, 98],
    terrain: [[-320, 484], [720, 372], [1080, 430], [1560, 348], [1980, 440], [2480, 364], [2860, 466], [3010, 480], [3470, 480]],
    air: [{ x: 680, w: 180, v: -56, top: 180 }, { x: 1520, w: 180, v: -58, top: 175 },
          { x: 2440, w: 180, v: -56, top: 180 }, { x: 1240, w: 160, v: 44, top: 310 },
          { x: 2160, w: 160, v: 44, top: 310 }],
    legs: [[1,4], [4,4], [1,3]],
    extras: [[1260, 5, 0.5, "lantern"],
              [2380, 3, 0.5, "lantern"],
              [940, 1, 0.5, "canister"],
              [2140, 1, 0.5, "canister"]],
    birds: [[560, 560, 1, 0.5, "gull", 0.1], [1180, 620, 3, 0.5, "hawk", 0.35],
            [1900, 580, 1, 0.5, "gull", 0.7], [2420, 600, 3, 0.5, "hawk", 0.2],
            [1500, 500, 4, 0.5, "gull", 0.5]],
  },

  /* ==================== 3 · Stormcoast — the wind fights back ============= */
  {
    region: 2, name: "Salt Wind", len: 3050, dusk: 160, sand: 4,
    note: "Everything is faster here, including the way back.",
    winds: [30, -54, 20, 72, -64, 104],
    terrain: [[-320, 488], [700, 462], [1240, 486], [1820, 452], [2400, 484], [2910, 480], [3370, 480]],
    air: [{ x: 760, w: 170, v: -48, top: 180 }, { x: 1880, w: 170, v: -48, top: 180 },
          { x: 1360, w: 160, v: 38, top: 290 }, { x: 2460, w: 160, v: 38, top: 290 }],
    legs: [[3,4], [2,3], [3,3]],
    extras: [[1220, 5, 0.5, "lantern"],
              [2300, 5, 0.5, "lantern"],
              [920, 3, 0.5, "canister"],
              [2080, 3, 0.5, "canister"]],
    birds: [[620, 580, 3, 0.5, "crane", 0], [1420, 620, 1, 0.5, "gull", 0.4],
            [2060, 600, 3, 0.5, "hawk", 0.55], [2520, 520, 2, 0.5, "gull", 0.15]],
  },
  {
    region: 2, name: "Gullrock", len: 3200, dusk: 164, sand: 4,
    note: "Cranes do not turn around. Wait for the gap, not for the bird.",
    winds: [-26, 56, -16, 42, -56, 106],
    terrain: [[-320, 484], [640, 428], [1080, 470], [1540, 402], [1980, 466], [2460, 418], [2900, 472], [3060, 480], [3520, 480]],
    air: [{ x: 600, w: 170, v: -52, top: 190 }, { x: 1500, w: 170, v: -54, top: 185 },
          { x: 2420, w: 170, v: -52, top: 190 }, { x: 900, w: 160, v: 42, top: 300 },
          { x: 1820, w: 160, v: 42, top: 300 }],
    legs: [[1,4], [3,4], [1,3]],
    extras: [[1280, 5, 0.5, "lantern"],
              [2420, 5, 0.5, "lantern"],
              [960, 3, 0.5, "canister"],
              [2180, 3, 0.5, "canister"]],
    birds: [[500, 700, 1, 0.5, "crane", 0], [1200, 760, 1, 0.5, "crane", 0.5],
            [1860, 640, 3, 0.5, "hawk", 0.3], [2440, 680, 1, 0.5, "crane", 0.75],
            [2000, 480, 4, 0.5, "gull", 0.6]],
  },
  {
    region: 2, name: "The Reach", len: 3350, dusk: 168, sand: 4,
    note: "A long crossing on a band that keeps trying to send you home.",
    winds: [22, -58, 36, -42, 68, 110],
    terrain: [[-320, 486], [780, 452], [1360, 482], [1940, 440], [2520, 480], [3080, 456], [3210, 480], [3670, 480]],
    air: [{ x: 820, w: 180, v: -50, top: 180 }, { x: 1980, w: 180, v: -52, top: 175 },
          { x: 3020, w: 170, v: -48, top: 185 }, { x: 1480, w: 160, v: 40, top: 290 },
          { x: 2620, w: 160, v: 40, top: 290 }],
    legs: [[2,4], [4,4], [2,3]],
    extras: [[1340, 5, 0.5, "lantern"],
              [2540, 5, 0.5, "lantern"],
              [1000, 4, 0.5, "canister"],
              [2280, 4, 0.5, "canister"]],
    birds: [[560, 640, 4, 0.5, "hawk", 0.1], [1300, 700, 2, 0.5, "crane", 0.4],
            [2040, 660, 4, 0.5, "hawk", 0.65], [2740, 620, 2, 0.5, "gull", 0.2],
            [1700, 540, 1, 0.5, "gull", 0.8]],
  },
  {
    region: 2, name: "Squall Line", len: 3450, dusk: 170, sand: 5,
    note: "Nothing below the fourth band is going anywhere useful.",
    winds: [-34, -48, -22, 62, -68, 112],
    terrain: [[-320, 484], [700, 418], [1140, 466], [1620, 388], [2100, 460], [2600, 396], [3080, 464], [3310, 480], [3770, 480]],
    air: [{ x: 660, w: 180, v: -56, top: 185 }, { x: 1580, w: 180, v: -58, top: 180 },
          { x: 2560, w: 180, v: -56, top: 185 }, { x: 960, w: 160, v: 46, top: 300 },
          { x: 1900, w: 160, v: 46, top: 300 }, { x: 2880, w: 160, v: 44, top: 300 }],
    legs: [[3,4], [5,3], [3,4]],
    extras: [[1380, 1, 0.5, "lantern"],
              [2620, 4, 0.5, "lantern"],
              [1040, 3, 0.5, "canister"],
              [2360, 3, 0.5, "canister"]],
    birds: [[520, 720, 3, 0.5, "crane", 0], [1320, 780, 3, 0.5, "crane", 0.45],
            [2000, 700, 3, 0.5, "hawk", 0.25], [2700, 740, 3, 0.5, "crane", 0.7],
            [1740, 560, 1, 0.5, "gull", 0.55]],
  },
  {
    region: 2, name: "Harbour Light", len: 3600, dusk: 176, sand: 5,
    note: "Get high, go fast, come down early. The field will not wait.",
    winds: [28, -62, 26, -50, 76, 114],
    terrain: [[-320, 486], [760, 402], [1220, 462], [1740, 376], [2240, 458], [2760, 384], [3260, 466], [3460, 480], [3920, 480]],
    air: [{ x: 720, w: 180, v: -58, top: 180 }, { x: 1700, w: 180, v: -60, top: 175 },
          { x: 2720, w: 180, v: -58, top: 180 }, { x: 1040, w: 160, v: 46, top: 300 },
          { x: 2060, w: 160, v: 46, top: 300 }, { x: 3060, w: 160, v: 44, top: 300 }],
    legs: [[4,4], [2,4], [4,4]],
    extras: [[1080, 5, 0.5, "lantern"],
              [2160, 5, 0.5, "lantern"],
              [3060, 5, 0.5, "lantern"],
              [1620, 4, 0.5, "canister"],
              [2700, 4, 0.5, "canister"]],
    birds: [[560, 760, 4, 0.5, "crane", 0], [1360, 800, 2, 0.5, "crane", 0.4],
            [2100, 720, 4, 0.5, "hawk", 0.6], [2820, 780, 2, 0.5, "crane", 0.25],
            [1820, 600, 1, 0.5, "gull", 0.85], [3060, 520, 3, 0.5, "gull", 0.3]],
  },

  /* ================ 4 · The High Passes — thin air and stone ============== */
  {
    region: 3, name: "Foothills", len: 3450, dusk: 168, sand: 5,
    note: "The peaks reach the third band now. Plan the climbs, not the gaps.",
    winds: [16, -42, 50, -34, 56, 118],
    terrain: [[-320, 484], [660, 386], [1060, 440], [1560, 342], [2020, 434], [2540, 356], [3040, 452], [3310, 480], [3770, 480]],
    air: [{ x: 620, w: 180, v: -58, top: 175 }, { x: 1520, w: 180, v: -60, top: 170 },
          { x: 2500, w: 180, v: -58, top: 175 }, { x: 900, w: 160, v: 46, top: 300 },
          { x: 1840, w: 160, v: 48, top: 300 }, { x: 2820, w: 160, v: 46, top: 300 }],
    legs: [[2,4], [4,4], [2,4]],
    extras: [[1380, 5, 0.5, "lantern"],
              [2620, 5, 0.5, "lantern"],
              [1040, 4, 0.5, "canister"],
              [2360, 4, 0.5, "canister"],
              [1760, 4, 0.5, "canister"]],
    birds: [[540, 700, 4, 0.5, "hawk", 0.1], [1280, 760, 2, 0.5, "crane", 0.45],
            [2060, 720, 4, 0.5, "hawk", 0.6], [2760, 700, 2, 0.5, "crane", 0.2],
            [1720, 560, 3, 0.5, "gull", 0.8]],
  },
  {
    region: 3, name: "The Col", len: 3600, dusk: 172, sand: 5,
    note: "One gap in the ridge line, and the wind through it is not friendly.",
    winds: [-28, 54, -26, -40, 64, 120],
    terrain: [[-320, 486], [700, 366], [1120, 424], [1660, 316], [2120, 420], [2680, 330], [3180, 440], [3460, 480], [3920, 480]],
    air: [{ x: 660, w: 180, v: -62, top: 165 }, { x: 1620, w: 180, v: -64, top: 160 },
          { x: 2640, w: 180, v: -62, top: 165 }, { x: 960, w: 160, v: 50, top: 300 },
          { x: 1940, w: 160, v: 50, top: 300 }, { x: 2980, w: 160, v: 48, top: 300 }],
    legs: [[1,4], [4,4], [1,4]],
    extras: [[1080, 5, 0.5, "lantern"],
              [2160, 5, 0.5, "lantern"],
              [3060, 5, 0.5, "lantern"],
              [1620, 4, 0.5, "canister"],
              [2700, 4, 0.5, "canister"]],
    birds: [[520, 740, 4, 0.5, "crane", 0], [1340, 800, 4, 0.5, "hawk", 0.4],
            [2100, 760, 4, 0.5, "crane", 0.65], [2840, 720, 3, 0.5, "hawk", 0.25],
            [1760, 620, 1, 0.5, "gull", 0.85], [3060, 560, 3, 0.5, "gull", 0.35]],
  },
  {
    region: 3, name: "Thin Air", len: 3750, dusk: 178, sand: 5,
    note: "The roof is the only way east, and the roof costs double.",
    winds: [-36, -44, -28, -48, -30, 124],
    terrain: [[-320, 484], [740, 380], [1180, 436], [1740, 330], [2240, 428], [2800, 344], [3320, 448], [3610, 480], [4070, 480]],
    air: [{ x: 700, w: 190, v: -66, top: 155 }, { x: 1700, w: 190, v: -68, top: 150 },
          { x: 2760, w: 190, v: -66, top: 155 }, { x: 1020, w: 160, v: 48, top: 300 },
          { x: 2040, w: 160, v: 50, top: 300 }, { x: 3120, w: 160, v: 48, top: 300 }],
    legs: [[5,11]],
    extras: [[1120, 3, 0.5, "lantern"],
              [2620, 3, 0.5, "lantern"],
              [840, 4, 0.5, "canister"],
              [1880, 4, 0.5, "canister"],
              [2920, 4, 0.5, "canister"]],
    birds: [[560, 780, 4, 0.5, "crane", 0], [1400, 820, 4, 0.5, "hawk", 0.35],
            [2180, 800, 4, 0.5, "crane", 0.6], [2920, 760, 4, 0.5, "hawk", 0.2],
            [1840, 640, 2, 0.5, "gull", 0.8]],
  },
  {
    region: 3, name: "Crane Pass", len: 3900, dusk: 182, sand: 5,
    note: "Five cranes on a conveyor. There is a rhythm to it — find it.",
    winds: [26, -50, 58, -42, -34, 126],
    terrain: [[-320, 486], [760, 358], [1220, 420], [1800, 306], [2320, 414], [2880, 322], [3420, 436], [3760, 480], [4220, 480]],
    air: [{ x: 720, w: 190, v: -66, top: 155 }, { x: 1760, w: 190, v: -70, top: 148 },
          { x: 2840, w: 190, v: -66, top: 155 }, { x: 1060, w: 160, v: 52, top: 300 },
          { x: 2120, w: 160, v: 52, top: 300 }, { x: 3200, w: 160, v: 50, top: 300 }],
    legs: [[2,5], [5,4], [2,4]],
    extras: [[1160, 1, 0.5, "lantern"],
              [2340, 3, 0.5, "lantern"],
              [3320, 4, 0.5, "lantern"],
              [1740, 2, 0.5, "canister"],
              [2900, 2, 0.5, "canister"],
              [2340, 2, 0.5, "canister"]],
    birds: [[440, 860, 2, 0.5, "crane", 0], [1180, 880, 2, 0.5, "crane", 0.3],
            [1960, 860, 2, 0.5, "crane", 0.55], [2740, 880, 2, 0.5, "crane", 0.8],
            [3320, 800, 2, 0.5, "crane", 0.15], [1520, 660, 4, 0.5, "hawk", 0.45]],
  },
  {
    region: 3, name: "Summit Ferry", len: 4150, dusk: 236, sand: 6,
    note: "Everything this sky knows how to do, once each, in order.",
    winds: [-30, 56, -36, 48, -54, 128],
    terrain: [[-320, 484], [780, 344], [1260, 412], [1880, 296], [2420, 408], [3020, 312], [3560, 430], [4010, 480], [4470, 480]],
    air: [{ x: 740, w: 190, v: -68, top: 150 }, { x: 1840, w: 190, v: -72, top: 145 },
          { x: 2980, w: 190, v: -68, top: 150 }, { x: 1100, w: 160, v: 54, top: 300 },
          { x: 2200, w: 160, v: 54, top: 300 }, { x: 3340, w: 160, v: 52, top: 300 }],
    legs: [[1,5], [5,4], [3,5]],
    extras: [[1240, 5, 0.5, "lantern"],
              [2480, 5, 0.5, "lantern"],
              [3520, 5, 0.5, "lantern"],
              [900, 3, 0.5, "canister"],
              [1860, 3, 0.5, "canister"],
              [3060, 3, 0.5, "canister"],
              [2480, 3, 0.5, "canister"]],
    birds: [[480, 840, 3, 0.5, "crane", 0], [1240, 880, 3, 0.5, "crane", 0.35],
            [2020, 860, 4, 0.5, "hawk", 0.6], [2800, 900, 3, 0.5, "crane", 0.2],
            [3400, 820, 3, 0.5, "crane", 0.75], [1600, 700, 4, 0.5, "hawk", 0.5],
            [2500, 640, 2, 0.5, "gull", 0.9]],
  },
];

// Everything a flight needs at runtime, derived once. The terrain corridor and
// the pickup/bird objects are built here so the engine's reset() is cheap and
// the linter can inspect exactly what the game will use.
// Legs -> the [x, band, t] tuples everything downstream speaks. The balloons of
// each leg are spread evenly along the flight in leg order, alternating a little
// either side of the band's centre so a run is a line to fly rather than a rail.
function expandLegs(f) {
  const n = f.legs.reduce((s, [, k]) => s + k, 0);
  const x0 = f.len * 0.1, x1 = f.len * 0.95;
  const step = (x1 - x0) / Math.max(1, n - 1);
  const out = [];
  let i = 0;
  for (const [band, count] of f.legs) {
    for (let j = 0; j < count; j++, i++) {
      out.push([Math.round(x0 + i * step), band, i % 2 ? 0.62 : 0.4]);
    }
  }
  return out.concat(f.extras || []);
}

const FLIGHTS = FLIGHTS_RAW.map((f, i) => {
  const region = REGIONS[f.region];
  const cor = Sky.corridor(f.terrain);
  const raw = expandLegs(f);
  return {
    ...f,
    idx: i,
    endless: false,
    cor,
    cols: f.air || [],
    pickupsRaw: raw,
    birdsRaw: f.birds,
    // Built once, here, so the linter inspects exactly the objects the engine
    // flies through. Only `got` changes at runtime, and reset() clears it.
    pickups: makePickups(raw, cor),
    birds: makeBirds(f.birds, cor),
    cargo: raw.filter(([, , , k = "balloon"]) => isCargo(k)).length,
    // A campaign sky holds one weather pattern from end to end; the Long Drift
    // varies its own. Both answer the same two questions, so the engine never
    // has to know which kind of flight it is in.
    windsAt: () => f.winds,
    regionAt: () => region,
  };
});

const flightsOfRegion = (id) => FLIGHTS.filter((f) => f.region === id);
