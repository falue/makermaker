import { defineConfig, type Plugin } from 'vite';

// Lists every emitted file so the service worker can cache the whole app on install.
const precache = (): Plugin => ({
  name: 'precache',
  apply: 'build',
  generateBundle(_, bundle) {
    this.emitFile({ type: 'asset', fileName: 'precache.json', source: JSON.stringify(['./', ...Object.keys(bundle)]) });
  },
});

export default defineConfig({
  base: './',
  plugins: [precache()],
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['replicad-opencascadejs'] },
  build: { target: 'es2022' },
});
