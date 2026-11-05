// 2027年の月相・二十四節気(二至二分)を Meeus の近似式から算出して data/2027.json を出力する。
// 実行: node tools/gen-2027.mjs 2027
import { writeFileSync } from 'node:fs';

const D2R = Math.PI / 180;
const sin = (x) => Math.sin(x * D2R);
const cos = (x) => Math.cos(x * D2R);

/** グレゴリオ暦 -> ユリウス日 (0h UT) */
function jdFromYMD(y, m, d) {
  if (m <= 2) { y -= 1; m += 12; }
  const A = Math.floor(y / 100);
  const B = 2 - A + Math.floor(A / 4);
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + d + B - 1524.5;
}

/** ユリウス日 -> JST の { date, time } */
const fmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hour12: false,
});
function jdToJST(jd) {
  const ms = (jd - 2440587.5) * 86400000;
  const parts = Object.fromEntries(fmt.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour === '24' ? '00' : parts.hour}:${parts.minute}`,
  };
}

const deltaT = 69 / 86400; // 2027年頃の ΔT ≒ 69s (TT-UT)
// jdToJST 側で Asia/Tokyo に変換するので、ここでは UT に直すだけでよい
const toJST = (jdeTT) => jdToJST(jdeTT - deltaT);

// ---- 月相 (Meeus, Astronomical Algorithms 2nd ed. ch.47) ----
function moonPhaseJDE(k) {
  const T = k / 1236.85;
  const T2 = T * T, T3 = T2 * T, T4 = T3 * T;
  let jde = 2451550.09766 + 29.530588861 * k + 0.00015437 * T2 - 0.000000150 * T3 + 0.00000000073 * T4;
  const E = 1 - 0.002516 * T - 0.0000074 * T2;
  const M = 2.5534 + 29.10535670 * k - 0.0000014 * T2 - 0.00000011 * T3;
  const Mp = 201.5643 + 385.81693528 * k + 0.0107582 * T2 + 0.00001238 * T3 - 0.000000058 * T4;
  const F = 160.7108 + 390.67050284 * k - 0.0016118 * T2 - 0.00000227 * T3 + 0.000000011 * T4;
  const O = 124.7746 - 1.56375588 * k + 0.0020672 * T2 + 0.00000215 * T3;

  const q = ((k % 1) + 1) % 1; // 0=new, .25=first quarter, .5=full, .75=last quarter
  let c = 0;
  if (Math.abs(q - 0.5) < 1e-6) {
    c =
      -0.40614 * sin(Mp) + 0.17302 * E * sin(M) + 0.01614 * sin(2 * Mp) + 0.01043 * sin(2 * F) +
      0.00734 * E * sin(Mp - M) - 0.00515 * E * sin(Mp + M) + 0.00209 * E * E * sin(2 * M) -
      0.00111 * sin(Mp - 2 * F) - 0.00057 * sin(Mp + 2 * F) + 0.00056 * E * sin(2 * Mp + M) -
      0.00042 * sin(3 * Mp) + 0.00042 * E * sin(M + 2 * F) + 0.00038 * E * sin(M - 2 * F) -
      0.00024 * E * sin(2 * Mp - M) - 0.00017 * sin(O) - 0.00007 * sin(Mp + 2 * M) +
      0.00004 * sin(2 * Mp - 2 * F) + 0.00004 * sin(3 * M) + 0.00003 * sin(Mp + M - 2 * F) +
      0.00003 * sin(2 * Mp + 2 * F) - 0.00003 * sin(Mp + M + 2 * F) + 0.00003 * sin(Mp - M + 2 * F) -
      0.00002 * sin(Mp - M - 2 * F) - 0.00002 * sin(3 * Mp + M) + 0.00002 * sin(4 * Mp);
  } else if (q < 1e-6) {
    c =
      -0.40720 * sin(Mp) + 0.17241 * E * sin(M) + 0.01608 * sin(2 * Mp) + 0.01039 * sin(2 * F) +
      0.00739 * E * sin(Mp - M) - 0.00514 * E * sin(Mp + M) + 0.00208 * E * E * sin(2 * M) -
      0.00111 * sin(Mp - 2 * F) - 0.00057 * sin(Mp + 2 * F) + 0.00056 * E * sin(2 * Mp + M) -
      0.00042 * sin(3 * Mp) + 0.00042 * E * sin(M + 2 * F) + 0.00038 * E * sin(M - 2 * F) -
      0.00024 * E * sin(2 * Mp - M) - 0.00017 * sin(O) - 0.00007 * sin(Mp + 2 * M) +
      0.00004 * sin(2 * Mp - 2 * F) + 0.00004 * sin(3 * M) + 0.00003 * sin(Mp + M - 2 * F) +
      0.00003 * sin(2 * Mp + 2 * F) - 0.00003 * sin(Mp + M + 2 * F) + 0.00003 * sin(Mp - M + 2 * F) -
      0.00002 * sin(Mp - M - 2 * F) - 0.00002 * sin(3 * Mp + M) + 0.00002 * sin(4 * Mp);
  } else {
    c =
      -0.62801 * sin(Mp) + 0.17172 * E * sin(M) - 0.01183 * E * sin(Mp + M) + 0.00862 * sin(2 * Mp) +
      0.00804 * sin(2 * F) + 0.00454 * E * sin(Mp - M) + 0.00204 * E * E * sin(2 * M) -
      0.00180 * sin(Mp - 2 * F) - 0.00070 * sin(Mp + 2 * F) - 0.00040 * sin(3 * Mp) -
      0.00034 * E * sin(2 * Mp - M) + 0.00032 * E * sin(M + 2 * F) + 0.00032 * E * sin(M - 2 * F) -
      0.00028 * E * E * sin(Mp + 2 * M) + 0.00027 * E * sin(2 * Mp + M) - 0.00017 * sin(O) -
      0.00005 * sin(Mp - M - 2 * F) + 0.00004 * sin(2 * Mp + 2 * F) - 0.00004 * sin(Mp + M + 2 * F) +
      0.00004 * sin(Mp - 2 * M) + 0.00003 * sin(Mp + M - 2 * F) + 0.00003 * sin(3 * M) +
      0.00002 * sin(2 * Mp - 2 * F) + 0.00002 * sin(Mp - M + 2 * F) - 0.00002 * sin(3 * Mp + M);
    const W = 0.00306 - 0.00038 * E * cos(M) + 0.00026 * cos(Mp) - 0.00002 * cos(Mp - M) +
      0.00002 * cos(Mp + M) + 0.00002 * cos(2 * F);
    c += q < 0.5 ? W : -W;
  }
  return jde + c;
}

// ---- 二至二分 (Meeus ch.27) ----
const TERMS = [
  [485, 324.96, 1934.136], [203, 337.23, 32964.467], [199, 342.08, 20.186],
  [182, 27.85, 445267.112], [156, 73.14, 45036.886], [136, 171.52, 22518.443],
  [77, 222.54, 65928.934], [74, 296.72, 3034.906], [70, 243.58, 9037.513],
  [58, 119.81, 33718.147], [52, 297.17, 150.678], [50, 21.02, 2281.226],
  [45, 247.54, 29929.562], [44, 325.15, 31555.956], [29, 60.93, 4443.417],
  [18, 155.12, 67555.328], [17, 288.79, 4562.452], [16, 198.04, 62894.029],
  [14, 199.76, 31436.921], [12, 95.39, 14577.848], [12, 287.11, 31931.756],
  [12, 320.81, 34777.259], [9, 227.73, 1222.114], [8, 15.45, 16859.074],
];

function seasonJDE(year, which) {
  const Y = (year - 2000) / 1000;
  const base = {
    march: 2451623.80984 + 365242.37404 * Y + 0.05169 * Y ** 2 - 0.00411 * Y ** 3 - 0.00057 * Y ** 4,
    june: 2451716.56767 + 365241.62603 * Y + 0.00325 * Y ** 2 + 0.00888 * Y ** 3 - 0.00030 * Y ** 4,
    sept: 2451810.21715 + 365242.01767 * Y - 0.11575 * Y ** 2 + 0.00337 * Y ** 3 + 0.00078 * Y ** 4,
    dec: 2451900.05952 + 365242.74049 * Y - 0.06223 * Y ** 2 - 0.00823 * Y ** 3 + 0.00032 * Y ** 4,
  }[which];
  const T = (base - 2451545.0) / 36525;
  const W = 35999.373 * T - 2.47;
  const dl = 1 + 0.0334 * cos(W) + 0.0007 * cos(2 * W);
  const S = TERMS.reduce((acc, [A, B, C]) => acc + A * cos(B + C * T), 0);
  return base + (0.00001 * S) / dl;
}

// ---- 生成 ----
const year = Number(process.argv[2] ?? 2027);

const phaseTypes = [
  { key: 'new', label: '新月', q: 0 },
  { key: 'first', label: '上弦', q: 0.25 },
  { key: 'full', label: '満月', q: 0.5 },
  { key: 'last', label: '下弦', q: 0.75 },
];

// 月相の実時刻 (JST)
const events = [];
for (let k = Math.floor((year - 2000) * 12.3685) - 2; k < Math.floor((year - 2000) * 12.3685) + 16; k++) {
  for (const p of phaseTypes) {
    const jde = moonPhaseJDE(k + p.q);
    const t = toJST(jde);
    if (Number(t.date.slice(0, 4)) === year) {
      events.push({ type: p.key, label: p.label, jd: jde - deltaT + 9 / 24, ...t });
    }
  }
}
events.sort((a, b) => a.jd - b.jd);

// 新月だけ抜き出し（日々の位相補間用。年跨ぎの前後も含める）
const newMoons = [];
for (let k = Math.floor((year - 2000) * 12.3685) - 3; k < Math.floor((year - 2000) * 12.3685) + 18; k++) {
  const jd = moonPhaseJDE(k) - deltaT + 9 / 24;
  newMoons.push(jd);
}

const termNames = { march: '春分', june: '夏至', sept: '秋分', dec: '冬至' };
const terms = Object.keys(termNames).map((w) => {
  const t = toJST(seasonJDE(year, w));
  return { name: termNames[w], kind: w === 'march' || w === 'sept' ? 'equinox' : 'solstice', ...t };
});

const eventByDate = new Map(events.map((e) => [e.date, e]));
const termByDate = new Map(terms.map((t) => [t.date, t]));

// 1日 = [曜日, 位相(0-1000), 月相イベント, 二至二分] の配列にして転送量を抑える
const PHASE_ORDER = [null, 'new', 'first', 'full', 'last'];
const termIndex = new Map(terms.map((t, i) => [t.name, i + 1]));

const rows = [];
const start = jdFromYMD(year, 1, 1);
for (let i = 0; i < (isLeap(year) ? 366 : 365); i++) {
  const jdUT = start + i;            // 0h UT
  const jdJST = jdUT + 9 / 24 - 0.5; // 0h JST は前日 15h UT
  let a = newMoons[0], b = newMoons[1];
  for (let n = 0; n < newMoons.length - 1; n++) {
    if (newMoons[n] <= jdJST && jdJST < newMoons[n + 1]) { a = newMoons[n]; b = newMoons[n + 1]; break; }
  }
  const frac = (jdJST - a) / (b - a);
  const d = new Date(Date.UTC(year, 0, 1 + i));
  const iso = d.toISOString().slice(0, 10);
  const ev = eventByDate.get(iso);
  const tm = termByDate.get(iso);
  rows.push([
    d.getUTCDay(),
    Math.round(frac * 1000),                                       // 0=新月, 500=満月
    ev ? PHASE_ORDER.indexOf(ev.type) : 0,
    tm ? (termIndex.get(tm.name) ?? 0) : 0,
  ]);
}

function isLeap(y) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; }

const out = {
  v: 2,
  year,
  tz: 'Asia/Tokyo',
  src: 'Meeus AA 2nd ed. ch.27/47',
  days: rows,
  terms: terms.map((t) => ({ name: t.name, kind: t.kind, date: t.date, time: t.time })),
};

const json = JSON.stringify(out);
await writeFileSync(new URL(`../data/${year}.js`, import.meta.url), `window.CAL_${year}=${json};\n`, 'utf8');

console.log(`days: ${rows.length}`);
console.log('terms:', terms.map((t) => `${t.name} ${t.date} ${t.time}`).join(', '));
const counts = {};
for (const e of events) counts[e.type] = (counts[e.type] ?? 0) + 1;
console.log('phase counts:', counts);
console.log('first 3 phases:', events.slice(0, 3).map((e) => `${e.label} ${e.date} ${e.time}`).join(' | '));
console.log('bytes:', Buffer.byteLength(JSON.stringify(out)));
