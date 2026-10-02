import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { server as wisp, logging } from '@mercuryworkshop/wisp-js/server';
import { scramjetPath } from '@mercuryworkshop/scramjet/path';
import { libcurlPath } from '@mercuryworkshop/libcurl-transport';
import { baremuxPath } from '@mercuryworkshop/bare-mux/node';

const port = Number(process.env.PORT || 8080);
const host = process.env.HOST || (process.env.RENDER ? '0.0.0.0' : '127.0.0.1');
const password = process.env.ACCESS_PASSWORD || '';
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be 1–65535.');
if ((host !== '127.0.0.1' && host !== 'localhost') && password.length < 12) {
  throw new Error('Set ACCESS_PASSWORD to at least 12 characters before exposing Orbit on a network.');
}
const publicOrigin = process.env.PUBLIC_ORIGIN || process.env.RENDER_EXTERNAL_URL;
const origins = new Set(publicOrigin ? [new URL(publicOrigin).origin] : [`http://localhost:${port}`, `http://127.0.0.1:${port}`]);
const allowedHosts = new Set([...origins].map(value => new URL(value).host));
const publicPath = fileURLToPath(new URL('./public/', import.meta.url));
const sessions = new Map();
const sockets = new Map();
const sessionDuration = 8 * 60 * 60 * 1000;
const digest = value => createHash('sha256').update(value).digest();
const passwordDigest = digest(password);
let loginWindow = { started: Date.now(), attempts: 0 };

logging.set_level(logging.ERROR);
Object.assign(wisp.options, {
  allow_udp_streams: false,
  allow_direct_ip: false,
  allow_private_ips: false,
  allow_loopback_ips: false,
  port_whitelist: [80, 443],
  // wisp-js 0.4.1's per-host limiter assumes an iterable stream map.
  // Keep that option at its default; the total stream cap still applies.
  stream_limit_per_host: -1,
  stream_limit_total: 128,
  dns_result_order: 'ipv4first',
});

function tokenOf(request) {
  return request.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith('orbit_session='))?.slice(14) || '';
}
function authenticated(request) {
  return !password || (sessions.get(tokenOf(request)) || 0) > Date.now();
}
function endSession(token) {
  sessions.delete(token);
  for (const [socket, owner] of sockets) if (owner === token) socket.destroy();
}
function reject(socket, status = '403 Forbidden') {
  socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}
function cookie(request, value, maxAge) {
  const secure = publicOrigin?.startsWith('https://') || request.socket.encrypted;
  return `orbit_session=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}
function loginPage(error = '') {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Open Orbit</title><link rel="icon" href="/icon.svg"><link rel="stylesheet" href="/style.css"></head><body class="login-page"><main class="login-card"><img src="/icon.svg" width="48" height="48" alt=""><div class="eyebrow">YOUR PRIVATE WORKSPACE</div><h1>Open Orbit.</h1><p>Enter your workspace password to start browsing.</p>${error ? '<p class="login-error" role="alert">' + error + '</p>' : ''}<form method="post" action="/auth/login"><label for="password">Workspace password</label><input id="password" name="password" type="password" required autocomplete="current-password" maxlength="256" autofocus><button class="action" type="submit">Open browser</button></form></main></body></html>`;
}

const app = Fastify({
  logger: false,
  bodyLimit: 4096,
  serverFactory(handler) {
    const server = createServer(handler);
    server.on('upgrade', (request, socket, head) => {
      if (request.url !== '/wisp/' || !allowedHosts.has(request.headers.host) || !origins.has(request.headers.origin)) return reject(socket);
      if (!authenticated(request)) return reject(socket, '401 Unauthorized');
      if (sockets.size >= 16) return reject(socket, '503 Service Unavailable');
      const token = tokenOf(request);
      sockets.set(socket, token);
      socket.on('close', () => sockets.delete(socket));
      socket.on('error', () => sockets.delete(socket));
      try { wisp.routeRequest(request, socket, head); } catch { socket.destroy(); }
    });
    return server;
  },
});

app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_, body, done) => done(null, new URLSearchParams(body)));
app.addHook('onRequest', async (request, reply) => {
  reply.header('Cross-Origin-Opener-Policy', 'same-origin');
  reply.header('Cross-Origin-Embedder-Policy', 'require-corp');
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('Referrer-Policy', 'same-origin');
  reply.header('Cache-Control', 'no-store');
  reply.header('X-Frame-Options', 'SAMEORIGIN');
  const pathname = request.url.split('?')[0];
  if (pathname === '/healthz') return;
  if (!allowedHosts.has(request.headers.host)) return reply.code(403).send('Unexpected host. Set PUBLIC_ORIGIN to your public HTTPS URL.');
  if (request.method !== 'GET' && request.method !== 'HEAD' && !origins.has(request.headers.origin)) return reply.code(403).send('Origin not allowed.');
  if (['/login', '/auth/login', '/style.css', '/icon.svg'].includes(pathname)) return;
  if (!authenticated(request.raw)) return reply.redirect('/login');
});

app.get('/healthz', async () => ({ status: 'ok' }));
app.get('/login', async (request, reply) => {
  if (authenticated(request.raw)) return reply.redirect('/');
  return reply.type('text/html').send(loginPage());
});
app.post('/auth/login', async (request, reply) => {
  if (Date.now() - loginWindow.started > 60000) loginWindow = { started: Date.now(), attempts: 0 };
  if (++loginWindow.attempts > 20) return reply.code(429).header('Retry-After', '60').type('text/html').send(loginPage('Too many attempts. Try again in a minute.'));
  const supplied = request.body instanceof URLSearchParams ? request.body.get('password') || '' : '';
  if (!timingSafeEqual(digest(supplied), passwordDigest)) return reply.code(401).type('text/html').send(loginPage('That password did not match. Try again.'));
  endSession(tokenOf(request.raw));
  const token = randomBytes(32).toString('hex');
  sessions.set(token, Date.now() + sessionDuration);
  return reply.header('Set-Cookie', cookie(request.raw, token, sessionDuration / 1000)).code(303).redirect('/');
});
app.post('/auth/logout', async (request, reply) => {
  endSession(tokenOf(request.raw));
  return reply.header('Set-Cookie', cookie(request.raw, '', 0))
    .header('Clear-Site-Data', '"cache", "cookies", "storage"').code(303).redirect(password ? '/login' : '/');
});

for (const [root, prefix] of [[publicPath, '/'], [scramjetPath, '/scram/'], [libcurlPath, '/libcurl/'], [baremuxPath, '/baremux/']]) {
  app.register(fastifyStatic, { root, prefix, decorateReply: prefix === '/', dotfiles: 'deny', cacheControl: false });
}
app.setNotFoundHandler((_, reply) => reply.code(404).type('text/plain').send('Page not found. Return to / to browse.'));
app.setErrorHandler((error, _, reply) => {
  console.error('Request failed:', error.message);
  reply.code(error.statusCode || 500).send({ error: 'The request could not be completed.' });
});

const cleanup = setInterval(() => {
  for (const [token, expires] of sessions) if (expires <= Date.now()) endSession(token);
}, 30000);
cleanup.unref();
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => {
  clearInterval(cleanup);
  for (const socket of sockets.keys()) socket.destroy();
  await app.close();
  process.exit(0);
});
await app.listen({ port, host });
console.log(`Orbit Browser: ${publicOrigin || `http://localhost:${port}`}`);
console.log(password ? 'Workspace password enabled.' : 'Local preview only. Set ACCESS_PASSWORD before hosting.');
