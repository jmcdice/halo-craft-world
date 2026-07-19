import { TouchControls } from './TouchControls.js';
import { GamepadControls } from './GamepadControls.js';

/* ============================================================
   Input — unified input surface for desktop and mobile.

   Desktop: pointer-lock mouse look + WASD (handled here).
   Mobile:  delegated to TouchControls (thumbstick, look drag,
            FIRE / JUMP / RELOAD buttons, drag-to-aim fire).

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

    if (mobile) this.touch = new TouchControls(canvas, this);
    else this._initDesktop();
    this.gamepad = new GamepadControls(this);   // works alongside either
  }

  pollGamepad(dt) { this.gamepad.poll(dt); }

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

  requestLock() { if (this.mobile) { this.locked = true; } else this.canvas.requestPointerLock?.(); }
  exitLock() { if (!this.mobile) document.exitPointerLock?.(); }

  down(code) { return this.keys.has(code); }

  consumeLook() { const x = this.lookX, y = this.lookY; this.lookX = 0; this.lookY = 0; return [x, y]; }
}
