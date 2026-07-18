/* ============================================================
   Ambient — procedural environment audio (waves, wind, birds),
   simple synthesized weapon/impact SFX, and a generative score:
   a dark minor drone pad with slow chord drift, a deep pulse,
   and a combat layer (ostinato + faster percussion) that fades
   in with setMusicIntensity(0..1). All Web Audio, no assets.
   ============================================================ */

/* D-minor-world chords, low register (Hz): [root, low 5th/3rd, color] */
const CHORDS = [
  [36.71, 73.42, 87.31],   // D1  D2  F2   (Dm)
  [29.14, 58.27, 87.31],   // Bb0 Bb1 F2   (Bb)
  [32.70, 65.41, 98.00],   // C1  C2  G2   (C)
  [27.50, 55.00, 82.41],   // A0  A1  E2   (Am)
];
/* combat ostinato notes (D natural minor, mid-low) */
const OSTINATO = [73.42, 87.31, 110.0, 87.31, 73.42, 98.0, 87.31, 65.41];

export class Ambient {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = false;
    this.birdTimer = null;
    this.musicTimer = null;
    this._intensity = 0;
    this._chordIdx = 0;
    this._ostStep = 0;
  }

  init() {
    const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);

    const len = ctx.sampleRate * 4;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = last * 3.4; }

    const s1 = ctx.createBufferSource(); s1.buffer = buf; s1.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 300;
    const g1 = ctx.createGain(); g1.gain.value = 0.34;   // waves sit under the score now
    const lfo1 = ctx.createOscillator(); lfo1.frequency.value = 0.09;
    const lg1 = ctx.createGain(); lg1.gain.value = 0.2;
    lfo1.connect(lg1).connect(g1.gain);
    s1.connect(lp).connect(g1).connect(this.master);

    const s2 = ctx.createBufferSource(); s2.buffer = buf; s2.loop = true; s2.playbackRate.value = 0.7;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 550; bp.Q.value = 0.5;
    const g2 = ctx.createGain(); g2.gain.value = 0.09;
    const lfo2 = ctx.createOscillator(); lfo2.frequency.value = 0.047;
    const lg2 = ctx.createGain(); lg2.gain.value = 0.05;
    lfo2.connect(lg2).connect(g2.gain);
    s2.connect(bp).connect(g2).connect(this.master);

    s1.start(); s2.start(); lfo1.start(); lfo2.start();
    this._initMusic();
  }

  /* ---- generative score ---- */
  _initMusic() {
    const ctx = this.ctx;
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = 0.85;
    this.musicBus.connect(this.master);

    // drone pad: three detuned saw pairs through a slowly breathing lowpass
    this.padFilter = ctx.createBiquadFilter();
    this.padFilter.type = 'lowpass'; this.padFilter.frequency.value = 340; this.padFilter.Q.value = 0.7;
    const padLfo = ctx.createOscillator(); padLfo.frequency.value = 0.045;
    const padLfoG = ctx.createGain(); padLfoG.gain.value = 120;
    padLfo.connect(padLfoG).connect(this.padFilter.frequency);
    this.padGain = ctx.createGain(); this.padGain.gain.value = 0.055;
    this.padFilter.connect(this.padGain).connect(this.musicBus);
    this.padOscs = CHORDS[0].map((f, i) => {
      const a = ctx.createOscillator(), b = ctx.createOscillator();
      a.type = 'sawtooth'; b.type = 'sawtooth';
      a.frequency.value = f; b.frequency.value = f; b.detune.value = i === 0 ? 5 : -6;
      const g = ctx.createGain(); g.gain.value = i === 0 ? 0.5 : 0.3;
      a.connect(g); b.connect(g); g.connect(this.padFilter);
      a.start(); b.start();
      return [a, b];
    });
    padLfo.start();

    // combat ostinato bus — silent until intensity rises
    this.combatGain = ctx.createGain(); this.combatGain.gain.value = 0;
    this.combatGain.connect(this.musicBus);
  }

  _chordDrift() {
    // glide the pad to the next chord; darker changes at higher intensity
    this._chordIdx = (this._chordIdx + 1 + ((Math.random() * 2) | 0)) % CHORDS.length;
    const chord = CHORDS[this._chordIdx], t = this.ctx.currentTime;
    this.padOscs.forEach(([a, b], i) => {
      a.frequency.setTargetAtTime(chord[i], t, 2.5);
      b.frequency.setTargetAtTime(chord[i], t, 3.2);
    });
  }

  _beat() {
    if (!this.enabled) return;
    const ctx = this.ctx, t = ctx.currentTime, k = this._intensity;

    // deep pulse: always breathing, harder and faster in combat
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(58, t);
    o.frequency.exponentialRampToValueAtTime(27, t + 0.28);
    g.gain.setValueAtTime(0.10 + k * 0.16, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
    o.connect(g).connect(this.musicBus);
    o.start(t); o.stop(t + 0.4);

    // combat ostinato: one step per beat, through the intensity-gated bus
    if (k > 0.03) {
      const n = ctx.createOscillator(), ng = ctx.createGain();
      n.type = 'triangle';
      n.frequency.value = OSTINATO[this._ostStep++ % OSTINATO.length] * (this._ostStep % 16 < 8 ? 1 : 2);
      ng.gain.setValueAtTime(0.09, t);
      ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
      n.connect(ng).connect(this.combatGain);
      n.start(t); n.stop(t + 0.26);
    }

    // occasional chord movement (~ every 8 beats)
    if (Math.random() < 0.13) this._chordDrift();

    const interval = 1750 - k * 1150;   // calm ≈ 34 bpm feel, combat ≈ 100
    this.musicTimer = setTimeout(() => this._beat(), interval);
  }

  /* 0 = exploration, 1 = full combat; ramps the score's aggression */
  setMusicIntensity(v) {
    this._intensity = Math.min(1, Math.max(0, v));
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.combatGain.gain.setTargetAtTime(this._intensity * 0.9, t, 1.2);
    this.padFilter.frequency.setTargetAtTime(340 + this._intensity * 420, t, 1.5);
  }

  enable() {
    if (!this.ctx) this.init();
    this.ctx.resume();
    this.enabled = true;
    this.master.gain.cancelScheduledValues(this.ctx.currentTime);
    this.master.gain.linearRampToValueAtTime(0.7, this.ctx.currentTime + 1.6);
    this._chirp();
    clearTimeout(this.musicTimer);
    this._beat();
  }

  _chirp() {
    if (!this.enabled) return;
    const ctx = this.ctx, t0 = ctx.currentTime + 0.05;
    const notes = 2 + (Math.random() * 3 | 0);
    for (let n = 0; n < notes; n++) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      const f = 2100 + Math.random() * 1700;
      const t = t0 + n * (0.13 + Math.random() * 0.09);
      o.frequency.setValueAtTime(f, t);
      o.frequency.exponentialRampToValueAtTime(f * (1.15 + Math.random() * 0.4), t + 0.07);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.03 + Math.random() * 0.03, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
      o.connect(g).connect(this.master);
      o.start(t); o.stop(t + 0.16);
    }
    this.birdTimer = setTimeout(() => this._chirp(), 4000 + Math.random() * 9000);
  }

  /* low sweeping rumble for a dropship pass */
  rumble() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(), o2 = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sawtooth'; o2.type = 'sine';
    o.frequency.setValueAtTime(38, t); o.frequency.linearRampToValueAtTime(64, t + 2.2);
    o.frequency.linearRampToValueAtTime(30, t + 5.5);
    o2.frequency.setValueAtTime(77, t); o2.frequency.linearRampToValueAtTime(52, t + 5.5);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 140;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.22, t + 1.4);
    g.gain.linearRampToValueAtTime(0.0001, t + 5.8);
    o.connect(lp); o2.connect(lp); lp.connect(g).connect(this.master);
    o.start(t); o2.start(t); o.stop(t + 6); o2.stop(t + 6);
  }

  /* ---- weapon / combat SFX ---- */
  shoot() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'square';
    o.frequency.setValueAtTime(720, t);
    o.frequency.exponentialRampToValueAtTime(180, t + 0.12);
    g.gain.setValueAtTime(0.12, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
    o.connect(g).connect(this.master || ctx.destination);
    o.start(t); o.stop(t + 0.15);
  }
}
