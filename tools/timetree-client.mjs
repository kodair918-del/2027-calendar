/**
 * TimeTree の Web API 用の最小クライアント（非公式）。
 *
 * TimeTree の公式 API は 2023-12-22 に完全停止しているため、
 * Web アプリが使っている内部エンドポイントを利用する。
 * 仕様変更で予告なく壊れる可能性がある。
 *
 * 認証はメールアドレス + パスワード → セッション Cookie。
 * セッションはファイルに保存でき、次回以降はログインを省略できる。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export const BASE = 'https://timetreeapp.com';

const WEB_HEADERS = {
  'x-timetreea': 'web/2.1.0/ja',
  'content-type': 'application/json',
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
};

export class TimeTreeError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'TimeTreeError';
    this.status = status;
  }
}

function check(res, body) {
  if (res.ok || res.status === 204) return;
  const detail = typeof body === 'string' ? body.slice(0, 200) : JSON.stringify(body).slice(0, 200);
  throw new TimeTreeError(`TimeTree API ${res.status}: ${detail}`, res.status);
}

export function createClient(options = {}) {
  const base = options.base || BASE;
  const sessionPath = options.sessionPath || null;
  const cookies = new Map();
  let csrf = '';
  const deviceUuid = options.deviceUuid || crypto.randomUUID().replace(/-/g, '');

  function absorb(res) {
    const list =
      typeof res.headers.getSetCookie === 'function'
        ? res.headers.getSetCookie()
        : [res.headers.get('set-cookie')].filter(Boolean);
    for (const raw of list) {
      const pair = String(raw).split(';')[0];
      const eq = pair.indexOf('=');
      if (eq > 0) cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
    const nextCsrf = res.headers.get('x-csrf-token');
    if (nextCsrf) csrf = nextCsrf;
  }

  function cookieHeader() {
    return [...cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  async function request(method, path, body) {
    const headers = { ...WEB_HEADERS };
    const cookie = cookieHeader();
    if (cookie) headers.cookie = cookie;
    if (csrf) headers['x-csrf-token'] = csrf;

    const res = await fetch(`${base}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    absorb(res);

    const text = res.status === 204 ? '' : await res.text();
    let parsed = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }
    check(res, parsed);
    return parsed && typeof parsed === 'object' ? parsed : {};
  }

  async function loadCsrf() {
    const res = await fetch(`${base}/signin?locale=ja`, {
      headers: { ...WEB_HEADERS, ...(cookieHeader() ? { cookie: cookieHeader() } : {}) },
    });
    absorb(res);
    const html = await res.text();
    const m = /<meta\s+name=["']csrf-token["']\s+content=["'](.+?)["']/i.exec(html);
    if (!m) throw new TimeTreeError('CSRF トークンが見つかりませんでした（ログインページの構造が変わった可能性）', res.status);
    csrf = m[1];
    return csrf;
  }

  function saveSession(file) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(
      file,
      JSON.stringify({ cookies: [...cookies], csrf, deviceUuid, savedAt: new Date().toISOString() }, null, 2),
      { encoding: 'utf8', mode: 0o600 },
    );
  }

  function restoreSession(file) {
    if (!existsSync(file)) return false;
    try {
      const data = JSON.parse(readFileSync(file, 'utf8'));
      for (const [k, v] of data.cookies || []) cookies.set(k, v);
      if (data.csrf) csrf = data.csrf;
      return cookies.size > 0;
    } catch {
      return false;
    }
  }

  async function signin(email, password) {
    await loadCsrf();
    const data = await request('PUT', '/api/v1/auth/email/signin', {
      uid: email,
      password,
      uuid: deviceUuid,
    });
    if (sessionPath) saveSession(sessionPath);
    return data;
  }

  async function getUser() {
    const data = await request('GET', '/api/v1/user');
    return data.user || null;
  }

  async function getCalendars() {
    const data = await request('GET', '/api/v2/calendars');
    return data.calendars || [];
  }

  /** イベント同期。since を渡すと差分、省略すると全件（chunk でページング） */
  async function getEventsSync(calendarId, since) {
    const query = since == null ? '' : `?since=${encodeURIComponent(since)}`;
    return request('GET', `/api/v1/calendar/${calendarId}/events/sync${query}`);
  }

  async function createEvent(calendarId, payload) {
    const data = await request('POST', `/api/v1/calendar/${calendarId}/event`, payload);
    return data.event || null;
  }

  async function updateEvent(calendarId, eventId, payload) {
    const data = await request('PUT', `/api/v1/calendar/${calendarId}/event/${eventId}`, payload);
    return data.event || null;
  }

  async function deleteEvent(calendarId, eventId) {
    await request('DELETE', `/api/v1/calendar/${calendarId}/event/${eventId}`);
  }

  return {
    signin,
    getUser,
    getCalendars,
    getEventsSync,
    createEvent,
    updateEvent,
    deleteEvent,
    restoreSession,
    saveSession,
    hasSession: () => cookies.size > 0,
    loadCsrf,
  };
}
