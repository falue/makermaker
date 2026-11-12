import { execSync } from 'node:child_process';
import { createReadStream, readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';

// Python for the terminal: Pyodide's files served at pyodide/ (dev) and shipped with the app (build, so offline too).
const pyodide = (): Plugin => {
  const types: Record<string, string> = { 'pyodide.asm.mjs': 'text/javascript', 'pyodide.asm.wasm': 'application/wasm', 'python_stdlib.zip': 'application/zip', 'pyodide-lock.json': 'application/json' };
  const path = (file: string) => `node_modules/pyodide/${file}`;
  return {
    name: 'pyodide',
    configureServer(server) {
      server.middlewares.use('/pyodide/', (req, res, next) => {
        const file = req.url?.slice(1).split('?')[0] ?? '';
        if (!types[file]) return next();
        res.setHeader('Content-Type', types[file]);
        createReadStream(path(file)).pipe(res);
      });
    },
    generateBundle() {
      for (const file of Object.keys(types)) this.emitFile({ type: 'asset', fileName: `pyodide/${file}`, source: readFileSync(path(file)) });
    },
  };
};

// Lists every emitted file so the service worker can cache the whole app on install; cadmpeg (72 MB) is cached on first use.
const precache = (): Plugin => ({
  name: 'precache',
  apply: 'build',
  generateBundle(_, bundle) {
    this.emitFile({ type: 'asset', fileName: 'precache.json', source: JSON.stringify(['./', ...Object.keys(bundle).filter((f) => !/cadmpeg.*\.wasm$/.test(f))]) });
  },
});

// The version in the bottom bar: package.json's, then the commit count (counts up with every commit); hover: commit and date.
const version = (): Plugin => {
  const git = (args: string) => execSync(`git ${args}`, { encoding: 'utf8' }).trim();
  const own = JSON.parse(readFileSync('package.json', 'utf8')).version;
  return {
    name: 'version',
    transformIndexHtml: (html) => html.replace('%VERSION%', `v${own}-${git('rev-list --count HEAD')}`).replace('%COMMIT%', git('log -1 --format="%h, %cs"')),
  };
};

export default defineConfig({
  base: './',
  plugins: [pyodide(), precache(), version()],
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['replicad-opencascadejs', 'pyodide'] },
  build: { target: 'es2022' },
});
