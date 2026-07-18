/* ============================================================
   Input — keyboard state + pointer-lock mouse look.
   Emits look deltas via onLook; exposes held-key booleans.
   ============================================================ */

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.mouseDown = false;
    this.locked = false;
    this.lookX = 0; this.lookY = 0;   // accumulated deltas, consumed each frame
    this.sensitivity = 0.0022;

    addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      if (e.code === 'Space') e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));

    canvas.addEventListener('mousedown', (e) => { if (e.button === 0) this.mouseDown = true; });
    addEventListener('mouseup', (e) => { if (e.button === 0) this.mouseDown = false; });

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.lookX += e.movementX * this.sensitivity;
      this.lookY += e.movementY * this.sensitivity;
    });
  }

  requestLock() { this.canvas.requestPointerLock?.(); }
  exitLock() { document.exitPointerLock?.(); }

  down(code) { return this.keys.has(code); }

  /* consume and return accumulated look delta */
  consumeLook() {
    const x = this.lookX, y = this.lookY;
    this.lookX = 0; this.lookY = 0;
    return [x, y];
  }
}
