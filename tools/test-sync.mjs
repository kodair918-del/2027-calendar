/**
 * 擬似 TimeTree サーバーに対する同期ロジックの統合テスト。
 *   node tools/test-sync.mjs
 */
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import { createClient } from './timetree-client.mjs';
import {
  emptyState,
  mergePull,
  pushLocal,
  fetchAllEvents,
  ttToLocalEvents,
  localToPayload,
  msToParts,
} from './timetree-sync.mjs';

const JST = 9 * 3600000;
const utcMidnight = (iso) => Date.parse(`${iso}T00:00:00Z`);
const jstMs = (iso, minute) => Date.parse(`${iso}T00:00:00Z`) + minute * 60000 - JST;

const received = { created: [], updated: [], deleted: [] };

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const send = (code, body, headers = {}) => {
    res.writeHead(code, { 'content-type': 'application/json', ...headers });
    res.end(body === undefined ? '' : JSON.stringify(body));
  };

  if (url.pathname === '/signin') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<html><head><meta name="csrf-token" content="csrf-abc"></head></html>');
    return;
  }

  if (url.pathname === '/api/v1/auth/email/signin' && req.method === 'PUT') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const parsed = JSON.parse(body);
      assert.equal(parsed.uid, 'me@example.com');
      send(200, { user: { id: 42 } }, {
        'set-cookie': '_session_id=sess-123; Path=/; HttpOnly',
        'x-csrf-token': 'csrf-after',
      });
    });
    return;
  }

  if (url.pathname === '/api/v1/user') return send(200, { user: { id: 42, name: 'Tester' } });
  if (url.pathname === '/api/v2/calendars') return send(200, { calendars: [{ id: 777, name: '家族' }] });

  if (url.pathname === '/api/v1/calendar/777/events/sync') {
    const since = url.searchParams.get('since');
    if (!since) {
      return send(200, {
        chunk: true,
        since: 1000,
        events: [
          { id: 'tt-1', title: '家族旅行', all_day: true, start_at: utcMidnight('2027-03-14'), end_at: utcMidnight('2027-03-16'), start_timezone: 'UTC', end_timezone: 'UTC', updated_at: 111 },
          { id: 'tt-2', title: '定例ミーティング', all_day: false, start_at: jstMs('2027-03-15', 630), end_at: jstMs('2027-03-15', 720), start_timezone: 'Asia/Tokyo', end_timezone: 'Asia/Tokyo', updated_at: 222 },
        ],
      });
    }
    return send(200, {
      chunk: false,
      since: 2000,
      events: [
        { id: 'tt-3', title: '夜勤', all_day: false, start_at: jstMs('2027-03-16', 1320), end_at: jstMs('2027-03-17', 360), start_timezone: 'Asia/Tokyo', end_timezone: 'Asia/Tokyo', updated_at: 333 },
      ],
    });
  }

  if (/^\/api\/v1\/calendar\/777\/event$/.test(url.pathname) && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const payload = JSON.parse(body);
      received.created.push(payload);
      send(200, { event: { id: `new-${received.created.length}`, ...payload, updated_at: 999 } });
    });
    return;
  }

  if (/^\/api\/v1\/calendar\/777\/event\/[^/]+$/.test(url.pathname) && req.method === 'PUT') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      received.updated.push(JSON.parse(body));
      send(200, { event: { id: url.pathname.split('/').pop(), updated_at: 999 } });
    });
    return;
  }

  if (/^\/api\/v1\/calendar\/777\/event\/[^/]+$/.test(url.pathname) && req.method === 'DELETE') {
    received.deleted.push(url.pathname.split('/').pop());
    res.writeHead(204);
    res.end();
    return;
  }

  send(404, { error: 'not found' });
});

await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

const results = [];
const check = (name, fn) => {
  try {
    fn();
    results.push(`PASS  ${name}`);
  } catch (err) {
    results.push(`FAIL  ${name}\n      ${err.message}`);
    process.exitCode = 1;
  }
};

try {
  // --- 変換 ---
  const allDay = ttToLocalEvents({
    id: 'x', title: '家族旅行', all_day: true,
    start_at: utcMidnight('2027-03-14'), end_at: utcMidnight('2027-03-16'),
    start_timezone: 'UTC', end_timezone: 'UTC',
  });
  check('終日は開始〜終了（包含）の各日に展開', () => {
    assert.equal(allDay.length, 3);
    assert.deepEqual(allDay.map((e) => e.iso), ['2027-03-14', '2027-03-15', '2027-03-16']);
    assert.ok(allDay.every((e) => e.ad && e.s === 0 && e.e === 1440));
  });

  const timed = ttToLocalEvents({
    id: 'y', title: '会議', all_day: false,
    start_at: jstMs('2027-03-15', 630), end_at: jstMs('2027-03-15', 720),
    start_timezone: 'Asia/Tokyo', end_timezone: 'Asia/Tokyo',
  });
  check('時刻付きは JST の分に変換', () => {
    assert.equal(timed.length, 1);
    assert.equal(timed[0].iso, '2027-03-15');
    assert.equal(timed[0].s, 630);
    assert.equal(timed[0].e, 720);
  });

  const overnight = ttToLocalEvents({
    id: 'z', title: '夜勤', all_day: false,
    start_at: jstMs('2027-03-16', 1320), end_at: jstMs('2027-03-17', 360),
    start_timezone: 'Asia/Tokyo', end_timezone: 'Asia/Tokyo',
  });
  check('日跨ぎは 2 日に分割', () => {
    assert.equal(overnight.length, 2);
    assert.deepEqual([overnight[0].s, overnight[0].e], [1320, 1440]);
    assert.deepEqual([overnight[1].iso, overnight[1].s, overnight[1].e], ['2027-03-17', 0, 360]);
  });

  // --- ログイン + 取得 + マージ ---
  const client = createClient({ base });
  await client.signin('me@example.com', 'secret');
  check('ログインでセッション Cookie を保持', () => assert.ok(client.hasSession()));

  const calendars = await client.getCalendars();
  check('カレンダー一覧', () => assert.equal(calendars[0].name, '家族'));

  const events = await fetchAllEvents(client, 777);
  check('ページングで全件取得', () => assert.equal(events.length, 3));

  const state = emptyState();
  const pull = mergePull(state, events, { fullSync: true });
  check('初回マージで 6 件（終日3 + 会議1 + 夜勤2）', () => {
    const total = Object.values(state.events).reduce((n, l) => n + l.length, 0);
    assert.equal(total, 6);
    assert.equal(pull.added, 6);
  });
  check('年間の範囲外は保存しない', () => {
    assert.ok(state.events['2027-03-14']);
    assert.ok(!Object.keys(state.events).some((iso) => iso < '2027-01-01' || iso > '2027-12-31'));
  });

  // --- ローカル編集 → プッシュ ---
  state.events['2027-05-01'] = [{ id: 'loc1', s: 600, e: 660, t: '新規の予定', dirty: true }];
  const localAllDay = { id: 'loc2', s: 0, e: 1440, t: '終日の用事', ad: true, dirty: true };
  state.events['2027-05-02'] = [localAllDay];
  state.events['2027-03-15'][0].t = '家族旅行（変更）';
  state.events['2027-03-15'][0].dirty = true;

  const push = await pushLocal(state, client, 777, 42);
  check('未同期は作成・既存は更新', () => {
    assert.equal(push.created, 2);
    assert.equal(push.updated, 1);
    assert.equal(push.failed, 0);
  });
  check('作成ペイロードが JST/UTC を正しく送る', () => {
    const timedPayload = received.created.find((p) => p.title === '新規の予定');
    assert.equal(timedPayload.all_day, false);
    assert.equal(timedPayload.start_timezone, 'Asia/Tokyo');
    assert.equal(new Date(timedPayload.start_at).toISOString(), '2027-05-01T01:00:00.000Z');

    const adPayload = received.created.find((p) => p.title === '終日の用事');
    assert.equal(adPayload.all_day, true);
    assert.equal(new Date(adPayload.start_at).toISOString(), '2027-05-02T00:00:00.000Z');
  });
  check('作成後は dirty が消え tt.id が付く', () => {
    assert.equal(state.events['2027-05-01'][0].dirty, undefined);
    assert.match(state.events['2027-05-01'][0].tt.id, /^new-/);
  });

  // --- 削除の tombstone ---
  state.tombstones.push('tt-2');
  const push2 = await pushLocal(state, client, 777, 42);
  check('tombstone は TimeTree 側で削除', () => {
    assert.deepEqual(received.deleted, ['tt-2']);
    assert.equal(push2.deleted, 1);
    assert.equal(state.tombstones.length, 0);
  });

  // --- 2 回目の pull でローカル変更が巻き戻らない ---
  const beforeTitle = state.events['2027-03-15'][0].t;
  state.events['2027-03-15'][0].dirty = true;
  mergePull(state, events, { fullSync: true });
  check('dirty なローカル編集は pull で上書きされない', () => {
    assert.equal(state.events['2027-03-15'][0].t, beforeTitle);
  });

  // --- タイムゾーン表記 ---
  check('msToParts は UTC 深夜を UTC の日付として返す', () => {
    assert.deepEqual(msToParts(Date.UTC(2027, 2, 14), 'UTC'), { iso: '2027-03-14', minute: 0 });
  });

  check('localToPayload は終日を UTC 深夜で送る', () => {
    const p = localToPayload({ iso: '2027-07-04', s: 0, e: 1440, t: 'x', ad: true }, 42);
    assert.equal(p.start_at, Date.UTC(2027, 6, 4));
    assert.equal(p.end_at, Date.UTC(2027, 6, 4));
    assert.equal(p.attendees[0], 42);
  });
} finally {
  server.close();
  console.log(results.join('\n'));
  console.log(process.exitCode ? '\n失敗あり' : '\n全テスト成功');
}
