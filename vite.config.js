import { defineConfig } from 'vite';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';

// Content hashes of public/models/* for the game to ask for /models/<file>?v=<hash>.
// The server caches versioned model files for a year, so repeat visits load
// nothing, and an edited model gets a new URL. Dev builds get an empty map, so
// models load unversioned and uncached while the Model Workshop bakes them.
function modelVersions() {
  const id = 'virtual:model-versions', resolved = `\0${id}`;
  let build = false;
  return {
    name: 'model-versions',
    configResolved(c) { build = c.command === 'build'; },
    resolveId: (s) => (s === id ? resolved : null),
    load(s) {
      if (s !== resolved) return null;
      const map = {};
      if (build) {
        for (const f of readdirSync('public/models')) {
          map[f] = createHash('sha256').update(readFileSync(`public/models/${f}`)).digest('hex').slice(0, 12);
        }
      }
      return `export default ${JSON.stringify(map)};`;
    },
  };
}

// Dev: /net is proxied to the origin server (:8080, `npm start`) or, with
// NB_NET=http://127.0.0.1:8787, to the edge Worker under `wrangler dev`.
export default defineConfig({
  plugins: [modelVersions()],
  server: {
    port: 5173,
    proxy: {
      '/net': { target: process.env.NB_NET || 'http://127.0.0.1:8080', ws: true, changeOrigin: false },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: { manualChunks: (id) => (id.includes('node_modules/three') ? 'three' : undefined) },
    },
  },
});
