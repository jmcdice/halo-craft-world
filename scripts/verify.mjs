/* Headless smoke test: boot the game, optionally drive it, capture console
   errors + a screenshot. Usage:
   node scripts/verify.mjs --url http://localhost:8091 --wait 4000 --out /tmp/x.png [--click-campaign] [--deploy] */
import { chromium } from 'playwright-core';
import { readdirSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => {
  if (v.startsWith('--')) a.push([v.slice(2), arr[i + 1]?.startsWith('--') || arr[i + 1] === undefined ? true : arr[i + 1]]);
  return a;
}, []));

const URL = args.url || 'http://localhost:8091';
const WAIT = Number(args.wait || 4000);
const OUT = args.out || '/tmp/hc-verify.png';

function findChrome() {
  const base = `${process.env.HOME}/.cache/ms-playwright`;
  for (const d of readdirSync(base)) {
    if (d.startsWith('chromium-') && !d.includes('headless')) {
      for (const sub of ['chrome-linux64/chrome', 'chrome-linux/chrome']) {
        const p = `${base}/${d}/${sub}`;
        try { readdirSync(`${base}/${d}`); return p; } catch {}
      }
    }
  }
  return process.env.PW_CHROMIUM;
}

const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM || findChrome(),
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [], logs = [];
page.on('console', m => { logs.push(`[${m.type()}] ${m.text()}`); if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

await page.goto(URL, { waitUntil: 'load', timeout: 30000 });
await page.waitForTimeout(1600);

if (args['click-campaign']) {
  await page.click('#btn-campaign').catch(() => {});
  await page.waitForTimeout(600);
}
if (args.deploy) {
  await page.click('#btn-deploy').catch(() => {});
  await page.waitForTimeout(400);
}
if (args.spawn) {
  await page.evaluate(() => {
    const g = window.__game;
    const p = g.player.position;
    g.enemies.spawn('grunt', p.x - 6, p.z - 18);
    g.enemies.spawn('elite', p.x + 20, p.z - 30);
    g.enemies.spawn('grunt', p.x - 40, p.z + 25);
  });
  await page.waitForTimeout(300);
}
await page.waitForTimeout(WAIT);

// probe the renderer state from the page
const probe = await page.evaluate(() => {
  const c = document.getElementById('scene');
  return { w: c?.width, h: c?.height, menuHidden: document.getElementById('menu')?.classList.contains('hidden') };
});

await page.screenshot({ path: OUT, timeout: 120000 });
await browser.close();

console.log('PROBE', JSON.stringify(probe));
console.log('ERRORS', errors.length);
errors.slice(0, 20).forEach(e => console.log('  !', e));
console.log('LOG_TAIL');
logs.slice(-12).forEach(l => console.log('  ' + l));
console.log('SCREENSHOT', OUT);
process.exit(errors.length ? 1 : 0);
