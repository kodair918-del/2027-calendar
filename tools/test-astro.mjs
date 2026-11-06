/**
 * astro.js が生成するデータを、従来の data/2027.js と突き合わせる。
 *   node tools/test-astro.mjs
 */
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const require = createRequire(import.meta.url);
const { buildYear } = require('../astro.js');

const PHASE_KEYS = [null, 'new', 'first', 'full', 'last'];

// 2027年は旧データと完全一致することを確認する
const legacyPath = join(ROOT, 'data', '2027.js');
if (existsSync(legacyPath)) {
  const sandbox = {};
  new Function('window', readFileSync(legacyPath, 'utf8'))(sandbox);
  const legacy = sandbox.CAL_2027;
  const built = buildYear(2027);

  assert.equal(built.days.length, legacy.days.length, 'day count');
  legacy.days.forEach((row, i) => {
    const day = built.days[i];
    assert.equal(day.dow, row[0], `weekday ${day.date}`);
    // 旧データは日付境界の扱いが数時間ずれていたため、位相は 6 時間ぶんの誤差を許容する
    const delta = ((Math.round(day.phase * 1000) - row[1] + 1500) % 1000) - 500;
    assert.ok(Math.abs(delta) <= 10, `phase ${day.date}: ${Math.round(day.phase * 1000)} vs ${row[1]}`);
    assert.equal(PHASE_KEYS.indexOf(day.phaseEvent || null), row[2], `phase event ${day.date}`);
    assert.equal(day.term ? legacy.terms[row[3] - 1].name : null, day.term, `term ${day.date}`);
  });

  legacy.terms.forEach((term) => {
    const match = built.terms.find((t) => t.name === term.name);
    assert.ok(match, `${term.name} exists`);
    assert.equal(match.date, term.date, `${term.name} date`);
  });
  console.log('2027: 旧データと一致');
}

// 年をまたいでも破綻しないこと（うるう年・年始年終の月相）
for (const y of [1900, 1999, 2000, 2024, 2026, 2028, 2100]) {
  const data = buildYear(y);
  const expected = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 366 : 365;
  assert.equal(data.days.length, expected, `${y} day count`);
  assert.equal(data.terms.length, 4, `${y} terms`);
  for (const day of data.days) {
    assert.ok(day.phase >= 0 && day.phase <= 1, `${y} phase range ${day.date}`);
    assert.match(day.date, new RegExp(`^${y}-`), `${y} date prefix`);
  }
  for (const t of data.terms) assert.match(t.date, new RegExp(`^${y}-`), `${y} term in year`);
}

// 2027年の主要月相の時刻が既知の値と一致すること
const y2027 = buildYear(2027);
const full = y2027.days.filter((d) => d.phaseEvent === 'full').map((d) => d.date);
assert.ok(full.includes('2027-03-22'), `2027-03-22 full moon (got ${full.join(', ')})`);

console.log('astro tests passed');
