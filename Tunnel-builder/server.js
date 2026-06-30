// Production server: serves the built static site from /dist and exposes the
// same POST /api/draco-compress endpoint used in development.
//
// Usage:
//   npm run build      # produces /dist
//   npm start          # runs this server on PORT (default 3000)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compressGlb } from './dracoCompress.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(__dirname, 'dist');
const PORT = Number(process.env.PORT) || 3000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.mjs':  'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico':  'image/x-icon',
  '.glb':  'model/gltf-binary',
  '.wasm': 'application/wasm',
  '.map':  'application/json',
};

if (!fs.existsSync(DIST)) {
  console.error(`[server] No "dist" directory found at ${DIST}.`);
  console.error('[server] Run "npm run build" first.');
  process.exit(1);
}

const server = http.createServer(async (req, res) => {
  try {
    // API endpoint
    if (req.method === 'POST' && req.url === '/api/draco-compress') {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const out = await compressGlb(Buffer.concat(chunks));
      res.setHeader('Content-Type', 'model/gltf-binary');
      res.setHeader('Content-Length', out.byteLength);
      res.end(Buffer.from(out));
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.statusCode = 405;
      res.end('Method Not Allowed');
      return;
    }

    // Static file serving with path-traversal protection
    let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    if (urlPath.endsWith('/')) urlPath += 'index.html';
    let filePath = path.join(DIST, urlPath);
    const rel = path.relative(DIST, filePath);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      res.statusCode = 403;
      res.end('Forbidden');
      return;
    }

    // SPA fallback: unknown routes return index.html
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = path.join(DIST, 'index.html');
    }

    const ext = path.extname(filePath).toLowerCase();
    res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    console.error('[server] request failed:', err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'text/plain');
    }
    res.end(err.message || 'Internal Server Error');
  }
});

server.listen(PORT, () => {
  console.log(`tunnel-builder running on http://localhost:${PORT}`);
});
