import * as THREE from 'three';
import { Radar } from './Radar.js';

/* ============================================================
   HUD — DOM-driven heads-up display: shields/health, weapon,
   objectives, score, damage flash, banners, stage briefing,
   victory screen, and on-screen objective waypoints.
   ============================================================ */

export class HUD {
  constructor(camera) {
    this.camera = camera;
    this.el = {
      hud: document.getElementById('hud'),
      shield: document.querySelector('#shield-bar i'),
      health: document.querySelector('#health-bar i'),
      weaponName: document.getElementById('weapon-name'),
      clip: document.getElementById('ammo-clip'),
      reserve: document.getElementById('ammo-reserve'),
      objectives: document.getElementById('objective-list'),
      score: document.getElementById('score-value'),
      flash: document.getElementById('flash'),
      banner: document.getElementById('banner'),
      briefing: document.getElementById('briefing'),
      bStage: document.getElementById('briefing-stage'),
      bTitle: document.getElementById('briefing-title'),
      bDesc: document.getElementById('briefing-desc'),
      bObjectives: document.getElementById('briefing-objectives'),
      menu: document.getElementById('menu'),
    };
    this.waypointEls = [];
    this.radar = new Radar(document.getElementById('radar'));
    this._v = new THREE.Vector3();
    this._lastHealth = 100;
    this._bannerTimer = null;
  }

  updateRadar(player, enemies, markers, dt) { this.radar.update(player, enemies, markers, dt); }

  showHud() { this.el.hud.classList.remove('hidden'); }
  hideHud() { this.el.hud.classList.add('hidden'); }
  hideMenu() { this.el.menu.classList.add('hidden'); }
  showMenu() { this.el.menu.classList.remove('hidden'); }

  showBriefing(n, title, subtitle, objectives) {
    this.el.bStage.textContent = `STAGE ${n}`;
    this.el.bTitle.textContent = title;
    this.el.bDesc.textContent = subtitle;
    this.el.bObjectives.innerHTML = objectives.map(o => `<li>${o}</li>`).join('');
    this.el.briefing.classList.remove('hidden');
    this.hideHud();
  }
  hideBriefing() { this.el.briefing.classList.add('hidden'); }

  setWeapon(name, clip, reserve) {
    this.el.weaponName.textContent = name;
    this.el.clip.textContent = clip;
    this.el.reserve.textContent = reserve;
  }
  setAmmo(clip, reserve) { this.el.clip.textContent = clip; this.el.reserve.textContent = reserve; }

  setObjectives(objectives, mode, score) {
    this.el.score.textContent = score;
    this.el.objectives.innerHTML = objectives.map(o => {
      const cls = o.done ? 'done' : (o.locked ? 'locked' : '');
      let prog = '';
      if (o.type === 'eliminate' || o.type === 'collect') prog = ` <b>${o.progress || 0}/${o.count}</b>`;
      const mark = o.done ? '✓' : (o.locked ? '🔒' : '▸');
      return `<li class="${cls}"><span class="mk">${mark}</span>${o.label}${prog}</li>`;
    }).join('');
  }

  banner(text) {
    this.el.banner.textContent = text;
    this.el.banner.classList.remove('hidden');
    this.el.banner.classList.add('show');
    clearTimeout(this._bannerTimer);
    this._bannerTimer = setTimeout(() => {
      this.el.banner.classList.remove('show');
      setTimeout(() => this.el.banner.classList.add('hidden'), 500);
    }, 2200);
  }

  showVictory(score) {
    this.banner('');
    this.el.bStage.textContent = 'CAMPAIGN COMPLETE';
    this.el.bTitle.textContent = 'The Ring Is Ours';
    this.el.bDesc.textContent = `Final score: ${score}`;
    this.el.bObjectives.innerHTML = '';
    this.el.briefing.classList.remove('hidden');
    document.getElementById('btn-deploy').textContent = 'RETURN TO MENU';
    this._victory = true;
    this.hideHud();
  }

  updatePlayer(player) {
    this.el.shield.style.width = `${(player.shield / player.maxShield) * 100}%`;
    this.el.health.style.width = `${(player.health / player.maxHealth) * 100}%`;
    // damage flash
    if (player.health < this._lastHealth || (player.shield < this._prevShield && player.health < player.maxHealth)) {
      this.el.flash.classList.add('hit');
      setTimeout(() => this.el.flash.classList.remove('hit'), 140);
    }
    this._lastHealth = player.health;
    this._prevShield = player.shield;
    // low shield vignette
    this.el.flash.classList.toggle('low', player.shield <= 0 && player.health < 45);
  }

  /* project world markers to screen; create/reuse DOM diamonds */
  updateWaypoints(markers, playerPos) {
    while (this.waypointEls.length < markers.length) {
      const d = document.createElement('div');
      d.className = 'waypoint';
      d.innerHTML = '<span class="wp-di"></span><span class="wp-lb"></span>';
      this.el.hud.appendChild(d);
      this.waypointEls.push(d);
    }
    for (let i = 0; i < this.waypointEls.length; i++) {
      const el = this.waypointEls[i];
      if (i >= markers.length) { el.style.display = 'none'; continue; }
      const m = markers[i];
      this._v.copy(m.pos).project(this.camera);
      const dist = Math.round(playerPos.distanceTo(m.pos));
      const behind = this._v.z > 1;
      let x = (this._v.x * 0.5 + 0.5) * innerWidth;
      let y = (-this._v.y * 0.5 + 0.5) * innerHeight;
      if (behind) { x = innerWidth - x; y = innerHeight - 40; }
      x = Math.max(30, Math.min(innerWidth - 30, x));
      y = Math.max(30, Math.min(innerHeight - 60, y));
      el.style.display = 'block';
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
      el.querySelector('.wp-lb').textContent = `${m.label} · ${dist}m`;
      const col = '#' + m.color.toString(16).padStart(6, '0');
      el.querySelector('.wp-di').style.background = col;
      el.querySelector('.wp-lb').style.color = col;
    }
  }
}
