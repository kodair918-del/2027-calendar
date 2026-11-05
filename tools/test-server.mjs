/**
 * 公開サーバーの認証・API境界を検証する。
 *   node tools/test-server.mjs
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const dataDir = await mkdtemp(join(tmpdir(), 'lunar-server-test-'));

async function unusedPort() {
  const probe = createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const { port } = probe.address();
  await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  return port;
}

const port = await unusedPort();
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, [join(HERE, 'serve.mjs'), '--port', String(port), '--no-open'], {
  cwd: ROOT,
  env: {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(port),
    DATA_DIR: dataDir,
    APP_PASSWORD: 'test-calendar-password',
    APP_SESSION_SECRET: 'test-session-signing-secret',
    TIMETREE_EMAIL: '',
    TIMETREE_PASSWORD: '',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverOutput = '';
child.stdout.setEncoding('utf8').on('data', (text) => { serverOutput += text; });
child.stderr.setEncoding('utf8').on('data', (text) => { serverOutput += text; });

async function request(path, options = {}) {
  return fetch(`${base}${path}`, {
    ...options,
    headers: {
      ...(options.headers || {}),
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(options.origin ? { origin: options.origin } : {}),
    },
  });
}

try {
  let ready = false;
  for (let i = 0; i < 80; i++) {
    if (child.exitCode !== null) throw new Error(`server exited early:\n${serverOutput}`);
    try {
      const response = await request('/api/health');
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(ready, true, `server did not start:\n${serverOutput}`);

  assert.equal((await request('/api/state')).status, 401, 'state is private before login');
  assert.equal((await request('/tools/.env')).status, 404, 'private tool files are not served');
  assert.equal((await request('/data/state.json')).status, 404, 'state files are not served');

  const wrongLogin = await request('/api/login', {
    method: 'POST',
    origin: base,
    body: JSON.stringify({ password: 'wrong-password' }),
  });
  assert.equal(wrongLogin.status, 401, 'wrong password is rejected');

  const login = await request('/api/login', {
    method: 'POST',
    origin: base,
    body: JSON.stringify({ password: 'test-calendar-password' }),
  });
  assert.equal(login.status, 200, 'correct password is accepted');
  const cookie = login.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie, 'login sets an HttpOnly session cookie');

  const stateResponse = await request('/api/state', { headers: { cookie } });
  assert.equal(stateResponse.status, 200, 'session can read state');

  const save = await request('/api/state', {
    method: 'POST',
    origin: base,
    headers: { cookie },
    body: JSON.stringify({
      notes: { '2027-01-01': 'test note' },
      events: {},
      tombstones: [],
    }),
  });
  assert.equal(save.status, 200, 'session can save state');
  const persisted = JSON.parse(await readFile(join(dataDir, 'state.json'), 'utf8'));
  assert.equal(persisted.notes['2027-01-01'], 'test note', 'state is persisted in the configured data directory');

  const crossOrigin = await request('/api/state', {
    method: 'POST',
    origin: 'https://attacker.example',
    headers: { cookie },
    body: JSON.stringify({ notes: {}, events: {}, tombstones: [] }),
  });
  assert.equal(crossOrigin.status, 403, 'cross-origin writes are rejected');

  const logout = await request('/api/logout', { method: 'POST', origin: base, headers: { cookie } });
  assert.equal(logout.status, 200, 'logout succeeds');
  assert.equal((await request('/api/state')).status, 401, 'session is rejected after logout');
  console.log('Server tests passed (12 checks).');
} finally {
  if (child.exitCode === null && child.signalCode === null) {
    child.kill();
    await new Promise((resolve) => child.once('exit', resolve));
  }
  await rm(dataDir, { recursive: true, force: true });
}
