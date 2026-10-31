// npm test（Vitest）で実行。数値は Meeus『Astronomical Algorithms』(第2版) の例題より
import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  julianDate, gmstDeg, precessionMatrix, raDecToVec, vecToRaDec, matVec,
  sunPosition, moonPosition, planetPosition, observerFrame, enuToAzAlt, directionName,
} from '../src/astro.js';

const near = (actual, expected, tol, msg) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${msg}: ${actual} vs ${expected} (±${tol})`);
const angDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
const hms = (h, m, s) => (h + m / 60 + s / 3600) * 15;
const dms = (d, m, s) => Math.sign(d || 1) * (Math.abs(d) + m / 60 + s / 3600);
// TD の例題を UT で計算するため ΔT（例題年代の値）だけ戻す
const tdToT = (jd) => (jd - 2451545) / 36525;

test('ユリウス日', () => {
  near(julianDate(new Date(Date.UTC(2000, 0, 1, 12))), 2451545.0, 1e-9, 'J2000');
  near(julianDate(new Date(Date.UTC(1987, 3, 10))), 2446895.5, 1e-9, '1987-04-10');
});

test('グリニッジ平均恒星時 (例12.a/12.b)', () => {
  near(gmstDeg(2446895.5), hms(13, 10, 46.3668), 1e-5, '12.a');
  near(gmstDeg(julianDate(new Date(Date.UTC(1987, 3, 10, 19, 21, 0)))), hms(8, 34, 57.0896), 1e-5, '12.b');
});

test('歳差 (例21.b: θ Per を 2028-11-13.19 へ)', () => {
  // 固有運動を反映した J2000 位置
  const years = 28.86705;
  const ra0 = hms(2, 44, 11.986) + (0.03425 * 15 * years) / 3600;
  const dec0 = dms(49, 13, 42.48) + (-0.0895 * years) / 3600;
  const T = tdToT(2462088.69);
  const { ra, dec } = vecToRaDec(matVec(precessionMatrix(T), raDecToVec(ra0, dec0)));
  near(ra, hms(2, 46, 11.331), 2e-5, 'RA');
  near(dec, dms(49, 20, 54.54), 2e-5, 'Dec');
});

test('太陽 (例25.a: 1992-10-13.0 TD)', () => {
  const s = sunPosition(tdToT(2448908.5));
  near(s.ra, hms(13, 13, 31.4), 0.003, 'RA');
  near(s.dec, dms(-7, 47, 6), 0.003, 'Dec');
  near(s.distAU, 0.99766, 1e-4, 'R');
});

test('月 (例47.a: 1992-04-12.0 TD) 主要項のみで 0.03° 以内', () => {
  const m = moonPosition(tdToT(2448724.5));
  near(m.lon, 133.162655, 0.03, 'λ');
  near(m.lat, -3.229126, 0.03, 'β');
  near(m.distKm, 368409.7, 50, 'Δ');
});

test('惑星 (例33.a: 金星 1992-12-20.0 TD) 0.05° 以内', () => {
  // Meeus の結果は視位置（当日分点・章動/光行差込み）α=21h04m41.454s δ=-18°53'16.84"
  // ここでは J2000 位置を当日分点に歳差だけ移して比較
  const T = tdToT(2448976.5);
  const p = planetPosition('venus', T);
  const { ra, dec } = vecToRaDec(matVec(precessionMatrix(T), raDecToVec(p.ra, p.dec)));
  assert.ok(angDiff(ra, hms(21, 4, 41.454)) < 0.05, `RA ${ra}`);
  near(dec, dms(-18, 53, 16.84), 0.05, 'Dec');
});

test('地平座標: 北極星はほぼ真北・高度≒緯度', () => {
  const frame = observerFrame(new Date(Date.UTC(2026, 9, 31, 12)), 35.68, 139.77);
  const v = matVec(frame.j2000ToEnu, raDecToVec(37.9546, 89.2641));
  const { az, alt } = enuToAzAlt(v);
  assert.ok(angDiff(az, 0) < 1.2, `az ${az}`);
  near(alt, 35.68, 0.8, 'alt');
});

test('地平座標: 南中した恒星は真南・高度 90-φ+δ', () => {
  // LST = 赤経 となる瞬間を探して確認
  const lat = 35, lon = 135;
  const base = new Date(Date.UTC(2026, 0, 1, 0));
  const target = 247.3519; // アンタレス（J2000）。歳差分のズレは許容
  let best = null;
  for (let m = 0; m < 1440; m++) {
    const d = new Date(base.getTime() + m * 60000);
    const f = observerFrame(d, lat, lon);
    const { az, alt } = enuToAzAlt(matVec(f.j2000ToEnu, raDecToVec(target, -26.4320)));
    if (!best || alt > best.alt) best = { az, alt };
  }
  near(best.alt, 90 - lat - 26.432, 0.3, '南中高度');
  assert.ok(angDiff(best.az, 180) < 1, `az ${best.az}`);
});

test('東京の太陽 2026-10-31（国立天文台暦計算室の値と比較）', () => {
  // 日の出 6:01 方位106.7° / 南中 11:25 高度40.3° / 日の入り 16:47 方位253.1°
  // 日の出入りは上辺が地平線に接する時刻（中心の幾何高度 ≈ -0.9°）
  const sunAt = (iso) => {
    const f = observerFrame(new Date(iso), 35.6895, 139.6917);
    const s = sunPosition(f.T);
    return enuToAzAlt(matVec(f.eqDateToEnu, raDecToVec(s.ra, s.dec)));
  };
  const rise = sunAt('2026-10-31T06:01:00+09:00');
  near(rise.alt, -0.9, 0.25, '日の出 高度');
  near(rise.az, 106.7, 0.3, '日の出 方位');
  const noon = sunAt('2026-10-31T11:25:00+09:00');
  near(noon.alt, 40.3, 0.1, '南中高度');
  near(noon.az, 180, 0.5, '南中方位');
  const set = sunAt('2026-10-31T16:47:00+09:00');
  near(set.alt, -0.9, 0.25, '日の入り 高度');
  near(set.az, 253.1, 0.3, '日の入り 方位');
});

test('16方位', () => {
  assert.equal(directionName(0), '北');
  assert.equal(directionName(359), '北');
  assert.equal(directionName(90), '東');
  assert.equal(directionName(202.5), '南南西');
});

test('東京の月 2026-10-31: 11:29 に西北西へ沈む（月齢約20.5）', async () => {
  const { solarSystemBodies } = await import('../src/astro.js');
  const f = observerFrame(new Date('2026-10-31T11:29:00+09:00'), 35.6938, 139.7034);
  const moon = solarSystemBodies(f).find((b) => b.id === 'moon');
  // 月の入り = 上辺が地平線（大気差込み）→ 中心の幾何高度 ≈ -0.83°
  near(moon.alt, -0.83, 0.3, '月の入りの高度');
  assert.equal(directionName(moon.az), '西北西');
  near(moon.ageDays, 20.5, 1.0, '月齢');
  assert.equal(moon.waxing, false);
});
