/* Deterministic campaign set-piece test: drives all five stages through
   window.__game with manual stepping (the real-time loop is unreliable
   under software rendering). Covers: scripted zone/delay/objective events,
   dropship delivery lifecycle, deferred drone spawns, kill-credit tagging,
   defend-the-zone timers and waves, boss arrival/enrage/death, and the
   full stage progression to victory.
   Usage: node scripts/campaign-test.mjs [url] */
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
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(URL, { waitUntil: 'load' });
await page.waitForTimeout(1600);
await page.click('#btn-campaign');
await page.waitForTimeout(400);
await page.click('#btn-deploy');
await page.waitForTimeout(400);

/* helpers injected once */
await page.evaluate(() => {
  const g = window.__game;
  g.input.locked = true;
  let simTime = performance.now();
  // step the whole simulation deterministically
  window.__step = (frames, dt = 1 / 30) => {
    for (let i = 0; i < frames; i++) {
      simTime += dt * 1000;
      g.dropships.update(dt, simTime);
      g.enemies.update(dt, g.player, simTime);
      g.projectiles.update(dt, g.enemies, g.player);
      g.stages.update(dt, simTime);
    }
  };
  // run dropships until none are in flight (delivery complete)
  window.__flushShips = () => {
    let guard = 0;
    while (g.dropships.busy && guard++ < 1200) { simTime += 33; g.dropships.update(1 / 30, simTime); }
    return guard < 1200;
  };
  window.__killAll = (pred) => {
    for (const e of g.enemies.list) if (e.alive && (!pred || pred(e))) g.enemies.damage(e, 99999, g.player);
  };
  window.__tp = (x, z) => { g.player.position.set(x, 0, z); g.player._snapToGround(); g.player.dead = false; g.player.health = 100; g.player.shield = 100; };
});

const checks = {};
const ev = (fn) => page.evaluate(fn);
const dump = async (label) => console.log(label, JSON.stringify(await ev(() => ({
  stage: window.__game.stages.stage?.title,
  active: window.__game.stages.active,
  objs: window.__game.stages.objectives.map(o => ({ id: o.id, done: o.done, locked: !!o.locked, prog: o.progress || 0 })),
  alive: window.__game.enemies.aliveCount, ships: window.__game.dropships.list.length,
  playerDead: window.__game.player.dead,
}))));

/* ---------- STAGE 1: Landfall ---------- */
checks.s1_title = await ev(() => window.__game.stages.stage.title === 'Landfall');
// crash-landing cutscene: starts on deploy, plays out, leaves the pod behind
checks.s1_cutsceneStarts = await ev(() => {
  const g = window.__game;
  return !!g.cutscene && g.cutscene.done === false &&
    document.getElementById('cine').classList.contains('show');
});
checks.s1_cutsceneFinishes = await ev(() => {
  const g = window.__game;
  let guard = 0;
  while (g.cutscene && !g.cutscene.done && guard++ < 300) g.cutscene.update(0.1, performance.now() + guard * 100);
  return guard < 300 && g.cutscene?.done !== false &&
    !document.getElementById('cine').classList.contains('show');
});
checks.s1_crashPodRemains = await ev(() => {
  const props = window.__game.stages._cutsceneProps;
  return !!props && props.parent === window.__game.scene;
});
await ev(() => { window.__game.cutscene = null; });   // what the rAF loop would do
// drones are deferred until the dock is reached
checks.s1_dronesDeferred = await ev(() => window.__game.enemies.aliveCount === 0);
// walk into the midway ambush zone -> phantom event fires
await ev(() => {
  const g = window.__game, p = g.stages._anchor('midway_dock');
  window.__tp(p.x, p.z); window.__step(3);
});
checks.s1_ambushShipLaunched = await ev(() => window.__game.dropships.busy);
checks.s1_ambushDelivered = await ev(() => window.__flushShips() && window.__game.enemies.aliveCount === 2);
// ambush kills must NOT credit the drone objective (they're untagged? no — tagged credit:null -> 'none')
await ev(() => window.__killAll());
checks.s1_ambushKillsDontCredit = await ev(() =>
  (window.__game.stages.objectives.find(o => o.id === 'kill_drones')?.progress || 0) === 0);
// reach the dock -> reach completes, drones spawn airborne
await ev(() => { const g = window.__game, p = g.stages._anchor('dock'); window.__tp(p.x, p.z); window.__step(3); });
checks.s1_reachDone = await ev(() => window.__game.stages.objectives.find(o => o.id === 'reach_dock')?.done === true);
checks.s1_dronesSpawned = await ev(() => {
  const g = window.__game;
  const drones = g.enemies.list.filter(e => e.alive && e.type === 'drone');
  return drones.length === 3 && drones.every(e => e.objectiveId === 'kill_drones');
});
checks.s1_dronesAirborne = await ev(() => {
  const g = window.__game;
  window.__step(30);
  return g.enemies.list.filter(e => e.alive && e.type === 'drone')
    .every(e => e.position.y > g.world.heightAt(e.position.x, e.position.z) + 1.5);
});
// kill the drones -> stage 1 complete, auto-advances after 3.6s
await ev(() => { window.__killAll(e => e.type === 'drone'); });
checks.s1_complete = await ev(() => window.__game.stages.objectives.every(o => o.done));
await page.waitForTimeout(4200);

await page.click('#btn-deploy');
await page.waitForTimeout(300);
await dump('AFTER-S1:');
/* ---------- STAGE 2: Silent Shore ---------- */
checks.s2_title = await ev(() => window.__game.stages.stage.title === 'The Silent Shore');
// first half arrives by dropship at load
checks.s2_openingShip = await ev(() => window.__game.dropships.busy);
checks.s2_firstWave = await ev(() => window.__flushShips() && window.__game.enemies.aliveCount === 3);
// kill 2 -> reinforcement phantom brings the back half
await ev(() => {
  const g = window.__game;
  let n = 0;
  for (const e of g.enemies.list) { if (e.alive && n < 2) { g.enemies.damage(e, 99999, g.player); n++; } }
});
checks.s2_reinforceShip = await ev(() => window.__game.dropships.busy);
checks.s2_reinforced = await ev(() => window.__flushShips() && window.__game.enemies.aliveCount === 4);
await ev(() => window.__killAll());
checks.s2_complete = await ev(() => window.__game.stages.objectives.find(o => o.id === 'clear_shore')?.done === true);
await page.waitForTimeout(4200);

await page.click('#btn-deploy');
await page.waitForTimeout(300);
await dump('AFTER-S2:');
/* ---------- STAGE 3: Highlands (defend) ---------- */
checks.s3_title = await ev(() => window.__game.stages.stage.title === 'Into the Highlands');
checks.s3_defendLocked = await ev(() => window.__game.stages.objectives.find(o => o.id === 'hold_beacon')?.locked === true);
// reach the beacon -> defend activates with a zone ring
await ev(() => { const g = window.__game, p = g.stages._anchor('beacon'); window.__tp(p.x, p.z); window.__step(3); });
checks.s3_defendActive = await ev(() => {
  const o = window.__game.stages.objectives.find(o => o.id === 'hold_beacon');
  return !!o && o.locked === false && !!o.ring;
});
// timer ticks down inside the zone, pauses outside
const t0 = await ev(() => { window.__step(60); return window.__game.stages.objectives.find(o => o.id === 'hold_beacon').timer; });
checks.s3_timerTicks = t0 < 45;
checks.s3_wavesArrive = await ev(() => window.__game.dropships.busy || window.__game.enemies.aliveCount > 0);
const tPause = await ev(() => {
  const g = window.__game, o = g.stages.objectives.find(o => o.id === 'hold_beacon');
  window.__tp(o.pos.x + 60, o.pos.z); const before = o.timer;
  window.__step(30);
  window.__tp(o.pos.x, o.pos.z);          // step back in
  return [before, o.timer];
});
checks.s3_timerPausesOutside = Math.abs(tPause[0] - tPause[1]) < 0.01;
// fast-forward the hold (clear the field + revive first: a dead player pauses the timer)
await ev(() => {
  const g = window.__game, o = g.stages.objectives.find(o => o.id === 'hold_beacon');
  window.__flushShips(); window.__killAll();
  window.__tp(o.pos.x, o.pos.z);
  o.timer = 0.5; window.__step(30);
});
checks.s3_complete = await ev(() => window.__game.stages.objectives.every(o => o.done));
await page.waitForTimeout(4200);

await page.click('#btn-deploy');
await page.waitForTimeout(300);
await dump('AFTER-S3:');
/* ---------- STAGE 4: The Pass (mountains) ---------- */
checks.s4_title = await ev(() => window.__game.stages.stage.title === 'The Pass');
checks.s4_radiusOpened = await ev(() => window.__game.world.playRadius > 250);
checks.s4_summitIsHigh = await ev(() => {
  const g = window.__game, p = g.stages._anchor('pass');
  return Math.hypot(p.x, p.z) > 200 && g.world.heightAt(p.x, p.z) > 20;
});
// climb to the ridge: zone ambush (2 drones) + reach objective + summit guard phantom
await ev(() => { const g = window.__game, p = g.stages._anchor('ridge'); window.__tp(p.x, p.z); window.__step(3); });
checks.s4_ridgeReached = await ev(() => window.__game.stages.objectives.find(o => o.id === 'reach_ridge')?.done === true);
checks.s4_summitShips = await ev(() => window.__game.dropships.busy);
checks.s4_summitGuardArrives = await ev(() => {
  window.__flushShips();
  const g = window.__game;
  const tagged = g.enemies.list.filter(e => e.alive && e.objectiveId === 'pass_patrol');
  return tagged.length === 5 && g.enemies.aliveCount === 7;   // 5 guard + 2 ambush drones
});
checks.s4_relayLocked = await ev(() => window.__game.stages.objectives.find(o => o.id === 'light_relay')?.locked === true);
await ev(() => window.__killAll());
checks.s4_patrolCleared = await ev(() => window.__game.stages.objectives.find(o => o.id === 'pass_patrol')?.done === true);
checks.s4_relayUnlocked = await ev(() => window.__game.stages.objectives.find(o => o.id === 'light_relay')?.locked === false);
await ev(() => {
  const g = window.__game, o = g.stages.objectives.find(o => o.id === 'light_relay');
  for (let tries = 0; tries < 4 && !o.done; tries++) { window.__tp(o.pos.x, o.pos.z); window.__step(5); }
});
checks.s4_complete = await ev(() => window.__game.stages.objectives.every(o => o.done));
await page.waitForTimeout(4200);

await page.click('#btn-deploy');
await page.waitForTimeout(300);
await dump('AFTER-S4:');
/* ---------- STAGE 5: Cartographer (boss) ---------- */
checks.s5_title = await ev(() => window.__game.stages.stage.title === 'The Cartographer');
checks.s5_radiusRestored = await ev(() => window.__game.world.playRadius === 165);
checks.s5_coresGuarded = await ev(() => window.__game.enemies.aliveCount === 6);   // 3 cores × 2 guards
checks.s5_bossDeferred = await ev(() => window.__game.stages.boss === null);
// clear guards, then collect all three cores
await ev(() => { window.__killAll(); });
checks.s5_guardsNoCredit = await ev(() => {
  const o = window.__game.stages.objectives.find(o => o.id === 'boss');
  return !!o && (o.progress || 0) === 0;
});
await ev(() => {
  const g = window.__game;
  for (const c of g.stages.collectibles) { window.__tp(c.pos.x, c.pos.z); window.__step(2); }
});
checks.s5_coresDone = await ev(() => window.__game.stages.objectives.find(o => o.id === 'cores')?.done === true);
// the Field Marshal arrives by phantom
checks.s5_bossShip = await ev(() => window.__game.dropships.busy);
checks.s5_bossArrived = await ev(() => {
  window.__flushShips();
  const b = window.__game.stages.boss;
  return !!b && b.isBoss === true && b.maxHealth === 320;
});
checks.s5_bossBarShown = await ev(() => !document.getElementById('hud-boss').classList.contains('hidden'));
// damage to half -> enrage + summons
checks.s5_enrage = await ev(() => {
  const g = window.__game, b = g.stages.boss;
  g.enemies.damage(b, b.maxHealth * 0.5 + 5, g.player);
  window.__step(3);
  return b._enraged === true && g.dropships.busy;   // summon phantom launched
});
// kill the boss -> bar hides, activate unlocks; walk to console -> victory
await ev(() => {
  const g = window.__game;
  window.__flushShips(); window.__killAll();
});
checks.s5_bossDead = await ev(() => {
  const g = window.__game;
  return g.stages.objectives.find(o => o.id === 'boss').done === true &&
    document.getElementById('hud-boss').classList.contains('hidden');
});
checks.s5_activateUnlocked = await ev(() => window.__game.stages.objectives.find(o => o.id === 'activate')?.locked === false);
await ev(() => {
  const g = window.__game, o = g.stages.objectives.find(o => o.id === 'activate');
  // a pending respawn timer can yank the player away between evals; retry until it sticks
  for (let tries = 0; tries < 4 && !o.done; tries++) { window.__tp(o.pos.x, o.pos.z); window.__step(5); }
});
await dump('PRE-VICTORY:');
// the outro timer can land late when slow render frames block the event loop — poll, don't race it
checks.s5_victory = await page.waitForFunction(() => window.__game.hud._victory === true, null, { timeout: 20000 })
  .then(() => true).catch(() => false);
await dump('END:');

console.log(JSON.stringify(checks, null, 1));
console.log('ERRORS', errors.length); errors.slice(0, 10).forEach(e => console.log('  !', e));
await browser.close();
const ok = Object.values(checks).every(v => v === true) && errors.length === 0;
console.log(ok ? 'CAMPAIGN_OK' : 'CAMPAIGN_FAIL');
process.exit(ok ? 0 : 1);
