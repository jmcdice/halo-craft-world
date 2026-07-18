/* Emulate an iPhone: verify touch controls appear, the thumbstick + look +
   fire drive the game, and it renders without errors. */
import { chromium } from 'playwright-core';
import { readdirSync } from 'node:fs';

const URL = process.argv[2] || 'http://localhost:8091';
function findChrome() {
  const base = `${process.env.HOME}/.cache/ms-playwright`;
  for (const d of readdirSync(base)) if (d.startsWith('chromium-') && !d.includes('headless'))
    for (const s of ['chrome-linux64/chrome', 'chrome-linux/chrome']) { try { readdirSync(`${base}/${d}`); return `${base}/${d}/${s}`; } catch {} }
}
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || findChrome(), headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
});
const page = await ctx.newPage();
await page.bringToFront();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(URL, { waitUntil: 'load' });
await page.waitForTimeout(1500);
await page.tap('#btn-campaign');
await page.waitForTimeout(400);
await page.tap('#btn-deploy');
await page.waitForTimeout(500);

const state = await page.evaluate(() => ({
  mobile: window.__game.mobile,
  locked: window.__game.input.locked,
  touchVisible: !document.getElementById('touch-controls').classList.contains('hidden'),
}));

// simulate a thumbstick drag (move forward) + a look drag + fire
const dispatch = async (type, id, x, y) => page.evaluate(({ type, id, x, y }) => {
  const c = document.getElementById('scene');
  c.dispatchEvent(new PointerEvent(type, { pointerId: id, clientX: x, clientY: y, bubbles: true, pointerType: 'touch' }));
}, { type, id, x, y });

await dispatch('pointerdown', 1, 80, 700);          // left half -> thumbstick
await dispatch('pointermove', 1, 80, 640);          // push up = forward
await dispatch('pointerdown', 2, 300, 400);         // right half -> look
await dispatch('pointermove', 2, 340, 400);         // drag look
await page.waitForTimeout(50);
const drivenAxis = await page.evaluate(() => ({ axisF: +window.__game.input.axisF.toFixed(2), lookQueued: window.__game.input.lookX !== 0 }));
const posBefore = await page.evaluate(() => window.__game.player.position.toArray());
await page.waitForTimeout(900);                       // let it walk
const after = await page.evaluate(() => ({ pos: window.__game.player.position.toArray(), axisF: +window.__game.input.axisF.toFixed(2) }));
const posAfter = after.pos;
const dist = Math.hypot(posAfter[0] - posBefore[0], posAfter[2] - posBefore[2]);
console.log('WALK dist', dist.toFixed(2), 'axisF after', after.axisF);
await dispatch('pointerup', 1, 80, 640);
await dispatch('pointerup', 2, 340, 400);

await page.screenshot({ path: '.verify-out/mobile.png', timeout: 120000 });
await browser.close();

const moved = dist > 0.5;
console.log('STATE', JSON.stringify(state), 'AXIS', JSON.stringify(drivenAxis), 'moved', moved);
console.log('ERRORS', errors.length); errors.slice(0, 8).forEach(e => console.log('  !', e));
const ok = state.touchVisible && state.locked && drivenAxis.axisF > 0.5 && moved && errors.length === 0;
console.log(ok ? 'MOBILE_OK' : 'MOBILE_FAIL');
process.exit(ok ? 0 : 1);
