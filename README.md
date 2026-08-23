# Updraft 🎈

A hot-air balloon game where you cannot steer. You have a burner and a vent —
up and down is the whole of your control. Everything sideways is decided by
which of six wind bands you are sitting in, and the entire stack is on screen at
once, because choosing an altitude *is* the game.

**Play it:** https://rvenning.github.io/updraft/

## The idea

Six bands of wind are layered up the sky, each blowing its own way at its own
speed. Reading them and committing to one is how you get anywhere. Every answer
creates the next problem:

- The **top band is the fastest** — and the air up there is thin, so the burner
  drinks gas at more than double the rate. Speed costs fuel.
- **Thermals lift you for free.** Finding them is what fuel economy really is.
- **Ballast** makes you leap upward when you drop it, and a lighter balloon can
  never dive as fast again. It is one-way, and you get five or six bags.
- **Birds tear the envelope**, and every tear raises your cooling rate for the
  rest of the flight. They stack, so a bad patch gets worse.
- **Arriving is not landing.** The meadow is at the far end; overshoot it in a
  fast band and you have to find a westerly and come back.
- **Sunset** is the only clock, and the only way to lose.

## Features

- **20 flights across 4 regions** — Meadowlight, The Chalk Downs, Stormcoast and
  The High Passes — each with its own weather, terrain and birds.
- **The Long Drift**: one seeded endless sky per day, the same for everyone in
  the family. No sunset out there; the gas is the clock. This is what the family
  leaderboard ranks.
- **The Ribbon Loft**: seven permanent fittings, bought with ribbons earned on
  every flight, won or lost.
- Three stars a flight — one for the delivery, two for every balloon aboard,
  three for a flight without a tear or a scrape.
- A **2× speed toggle**, because a long flight is a long flight.
- Family profiles with optional PINs, a shared leaderboard, and progress that
  syncs across every device in the house.
- Installable as an app, and fully playable offline.

## Built on gamekit

Profiles, PINs, storage and family sync, the sound engine, screens and modals,
the install button and the waypoint helpers all come from
[gamekit](https://github.com/rvenning/gamekit), vendored into `lib/`. To pick up
a newer gamekit:

```
node ../gamekit/tools/sync-to-game.js .
```

Never edit `lib/` directly — the next sync overwrites it.

## How it is put together

Everything is plain `<script>` tags; there is no build step.

| File | What it is |
|---|---|
| `js/sky.js` | The wind bands, the ground profile and the moving air. Pure functions of position. |
| `js/pickups.js` · `js/birds.js` | What hangs in the sky and what flies through it. Both **fit themselves** to the terrain and to each other, so nothing can be authored inside a hill and no bird patrol can seal off the sky. |
| `js/flights.js` | The 20 flights. Cargo is authored as **legs** — "four in the easterly, then four up in the jet" — not as a list of coordinates. |
| `js/drift.js` | The Long Drift generator. Seeded from coordinates, never from a running stream, so a sky can be built lazily and still be identical for everyone. |
| `js/game.js` | The engine. No canvas, no DOM, no audio, **no `Math.random` at all**. |
| `js/render.js` | Drawing, input and the frame loop. |
| `js/upgrades.js` · `js/storage.js` · `js/audio.js` · `js/main.js` | The shop, persistence, sound and the app shell. |

Because the engine is pure and contains no randomness, the headless bots in
`tests/` replay the entire campaign exactly — a changed clear time is a genuine
balance change rather than a bad roll.

## Tests

```
node --test
```

- `tests/flights.test.js` — the content linter. Terrain profiles, a way east and
  a way back on every flight, nothing authored inside a hillside, a bird-free
  lane at every point of every flight, and the drift generator's guarantees
  checked against the sky the balloon actually flies rather than the tables it is
  built from.
- `tests/bot.test.js` — five pilots driving the real engine through all twenty
  flights: the progression run that proves nobody is ever stuck, an ace, an
  ordinary pilot, one that only ever climbs to the roof, and one that never
  touches the controls at all.
- `tests/storage.test.js` — the progress merge, which is the one function that
  can permanently destroy a save.

Two tools do the tuning rather than guesswork:

```
node tests/calibrate.js pilot     # what each flight COSTS against what it offers
node tests/diag.js 12 careful     # where the gas went on one flight, second by second
CD_REPORT=1 node --test tests/bot.test.js    # the per-flight balance table
```

## Local development

```
npx http-server . -p 8121 -c-1
```

Then open http://localhost:8121. Add `?debug=1` for the dev panel — note that it
**stubs out saving**, so never check persistence on it.

## Storage

`localStorage` under the `upd_` prefix, synced to the `updraft` collection of the
shared family Firebase project. The API key in `js/firebase-config.js` is a
public client config, not a secret — it is restricted to the Cloud Firestore API
and to the games' own origins.

Ribbons are spendable, so the save stores two monotonic counters
(`ribbonsEarned` and `ribbonsSpent`) and derives the balance. A plain `max()`
merge of a balance would resurrect spent ribbons the next time two devices met.
