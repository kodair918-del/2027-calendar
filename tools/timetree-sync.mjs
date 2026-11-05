/**
 * TimeTree とローカル状態（state.json）の相互変換・マージ・プッシュ。
 *
 * TimeTree の保存仕様（実装から確認したもの）:
 *  - 終日予定は UTC 深夜のミリ秒。end_at は「最終日を含む」。
 *  - 時刻付き予定は start_timezone / end_timezone の壁時計時刻。
 *  - 一覧取得は chunk / since によるページング。
 */
import { createClient } from './timetree-client.mjs';

export const YEAR_START = '2027-01-01';
export const YEAR_END = '2027-12-31';
export const JST_OFFSET_MIN = 9 * 60;

const pad = (n) => String(n).padStart(2, '0');
const DAY_MS = 86400000;

export function uid() {
  return Math.random().toString(36).slice(2, 9);
}

export function emptyState() {
  return { version: 1, notes: {}, events: {}, tombstones: [], sync: {} };
}

function safeZone(tz) {
  if (!tz) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return 'UTC';
  }
}

/** UTC ミリ秒 → 指定タイムゾーンの壁時計 */
export function msToParts(ms, tz) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: safeZone(tz),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const p = Object.fromEntries(fmt.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return {
    iso: `${p.year}-${p.month}-${p.day}`,
    minute: (Number(p.hour) % 24) * 60 + Number(p.minute),
  };
}

export function addDays(iso, n) {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

export function diffDays(a, b) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
}

/** ローカルの日付 + 分 → UTC ミリ秒（JST 固定） */
export function localToMs(iso, minute) {
  return Date.parse(`${iso}T00:00:00Z`) + minute * 60000 - JST_OFFSET_MIN * 60000;
}

/** TimeTree の 1 イベントを、このカレンダーの「日ごとの予定」へ展開する */
export function ttToLocalEvents(ev) {
  if (!ev || typeof ev !== 'object') return [];
  if (ev.start_at == null) return [];

  const title = typeof ev.title === 'string' ? ev.title : '';
  const ttId = String(ev.id ?? '');
  const updatedAt = Number(ev.updated_at ?? ev.created_at ?? 0) || 0;
  if (!ttId) return [];

  if (ev.all_day) {
    const tz = safeZone(ev.start_timezone || 'UTC');
    const startIso = msToParts(Number(ev.start_at), tz).iso;
    const endIsoRaw = msToParts(Number(ev.end_at ?? ev.start_at), tz).iso;
    const endIso = endIsoRaw < startIso ? startIso : endIsoRaw;
    const days = diffDays(startIso, endIso) + 1;
    const out = [];
    for (let i = 0; i < days; i++) {
      out.push({
        iso: addDays(startIso, i),
        s: 0,
        e: 1440,
        t: title,
        ad: true,
        tt: { id: ttId, updatedAt },
      });
    }
    return out;
  }

  const startTz = safeZone(ev.start_timezone || 'Asia/Tokyo');
  const endTz = safeZone(ev.end_timezone || startTz);
  const sParts = msToParts(Number(ev.start_at), startTz);
  const eParts = msToParts(Number(ev.end_at ?? ev.start_at), endTz);
  const span = diffDays(sParts.iso, eParts.iso);

  if (span <= 0) {
    const s = Math.max(0, Math.min(1439, sParts.minute));
    const e = Math.max(s + 15, Math.min(1440, eParts.minute <= s ? 1440 : eParts.minute));
    return [{ iso: sParts.iso, s, e, t: title, tt: { id: ttId, updatedAt } }];
  }

  const out = [];
  for (let i = 0; i <= span; i++) {
    const iso = addDays(sParts.iso, i);
    const s = i === 0 ? Math.max(0, Math.min(1439, sParts.minute)) : 0;
    const e = i === span ? Math.max(1, Math.min(1440, eParts.minute || 1440)) : 1440;
    if (e <= s) continue;
    out.push({ iso, s, e, t: title, tt: { id: ttId, updatedAt } });
  }
  return out;
}

/** ローカル予定 → TimeTree の作成/更新ペイロード */
export function localToPayload(local, userId) {
  const base = {
    title: local.t || '',
    all_day: !!local.ad,
    label_id: 1,
    note: '',
    location: '',
    attendees: userId ? [userId] : [],
    recurrences: [],
    alerts: [],
    attachment: { virtual_user_attendees: [] },
    category: 1,
  };

  if (local.ad) {
    const startMs = Date.parse(`${local.iso}T00:00:00Z`);
    return {
      ...base,
      start_at: startMs,
      end_at: startMs,
      start_timezone: 'UTC',
      end_timezone: 'UTC',
    };
  }

  return {
    ...base,
    start_at: localToMs(local.iso, local.s),
    end_at: localToMs(local.iso, Math.min(1440, local.e)),
    start_timezone: 'Asia/Tokyo',
    end_timezone: 'Asia/Tokyo',
  };
}

const inYear = (iso) => iso >= YEAR_START && iso <= YEAR_END;

/**
 * 取得した TimeTree イベントをローカル状態へマージする。
 * ローカルで未送信の編集（dirty）は保持する。
 */
export function mergePull(state, ttEvents, { fullSync = true } = {}) {
  const incoming = new Map(); // ttId -> [{iso,s,e,t,ad}]
  for (const ev of ttEvents) {
    for (const item of ttToLocalEvents(ev)) {
      if (!inYear(item.iso)) continue;
      if (!incoming.has(item.tt.id)) incoming.set(item.tt.id, { updatedAt: item.tt.updatedAt, items: [] });
      incoming.get(item.tt.id).items.push(item);
    }
  }

  const stats = { added: 0, updated: 0, removed: 0 };

  // 既存の TT 由来予定を走査
  for (const [iso, list] of Object.entries(state.events)) {
    for (let i = list.length - 1; i >= 0; i--) {
      const local = list[i];
      if (!local.tt) continue;
      const src = incoming.get(local.tt.id);
      if (!src) {
        if (fullSync && !local.dirty) {
          list.splice(i, 1);
          stats.removed++;
        }
        continue;
      }
      if (local.dirty) continue;

      const match = src.items.find((x) => x.iso === iso && x.s === local.s && x.e === local.e);
      if (match) {
        if (match.t !== local.t) { local.t = match.t; stats.updated++; }
        local.tt.updatedAt = src.updatedAt;
      } else {
        const sameDay = src.items.find((x) => x.iso === iso);
        if (sameDay) {
          local.s = sameDay.s;
          local.e = sameDay.e;
          local.t = sameDay.t;
          local.tt.updatedAt = src.updatedAt;
          stats.updated++;
        } else {
          list.splice(i, 1);
          stats.removed++;
        }
      }
    }
    if (!list.length) delete state.events[iso];
  }

  // 新規
  for (const [ttId, src] of incoming) {
    for (const item of src.items) {
      const list = state.events[item.iso] || (state.events[item.iso] = []);
      const exists = list.some(
        (x) => x.tt && x.tt.id === ttId && x.s === item.s && x.e === item.e,
      );
      if (exists) continue;
      list.push({
        id: uid(),
        s: item.s,
        e: item.e,
        t: item.t,
        ...(item.ad ? { ad: true } : {}),
        tt: { id: ttId, updatedAt: src.updatedAt },
      });
      stats.added++;
    }
  }

  for (const list of Object.values(state.events)) list.sort((a, b) => a.s - b.s);
  return stats;
}

/** ローカルの変更を TimeTree へ送る */
export async function pushLocal(state, client, calendarId, userId) {
  const stats = { created: 0, updated: 0, deleted: 0, failed: 0 };

  for (const [iso, list] of Object.entries(state.events)) {
    for (const local of list) {
      if (!local.dirty) continue;
      const payload = localToPayload({ ...local, iso }, userId);

      try {
        if (local.tt && local.tt.id) {
          await client.updateEvent(calendarId, local.tt.id, payload);
          stats.updated++;
        } else {
          const created = await client.createEvent(calendarId, payload);
          if (created && created.id) {
            local.tt = { id: String(created.id), updatedAt: Number(created.updated_at || Date.now()) };
            stats.created++;
          } else {
            stats.failed++;
          }
        }
        delete local.dirty;
      } catch (err) {
        // 更新が拒否された場合は作り直しを試す
        if (local.tt && local.tt.id) {
          try {
            const created = await client.createEvent(calendarId, payload);
            if (created && created.id) {
              local.tt = { id: String(created.id), updatedAt: Number(created.updated_at || Date.now()) };
              delete local.dirty;
              stats.updated++;
              continue;
            }
          } catch {
            /* fallthrough */
          }
        }
        stats.failed++;
        console.warn(`push failed (${iso} ${local.t}): ${err.message}`);
      }
    }
  }

  const remaining = [];
  for (const ttId of state.tombstones || []) {
    try {
      await client.deleteEvent(calendarId, ttId);
      stats.deleted++;
    } catch (err) {
      if (err.status !== 404) {
        remaining.push(ttId);
        stats.failed++;
      }
    }
  }
  state.tombstones = remaining;

  return stats;
}

/** ページングを辿って全イベントを取得する */
export async function fetchAllEvents(client, calendarId, { maxPages = 200 } = {}) {
  const all = [];
  let since = 0;
  for (let page = 0; page < maxPages; page++) {
    const payload = await client.getEventsSync(calendarId, since || undefined);
    const events = Array.isArray(payload) ? payload : payload.events || [];
    all.push(...events);
    const cursor = Array.isArray(payload) ? null : payload.since;
    const chunk = Array.isArray(payload) ? false : payload.chunk === true;
    if (!chunk || cursor == null) break;
    since = Number(cursor) || 0;
  }
  return all;
}

export async function resolveCalendar(client, wanted) {
  const calendars = await client.getCalendars();
  if (!calendars.length) throw new Error('TimeTree のカレンダーが 1 件も見つかりませんでした。');
  if (!wanted) {
    if (calendars.length > 1) {
      const names = calendars.map((c) => `${c.id}: ${c.name}`).join('\n  ');
      console.log(`複数のカレンダーがあります。-c <id> で指定してください:\n  ${names}`);
    }
    return calendars[0];
  }
  const found = calendars.find((c) => String(c.id) === String(wanted) || c.name === wanted);
  if (!found) {
    const names = calendars.map((c) => `${c.id}: ${c.name}`).join('\n  ');
    throw new Error(`カレンダー ${wanted} が見つかりません:\n  ${names}`);
  }
  return found;
}

export async function loginClient(env, options = {}) {
  const client = createClient({ sessionPath: options.sessionPath });
  const restored = options.sessionPath ? client.restoreSession(options.sessionPath) : false;

  if (!restored) {
    if (!env.TIMETREE_EMAIL || !env.TIMETREE_PASSWORD) {
      throw new Error(
        'TIMETREE_EMAIL / TIMETREE_PASSWORD が未設定です。tools/.env か環境変数で指定してください。',
      );
    }
    await client.signin(env.TIMETREE_EMAIL, env.TIMETREE_PASSWORD);
  }
  return client;
}

export async function fetchUserId(client) {
  try {
    const user = await client.getUser();
    return user?.id ?? null;
  } catch {
    return null;
  }
}
