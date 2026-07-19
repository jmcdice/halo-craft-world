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
    this._btnOwners = new Map();        // pointerId -> clear() for a held button
    this._stickOrigin = { x: 0, y: 0 };
    this._lookLast = { x: 0, y: 0 };
    this._stickStamp = 0;               // last time the stick pointer spoke

    this._bindButtons();
    this._bindCanvas(canvas);
    this._bindGlobalRelease();
    for (const el of [canvas, document.getElementById('touch-controls')])
      el?.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /* ---- robustness against lost pointer releases ------------------------
     iOS can deliver a finger's final pointerup elsewhere — or not at all
     (system gestures, edge swipes, app switches, pointerId reuse). Without
     a safety net a role never clears: the stick freezes at its last value
     (drifting, often walking backward) and new left-side touches get
     misread as look. So we sweep releases at the window in the capture
     phase, and fully reset when focus/visibility is lost. */
  _bindGlobalRelease() {
    const sweep = (e) => this._end(e.pointerId);
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture'])
      window.addEventListener(ev, sweep, { capture: true });
    const reset = () => this.resetAll();
    window.addEventListener('blur', reset);
    window.addEventListener('pagehide', reset);
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.resetAll(); });
  }

  /* clear whatever a single pointer owned (canvas role and/or button) */
  _end(pointerId) {
    const role = this._roles.get(pointerId);
    if (role) { this._roles.delete(pointerId); if (role === 'stick') this._stickReset(); }
    const clearBtn = this._btnOwners.get(pointerId);
    if (clearBtn) { this._btnOwners.delete(pointerId); clearBtn(); }
  }

  /* clear ALL touch state — used on blur / backgrounding */
  resetAll() {
    for (const role of this._roles.values()) if (role === 'stick') this._stickReset();
    this._roles.clear();
    for (const clearBtn of this._btnOwners.values()) clearBtn();
    this._btnOwners.clear();
    this.input.mouseDown = false;
    this.input.jump = false;
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
      const clear = () => { if (owner === null) return; owner = null; el.classList.remove('held'); off(); };
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault(); e.stopPropagation();
        if (owner !== null) return;
        owner = e.pointerId;
        try { el.setPointerCapture?.(e.pointerId); } catch { /* synthetic pointer */ }
        // register so the global release sweep / reset can also clear it
        this._btnOwners.set(e.pointerId, clear);
        el.classList.add('held');
        on(e);
      }, { passive: false });
      const release = (e) => {
        if (e.pointerId !== owner) return;
        this._btnOwners.delete(e.pointerId);
        clear();
      };
      el.addEventListener('pointerup', release);
      el.addEventListener('pointercancel', release);
      el.addEventListener('lostpointercapture', release);
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
      // stale-id recovery: if this pointerId is somehow still assigned
      // (reuse after a lost release), clear its old role first.
      if (this._roles.has(e.pointerId)) this._end(e.pointerId);

      const stickZone = e.clientX < innerWidth * 0.45;
      let hasStick = [...this._roles.values()].includes('stick');
      // last-resort backstop: iOS never reuses pointerIds, so a truly
      // dropped pointerup leaves a stick no sweep can clear. A stick that
      // has been silent for 2s is dead — the player's natural re-grab tap
      // in the stick zone steals it.
      if (stickZone && hasStick && performance.now() - this._stickStamp > 2000) {
        for (const [id, r] of [...this._roles]) if (r === 'stick') this._end(id);
        hasStick = false;
      }
      // capture on the canvas so this pointer's moves/up reliably return here
      try { c.setPointerCapture?.(e.pointerId); } catch { /* synthetic */ }
      if (stickZone && !hasStick) {
        this._stickStamp = performance.now();
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

    // local canvas release; the window-level sweep also covers this so a
    // release delivered off-canvas still clears the role.
    const end = (e) => this._end(e.pointerId);
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
  }

  _stickMove(e) {
    this._stickStamp = performance.now();
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
