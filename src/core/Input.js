/* ============================================================
   Input — unified desktop + touch input.

   Desktop: pointer-lock mouse look + WASD.
   Mobile:  left-half thumbstick (analog move), right-half drag
            to look, and on-screen FIRE / JUMP / RELOAD buttons.

   Player/Game read a common surface: down(code), consumeLook(),
   analog axisF/axisS, plus jump/sprint/mouseDown flags.
   ============================================================ */

export class Input {
  constructor(canvas, mobile) {
    this.canvas = canvas;
    this.mobile = mobile;
    this.keys = new Set();
    this.mouseDown = false;       // fire
    this.locked = false;
    this.lookX = 0; this.lookY = 0;
    this.sensitivity = 0.0022;

    // analog / virtual (mobile)
    this.axisF = 0; this.axisS = 0;
    this.jump = false; this.sprint = false;
    this.onReload = null;

    if (mobile) this._initTouch();
    else this._initDesktop();
  }

  _initDesktop() {
    addEventListener('keydown', (e) => { this.keys.add(e.code); if (e.code === 'Space') e.preventDefault(); });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    this.canvas.addEventListener('mousedown', (e) => { if (e.button === 0) this.mouseDown = true; });
    addEventListener('mouseup', (e) => { if (e.button === 0) this.mouseDown = false; });
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === this.canvas; });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.lookX += e.movementX * this.sensitivity;
      this.lookY += e.movementY * this.sensitivity;
    });
  }

  _initTouch() {
    this.touchSens = 0.004;
    this._jId = null; this._lId = null;
    this._jOrigin = { x: 0, y: 0 };
    this._lLast = { x: 0, y: 0 };

    this.stick = document.getElementById('tc-stick');
    this.knob = document.getElementById('tc-knob');

    const fireBtn = document.getElementById('tc-fire');
    const jumpBtn = document.getElementById('tc-jump');
    const reloadBtn = document.getElementById('tc-reload');
    const hold = (el, on, off) => {
      el.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); on(); }, { passive: false });
      el.addEventListener('pointerup', (e) => { e.stopPropagation(); off(); });
      el.addEventListener('pointercancel', off);
      el.addEventListener('pointerleave', off);
    };
    hold(fireBtn, () => this.mouseDown = true, () => this.mouseDown = false);
    hold(jumpBtn, () => this.jump = true, () => this.jump = false);
    reloadBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); this.onReload?.(); }, { passive: false });

    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => {
      if (e.clientX < innerWidth * 0.42 && this._jId === null) {
        this._jId = e.pointerId; this._jOrigin = { x: e.clientX, y: e.clientY };
        this.stick.style.left = e.clientX + 'px'; this.stick.style.top = e.clientY + 'px';
        this.stick.classList.add('active'); this._moveKnob(0, 0);
      } else if (this._lId === null) {
        this._lId = e.pointerId; this._lLast = { x: e.clientX, y: e.clientY };
      }
    });
    c.addEventListener('pointermove', (e) => {
      if (e.pointerId === this._jId) {
        let dx = e.clientX - this._jOrigin.x, dy = e.clientY - this._jOrigin.y;
        const len = Math.hypot(dx, dy), max = 62;
        if (len > max) { dx *= max / len; dy *= max / len; }
        this._moveKnob(dx, dy);
        this.axisS = dx / max; this.axisF = -dy / max;
        this.sprint = len > max * 0.85;
      } else if (e.pointerId === this._lId) {
        this.lookX += (e.clientX - this._lLast.x) * this.touchSens;
        this.lookY += (e.clientY - this._lLast.y) * this.touchSens;
        this._lLast = { x: e.clientX, y: e.clientY };
      }
    });
    const end = (e) => {
      if (e.pointerId === this._jId) {
        this._jId = null; this.axisF = 0; this.axisS = 0; this.sprint = false;
        this.stick.classList.remove('active'); this._moveKnob(0, 0);
      } else if (e.pointerId === this._lId) { this._lId = null; }
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
  }

  _moveKnob(dx, dy) { if (this.knob) this.knob.style.transform = `translate(${dx}px, ${dy}px)`; }

  requestLock() { if (this.mobile) { this.locked = true; } else this.canvas.requestPointerLock?.(); }
  exitLock() { if (!this.mobile) document.exitPointerLock?.(); }

  down(code) { return this.keys.has(code); }

  consumeLook() { const x = this.lookX, y = this.lookY; this.lookX = 0; this.lookY = 0; return [x, y]; }
}
