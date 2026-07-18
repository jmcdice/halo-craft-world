/* ============================================================
   Radar — Halo-style circular motion tracker. Player sits at
   the centre facing "up"; enemies and objectives show as blips
   rotated into the player's frame, with a slow sweep line.
   ============================================================ */

const RANGE = 80;      // metres mapped to the tracker radius

export class Radar {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.size = 168;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = this.size * dpr;
    canvas.height = this.size * dpr;
    canvas.style.width = canvas.style.height = this.size + 'px';
    this.ctx.scale(dpr, dpr);
    this.sweep = 0;
  }

  update(player, enemies, markers, dt) {
    const ctx = this.ctx, S = this.size, c = S / 2, R = c - 6;
    this.sweep = (this.sweep + dt * 1.6) % (Math.PI * 2);
    ctx.clearRect(0, 0, S, S);

    // ---- frame ----
    ctx.save();
    ctx.beginPath(); ctx.arc(c, c, R, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(6,14,20,0.55)'; ctx.fill();
    ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(143,252,255,0.5)'; ctx.stroke();
    ctx.clip();

    // range rings + crosshair
    ctx.strokeStyle = 'rgba(143,252,255,0.16)'; ctx.lineWidth = 1;
    for (const rr of [R * 0.33, R * 0.66]) { ctx.beginPath(); ctx.arc(c, c, rr, 0, Math.PI * 2); ctx.stroke(); }
    ctx.beginPath(); ctx.moveTo(c, c - R); ctx.lineTo(c, c + R);
    ctx.moveTo(c - R, c); ctx.lineTo(c + R, c); ctx.stroke();

    // sweep wedge
    const grad = ctx.createConicGradient ? ctx.createConicGradient(-this.sweep - Math.PI / 2, c, c) : null;
    if (grad) {
      grad.addColorStop(0, 'rgba(143,252,255,0.28)');
      grad.addColorStop(0.08, 'rgba(143,252,255,0.0)');
      grad.addColorStop(1, 'rgba(143,252,255,0.0)');
      ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(c, c, R, 0, Math.PI * 2); ctx.fill();
    }

    // ---- player frame vectors (forward = up) ----
    const yaw = player.yaw;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);   // forward
    const rx = -Math.cos(yaw), rz = Math.sin(yaw);    // right
    const scale = R / RANGE;

    const plot = (wx, wz, color, size, pulse = false) => {
      const dx = wx - player.position.x, dz = wz - player.position.z;
      let bx = (dx * rx + dz * rz), by = (dx * fx + dz * fz);
      const dist = Math.hypot(bx, by);
      let px, py, edge = false;
      if (dist > RANGE) { const k = RANGE / dist; bx *= k; by *= k; edge = true; }
      px = c + bx * scale; py = c - by * scale;
      ctx.beginPath();
      if (edge) { ctx.globalAlpha = 0.5; ctx.arc(px, py, size * 0.7, 0, Math.PI * 2); }
      else {
        ctx.globalAlpha = 1;
        if (pulse) { const p = 0.6 + 0.4 * Math.sin(this.sweep * 3); ctx.globalAlpha = p; }
        ctx.arc(px, py, size, 0, Math.PI * 2);
      }
      ctx.fillStyle = color; ctx.fill(); ctx.globalAlpha = 1;
    };

    // enemies
    for (const e of enemies.list) {
      if (!e.alive) continue;
      if (e.isBoss) plot(e.position.x, e.position.z, '#ff2a2a', 5.5, true);
      else plot(e.position.x, e.position.z, e.type === 'elite' ? '#ff5a4a' : '#ff9a3c', 4);
    }
    // objective markers
    for (const m of markers) plot(m.pos.x, m.pos.z, '#' + m.color.toString(16).padStart(6, '0'), 3.5, true);

    ctx.restore();

    // player chevron at centre (always drawn on top, unclipped)
    ctx.save();
    ctx.translate(c, c);
    ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(4.5, 5); ctx.lineTo(0, 2.5); ctx.lineTo(-4.5, 5); ctx.closePath();
    ctx.fillStyle = '#eaf6ff'; ctx.fill();
    ctx.restore();
  }
}
