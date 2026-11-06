/* 2027 Lunar Almanac */
(() => {
  'use strict';

  const ASTRO = window.LUNAR_ASTRO;
  if (!ASTRO) {
    document.body.innerHTML =
      '<p style="font:14px system-ui;padding:24px">astro.js を読み込めませんでした。</p>';
    return;
  }

  const DOW = ['日', '月', '火', '水', '木', '金', '土'];
  const MON_EN = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const SYNODIC = 29.530588853;
  const STEPS = 24;                 // 月アイコンの分割数（15度刻み）
  const NOTES_KEY = 'lunar2027.notes.v1';
  const THEME_KEY = 'lunar2027.theme.v1';
  const YEAR_KEY = 'lunar2027.year.v1';
  const YEAR_MIN = 1900;
  const YEAR_MAX = 2100;
  const PHASE_LABEL = { new: '新月', first: '上弦', full: '満月', last: '下弦' };
  const PHASE_KEYS = [null, 'new', 'first', 'full', 'last'];

  /* ---------------- 天文データ（年ごとに計算） ---------------- */

  const YEAR_CACHE = new Map();
  let year = 2027;
  let DATA = null;          // { year, days, terms }
  let DAYS = [];
  let byDate = new Map();
  let termByDate = new Map();

  function dataOfYear(y) {
    let data = YEAR_CACHE.get(y);
    if (!data) {
      data = ASTRO.buildYear(y);
      YEAR_CACHE.set(y, data);
    }
    return data;
  }

  function useYear(y) {
    year = y;
    DATA = dataOfYear(y);
    DAYS = DATA.days;
    byDate = new Map(DAYS.map((d) => [d.date, d]));
    termByDate = new Map(DATA.terms.map((t) => [t.date, t]));
  }

  const todayISO = () => {
    const now = new Date();
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  };

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

  /* ---------------- メモの保存 ---------------- */

  let notes = {};
  try {
    notes = JSON.parse(localStorage.getItem(NOTES_KEY) || '{}') || {};
  } catch {
    notes = {};
  }
  const persist = () => {
    try { localStorage.setItem(NOTES_KEY, JSON.stringify(notes)); } catch { /* 容量不足などは無視 */ }
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

  const persistEvents = () => {
    try { localStorage.setItem(EVENTS_KEY, JSON.stringify(eventMap)); } catch { /* noop */ }
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

  // 年間・週間の各日に置くアイコン。月面画像を使わず金色のパスだけを描くので、
  // 数百個並べても描画が重くならない（画像入りの記号はポップオーバーだけに使う）。
  function moonIcon(phase, major) {
    return (
      `<svg class="mp${major ? ' major' : ''}" viewBox="0 0 32 32" aria-hidden="true" focusable="false">` +
      `<circle cx="16" cy="16" r="14" fill="none" stroke="currentColor" stroke-opacity=".16" stroke-width=".7"/>` +
      `<path d="${litPath(phase)}" fill="url(#moonGold)"/>` +
      `</svg>`
    );
  }

  /* ---------------- グリッド構築 ---------------- */

  const cells = [];       // フォーカス移動用（31 x 12）
  const roving = { first: null };

  function makeCell(m, d) {
    const iso = `${year}-${pad(m)}-${pad(d)}`;
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

    cell.innerHTML =
      moonIcon(day.phase, !!day.phaseEvent) +
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
    if (openCell) closePop();
    board.textContent = '';
    cells.length = 0;
    roving.first = null;
    board.setAttribute('aria-label', `${year}年 年間カレンダー`);

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

    const today = todayISO();

    for (let d = 1; d <= 31; d++) {
      const dn = document.createElement('div');
      dn.className = d % 5 === 0 ? 'dn five' : 'dn';
      dn.textContent = String(d);
      dn.setAttribute('aria-hidden', 'true');
      frag.appendChild(dn);

      const row = [];
      for (let m = 1; m <= 12; m++) {
        const cell = makeCell(m, d);
        if (cell.dataset.date === today) cell.classList.add('today');
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
    a.download = 'lunar-calendar-backup.json';
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

  // Accept JSON schedule files dropped onto the window.
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
    if (file && /\.json$/i.test(file.name)) readJSONFile(file);
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

  let weeks = [];
  let gridStart = new Date(Date.UTC(year, 0, 1));

  const dcolIndex = new Map(); // iso -> { col, head, adCol }（実体化済みの週のみ）
  const weekState = new Map(); // index -> { art, built }
  let weekIndex = 0;
  let currentPane = 'year';

  const WEEK_BUFFER = 2; // 表示中の週の前後どこまで組み立てておくか
  const WEEK_KEEP = 4;   // これ以上離れた週は DOM を捨てる

  function computeWeeks() {
    gridStart = new Date(Date.UTC(year, 0, 1));
    gridStart.setUTCDate(1 - gridStart.getUTCDay()); // 直前の日曜
    const gridEnd = new Date(Date.UTC(year, 11, 31));
    gridEnd.setUTCDate(31 + (6 - gridEnd.getUTCDay())); // 直後の土曜

    weeks = [];
    for (let d = new Date(gridStart); d <= gridEnd; d.setUTCDate(d.getUTCDate() + 7)) {
      weeks.push(new Date(d));
    }
  }

  function weekIso(w, i) {
    return isoOf(new Date(weeks[w].getTime() + i * DAY_MS));
  }

  // 週の枠だけを先に作る。中身は表示範囲だけ組み立てるので、53週ぶんの
  // DOM を一度に持たなくて済み、横スクロールが軽くなる。
  function buildWeeks() {
    weeksEl.textContent = '';
    weeksEl.scrollLeft = 0;
    dcolIndex.clear();
    weekState.clear();
    computeWeeks();
    weekIndex = Math.max(0, Math.min(weeks.length - 1, weekIndex));

    const frag = document.createDocumentFragment();
    for (let w = 0; w < weeks.length; w++) {
      const art = document.createElement('article');
      art.className = 'week';
      art.dataset.index = String(w);
      frag.appendChild(art);
      weekState.set(w, { art, built: false });
    }
    weeksEl.appendChild(frag);
    ensureWeeks(weekIndex);
  }

  function buildWeekContent(w) {
    const st = weekState.get(w);
    if (!st || st.built) return;

    const start = weeks[w];
    const today = todayISO();
    const art = st.art;

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
      if (iso === today) head.classList.add('today');

      head.innerHTML =
        `<span class="d">${date.getUTCDate()}</span>` +
        `<span class="w">${DOW[dow]}</span>` +
        (day ? moonIcon(day.phase, !!day.phaseEvent) : moonIcon(0, false));
      const mp = head.querySelector('svg');
      if (mp) mp.classList.add('wk-mp');
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
      if (iso === today) col.classList.add('today');
      body.appendChild(col);

      dcolIndex.set(iso, { col, head, adCol });
    }

    art.appendChild(headRow);
    art.appendChild(allDayRow);
    art.appendChild(body);
    st.built = true;

    for (let i = 0; i < 7; i++) renderDay(weekIso(w, i));
  }

  function clearWeekContent(w) {
    const st = weekState.get(w);
    if (!st || !st.built) return;
    for (let i = 0; i < 7; i++) dcolIndex.delete(weekIso(w, i));
    st.art.textContent = '';
    st.built = false;
  }

  function weekHas(w, iso) {
    for (let i = 0; i < 7; i++) if (weekIso(w, i) === iso) return true;
    return false;
  }

  function ensureWeeks(center) {
    if (!weeks.length) return;
    const c = Math.max(0, Math.min(weeks.length - 1, center));
    const lo = Math.max(0, c - WEEK_BUFFER);
    const hi = Math.min(weeks.length - 1, c + WEEK_BUFFER);
    for (let w = lo; w <= hi; w++) buildWeekContent(w);

    for (const [w, st] of weekState) {
      if (!st.built || Math.abs(w - c) <= WEEK_KEEP) continue;
      if (editing && weekHas(w, editing.iso)) continue;
      if (drag && weekHas(w, drag.iso)) continue;
      clearWeekContent(w);
    }
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
    const ev = { id: uid(), s, e, t: '' };
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
    weekJumpEl.value = iso.slice(0, 4) === String(year) ? iso : '';
    document.getElementById('wk-prev').disabled = weekIndex === 0;
    document.getElementById('wk-next').disabled = weekIndex === weeks.length - 1;
  }

  function gotoWeek(i, instant = false) {
    const previous = weekIndex;
    weekIndex = Math.max(0, Math.min(weeks.length - 1, i));
    ensureWeeks(weekIndex);
    const left = weekIndex * weeksEl.clientWidth;

    // 遠くへ飛ぶときはアニメーションせず、その場で切り替える（長距離スクロールは重い）
    const jump = instant || Math.abs(weekIndex - previous) > 3;

    // スムーススクロール中の中間位置で weekIndex を上書きしないようロックする
    scrollTarget = weekIndex;
    clearTimeout(scrollLockTimer);
    scrollLockTimer = setTimeout(() => { scrollTarget = null; }, jump ? 120 : 700);

    if (jump) weeksEl.scrollLeft = left;
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
  let weekEnsureTimer = 0;

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
        // スムーススクロール中に何度も組み立てないよう、止まってから用意する
        clearTimeout(weekEnsureTimer);
        weekEnsureTimer = setTimeout(() => ensureWeeks(weekIndex), 140);
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

  /* ---------------- 年の切り替え ---------------- */

  const yearInput = document.getElementById('yr-input');
  const sheetDialog = document.getElementById('sheet-dialog');
  const sheetFrom = document.getElementById('sheet-from');
  const sheetTo = document.getElementById('sheet-to');

  function clampYear(value) {
    const y = Math.round(Number(value));
    if (!Number.isFinite(y) || y < YEAR_MIN || y > YEAR_MAX) return 0;
    return y;
  }

  function applyYearMeta() {
    document.title = `${year} 年間カレンダー — Lunar Almanac`;
    board.setAttribute('aria-label', `${year}年 年間カレンダー`);
    weekJumpEl.min = `${year}-01-01`;
    weekJumpEl.max = `${year}-12-31`;
    document.getElementById('sheet-year-label').textContent = `${year}年`;
  }

  function renderYear() {
    buildBoard();
    buildWeeks();
    updateWeekLabel();
    fit();
  }

  function setYear(next, options = {}) {
    const y = clampYear(next);
    if (!y) {
      yearInput.value = String(year);
      return;
    }
    if (y === year && !options.force) {
      yearInput.value = String(year);
      return;
    }

    closePop();
    useYear(y);
    yearInput.value = String(y);
    weekIndex = Number.isInteger(options.weekIndex) ? options.weekIndex : 0;
    applyYearMeta();
    renderYear();
    try { localStorage.setItem(YEAR_KEY, String(y)); } catch { /* noop */ }
    try {
      const url = new URL(location.href);
      url.searchParams.set('year', String(y));
      history.replaceState(null, '', url);
    } catch { /* file:// などでは URL を書き換えない */ }
  }

  document.getElementById('yr-prev').addEventListener('click', () => setYear(year - 1));
  document.getElementById('yr-next').addEventListener('click', () => setYear(year + 1));
  yearInput.addEventListener('focus', () => yearInput.select());
  yearInput.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    setYear(yearInput.value);
    yearInput.blur();
  });
  yearInput.addEventListener('blur', () => setYear(yearInput.value));

  /* ---------------- 今日 ---------------- */

  function goToday() {
    const iso = todayISO();
    setYear(Number(iso.slice(0, 4)), { weekIndex: 0 });
    showWeekView(iso);
  }

  document.getElementById('btn-today').addEventListener('click', goToday);

  /* ---------------- 表計算（CSV）へ書き出し ---------------- */

  const csvCell = (value) => {
    const text = value == null ? '' : String(value);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  function downloadCsv(filename, rows) {
    const text = '\ufeff' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
    const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const phaseText = (day) => {
    if (!day) return '';
    return day.phaseEvent ? PHASE_LABEL[day.phaseEvent] : `月齢${(day.phase * SYNODIC).toFixed(1)}`;
  };

  const oneLine = (text) => String(text).replace(/\s*\r?\n\s*/g, ' / ');

  // 画面と同じ「日付 × 月」の表。セルに曜日・月相・メモ・予定をまとめる。
  function annualCsvRows(y) {
    const data = dataOfYear(y);
    const days = new Map(data.days.map((d) => [d.date, d]));
    const rows = [[`${y}年 年間カレンダー`], ['日付', ...Array.from({ length: 12 }, (_, i) => `${i + 1}月`)]];

    for (let d = 1; d <= 31; d++) {
      const row = [String(d)];
      for (let m = 1; m <= 12; m++) {
        const iso = `${y}-${pad(m)}-${pad(d)}`;
        const day = days.get(iso);
        if (!day) {
          row.push('');
          continue;
        }
        const parts = [DOW[day.dow], phaseText(day)];
        if (day.term) parts.push(day.term);
        if (notes[iso]) parts.push(oneLine(notes[iso]));
        for (const ev of eventsOf(iso)) {
          parts.push(ev.ad ? ev.t || '終日' : `${fmtTime(ev.s)}-${fmtTime(ev.e)} ${ev.t || '予定'}`);
        }
        row.push(parts.filter(Boolean).join(' '));
      }
      rows.push(row);
    }
    return rows;
  }

  // 開始日〜終了日の予定を1行1件で並べる。予定の無い日も日付だけ残す。
  function rangeCsvRows(from, to) {
    const rows = [['日付', '曜日', '開始', '終了', '予定', '種別', '月相', '二至二分']];
    const cache = new Map();
    const dayOf = (iso) => {
      const y = Number(iso.slice(0, 4));
      if (!cache.has(y)) cache.set(y, new Map(dataOfYear(y).days.map((d) => [d.date, d])));
      return cache.get(y).get(iso);
    };

    const start = new Date(`${from}T00:00:00Z`);
    const end = new Date(`${to}T00:00:00Z`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return null;
    const count = Math.round((end - start) / DAY_MS) + 1;

    for (let i = 0; i < count; i++) {
      const date = new Date(start.getTime() + i * DAY_MS);
      const iso = isoOf(date);
      const day = dayOf(iso);
      const dow = DOW[date.getUTCDay()];
      const phase = phaseText(day);
      const term = day && day.term ? day.term : '';
      const note = notes[iso];
      const list = eventsOf(iso);

      if (!note && !list.length) {
        rows.push([iso, dow, '', '', '', '', phase, term]);
        continue;
      }
      if (note) rows.push([iso, dow, '', '', oneLine(note), 'メモ', phase, term]);
      for (const ev of list) {
        rows.push([
          iso,
          dow,
          ev.ad ? '' : fmtTime(ev.s),
          ev.ad ? '' : fmtTime(ev.e),
          ev.t || (ev.ad ? '終日' : '予定'),
          ev.ad ? '終日' : '予定',
          phase,
          term,
        ]);
      }
    }
    return rows;
  }

  let sheetYear = 0;

  function openSheetDialog() {
    if (sheetYear !== year) {
      sheetFrom.value = `${year}-01-01`;
      sheetTo.value = `${year}-12-31`;
      sheetYear = year;
    }
    document.getElementById('sheet-year-label').textContent = `${year}年`;
    if (typeof sheetDialog.showModal === 'function') sheetDialog.showModal();
    else sheetDialog.setAttribute('open', '');
  }

  document.getElementById('btn-sheet').addEventListener('click', openSheetDialog);
  document.getElementById('sheet-close').addEventListener('click', () => sheetDialog.close());
  document.getElementById('sheet-year').addEventListener('click', () => {
    downloadCsv(`lunar-${year}-calendar.csv`, annualCsvRows(year));
  });
  document.getElementById('sheet-range').addEventListener('click', () => {
    const from = sheetFrom.value;
    const to = sheetTo.value;
    if (!from || !to) {
      alert('開始と終了の日付を入力してください。');
      return;
    }
    if (from > to) {
      alert('開始日は終了日より前にしてください。');
      return;
    }
    const rows = rangeCsvRows(from, to);
    if (!rows) {
      alert('日付を読み取れませんでした。');
      return;
    }
    if (rows.length > 3002) {
      alert('期間が長すぎます（最大3000日）。');
      return;
    }
    downloadCsv(`lunar-${from}_${to}.csv`, rows);
  });

  /* ---------------- 起動 ---------------- */

  function initialYear() {
    const m = /^(?:week-)?(\d{4})-\d{2}-\d{2}$/.exec(location.hash.slice(1));
    if (m) {
      const y = clampYear(m[1]);
      if (y) return y;
    }
    const query = clampYear(new URLSearchParams(location.search).get('year'));
    if (query) return query;
    let saved = 0;
    try { saved = clampYear(localStorage.getItem(YEAR_KEY)); } catch { saved = 0; }
    return saved || 2027;
  }

  function boot() {
    useYear(initialYear());
    yearInput.value = String(year);
    applyYearMeta();

    buildSprite();
    buildBoard();
    buildWeeks();
    updateWeekLabel();

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
      ensureWeeks(weekIndex);
    });
    fit();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit);
  }

  boot();
})();
