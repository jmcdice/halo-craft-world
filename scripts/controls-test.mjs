/* Deterministic mobile-controls + spawn-clearance test.

   The real-time loop can't be trusted under software rendering, so this
   drives DOM pointer events for input assertions and steps player/enemy
   updates manually for movement/collision assertions.
   Usage: node scripts/controls-test.mjs [url] */
import { chromium } from 'playwright-core';
import { readdirSync } from 'node:fs';

const URL = process.argv[2] || 'http://localhost:8091';
function findChrome() {
  const base = `${process.env.HOME}/.cache/ms-playwright`;
  try {
    for (const d of readdirSync(base)) if (d.startsWith('chromium-') && !d.includes('headless'))
      for (const s of ['chrome-linux64/chrome', 'chrome-linux/chrome']) { try { readdirSync(`${base}/${d}`); return `${base}/${d}/${s}`; } catch {} }
  } catch {}
}
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || findChrome(), headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const ctx = await browser.newContext({
  viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(URL, { waitUntil: 'load' });
await page.waitForTimeout(1600);
await page.tap('#btn-campaign');
await page.waitForTimeout(400);
await page.tap('#btn-deploy');
await page.waitForTimeout(400);

const pev = (el, type, id, x, y) => page.evaluate(({ el, type, id, x, y }) => {
  document.getElementById(el).dispatchEvent(new PointerEvent(type, {
    pointerId: id, clientX: x, clientY: y, bubbles: true, pointerType: 'touch', isPrimary: id === 1 }));
}, { el, type, id, x, y });

const input = () => page.evaluate(() => {
  const i = window.__game.input;
  return { axisF: +i.axisF.toFixed(3), axisS: +i.axisS.toFixed(3), sprint: i.sprint,
    fire: i.mouseDown, jump: i.jump, lookX: +i.lookX.toFixed(4), lookY: +i.lookY.toFixed(4) };
});

const checks = {};
checks.mobileDetected = await page.evaluate(() => window.__game.mobile === true);
checks.touchVisible = await page.evaluate(() => !document.getElementById('touch-controls').classList.contains('hidden'));

// ---- thumbstick: deadzone, drive, sprint hysteresis ----
await pev('scene', 'pointerdown', 1, 120, 300);
await pev('scene', 'pointermove', 1, 120, 295);              // 5px << deadzone
checks.deadzone = (await input()).axisF === 0;
await pev('scene', 'pointermove', 1, 120, 250);              // 50px up ≈ 0.8 forward
let s = await input();
checks.stickForward = s.axisF > 0.5 && Math.abs(s.axisS) < 0.05 && !s.sprint;
await pev('scene', 'pointermove', 1, 120, 230);              // 70px: past rim -> sprint
s = await input();
checks.sprintOn = s.sprint && s.axisF > 0.95;
await pev('scene', 'pointermove', 1, 120, 248);              // back to ~0.84 mag: hysteresis holds
checks.sprintHysteresis = (await input()).sprint === true;
await pev('scene', 'pointermove', 1, 120, 265);              // ~0.56 mag: below release
checks.sprintOff = (await input()).sprint === false;

// ---- look drag on the right side, while the stick is still held ----
await pev('scene', 'pointerdown', 2, 600, 200);
await pev('scene', 'pointermove', 2, 640, 190);
s = await input();
checks.lookQueued = s.lookX > 0 && s.lookY < 0;
checks.stickSurvivedLook = s.axisF > 0.3;                     // roles don't cross wires
await pev('scene', 'pointerup', 2, 640, 190);

// ---- movement: step the simulation manually with the stick held ----
const dist = await page.evaluate(() => {
  const g = window.__game;
  g.input.locked = true;
  const from = g.player.position.clone();
  for (let i = 0; i < 90; i++) g.player.update(1 / 60);
  return Math.hypot(g.player.position.x - from.x, g.player.position.z - from.z);
});
checks.stickMovesPlayer = dist > 2;

// ---- strafe direction: facing -Z, thumb-right must move +X (camera-right) ----
checks.strafeNotMirrored = await page.evaluate(() => {
  const g = window.__game;
  g.player.position.set(60, 0, 90); g.player._snapToGround();
  g.player.yaw = 0; g.player.pitch = 0;
  const x0 = g.player.position.x;
  const prev = g.input.axisS; g.input.axisS = 1;
  for (let i = 0; i < 30; i++) g.player.update(1 / 60);
  g.input.axisS = prev;
  return g.player.position.x - x0 > 1;
});
await pev('scene', 'pointerup', 1, 120, 265);
s = await input();
checks.stickReleased = s.axisF === 0 && s.axisS === 0;

// ---- fire button: hold + drag-to-aim, release ----
await pev('tc-fire', 'pointerdown', 3, 780, 250);
s = await input();
checks.firePressed = s.fire === true;
const lookBefore = s.lookX;
await pev('tc-fire', 'pointermove', 3, 800, 250);             // drag while firing = aim
s = await input();
checks.fireDragAims = s.lookX > lookBefore;
await pev('tc-fire', 'pointerup', 3, 800, 250);
checks.fireReleased = (await input()).fire === false;

// ---- jump button ----
await pev('tc-jump', 'pointerdown', 4, 700, 330);
checks.jumpPressed = (await input()).jump === true;
await pev('tc-jump', 'pointerup', 4, 700, 330);
checks.jumpReleased = (await input()).jump === false;

// ---- spawn clearance: no enemy may materialize inside a tree/rock ----
const spawns = await page.evaluate(() => {
  const g = window.__game, w = g.world;
  g.enemies.clear();
  const anchors = [[0, 0], [76, 104], [-60, 80], [40, -90], [-100, -40]];
  let bad = 0, total = 0, inWater = 0;
  for (const [ax, az] of anchors) for (let i = 0; i < 40; i++) {
    const type = i % 4 === 0 ? 'elite' : 'grunt';
    const e = g.enemies.spawnNear(type, ax, az, 10, 60);
    total++;
    if (!w.isClear(e.position.x, e.position.z, e.radius)) bad++;
    if (w.heightAt(e.position.x, e.position.z) < 0.3) inWater++;
  }
  // and enemies pushed by AI must slide around trunks, not through them
  let clipped = 0;
  for (let step = 0; step < 120; step++) g.enemies.update(1 / 30, g.player, performance.now() + step * 33);
  for (const e of g.enemies.list) {
    if (!e.alive) continue;
    for (const o of w.obstacles.items) {
      if (o.rCol <= 0) continue;
      const dx = e.position.x - o.x, dz = e.position.z - o.z;
      if (Math.hypot(dx, dz) < o.rCol + e.radius - 0.05) { clipped++; break; }
    }
  }
  g.enemies.clear();
  return { total, bad, inWater, clipped, obstacles: w.obstacles.items.length };
});
checks.spawnsClearOfTrees = spawns.bad === 0;
checks.spawnsOnLand = spawns.inWater === 0;
checks.enemiesDontClipTrunks = spawns.clipped === 0;
checks.obstaclesRegistered = spawns.obstacles > 1000;

// ---- player can't walk through a trunk ----
checks.playerBlockedByTrunk = await page.evaluate(() => {
  const g = window.__game, w = g.world;
  const o = w.obstacles.items.find(o => o.rCol > 0.3 && w.heightAt(o.x, o.z) > 1);
  if (!o) return false;
  g.player.position.set(o.x - o.rCol - 1.2, 0, o.z);
  g.player._snapToGround();
  g.player.yaw = Math.atan2(-(o.x - g.player.position.x), -(o.z - g.player.position.z));
  g.input.keys.add?.('KeyW');
  const prevAxis = g.input.axisF; g.input.axisF = 1;
  for (let i = 0; i < 90; i++) g.player.update(1 / 60);
  g.input.axisF = prevAxis;
  const d = Math.hypot(g.player.position.x - o.x, g.player.position.z - o.z);
  return d >= o.rCol + 0.45;   // stopped at the body, not inside it
});

console.log(JSON.stringify({ ...checks, spawnStats: spawns }, null, 1));
console.log('ERRORS', errors.length); errors.slice(0, 8).forEach(e => console.log('  !', e));
await browser.close();
const ok = Object.entries(checks).every(([, v]) => v === true) && errors.length === 0;
console.log(ok ? 'CONTROLS_OK' : 'CONTROLS_FAIL');
process.exit(ok ? 0 : 1);
