import { defineConfig } from 'vite';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// Resolve build metadata so the in-game version readout reflects the exact
// deployed commit ("am I running the latest?"). Falls back gracefully when
// git or package.json aren't available.
function buildMeta() {
  let commit = 'unknown';
  try {
    commit = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch (err) {
    console.warn('vite.config: could not read git commit:', err.message);
  }
  let version = '0.0.0';
  try {
    version = JSON.parse(readFileSync(new URL('./package.json', import.meta.url))).version || version;
  } catch (err) {
    console.warn('vite.config: could not read package version:', err.message);
  }
  return { commit, version, date: new Date().toISOString().slice(0, 10) };
}

const { commit, version, date } = buildMeta();

// Static SPA. `base: './'` keeps asset URLs relative so the built bundle works
// whether it is served from a domain root or a sub-path inside a container.
export default defineConfig({
  base: './',
  server: { host: true, port: 5173 },
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __BUILD_COMMIT__: JSON.stringify(commit),
    __BUILD_DATE__: JSON.stringify(date),
  },
  build: {
    target: 'es2020',
    outDir: 'dist',
    assetsInlineLimit: 0,
  },
});
