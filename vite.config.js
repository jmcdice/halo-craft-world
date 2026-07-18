import { defineConfig } from 'vite';

// Static SPA. `base: './'` keeps asset URLs relative so the built bundle works
// whether it is served from a domain root or a sub-path inside a container.
export default defineConfig({
  base: './',
  server: { host: true, port: 5173 },
  build: {
    target: 'es2020',
    outDir: 'dist',
    assetsInlineLimit: 0,
  },
});
