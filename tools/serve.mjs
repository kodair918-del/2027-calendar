#!/usr/bin/env node
/**
 * ローカルサーバー: 静的配信 + 状態の保存 + TimeTree 同期 API
 *
 *   node tools/serve.mjs [--port 8787] [--no-open]
 *
 * ブラウザで http://localhost:8787/ を開くと、
 * localStorage ではなく data/state.json を読み書きするモードになる。
 */
import { createServer } from 'node:http';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, sep, extname } from 'node:path';
import { exec } from 'node:child_process';
import {
  emptyState,
  mergePull,
  pushLocal,
  fetchAllEvents,
  resolveCalendar,
  loginClient,
  fetchUserId,
} from './timetree-sync.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const DATA_DIR = process.env.DATA_DIR || join(ROOT, 'data');
const STATE_PATH = join(DATA_DIR, 'state.json');
const SESSION_PATH =
  process.env.TIMETREE_SESSION_PATH ||
  (existsSync(join(HERE, '.timetree-session.json'))
    ? join(HERE, '.timetree-session.json')
    : join(DATA_DIR, '.timetree-session.json'));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
};

const argv = process.argv.slice(2);
const portArg = argv.indexOf('--port');
const PORT = Number(portArg >= 0 ? argv[portArg + 1] : process.env.PORT || 8787);

const ENV = { ...loadEnvFile(join(HERE, '.env')), ...process.env };
const APP_PASSWORD = ENV.APP_PASSWORD || '';
const SESSION_SECRET = ENV.APP_SESSION_SECRET || randomBytes(32).toString('hex');
const AUTH_REQUIRED = process.env.NODE_ENV === 'production' || Boolean(APP_PASSWORD);
const ALLOW_ORIGIN = (ENV.ALLOW_ORIGIN || '').replace(/\/$/, '');
const COOKIE_NAME = 'lunar_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const LOGIN_ATTEMPTS = new Map();
const STATIC_PATHS = new Set([
  '/',
  '/index.html',
  '/app.js',
  '/styles.css',
  '/data/2027.js',
  '/assets/moon.jpg',
]);

if (process.env.NODE_ENV === 'production' && (!APP_PASSWORD || !ENV.APP_SESSION_SECRET)) {
  throw new Error('本番環境では APP_PASSWORD と APP_SESSION_SECRET の設定が必要です');
}
if (ALLOW_ORIGIN) {
  let parsedOrigin;
  try {
    parsedOrigin = new URL(ALLOW_ORIGIN);
  } catch {
    throw new Error('ALLOW_ORIGIN は https://example.com の形式で指定してください');
  }
  if (parsedOrigin.origin !== ALLOW_ORIGIN) {
    throw new Error('ALLOW_ORIGIN にパスや末尾スラッシュは指定できません');
  }
}

function requestOriginAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  const proto = String(req.headers['x-forwarded-proto'] || (req.socket.encrypted ? 'https' : 'http'))
    .split(',')[0]
    .trim();
  const sameOrigin = `${proto}://${req.headers.host}`;
  return origin === sameOrigin || origin === ALLOW_ORIGIN;
}

function corsHeaders(req) {
  const origin = req.headers.origin;
  const allowedOrigin = origin && (origin === ALLOW_ORIGIN || origin === `${String(
    req.headers['x-forwarded-proto'] || (req.socket.encrypted ? 'https' : 'http'),
  ).split(',')[0].trim()}://${req.headers.host}`);
  return {
    ...(allowedOrigin ? {
      'access-control-allow-origin': origin,
      'access-control-allow-credentials': 'true',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
      'access-control-max-age': '86400',
    } : {}),
    vary: 'origin',
  };
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
}

function signSession(expiry) {
  return createHmac('sha256', SESSION_SECRET).update(String(expiry)).digest('base64url');
}

function isAuthenticated(req) {
  if (!AUTH_REQUIRED) return true;
  const token = (req.headers.cookie || '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE_NAME}=`))
    ?.slice(COOKIE_NAME.length + 1);
  if (!token) return false;
  const [expiry, signature] = token.split('.');
  if (!/^\d+$/.test(expiry || '') || Number(expiry) <= Date.now() || !signature) return false;
  return safeEqual(signature, signSession(expiry));
}

function sessionCookie(req, value, maxAge) {
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const secure = process.env.NODE_ENV === 'production' || forwardedProto === 'https';
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; SameSite=${ALLOW_ORIGIN ? 'None' : 'Strict'}; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

function loginKey(req) {
  return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown')
    .split(',')[0]
    .trim();
}

function canAttemptLogin(key) {
  const now = Date.now();
  const attempts = (LOGIN_ATTEMPTS.get(key) || []).filter((time) => now - time < 15 * 60 * 1000);
  LOGIN_ATTEMPTS.set(key, attempts);
  return attempts.length < 10;
}

function recordLoginFailure(key) {
  LOGIN_ATTEMPTS.set(key, [...(LOGIN_ATTEMPTS.get(key) || []), Date.now()]);
}

/** OS ごとに既定のブラウザで開く（Windows / macOS / Linux） */
function openBrowser(url) {
  const cmd =
    process.platform === 'darwin'
      ? `open "${url}"`
      : process.platform === 'win32'
        ? `start "" "${url}"`
        : `xdg-open "${url}"`;
  exec(cmd, { shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh' }, () => {});
}

function loadEnvFile(file) {
  if (!existsSync(file)) return {};
  const out = {};
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[line.slice(0, eq).trim()] = value;
  }
  return out;
}

function readState() {
  if (!existsSync(STATE_PATH)) return emptyState();
  const parsed = JSON.parse(readFileSync(STATE_PATH, 'utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`状態ファイルの形式が不正です: ${STATE_PATH}`);
  }
  return { ...emptyState(), ...parsed };
}

await mkdir(DATA_DIR, { recursive: true, mode: 0o700 });
let state = readState();

async function writeStateFile() {
  const temporary = `${STATE_PATH}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(state, null, 2), { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, STATE_PATH);
}

function json(req, res, code, body, extraHeaders = {}) {
  const text = JSON.stringify(body);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...corsHeaders(req),
    ...extraHeaders,
  });
  res.end(text);
}

async function readBody(req, limit = 8 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('リクエストが大きすぎます');
    chunks.push(chunk);
  }
  if (!chunks.length) return null;
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function sanitizeEvent(e) {
  if (!e || typeof e !== 'object') return null;
  const s = Number(e.s);
  const en = Number(e.e);
  if (!Number.isFinite(s) || !Number.isFinite(en) || en <= s) return null;
  const out = {
    id: typeof e.id === 'string' ? e.id : Math.random().toString(36).slice(2, 9),
    s: Math.round(s),
    e: Math.round(en),
    t: typeof e.t === 'string' ? e.t : '',
  };
  if (e.ad) out.ad = true;
  if (e.dirty) out.dirty = true;
  if (e.tt && typeof e.tt.id === 'string') out.tt = { id: e.tt.id, updatedAt: Number(e.tt.updatedAt) || 0 };
  return out;
}

async function handleSync() {
  const client = await loginClient(ENV, { sessionPath: SESSION_PATH });
  const calendar = await resolveCalendar(client, ENV.TIMETREE_CALENDAR_ID);
  const userId = await fetchUserId(client);

  const events = await fetchAllEvents(client, calendar.id);
  const pull = mergePull(state, events, { fullSync: true });
  const push = await pushLocal(state, client, calendar.id, userId);

  state.sync = {
    ...(state.sync || {}),
    calendarId: calendar.id,
    calendarName: calendar.name,
    lastSyncAt: new Date().toISOString(),
  };
  await writeStateFile();

  return { calendar: calendar.name, fetched: events.length, pull, push, at: state.sync.lastSyncAt };
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://localhost:${PORT}`);
  const path = url.pathname;

  try {
    if (path === '/api/health' && req.method === 'GET') {
      return json(req, res, 200, { ok: true });
    }

    if (path.startsWith('/api/') && !requestOriginAllowed(req)) {
      return json(req, res, 403, { error: 'このサイトからのアクセスは許可されていません' });
    }

    if (path.startsWith('/api/') && req.method === 'OPTIONS') {
      if (!req.headers.origin || !corsHeaders(req)['access-control-allow-origin']) {
        return json(req, res, 403, { error: 'CORS origin is not allowed' });
      }
      res.writeHead(204, corsHeaders(req));
      return res.end();
    }

    if (path === '/api/auth' && req.method === 'GET') {
      return json(req, res, 200, {
        required: AUTH_REQUIRED,
        authenticated: isAuthenticated(req),
      });
    }

    if (path === '/api/login' && req.method === 'POST') {
      if (!AUTH_REQUIRED) return json(req, res, 404, { error: 'ログインは設定されていません' });
      const key = loginKey(req);
      if (!canAttemptLogin(key)) {
        return json(req, res, 429, { error: 'ログイン試行が多すぎます。15分後に再試行してください' });
      }
      const body = (await readBody(req, 4096)) || {};
      if (typeof body.password !== 'string' || !safeEqual(body.password, APP_PASSWORD)) {
        recordLoginFailure(key);
        return json(req, res, 401, { error: 'パスワードが違います' });
      }
      LOGIN_ATTEMPTS.delete(key);
      const expiry = Date.now() + SESSION_TTL_MS;
      const token = `${expiry}.${signSession(expiry)}`;
      return json(req, res, 200, { ok: true }, {
        'set-cookie': sessionCookie(req, token, SESSION_TTL_MS / 1000),
      });
    }

    if (path === '/api/logout' && req.method === 'POST') {
      return json(req, res, 200, { ok: true }, {
        'set-cookie': sessionCookie(req, '', 0),
      });
    }

    if (path.startsWith('/api/') && !isAuthenticated(req)) {
      return json(req, res, 401, { error: 'ログインが必要です' });
    }

    if (path === '/api/status' && req.method === 'GET') {
      return json(req, res, 200, {
        server: true,
        canSync: Boolean((ENV.TIMETREE_EMAIL && ENV.TIMETREE_PASSWORD) || existsSync(SESSION_PATH)),
        sync: state.sync || {},
      });
    }

    if (path === '/api/state' && req.method === 'GET') {
      return json(req, res, 200, {
        notes: state.notes || {},
        events: state.events || {},
        tombstones: state.tombstones || [],
        sync: state.sync || {},
        canSync: Boolean((ENV.TIMETREE_EMAIL && ENV.TIMETREE_PASSWORD) || existsSync(SESSION_PATH)),
      });
    }

    if (path === '/api/state' && req.method === 'POST') {
      const body = (await readBody(req)) || {};
      if (body.notes && typeof body.notes === 'object') {
        state.notes = {};
        for (const [k, v] of Object.entries(body.notes)) {
          if (typeof v === 'string' && v.trim()) state.notes[k] = v;
        }
      }
      if (body.events && typeof body.events === 'object') {
        state.events = {};
        for (const [iso, list] of Object.entries(body.events)) {
          if (!Array.isArray(list)) continue;
          const clean = list.map(sanitizeEvent).filter(Boolean);
          if (clean.length) state.events[iso] = clean.sort((a, b) => a.s - b.s);
        }
      }
      if (Array.isArray(body.tombstones)) {
        state.tombstones = body.tombstones.filter((x) => typeof x === 'string');
      }
      await writeStateFile();
      return json(req, res, 200, { ok: true });
    }

    if (path === '/api/sync' && req.method === 'POST') {
      const result = await handleSync();
      return json(req, res, 200, {
        ok: true,
        ...result,
        state: { notes: state.notes, events: state.events, tombstones: state.tombstones, sync: state.sync },
      });
    }

    if (path.startsWith('/api/')) return json(req, res, 404, { error: 'not found' });

    const rel = decodeURIComponent(path);
    if (!STATIC_PATHS.has(rel)) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end('404 Not Found');
    }
    const target = resolve(ROOT, `.${rel === '/' ? '/index.html' : rel}`);
    if (target !== ROOT && !target.startsWith(`${ROOT}${sep}`)) {
      return json(req, res, 403, { error: 'forbidden' });
    }

    const info = await stat(target).catch(() => null);
    if (!info || !info.isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end('404 Not Found');
    }

    const data = await readFile(target);
    res.writeHead(200, {
      'content-type': MIME[extname(target).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-store',
      'content-length': data.length,
    });
    res.end(data);
  } catch (err) {
    console.error('[api]', err);
    if (!res.headersSent) json(req, res, 500, { error: err.message });
    else res.destroy(err);
  }
});

const HOST = process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1';
server.listen(PORT, HOST, () => {
  const url = `http://localhost:${PORT}/`;
  console.log(`2027 Lunar Almanac: ${url}`);
  console.log(`  ※ 保存先: ${STATE_PATH}`);
  console.log(`  ※ Webログイン: ${AUTH_REQUIRED ? '有効' : '無効（ローカル利用向け）'}`);
  console.log('  ※ 公開環境では APP_PASSWORD と APP_SESSION_SECRET を必ず設定してください');
  if (!argv.includes('--no-open')) openBrowser(url);
});
