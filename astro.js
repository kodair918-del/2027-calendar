/*
 * 月相と二至二分の計算（Meeus, Astronomical Algorithms 2nd ed. ch.27 / ch.47）。
 * 年ごとに必要な分だけ計算するので、どの年でも表示できる。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LUNAR_ASTRO = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const D2R = Math.PI / 180;
  const sin = (x) => Math.sin(x * D2R);
  const cos = (x) => Math.cos(x * D2R);
  const DAY_MS = 86400000;
  const PHASE_KEYS = [null, 'new', 'first', 'full', 'last'];

  const jstFormat = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  /** ユリウス日 -> JST の { date, time } */
  function jdToJST(jd) {
    const ms = (jd - 2440587.5) * DAY_MS;
    const parts = {};
    for (const p of jstFormat.formatToParts(new Date(ms))) parts[p.type] = p.value;
    return {
      date: `${parts.year}-${parts.month}-${parts.day}`,
      time: `${parts.hour === '24' ? '00' : parts.hour}:${parts.minute}`,
    };
  }

  // 2020〜2030年頃の ΔT ≒ 69s（TT-UT）。誤差は月相の分単位の表示には影響しない。
  const DELTA_T = 69 / 86400;
  const toJST = (jdeTT) => jdToJST(jdeTT - DELTA_T);

  function moonPhaseJDE(k) {
    const T = k / 1236.85;
    const T2 = T * T;
    const T3 = T2 * T;
    const T4 = T3 * T;
    const jde = 2451550.09766 + 29.530588861 * k + 0.00015437 * T2 - 0.00000015 * T3 + 0.00000000073 * T4;
    const E = 1 - 0.002516 * T - 0.0000074 * T2;
    const M = 2.5534 + 29.1053567 * k - 0.0000014 * T2 - 0.00000011 * T3;
    const Mp = 201.5643 + 385.81693528 * k + 0.0107582 * T2 + 0.00001238 * T3 - 0.000000058 * T4;
    const F = 160.7108 + 390.67050284 * k - 0.0016118 * T2 - 0.00000227 * T3 + 0.000000011 * T4;
    const O = 124.7746 - 1.56375588 * k + 0.0020672 * T2 + 0.00000215 * T3;

    const q = ((k % 1) + 1) % 1; // 0=新月, .25=上弦, .5=満月, .75=下弦
    let c;
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
        -0.4072 * sin(Mp) + 0.17241 * E * sin(M) + 0.01608 * sin(2 * Mp) + 0.01039 * sin(2 * F) +
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
        0.0018 * sin(Mp - 2 * F) - 0.0007 * sin(Mp + 2 * F) - 0.0004 * sin(3 * Mp) -
        0.00034 * E * sin(2 * Mp - M) + 0.00032 * E * sin(M + 2 * F) + 0.00032 * E * sin(M - 2 * F) -
        0.00028 * E * E * sin(Mp + 2 * M) + 0.00027 * E * sin(2 * Mp + M) - 0.00017 * sin(O) -
        0.00005 * sin(Mp - M - 2 * F) + 0.00004 * sin(2 * Mp + 2 * F) - 0.00004 * sin(Mp + M + 2 * F) +
        0.00004 * sin(Mp - 2 * M) + 0.00003 * sin(Mp + M - 2 * F) + 0.00003 * sin(3 * M) +
        0.00002 * sin(2 * Mp - 2 * F) + 0.00002 * sin(Mp - M + 2 * F) - 0.00002 * sin(3 * Mp + M);
      const W =
        0.00306 - 0.00038 * E * cos(M) + 0.00026 * cos(Mp) - 0.00002 * cos(Mp - M) +
        0.00002 * cos(Mp + M) + 0.00002 * cos(2 * F);
      c += q < 0.5 ? W : -W;
    }
    return jde + c;
  }

  const SEASON_TERMS = [
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
      june: 2451716.56767 + 365241.62603 * Y + 0.00325 * Y ** 2 + 0.00888 * Y ** 3 - 0.0003 * Y ** 4,
      sept: 2451810.21715 + 365242.01767 * Y - 0.11575 * Y ** 2 + 0.00337 * Y ** 3 + 0.00078 * Y ** 4,
      dec: 2451900.05952 + 365242.74049 * Y - 0.06223 * Y ** 2 - 0.00823 * Y ** 3 + 0.00032 * Y ** 4,
    }[which];
    const T = (base - 2451545.0) / 36525;
    const W = 35999.373 * T - 2.47;
    const dl = 1 + 0.0334 * cos(W) + 0.0007 * cos(2 * W);
    let S = 0;
    for (const [A, B, C] of SEASON_TERMS) S += A * cos(B + C * T);
    return base + (0.00001 * S) / dl;
  }

  const TERM_NAMES = { march: '春分', june: '夏至', sept: '秋分', dec: '冬至' };
  const PHASES = [
    { key: 'new', q: 0 },
    { key: 'first', q: 0.25 },
    { key: 'full', q: 0.5 },
    { key: 'last', q: 0.75 },
  ];

  const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const isoOfUTC = (d) => d.toISOString().slice(0, 10);

  /**
   * その年の月相・二至二分データを返す。
   * days: [{ date, dow, phase(0-1), phaseEvent, term }]
   * terms: [{ name, kind, date, time }]
   */
  function buildYear(year) {
    const baseK = Math.floor((year - 2000) * 12.3685);

    const events = [];
    for (let k = baseK - 2; k < baseK + 16; k++) {
      for (const p of PHASES) {
        const jde = moonPhaseJDE(k + p.q);
        const t = toJST(jde);
        if (Number(t.date.slice(0, 4)) === year) {
          events.push({ type: p.key, jd: jde - DELTA_T + 9 / 24, ...t });
        }
      }
    }
    events.sort((a, b) => a.jd - b.jd);

    const newMoons = [];
    for (let k = baseK - 3; k < baseK + 18; k++) {
      newMoons.push(moonPhaseJDE(k) - DELTA_T + 9 / 24);
    }

    const terms = Object.keys(TERM_NAMES).map((w) => {
      const t = toJST(seasonJDE(year, w));
      return {
        name: TERM_NAMES[w],
        kind: w === 'march' || w === 'sept' ? 'equinox' : 'solstice',
        ...t,
      };
    });

    const eventByDate = new Map(events.map((e) => [e.date, e]));
    const termByDate = new Map(terms.map((t) => [t.date, t]));

    const days = [];
    const count = isLeap(year) ? 366 : 365;
    for (let i = 0; i < count; i++) {
      const date = new Date(Date.UTC(year, 0, 1 + i));
      const iso = isoOfUTC(date);
      // newMoons は「JST のユリウス日」で持っているので、その日 0h JST も同じ座標で表す
      const jdJST = date.getTime() / DAY_MS + 2440587.5;

      let a = newMoons[0];
      let b = newMoons[newMoons.length - 1];
      for (let n = 0; n < newMoons.length - 1; n++) {
        if (newMoons[n] <= jdJST && jdJST < newMoons[n + 1]) {
          a = newMoons[n];
          b = newMoons[n + 1];
          break;
        }
      }

      const ev = eventByDate.get(iso);
      const tm = termByDate.get(iso);
      days.push({
        date: iso,
        dow: date.getUTCDay(),
        phase: (jdJST - a) / (b - a),
        phaseEvent: ev ? ev.type : null,
        term: tm ? tm.name : null,
      });
    }

    return { year, days, terms };
  }

  return { buildYear, PHASE_KEYS, jdToJST, moonPhaseJDE, seasonJDE };
});
