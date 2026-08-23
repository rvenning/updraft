// Sound — gamekit's synth core plus Updraft's own voices, and the same
// lookahead music scheduler the other family games use.
//
// One setInterval per note drifts and, in a hidden tab, gets throttled to ~1Hz
// and then machine-guns everything on return. Instead a ~110ms pump schedules
// every note up to LOOKAHEAD seconds ahead on the WebAudio clock.
//
// The burner is the one sustained voice, and it is DUCKED rather than stopped
// when the flight pauses: a stopped OscillatorNode can never be restarted, so
// pausing by stopping means rebuilding the voice with a fresh attack every time.

const Sfx = GK.Sfx;

Object.assign(Sfx, {
  // Catching a balloon: a soft rising boop that climbs with the run, so a clean
  // sweep down a leg audibly builds. The game's signature sound.
  gather(run = 1) {
    const step = Math.min(run, 8) - 1;
    this.tone({ freq: 540 + step * 44, type: "sine", dur: 0.09, vol: 0.15, slide: 90 });
    this.tone({ freq: 810 + step * 62, type: "triangle", dur: 0.12, vol: 0.1, when: 0.06, slide: 130 });
  },
  lantern() {
    [660, 880, 1175, 1568].forEach((f, i) =>
      this.tone({ freq: f, type: "sine", dur: 0.18, vol: 0.13, when: i * 0.06 }));
  },
  gas() {
    this.noise({ dur: 0.16, vol: 0.12 });
    this.tone({ freq: 200, type: "sawtooth", dur: 0.22, vol: 0.13, slide: 180 });
  },
  // Shedding a sandbag: a whump and the lurch upward.
  sand() {
    this.noise({ dur: 0.2, vol: 0.2 });
    this.tone({ freq: 120, type: "sine", dur: 0.3, vol: 0.16, slide: -60 });
    this.tone({ freq: 420, type: "triangle", dur: 0.34, vol: 0.09, when: 0.06, slide: 300 });
  },
  // A bird in the envelope. Startled and papery, never a buzzer.
  tear() {
    this.noise({ dur: 0.3, vol: 0.24 });
    this.tone({ freq: 900, type: "square", dur: 0.1, vol: 0.12, slide: -520 });
    this.tone({ freq: 620, type: "sawtooth", dur: 0.16, vol: 0.1, when: 0.09, slide: -260 });
  },
  scrape() {
    this.noise({ dur: 0.22, vol: 0.2 });
    this.tone({ freq: 150, type: "sawtooth", dur: 0.24, vol: 0.16, slide: -60 });
  },
  vent() { this.noise({ dur: 0.18, vol: 0.07 }); },
  touchdown() {
    [392, 523, 659, 784].forEach((f, i) =>
      this.tone({ freq: f, type: "triangle", dur: 0.26, vol: 0.15, when: i * 0.1 }));
  },
  star(n = 1) { this.tone({ freq: 680 + n * 180, type: "square", dur: 0.22, vol: 0.16, slide: 120 }); },
  // Caught by the dark: the light going out, not a death sting.
  dusk() {
    [440, 349, 294, 220].forEach((f, i) =>
      this.tone({ freq: f, type: "sine", dur: 0.42, vol: 0.16, when: i * 0.19 }));
  },
  down() {
    [294, 233, 196].forEach((f, i) =>
      this.tone({ freq: f, type: "sawtooth", dur: 0.34, vol: 0.17, when: i * 0.15 }));
    this.noise({ dur: 0.5, vol: 0.1, when: 0.3 });
  },
  newBest() {
    [659, 784, 988, 1319, 1568].forEach((f, i) =>
      this.tone({ freq: f, type: "square", dur: 0.2, vol: 0.16, when: i * 0.11 }));
  },
});

/* ------------------------------------------------------------ the burner */
// A held roar while the burner is on. Built once and ducked, because a stopped
// oscillator can never be restarted — and the muted flag is cleared in stop(),
// or quitting mid-burn leaves it set and the NEXT flight is silent with nothing
// in the console to explain it.
const Burner = {
  on: false, muted: false, nodes: null,

  build() {
    const ctx = Sfx.ctx;
    if (!ctx || this.nodes) return;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(ctx.destination);
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = 62;
    const rumble = ctx.createGain();
    rumble.gain.value = 0.5;
    osc.connect(rumble).connect(gain);
    osc.start();
    // Breath: filtered noise on top of the tone, which is what makes it a flame
    // rather than a chord.
    const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    noise.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 700;
    const ng = ctx.createGain();
    ng.gain.value = 0.5;
    noise.connect(lp).connect(ng).connect(gain);
    noise.start();
    this.nodes = { gain, osc };
  },

  set(on) {
    this.on = on;
    if (!Sfx.enabled || this.muted) return;
    this.build();
    if (!this.nodes) return;
    const g = this.nodes.gain.gain;
    g.cancelScheduledValues(Sfx.ctx.currentTime);
    g.setTargetAtTime(on ? 0.09 : 0, Sfx.ctx.currentTime, on ? 0.03 : 0.08);
  },

  duck(muted) {
    this.muted = muted;
    if (!this.nodes) return;
    const g = this.nodes.gain.gain;
    g.cancelScheduledValues(Sfx.ctx.currentTime);
    g.setTargetAtTime(muted ? 0 : (this.on ? 0.09 : 0), Sfx.ctx.currentTime, 0.05);
  },

  stop() { this.muted = false; this.set(false); },
};

/* ------------------------------------------------------------------ music */
// Semitone offsets from the root; null = a rest. One step is an eighth note.
// Bass loops every 16 steps and lead every 32, so the pair drifts through
// combinations a 16-step score would never reach.
const TRACKS = {
  meadow: {
    root: 52, bpm: 96,
    bass: [0, null, 7, null, 5, null, 7, null, 3, null, 10, null, 5, null, 2, null],
    lead: [12, 16, 19, 16, 14, null, 12, null, 9, 12, 16, 12, 11, null, 7, null,
           12, 19, 21, 19, 16, null, 14, null, 12, 9, 7, 9, 12, null, null, null],
  },
  high: {
    root: 48, bpm: 108,
    bass: [0, null, 0, 7, 3, null, 10, null, 5, null, 5, 12, 7, null, 2, null],
    lead: [19, 24, 26, 24, 21, null, 19, null, 17, 21, 24, 21, 19, null, 16, null,
           19, 26, 28, 26, 23, null, 21, null, 19, 16, 14, 16, 19, null, null, null],
  },
};

const midiHz = (n) => 440 * Math.pow(2, (n - 69) / 12);

const Music = {
  enabled: true,
  track: null,
  step: 0,
  nextT: 0,
  timer: null,
  LOOKAHEAD: 0.6,

  start(name) {
    const t = TRACKS[name];
    if (!t || !Sfx.ctx) return;
    if (this.track === t && this.timer) return;
    this.track = t;
    this.step = 0;
    this.nextT = Sfx.ctx.currentTime + 0.12;
    if (!this.timer) this.timer = setInterval(() => this.pump(), 110);
  },

  stop() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.track = null;
  },

  toggle() {
    this.enabled = !this.enabled;
    if (!this.enabled) this.stop();
    return this.enabled;
  },

  pump() {
    const t = this.track;
    if (!t || !this.enabled || !Sfx.enabled || !Sfx.ctx) return;
    const now = Sfx.ctx.currentTime;
    const spb = 60 / t.bpm / 2;
    // After a hitch (hidden tab, GC pause) skip the missed steps silently
    // rather than firing them all at once.
    if (this.nextT < now - 0.25) this.nextT = now + 0.05;
    while (this.nextT < now + this.LOOKAHEAD) {
      const when = this.nextT - now;
      const b = t.bass[this.step % t.bass.length];
      if (b !== null && b !== undefined)
        Sfx.tone({ freq: midiHz(t.root + b), type: "triangle", dur: spb * 1.4, vol: 0.06, when });
      const l = t.lead[this.step % t.lead.length];
      if (l !== null && l !== undefined)
        Sfx.tone({ freq: midiHz(t.root + l), type: "sine", dur: spb * 0.7, vol: 0.045, when });
      this.step++;
      this.nextT += spb;
    }
  },

  // Pausing pushes the clock forward instead of stopping it, so the pump never
  // wakes up thousands of steps in arrears.
  hold(seconds) { this.nextT += seconds; },
};
