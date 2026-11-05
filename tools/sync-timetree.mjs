#!/usr/bin/env node
/**
 * TimeTree 双方向同期 CLI
 *
 *   node tools/sync-timetree.mjs --pull            TimeTree → state.json
 *   node tools/sync-timetree.mjs --push            state.json → TimeTree
 *   node tools/sync-timetree.mjs                   pull + push
 *   node tools/sync-timetree.mjs --emit            data/timetree.js を書き出す（file:// 用）
 *   node tools/sync-timetree.mjs --calendars       カレンダー一覧を表示
 *
 * 認証情報は tools/.env（TIMETREE_EMAIL / TIMETREE_PASSWORD / TIMETREE_CALENDAR_ID）。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
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
const STATE_PATH = join(ROOT, 'data', 'state.json');
const EMIT_PATH = join(ROOT, 'data', 'timetree.js');
const SESSION_PATH = join(HERE, '.timetree-session.json');

function loadEnvFile(file) {
  if (!existsSync(file)) return {};
  const out = {};
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

export function readState(file = STATE_PATH) {
  if (!existsSync(file)) return emptyState();
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'));
    return { ...emptyState(), ...data };
  } catch (err) {
    throw new Error(`state.json を読めません: ${err.message}`);
  }
}

export function writeState(state, file = STATE_PATH) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(state, null, 2), 'utf8');
}

export function emitRuntimeFile(state, file = EMIT_PATH) {
  const payload = { syncedAt: new Date().toISOString(), events: state.events, notes: state.notes };
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `window.TIMETREE_SYNC = ${JSON.stringify(payload, null, 1)};\n`, 'utf8');
}

async function main() {
  const argv = process.argv.slice(2);
  const flag = (name) => argv.includes(`--${name}`);
  const opt = (name, fallback = null) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
  };

  const env = { ...loadEnvFile(join(HERE, '.env')), ...process.env };
  const state = readState();
  state.tombstones ||= [];

  if (flag('emit')) {
    emitRuntimeFile(state);
    console.log(`書き出しました: ${EMIT_PATH}`);
    return;
  }

  const wantPull = flag('pull');
  const wantPush = flag('push');
  const doAll = !wantPull && !wantPush;

  const client = await loginClient(env, { sessionPath: SESSION_PATH });
  const calendar = await resolveCalendar(client, opt('calendar', env.TIMETREE_CALENDAR_ID));

  if (flag('calendars')) {
    for (const c of await client.getCalendars()) {
      console.log(`${c.id}  ${c.name}${String(c.id) === String(calendar.id) ? '  ← 既定' : ''}`);
    }
    return;
  }

  const userId = await fetchUserId(client);
  const summary = { calendar: calendar.name, calendarId: calendar.id };

  if (doAll || wantPull) {
    const events = await fetchAllEvents(client, calendar.id);
    summary.fetched = events.length;
    summary.pull = mergePull(state, events, { fullSync: true });
    state.sync = { ...(state.sync || {}), calendarId: calendar.id, lastPullAt: new Date().toISOString() };
  }

  if (doAll || wantPush) {
    summary.push = await pushLocal(state, client, calendar.id, userId);
    state.sync = { ...(state.sync || {}), calendarId: calendar.id, lastPushAt: new Date().toISOString() };
  }

  writeState(state);
  emitRuntimeFile(state);
  console.log(JSON.stringify(summary, null, 2));
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('sync-timetree.mjs')) {
  main().catch((err) => {
    console.error(`\nエラー: ${err.message}`);
    if (/CSRF|401|403/i.test(err.message)) {
      console.error('ヒント: セッションが切れている可能性があります。tools/.timetree-session.json を削除して再実行してください。');
    }
    process.exitCode = 1;
  });
}
