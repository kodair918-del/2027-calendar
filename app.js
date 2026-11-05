/* 2027 Lunar Almanac */
(() => {
  'use strict';

  const DATA = window.CAL_2027;
  if (!DATA) {
    document.body.innerHTML =
      '<p style="font:14px system-ui;padding:24px">data/2027.js を読み込めませんでした。</p>';
    return;
  }

  const DOW = ['日', '月', '火', '水', '木', '金', '土'];
  const MON_EN = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const SYNODIC = 29.530588853;
  const STEPS = 24;                 // 月アイコンの分割数（15度刻み）
  const NOTES_KEY = 'lunar2027.notes.v1';
  const THEME_KEY = 'lunar2027.theme.v1';
  const PHASE_LABEL = { new: '新月', first: '上弦', full: '満月', last: '下弦' };
  const PHASE_KEYS = [null, 'new', 'first', 'full', 'last'];

  /* ---------------- 天文データの展開 ---------------- */
  // data/2027.js は [曜日, 位相(0-1000), 月相, 二至二分] の配列で持っている

  const DAY_MS_DATA = 86400000;

  function decodeDays(src) {
    const start = Date.UTC(src.year, 0, 1);
    const out = [];
    for (let i = 0; i < src.days.length; i++) {
      const r = src.days[i];
      const term = r[3] ? src.terms[r[3] - 1] : null;
      out.push({
        date: new Date(start + i * DAY_MS_DATA).toISOString().slice(0, 10),
        dow: r[0],
        phase: r[1] / 1000,
        phaseEvent: PHASE_KEYS[r[2]] || null,
        term: term ? term.name : null,
      });
    }
    return out;
  }

  const DAYS = DATA.v === 2 ? decodeDays(DATA) : DATA.days;

  const board = document.getElementById('board');
  const sprite = document.getElementById('sprite');
  const pop = document.getElementById('pop');
  const popUse = document.getElementById('pop-moon-use');
  const popDate = document.getElementById('pop-date');
  const popMeta = document.getElementById('pop-meta');
  const popText = document.getElementById('pop-text');
  const popState = document.getElementById('pop-state');
  const popEvs = document.getElementById('pop-evs');
  const fileInput = document.getElementById('file-input');

  const pad = (n) => String(n).padStart(2, '0');
  const byDate = new Map(DAYS.map((d) => [d.date, d]));
  const termByDate = new Map(DATA.terms.map((t) => [t.date, t]));

  /* ---------------- メモの保存 ---------------- */

  let notes = {};
  try {
    notes = JSON.parse(localStorage.getItem(NOTES_KEY) || '{}') || {};
  } catch {
    notes = {};
  }
  const persist = () => {
    try { localStorage.setItem(NOTES_KEY, JSON.stringify(notes)); } catch { /* 容量不足などは無視 */ }
    queueStatePush();
  };

  /* ---------------- 時間予定の保存 ---------------- */

  const EVENTS_KEY = 'lunar2027.events.v1';
  const SNAP_MIN = 15;

  function uid() {
    return Math.random().toString(36).slice(2, 9);
  }
  const clampMin = (m) => Math.max(0, Math.min(1440, Math.round(m)));
  const snapMin = (m) => clampMin(Math.round(m / SNAP_MIN) * SNAP_MIN);
  const fmtTime = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
  const isValidEvent = (e) =>
    e && Number.isFinite(e.s) && Number.isFinite(e.e) && e.e > e.s && e.s >= 0 && e.e <= 1440;
  const normEvent = (e) => ({
    id: typeof e.id === 'string' ? e.id : uid(),
    s: Math.round(e.s),
    e: Math.round(e.e),
    t: typeof e.t === 'string' ? e.t : '',
    ...(e.ad ? { ad: true } : {}),
    ...(e.dirty ? { dirty: true } : {}),
    ...(e.tt && typeof e.tt.id === 'string'
      ? { tt: { id: e.tt.id, updatedAt: Number(e.tt.updatedAt) || 0 } }
      : {}),
  });

  let eventMap = {};
  try {
    const raw = JSON.parse(localStorage.getItem(EVENTS_KEY) || '{}') || {};
    for (const [iso, list] of Object.entries(raw)) {
      if (!Array.isArray(list)) continue;
      const clean = list.filter(isValidEvent).map(normEvent);
      if (clean.length) eventMap[iso] = clean;
    }
  } catch {
    eventMap = {};
  }

  /* ---------------- ローカルサーバー（tools/serve.mjs）連携 ---------------- */

  let serverMode = false;
  let serverAuthenticated = false;
  let serverCanSync = false;
  let tombstones = [];
  let stateTimer = 0;

  // 静的ホスティングから同期サーバーへ繋ぐ場合は ?api=https://example.com/ を付ける
  const API_BASE = (() => {
    const raw = new URLSearchParams(location.search).get('api');
    if (!raw) return '';
    return raw.endsWith('/') ? raw : `${raw}/`;
  })();

  function queueStatePush() {
    if (!serverMode || !serverAuthenticated) return;
    clearTimeout(stateTimer);
    stateTimer = setTimeout(() => {
      fetch(`${API_BASE}api/state`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ notes, events: eventMap, tombstones }),
      }).then((res) => {
        if (!res.ok) throw new Error(`サーバーへの保存に失敗しました (${res.status})`);
      }).catch((err) => {
        console.error('[calendar] state save failed', err);
        const syncButton = document.getElementById('btn-sync');
        if (syncButton && !syncButton.hidden) {
          syncButton.dataset.tone = 'warn';
          syncButton.title = err.message;
        }
      });
    }, 350);
  }

  function applyState(payload) {
    notes = {};
    for (const [k, v] of Object.entries(payload.notes || {})) {
      if (typeof v === 'string' && v.trim()) notes[k] = v;
    }
    try { localStorage.setItem(NOTES_KEY, JSON.stringify(notes)); } catch { /* noop */ }

    eventMap = {};
    for (const [iso, list] of Object.entries(payload.events || {})) {
      if (!Array.isArray(list)) continue;
      const clean = list.filter(isValidEvent).map(normEvent);
      if (clean.length) eventMap[iso] = clean;
    }
    try { localStorage.setItem(EVENTS_KEY, JSON.stringify(eventMap)); } catch { /* noop */ }
  }

  async function loadServerState() {
    if (!API_BASE && !location.protocol.startsWith('http')) return false;
    try {
      const authRes = await fetch(`${API_BASE}api/auth`, {
        cache: 'no-store',
        credentials: 'include',
      });
      if (!authRes.ok) return false;
      const auth = await authRes.json();
      if (auth.required && !auth.authenticated) {
        serverMode = true;
        serverAuthenticated = false;
        return false;
      }

      const res = await fetch(`${API_BASE}api/state`, {
        cache: 'no-store',
        credentials: 'include',
      });
      if (res.status === 401) {
        serverMode = true;
        serverAuthenticated = false;
        return false;
      }
      if (!res.ok) return false;
      const data = await res.json();
      applyState(data);
      tombstones = Array.isArray(data.tombstones) ? data.tombstones : [];
      serverCanSync = data.canSync !== false;
      serverMode = true;
      serverAuthenticated = true;
      return true;
    } catch {
      return false;
    }
  }

  const persistEvents = () => {
    try { localStorage.setItem(EVENTS_KEY, JSON.stringify(eventMap)); } catch { /* noop */ }
    queueStatePush();
  };

  const eventsOf = (iso) => (eventMap[iso] || []).slice().sort((a, b) => a.s - b.s);

  // 年間ビューのセルに出す1行（メモ優先、無ければ最初の予定）
  function cellSummary(iso) {
    if (notes[iso]) return notes[iso];
    const list = eventsOf(iso);
    if (!list.length) return '';
    const ev = list[0];
    return ev.ad ? (ev.t || '終日') : `${fmtTime(ev.s)} ${ev.t || '予定'}`;
  }

  function eventListTitle(iso) {
    const list = eventsOf(iso);
    if (!list.length) return '';
    return list
      .map((e) => `\n・${e.ad ? '終日' : `${fmtTime(e.s)}–${fmtTime(e.e)}`} ${e.t || '（無題）'}`)
      .join('');
  }

  // 週表示の終日欄に出す要素（その日のメモ + 終日予定）
  function allDayItems(iso) {
    const items = [];
    if (notes[iso]) items.push({ kind: 'note', text: notes[iso], iso });
    for (const ev of eventsOf(iso)) {
      if (ev.ad) items.push({ kind: 'event', text: ev.t || '終日', iso, id: ev.id });
    }
    return items;
  }

  const escapeHtml = (s) =>
    String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /* ---------------- iCalendar (.ics) の取り込み ---------------- */

  // TimeTree / Google カレンダーなどの書き出しファイルを読む
  const ICS_WINDOW_START = '2026-12-20';
  const ICS_WINDOW_END = '2028-01-10';

  function unescapeICS(v) {
    return v.replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
  }

  // 値を { iso, minute, ad } に正規化（Z 付き UTC は JST に変換）
  function parseICSDate(value, params) {
    const v = String(value).trim();

    let m = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
    if (m) return { iso: `${m[1]}-${m[2]}-${m[3]}`, minute: 0, ad: true };

    m = /^(\d{4})-?(\d{2})-?(\d{2})T(\d{2}):?(\d{2})(?::?(\d{2}))?(Z)?$/i.exec(v);
    if (!m) return null;

    let y = +m[1];
    let mo = +m[2];
    let d = +m[3];
    let hh = +m[4];
    let mi = +m[5];

    if (m[7]) {
      const jst = new Date(Date.UTC(y, mo - 1, d, hh, mi) + 9 * 3600000);
      y = jst.getUTCFullYear();
      mo = jst.getUTCMonth() + 1;
      d = jst.getUTCDate();
      hh = jst.getUTCHours();
      mi = jst.getUTCMinutes();
    }

    return {
      iso: `${y}-${pad(mo)}-${pad(d)}`,
      minute: hh * 60 + mi,
      ad: (params && params.VALUE === 'DATE') || false,
    };
  }

  function parseICS(text) {
    const rawLines = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    const lines = [];
    for (const line of rawLines) {
      if (/^[ \t]/.test(line) && lines.length) lines[lines.length - 1] += line.slice(1);
      else lines.push(line);
    }

    const out = [];
    let cur = null;
    for (const line of lines) {
      const upper = line.toUpperCase();
      if (upper === 'BEGIN:VEVENT') { cur = { exdate: [] }; continue; }
      if (upper === 'END:VEVENT') { if (cur) out.push(cur); cur = null; continue; }
      if (!cur) continue;

      const idx = line.indexOf(':');
      if (idx < 0) continue;

      const head = line.slice(0, idx);
      const value = line.slice(idx + 1);
      const parts = head.split(';');
      const name = parts.shift().toUpperCase();
      const params = {};
      for (const p of parts) {
        const eq = p.indexOf('=');
        if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1);
      }

      switch (name) {
        case 'SUMMARY': cur.summary = unescapeICS(value).trim(); break;
        case 'DTSTART': cur.dtstart = parseICSDate(value, params); break;
        case 'DTEND': cur.dtend = parseICSDate(value, params); break;
        case 'RRULE': cur.rrule = value.trim(); break;
        case 'EXDATE':
          for (const v of value.split(',')) {
            const d = parseICSDate(v, params);
            if (d) cur.exdate.push(d.iso);
          }
          break;
        case 'STATUS': cur.status = value.trim().toUpperCase(); break;
        case 'LOCATION': cur.location = unescapeICS(value).trim(); break;
        default: break;
      }
    }
    return out;
  }

  function parseRRule(src) {
    const r = {};
    for (const chunk of String(src).split(';')) {
      const eq = chunk.indexOf('=');
      if (eq < 0) continue;
      const k = chunk.slice(0, eq).toUpperCase();
      r[k] = chunk.slice(eq + 1).toUpperCase();
    }
    return r;
  }

  const WDAY_INDEX = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
  const DAY_NAMES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
  const D2MS = 86400000;

  const toKey = (d) => d.toISOString().slice(0, 10);
  const fromKey = (iso) => new Date(`${iso}T00:00:00Z`);

  /** VEVENT を 2027 周辺の日付リストへ展開する */
  function icsOccurrences(ve) {
    const start = ve.dtstart;
    if (!start) return [];

    const windowStart = fromKey(ICS_WINDOW_START);
    const windowEnd = fromKey(ICS_WINDOW_END);

    let durationMin;
    if (ve.dtend) {
      if (ve.dtend.iso === start.iso && !start.ad) durationMin = Math.max(15, ve.dtend.minute - start.minute);
      else if (ve.dtend.iso === start.iso) durationMin = 1440;
      else {
        const days = Math.round((fromKey(ve.dtend.iso) - fromKey(start.iso)) / D2MS);
        durationMin = ve.dtend.ad ? Math.max(1440, days * 1440) : Math.max(15, days * 1440 + ve.dtend.minute - start.minute);
      }
    } else {
      durationMin = start.ad ? 1440 : 60;
    }

    const base = fromKey(start.iso);
    const dates = [];

    if (!ve.rrule) {
      if (start.ad && durationMin > 1440) {
        for (let i = 0; i < durationMin / 1440; i++) dates.push(new Date(base.getTime() + i * D2MS));
      } else if (!start.ad && durationMin > 1440) {
        const days = Math.ceil(durationMin / 1440);
        for (let i = 0; i < days; i++) dates.push(new Date(base.getTime() + i * D2MS));
      } else {
        dates.push(base);
      }
      return dates
        .filter((d) => d >= windowStart && d <= windowEnd)
        .map((d) => ({
          iso: toKey(d),
          minute: start.ad ? 0 : start.minute,
          duration: durationMin,
          ad: start.ad,
        }));
    }

    const rule = parseRRule(ve.rrule);
    const freq = rule.FREQ || 'WEEKLY';
    const interval = Math.max(1, Number(rule.INTERVAL || 1));
    const count = rule.COUNT ? Number(rule.COUNT) : Infinity;
    const until = rule.UNTIL ? parseICSDate(rule.UNTIL, {}) : null;
    const untilKey = until ? until.iso : null;

    const byDay = (rule.BYDAY || '')
      .split(',')
      .map((s) => WDAY_INDEX[s.replace(/^[+-]?\d+/, '').slice(0, 2)])
      .filter((n) => Number.isInteger(n));
    const byMonthDay = (rule.BYMONTHDAY || '')
      .split(',')
      .map(Number)
      .filter((n) => Number.isInteger(n) && n !== 0);
    const byMonth = (rule.BYMONTH || '')
      .split(',')
      .map(Number)
      .filter((n) => Number.isInteger(n) && n >= 1 && n <= 12);

    let emitted = 0;
    const push = (d) => {
      if (emitted >= count) return false;
      if (d < windowStart || d > windowEnd) return true;
      const iso = toKey(d);
      if (untilKey && iso > untilKey) return false;
      if (!ve.exdate.includes(iso)) dates.push(d);
      emitted++;
      return true;
    };

    if (freq === 'DAILY') {
      for (let i = 0; i < 1200; i++) {
        const d = new Date(base.getTime() + i * interval * D2MS);
        if (d > windowEnd) break;
        if (!push(d)) break;
      }
    } else if (freq === 'WEEKLY') {
      const days = byDay.length ? byDay : [base.getUTCDay()];
      const weekStart = new Date(base.getTime() - base.getUTCDay() * D2MS);
      for (let w = 0; w < 200; w++) {
        const ws = new Date(weekStart.getTime() + w * interval * 7 * D2MS);
        if (ws > windowEnd) break;
        for (const day of days) {
          const d = new Date(ws.getTime() + day * D2MS);
          if (d < base) continue;
          if (d > windowEnd) break;
          if (!push(d)) { w = 9999; break; }
        }
      }
    } else if (freq === 'MONTHLY') {
      const months = byMonthDay.length ? byMonthDay : [base.getUTCDate()];
      for (let i = 0; i < 120; i++) {
        const m = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + i * interval, 1));
        if (m > windowEnd) break;
        for (const day of months) {
          const d = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth(), day));
          if (d.getUTCMonth() !== m.getUTCMonth()) continue;
          if (d < base) continue;
          if (!push(d)) { i = 9999; break; }
        }
      }
    } else {
      const step = freq === 'YEARLY' ? interval : 1;
      for (let i = 0; i < 12; i++) {
        const y = base.getUTCFullYear() + i * step;
        const months = byMonth.length ? byMonth : [base.getUTCMonth() + 1];
        for (const mo of months) {
          const days = byMonthDay.length ? byMonthDay : [base.getUTCDate()];
          for (const day of days) {
            const d = new Date(Date.UTC(y, mo - 1, day));
            if (d.getUTCMonth() !== mo - 1) continue;
            if (d < base) continue;
            if (d > windowEnd) { i = 9999; break; }
            if (!push(d)) { i = 9999; break; }
          }
        }
      }
    }

    return dates
      .filter((d) => d >= windowStart && d <= windowEnd)
      .map((d) => ({ iso: toKey(d), minute: start.ad ? 0 : start.minute, duration: durationMin, ad: start.ad }));
  }

  /** .ics テキストを取り込み、追加件数を返す */
  function importICS(text) {
    const vevents = parseICS(text);
    let added = 0;

    for (const ve of vevents) {
      if (!ve.summary) continue;
      if (ve.status === 'CANCELLED') continue;

      for (const occ of icsOccurrences(ve)) {
        const isAllDay = occ.ad || occ.minute === 0 && occ.duration >= 1440;
        const s = isAllDay ? 0 : Math.max(0, Math.min(1439, occ.minute));
        const e = isAllDay
          ? 1440
          : Math.max(s + 15, Math.min(1440, occ.minute + (occ.duration || 60)));

        const id = `ics-${ve.summary}-${occ.iso}-${s}`.replace(/\s+/g, '_').slice(0, 80);
        const list = eventMap[occ.iso] || (eventMap[occ.iso] = []);
        if (list.some((x) => x.id === id)) continue;

        list.push({ id, s, e, t: ve.summary, ...(isAllDay ? { ad: true } : {}) });
        added++;
      }
    }

    if (added) {
      persistEvents();
      renderAllDays();
      refreshTexts();
    }
    return { added, total: vevents.length };
  }

  /* ---------------- 月アイコンの生成 ---------------- */

  // f: 0=新月, .25=上弦, .5=満月, .75=下弦
  // 照らされた部分を「外縁の半円 + ターミネーター(楕円弧)」で閉じた領域として返す。
  // 影は描かず、この領域の外側は透明にする。
  function litPath(f) {
    const R = 14;
    const C = 16;
    const c = Math.cos(2 * Math.PI * f);
    const rx = Math.max(0.001, Math.abs(c) * R);
    const waxing = f < 0.5;
    const outer = waxing ? 1 : 0;
    const term = waxing ? (c > 0 ? 0 : 1) : (c > 0 ? 1 : 0);
    const top = `${C},${C - R}`;
    const bottom = `${C},${C + R}`;
    return `M${top} A${R},${R} 0 0 ${outer} ${bottom} A${rx},${R} 0 0 ${term} ${top} Z`;
  }

  function buildSprite() {
    const out = [
      `<defs>
        <linearGradient id="moonGold" x1="28%" y1="12%" x2="72%" y2="94%">
          <stop offset="0%" stop-color="var(--moon-1)"/>
          <stop offset="46%" stop-color="var(--moon-2)"/>
          <stop offset="100%" stop-color="var(--moon-3)"/>
        </linearGradient>
        <radialGradient id="moonGlow" cx="38%" cy="30%" r="70%">
          <stop offset="55%" stop-color="var(--moon-1)" stop-opacity="0"/>
          <stop offset="100%" stop-color="var(--moon-1)" stop-opacity=".5"/>
        </radialGradient>
      </defs>`,
    ];

    for (let i = 0; i < STEPS; i++) {
      const major = i % 12 === 0;
      const ring = major
        ? '<circle cx="16" cy="16" r="15.4" fill="none" stroke="var(--moon-2)" stroke-opacity=".85" stroke-width=".7"/>'
        : '';

      out.push(
        `<symbol id="mp-${i}" viewBox="0 0 32 32">
          <clipPath id="lit-${i}" clipPathUnits="userSpaceOnUse"><path d="${litPath(i / STEPS)}"/></clipPath>
          <circle cx="16" cy="16" r="14" fill="none" stroke="currentColor" stroke-opacity=".18" stroke-width=".6"/>
          <g clip-path="url(#lit-${i})">
            <circle cx="16" cy="16" r="14" fill="url(#moonGold)"/>
            <image href="assets/moon.jpg" x="2" y="2" width="28" height="28"
                   preserveAspectRatio="xMidYMid slice"
                   style="mix-blend-mode:multiply" opacity=".55"/>
            <circle cx="16" cy="16" r="14" fill="url(#moonGlow)"/>
            <circle cx="16" cy="16" r="13.7" fill="none" stroke="var(--moon-1)"
                    stroke-opacity=".35" stroke-width=".6"/>
          </g>
          ${ring}
        </symbol>`,
      );
    }

    sprite.innerHTML = out.join('');
  }

  const iconIndex = (f) => Math.round(f * STEPS) % STEPS;

  /* ---------------- グリッド構築 ---------------- */

  const cells = [];       // フォーカス移動用（31 x 12）
  const roving = { first: null };

  function makeCell(m, d) {
    const iso = `2027-${pad(m)}-${pad(d)}`;
    const day = byDate.get(iso);

    if (!day) {
      const v = document.createElement('div');
      v.className = 'cell void';
      v.setAttribute('aria-hidden', 'true');
      return v;
    }

    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'cell';
    cell.tabIndex = -1;
    cell.dataset.date = iso;
    cell.dataset.r = String(d - 1);
    cell.dataset.c = String(m - 1);

    if (day.dow === 6) cell.classList.add('sat');
    if (day.dow === 0) cell.classList.add('sun');
    if (day.term) cell.classList.add('term');

    const idx = iconIndex(day.phase);
    cell.innerHTML =
      `<svg class="mp${day.phaseEvent ? ' major' : ''}" viewBox="0 0 32 32" aria-hidden="true">` +
      `<use href="#mp-${idx}"/></svg>` +
      '<span class="txt"></span>' +
      (day.term ? `<span class="tag">${day.term}</span>` : '');

    const txt = cell.querySelector('.txt');
    txt.textContent = cellSummary(iso);
    if (eventMap[iso] && eventMap[iso].length) cell.classList.add('has-ev');

    const base = `${m}月${d}日（${DOW[day.dow]}）`;
    cell.setAttribute(
      'aria-label',
      `${base} ${PHASE_LABEL[day.phaseEvent] || `月齢${(day.phase * SYNODIC).toFixed(1)}`}${day.term ? ` ${day.term}` : ''}`,
    );
    cell.title = `${base}　${phaseSummary(day)}${eventListTitle(iso)}`;

    return cell;
  }

  function phaseSummary(day) {
    const age = (day.phase * SYNODIC).toFixed(1);
    const illum = Math.round(((1 - Math.cos(2 * Math.PI * day.phase)) / 2) * 100);
    const name = PHASE_LABEL[day.phaseEvent] || (day.phase < 0.5 ? '満ちていく月' : '欠けていく月');
    return `${name} ・ 月齢 ${age} ・ 照度 ${illum}%`;
  }

  function buildBoard() {
    const frag = document.createDocumentFragment();

    const corner = document.createElement('div');
    corner.className = 'corner';
    frag.appendChild(corner);

    for (let m = 1; m <= 12; m++) {
      const h = document.createElement('div');
      h.className = 'mh';
      h.setAttribute('aria-hidden', 'true');
      h.innerHTML = `<span class="n">${m}</span><span class="u">月</span><span class="en">${MON_EN[m - 1]}</span>`;
      frag.appendChild(h);
    }

    const todayISO = new Date(Date.now() - new Date().getTimezoneOffset() * 60000)
      .toISOString().slice(0, 10);

    for (let d = 1; d <= 31; d++) {
      const dn = document.createElement('div');
      dn.className = d % 5 === 0 ? 'dn five' : 'dn';
      dn.textContent = String(d);
      dn.setAttribute('aria-hidden', 'true');
      frag.appendChild(dn);

      const row = [];
      for (let m = 1; m <= 12; m++) {
        const cell = makeCell(m, d);
        if (cell.classList.contains('today')) cell.classList.remove('today');
        if (cell.dataset.date === todayISO) cell.classList.add('today');
        if (!cell.classList.contains('void') && !roving.first) {
          roving.first = cell;
          cell.tabIndex = 0;
        }
        row.push(cell);
        frag.appendChild(cell);
      }
      cells.push(row);
    }

    board.appendChild(frag);
  }

  /* ---------------- 1画面フィット ---------------- */

  function fit() {
    const headH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--head-h')) || 26;
    const h = board.clientHeight;
    if (h < headH + 64) return;
    const rowH = (h - headH - 31) / 31; // 32行の間の gap 31本
    document.documentElement.style.setProperty('--row-h', `${rowH.toFixed(2)}px`);
  }

  /* ---------------- ポップオーバー ---------------- */

  let openCell = null;
  let saveTimer = 0;

  function openPop(cell, anchorEl) {
    if (openCell) openCell.classList.remove('is-open');
    openCell = cell;
    cell.classList.add('is-open');

    const iso = cell.dataset.date;
    const day = byDate.get(iso);
    const m = Number(iso.slice(5, 7));
    const d = Number(iso.slice(8, 10));
    const dowClass = day.dow === 0 ? 'sun' : day.dow === 6 ? 'sat' : '';

    popDate.innerHTML = `${m}月${d}日<span class="dow ${dowClass}">（${DOW[day.dow]}）</span>`;
    popMeta.innerHTML =
      `${phaseSummary(day)}` +
      (day.term ? `<br><span class="gold">${day.term}　${termByDate.get(iso).time}</span>` : '');

    popUse.setAttribute('href', `#mp-${iconIndex(day.phase)}`);
    popText.value = notes[iso] || '';
    popState.textContent = '保存済み';

    const list = eventsOf(iso);
    if (list.length) {
      popEvs.hidden = false;
      popEvs.innerHTML = list
        .map(
          (e) =>
            `<div><span class="t">${e.ad ? '終日' : `${fmtTime(e.s)}–${fmtTime(e.e)}`}</span>` +
            `<span class="n">${escapeHtml(e.t || '（無題）')}</span>` +
            `<button type="button" class="pev-del" data-id="${escapeHtml(e.id)}" aria-label="この予定を削除">×</button></div>`,
        )
        .join('');
    } else {
      popEvs.hidden = true;
      popEvs.innerHTML = '';
    }

    pop.hidden = false;
    pop.style.visibility = 'hidden';
    place(anchorEl || cell);
    pop.style.visibility = '';

    requestAnimationFrame(() => {
      popText.focus();
      popText.setSelectionRange(popText.value.length, popText.value.length);
    });
  }

  function place(cell) {
    const r = cell.getBoundingClientRect();
    const w = pop.offsetWidth;
    const h = pop.offsetHeight;
    const gap = 10;

    let x = r.right + gap;
    if (x + w > window.innerWidth - 8) x = r.left - w - gap;
    x = Math.max(8, Math.min(x, window.innerWidth - w - 8));

    let y = r.top + r.height / 2 - h / 2;
    y = Math.max(8, Math.min(y, window.innerHeight - h - 8));

    pop.style.left = `${Math.round(x)}px`;
    pop.style.top = `${Math.round(y)}px`;
  }

  function closePop() {
    if (!openCell) return;
    flushSave();
    openCell.classList.remove('is-open');
    openCell.focus({ preventScroll: true });
    openCell = null;
    pop.hidden = true;
  }

  function flushSave() {
    if (!saveTimer) return;
    clearTimeout(saveTimer);
    saveTimer = 0;
    persist();
    popState.textContent = '保存済み';
  }

  popText.addEventListener('input', () => {
    if (!openCell) return;
    const iso = openCell.dataset.date;
    const value = popText.value;

    if (value.trim()) notes[iso] = value;
    else delete notes[iso];

    const txt = openCell.querySelector('.txt');
    if (txt) txt.textContent = cellSummary(iso);
    renderAllDay(iso);

    popState.textContent = '保存中…';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = 0;
      persist();
      popState.textContent = '保存済み';
    }, 260);
  });

  popText.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); closePop(); }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); closePop(); }
  });

  document.getElementById('pop-close').addEventListener('click', closePop);

  popEvs.addEventListener('click', (e) => {
    const btn = e.target.closest('.pev-del');
    if (!btn || !openCell) return;
    e.stopPropagation();
    const cell = openCell;
    const iso = cell.dataset.date;
    flushSave();
    dropEvent(iso, btn.dataset.id);
    renderDay(iso);
    refreshCell(iso);
    openPop(cell, pop);
  });

  document.addEventListener('pointerdown', (e) => {
    if (!openCell) return;
    if (e.target.closest('.ad-chip, .adcol')) return;
    if (pop.contains(e.target) || openCell.contains(e.target)) return;
    closePop();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && openCell) closePop();
  });

  /* ---------------- セルの操作・キーボード移動 ---------------- */

  board.addEventListener('click', (e) => {
    const cell = e.target.closest('.cell');
    if (!cell || cell.classList.contains('void')) return;
    if (cell === openCell) { closePop(); return; }
    openPop(cell);
  });

  function focusCell(cell) {
    if (!cell) return;
    if (roving.first && roving.first !== cell) {
      roving.first.tabIndex = -1;
      cell.tabIndex = 0;
      roving.first = cell;
      cell.focus();
      return;
    }
    cell.focus();
  }

  board.addEventListener('keydown', (e) => {
    const cell = e.target.closest('.cell');
    if (!cell || cell.classList.contains('void')) return;

    const r = Number(cell.dataset.r);
    const c = Number(cell.dataset.c);
    const move = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key];
    if (!move) return;

    e.preventDefault();
    let rr = r;
    let cc = c;
    for (;;) {
      rr += move[0];
      cc += move[1];
      if (rr < 0 || rr > 30 || cc < 0 || cc > 11) return;
      const t = cells[rr][cc];
      if (t && !t.classList.contains('void')) { focusCell(t); return; }
    }
  });

  board.addEventListener('focusin', (e) => {
    const cell = e.target.closest('.cell');
    if (!cell) return;
    if (roving.first && roving.first !== cell) roving.first.tabIndex = -1;
    cell.tabIndex = 0;
    roving.first = cell;
  });

  /* ---------------- テーマ ---------------- */

  const btnTheme = document.getElementById('btn-theme');
  function setTheme(theme) {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem(THEME_KEY, theme); } catch { /* noop */ }
  }
  btnTheme.addEventListener('click', () => {
    setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  });

  (() => {
    const fromQuery = new URLSearchParams(location.search).get('theme');
    if (fromQuery === 'light' || fromQuery === 'dark') { setTheme(fromQuery); return; }
    let saved = null;
    try { saved = localStorage.getItem(THEME_KEY); } catch { /* noop */ }
    setTheme(saved || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  })();

  /* ---------------- 書き出し / 読み込み / 印刷 ---------------- */

  document.getElementById('btn-export').addEventListener('click', () => {
    const payload = {
      year: DATA.year,
      exportedAt: new Date().toISOString(),
      notes,
      events: eventMap,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = '2027-calendar-notes.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  document.getElementById('btn-import').addEventListener('click', () => fileInput.click());

  async function readJSONFile(file) {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const incomingNotes = parsed && typeof parsed.notes === 'object' ? parsed.notes : null;
      const incomingEvents = parsed && parsed.events && typeof parsed.events === 'object' ? parsed.events : null;
      if (!incomingNotes && !incomingEvents) throw new Error('notes / events が見つかりません');
      if (!confirm('現在のメモと予定を読み込んだ内容で置き換えます。よろしいですか？')) return;

      notes = {};
      for (const [k, v] of Object.entries(incomingNotes || {})) {
        if (typeof v === 'string' && v.trim()) notes[k] = v;
      }
      persist();

      eventMap = {};
      for (const [k, list] of Object.entries(incomingEvents || {})) {
        if (!Array.isArray(list)) continue;
        const clean = list.filter(isValidEvent).map(normEvent);
        if (clean.length) eventMap[k] = clean;
      }
      persistEvents();

      refreshTexts();
      renderAllDays();
    } catch (err) {
      alert(`読み込めませんでした: ${err.message}`);
    }
  }

  fileInput.addEventListener('change', () => {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    readJSONFile(file);
  });

  function refreshTexts() {
    for (const row of cells) {
      for (const cell of row) {
        if (!cell || cell.classList.contains('void')) continue;
        refreshCell(cell.dataset.date);
      }
    }
  }

  document.getElementById('btn-print').addEventListener('click', () => window.print());

  /* ---------------- iCalendar の取り込み ---------------- */

  const icsInput = document.getElementById('ics-input');

  function readICSFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const { added, total } = importICS(String(reader.result || ''));
        if (!total) { alert('.ics に予定（VEVENT）が見つかりませんでした。'); return; }
        alert(
          added
            ? `${added} 件の予定を取り込みました。\n（.ics 内の予定 ${total} 件 / 2027年前後の期間を展開）`
            : '.ics の予定はすべて取り込み済みでした。',
        );
      } catch (err) {
        alert(`読み込めませんでした: ${err.message}`);
      }
    };
    reader.readAsText(file, 'utf-8');
  }

  document.getElementById('btn-ics').addEventListener('click', () => icsInput.click());
  icsInput.addEventListener('change', () => {
    const file = icsInput.files && icsInput.files[0];
    icsInput.value = '';
    readICSFile(file);
  });

  // .ics / .json をウィンドウへドラッグ＆ドロップ
  document.addEventListener('dragover', (e) => {
    if (!e.dataTransfer) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    document.body.classList.add('dropping');
  });
  document.addEventListener('dragleave', (e) => {
    if (e.relatedTarget === null) document.body.classList.remove('dropping');
  });
  document.addEventListener('drop', (e) => {
    if (!e.dataTransfer) return;
    e.preventDefault();
    document.body.classList.remove('dropping');
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (!file) return;
    if (/\.ics$/i.test(file.name) || file.type === 'text/calendar') {
      readICSFile(file);
    } else if (/\.json$/i.test(file.name)) {
      readJSONFile(file);
    }
  });

  /* ---------------- 週間ビュー ---------------- */

  const scroller = document.getElementById('scroller');
  const paneYear = document.getElementById('pane-year');
  const paneWeek = document.getElementById('pane-week');
  const weeksEl = document.getElementById('weeks');
  const weekRangeEl = document.getElementById('wk-range');
  const weekSubEl = document.getElementById('wk-sub');
  const weekJumpEl = document.getElementById('wk-jump');
  const tabs = [...document.querySelectorAll('.vt')];

  const DAY_MS = 86400000;
  const isoOf = (d) => d.toISOString().slice(0, 10);
  const pct = (min) => `${(min / 1440) * 100}%`;

  const gridStart = new Date(Date.UTC(DATA.year, 0, 1));
  gridStart.setUTCDate(1 - gridStart.getUTCDay()); // 直前の日曜
  const gridEnd = new Date(Date.UTC(DATA.year, 11, 31));
  gridEnd.setUTCDate(31 + (6 - gridEnd.getUTCDay())); // 直後の土曜

  const weeks = [];
  for (let d = new Date(gridStart); d <= gridEnd; d.setUTCDate(d.getUTCDate() + 7)) {
    weeks.push(new Date(d));
  }

  const dcolIndex = new Map(); // iso -> { col, head }
  let weekIndex = 0;
  let currentPane = 'year';

  function buildWeeks() {
    const frag = document.createDocumentFragment();

    for (let w = 0; w < weeks.length; w++) {
      const start = weeks[w];
      const art = document.createElement('article');
      art.className = 'week';
      art.dataset.index = String(w);

      const headRow = document.createElement('div');
      headRow.className = 'wk-days';
      const padCell = document.createElement('div');
      padCell.className = 'pad';
      headRow.appendChild(padCell);

      const allDayRow = document.createElement('div');
      allDayRow.className = 'wk-allday';
      const adLabel = document.createElement('div');
      adLabel.className = 'ad-label';
      adLabel.textContent = '終日';
      allDayRow.appendChild(adLabel);

      const body = document.createElement('div');
      body.className = 'wk-body';

      const hours = document.createElement('div');
      hours.className = 'wk-hours';
      hours.setAttribute('aria-hidden', 'true');
      for (let h = 0; h < 24; h++) {
        const s = document.createElement('span');
        s.textContent = pad(h);
        hours.appendChild(s);
      }
      body.appendChild(hours);

      for (let i = 0; i < 7; i++) {
        const date = new Date(start.getTime() + i * DAY_MS);
        const iso = isoOf(date);
        const day = byDate.get(iso);
        const dow = date.getUTCDay();

        const head = document.createElement('div');
        head.className = 'wk-dayhead';
        if (dow === 0) head.classList.add('sun');
        if (dow === 6) head.classList.add('sat');
        if (!day) head.classList.add('out');
        if (day && day.term) head.classList.add('term');

        const phaseIdx = day ? iconIndex(day.phase) : 0;
        head.innerHTML =
          `<span class="d">${date.getUTCDate()}</span>` +
          `<span class="w">${DOW[dow]}</span>` +
          `<svg class="mp wk-mp${day && day.phaseEvent ? ' major' : ''}" viewBox="0 0 32 32" aria-hidden="true">` +
          `<use href="#mp-${phaseIdx}"/></svg>`;
        headRow.appendChild(head);

        const adCol = document.createElement('div');
        adCol.className = 'adcol';
        if (dow === 0) adCol.classList.add('sun');
        if (dow === 6) adCol.classList.add('sat');
        if (!day) adCol.classList.add('out');
        adCol.dataset.date = iso;
        allDayRow.appendChild(adCol);

        const col = document.createElement('div');
        col.className = 'dcol';
        col.dataset.date = iso;
        if (dow === 0) col.classList.add('sun');
        if (dow === 6) col.classList.add('sat');
        if (!day) col.classList.add('out');
        if (day && day.term) col.classList.add('term');
        body.appendChild(col);

        dcolIndex.set(iso, { col, head, adCol });
      }

      art.appendChild(headRow);
      art.appendChild(allDayRow);
      art.appendChild(body);
      frag.appendChild(art);
    }

    weeksEl.appendChild(frag);
  }

  /* --- 予定の描画 --- */

  function paintEvent(el, ev) {
    const minutes = ev.e - ev.s;
    el.innerHTML =
      (minutes > 30 ? `<div class="ev-h">${fmtTime(ev.s)}–${fmtTime(ev.e)}</div>` : '') +
      `<div class="ev-t">${escapeHtml(ev.t || '（無題）')}</div>`;
  }

  function eventEl(iso, ev) {
    const el = document.createElement('div');
    el.className = 'ev';
    el.dataset.date = iso;
    el.dataset.id = ev.id;
    el.style.top = pct(ev.s);
    el.style.height = pct(ev.e - ev.s);
    if (ev.e - ev.s <= 30) el.classList.add('tiny');
    paintEvent(el, ev);
    return el;
  }

  function renderAllDay(iso) {
    const entry = dcolIndex.get(iso);
    if (!entry) return;
    entry.adCol.textContent = '';
    for (const item of allDayItems(iso)) {
      const chip = document.createElement('div');
      chip.className = `ad-chip${item.kind === 'note' ? ' note' : ''}`;
      chip.dataset.date = iso;
      chip.textContent = item.text;
      chip.title = item.text;
      entry.adCol.appendChild(chip);
    }
  }

  function renderDay(iso) {
    const entry = dcolIndex.get(iso);
    if (!entry) return;
    entry.col.querySelectorAll('.ev').forEach((el) => el.remove());
    for (const ev of eventsOf(iso)) {
      if (ev.ad) continue;
      entry.col.appendChild(eventEl(iso, ev));
    }
    renderAllDay(iso);
  }

  function renderAllDays() {
    for (const iso of dcolIndex.keys()) renderDay(iso);
  }

  function refreshCell(iso) {
    const cell = board.querySelector(`.cell[data-date="${iso}"]`);
    if (!cell) return;
    const txt = cell.querySelector('.txt');
    if (txt) txt.textContent = cellSummary(iso);
    cell.classList.toggle('has-ev', !!(eventMap[iso] && eventMap[iso].length));
    const day = byDate.get(iso);
    if (day) cell.title = `${Number(iso.slice(5, 7))}月${Number(iso.slice(8, 10))}日（${DOW[day.dow]}）　${phaseSummary(day)}${eventListTitle(iso)}`;
  }

  /* --- 予定の編集 --- */

  let editing = null;

  function startEdit(el) {
    if (editing) return;
    const iso = el.dataset.date;
    const id = el.dataset.id;
    const ev = (eventMap[iso] || []).find((x) => x.id === id);
    if (!ev) return;

    editing = { el, iso, id, prev: ev.t };
    el.classList.add('editing');
    el.innerHTML =
      '<input type="text" placeholder="予定" spellcheck="false" />' +
      '<button type="button" class="ev-del" aria-label="削除">×</button>';

    const input = el.querySelector('input');
    input.value = ev.t;
    editing.input = input;

    el.querySelector('.ev-del').addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      deleteEditing();
    });

    input.addEventListener('pointerdown', (e) => e.stopPropagation());
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); commitEditing(); }
      if (e.key === 'Escape') { e.preventDefault(); cancelEditing(); }
    });
    input.addEventListener('blur', () => { if (editing) commitEditing(); });

    requestAnimationFrame(() => { input.focus(); input.select(); });
  }

  function dropEvent(iso, id) {
    const list = eventMap[iso] || [];
    const i = list.findIndex((x) => x.id === id);
    if (i >= 0) {
      const removed = list[i];
      if (removed.tt && removed.tt.id) tombstones.push(removed.tt.id);
      list.splice(i, 1);
    }
    if (!list.length) delete eventMap[iso];
    persistEvents();
  }

  function commitEditing() {
    const ed = editing;
    if (!ed) return;
    editing = null;

    const value = (ed.input.value || '').trim();
    const ev = (eventMap[ed.iso] || []).find((x) => x.id === ed.id);

    if (!ev) { renderDay(ed.iso); return; }

    if (!value) {
      dropEvent(ed.iso, ed.id);
      renderDay(ed.iso);
      refreshCell(ed.iso);
      return;
    }

    ev.t = value;
    ev.dirty = true;
    persistEvents();
    ed.el.classList.remove('editing');
    paintEvent(ed.el, ev);
    refreshCell(ed.iso);
  }

  function cancelEditing() {
    const ed = editing;
    if (!ed) return;
    editing = null;
    const ev = (eventMap[ed.iso] || []).find((x) => x.id === ed.id);

    if (!ev || !ed.prev) {
      dropEvent(ed.iso, ed.id);
      renderDay(ed.iso);
      refreshCell(ed.iso);
      return;
    }

    ev.t = ed.prev;
    persistEvents();
    renderDay(ed.iso);
    refreshCell(ed.iso);
  }

  function deleteEditing() {
    const ed = editing;
    if (!ed) return;
    editing = null;
    dropEvent(ed.iso, ed.id);
    renderDay(ed.iso);
    refreshCell(ed.iso);
  }

  function createEvent(iso, s, e) {
    const ev = { id: uid(), s, e, t: '', dirty: true };
    (eventMap[iso] || (eventMap[iso] = [])).push(ev);
    persistEvents();
    renderDay(iso);
    refreshCell(iso);
    const el = dcolIndex.get(iso)?.col.querySelector(`.ev[data-id="${ev.id}"]`);
    if (el) startEdit(el);
  }

  /* --- ドラッグで予定作成 --- */

  let drag = null;

  weeksEl.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;

    const chip = e.target.closest('.ad-chip');
    if (chip) { openDayPopover(chip.dataset.date, chip); return; }

    const adCol = e.target.closest('.adcol');
    if (adCol) { openDayPopover(adCol.dataset.date, adCol); return; }

    const evEl = e.target.closest('.ev');
    if (evEl) { startEdit(evEl); return; }

    const col = e.target.closest('.dcol');
    if (!col || col.classList.contains('out')) return;

    const rect = col.getBoundingClientRect();
    const minute = snapMin(((e.clientY - rect.top) / rect.height) * 1440);
    drag = {
      col, rect, iso: col.dataset.date,
      anchor: minute, s: minute, e: minute, moved: false, el: null,
      x0: e.clientX, y0: e.clientY,
    };
    if (col.setPointerCapture) { try { col.setPointerCapture(e.pointerId); } catch { /* noop */ } }
  });

  weeksEl.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const minute = snapMin(((e.clientY - drag.rect.top) / drag.rect.height) * 1440);
    if (Math.abs(minute - drag.anchor) >= SNAP_MIN) drag.moved = true;

    const lo = Math.min(drag.anchor, minute);
    const hi = Math.max(drag.anchor, minute);
    drag.s = lo;
    drag.e = Math.min(1440, Math.max(hi, lo + SNAP_MIN));

    if (!drag.moved) return;
    if (!drag.el) {
      drag.el = document.createElement('div');
      drag.el.className = 'ev draft';
      drag.col.appendChild(drag.el);
    }
    drag.el.style.top = pct(drag.s);
    drag.el.style.height = pct(drag.e - drag.s);
  });

  function endDrag(e) {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (d.el) d.el.remove();

    // 横方向のスワイプ（週送り）は予定作成として扱わない
    if (e && Math.abs(e.clientX - d.x0) > 12 && Math.abs(e.clientX - d.x0) > Math.abs(e.clientY - d.y0)) return;

    if (!d.moved) {
      createEvent(d.iso, d.anchor, Math.min(1440, d.anchor + 60));
      return;
    }
    if (d.e - d.s >= SNAP_MIN) createEvent(d.iso, d.s, d.e);
  }

  weeksEl.addEventListener('pointerup', endDrag);
  weeksEl.addEventListener('pointercancel', () => {
    if (!drag) return;
    if (drag.el) drag.el.remove();
    drag = null;
  });

  /* --- 週の移動 --- */

  function updateWeekLabel() {
    const start = weeks[weekIndex];
    const end = new Date(start.getTime() + 6 * DAY_MS);
    const cell = (d) => {
      const out = d.getUTCFullYear() !== DATA.year;
      return `<span class="${out ? 'out' : ''}">${d.getUTCMonth() + 1}/${d.getUTCDate()}</span>`;
    };
    weekRangeEl.innerHTML = `${cell(start)}<span class="sep">–</span>${cell(end)}`;
    weekSubEl.textContent = `${weekIndex + 1} / ${weeks.length} 週`;
    const iso = isoOf(start);
    weekJumpEl.value = iso.slice(0, 4) === String(DATA.year) ? iso : '';
    document.getElementById('wk-prev').disabled = weekIndex === 0;
    document.getElementById('wk-next').disabled = weekIndex === weeks.length - 1;
  }

  function gotoWeek(i, instant = false) {
    weekIndex = Math.max(0, Math.min(weeks.length - 1, i));
    const left = weekIndex * weeksEl.clientWidth;

    // スムーススクロール中の中間位置で weekIndex を上書きしないようロックする
    scrollTarget = weekIndex;
    clearTimeout(scrollLockTimer);
    scrollLockTimer = setTimeout(() => { scrollTarget = null; }, instant ? 120 : 700);

    if (instant) weeksEl.scrollLeft = left;
    else weeksEl.scrollTo({ left, behavior: 'smooth' });
    updateWeekLabel();
  }

  function openWeek(iso, instant = false) {
    const target = new Date(`${iso}T00:00:00Z`);
    const days = Math.round((target - gridStart) / DAY_MS);
    gotoWeek(Math.floor(days / 7), instant);
  }

  function openDayPopover(iso, anchorEl) {
    const cell = board.querySelector(`.cell[data-date="${iso}"]`);
    if (cell) openPop(cell, anchorEl || cell);
  }

  function highlightDay(iso) {
    const entry = dcolIndex.get(iso);
    if (!entry) return;
    for (const el of [entry.col, entry.head]) {
      el.classList.remove('flash');
      void el.offsetWidth;
      el.classList.add('flash');
      setTimeout(() => el.classList.remove('flash'), 1800);
    }
  }

  function setViewTab(name) {
    for (const t of tabs) {
      const on = t.dataset.view === name;
      t.classList.toggle('on', on);
      t.setAttribute('aria-selected', String(on));
    }
  }

  function showPane(name) {
    currentPane = name;
    const top = name === 'week' ? paneWeek.offsetTop : 0;
    scroller.scrollTo({ top, behavior: 'smooth' });
    setViewTab(name);
  }

  function showWeekView(iso) {
    closePop();
    openWeek(iso);
    showPane('week');
    highlightDay(iso);
  }

  let scrollRaf = 0;
  let scrollTarget = null;
  let scrollLockTimer = 0;

  weeksEl.addEventListener('scroll', () => {
    if (scrollRaf) return;
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = 0;
      const width = weeksEl.clientWidth || 1;

      if (scrollTarget !== null) {
        if (Math.abs(weeksEl.scrollLeft - scrollTarget * width) < 2) scrollTarget = null;
        return;
      }

      const idx = Math.round(weeksEl.scrollLeft / width);
      if (idx !== weekIndex && idx >= 0 && idx < weeks.length) {
        weekIndex = idx;
        updateWeekLabel();
      }
    });
  }, { passive: true });

  document.getElementById('wk-prev').addEventListener('click', () => gotoWeek(weekIndex - 1));
  document.getElementById('wk-next').addEventListener('click', () => gotoWeek(weekIndex + 1));
  weekJumpEl.addEventListener('change', () => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(weekJumpEl.value)) openWeek(weekJumpEl.value);
  });

  for (const t of tabs) {
    t.addEventListener('click', () => showPane(t.dataset.view));
  }

  let paneRaf = 0;
  scroller.addEventListener('scroll', () => {
    if (paneRaf) return;
    paneRaf = requestAnimationFrame(() => {
      paneRaf = 0;
      const name = scroller.scrollTop > scroller.clientHeight * 0.5 ? 'week' : 'year';
      if (name !== currentPane) {
        currentPane = name;
        setViewTab(name);
      }
    });
  }, { passive: true });

  document.getElementById('hint-week').addEventListener('click', () => showPane('week'));
  document.getElementById('hint-year').addEventListener('click', () => showPane('year'));

  document.addEventListener('keydown', (e) => {
    if (editing || currentPane !== 'week') return;
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); gotoWeek(weekIndex - 1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); gotoWeek(weekIndex + 1); }
  });

  document.getElementById('pop-week').addEventListener('click', () => {
    if (!openCell) return;
    showWeekView(openCell.dataset.date);
  });

  /* ---------------- 起動 ---------------- */

  async function boot() {
    await loadServerState();

    buildSprite();
    buildBoard();
    buildWeeks();
    renderAllDays();
    updateWeekLabel();
    setupAuthButtons();
    setupSyncButton();

    {
      const today = new Date();
      const todayISO = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
      const entry = dcolIndex.get(todayISO);
      if (entry) {
        entry.col.classList.add('today');
        entry.head.classList.add('today');
      }
    }

    // #2027-03-21 のように指定すると、その日のメモを開いた状態で起動する
    // #week-2027-03-21 なら週表示でその週を開く
    const hash = location.hash.slice(1);
    if (/^week-\d{4}-\d{2}-\d{2}$/.test(hash)) {
      const iso = hash.slice(5);
      openWeek(iso, true);
      scroller.scrollTop = paneWeek.offsetTop;
      setViewTab('week');
      currentPane = 'week';
      highlightDay(iso);
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(hash)) {
      const target = board.querySelector(`.cell[data-date="${hash}"]`);
      if (target) openPop(target);
    }

    const ro = new ResizeObserver(() => fit());
    ro.observe(board);
    window.addEventListener('resize', () => {
      fit();
      weeksEl.scrollLeft = weekIndex * weeksEl.clientWidth;
    });
    fit();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit);
  }

  /* ---------------- 同期ボタン ---------------- */

  function showLoginDialog() {
    const dialog = document.getElementById('auth-dialog');
    const form = document.getElementById('auth-form');
    const input = document.getElementById('auth-password');
    const error = document.getElementById('auth-error');
    const cancel = document.getElementById('auth-cancel');

    return new Promise((resolve) => {
      let settled = false;
      const finish = (ok) => {
        if (settled) return;
        settled = true;
        form.removeEventListener('submit', onSubmit);
        cancel.removeEventListener('click', onCancel);
        dialog.removeEventListener('close', onClose);
        resolve(ok);
      };
      const onClose = () => finish(false);
      const onCancel = () => dialog.close();
      const onSubmit = async (event) => {
        event.preventDefault();
        const submit = form.querySelector('[type="submit"]');
        submit.disabled = true;
        error.hidden = true;
        try {
          const res = await fetch(`${API_BASE}api/login`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ password: input.value }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'ログインできませんでした');
          input.value = '';
          finish(true);
          dialog.close();
        } catch (err) {
          error.textContent = err.message;
          error.hidden = false;
        } finally {
          submit.disabled = false;
        }
      };

      error.hidden = true;
      input.value = '';
      form.addEventListener('submit', onSubmit);
      cancel.addEventListener('click', onCancel);
      dialog.addEventListener('close', onClose);
      dialog.showModal();
      input.focus();
    });
  }

  function setupAuthButtons() {
    const login = document.getElementById('btn-login');
    const logout = document.getElementById('btn-logout');
    if (!login || !logout || !serverMode) return;

    login.hidden = serverAuthenticated;
    logout.hidden = !serverAuthenticated;

    if (!login.dataset.bound) {
      login.dataset.bound = 'true';
      login.addEventListener('click', async () => {
        if (!await showLoginDialog()) return;
        await loadServerState();
        setupAuthButtons();
        setupSyncButton();
        refreshAllFromState();
      });
    }

    if (!logout.dataset.bound) {
      logout.dataset.bound = 'true';
      logout.addEventListener('click', async () => {
        try {
          const res = await fetch(`${API_BASE}api/logout`, {
            method: 'POST',
            credentials: 'include',
          });
          if (!res.ok) throw new Error('ログアウトに失敗しました');
          location.reload();
        } catch (err) {
          alert(err.message);
        }
      });
    }
  }

  function setupSyncButton() {
    const btn = document.getElementById('btn-sync');
    if (!btn || !serverMode) return;
    if (!serverAuthenticated) {
      btn.hidden = true;
      return;
    }
    btn.hidden = false;

    if (!serverCanSync) {
      btn.disabled = true;
      btn.textContent = '同期（未設定）';
      btn.title = 'tools/.env に TIMETREE_EMAIL / TIMETREE_PASSWORD を設定すると同期できます';
      return;
    }

    if (btn.dataset.bound) return;
    btn.dataset.bound = 'true';
    const setState = (text, tone) => {
      btn.textContent = text;
      btn.dataset.tone = tone || '';
    };

    btn.addEventListener('click', async () => {
      if (btn.disabled) return;
      btn.disabled = true;
      const label = btn.textContent;
      setState('同期中…', 'busy');
      try {
        const res = await fetch(`${API_BASE}api/sync`, {
          method: 'POST',
          credentials: 'include',
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || '同期に失敗しました');

        applyState(data.state || {});
        tombstones = Array.isArray(data.state?.tombstones) ? data.state.tombstones : [];

        const p = data.pull || {};
        const q = data.push || {};
        setState(
          `↑${p.added ?? 0} ↘${q.created + q.updated ?? 0}${q.failed ? ` !${q.failed}` : ''}`,
          q.failed ? 'warn' : 'ok',
        );
        btn.title =
          `${data.calendar} と同期しました\n` +
          `取得 ${data.fetched} 件 / 追加 ${p.added ?? 0}・更新 ${p.updated ?? 0}・削除 ${p.removed ?? 0}\n` +
          `送信 作成 ${q.created ?? 0}・更新 ${q.updated ?? 0}・削除 ${q.deleted ?? 0}` +
          (q.failed ? `\n失敗 ${q.failed} 件（TimeTree 側の権限や仕様変更の可能性）` : '');

        refreshAllFromState();
      } catch (err) {
        setState('同期失敗', 'warn');
        btn.title = err.message;
        alert(`同期できませんでした:\n${err.message}`);
      } finally {
        btn.disabled = false;
        setTimeout(() => { if (btn.textContent !== label) setState('同期', ''); }, 6000);
      }
    });
  }

  function refreshAllFromState() {
    for (const row of cells) {
      for (const cell of row) {
        if (cell && !cell.classList.contains('void')) refreshCell(cell.dataset.date);
      }
    }
    renderAllDays();
    if (openCell) openPop(openCell, pop);
  }

  boot();
})();
