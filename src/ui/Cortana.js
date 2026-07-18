/* ============================================================
   Cortana — queues dialogue lines and reveals them in the HUD
   comms panel one at a time with a typewriter effect.
   ============================================================ */

export class Cortana {
  constructor(panelEl, textEl) {
    this.panel = panelEl;
    this.text = textEl;
    this.queue = [];
    this.playing = false;
    this._timer = null;
  }

  say(lines) {
    if (!lines || !lines.length) return;
    this.queue.push(...lines);
    if (!this.playing) this._next();
  }

  _next() {
    if (!this.queue.length) {
      this.playing = false;
      this.panel.classList.add('hidden');
      return;
    }
    this.playing = true;
    this.panel.classList.remove('hidden');
    const line = this.queue.shift();
    this._type(line, () => {
      // hold the line, then advance
      const hold = Math.min(5200, 1400 + line.length * 45);
      this._timer = setTimeout(() => this._next(), hold);
    });
  }

  _type(line, done) {
    this.text.textContent = '';
    let i = 0;
    const tick = () => {
      this.text.textContent = line.slice(0, i++);
      if (i <= line.length) this._timer = setTimeout(tick, 18);
      else done();
    };
    tick();
  }

  clear() {
    clearTimeout(this._timer);
    this.queue.length = 0;
    this.playing = false;
    this.panel.classList.add('hidden');
  }
}
