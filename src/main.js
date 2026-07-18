import { Game } from './Game.js';

/* Boot: build the game, reveal the menu, wire the buttons. */
const game = new Game();
window.__game = game;   // exposed for headless verification / debugging

const loading = document.getElementById('loading');
const menu = document.getElementById('menu');
const deployBtn = document.getElementById('btn-deploy');

// give the world a moment to build, then reveal the menu
setTimeout(() => {
  loading.classList.add('done');
  menu.classList.remove('hidden');
}, 900);

document.getElementById('btn-campaign').addEventListener('click', () => game.startCampaign());
document.getElementById('btn-skirmish').addEventListener('click', () => game.startSkirmish());

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
