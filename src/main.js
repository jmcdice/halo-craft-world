import { Game } from './Game.js';
import { STAGES } from './campaign/stages.js';

/* Boot: build the game, reveal the menu, wire the buttons. */
const game = new Game();
window.__game = game;   // exposed for headless verification / debugging

const loading = document.getElementById('loading');
const menu = document.getElementById('menu');
const deployBtn = document.getElementById('btn-deploy');

// Build/version readout on the main menu (values injected by Vite at build time;
// see vite.config.js). Lets you tell at a glance whether you're on the latest build.
const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0';
const BUILD_COMMIT = typeof __BUILD_COMMIT__ !== 'undefined' ? __BUILD_COMMIT__ : 'dev';
const BUILD_DATE = typeof __BUILD_DATE__ !== 'undefined' ? __BUILD_DATE__ : '';
const versionEl = document.getElementById('game-version');
if (versionEl) {
  versionEl.textContent = `BUILD v${APP_VERSION} · ${BUILD_COMMIT}${BUILD_DATE ? ` · ${BUILD_DATE}` : ''}`;
}

// give the world a moment to build, then reveal the menu
setTimeout(() => {
  loading.classList.add('done');
  menu.classList.remove('hidden');
}, 900);

// first interaction is the browser's audio gesture: bring the choir in at the menu
menu.addEventListener('pointerdown', () => game.ambient.enable(), { once: true });

document.getElementById('btn-campaign').addEventListener('click', () => game.startCampaign());
document.getElementById('btn-skirmish').addEventListener('click', () => game.startSkirmish());

// mission select: jump straight into any stage's briefing
const missionRow = document.getElementById('mission-select');
STAGES.forEach((s, i) => {
  const b = document.createElement('button');
  b.className = 'btn btn-mission';
  b.innerHTML = `<b>${i + 1}</b>${s.title.toUpperCase()}`;
  b.addEventListener('click', () => game.startCampaign(i));
  missionRow.appendChild(b);
});

deployBtn.addEventListener('click', () => {
  if (game.hud._victory) { location.reload(); return; }
  game.stages.deploy();
});

// pause: releasing pointer lock during a stage shows a soft hint via cortana panel
document.addEventListener('pointerlockchange', () => {
  if (!document.pointerLockElement && game.running && game.stages.active) {
    game.hud.banner('PAUSED — CLICK TO RESUME');
  }
});
