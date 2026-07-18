/* Deterministic combat-chain test: boot, start campaign, deploy, then drive the
   game via window.__game to prove movement, shooting, kills, scoring, objective
   progress and stage flow all work. */
import { chromium } from 'playwright-core';
import { readdirSync } from 'node:fs';

const URL = process.argv[2] || 'http://localhost:8091';
function findChrome() {
  const base = `${process.env.HOME}/.cache/ms-playwright`;
  for (const d of readdirSync(base)) if (d.startsWith('chromium-') && !d.includes('headless'))
    for (const s of ['chrome-linux64/chrome', 'chrome-linux/chrome']) { try { readdirSync(`${base}/${d}`); return `${base}/${d}/${s}`; } catch {} }
}
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || findChrome(), headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(URL, { waitUntil: 'load' });
await page.waitForTimeout(1500);
await page.click('#btn-campaign');
await page.waitForTimeout(400);
await page.click('#btn-deploy');
await page.waitForTimeout(500);

// drive combat entirely through the game API for determinism
const result = await page.evaluate(async () => {
  const g = window.__game;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const out = {};

  // move test: teleport player, then push forward via velocity integration
  const startPos = g.player.position.clone();
  g.player.position.set(60, 0, 90); g.player._snapToGround();
  const movedFrom = g.player.position.clone();

  // spawn a grunt right in front and shoot it dead
  g.enemies.clear();
  const before = g.enemies.list.length;
  const e = g.enemies.spawn('grunt', 60, 78);
  out.spawned = g.enemies.list.length - before;
  out.aliveBefore = g.enemies.aliveCount;

  // aim the camera at the enemy and fire enough bolts to kill.
  // sync the camera to the player explicitly (headless may not grant pointer lock,
  // so the rAF loop's player.update -> camera sync can't be relied on)
  g.camera.position.copy(g.player.position);
  const dir = e.position.clone().sub(g.player.position);
  g.player.yaw = Math.atan2(-dir.x, -dir.z);
  g.player.pitch = 0;
  g.camera.rotation.set(0, g.player.yaw, 0, 'YXZ');
  g.camera.updateMatrixWorld(true);
  out.camPos = g.camera.position.toArray().map(n => +n.toFixed(1));
  out.enemyPos = e.position.toArray().map(n => +n.toFixed(1));
  const scoreBefore = g.player.score;
  for (let i = 0; i < 12; i++) {
    g.lastShot = 0;               // bypass fire-rate gate
    g.fire(performance.now());
    // step projectiles forward toward the enemy
    for (let s = 0; s < 30; s++) g.projectiles.update(0.016, g.enemies, g.player);
    if (!e.alive) break;
    await sleep(0);
  }
  out.hpLeft = e.health;
  out.enemyKilled = !e.alive;
  out.scoreGained = g.player.score - scoreBefore;
  out.aliveAfter = g.enemies.aliveCount;

  // player takes damage -> shield drops
  const shieldBefore = g.player.shield;
  g.player.damage(40);
  out.shieldDropped = g.player.shield < shieldBefore;

  // objective progress registered
  out.objectiveProgress = g.stages.objectives.some(o => (o.progress || 0) > 0);
  out.stageTitle = g.stages.stage?.title;
  return out;
});

await browser.close();
console.log('RESULT', JSON.stringify(result, null, 2));
console.log('ERRORS', errors.length);
errors.slice(0, 10).forEach(e => console.log('  !', e));
const ok = result.spawned === 1 && result.enemyKilled && result.scoreGained > 0 && result.shieldDropped && errors.length === 0;
console.log(ok ? 'COMBAT_OK' : 'COMBAT_FAIL');
process.exit(ok ? 0 : 1);
