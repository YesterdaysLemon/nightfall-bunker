// Production web server for the VPS container: serves the built client,
// /healthz for Deploy Manager, and a single-region in-memory copy of the
// lobby API. In production Cloudflare routes /net/* to the edge Worker first;
// this copy serves local development and acts as a fallback origin.

import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { createReadStream, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { WebSocketServer } from 'ws';
import { MatchRoom, PartyRoom } from '../src/net/rooms.js';
import { randomCode, chooseRegion } from '../src/shared/protocol.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';
const REGION = 'origin';
const BUILD = (() => {
  try { return JSON.parse(readFileSync(path.join(dist, 'build.json'), 'utf8')); } catch { return { sha: process.env.GIT_SHA || 'dev' }; }
})();

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2',
};

const CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com", "img-src 'self' data: blob:", "connect-src 'self'",
  "media-src 'self' blob:", "object-src 'none'", "base-uri 'none'", "frame-ancestors 'self' https://claude.ai",
].join('; ');

const parties = new Map();
const matches = new Map();

function json(res, status, body, extra = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra });
  res.end(JSON.stringify(body));
}

function newParty(isPublic) {
  let code;
  do { code = randomCode(() => crypto.randomInt(1 << 30) / (1 << 30)); } while (parties.has(code));
  const party = new PartyRoom({
    code, isPublic, regions: [REGION],
    createMatch: async (region) => {
      const id = crypto.randomBytes(32).toString('hex');
      const room = new MatchRoom({ id, region, onEnded: () => setTimeout(() => matches.delete(id), 30_000) });
      matches.set(id, room);
      return id;
    },
  });
  parties.set(code, party);
  return party;
}

// Drop empty parties after a while.
setInterval(() => {
  const now = Date.now();
  for (const [code, p] of parties) if (p.members.size === 0 && now - p.created > 15 * 60_000) parties.delete(code);
}, 60_000).unref();

async function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.normalize(path.join(dist, rel));
  if (!file.startsWith(dist + path.sep) || rel.includes('\0')) return json(res, 404, { error: 'not found' });
  let st;
  try { st = await stat(file); } catch { st = null; }
  if (!st || !st.isFile()) {
    if (path.extname(rel)) return json(res, 404, { error: 'not found' });
    return serveStatic(req, res, new URL('/index.html', url));
  }
  const ext = path.extname(file);
  const immutable = rel.startsWith('/assets/');
  res.writeHead(200, {
    'content-type': TYPES[ext] || 'application/octet-stream',
    'content-length': st.size,
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin',
    ...(ext === '.html' ? { 'content-security-policy': CSP, 'permissions-policy': 'camera=(), microphone=(), geolocation=()' } : {}),
  });
  if (req.method === 'HEAD') return res.end();
  createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  try {
    if (p === '/healthz') return json(res, 200, { ok: true, sha: BUILD.sha, parties: parties.size, matches: matches.size, built: existsSync(path.join(dist, 'index.html')) });
    if (p.startsWith('/net/')) {
      if (p === '/net/health') return json(res, 200, { ok: true, edge: false });
      if (p === '/net/regions') return json(res, 200, { regions: [REGION], names: { [REGION]: 'Bunker origin server' } });
      if (p.startsWith('/net/ping/')) return json(res, 200, { region: REGION, t: Date.now() });
      if (p === '/net/party' && req.method === 'POST') {
        let body = '';
        for await (const c of req) { body += c; if (body.length > 1024) break; }
        let isPublic = false;
        try { isPublic = !!JSON.parse(body || '{}').public; } catch { /* default private */ }
        return json(res, 200, { code: newParty(isPublic).code });
      }
      if (p === '/net/quick') {
        let pings = {};
        try { pings = JSON.parse(url.searchParams.get('p') || '{}'); } catch { /* none */ }
        const open = [...parties.values()].filter((q) => q.isPublic && q.state === 'waiting' && q.size > 0 && q.size < 4);
        open.sort((a, b) => chooseRegion([pings], [a.choice().region]).worst - chooseRegion([pings], [b.choice().region]).worst);
        return json(res, 200, { code: (open[0] || newParty(true)).code });
      }
      return json(res, 404, { error: 'not found' });
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'method not allowed' });
    return await serveStatic(req, res, url);
  } catch (err) {
    console.error(JSON.stringify({ level: 'error', msg: 'request failed', path: p, err: String(err) }));
    if (!res.headersSent) json(res, 500, { error: 'internal error' });
  }
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://localhost');
  let room = null;
  let m = url.pathname.match(/^\/net\/party\/([A-Z]{4})$/);
  if (m) room = parties.get(m[1]);
  m = url.pathname.match(/^\/net\/match\/([0-9a-f]{64})$/);
  if (m) room = matches.get(m[1]);
  if (!room) {
    socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    room.open(ws);
    ws.on('message', (data, isBinary) => { if (!isBinary) room.message(ws, data.toString()); });
    ws.on('close', () => room.close(ws));
    ws.on('error', () => room.close(ws));
  });
});

server.listen(PORT, HOST, () => {
  console.log(JSON.stringify({ level: 'info', msg: 'listening', port: PORT, sha: BUILD.sha }));
});

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    server.close();
    for (const m of matches.values()) m.stop();
    setTimeout(() => process.exit(0), 300).unref();
  });
}
