/* ============================================================
   Ambient — procedural environment audio (waves, wind, birds)
   plus simple synthesized weapon/impact SFX. All Web Audio,
   no asset files.
   ============================================================ */

export class Ambient {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = false;
    this.birdTimer = null;
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
    const g1 = ctx.createGain(); g1.gain.value = 0.55;
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
  }

  enable() {
    if (!this.ctx) this.init();
    this.ctx.resume();
    this.enabled = true;
    this.master.gain.cancelScheduledValues(this.ctx.currentTime);
    this.master.gain.linearRampToValueAtTime(0.7, this.ctx.currentTime + 1.6);
    this._chirp();
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
