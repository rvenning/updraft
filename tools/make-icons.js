// Generate icons/ — a striped balloon riding a band of wind at dusk.
// Run: node tools/make-icons.js  (from the updraft folder)
const fs = require("fs");
const path = require("path");
const { makeCanvas, downsample, encodePNG } = require("../lib/tools/png.js");

const OUT = path.join(__dirname, "..", "icons");
fs.mkdirSync(OUT, { recursive: true });

function paint(size, pad) {
  const SS = 4, big = size * SS;
  const cv = makeCanvas(big);
  const u = big / 100;                 // 1 unit = 1% of the icon

  const NIGHT = "#131a3a", DUSK = "#2b3a7a", GLOW = "#f0a25c";
  const GOLD = "#ffc93c", SKY = "#5ab7ff", CREAM = "#fdf6e6";
  const BASKET = "#8a5f34", ROPE = "#6d4826", MEADOW = "#3f8a4d";

  // sky, low sun
  cv.fillRect(0, 0, big, big, NIGHT);
  cv.fillCircle(50 * u, 62 * u, 46 * u, DUSK);
  cv.fillCircle(50 * u, 88 * u, 30 * u, GLOW);

  // maskable art keeps to the safe centre (~72%)
  const s = pad ? 0.76 : 1;
  const at = (v) => 50 * u + (v - 50) * u * s;
  const sz = (v) => v * u * s;

  // the ground, far below
  cv.fillRect(at(-10), at(88), sz(120), sz(30), MEADOW);

  // three wind bands, drawn as streaks going opposite ways — the instrument the
  // whole game is about, legible even at 48px.
  const bands = [[22, 1], [40, -1], [76, 1]];
  for (const [by, dir] of bands) {
    for (let i = 0; i < 4; i++) {
      const x = 8 + i * 24;
      cv.fillRect(at(x), at(by), sz(13), sz(2), "#ffffff28");
      cv.fillRect(at(dir > 0 ? x + 11 : x), at(by - 1), sz(4), sz(4), "#ffffff38");
    }
  }

  // the envelope: six gores, gold and cream, with a sky-blue centre stripe
  const cx = 50, cy = 46, r = 22;
  for (let i = 0; i < 6; i++) {
    const col = i === 2 || i === 3 ? SKY : (i % 2 ? CREAM : GOLD);
    // fill the gore as vertical slices of a circle, clipped to its wedge
    const x0 = cx - r + (i * 2 * r) / 6;
    for (let x = x0; x < x0 + (2 * r) / 6; x += 0.5) {
      const dx = x - cx;
      const h = Math.sqrt(Math.max(0, r * r - dx * dx));
      cv.fillRect(at(x), at(cy - h), sz(0.7), sz(h * 2), col);
    }
  }
  // the skirt tapering to the burner
  for (let x = cx - 9; x < cx + 9; x += 0.5) {
    const t = Math.abs(x - cx) / 9;
    cv.fillRect(at(x), at(cy + r - 2), sz(0.7), sz(8 - t * 3), "#00000033");
  }

  // ropes and basket
  cv.fillRect(at(cx - 7), at(cy + r + 3), sz(1.4), sz(7), ROPE);
  cv.fillRect(at(cx + 6), at(cy + r + 3), sz(1.4), sz(7), ROPE);
  cv.fillRect(at(cx - 8), at(cy + r + 9), sz(16), sz(9), BASKET);
  cv.fillRect(at(cx - 8), at(cy + r + 12), sz(16), sz(1.6), ROPE);

  // the burner flame
  cv.fillCircle(at(cx), at(cy + r + 4), sz(3), "#ff9c3c");
  cv.fillCircle(at(cx), at(cy + r + 4), sz(1.5), "#ffe37a");

  return downsample(cv.px, big, SS);
}

const write = (name, size, pad) =>
  fs.writeFileSync(path.join(OUT, name), encodePNG(size, size, paint(size, pad)));

write("icon-192.png", 192, false);
write("icon-512.png", 512, false);
write("maskable-512.png", 512, true);
console.log("icons written to", OUT);
