/* ============================================================
   GamepadControls — Gamepad API support (Xbox / PlayStation /
   Switch Pro, USB or Bluetooth, desktop and iOS Safari alike).

   Polled once per frame from the game loop. Feeds the same
   shared Input surface as touch/keyboard, with "last active
   device wins" merging: the pad only writes a control while it
   is actually deflected/pressed, and only clears what it set —
   so touch and keyboard keep working alongside it.

   Standard mapping: left stick move · right stick look ·
   RT (or RB) fire · A jump · X reload · L3 or full-tilt sprint.

   aimFriction (set by Game each frame) slows the look rate when
   the crosshair is near a target — light sticky aim, the
   difference between miserable and pleasant stick aiming.
   ============================================================ */

const DEADZONE = 0.16;
const LOOK_SPEED = 3.0;       // rad/s at full deflection
const LOOK_Y_SCALE = 0.72;
const TRIGGER_ON = 0.35;

export class GamepadControls {
  constructor(input) {
    this.input = input;
    this.connected = false;
    this.onStatus = null;         // (message) => void, wired to a HUD toast
    this.aimFriction = 1;
    this._active = { move: false, fire: false, jump: false, sprint: false };
    this._reloadHeld = false;

    addEventListener('gamepadconnected', (e) => {
      this.connected = true;
      const name = (e.gamepad.id || 'GAMEPAD').split('(')[0].trim().toUpperCase();
      this.onStatus?.(`🎮 ${name} CONNECTED`);
    });
    addEventListener('gamepaddisconnected', () => {
      this.connected = false;
      this._releaseAll();
      this.onStatus?.('🎮 CONTROLLER DISCONNECTED');
    });
  }

  _pad() {
    const pads = navigator.getGamepads?.() || [];
    for (const p of pads) if (p && p.connected) return p;
    return null;
  }

  /* radial-ish deadzone + squared response: precise near center, fast at the edge */
  _curve(v) {
    const a = Math.abs(v);
    if (a < DEADZONE) return 0;
    const t = (a - DEADZONE) / (1 - DEADZONE);
    return Math.sign(v) * t * t * (3 - 2 * t);
  }

  /* write a shared flag only on our own edges, so we never clobber touch */
  _flag(name, now, apply) {
    if (now && !this._active[name]) { this._active[name] = true; apply(true); }
    else if (!now && this._active[name]) { this._active[name] = false; apply(false); }
  }

  _releaseAll() {
    const i = this.input;
    this._flag('move', false, () => { i.axisF = 0; i.axisS = 0; });
    this._flag('fire', false, (v) => i.mouseDown = v);
    this._flag('jump', false, (v) => i.jump = v);
    this._flag('sprint', false, (v) => i.sprint = v);
  }

  poll(dt) {
    const p = this._pad();
    if (!p) { if (this.connected) { this.connected = false; this._releaseAll(); } return; }
    this.connected = true;
    if (!this.input.locked) { this._releaseAll(); return; }   // menus/pause: hands off
    const i = this.input, ax = p.axes, b = p.buttons;

    // ---- move: left stick ----
    const ms = this._curve(ax[0] ?? 0), mf = this._curve(ax[1] ?? 0);
    const moving = ms !== 0 || mf !== 0;
    if (moving) { i.axisS = ms; i.axisF = -mf; this._active.move = true; }
    else this._flag('move', false, () => { i.axisS = 0; i.axisF = 0; });

    // ---- look: right stick, with sticky-aim friction ----
    const lx = this._curve(ax[2] ?? 0), ly = this._curve(ax[3] ?? 0);
    if (lx !== 0 || ly !== 0) {
      const f = LOOK_SPEED * dt * this.aimFriction;
      i.lookX += lx * f;
      i.lookY += ly * f * LOOK_Y_SCALE;
    }

    // ---- buttons ----
    const fire = (b[7]?.value ?? 0) > TRIGGER_ON || b[5]?.pressed === true;
    this._flag('fire', fire, (v) => i.mouseDown = v);
    this._flag('jump', b[0]?.pressed === true, (v) => i.jump = v);
    this._flag('sprint', b[10]?.pressed === true || Math.hypot(ms, mf) > 0.93, (v) => i.sprint = v);
    const rl = b[2]?.pressed === true;
    if (rl && !this._reloadHeld) i.onReload?.();
    this._reloadHeld = rl;
  }
}
