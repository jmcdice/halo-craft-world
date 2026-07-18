/* ============================================================
   TouchControls — all mobile touch handling, feeding the shared
   Input surface (axisF/axisS, lookX/lookY, mouseDown, jump,
   sprint, onReload).

   Design:
   - Every pointer gets a role on pointerdown (stick | look) and
     keeps it until that pointer lifts; roles are tracked in a
     Map so stray/multi touches can never cross wires.
   - Left 45% of the screen summons a floating thumbstick with a
     deadzone, radial clamp, and sprint-at-the-rim hysteresis.
   - Anywhere else drags to look, with a mild flick boost so fast
     swipes turn further without making slow aim twitchy.
   - FIRE / JUMP use pointer capture: sliding off the button no
     longer drops the input. Dragging on FIRE also aims, so one
     right thumb can track a target while shooting.
   ============================================================ */

const STICK_MAX = 62;         // px knob travel
const DEADZONE = 0.14;
const SPRINT_ON = 0.92;       // rim engage / release hysteresis
const SPRINT_OFF = 0.78;

export class TouchControls {
  constructor(canvas, input) {
    this.input = input;
    this.canvas = canvas;

    // look sensitivity normalized to viewport size: the same thumb
    // sweep turns the same amount on any phone
    this._sensBase = 3.1;
    this._updateSens();
    addEventListener('resize', () => this._updateSens());

    this.stick = document.getElementById('tc-stick');
    this.knob = document.getElementById('tc-knob');

    this._roles = new Map();            // pointerId -> 'stick' | 'look'
    this._stickOrigin = { x: 0, y: 0 };
    this._lookLast = { x: 0, y: 0 };

    this._bindButtons();
    this._bindCanvas(canvas);
    for (const el of [canvas, document.getElementById('touch-controls')])
      el?.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  _updateSens() {
    // a full long-edge swipe ≈ 178° of turn, regardless of device size
    this._sens = this._sensBase / Math.max(innerWidth, innerHeight, 320);
  }

  /* look delta with a mild boost on fast flicks */
  _applyLook(dx, dy) {
    const boost = 1 + Math.min(Math.hypot(dx, dy) * 0.010, 0.7);
    this.input.lookX += dx * this._sens * boost;
    this.input.lookY += dy * this._sens * boost;
  }

  _bindButtons() {
    const held = (id, on, off) => {
      const el = document.getElementById(id);
      let owner = null;
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault(); e.stopPropagation();
        if (owner !== null) return;
        owner = e.pointerId;
        try { el.setPointerCapture?.(e.pointerId); } catch { /* synthetic pointer */ }
        el.classList.add('held');
        on(e);
      }, { passive: false });
      const release = (e) => {
        if (e.pointerId !== owner) return;
        owner = null;
        el.classList.remove('held');
        off(e);
      };
      el.addEventListener('pointerup', release);
      el.addEventListener('pointercancel', release);
      return el;
    };

    const fireBtn = held('tc-fire',
      () => { this.input.mouseDown = true; },
      () => { this.input.mouseDown = false; });
    // drag-to-aim while firing: the captured fire pointer also looks
    let fireLast = null;
    fireBtn.addEventListener('pointerdown', (e) => { fireLast = { x: e.clientX, y: e.clientY }; });
    fireBtn.addEventListener('pointermove', (e) => {
      if (!this.input.mouseDown || !fireLast) return;
      this._applyLook(e.clientX - fireLast.x, e.clientY - fireLast.y);
      fireLast = { x: e.clientX, y: e.clientY };
    });

    held('tc-jump',
      () => { this.input.jump = true; },
      () => { this.input.jump = false; });

    const reload = document.getElementById('tc-reload');
    reload.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      this.input.onReload?.();
    }, { passive: false });
  }

  _bindCanvas(c) {
    c.addEventListener('pointerdown', (e) => {
      const stickZone = e.clientX < innerWidth * 0.45;
      const hasStick = [...this._roles.values()].includes('stick');
      if (stickZone && !hasStick) {
        this._roles.set(e.pointerId, 'stick');
        this._stickOrigin = { x: e.clientX, y: e.clientY };
        this.stick.style.left = e.clientX + 'px';
        this.stick.style.top = e.clientY + 'px';
        this.stick.classList.add('active');
        this._moveKnob(0, 0);
      } else {
        this._roles.set(e.pointerId, 'look');
        this._lookLast = { x: e.clientX, y: e.clientY };
      }
    });

    c.addEventListener('pointermove', (e) => {
      const role = this._roles.get(e.pointerId);
      if (role === 'stick') this._stickMove(e);
      else if (role === 'look') {
        this._applyLook(e.clientX - this._lookLast.x, e.clientY - this._lookLast.y);
        this._lookLast = { x: e.clientX, y: e.clientY };
      }
    });

    const end = (e) => {
      const role = this._roles.get(e.pointerId);
      this._roles.delete(e.pointerId);
      if (role === 'stick') this._stickReset();
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
  }

  _stickMove(e) {
    let dx = e.clientX - this._stickOrigin.x, dy = e.clientY - this._stickOrigin.y;
    const len = Math.hypot(dx, dy);
    if (len > STICK_MAX) { dx *= STICK_MAX / len; dy *= STICK_MAX / len; }
    this._moveKnob(dx, dy);

    // radial deadzone, then remap the rest to 0..1
    const mag = Math.min(len / STICK_MAX, 1);
    const t = mag < DEADZONE ? 0 : (mag - DEADZONE) / (1 - DEADZONE);
    const scale = len > 1e-3 ? (t * STICK_MAX) / (mag * STICK_MAX) : 0;
    this.input.axisS = (dx / STICK_MAX) * scale;
    this.input.axisF = (-dy / STICK_MAX) * scale;

    // sprint at the rim, with hysteresis so it doesn't chatter
    if (!this.input.sprint && mag > SPRINT_ON) this.input.sprint = true;
    else if (this.input.sprint && mag < SPRINT_OFF) this.input.sprint = false;
    this.stick.classList.toggle('sprint', this.input.sprint);
  }

  _stickReset() {
    this.input.axisF = 0; this.input.axisS = 0; this.input.sprint = false;
    this.stick.classList.remove('active', 'sprint');
    this._moveKnob(0, 0);
  }

  _moveKnob(dx, dy) {
    if (this.knob) this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
  }
}
