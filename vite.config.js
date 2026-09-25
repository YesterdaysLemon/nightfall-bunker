import { defineConfig } from 'vite';

// Dev: /net is proxied to the origin server (:8080, `npm start`) or, with
// NB_NET=http://127.0.0.1:8787, to the edge Worker under `wrangler dev`.
export default defineConfig({
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
