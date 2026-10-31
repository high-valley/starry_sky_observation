// 天文計算モジュール（ブラウザ / Node 共通・依存なし）
//
// 座標系
//   - 赤道座標ベクトル: X=春分点方向, Z=天の北極（J2000 または 当日分点）
//   - 地平座標 ENU ベクトル: x=東, y=北, z=天頂
//   - 方位角 az は北=0°・東=90° の時計回り、高度 alt は地平線=0°
//
// 精度の目安（スマホのコンパス誤差 数度 に比べて十分小さい）
//   恒星: 歳差を考慮 / 章動・光行差は無視（< 0.01°）
//   太陽: 約 0.01°、月: 約 0.05°（視差補正込み）、惑星: 約 0.1°

export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;
const J2000 = 2451545.0;
const DELTA_T_SEC = 69.2; // TT - UT（2020年代の概算値）
const OBLIQUITY_J2000 = 23.4392911 * DEG;

const norm360 = (x) => ((x % 360) + 360) % 360;

/** Date → ユリウス日 (UT) */
export function julianDate(date) {
  return date.getTime() / 86400000 + 2440587.5;
}

/** ユリウス世紀 (TT, J2000 起点) */
export function centuriesTT(jdUT) {
  return (jdUT + DELTA_T_SEC / 86400 - J2000) / 36525;
}

/** グリニッジ平均恒星時 [deg] (IAU 1982, Meeus 12.4) */
export function gmstDeg(jdUT) {
  const d = jdUT - J2000;
  const T = d / 36525;
  return norm360(280.46061837 + 360.98564736629 * d + 0.000387933 * T * T - (T * T * T) / 38710000);
}

/** 地方恒星時 [deg]（東経を正） */
export function lstDeg(jdUT, lonDeg) {
  return norm360(gmstDeg(jdUT) + lonDeg);
}

/** 平均黄道傾斜角 [rad] */
export function obliquity(T) {
  const sec = 21.448 - 46.815 * T - 0.00059 * T * T + 0.001813 * T * T * T;
  return (23 + 26 / 60 + sec / 3600) * DEG;
}

// ---------------------------------------------------------------- 3x3 行列

export function matMul(a, b) {
  const r = new Array(9);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
  return r;
}

export function matVec(m, v) {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

// 座標変換行列（ベクトルの成分を回転後の座標系で表す「座標軸回転」）
function rotX(a) {
  const c = Math.cos(a), s = Math.sin(a);
  return [1, 0, 0, 0, c, s, 0, -s, c];
}
function rotY(a) {
  const c = Math.cos(a), s = Math.sin(a);
  return [c, 0, -s, 0, 1, 0, s, 0, c];
}
function rotZ(a) {
  const c = Math.cos(a), s = Math.sin(a);
  return [c, s, 0, -s, c, 0, 0, 0, 1];
}

export function raDecToVec(raDeg, decDeg) {
  const ra = raDeg * DEG, dec = decDeg * DEG;
  const cd = Math.cos(dec);
  return [cd * Math.cos(ra), cd * Math.sin(ra), Math.sin(dec)];
}

export function vecToRaDec(v) {
  const r = Math.hypot(v[0], v[1], v[2]);
  return { ra: norm360(Math.atan2(v[1], v[0]) * RAD), dec: Math.asin(v[2] / r) * RAD };
}

/** ENU ベクトル → {az, alt} [deg] */
export function enuToAzAlt(v) {
  const r = Math.hypot(v[0], v[1], v[2]);
  return { az: norm360(Math.atan2(v[0], v[1]) * RAD), alt: Math.asin(v[2] / r) * RAD };
}

export function azAltToEnu(azDeg, altDeg) {
  const az = azDeg * DEG, alt = altDeg * DEG;
  const ca = Math.cos(alt);
  return [ca * Math.sin(az), ca * Math.cos(az), Math.sin(alt)];
}

/** 歳差行列 J2000 → 当日平均分点 (IAU 1976, Meeus 21.2) */
export function precessionMatrix(T) {
  const as = DEG / 3600;
  const zeta = (2306.2181 * T + 0.30188 * T * T + 0.017998 * T * T * T) * as;
  const z = (2306.2181 * T + 1.09468 * T * T + 0.018203 * T * T * T) * as;
  const theta = (2004.3109 * T - 0.42665 * T * T - 0.041833 * T * T * T) * as;
  // P = Rz(-z) · Ry(theta) · Rz(-zeta)
  return matMul(rotZ(-z), matMul(rotY(theta), rotZ(-zeta)));
}

/** 当日分点の赤道座標 → ENU（地方恒星時 lst, 緯度 lat） */
export function equatorialToEnuMatrix(lstDegValue, latDeg) {
  const phi = latDeg * DEG;
  const sp = Math.sin(phi), cp = Math.cos(phi);
  // 時角座標系へ: X'=cosδ cosH, Y'=-cosδ sinH, Z'=sinδ
  const hour = rotZ(lstDegValue * DEG);
  // E = Y', N = -sinφ X' + cosφ Z', U = cosφ X' + sinφ Z'
  const toEnu = [0, 1, 0, -sp, 0, cp, cp, 0, sp];
  return matMul(toEnu, hour);
}

/**
 * ある時刻・場所での変換行列一式
 * @returns {{jd, T, lst, eqDateToEnu, j2000ToEnu}}
 */
export function observerFrame(date, latDeg, lonDeg) {
  const jd = julianDate(date);
  const T = centuriesTT(jd);
  const lst = lstDeg(jd, lonDeg);
  const eqDateToEnu = equatorialToEnuMatrix(lst, latDeg);
  const j2000ToEnu = matMul(eqDateToEnu, precessionMatrix(T));
  return { jd, T, lst, lat: latDeg, lon: lonDeg, eqDateToEnu, j2000ToEnu };
}

/** 大気差 [deg]（見かけの高度の上昇量, Saemundsson） */
export function refraction(altDeg) {
  if (altDeg < -1.5) return 0;
  const h = Math.max(altDeg, -1.0);
  return 1.02 / Math.tan((h + 10.3 / (h + 5.11)) * DEG) / 60;
}

// ---------------------------------------------------------------- 太陽

/** 太陽の視位置（当日分点）Meeus 25 章・低精度式 */
export function sunPosition(T) {
  const L0 = 280.46646 + 36000.76983 * T + 0.0003032 * T * T;
  const M = (357.52911 + 35999.05029 * T - 0.0001537 * T * T) * DEG;
  const C =
    (1.914602 - 0.004817 * T - 0.000014 * T * T) * Math.sin(M) +
    (0.019993 - 0.000101 * T) * Math.sin(2 * M) +
    0.000289 * Math.sin(3 * M);
  const trueLon = L0 + C;
  const e = 0.016708634 - 0.000042037 * T;
  const nu = M + C * DEG;
  const R = (1.000001018 * (1 - e * e)) / (1 + e * Math.cos(nu));
  const omega = (125.04 - 1934.136 * T) * DEG;
  const lambda = (trueLon - 0.00569 - 0.00478 * Math.sin(omega)) * DEG;
  const eps = obliquity(T) + 0.00256 * DEG * Math.cos(omega);
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
  const dec = Math.asin(Math.sin(eps) * Math.sin(lambda));
  return { ra: norm360(ra * RAD), dec: dec * RAD, distAU: R, lon: norm360(lambda * RAD) };
}

// ---------------------------------------------------------------- 月

// Meeus 47 章の主要項（係数 1e-6 deg / 1e-3 km）
// [D, M, M', F, Σl, Σr]
const MOON_LR = [
  [0, 0, 1, 0, 6288774, -20905355],
  [2, 0, -1, 0, 1274027, -3699111],
  [2, 0, 0, 0, 658314, -2955968],
  [0, 0, 2, 0, 213618, -569925],
  [0, 1, 0, 0, -185116, 48888],
  [0, 0, 0, 2, -114332, -3149],
  [2, 0, -2, 0, 58793, 246158],
  [2, -1, -1, 0, 57066, -152138],
  [2, 0, 1, 0, 53322, -170733],
  [2, -1, 0, 0, 45758, -204586],
  [0, 1, -1, 0, -40923, -129620],
  [1, 0, 0, 0, -34720, 108743],
  [0, 1, 1, 0, -30383, 104755],
  [2, 0, 0, -2, 15327, 10321],
  [0, 0, 1, 2, -12528, 0],
  [0, 0, 1, -2, 10980, 79661],
  [4, 0, -1, 0, 10675, -34782],
  [0, 0, 3, 0, 10034, -23210],
  [4, 0, -2, 0, 8548, -21636],
  [2, 1, -1, 0, -7888, 24208],
  [2, 1, 0, 0, -6766, 30824],
  [1, 0, -1, 0, -5163, -8379],
  [1, 1, 0, 0, 4987, -16675],
  [2, -1, 1, 0, 4036, -12831],
  [2, 0, 2, 0, 3994, -10445],
  [4, 0, 0, 0, 3861, -11650],
  [2, 0, -3, 0, 3665, 14403],
  [0, 1, -2, 0, -2689, -7003],
  [2, 0, -1, 2, -2602, 0],
  [2, -1, -2, 0, 2390, 10056],
  [1, 0, 1, 0, -2348, 6322],
  [2, -2, 0, 0, 2236, -9884],
];
// [D, M, M', F, Σb]
const MOON_B = [
  [0, 0, 0, 1, 5128122],
  [0, 0, 1, 1, 280602],
  [0, 0, 1, -1, 277693],
  [2, 0, 0, -1, 173237],
  [2, 0, -1, 1, 55413],
  [2, 0, -1, -1, 46271],
  [2, 0, 0, 1, 32573],
  [0, 0, 2, 1, 17198],
  [2, 0, 1, -1, 9266],
  [0, 0, 2, -1, 8822],
  [2, -1, 0, -1, 8216],
  [2, 0, -2, -1, 4324],
  [2, 0, 1, 1, 4200],
  [2, 1, 0, -1, -3359],
  [2, -1, -1, 1, 2463],
  [2, -1, 0, 1, 2211],
  [2, -1, -1, -1, 2065],
];

/** 月の地心位置（当日分点）。distKm は地心距離 */
export function moonPosition(T) {
  const Lp = 218.3164477 + 481267.88123421 * T - 0.0015786 * T * T + (T * T * T) / 538841;
  const D = (297.8501921 + 445267.1114034 * T - 0.0018819 * T * T + (T * T * T) / 545868) * DEG;
  const M = (357.5291092 + 35999.0502909 * T - 0.0001536 * T * T) * DEG;
  const Mp = (134.9633964 + 477198.8675055 * T + 0.0087414 * T * T + (T * T * T) / 69699) * DEG;
  const F = (93.272095 + 483202.0175233 * T - 0.0036539 * T * T) * DEG;
  const A1 = (119.75 + 131.849 * T) * DEG;
  const A2 = (53.09 + 479264.29 * T) * DEG;
  const A3 = (313.45 + 481266.484 * T) * DEG;
  const E = 1 - 0.002516 * T - 0.0000074 * T * T;
  const LpR = Lp * DEG;

  let sl = 0, sr = 0, sb = 0;
  for (const [d, m, mp, f, l, r] of MOON_LR) {
    const arg = d * D + m * M + mp * Mp + f * F;
    const ef = Math.abs(m) === 1 ? E : Math.abs(m) === 2 ? E * E : 1;
    sl += l * ef * Math.sin(arg);
    sr += r * ef * Math.cos(arg);
  }
  for (const [d, m, mp, f, b] of MOON_B) {
    const arg = d * D + m * M + mp * Mp + f * F;
    const ef = Math.abs(m) === 1 ? E : Math.abs(m) === 2 ? E * E : 1;
    sb += b * ef * Math.sin(arg);
  }
  sl += 3958 * Math.sin(A1) + 1962 * Math.sin(LpR - F) + 318 * Math.sin(A2);
  sb += -2235 * Math.sin(LpR) + 382 * Math.sin(A3) + 175 * Math.sin(A1 - F) +
    175 * Math.sin(A1 + F) + 127 * Math.sin(LpR - Mp) - 115 * Math.sin(LpR + Mp);

  const lambda = (Lp + sl / 1e6) * DEG;
  const beta = (sb / 1e6) * DEG;
  const distKm = 385000.56 + sr / 1000;
  const eps = obliquity(T);
  const v = eclipticToEquatorial(lambda, beta, eps);
  const { ra, dec } = vecToRaDec(v);
  return { ra, dec, distKm, lon: norm360(lambda * RAD), lat: beta * RAD };
}

function eclipticToEquatorial(lambda, beta, eps) {
  const cb = Math.cos(beta);
  const x = cb * Math.cos(lambda), y = cb * Math.sin(lambda), z = Math.sin(beta);
  const ce = Math.cos(eps), se = Math.sin(eps);
  return [x, y * ce - z * se, y * se + z * ce];
}

// ---------------------------------------------------------------- 惑星

// JPL 近似軌道要素（Standish, 1800-2050年, J2000 黄道）
// [a, e, I, L, 近日点黄経ϖ, Ω] と 世紀あたりの変化率
const ELEMENTS = {
  mercury: [[0.38709927, 0.20563593, 7.00497902, 252.2503235, 77.45779628, 48.33076593],
    [0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081]],
  venus: [[0.72333566, 0.00677672, 3.39467605, 181.9790995, 131.60246718, 76.67984255],
    [0.0000039, -0.00004107, -0.0007889, 58517.81538729, 0.00268329, -0.27769418]],
  earth: [[1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0],
    [0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0]],
  mars: [[1.52371034, 0.0933941, 1.84969142, -4.55343205, -23.94362959, 49.55953891],
    [0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343]],
  jupiter: [[5.202887, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909],
    [-0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106]],
  saturn: [[9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448],
    [-0.0012506, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794]],
};

export const PLANETS = [
  { id: 'mercury', ja: '水星', en: 'Mercury', H: -0.6, color: '#c9c2b8' },
  { id: 'venus', ja: '金星', en: 'Venus', H: -4.4, color: '#fff4d6' },
  { id: 'mars', ja: '火星', en: 'Mars', H: -1.5, color: '#ff9a6a' },
  { id: 'jupiter', ja: '木星', en: 'Jupiter', H: -9.4, color: '#f2dcb8' },
  { id: 'saturn', ja: '土星', en: 'Saturn', H: -8.9, color: '#ead9a4' },
];

function heliocentric(id, T) {
  const [el, rate] = ELEMENTS[id];
  const a = el[0] + rate[0] * T;
  const e = el[1] + rate[1] * T;
  const I = (el[2] + rate[2] * T) * DEG;
  const L = el[3] + rate[3] * T;
  const varpi = el[4] + rate[4] * T;
  const Omega = (el[5] + rate[5] * T) * DEG;
  const M = (norm360(L - varpi + 180) - 180) * DEG;
  const w = varpi * DEG - Omega;
  let E = M + e * Math.sin(M);
  for (let i = 0; i < 8; i++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  const xp = a * (Math.cos(E) - e);
  const yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const cw = Math.cos(w), sw = Math.sin(w), cO = Math.cos(Omega), sO = Math.sin(Omega), cI = Math.cos(I), sI = Math.sin(I);
  return [
    (cw * cO - sw * sO * cI) * xp + (-sw * cO - cw * sO * cI) * yp,
    (cw * sO + sw * cO * cI) * xp + (-sw * sO + cw * cO * cI) * yp,
    sw * sI * xp + cw * sI * yp,
  ];
}

/** 惑星の地心位置（J2000 赤道座標）と概算等級 */
export function planetPosition(id, T) {
  const earth = heliocentric('earth', T);
  let p = heliocentric(id, T);
  let g = [p[0] - earth[0], p[1] - earth[1], p[2] - earth[2]];
  // 光差補正（1回反復で十分）
  const lightDays = Math.hypot(...g) * 0.0057755;
  p = heliocentric(id, T - lightDays / 36525);
  g = [p[0] - earth[0], p[1] - earth[1], p[2] - earth[2]];
  const delta = Math.hypot(...g);
  const r = Math.hypot(...p);
  const ce = Math.cos(OBLIQUITY_J2000), se = Math.sin(OBLIQUITY_J2000);
  const eq = [g[0], g[1] * ce - g[2] * se, g[1] * se + g[2] * ce];
  const planet = PLANETS.find((x) => x.id === id);
  const mag = planet.H + 5 * Math.log10(r * delta);
  const { ra, dec } = vecToRaDec(eq);
  return { ra, dec, distAU: delta, mag };
}

// ---------------------------------------------------------------- まとめ

/**
 * 太陽・月・惑星を ENU で返す
 * @returns {Array<{id, ja, kind, enu:number[], az, alt, mag, ...}>}
 */
export function solarSystemBodies(frame) {
  const { T } = frame;
  const out = [];
  const sun = sunPosition(T);
  const sunEnu = matVec(frame.eqDateToEnu, raDecToVec(sun.ra, sun.dec));
  out.push({ id: 'sun', ja: '太陽', en: 'Sun', kind: 'sun', mag: -26.7, enu: sunEnu, ...sun });

  const moon = moonPosition(T);
  const geo = matVec(frame.eqDateToEnu, raDecToVec(moon.ra, moon.dec));
  // 地心 → 観測地（月の視差 最大約1°）
  const R = 6371;
  const topo = [geo[0] * moon.distKm, geo[1] * moon.distKm, geo[2] * moon.distKm - R];
  const tl = Math.hypot(...topo);
  const moonEnu = topo.map((c) => c / tl);
  // 位相（離角から照らされた割合）
  const elong = Math.acos(Math.max(-1, Math.min(1, dot(moonEnu, sunEnu))));
  const phaseAngle = Math.atan2(sun.distAU * 149597870.7 * Math.sin(elong), moon.distKm - sun.distAU * 149597870.7 * Math.cos(elong));
  const illum = (1 + Math.cos(phaseAngle)) / 2;
  // 月齢の目安: 黄経差 0=新月 180=満月
  const lonDiff = norm360(moon.lon - sun.lon);
  out.push({
    id: 'moon', ja: '月', en: 'Moon', kind: 'moon', mag: -12.7 * illum,
    enu: moonEnu, distKm: moon.distKm, illum, waxing: lonDiff < 180,
    ageDays: (lonDiff / 360) * 29.530589,
  });

  for (const p of PLANETS) {
    const pos = planetPosition(p.id, T);
    const enu = matVec(frame.j2000ToEnu, raDecToVec(pos.ra, pos.dec));
    out.push({ id: p.id, ja: p.ja, en: p.en, kind: 'planet', color: p.color, mag: pos.mag, enu, distAU: pos.distAU });
  }
  for (const b of out) Object.assign(b, enuToAzAlt(b.enu));
  return out;
}

export function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

const DIRS16 = ['北', '北北東', '北東', '東北東', '東', '東南東', '南東', '南南東', '南', '南南西', '南西', '西南西', '西', '西北西', '北西', '北北西'];
/** 方位角 → 16方位の日本語 */
export function directionName(azDeg) {
  return DIRS16[Math.round(norm360(azDeg) / 22.5) % 16];
}
