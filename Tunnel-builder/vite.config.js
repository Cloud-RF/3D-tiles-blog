import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { compressGlb } from './dracoCompress.mjs'

// Vite dev-server middleware that performs Draco compression in Node,
// so the browser tab doesn't freeze while the asm.js encoder runs.
// Client POSTs raw (uncompressed) GLB bytes; we return Draco-compressed GLB.
function dracoCompressPlugin() {
  return {
    name: 'draco-compress',
    configureServer(server) {
      server.middlewares.use('/api/draco-compress', async (req, res, next) => {
        if (req.method !== 'POST') return next();
        try {
          const chunks = [];
          for await (const c of req) chunks.push(c);
          const out = await compressGlb(Buffer.concat(chunks));
          res.setHeader('Content-Type', 'model/gltf-binary');
          res.setHeader('Content-Length', out.byteLength);
          res.end(Buffer.from(out));
        } catch (err) {
          console.error('[draco-compress] failed:', err);
          res.statusCode = 500;
          res.setHeader('Content-Type', 'text/plain');
          res.end(err.message || 'Draco compression failed');
        }
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), dracoCompressPlugin()],
})
